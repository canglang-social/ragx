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
interface Embedder   { name; dim; embed(texts: string[], kind?: "query"|"document"): Promise<number[][]>; }
interface VectorStore{ upsert(entries): Promise<void>; query(vec, topK): Promise<RetrievedChunk[]>; reset(); close?(); }
interface Generator  { name; generate(question, context): Promise<Answer>; }
interface Reranker   { name; rerank(question, chunks): Promise<RetrievedChunk[]>; }
```

(`kind` carries the query/document asymmetry — measured-neutral on this eval, off by default, but the seam is the right shape. v2 adds a fifth seam, `Planner` — see the roadmap.)

`Answer = { text, citations: {sourceDoc, page}[] }`. Citations are non-negotiable: an uncited answer is a failed answer.

## Eval spec (the executable part of this spec)

`eval/questions.sample.json` defines expected behavior. Two metrics, reported by `npm run eval`:

- **Retrieval hit@k**: did the gold chunk(s) reach the top-k — matched by `sourceDoc` + a distinctive `gold_chunk_contains` substring (and `source_page` when that substring recurs across pages)? Cross-document cases list multiple `gold_chunks` and require **all** of them retrieved (a comparison isn't grounded if only one figure was found). (Measures the retriever.)
- **Answer accuracy**: does the generated answer match `expected_answer` (numeric/unit-tolerant for `answer_type:"numerical"`; a refusal for `absent` cases)? (Measures the generator, given good retrieval.)

Separating the two metrics is deliberate: it tells you *where* a failure is (retrieval vs generation), which is what you tune.

## Roadmap & the signals that trigger each step

| Version | Scope | Status / trigger |
| --- | --- | --- |
| v0 | Skeleton: mock embedder/generator, in-memory store, dummy doc | ✅ done |
| v1 | Real PDFs via unpdf (PaddleOCR **not needed** — text layers were clean), Ollama + hosted Jina embeddings, pgvector on Neon, hosted DeepSeek LLM (v1 shipped on Groq; unified on DeepSeek 2026-06-20), **45 eval cases over 4 filings**, deploy + an `/eval` dashboard | ✅ shipped & deployed (20-case demo 0.94 / 1.00; 45-case stress test on `/eval`) |
| v2 | Agentic retrieval. **Trigger fired:** cross-document comparison is 0/6 — a single query vector can't reach two filings (embedder-independent). First step: **query decomposition** (a `Planner` seam → per-entity sub-queries → merge) — one branch, **not** a loop, so still no LangGraph; that waits for true cycles (self-correction / re-query). | in progress |

The roadmap is signal-driven, not calendar-driven. Each step is justified by a number the previous step produced. v2's decomposition fixes cross-document *reach*; the remaining cross-doc misses are within-document single-fact retrieval gaps (the parallel v1.5 lever: reranking / hybrid lexical+vector — see [TODO.md](../TODO.md) B9).

Granular, check-off-able v1 tasks live in [TODO.md](../TODO.md) — kept separate so this design doc stays stable.
