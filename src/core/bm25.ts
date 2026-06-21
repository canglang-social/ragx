// Minimal Okapi BM25 lexical search — the recall half of hybrid retrieval.
//
// Why it exists, on a measured signal: dense vectors miss exact figures buried in
// numeric tables (q035 "242,290" wasn't in Jina's top-100 — a RECALL miss; q031
// "72,361" ranked 42 — a RANK miss). BM25 matches the literal query tokens, so a
// table chunk that says "Total revenue …" scores on "total"/"revenue" even though
// it's semantically thin. Fused with vectors (RRF), it recovers both kinds of miss.
//
// Inverted index so a query only scores docs that contain its terms. k1/b are the
// textbook defaults; not tuned (no signal yet) — they're knobs if the eval asks.

const K1 = 1.5;
const B = 0.75;

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export class BM25 {
  private postings = new Map<string, [doc: number, tf: number][]>();
  private idf = new Map<string, number>();
  private docLen: number[] = [];
  private avgdl = 1;

  constructor(docs: string[]) {
    const n = docs.length;
    const df = new Map<string, number>();
    docs.forEach((text, d) => {
      const toks = tokenize(text);
      this.docLen[d] = toks.length;
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [t, f] of tf) {
        (this.postings.get(t) ?? this.postings.set(t, []).get(t)!).push([d, f]);
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    });
    this.avgdl = this.docLen.reduce((a, b) => a + b, 0) / (n || 1) || 1;
    for (const [t, d] of df) this.idf.set(t, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  }

  // Returns doc indices + BM25 score, best first. Only docs sharing a query term
  // are scored (via the inverted index).
  search(query: string, topK: number): { doc: number; score: number }[] {
    const scores = new Map<number, number>();
    for (const t of new Set(tokenize(query))) {
      const idf = this.idf.get(t);
      if (idf === undefined) continue; // term not in corpus
      for (const [d, f] of this.postings.get(t)!) {
        const norm = f + K1 * (1 - B + (B * this.docLen[d]) / this.avgdl);
        scores.set(d, (scores.get(d) ?? 0) + (idf * (f * (K1 + 1))) / norm);
      }
    }
    return [...scores.entries()]
      .map(([doc, score]) => ({ doc, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
