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
| v2 | Agentic retrieval. **Trigger fired:** cross-document comparison was 0/6 — a single query vector can't reach two filings. Fix: **query decomposition** (`Planner` seam → per-entity sub-queries → merge) + **hybrid BM25+vector retrieval** (RRF) to surface buried figures. One branch, not a loop — no LangGraph yet (waits for true cycles). **Measured: retrieval 0.63→0.85, answer 0.78→0.87.** Built in signal-driven layers: decomposition grounds cross-doc (was 0/6); hybrid surfaces buried figures (a wash alone — its value is unlocked by decomposition); RRF weights vector 1.2× (tuned on a rank probe); then **contextual retrieval + a cross-encoder reranker** (the largest jump, 0.72→0.85) — a `company — year — section` header on the embedding/BM25 text fixes table-row recall, and a Jina reranker over a wide candidate set fixes rank. The reranker reads the RAW chunk, not the header (separation matters: prefix-in-text and reranking-the-prefixed-text were each a wash; only the split wins). | validated on eval; off by default. Prod enablement pending (4-filing pg ingest + pg FTS for hybrid + reranker call/query). |

The roadmap is signal-driven, not calendar-driven. Each step is justified by a number the previous step produced. v2's decomposition fixes cross-document *reach*; the remaining cross-doc misses are within-document single-fact retrieval gaps (the parallel v1.5 lever: reranking / hybrid lexical+vector — see [TODO.md](../TODO.md) B9).

Granular, check-off-able v1 tasks live in [TODO.md](../TODO.md) — kept separate so this design doc stays stable.
