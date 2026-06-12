import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { MockEmbedder, OllamaEmbedder, type Embedder } from "../src/core/embedder";
import { InMemoryVectorStore } from "../src/core/vectorStore";
import type { Chunk } from "../src/core/types";

const PDF_DIR = "data/pdfs";

// `company` and `year` come from a filename convention — `company-year.pdf`
// (e.g. meridian-2023.pdf) — because we can't reliably read them from arbitrary
// PDF content. The filename IS the contract.
function parseFilename(file: string): { company?: string; year?: number } {
  const m = file.replace(/\.pdf$/i, "").match(/^(.+)-(\d{4})$/);
  return m ? { company: m[1], year: Number(m[2]) } : {};
}

// A1 loader: one chunk per page. Real token-aware overlapping chunking is A3 —
// a separate, separately-measurable step. The chunk + metadata shape is the
// contract: citations and eval scoring both depend on {sourceDoc, page}.
async function loadPdfs(dir: string): Promise<Chunk[]> {
  const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  const chunks: Chunk[] = [];
  for (const file of files) {
    const buffer = await readFile(join(dir, file));
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    const { company, year } = parseFilename(file);
    text.forEach((pageText, i) => {
      const clean = pageText.trim();
      if (!clean) return; // skip blank pages
      const page = i + 1; // unpdf pages are 0-indexed; filings cite from 1
      chunks.push({
        id: `${file}#p${page}`,
        text: clean,
        metadata: { sourceDoc: file, page, company, year },
      });
    });
  }
  return chunks;
}

async function main(): Promise<void> {
  const embedder: Embedder =
    process.env.EMBEDDER === "ollama" ? new OllamaEmbedder() : new MockEmbedder();
  const store = new InMemoryVectorStore();

  const chunks = await loadPdfs(PDF_DIR);
  const vectors = await embedder.embed(chunks.map((c) => c.text));
  // Zip chunks with their vectors ONCE, here at the boundary — so the store's
  // upsert can't be handed misaligned arrays.
  const entries = chunks.map((chunk, i) => ({ chunk, vector: vectors[i] }));

  await store.reset();
  await store.upsert(entries);

  console.log(`Ingested ${chunks.length} chunks using embedder "${embedder.name}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
