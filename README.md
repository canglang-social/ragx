# ragx

A Retrieval-Augmented Generation (RAG) system that answers questions about **financial filings** with cited, verifiable answers — and **measures its own quality** with an eval set.

**▶ Live demo: https://ragx-rosy.vercel.app/** &nbsp;·&nbsp; Cross-document Q&A over **five filings** (Berkshire · JPMorgan · Microsoft · Costco + a synthetic fixture), with proven no-hallucination on out-of-corpus questions. The deployed **v2 stack** — hybrid retrieval + query decomposition + a cross-encoder reranker + LLM table-row descriptions — scores **retrieval 0.97 · answer 0.98** on a 45-case stress test, up from a 0.63 / 0.78 single-vector baseline. &nbsp;·&nbsp; **[Live eval dashboard →](https://ragx-rosy.vercel.app/eval)**

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

The **deployed** eval: **45 cases** over five filings (a synthetic fixture +
Berkshire / JPMorgan / Microsoft / Costco) — grounded single-fact, multi-fact, and
**cross-document comparison** cases, plus _absent_ cases (the answer is in no doc; the
system must refuse, not invent). Numeric/unit-tolerant matching. Two metrics, kept
separate so a failure points at retrieval vs generation.

| Stack (45-case eval · pgvector + DeepSeek generator) | Retrieval | Answer |
| ---------------------------------------------------- | --------- | ------ |
| **Deployed v2** — SiliconFlow Qwen3-Embedding-8B + Qwen3-Reranker-8B, hybrid (RRF) + query decomposition + **LLM table-row descriptions** | **0.97** (39/40) | **0.98** (44/45) |
| Jina v3 + Jina reranker, no descriptions (the prior deployed stack)                                                                       | 0.82 (33/40)     | 0.98 (44/45)     |
| v1 baseline — single query vector                                                                                                          | 0.63 (25/40)     | 0.78 (35/45)     |

The 0.82 → 0.97 jump is the **table-row descriptions** (see the bullets below): a
financial-statement row like `Total assets 3,875,393` is number-soup no embedder ranks,
so an LLM rewrites each into a search-friendly sentence that's embedded in its place —
the raw row is kept for grounding. The embedder/reranker are env-switched (the same code
runs Jina, SiliconFlow, or local Ollama). (The earlier v1 demo — a narrower 20-case,
Berkshire-only set — scored 0.94 / 1.00; v2 trades that for **breadth**: five filings and
cross-document Q&A, honestly measured on harder cases.)

Reproduce with two presets — `pnpm ingest:local && pnpm eval:local` (Ollama,
in-memory — offline) or `pnpm ingest:deployed && pnpm eval:deployed` (Jina + DeepSeek
+ pgvector — the production stack). Everything else is an **env composition** (the
seams are all env-switched), so the script names stay few while any config is reachable:

| Knob | env | values |
| --- | --- | --- |
| embedder | `EMBEDDER` · `EMBED_MODEL` · `EMBED_BASE_URL` | `ollama` (`nomic-embed-text`, `qwen3-embedding:0.6b`) · `openai` (Jina, etc.) |
| generator | `GENERATOR` · `GEN_MODEL` · `GEN_BASE_URL` | `ollama` (`llama3`) · `openai` (DeepSeek, Groq, …) |
| store | `VECTOR_STORE` · `PG_TABLE` | unset = in-memory · `pg` = pgvector (the live index); `PG_TABLE` selects the table — a rebuilt index lands in a new table for a zero-downtime cutover |
| retrieval | `RETRIEVER` · `RRF_VECTOR_WEIGHT` | unset = vector-only · `hybrid` = BM25 + vector fused by Reciprocal Rank Fusion (vector weighted `1.2`× by default — tuned) |
| query planner | `PLANNER` | unset = single query · `llm` = decompose a multi-entity question into per-entity sub-queries, retrieve each, merge (the cross-document fix) |
| reranker | `RERANKER` · `RERANK_CANDIDATES` · `RERANK_TOP_N` | `jina` = cross-encoder reranks a wide candidate set (`RERANK_CANDIDATES`, default 50) down to `RERANK_TOP_N` — **the v2 win** · `lexical` (shelved negative) |
| chunking | `CHUNK_CHARS` | default 350 (embedder-dependent — see embedder-comparison.md) |
| eval subset | `EVAL_ONLY` · `EVAL_FILTER` | e.g. `q038,q039` — don't re-run stable cases |
| eval logging | `EVAL_LOG` · `EVAL_NOTE` · `EVAL_LABEL` | `EVAL_LOG=1` records the run to `/eval` |

For the four-filing stress test, add the other PDFs from [SOURCES.md](data/pdfs/SOURCES.md),
ingest with the hosted embedder in-memory (`EMBEDDER=openai … npx tsx scripts/ingest.ts`,
no `VECTOR_STORE=pg`), then eval. In-China hosted calls need `NODE_USE_ENV_PROXY=1
NO_PROXY=localhost,127.0.0.1` (add `,api.deepseek.com` so DeepSeek goes direct).

