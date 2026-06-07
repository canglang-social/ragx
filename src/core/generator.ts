import type { Answer, Citation, RetrievedChunk } from "./types";

// SEAM 3: Generator. Turns retrieved context into a cited answer. The real one
// (Claude / Ollama LLM) goes behind this interface in v1.

export interface Generator {
  readonly name: string;
  generate(question: string, context: RetrievedChunk[]): Promise<Answer>;
}

function dedupeCitations(context: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of context) {
    const key = `${c.metadata.sourceDoc}#${c.metadata.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sourceDoc: c.metadata.sourceDoc, page: c.metadata.page });
  }
  return out;
}

// No-LLM generator: echoes the top retrieved passage and attaches citations.
// Lets you measure RETRIEVAL quality in isolation before adding a real model.
export class MockGenerator implements Generator {
  readonly name = "mock";

  async generate(_question: string, context: RetrievedChunk[]): Promise<Answer> {
    const top = context[0];
    const text = top
      ? `Based on the retrieved context: "${top.text}"`
      : "No relevant context was retrieved.";
    return { text, citations: dedupeCitations(context) };
  }
}
