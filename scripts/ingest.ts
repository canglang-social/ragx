import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { makeEmbedder } from "../src/core/embedder";
import { makeStore } from "../src/core/vectorStore";
import { splitText, contextualize } from "../src/core/chunker";
import type { Chunk } from "../src/core/types";

const PDF_DIR = "data/pdfs";

// `company` and `year` come from a filename convention — `company-year.pdf`
// (e.g. meridian-2023.pdf) — because we can't reliably read them from arbitrary
// PDF content. The filename IS the contract.
function parseFilename(file: string): { company?: string; year?: number } {
  const m = file.replace(/\.pdf$/i, "").match(/^(.+)-(\d{4})$/);
  return m ? { company: m[1], year: Number(m[2]) } : {};
}

// Collapse dotted leaders — "Total revenue . . . . . 242,290" / "....." — that filings
// use to align table columns. Pure noise: they bloat the window, dilute the embedding,
// and don't help BM25. Decimals ($96.2) and initials (U.S.) are left intact (no spaced
// runs, fewer than 4 dots). Newlines survive so the page heading can still be read off.
function deNoise(text: string): string {
  return text
    .replace(/(?:\.\s+){3,}\.?/g, " ")
    .replace(/\.{4,}/g, " ")
    .replace(/[^\S\n]{2,}/g, " ");
}

// Contextual prefix prepended to every chunk (Anthropic "contextual retrieval", lite).
// A bare table row ("Total revenue 242,290") names neither its company nor its
// statement, so neither retriever can match "Costco total revenue" to it — MEASURED:
// BM25 ranked a DIFFERENT filing #1 and the gold chunk was absent from the top-100.
// Prepending company + year (from the filename) + the page's heading line gives the row
// the entity/section tokens it lacks; the pre-check lifted that Costco chunk from
// BM25-absent to rank 62. Kept compact so it anchors WITHOUT re-diluting — Jina loses
// 0.07 retrieval at 800-char windows, so bigger chunks are the wrong lever.
function contextHeader(company: string | undefined, year: number | undefined, pageText: string): string {
  const co = company ? company[0].toUpperCase() + company.slice(1) : "";
  const heading = (pageText.split("\n").map((l) => l.trim()).find((l) => /[A-Za-z]{4,}/.test(l)) ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return [co, year, heading].filter(Boolean).join(" — ");
}

// PDF loader: extract per-page text, then split each page (A3) into overlapping
// windows small enough to embed well. Each window is a chunk carrying its page —
// the chunk + metadata shape is the contract: citations and eval scoring both
// depend on {sourceDoc, page}. Chunking stays WITHIN a page so citations are exact.
async function loadPdfs(dir: string): Promise<Chunk[]> {
  const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  const chunks: Chunk[] = [];
  for (const file of files) {
    const buffer = await readFile(join(dir, file));
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    const { company, year } = parseFilename(file);
    text.forEach((pageText, i) => {
      const page = i + 1; // unpdf pages are 0-indexed; filings cite from 1
      const clean = deNoise(pageText);
      const ctx = contextHeader(company, year, clean);
      splitText(clean, {
        maxChars: process.env.CHUNK_CHARS ? Number(process.env.CHUNK_CHARS) : undefined,
        overlapChars: process.env.CHUNK_OVERLAP ? Number(process.env.CHUNK_OVERLAP) : undefined,
      }).forEach((win, w) => {
        chunks.push({
          id: `${file}#p${page}#${w}`,
          // RAW window — what the reranker, generator, and citation see (and what eval
          // matches gold against). The contextual prefix lives in metadata and is folded
          // back in ONLY for embedding + BM25 via contextualize().
          text: win,
          metadata: { sourceDoc: file, page, company, year, contextHeader: ctx || undefined },
        });
      });
    });
  }
  return chunks;
}

async function main(): Promise<void> {
  const embedder = makeEmbedder();
  const store = makeStore();

  const chunks = await loadPdfs(PDF_DIR);

  // DRY_RUN=1: print what gets embedded (contextualized) vs what gets stored (raw) for a
  // few chunks, then stop before embedding — eyeball chunking without a ~15-min re-ingest.
  if (process.env.DRY_RUN) {
    for (const c of chunks.slice(0, 4)) {
      console.log(`\n[${c.id}]\n  embed→ ${contextualize(c).slice(0, 160)}\n  text→  ${c.text.slice(0, 160)}`);
    }
    console.log(`\n(DRY_RUN) built ${chunks.length} chunks; skipping embed/store.`);
    return;
  }

  // Embed the CONTEXTUALIZED text (header + window); store the raw window as chunk.text.
  const vectors = await embedder.embed(chunks.map(contextualize), "document");
  // Zip chunks with their vectors ONCE, here at the boundary — so the store's
  // upsert can't be handed misaligned arrays.
  const entries = chunks.map((chunk, i) => ({ chunk, vector: vectors[i] }));

  await store.reset();
  await store.upsert(entries);
  await store.close?.();

  console.log(`Ingested ${chunks.length} chunks using embedder "${embedder.name}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