- ✅ **No hallucination** — all 3 _absent_ cases pass: asked about crypto / bitcoin / an employee count not in the filings, the system answers _"I don't know."_
- **The stronger hosted embedder (Jina v3) lifted retrieval 0.82 → 0.94**, resolving most of the recall misses the local stack exposed (a fact retrieved for one year-phrasing but not another; a figure buried in a dense table); the hosted DeepSeek generator answers all 20 demo cases (1.00). One retrieval miss remains (q008, shareholders' equity ranks ~77) — answered correctly anyway, which is exactly why retrieval, not answer accuracy, is the metric to trust on well-known companies.
- **A 45-case stress test over four filings earns the v2 decision.** Beyond the demo corpus, the eval now spans Berkshire + JPMorgan + Microsoft + Costco (~10k chunks) with cross-document comparison and company-disambiguation cases — see [data/pdfs/SOURCES.md](data/pdfs/SOURCES.md). With the deployed-grade embedder (Jina v3 + DeepSeek, retrieve 20): single-corpus retrieval holds (Berkshire ~20/21), but **cross-document comparison is structurally unservable by single-shot top-k retrieval — 0/6.** A single query vector for "compare A and B" collapses onto one filing, so the other's figure is never retrieved; **no embedder fixes this** (qwen-0.6b and Jina v3 both 0/6). The fix is query decomposition → per-entity retrieval, i.e. **v2 / agentic retrieval, now earned on evidence, not vibes.** Big-filing single-fact retrieval, by contrast, is *recoverable* with a stronger embedder (qwen 0.47 → Jina 0.63, same generator), so that part is an embedder/reranking concern, not architecture.
- **Measured: hybrid (BM25+vector, RRF) + query decomposition lift retrieval 0.63 → 0.72 and answer 0.78 → 0.82** (A/B'd on `/eval`), grounding cross-document cases (e.g. *Microsoft vs JPMorgan net income*) that were 0/6. The two are **complementary**: hybrid *alone* is a wash, but it makes the buried figure retrievable — which is exactly what then lets decomposition ground the comparison. Fusing by **rank** (RRF) took one measured tuning pass: plain RRF let the noisier BM25 list demote two vector-strong cases, so vector is weighted **1.2×** in the fusion — a rank probe showed that recovers one (q017) while preserving the BM25 *recall* rescues the cross-doc cases depend on (a vector-floor was tried and rejected — it crowded those rescues out). Behind `RETRIEVER=hybrid` / `PLANNER=llm`, off by default. The remaining misses (a figure stranded in a split table row) are a **chunking** lever, not retrieval.
- **That chunking lever, measured: contextual retrieval + a cross-encoder reranker lift retrieval 0.72 → 0.85 and answer 0.82 → 0.87** — the largest single jump. Bare table rows ("Total revenue 242,290") name neither their company nor their statement, so both retrievers miss them (BM25 ranked a *different* filing #1 for "Costco total revenue"). Prepending a compact `company — year — section` header **to the embedding + BM25 index only** restores recall (the gold's vector rank went 286 → 6); a Jina cross-encoder then reranks a wide candidate set down to the fed top-20, fixing the *rank* that the prefix's within-document homogenization crowded. The decisive detail: the header is kept **out** of the text the reranker and generator read — they see the raw window. (Prefix-in-the-text was a wash; reranking *that* was a wash; only the **separation** — embed/BM25 see context, rerank/generate see raw — wins, +0.125 retrieval.) Each layer is A/B'd on `/eval`; behind `RERANKER=jina`, off by default.
- **The table-row frontier, cracked: LLM row descriptions lift retrieval 0.85 → 0.97.** Even with the contextual header + reranker, a statement row like `Total assets 3,875,393` stayed unrankable — JPMorgan's gold sat at vector rank 75–186 in a 365-page filing, and three cases failed in *every* config. Two table-chunking ideas were measured and **rejected** (row-aligned splitting regressed 0.85→0.75; bare reranking won't promote a number-row). The lever that won is **multi-representation**: at ingest, one LLM call per statement page rewrites each row into a sentence — *"For JPMorgan in 2023, total assets were $3,875,393 million"* — which is **embedded in the row's place**, while the raw row is kept for grounding and gold matching. It **augments** the window (replacing it regressed — a window the description under-emphasized lost its match). Cross-document queries then rerank each entity against *its own* sub-query, so a comparison never loses a figure. Validated on a fully-hosted, vendor-swappable stack (SiliconFlow Qwen3-Embedding-8B + Qwen3-Reranker-8B + DeepSeek): **retrieval 0.97, answer 0.98.** Behind `DESCRIBE=1` at ingest.
- **An honest-eval catch — a live query exposed a generator bug *and* a matcher blind spot.** Asked *"which had higher net income, Microsoft or JPMorgan?"*, the generator retrieved both figures but concluded the wrong company — and the substring matcher **passed it anyway** (a wrong answer naming "Microsoft" as the loser still contains "Microsoft"). Fixed both: the generator prompt now writes each figure and compares them explicitly before concluding (**answer accuracy 0.91 → 0.98**), and free-form cases are graded by an **LLM judge** (`EVAL_JUDGE=llm`) that catches a wrong conclusion the substring check can't. An eval is only as trustworthy as its matcher.
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
