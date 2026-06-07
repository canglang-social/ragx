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
