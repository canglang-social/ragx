import { MockEmbedder, OllamaEmbedder, type Embedder } from './embedder';
import { InMemoryVectorStore, type VectorStore } from './vectorStore';
import { MockGenerator, type Generator } from './generator';
import { IdentityReranker, type Reranker } from './reranker';
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
  return {
    embedder,
    store: new InMemoryVectorStore(),
    generator: new MockGenerator(),
    topK: Number(process.env.TOP_K ?? 5),
  };
}
