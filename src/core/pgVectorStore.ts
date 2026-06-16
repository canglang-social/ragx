import postgres from "postgres";
import type { ChunkMetadata, RetrievedChunk } from "./types";
import type { StoredVector, VectorStore } from "./vectorStore";

// pgvector-backed store (C8). Same VectorStore seam as InMemoryVectorStore, but
// persistent and serverless-friendly — the deploy target, since Vercel has no
// persistent disk and the 37 MB index is too big to bundle. Needs DATABASE_URL
// (Postgres + the `vector` extension; e.g. Supabase or Neon free tier).
//
// Why pgvector and not a dedicated vector DB (Milvus/Pinecone): at thousands of
// vectors that would be over-machinery — see docs/principles.md §2.
export class PgVectorStore implements VectorStore {
  private sql: ReturnType<typeof postgres>;
  private ready = false;

  constructor(url = process.env.DATABASE_URL) {
    if (!url) throw new Error("PgVectorStore needs DATABASE_URL");
    // Hosted Postgres (Supabase/Neon) requires SSL; local Docker doesn't.
    const local = /@(localhost|127\.0\.0\.1)/.test(url);
    this.sql = postgres(url, { max: 1, ssl: local ? false : "require" }); // max 1 — serverless-friendly
  }

  // Create the table sized to the embedder's dim (768 for nomic). Lazy so an
  // embedder swap just changes the dim on the next fresh ingest.
  private async ensureSchema(dim: number): Promise<void> {
    if (this.ready) return;
    await this.sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await this.sql.unsafe(
      `CREATE TABLE IF NOT EXISTS chunks (
         id text PRIMARY KEY,
         text text NOT NULL,
         metadata jsonb NOT NULL,
         embedding vector(${dim}) NOT NULL
       )`,
    );
    await this.sql.unsafe(
      `CREATE INDEX IF NOT EXISTS chunks_embedding_idx
         ON chunks USING hnsw (embedding vector_cosine_ops)`,
    );
    this.ready = true;
  }

  async reset(): Promise<void> {
    await this.sql`DROP TABLE IF EXISTS chunks`;
    this.ready = false;
  }

  async upsert(entries: StoredVector[]): Promise<void> {
    if (entries.length === 0) return;
    await this.ensureSchema(entries[0].vector.length);
    // One transaction → postgres.js pipelines the inserts (fast) and they commit atomically.
    await this.sql.begin(async (tx) => {
      for (const { chunk, vector } of entries) {
        const embedding = `[${vector.join(",")}]`;
        await tx`
          INSERT INTO chunks (id, text, metadata, embedding)
          VALUES (${chunk.id}, ${chunk.text}, ${JSON.stringify(chunk.metadata)}::jsonb, ${embedding}::vector)
          ON CONFLICT (id) DO UPDATE
            SET text = EXCLUDED.text, metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding`;
      }
    });
  }

  async query(vector: number[], topK: number): Promise<RetrievedChunk[]> {
    const embedding = `[${vector.join(",")}]`;
    // `<=>` is pgvector cosine DISTANCE (0 = identical); similarity = 1 - distance.
    const rows = await this.sql<
      { id: string; text: string; metadata: ChunkMetadata; score: number }[]
    >`
      SELECT id, text, metadata, 1 - (embedding <=> ${embedding}::vector) AS score
      FROM chunks
      ORDER BY embedding <=> ${embedding}::vector
      LIMIT ${topK}`;
    return rows.map((r) => ({ id: r.id, text: r.text, metadata: r.metadata, score: Number(r.score) }));
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}
