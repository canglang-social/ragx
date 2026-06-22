import postgres from "postgres";
import { contextualize } from "./chunker";
import type { ChunkMetadata, RetrievedChunk } from "./types";
import type { StoredVector, VectorStore } from "./vectorStore";

type Row = { id: string; text: string; metadata: ChunkMetadata | string; score: number };

// jsonb may come back as a string depending on the driver — normalize to an object.
function toChunk(r: Row): RetrievedChunk {
  return {
    id: r.id,
    text: r.text,
    metadata: (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata) as ChunkMetadata,
    score: Number(r.score),
  };
}

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
  // Table name is overridable (PG_TABLE) so a new index can be built in a SEPARATE
  // table and Vercel cut over by flipping one env var — the live table keeps serving
  // until the flip (zero-downtime deploy), and is the rollback. Validated to a strict
  // identifier because it's interpolated into DDL (can't be a bound parameter).
  private readonly table: string;

  constructor(url = process.env.DATABASE_URL) {
    if (!url) throw new Error("PgVectorStore needs DATABASE_URL");
    this.table = process.env.PG_TABLE ?? "chunks";
    if (!/^[a-z_][a-z0-9_]*$/.test(this.table)) throw new Error(`invalid PG_TABLE: ${this.table}`);
    // Hosted Postgres (Supabase/Neon) requires SSL; local Docker doesn't.
    const local = /@(localhost|127\.0\.0\.1)/.test(url);
    this.sql = postgres(url, {
      max: 1, // one connection — serverless-friendly
      ssl: local ? false : "require",
      onnotice: () => {}, // silence harmless NOTICEs (e.g. DROP IF EXISTS on first run)
    });
  }

  // Create the table sized to the embedder's dim (768 for nomic). Lazy so an
  // embedder swap just changes the dim on the next fresh ingest.
  private async ensureSchema(dim: number): Promise<void> {
    if (this.ready) return;
    await this.sql`CREATE EXTENSION IF NOT EXISTS vector`;
    // `text` is the RAW window (returned to the reranker/generator); `content` is the
    // CONTEXTUALIZED text (header + window) that both retrievers index — `tsv` is its
    // generated full-text vector, the lexical half of hybrid retrieval (pg's BM25
    // analogue). Keeping `text` raw is what made the cross-encoder reranker work.
    await this.sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         id text PRIMARY KEY,
         text text NOT NULL,
         content text NOT NULL DEFAULT '',
         metadata jsonb NOT NULL,
         embedding vector(${dim}) NOT NULL,
         tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
       )`,
    );
    // pgvector's HNSW index supports ≤2000 dims; above that (e.g. text-embedding-3-large
    // at 3072) skip it — exact scan is fast enough at this corpus size.
    if (dim <= 2000) {
      await this.sql.unsafe(
        `CREATE INDEX IF NOT EXISTS ${this.table}_embedding_idx
           ON ${this.table} USING hnsw (embedding vector_cosine_ops)`,
      );
    }
    // GIN index over the generated tsvector — makes keywordQuery's `@@` match fast.
    await this.sql.unsafe(
      `CREATE INDEX IF NOT EXISTS ${this.table}_tsv_idx ON ${this.table} USING gin (tsv)`,
    );
    this.ready = true;
  }

  async reset(): Promise<void> {
    await this.sql.unsafe(`DROP TABLE IF EXISTS ${this.table}`);
    this.ready = false;
  }

  async upsert(entries: StoredVector[]): Promise<void> {
    if (entries.length === 0) return;
    await this.ensureSchema(entries[0].vector.length);
    // Multi-row inserts: one round-trip per BATCH instead of per row — critical
    // over a remote connection (2476 single inserts = thousands of round-trips).
    const BATCH = 500;
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const tuples = batch
        .map((_, j) => {
          const p = j * 5;
          return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}::jsonb, $${p + 5}::vector)`;
        })
        .join(", ");
      // content = the contextualized text (header + raw window) — what the tsvector and
      // the embedding both index. text stays the raw window.
      const params = batch.flatMap(({ chunk, vector }) => [
        chunk.id,
        chunk.text,
        contextualize(chunk),
        JSON.stringify(chunk.metadata),
        `[${vector.join(",")}]`,
      ]);
      await this.sql.unsafe(
        `INSERT INTO ${this.table} (id, text, content, metadata, embedding) VALUES ${tuples}
         ON CONFLICT (id) DO UPDATE
           SET text = EXCLUDED.text, content = EXCLUDED.content,
               metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding`,
        params,
      );
    }
  }

  async query(vector: number[], topK: number): Promise<RetrievedChunk[]> {
    const embedding = `[${vector.join(",")}]`;
    // `<=>` is pgvector cosine DISTANCE (0 = identical); similarity = 1 - distance.
    const rows = (await this.sql.unsafe(
      `SELECT id, text, metadata, 1 - (embedding <=> $1::vector) AS score
       FROM ${this.table}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embedding, topK],
    )) as unknown as Row[];
    return rows.map(toChunk);
  }

  // Lexical half of hybrid retrieval — Postgres full-text search over the contextualized
  // `content` (this store's analogue of the in-memory BM25 path; rank-based RRF fusion in
  // rag.ts doesn't care that ts_rank ≠ Okapi). websearch_to_tsquery tolerates arbitrary
  // user text. Returns the RAW `text`, exactly like query(), so the reranker sees clean text.
  async keywordQuery(query: string, topK: number): Promise<RetrievedChunk[]> {
    const rows = (await this.sql.unsafe(
      `SELECT id, text, metadata, ts_rank(tsv, websearch_to_tsquery('english', $1)) AS score
       FROM ${this.table}
       WHERE tsv @@ websearch_to_tsquery('english', $1)
       ORDER BY score DESC
       LIMIT $2`,
      [query, topK],
    )) as unknown as Row[];
    return rows.map(toChunk);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}
