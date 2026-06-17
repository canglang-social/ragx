// SEAM 1: Embedder. Turns text into vectors. Depend on this interface, not on
// a vendor, so swapping mock -> Ollama -> hosted is a one-line change.

// Retrieval is asymmetric: a question and the passage that answers it are worded
// differently, so embedders can apply a per-side prefix/task. `kind` tells the embedder
// which side it's embedding — ingest passes "document", the query path passes "query".
export type EmbedKind = "query" | "document";

export interface Embedder {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[], kind?: EmbedKind): Promise<number[][]>;
}

// Deterministic, dependency-free embedder. Lets the whole skeleton run with zero
// external services. Quality is poor (bag-of-words hashing) — it exists so the
// pipeline walks, not so it answers well. Swap for OllamaEmbedder for real use.
export class MockEmbedder implements Embedder {
  readonly name = "mock";
  readonly dim: number;

  constructor(dim = 256) {
    this.dim = dim;
  }

  async embed(texts: string[], _kind: EmbedKind = "document"): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t)); // mock has no query/document asymmetry
  }

  private embedOne(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const tok of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0;
      v[Math.abs(h) % this.dim] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

// Real local embedder. Requires `ollama serve` + `ollama pull <model>`. The model is
// env-configurable (EMBED_MODEL) so you can A/B local embedders (nomic, bge-m3,
// qwen3-embedding, …) for free — see docs/embedder-comparison.md.
export class OllamaEmbedder implements Embedder {
  readonly name: string;
  readonly dim: number;

  constructor(
    private model = process.env.EMBED_MODEL ?? "nomic-embed-text",
    private host = process.env.OLLAMA_HOST ?? "http://localhost:11434",
    dim = Number(process.env.EMBED_DIM ?? 768), // informational; the store sizes to the real length
  ) {
    this.name = `ollama:${this.model}`;
    this.dim = dim;
  }

  async embed(texts: string[], kind: EmbedKind = "document"): Promise<number[][]> {
    // Per-side prefix, off by default. For nomic set EMBED_QUERY_PREFIX="search_query: "
    // and EMBED_DOC_PREFIX="search_document: ".
    const prefix =
      kind === "query" ? (process.env.EMBED_QUERY_PREFIX ?? "") : (process.env.EMBED_DOC_PREFIX ?? "");
    const out: number[][] = [];
    for (const text of texts) {
      const res = await fetch(`${this.host}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: `${prefix}${text}` }),
      });
      if (!res.ok) throw new Error(`Ollama embeddings failed: ${res.status}`);
      const json = (await res.json()) as { embedding: number[] };
      out.push(json.embedding);
    }
    return out;
  }
}

// OpenAI-compatible embedder (G15). One impl for any provider with an OpenAI-style
// /v1/embeddings endpoint — OpenAI, Jina, Together, etc. Configured by env
// (EMBED_BASE_URL / EMBED_MODEL / EMBED_API_KEY). The deploy embedder, since Vercel
// can't run Ollama. NOTE: a different embedder = different vectors → re-ingest + re-eval.
export class OpenAIEmbedder implements Embedder {
  readonly name: string;
  readonly dim: number;

  constructor(
    private model = process.env.EMBED_MODEL ?? "text-embedding-3-small",
    private baseUrl = process.env.EMBED_BASE_URL ?? "https://api.openai.com/v1",
    private apiKey = process.env.EMBED_API_KEY ?? "",
    dim = Number(process.env.EMBED_DIM ?? 1536), // informational; pg sizes to the real length
  ) {
    this.name = `openai:${this.model}`;
    this.dim = dim;
  }

  async embed(texts: string[], kind: EmbedKind = "document"): Promise<number[][]> {
    // Per-side task, off by default. For Jina set EMBED_QUERY_TASK="retrieval.query"
    // and EMBED_DOC_TASK="retrieval.passage". (Plain OpenAI embeddings need no task.)
    const task = kind === "query" ? process.env.EMBED_QUERY_TASK : process.env.EMBED_DOC_TASK;
    const out: number[][] = [];
    const BATCH = 96; // batch inputs per request to cut round-trips on ingest
    for (let i = 0; i < texts.length; i += BATCH) {
      out.push(...(await this.embedBatch(texts.slice(i, i + BATCH), task)));
    }
    return out;
  }

  private async embedBatch(input: string[], task?: string): Promise<number[][]> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input, ...(task ? { task } : {}) }),
      });
      if (res.status === 429 && attempt < 5) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
        await new Promise((r) => setTimeout(r, waitMs + 250));
        continue;
      }
      if (!res.ok) {
        throw new Error(`OpenAI-compatible embeddings failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    }
  }
}

// Composition-root factory (B6). Pick the embedder from env. Used by ingest AND the
// query pipeline so they ALWAYS match — different embedders = silently broken retrieval.
export function makeEmbedder(): Embedder {
  switch (process.env.EMBEDDER) {
    case "ollama":
      return new OllamaEmbedder();
    case "openai":
      return new OpenAIEmbedder();
    default:
      return new MockEmbedder();
  }
}
