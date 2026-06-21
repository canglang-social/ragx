# ragx

A Retrieval-Augmented Generation (RAG) system that answers questions about **financial filings** with cited, verifiable answers — and **measures its own quality** with an eval set.

**▶ Live demo: https://ragx-rosy.vercel.app/** &nbsp;·&nbsp; Eval (20-case demo): **retrieval 0.94 · answer 1.00**, with proven no-hallucination on out-of-corpus questions (a harder 45-case / 4-filing stress test is below). &nbsp;·&nbsp; **[Live eval dashboard →](https://ragx-rosy.vercel.app/eval)**

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
[principles.md](docs/principles.md) (the reasoning rules, tagged hard/convention/project),
[eval-case-studies.md](docs/eval-case-studies.md) (per-case diagnosis → fix), and
[embedder-comparison.md](docs/embedder-comparison.md) (eval-driven embedder selection).

## Eval results

The **deployed demo's** eval: **20 cases** over a synthetic fixture + a real
152-page Berkshire Hathaway 2023 filing — 17 grounded (single-fact, multi-fact,
free-form) + 3 _absent_ (answer is in no doc; the system must refuse, not invent).
Numeric/unit-tolerant matching. (A larger **45-case, four-filing stress test** —
which is what surfaced the cross-document limit and the v2 decision — is described
in the bullets below and browsable at [`/eval`](https://ragx-rosy.vercel.app/eval).)

| Stack                                                                      | Retrieval hit@20 | Answer accuracy  |
| -------------------------------------------------------------------------- | ---------------- | ---------------- |
| **Deployed** — Jina `jina-embeddings-v3` + DeepSeek `deepseek-chat` + pgvector | **0.94** (16/17) | **1.00** (20/20) |
| Local dev — `nomic-embed-text` + `llama3`, in-memory                          | 0.82 (14/17)     | 0.85 (17/20)     |

Reproduce with two presets — `pnpm ingest:local && pnpm eval:local` (Ollama,
in-memory — offline) or `pnpm ingest:deployed && pnpm eval:deployed` (Jina + DeepSeek
+ pgvector — the production stack). Everything else is an **env composition** (the
seams are all env-switched), so the script names stay few while any config is reachable:

| Knob | env | values |
| --- | --- | --- |
| embedder | `EMBEDDER` · `EMBED_MODEL` · `EMBED_BASE_URL` | `ollama` (`nomic-embed-text`, `qwen3-embedding:0.6b`) · `openai` (Jina, etc.) |
| generator | `GENERATOR` · `GEN_MODEL` · `GEN_BASE_URL` | `ollama` (`llama3`) · `openai` (DeepSeek, Groq, …) |
| store | `VECTOR_STORE` | unset = in-memory · `pg` = pgvector (the live index) |
| chunking | `CHUNK_CHARS` | default 350 (embedder-dependent — see embedder-comparison.md) |
| reranker | `RERANKER` | `jina` · `lexical` (both shelved as measured negatives) |
| eval subset | `EVAL_ONLY` · `EVAL_FILTER` | e.g. `q038,q039` — don't re-run stable cases |
| eval logging | `EVAL_LOG` · `EVAL_NOTE` · `EVAL_LABEL` | `EVAL_LOG=1` records the run to `/eval` |

For the four-filing stress test, add the other PDFs from [SOURCES.md](data/pdfs/SOURCES.md),
ingest with the hosted embedder in-memory (`EMBEDDER=openai … npx tsx scripts/ingest.ts`,
no `VECTOR_STORE=pg`), then eval. In-China hosted calls need `NODE_USE_ENV_PROXY=1
NO_PROXY=localhost,127.0.0.1` (add `,api.deepseek.com` so DeepSeek goes direct).

- ✅ **No hallucination** — all 3 _absent_ cases pass: asked about crypto / bitcoin / an employee count not in the filings, the system answers _"I don't know."_
- **The stronger hosted embedder (Jina v3) lifted retrieval 0.82 → 0.94**, resolving most of the recall misses the local stack exposed (a fact retrieved for one year-phrasing but not another; a figure buried in a dense table); the hosted DeepSeek generator answers all 20 demo cases (1.00). One retrieval miss remains (q008, shareholders' equity ranks ~77) — answered correctly anyway, which is exactly why retrieval, not answer accuracy, is the metric to trust on well-known companies.
- **A 45-case stress test over four filings earns the v2 decision.** Beyond the demo corpus, the eval now spans Berkshire + JPMorgan + Microsoft + Costco (~10k chunks) with cross-document comparison and company-disambiguation cases — see [data/pdfs/SOURCES.md](data/pdfs/SOURCES.md). With the deployed-grade embedder (Jina v3 + DeepSeek, retrieve 20): single-corpus retrieval holds (Berkshire ~20/21), but **cross-document comparison is structurally unservable by single-shot top-k retrieval — 0/6.** A single query vector for "compare A and B" collapses onto one filing, so the other's figure is never retrieved; **no embedder fixes this** (qwen-0.6b and Jina v3 both 0/6). The fix is query decomposition → per-entity retrieval, i.e. **v2 / agentic retrieval, now earned on evidence, not vibes.** Big-filing single-fact retrieval, by contrast, is *recoverable* with a stronger embedder (qwen 0.47 → Jina 0.63, same generator), so that part is an embedder/reranking concern, not architecture.
- **Measured: hybrid (BM25+vector, RRF) + query decomposition lift retrieval 0.63 → 0.70 and answer 0.78 → 0.82** (A/B'd on `/eval`), grounding cross-document cases (e.g. *Microsoft vs JPMorgan net income*) that were 0/6. The two are **complementary**: hybrid *alone* is a wash, but it makes the buried figure retrievable — which is exactly what then lets decomposition ground the comparison. Behind `RETRIEVER=hybrid` / `PLANNER=llm`, off by default. Remaining misses (a figure stranded in a split table row) are a **chunking** lever, not retrieval.
- **Live eval dashboard.** Every `EVAL_LOG=1` run is recorded to Postgres and shown at [`/eval`](https://ragx-rosy.vercel.app/eval): run history, a per-case × per-config grid (cell = retrieval, glyph = answer), and an auto-computed delta vs the previous run — which cases a change *solved* vs *regressed*. It's how a model-fixable failure is told apart from one that needs an architecture change. (A faithful, fast generator matters here: a model that knows a famous company's numbers from training can pass an answer with *zero* retrieval, so the dashboard reads retrieval as the honest metric.)

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
