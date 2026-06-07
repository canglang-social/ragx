// Shared data shapes. These types ARE part of the contract — keep them stable.

export interface ChunkMetadata {
  sourceDoc: string;
  page: number;
  company?: string;
  year?: number;
  section?: string;
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
