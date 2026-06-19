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
  topK?: number;
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
    embedder,
    store,
    generator,
    reranker = new IdentityReranker(),
    planner = new NoPlanner(),
    topK = 5,
  } = deps;

  // The planner may split the question into per-entity sub-queries. One sub-query =
  // the linear v0/v1 path. Multiple = retrieve each and MERGE, so a cross-document
  // comparison sees BOTH filings' chunks — which a single query vector can't reach.
  const subQueries = await planner.plan(question);
  const vectors = await embedder.embed(subQueries, "query");

  let retrieved: RetrievedChunk[];
  if (vectors.length <= 1) {
    retrieved = await store.query(vectors[0], topK);
  } else {
    // Union by chunk id (best score wins), then sort by score. Each sub-query gets
    // its own topK, so each entity's gold chunk — which ranks high for ITS sub-query —
    // survives into the merged context.
    const best = new Map<string, RetrievedChunk>();
    for (const v of vectors) {
      for (const hit of await store.query(v, topK)) {
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
    topK: Number(process.env.TOP_K ?? 5),
  };
}
