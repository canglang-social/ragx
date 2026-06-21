import { makeEmbedder, type Embedder } from './embedder';
import { makeStore, type VectorStore } from './vectorStore';
import { MockGenerator, OllamaGenerator, OpenAIGenerator, type Generator } from './generator';
import { CrossEncoderReranker, IdentityReranker, LexicalReranker, type Reranker } from './reranker';
import { makePlanner, NoPlanner, type Planner } from './planner';
import type { Answer, RetrievedChunk } from './types';

export interface RagDeps {
  embedder: Embedder;
  store: VectorStore;
  generator: Generator;
  reranker?: Reranker;
  planner?: Planner;
  hybrid?: boolean; // fuse BM25 + vector (RRF) instead of vector-only retrieval
  topK?: number;
}

// Candidate depth pulled from each retriever before fusion. Must exceed the rank
// at which a vector miss can still recover (q031's gold ranked 42) so RRF can lift
// it; the lexical list rescues true recall misses (q035, absent from vector top-100).
const CANDIDATES = 100;

// Reciprocal Rank Fusion: combine ranked lists by Σ 1/(k + rank). Rank-based, so it
// needs no score normalization across the (incomparable) cosine and BM25 scales —
// that robustness is exactly why RRF is the default hybrid fuser.
function rrf(lists: RetrievedChunk[][], topK: number, k = 60): RetrievedChunk[] {
  const score = new Map<string, number>();
  const byId = new Map<string, RetrievedChunk>();
  for (const list of lists) {
    list.forEach((c, rank) => {
      score.set(c.id, (score.get(c.id) ?? 0) + 1 / (k + rank + 1));
      if (!byId.has(c.id)) byId.set(c.id, c);
    });
  }
  return [...byId.values()]
    .map((c) => ({ ...c, score: score.get(c.id)! })) // expose the fused score
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// Retrieve for ONE query: vector-only, or (hybrid) vector + BM25 fused via RRF.
async function retrieveOne(query: string, deps: RagDeps): Promise<RetrievedChunk[]> {
  const { embedder, store, hybrid = false, topK = 5 } = deps;
  const [vector] = await embedder.embed([query], "query");
  if (!hybrid || !store.keywordQuery) {
    return store.query(vector, topK);
  }
  const [vectorHits, keywordHits] = await Promise.all([
    store.query(vector, CANDIDATES),
    store.keywordQuery(query, CANDIDATES),
  ]);
  return rrf([vectorHits, keywordHits], topK);
}

export interface RagResult {
  answer: Answer;
  retrieved: RetrievedChunk[];
  subQueries: string[]; // what the planner produced (length 1 = no decomposition)
}

// The query pipeline. v0/v1 was a straight line; v2 adds ONE branch — the planner
// may fan a question out into per-entity sub-queries (the cross-document fix). Still
// no cycles, so still no orchestration framework: LangGraph waits for loops
// (self-correction / re-query on low confidence), if the eval ever forces them.
export async function answerQuestion(
  question: string,
  deps: RagDeps,
): Promise<RagResult> {
  const {
    generator,
    reranker = new IdentityReranker(),
    planner = new NoPlanner(),
  } = deps;

  // The planner may split the question into per-entity sub-queries (one = the linear
  // path). Each sub-query is retrieved on its own — vector-only, or hybrid (BM25 +
  // vector fused by RRF) when deps.hybrid — then MERGED by chunk id, so a
  // cross-document comparison sees each entity's chunks.
  const subQueries = await planner.plan(question);

  let retrieved: RetrievedChunk[];
  if (subQueries.length <= 1) {
    retrieved = await retrieveOne(subQueries[0] ?? question, deps);
  } else {
    const best = new Map<string, RetrievedChunk>();
    for (const sq of subQueries) {
      for (const hit of await retrieveOne(sq, deps)) {
        const prev = best.get(hit.id);
        if (!prev || hit.score > prev.score) best.set(hit.id, hit);
      }
    }
    retrieved = [...best.values()].sort((a, b) => b.score - a.score);
  }

  const ranked = await reranker.rerank(question, retrieved);
  const answer = await generator.generate(question, ranked);
  return { answer, retrieved: ranked, subQueries };
}

// Selects implementations from env, so the same pipeline runs as a zero-dep
// skeleton (default) or against Ollama. This is the seam doing its job.
export function defaultDeps(): RagDeps {
  const embedder = makeEmbedder();
  const generator: Generator =
    process.env.GENERATOR === 'ollama'
      ? new OllamaGenerator()
      : process.env.GENERATOR === 'openai'
        ? new OpenAIGenerator()
        : new MockGenerator();
  // Reranker defaults to identity (passthrough). A lexical reranker exists behind
  // RERANKER=lexical, but A/B showed it REGRESSES vs feeding the wide topK at 20
  // (it truncates out gold chunks; keyword overlap isn't discriminative when a
  // phrase repeats across subsidiary tables). Kept as a documented negative result.
  const reranker: Reranker =
    process.env.RERANKER === 'jina'
      ? new CrossEncoderReranker()
      : process.env.RERANKER === 'lexical'
        ? new LexicalReranker()
        : new IdentityReranker();
  return {
    embedder,
    store: makeStore(),
    generator,
    reranker,
    planner: makePlanner(),
    hybrid: process.env.RETRIEVER === 'hybrid',
    topK: Number(process.env.TOP_K ?? 5),
  };
}
