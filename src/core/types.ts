// Shared data shapes. These types ARE part of the contract — keep them stable.

export interface ChunkMetadata {
  sourceDoc: string;
  page: number;
  company?: string;
  year?: number;
  section?: string;
  // Contextual prefix (company/year/section) prepended ONLY for embedding + BM25, not
  // stored in `text`. Keeps retrieval anchored to the entity while the reranker,
  // generator, and citation see the clean raw window. See chunker.contextualize().
  contextHeader?: string;
  // Multi-representation (Family 3): an LLM-written natural-language description of a
  // statement row (e.g. "JPMorgan's total assets at year-end 2023 were $3,875,393M").
  // When set it REPLACES contextHeader+text for retrieval (vector, BM25, reranker) —
  // the embedder ranks a sentence far better than a bare number-row — while `text`
  // stays the raw row for grounding + eval gold matching. See chunker.contextualize().
  embedText?: string;
}

export interface Chunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

export interface RetrievedChunk extends Chunk {
  score: number;
}

export interface Citation {
  sourceDoc: string;
  page: number;
}

export interface Answer {
  text: string;
  citations: Citation[];
}
