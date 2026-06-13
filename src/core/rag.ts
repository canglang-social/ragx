import { MockEmbedder, OllamaEmbedder, type Embedder } from './embedder';
import { InMemoryVectorStore, type VectorStore } from './vectorStore';
import { MockGenerator, OllamaGenerator, type Generator } from './generator';
import { IdentityReranker, LexicalReranker, type Reranker } from './reranker';
import type { Answer, RetrievedChunk } from './types';

export interface RagDeps {
  embedder: Embedder;
  store: VectorStore;
  generator: Generator;
  reranker?: Reranker;
  topK?: number;
}

export interface RagResult {
  answer: Answer;
  retrieved: RetrievedChunk[];
}

// The entire v0 query pipeline: a straight line. No cycles, no branching — which
// is exactly why it needs no orchestration framework yet. When the eval forces
// loops (query rewriting / self-correction), THAT is when v2 + LangGraph begin.
export async function answerQuestion(
  question: string,
  deps: RagDeps,
): Promise<RagResult> {
  const {
    embedder,
    store,
    generator,
    reranker = new IdentityReranker(),
    topK = 5,
  } = deps;
  const [queryVector] = await embedder.embed([question]);
  const retrieved = await store.query(queryVector, topK);
  const ranked = await reranker.rerank(question, retrieved);
  const answer = await generator.generate(question, ranked);
  return { answer, retrieved: ranked };
}

// Selects implementations from env, so the same pipeline runs as a zero-dep
// skeleton (default) or against Ollama. This is the seam doing its job.
export function defaultDeps(): RagDeps {
  const embedder: Embedder =
    process.env.EMBEDDER === 'ollama'
      ? new OllamaEmbedder()
      : new MockEmbedder();
  const generator: Generator =
    process.env.GENERATOR === 'ollama'
      ? new OllamaGenerator()
      : new MockGenerator();
  // Reranker defaults to identity (passthrough). A lexical reranker exists behind
  // RERANKER=lexical, but A/B showed it REGRESSES vs feeding the wide topK at 20
  // (it truncates out gold chunks; keyword overlap isn't discriminative when a
  // phrase repeats across subsidiary tables). Kept as a documented negative result.
  const reranker: Reranker =
    process.env.RERANKER === 'lexical'
      ? new LexicalReranker()
      : new IdentityReranker();
  return {
    embedder,
    store: new InMemoryVectorStore(),
    generator,
    reranker,
    topK: Number(process.env.TOP_K ?? 5),
  };
}
