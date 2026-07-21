# ragx

A Retrieval-Augmented Generation (RAG) system that answers questions about **financial filings** with cited, verifiable answers — and **measures its own quality** with an eval set.

**▶ Live demo: [ragx.felixhan.dev](https://ragx.felixhan.dev)** (GKE Autopilot · [mirror on Vercel](https://ragx-rosy.vercel.app/)) &nbsp;·&nbsp; Cross-document Q&A over **five filings** (Berkshire · JPMorgan · Microsoft · Costco + a synthetic fixture), with proven no-hallucination on out-of-corpus questions. The deployed **v2 stack** — hybrid retrieval + query decomposition + a cross-encoder reranker + LLM table-row descriptions — scores **retrieval 0.97 · answer 0.98** on a 45-case stress test, up from a 0.63 / 0.78 single-vector baseline. &nbsp;·&nbsp; **[Live eval dashboard →](https://ragx-rosy.vercel.app/eval)**

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

| Stack (45-case eval · pgvector + DeepSeek generator)                                                                                      | Retrieval        | Answer           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------- |
| **Deployed v2** — SiliconFlow Qwen3-Embedding-8B + Qwen3-Reranker-8B, hybrid (RRF) + query decomposition + **LLM table-row descriptions** | **0.97** (39/40) | **0.98** (44/45) |
| Jina v3 + Jina reranker, no descriptions (the prior deployed stack)                                                                       | 0.82 (33/40)     | 0.98 (44/45)     |
| v1 baseline — single query vector                                                                                                         | 0.63 (25/40)     | 0.78 (35/45)     |

The 0.82 → 0.97 jump is the **table-row descriptions** (see the bullets below): a
financial-statement row like `Total assets 3,875,393` is number-soup no embedder ranks,
so an LLM rewrites each into a search-friendly sentence that's embedded in its place —
the raw row is kept for grounding. The embedder/reranker are env-switched (the same code
runs Jina, SiliconFlow, or local Ollama). (The earlier v1 demo — a narrower 20-case,
Berkshire-only set — scored 0.94 / 1.00; v2 trades that for **breadth**: five filings and
cross-document Q&A, honestly measured on harder cases.)

Reproduce with two presets — `pnpm ingest:local && pnpm eval:local` (Ollama,
in-memory — offline) or `pnpm ingest:deployed && pnpm eval:deployed` (Jina + DeepSeek

- pgvector — the production stack). Everything else is an **env composition** (the
  seams are all env-switched), so the script names stay few while any config is reachable:

| Knob          | env                                                                                    | values                                                                                                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| embedder      | `EMBEDDER` · `EMBED_MODEL` · `EMBED_BASE_URL`                                          | `ollama` (`nomic-embed-text`, `qwen3-embedding:0.6b`) · `openai` (Jina, etc.)                                                                                                                                                                                             |
| generator     | `GENERATOR` · `GEN_MODEL` · `GEN_BASE_URL`                                             | `ollama` (`llama3`) · `openai` (DeepSeek, Groq, …)                                                                                                                                                                                                                        |
| store         | `VECTOR_STORE` · `PG_TABLE`                                                            | unset = in-memory · `pg` = pgvector (the live index); `PG_TABLE` selects the table — a rebuilt index lands in a new table for a zero-downtime cutover                                                                                                                     |
| retrieval     | `RETRIEVER` · `RRF_VECTOR_WEIGHT`                                                      | unset = vector-only · `hybrid` = BM25 + vector fused by Reciprocal Rank Fusion (vector weighted `1.2`× by default — tuned)                                                                                                                                                |
| query planner | `PLANNER`                                                                              | unset = single query · `llm` = decompose a multi-entity question into per-entity sub-queries, retrieve each, merge (the cross-document fix)                                                                                                                               |
| reranker      | `RERANKER` · `RERANK_BASE_URL` · `RERANK_MODEL` · `RERANK_CANDIDATES` · `RERANK_TOP_N` | `crossencoder` = a hosted cross-encoder over a wide set — **vendor-neutral** (Jina, SiliconFlow `Qwen3-Reranker`, Cohere…) via `RERANK_BASE_URL`/`RERANK_MODEL`, like `EMBEDDER=openai` — **the v2 win** · `lexical` (shelved negative). (`jina` is a back-compat alias.) |
| chunking      | `CHUNK_CHARS`                                                                          | default 350 (embedder-dependent — see embedder-comparison.md)                                                                                                                                                                                                             |
| eval subset   | `EVAL_ONLY` · `EVAL_FILTER`                                                            | e.g. `q038,q039` — don't re-run stable cases                                                                                                                                                                                                                              |
| eval logging  | `EVAL_LOG` · `EVAL_NOTE` · `EVAL_LABEL`                                                | `EVAL_LOG=1` records the run to `/eval`                                                                                                                                                                                                                                   |

For the four-filing stress test, add the other PDFs from [SOURCES.md](data/pdfs/SOURCES.md),
ingest with the hosted embedder in-memory (`EMBEDDER=openai … npx tsx scripts/ingest.ts`,
no `VECTOR_STORE=pg`), then eval. In-China hosted calls need `NODE_USE_ENV_PROXY=1
NO_PROXY=localhost,127.0.0.1` (add `,api.deepseek.com` so DeepSeek goes direct).

- ✅ **No hallucination** — all 3 _absent_ cases pass: asked about crypto / bitcoin / an employee count not in the filings, the system answers _"I don't know."_
- **The stronger hosted embedder (Jina v3) lifted retrieval 0.82 → 0.94**, resolving most of the recall misses the local stack exposed (a fact retrieved for one year-phrasing but not another; a figure buried in a dense table); the hosted DeepSeek generator answers all 20 demo cases (1.00). One retrieval miss remains (q008, shareholders' equity ranks ~77) — answered correctly anyway, which is exactly why retrieval, not answer accuracy, is the metric to trust on well-known companies.
- **A 45-case stress test over four filings earns the v2 decision.** Beyond the demo corpus, the eval now spans Berkshire + JPMorgan + Microsoft + Costco (~10k chunks) with cross-document comparison and company-disambiguation cases — see [data/pdfs/SOURCES.md](data/pdfs/SOURCES.md). With the deployed-grade embedder (Jina v3 + DeepSeek, retrieve 20): single-corpus retrieval holds (Berkshire ~20/21), but **cross-document comparison is structurally unservable by single-shot top-k retrieval — 0/6.** A single query vector for "compare A and B" collapses onto one filing, so the other's figure is never retrieved; **no embedder fixes this** (qwen-0.6b and Jina v3 both 0/6). The fix is query decomposition → per-entity retrieval, i.e. **v2 / agentic retrieval, now earned on evidence, not vibes.** Big-filing single-fact retrieval, by contrast, is _recoverable_ with a stronger embedder (qwen 0.47 → Jina 0.63, same generator), so that part is an embedder/reranking concern, not architecture.
- **Measured: hybrid (BM25+vector, RRF) + query decomposition lift retrieval 0.63 → 0.72 and answer 0.78 → 0.82** (A/B'd on `/eval`), grounding cross-document cases (e.g. _Microsoft vs JPMorgan net income_) that were 0/6. The two are **complementary**: hybrid _alone_ is a wash, but it makes the buried figure retrievable — which is exactly what then lets decomposition ground the comparison. Fusing by **rank** (RRF) took one measured tuning pass: plain RRF let the noisier BM25 list demote two vector-strong cases, so vector is weighted **1.2×** in the fusion — a rank probe showed that recovers one (q017) while preserving the BM25 _recall_ rescues the cross-doc cases depend on (a vector-floor was tried and rejected — it crowded those rescues out). Behind `RETRIEVER=hybrid` / `PLANNER=llm`, off by default. The remaining misses (a figure stranded in a split table row) are a **chunking** lever, not retrieval.
- **That chunking lever, measured: contextual retrieval + a cross-encoder reranker lift retrieval 0.72 → 0.85 and answer 0.82 → 0.87** — the largest single jump. Bare table rows ("Total revenue 242,290") name neither their company nor their statement, so both retrievers miss them (BM25 ranked a _different_ filing #1 for "Costco total revenue"). Prepending a compact `company — year — section` header **to the embedding + BM25 index only** restores recall (the gold's vector rank went 286 → 6); a Jina cross-encoder then reranks a wide candidate set down to the fed top-20, fixing the _rank_ that the prefix's within-document homogenization crowded. The decisive detail: the header is kept **out** of the text the reranker and generator read — they see the raw window. (Prefix-in-the-text was a wash; reranking _that_ was a wash; only the **separation** — embed/BM25 see context, rerank/generate see raw — wins, +0.125 retrieval.) Each layer is A/B'd on `/eval`; behind `RERANKER=crossencoder`, off by default.
- **The table-row frontier, cracked: LLM row descriptions lift retrieval 0.85 → 0.97.** Even with the contextual header + reranker, a statement row like `Total assets 3,875,393` stayed unrankable — JPMorgan's gold sat at vector rank 75–186 in a 365-page filing, and three cases failed in _every_ config. Two table-chunking ideas were measured and **rejected** (row-aligned splitting regressed 0.85→0.75; bare reranking won't promote a number-row). The lever that won is **multi-representation**: at ingest, one LLM call per statement page rewrites each row into a sentence — _"For JPMorgan in 2023, total assets were $3,875,393 million"_ — which is **embedded in the row's place**, while the raw row is kept for grounding and gold matching. It **augments** the window (replacing it regressed — a window the description under-emphasized lost its match). Cross-document queries then rerank each entity against _its own_ sub-query, so a comparison never loses a figure. Validated on a fully-hosted, vendor-swappable stack (SiliconFlow Qwen3-Embedding-8B + Qwen3-Reranker-8B + DeepSeek): **retrieval 0.97, answer 0.98.** Behind `DESCRIBE=1` at ingest.
- **An honest-eval catch — a live query exposed a generator bug _and_ a matcher blind spot.** Asked _"which had higher net income, Microsoft or JPMorgan?"_, the generator retrieved both figures but concluded the wrong company — and the substring matcher **passed it anyway** (a wrong answer naming "Microsoft" as the loser still contains "Microsoft"). Fixed both: the generator prompt now writes each figure and compares them explicitly before concluding (**answer accuracy 0.91 → 0.98**), and free-form cases are graded by an **LLM judge** (`EVAL_JUDGE=llm`) that catches a wrong conclusion the substring check can't. An eval is only as trustworthy as its matcher.
- **Live eval dashboard.** Every `EVAL_LOG=1` run is recorded to Postgres and shown at [`/eval`](https://ragx-rosy.vercel.app/eval): run history, a per-case × per-config grid (cell = retrieval, glyph = answer), and an auto-computed delta vs the previous run — which cases a change _solved_ vs _regressed_. It's how a model-fixable failure is told apart from one that needs an architecture change. (A faithful, fast generator matters here: a model that knows a famous company's numbers from training can pass an answer with _zero_ retrieval, so the dashboard reads retrieval as the honest metric.)

### Deployment

The demo runs on **GKE Autopilot** at [ragx.felixhan.dev](https://ragx.felixhan.dev), built with Docker, Terraform, and Kubernetes. The GCP trial credit expires in ~90 days, so the Vercel deployment is kept as a mirror that outlives it.

#### trigger

- Any **push** triggers the deployment, except changes under `terraform/` (infrastructure changes alter neither the application image nor the k8s manifests) and `**.md` (docs don't change what the site serves).
- A manual **`workflow_dispatch`** run from the Actions tab — for redeploying when no code has changed, e.g. after a credential rotation.

#### terraform

Terraform is applied **by hand, not in CI** — infrastructure changes deserve a human reading the plan. The IaC is reproducible, but not continuously deployed.

```
terraform validate && terraform plan
# read the plan — confirm "0 to destroy" before continuing
terraform apply
```

#### Flow

One `git push` runs the whole chain, and it stops at the first failure:

- **Google Cloud auth** — GitHub mints an OIDC token, GCP exchanges it for a ~1h credential
- **Google Cloud SDK** — sets up `gcloud` and the Docker credential helper
- **Image build and push** — tagged with the git commit SHA, never `:latest`, so the Deployment spec actually changes and Kubernetes performs a rollout
- **pnpm and node** — install the eval harness dependencies
- **Eval gate** — the 45-case eval must clear its thresholds, or the job stops here and production keeps serving the old version
- **GKE credentials** — fetch cluster access
- **k8s apply and rollout** — substitute the image tag, `kubectl apply -f k8s/`, then block until the new pods pass readiness

#### Design decisions"

1. Q: Why is there no service-account key anywhere?
   A: Workload Identity Federation. When a workflow runs, GitHub mints a short-lived OIDC token that cryptographically asserts "this run is from repo canglang-social/ragx." GCP is configured to trust GitHub's issuer, with an attribute condition restricting the trust to that exact repository, and exchanges a valid token for a credential that expires in about an hour. So no key is ever created — there is nothing to leak, nothing to rotate, and nothing to find in a compromised secret store. Without that attribute condition, you'd be trusting every GitHub Actions run on the internet.
2. Q: Why does the eval gate exist and what does it actually prove?
   A: Every deploy checks retrieval hit@k and answer accuracy against a 0.90 floor; below either, the gate stops the deploy and production keeps the old version — a change that lowers the eval score never reaches users. The threshold sits at 0.90 rather than at today's score because LLM generation varies run to run, and a gate that cries wolf gets disabled. What it proves is bounded: the eval runs against the source the image was built from, in the CI runner's Node, not inside the container. So it proves the code is good, not that the container is intact — a small risk, since the image is built deterministically from that same commit.
3. Q: Why timeoutSec: 120?
   A: The app runs in `us-east4` on Google Cloud, but nothing else does: Postgres is Neon in `us-east-1`, and both embedding (SiliconFlow) and generation (DeepSeek) run in China. Every retrieval, rerank, and generation call is a cross-region round trip, so the latency is network-bound, not compute-bound — measured at **22–78s** on cross-document queries. GCP's load balancer defaults to a 30s backend timeout, which would cut off the hardest queries mid-flight and surface as a `502` that looks like a crash. Raised to 120s.
4. Q: What's not good enough yet?
   A: The HPA scales on CPU, which is the wrong signal for this service. A query spends its 22–78s waiting on network I/O, so a pod can be saturated with concurrent work while CPU sits near 1% — the autoscaler will not fire under the load that actually matters. The right metric is concurrent requests or queue depth via Cloud Monitoring custom metrics. Shipped as-is because `minReplicas: 1` keeps the idle cost at one pod and the ceiling costs nothing until traffic justifies it.

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
