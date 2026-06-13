import type { RetrievedChunk } from "./types";

// SEAM 4: Reranker. Reorders retrieved chunks for relevance, then keeps the best
// few. Two-stage retrieval: the store fetches a WIDE candidate set (recall), the
// reranker hands the generator a SHORT, clean set (precision).

export interface Reranker {
  readonly name: string;
  rerank(question: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]>;
}

// No-op passthrough. Used as the baseline to measure a real reranker against.
export class IdentityReranker implements Reranker {
  readonly name = "identity";
  async rerank(_question: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    return chunks;
  }
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "was",
  "were", "is", "are", "what", "did", "does", "do", "be", "by", "with", "as",
  "that", "this", "its", "it", "their",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function minmax(xs: number[]): number[] {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const span = hi - lo;
  return xs.map((x) => (span > 0 ? (x - lo) / span : 0));
}

// Hybrid reranker (B7). Blends the vector score with lexical (query-term) overlap,
// then keeps the top N. Justified by a measured signal: at wide K the right chunk
// IS retrieved, but pure vector similarity ranks it below distractors, and feeding
// the generator a wide K degrades answers. Keyword overlap rescues fact-bearing
// chunks (e.g. "net earnings attributable to shareholders") that vector search
// buried. No model, no dependency — the lean form of hybrid search.
export class LexicalReranker implements Reranker {
  readonly name: string;

  constructor(
    private topN = Number(process.env.RERANK_TOP_N ?? 5),
    private alpha = Number(process.env.RERANK_ALPHA ?? 0.5), // weight on vector vs lexical
  ) {
    this.name = `lexical(topN=${this.topN},alpha=${this.alpha})`;
  }

  async rerank(question: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return chunks;
    const terms = [...new Set(tokenize(question))];

    const lex = chunks.map((c) => {
      if (terms.length === 0) return 0;
      const chunkTerms = new Set(tokenize(c.text));
      return terms.filter((t) => chunkTerms.has(t)).length / terms.length;
    });

    // Normalize both signals within the candidate set so alpha is meaningful:
    // raw cosine sits around 0.7–0.9, lexical overlap in [0,1].
    const nVec = minmax(chunks.map((c) => c.score));
    const nLex = minmax(lex);

    return chunks
      .map((c, i) => ({ chunk: c, blended: this.alpha * nVec[i] + (1 - this.alpha) * nLex[i] }))
      .sort((a, b) => b.blended - a.blended)
      .slice(0, this.topN)
      .map((s) => ({ ...s.chunk, score: s.blended }));
  }
}
