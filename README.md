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

| Metric | Score |
| --- | --- |
| Retrieval hit@5 | _run `pnpm eval`_ |
| Answer accuracy | _run `pnpm eval`_ |

> Sample data is a tiny dummy filing with 3 eval cases. Replace with real 10-Ks and grow the eval set to 30–50 cases (v1).
