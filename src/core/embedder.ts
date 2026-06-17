// SEAM 1: Embedder. Turns text into vectors. Depend on this interface, not on
// a vendor, so swapping mock -> Ollama -> hosted is a one-line change.

export interface Embedder {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
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

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
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

// Real local embedder. Requires `ollama serve` + `ollama pull nomic-embed-text`.
export class OllamaEmbedder implements Embedder {
  readonly name = "ollama:nomic-embed-text";
  readonly dim = 768;

  constructor(
    private model = "nomic-embed-text",
    private host = process.env.OLLAMA_HOST ?? "http://localhost:11434",
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const prompt of texts) {
      const res = await fetch(`${this.host}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt }),
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

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    const BATCH = 96; // batch inputs per request to cut round-trips on ingest
    for (let i = 0; i < texts.length; i += BATCH) {
      out.push(...(await this.embedBatch(texts.slice(i, i + BATCH))));
    }
    return out;
  }

  private async embedBatch(input: string[]): Promise<number[][]> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input }),
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
