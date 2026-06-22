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

// Vector gets slightly more weight than BM25 in the fusion. MEASURED on the eval
// (see the rank probe in docs/state.local.md): plain RRF demoted two vector-strong
// Berkshire cases below the noisier BM25 list (q013, q017). A 1.2× vector weight
// recovers q017 WITHOUT costing the BM25 *recall* rescues — q008/q031, figures the
// vector buries (rank 83/42) that BM25 surfaces — which are exactly what grounds the
// cross-document cases. (A vector-floor that pins the vector top-K instead was tried
// and REJECTED: it crowds out those BM25 rescues. q013 stays lost — it's vector-15
// but absent from BM25's top-100, so RRF inevitably sinks a single-list chunk; the
// only fix destroys the gains.) Plain unweighted RRF is RRF_VECTOR_WEIGHT=1.
const VECTOR_WEIGHT = Number(process.env.RRF_VECTOR_WEIGHT ?? 1.2);

// Reciprocal Rank Fusion: combine ranked lists by Σ wᵢ/(k + rank). Rank-based, so it
// needs no score normalization across the (incomparable) cosine and BM25 scales —
// that robustness is exactly why RRF is the default hybrid fuser. Optional per-list
// weights let one retriever count for more (here vector > BM25; see VECTOR_WEIGHT).
function rrf(lists: RetrievedChunk[][], topK: number, k = 60, weights?: number[]): RetrievedChunk[] {
  const score = new Map<string, number>();
  const byId = new Map<string, RetrievedChunk>();
  lists.forEach((list, li) => {
    const w = weights?.[li] ?? 1;
    list.forEach((c, rank) => {
      score.set(c.id, (score.get(c.id) ?? 0) + w / (k + rank + 1));
      if (!byId.has(c.id)) byId.set(c.id, c);
    });
  });
  return [...byId.values()]
    .map((c) => ({ ...c, score: score.get(c.id)! })) // expose the fused score
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// Retrieve the top-`k` for ONE query: vector-only, or (hybrid) vector + BM25 fused via
// RRF. `k` is the FIRST-STAGE width — large when a reranker will re-score (so a gold the
// fusion ranks just outside the final top-K is still on the table), else the final top-K.
async function retrieveOne(query: string, deps: RagDeps, k: number): Promise<RetrievedChunk[]> {
  const { embedder, store, hybrid = false } = deps;
  const [vector] = await embedder.embed([query], "query");
  if (!hybrid || !store.keywordQuery) {
    return store.query(vector, k);
  }
  const [vectorHits, keywordHits] = await Promise.all([
    store.query(vector, CANDIDATES),
    store.keywordQuery(query, CANDIDATES),
  ]);
  return rrf([vectorHits, keywordHits], k, 60, [VECTOR_WEIGHT, 1]);
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
    topK = 5,
  } = deps;

  // Two-stage retrieval. When a reranker is active, the FIRST stage fetches a WIDER
  // candidate set (RERANK_CANDIDATES) — recall is good post-contextualization, so the
  // gold is usually in the top-100, but within-doc homogenization can crowd it just
  // past top-K in the fusion; the reranker reads (query, chunk) together and promotes
  // it. With the identity reranker there's no second stage, so we fetch exactly top-K.
  const reranking = reranker.name !== "identity";
  const width = reranking ? Number(process.env.RERANK_CANDIDATES ?? 50) : topK;

  // The planner may split the question into per-entity sub-queries (one = the linear
  // path). Each sub-query is retrieved on its own — vector-only, or hybrid (BM25 +
  // vector fused by RRF) when deps.hybrid — then MERGED by chunk id, so a
  // cross-document comparison sees each entity's chunks.
  const subQueries = await planner.plan(question);

  let retrieved: RetrievedChunk[];
  if (subQueries.length <= 1) {
    retrieved = await retrieveOne(subQueries[0] ?? question, deps, width);
  } else {
    const best = new Map<string, RetrievedChunk>();
    for (const sq of subQueries) {
      for (const hit of await retrieveOne(sq, deps, width)) {
        const prev = best.get(hit.id);
        if (!prev || hit.score > prev.score) best.set(hit.id, hit);
      }
    }
    retrieved = [...best.values()].sort((a, b) => b.score - a.score);
  }

  // Second stage: rerank the wide set, then keep top-K for the generator (and the
  // hit@K metric). With identity, retrieved is already top-K and this is a no-op slice.
  const ranked = (await reranker.rerank(question, retrieved)).slice(0, topK);
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
