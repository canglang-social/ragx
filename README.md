# ragx

A Retrieval-Augmented Generation (RAG) system that answers questions about **financial filings** with cited, verifiable answers — and **measures its own quality** with an eval set.

## Why this project is built the way it is

- **Eval-driven.** Quality is a number, not a vibe. `npm run eval` reports retrieval hit@k and answer accuracy, so every change is justified by a measured delta.
- **Swappable seams.** Embedder / vector store / generator / reranker are interfaces. Switching models or stores is a one-file change, not a rewrite.
- **Lean by default.** No orchestration framework, no extra services until the eval proves the simpler version fails.

## Quick start

Requires [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm ingest    # builds the index from sample data (uses a zero-dependency mock embedder)
pnpm eval      # prints the quality table
pnpm dev       # open http://localhost:3000 and ask a question
```

By default it runs with **no external dependencies** (mock embedder + in-memory store + mock generator) so the whole pipeline walks end-to-end immediately. Swap in real components per the roadmap.

## Architecture

```
Ingestion:  docs -> chunk(+page metadata) -> Embedder -> VectorStore
Query:      question -> Embedder -> VectorStore.query -> Reranker -> Generator -> Answer + citations
```

See [docs/DESIGN.md](docs/DESIGN.md) for the full spec and roadmap.

## Eval results

Eval set: **6 cases** — 3 from a synthetic clean fixture + 3 from a real 152-page
Berkshire Hathaway 2023 annual report. Local pipeline: `nomic-embed-text` (Ollama)
+ `llama3`, with numeric/unit-tolerant answer matching. Reproduce with
`pnpm ingest:ollama && pnpm eval:ollama` (requires Ollama).

| Pipeline | Retrieval hit | Answer accuracy |
| --- | --- | --- |
| retrieve 5, identity | 0.67 | 0.67 |
| retrieve 10, identity | 0.67 | 0.67 |
| **retrieve 20, identity** _(shipped)_ | **0.83** | **0.83** |
| retrieve 40, identity | 0.83 | 0.67 |
| retrieve 20, lexical rerank → 5 | 0.50 | 0.67 |

What the numbers say (each change justified by its delta):

- **Retrieval breadth 5 → 20 lifted both metrics** — the gold chunk for the net-earnings question ranks ~6–20 by vector similarity, so a wider fetch is what put it in front of the generator.
- **40 hurt answers** — more context means more distractor passages; the generator was pulled off a previously-correct answer.
- **A lexical reranker regressed** (kept behind `RERANKER=lexical` as a documented negative result): truncating back to 5 drops the gold chunk, and keyword overlap can't single it out when the phrase repeats across many subsidiary tables.
- **The one remaining miss is a recall failure** — that chunk isn't retrieved even at 40. That's an index-time problem (chunking / hybrid search), which no amount of reranking can fix.

> Earlier milestones (real-PDF ingestion, a chunker bug that severed decimals, the real grounded generator, numeric matching) are in the commit history and [TODO.md](TODO.md). Next: grow the eval set to 30–50 cases and attack the recall miss.
