import { MockEmbedder, OllamaEmbedder, type Embedder } from "../src/core/embedder";
import { InMemoryVectorStore } from "../src/core/vectorStore";
import type { Chunk } from "../src/core/types";

// v0 ingestion uses a hard-coded dummy "filing" so the skeleton walks end-to-end
// BEFORE you wire real PDF parsing + PaddleOCR. In v1, replace loadDummyDoc()
// with a real loader — but keep the chunk + metadata shape exactly, because
// citations and eval scoring both depend on {sourceDoc, page}.

const DUMMY_DOC = {
  sourceDoc: "acme-annual-report-2023.txt",
  company: "Acme Corporation",
  year: 2023,
  pages: [
    {
      page: 30,
      section: "Letter to Shareholders",
      text: "Fiscal 2023 was a record year for Acme Corporation, driven by strong demand across all business segments.",
    },
    {
      page: 31,
      section: "Financial Highlights",
      text: "Acme Corporation reported total net sales of $42.5 billion in fiscal 2023, an increase of 8% from $39.4 billion in fiscal 2022.",
    },
    {
      page: 45,
      section: "Management Discussion",
      text: "Acme's gross margin was 38.2% in fiscal 2023, compared with 37.0% in the prior fiscal year.",
    },
  ],
};

// Naive chunker: one chunk per page paragraph. Replace with a real text splitter
// in v1 (e.g. token-aware, overlapping windows).
function loadDummyDoc(): Chunk[] {
  return DUMMY_DOC.pages.map((p, i) => ({
    id: `${DUMMY_DOC.sourceDoc}#p${p.page}#${i}`,
    text: p.text,
    metadata: {
      sourceDoc: DUMMY_DOC.sourceDoc,
      page: p.page,
      company: DUMMY_DOC.company,
      year: DUMMY_DOC.year,
      section: p.section,
    },
  }));
}

async function main(): Promise<void> {
  const embedder: Embedder =
    process.env.EMBEDDER === "ollama" ? new OllamaEmbedder() : new MockEmbedder();
  const store = new InMemoryVectorStore();

  const chunks = loadDummyDoc();
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
