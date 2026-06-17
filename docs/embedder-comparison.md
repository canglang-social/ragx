# Embedder comparison

Eval-driven embedder selection. Same pipeline every row — vector store + the 20-case
eval, retrieve 20 — swapping *only* the embedder, so the delta is attributable to it.
The eval picks the winner, not the leaderboard (MTEB is general English; this is
financial-filing retrieval).

**Compare on Retrieval hit@20 — it's generator-independent (the embedder's own metric).**
Answer accuracy depends on the *generator*, so rows with different generators aren't
answer-comparable; it's shown only for context. **Mode**: 🖥 local (Ollama — free, no
network) vs ☁ API (hosted).

| Embedder | Mode | dim | Generator | Retrieval hit@20 | Answer | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `nomic-embed-text` | 🖥 local | 768 | llama3 | 0.82 (14/17) | 0.85 | original baseline; smallest model |
| `qwen3-embedding:0.6b` | 🖥 local | 1024 | llama3 | 0.88 (15/17) | 0.90 | fast (~5s/case); fixed q008, missed q013 + q014 |
| `qwen3-embedding:8b` | 🖥 local | 4096 | llama3 | 0.88 (15/17) | 0.90 | MTEB #5, heavy; fixed q008, missed q013 + q017; **still < Jina v3** (likely protocol-handicapped, below) |
| `jina-embeddings-v3` | ☁ API | 1024 | Groq 70b | **0.94** (16/17) | 0.95 | **shipped / deployed winner**; only miss q008 (equity ranks 77) |
| `jina-embeddings-v5-text-small` | ☁ API | ? | — | _pending_ | — | free tier throttled — paid / later |

**Conclusion: Jina v3 (0.94) wins** — even the heavy MTEB-#5 8b doesn't beat it on this
domain, and it's free + hosted + deployed. The embedder hunt has hit diminishing returns.

**Two findings worth more than the numbers:**

- **MTEB rank ≠ your-eval performance.** General-English leaderboard ≠ financial-filing
  retrieval; the eval is the judge, not the board.
- **Protocol caveat (fairness):** these rows embed query and document **symmetrically,
  no prefix.** Models that expect *asymmetric* query/doc instructions — nomic
  (`search_query:`), qwen3 (`Instruct: …`), Jina (`task=retrieval.query`) — run *below*
  their best here. A fair test needs the `Embedder` interface to distinguish query vs
  document; deferred (low ROI for models that can't deploy).
- **Failures vary by embedder** — q008 / q013 / q014 / q017 move between models. No
  bi-encoder nails all; they're the genuinely hard cases (dense tables, multi-hop).

## Reproduce a row

Same eval, swap the embedder. Experiments use the **in-memory** store (omit
`VECTOR_STORE=pg`) so the deployed demo's Neon index is never touched.

🖥 **local (Ollama):**

```bash
EMBEDDER=ollama EMBED_MODEL=<model> npx tsx scripts/ingest.ts
EMBEDDER=ollama EMBED_MODEL=<model> GENERATOR=ollama GEN_MODEL=llama3 TOP_K=20 npx tsx eval/run-eval.ts
```

☁ **API (hosted, OpenAI-protocol):**

```bash
NODE_USE_ENV_PROXY=1 NO_PROXY=localhost,127.0.0.1 \
  EMBEDDER=openai EMBED_BASE_URL=<provider /v1> EMBED_MODEL=<model> npx tsx scripts/ingest.ts
# eval: also set GENERATOR=openai GEN_BASE_URL=https://api.groq.com/openai/v1 \
#       GEN_MODEL=llama-3.3-70b-versatile TOP_K=20
# (export EMBED_API_KEY / GEN_API_KEY; add VECTOR_STORE=pg only to write the live index)
```
