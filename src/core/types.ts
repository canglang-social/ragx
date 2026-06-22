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
