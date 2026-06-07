import type { RetrievedChunk } from "./types";

// SEAM 4: Reranker. Reorders retrieved chunks for relevance.

export interface Reranker {
  rerank(question: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]>;
}

// No-op default. Add a real cross-encoder reranker ONLY when the eval shows
// retrieval recall is high (the right chunk IS retrieved) but it isn't ranked
// first — that is the precise signal that reranking will help.
export class IdentityReranker implements Reranker {
  async rerank(_question: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    return chunks;
  }
}
