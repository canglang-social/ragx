# ragx

A Retrieval-Augmented Generation (RAG) system that answers questions about **financial filings** with cited, verifiable answers — and **measures its own quality** with an eval set.

**▶ Live demo: https://ragx-rosy.vercel.app/** &nbsp;·&nbsp; Eval (20 cases): **retrieval 0.94 · answer 0.95**, with proven no-hallucination on out-of-corpus questions.

## Why this project is built the way it is

- **Eval-driven.** Quality is a number, not a vibe. `pnpm eval` reports retrieval hit@k and answer accuracy, so every change is justified by a measured delta.
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

See [docs/DESIGN.md](docs/DESIGN.md) for the full spec and roadmap. Also:
[principles.md](docs/principles.md) (the reasoning rules, tagged hard/convention/project) and
[eval-case-studies.md](docs/eval-case-studies.md) (per-case diagnosis → fix).

## Eval results

Eval set: **20 cases** over a synthetic fixture + a real 152-page Berkshire
Hathaway 2023 filing — 17 grounded (single-fact, multi-fact, free-form) + 3
_absent_ (answer is in no doc; the system must refuse, not invent). Numeric/
unit-tolerant matching.

| Stack                                                                      | Retrieval hit@20 | Answer accuracy  |
| -------------------------------------------------------------------------- | ---------------- | ---------------- |
| **Deployed** — Jina `jina-embeddings-v3` + Groq `llama-3.3-70b` + pgvector | **0.94** (16/17) | **0.95** (19/20) |
| Local dev — `nomic-embed-text` + `llama3`, in-memory                       | 0.82 (14/17)     | 0.85 (17/20)     |

Reproduce: `pnpm ingest:hosted && pnpm eval:hosted` (deployed stack) or `pnpm ingest:ollama && pnpm eval:ollama` (local).

- ✅ **No hallucination** — all 3 _absent_ cases pass: asked about crypto / bitcoin / an employee count not in the filings, the system answers _"I don't know."_
- **The stronger hosted embedder (Jina v3) lifted retrieval 0.82 → 0.94**, resolving most of the recall misses the local stack exposed (a fact retrieved for one year-phrasing but not another; a figure buried in a dense table); the larger 70b generator lifted answers to 0.95. One retrieval miss + one answer miss remain.
- The remaining hard class is **multi-hop reasoning** (e.g. compute a year-over-year difference) — the first concrete signal for agentic/multi-step RAG (v2).

### How we tuned the pipeline (6-case progression)

| Pipeline                                         | Retrieval hit | Answer accuracy |
| ------------------------------------------------ | ------------- | --------------- |
| 800-char chunks, retrieve 5                      | 0.67          | 0.67            |
| 800-char chunks, retrieve 20                     | 0.83          | 0.83            |
| 800-char chunks, retrieve 40                     | 0.83          | 0.67            |
| 800-char chunks, retrieve 20, lexical rerank → 5 | 0.50          | 0.67            |
| 350-char chunks, retrieve 20 _(shipped)_         | 1.00          | 1.00            |

- **Breadth 5 → 20** lifted both metrics — the net-earnings gold chunk ranks ~6–20 by vector, so a wider fetch put it in front of the generator.
- **40 hurt answers** — more context = more distractors; the generator was pulled off a correct answer.
- **A lexical reranker regressed** (kept behind `RERANKER=lexical` as a documented negative result): truncating to 5 drops the gold chunk, and keyword overlap can't single it out when a phrase repeats across subsidiary tables.
- **800 → 350-char chunks** fixed the diluted-float miss (it had ranked 52/1008 inside a reinsurance-jargon window). Tune via `CHUNK_CHARS`.

> The 6-case set scored 1.00 on this config — which is exactly why it was untrustworthy. Growing to 20 (incl. multi-fact + refusal) dropped it to an honest 0.82 / 0.85 and surfaced the three failures above. Earlier milestones (real-PDF ingestion, a decimal-severing chunker bug, the grounded generator, numeric matching) are in the commit history and [TODO.md](TODO.md).

See [docs/eval-case-studies.md](docs/eval-case-studies.md) for a per-case diagnosis → fix walkthrough of q001–q006 (each failure isolated to retrieval vs generation, then fixed and re-measured).
