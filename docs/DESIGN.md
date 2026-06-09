# ragx — Design Spec (lightweight SDD)

This is the *contract* the code implements. Spec-Driven Development here = this doc + an executable eval set. Update this doc when a decision changes; it is the durable record so future work doesn't drift.

## Problem

Answer factual questions about financial filings (annual reports / 10-Ks) with **cited, verifiable** answers. Financial data is chosen because correct answers are unambiguous (numbers), which makes the eval set credible.

## Non-goals (v0/v1)

- Not a chatbot personality, not multi-turn memory.
- Not high-concurrency / load-tested yet (a deployment concern for later, not a v0 blocker).
- Not an agent framework. The query flow is a straight line until the eval proves it must branch.

## Contracts (the four seams)

All in `src/core/`. Everything else depends on these interfaces, not on concrete vendors.

```ts
interface Embedder   { embed(texts: string[]): Promise<number[][]>; }
interface VectorStore{ upsert(chunks, vectors): Promise<void>; query(vec, topK): Promise<RetrievedChunk[]>; }
interface Generator  { generate(question, context): Promise<Answer>; }
interface Reranker   { rerank(question, chunks): Promise<RetrievedChunk[]>; }
```

`Answer = { text, citations: {sourceDoc, page}[] }`. Citations are non-negotiable: an uncited answer is a failed answer.

## Eval spec (the executable part of this spec)

`eval/questions.sample.json` defines expected behavior. Two metrics, reported by `npm run eval`:

- **Retrieval hit@k**: did a chunk on `source_page` containing `gold_chunk_contains` appear in the top-k? (Measures the retriever.)
- **Answer accuracy**: does the generated answer contain `expected_answer`? (Measures the generator, given good retrieval.)

Separating the two metrics is deliberate: it tells you *where* a failure is (retrieval vs generation), which is what you tune.

## Roadmap & the signals that trigger each step

| Version | Scope | Trigger to start |
| --- | --- | --- |
| v0 | Skeleton: mock embedder/generator, in-memory store, dummy doc | now |
| v1 | Real PDFs + PaddleOCR, Ollama embeddings, pgvector, real LLM, 30–50 eval cases, deploy | skeleton walks end-to-end |
| v2 | Agentic RAG: query rewriting, multi-hop retrieval, self-correction loop (LangGraph.js) | eval shows the linear baseline failing on hard, multi-fact questions |

The roadmap is signal-driven, not calendar-driven. Each step is justified by a number the previous step produced.

Granular, check-off-able v1 tasks live in [TODO.md](../TODO.md) — kept separate so this design doc stays stable.
