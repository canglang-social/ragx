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
| `nomic-embed-text` + query/doc prefixes | 🖥 local | 768 | llama3 | 0.71 (12/17) | 0.75 | `search_query:`/`search_document:` **REGRESSED** vs symmetric 0.82 — asymmetry hurt as applied (Ollama nomic likely handles prefixes differently than HF). Lever shelved. |
| `qwen3-embedding:0.6b` | 🖥 local | 1024 | llama3 | 0.88 (15/17) | 0.90 | fast (~5s/case); fixed q008, missed q013 + q014 |
| `qwen3-embedding:0.6b` + query instruction | 🖥 local | 1024 | llama3 | 0.88 (15/17) | 0.90 | qwen's `Instruct: …Query:` on the query — **net-neutral** (fixed q014, broke q017); asymmetry just shuffled misses |
| `qwen3-embedding:8b` | 🖥 local | 4096 | llama3 | 0.88 (15/17) | 0.90 | MTEB #5, heavy; fixed q008, missed q013 + q017; **still < Jina v3** (likely protocol-handicapped, below) |
| `jina-embeddings-v3` | ☁ API | 1024 | DeepSeek | **0.94** (16/17) | 1.00 | **shipped / deployed embedder**; deploy generator unified on DeepSeek (was Groq 70b, 0.95); only retrieval miss q008 (equity ranks 77) |
| `jina-embeddings-v5-text-small` | ☁ API | ? | — | _pending_ | — | free tier throttled — paid / later |

**Conclusion: Jina v3 (0.94) wins** — even the heavy MTEB-#5 8b doesn't beat it on this
domain, and it's free + hosted + deployed. The embedder hunt has hit diminishing returns.

**Two findings worth more than the numbers:**

- **MTEB rank ≠ your-eval performance.** General-English leaderboard ≠ financial-filing
  retrieval; the eval is the judge, not the board.
- **Asymmetric query/doc embedding — tested, doesn't help *us*.** We added a query/document
  `kind` to the seam and tried the proper instructions: nomic + `search_query:`/
  `search_document:` *regressed* (0.82 → 0.71); qwen3 + its `Instruct: …Query:` format was
  *net-neutral* (0.88 → 0.88, just shuffled which case missed). The principle is real in
  the literature; it didn't move this eval. Lever shelved (off by default).
- **Failures vary by embedder** — q008 / q013 / q014 / q017 move between models. No
  bi-encoder nails all; they're the genuinely hard cases (dense tables, multi-hop).

## Chunk size is embedder-dependent (45-case corpus)

A later finding from the larger **four-filing eval** (45 cases, DeepSeek generator,
retrieve 20; browse at [`/eval`](https://ragx-rosy.vercel.app/eval)), holding
everything fixed but the chunk size:

| Embedder | 350-char | 800-char | Best |
| --- | --- | --- | --- |
| `jina-embeddings-v3` (deployed) | **0.625** | 0.55 | 350 (+0.075) |
| `qwen3-embedding:0.6b` | 0.475 | **0.575** | 800 (+0.10) |

**The optimal chunk size flips with the embedder.** The stronger model (Jina) prefers
*fine* 350-char chunks — it can pinpoint the exact small chunk holding a figure; the
weaker model (qwen-0.6b) prefers *coarse* 800-char chunks — more context per chunk
offsets weaker discrimination, and fewer chunks compete for the top-20.

Two consequences:

- **Deployed Jina@350 is validated, not just inherited** (0.625 > 0.55). The 350 chosen
  on the v1 Berkshire corpus is still optimal for Jina on the bigger corpus.
- **Tuning does not transfer across embedders.** v1 measured 350 > 800 (Berkshire/nomic);
  qwen-0.6b on this corpus wants the opposite. Had we blindly carried qwen's "800 is
  better" to the deployed Jina, retrieval would have **regressed 0.625 → 0.55.**
  Re-validate chunk size (`CHUNK_CHARS`) on any embedder *or* corpus change.

(Also on the 45-case corpus: the embedder *ranking* itself reversed — `nomic` 0.55 >
`qwen-0.6b` 0.475, whereas on the 20-case Berkshire set qwen beat nomic. Even your own
eval doesn't transfer across document sets. `qwen3-8b` couldn't be measured in-memory:
a 4096-dim × 10k-chunk index exceeds V8's `JSON.stringify` string limit — high-dim
embedders need the pg store.)

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
# eval: also set GENERATOR=openai GEN_BASE_URL=https://api.deepseek.com/v1 \
#       GEN_MODEL=deepseek-chat TOP_K=20
# (export EMBED_API_KEY / GEN_API_KEY; add VECTOR_STORE=pg only to write the live index)
```
