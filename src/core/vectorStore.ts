import { promises as fs } from "node:fs";
import path from "node:path";
import { PgVectorStore } from "./pgVectorStore";
import type { Chunk, RetrievedChunk } from "./types";

// SEAM 2: VectorStore. Holds vectors, returns the nearest ones for a query.

export interface VectorStore {
  upsert(entries: StoredVector[]): Promise<void>;
  query(vector: number[], topK: number): Promise<RetrievedChunk[]>;
  reset(): Promise<void>;
  close?(): Promise<void>; // release connections (no-op for in-memory)
}

// A chunk paired with its vector. Passing these as one unit (instead of two
// parallel arrays) makes it impossible to misalign a chunk with the wrong vector.
export interface StoredVector {
  chunk: Chunk;
  vector: number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// File-backed store: zero external deps, and it survives across the `ingest` and
// `query` processes via a JSON file. LOCAL-ONLY — Vercel is serverless with no
// persistent disk, so implement a PgVectorStore behind this interface before
// deploying. The seam means the rest of the app won't change when you do.
export class InMemoryVectorStore implements VectorStore {
  private records: StoredVector[] = [];
  private loaded = false;

  constructor(private file = path.join(process.cwd(), "data", "index.json")) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.records = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      this.records = [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.records));
  }

  async reset(): Promise<void> {
    this.records = [];
    this.loaded = true;
    await this.persist();
  }

  async upsert(entries: StoredVector[]): Promise<void> {
    await this.load();
    this.records.push(...entries);
    await this.persist();
  }

  async query(vector: number[], topK: number): Promise<RetrievedChunk[]> {
    await this.load();
    return this.records
      .map((r) => ({ ...r.chunk, score: cosine(vector, r.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

// Composition-root factory: pick the store from env. Default in-memory (zero-dep,
// local); `VECTOR_STORE=pg` selects pgvector (the deploy target). The pg store is a
// module-level singleton so its one connection is reused across requests —
// serverless isolates persist module state, and a per-request connection would
// exhaust the pool.
let pgStore: PgVectorStore | undefined;

export function makeStore(): VectorStore {
  if (process.env.VECTOR_STORE === "pg") {
    pgStore ??= new PgVectorStore();
    return pgStore;
  }
  return new InMemoryVectorStore();
}
