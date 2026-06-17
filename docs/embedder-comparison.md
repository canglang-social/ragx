# Embedder comparison

Eval-driven embedder selection. Same pipeline every row — **pgvector + Groq
`llama-3.3-70b` + the 20-case eval, retrieve 20** — swapping *only* the embedder, so
the delta is attributable to the embedder alone. The eval picks the winner, not the
leaderboard (MTEB is general English; this is financial-filing retrieval).

Reproduce a row: re-ingest with the embedder, then `eval` it (see commands below).

**Compare on Retrieval hit@20 — it's generator-independent (the embedder's own metric).**
Answer accuracy depends on the *generator*, so rows using different generators aren't
answer-comparable; it's shown only for context.

| Embedder (model) | dim | Generator | Retrieval hit@20 | Answer | Notes |
| --- | --- | --- | --- | --- | --- |
| Jina `jina-embeddings-v3` | 1024 | Groq 70b | **0.94** (16/17) | 0.95 | shipped baseline; only miss q008 (equity ranks 77 — competed) |
| Ollama `qwen3-embedding:0.6b` | 1024 | local llama3 | 0.88 (15/17) | 0.90 | local/free, fast (~5s/case); fixed q008 but missed q013 + q014. Weaker — it's the *small* qwen3 (MTEB #5 is the 8b) |
| Jina `jina-embeddings-v5-text-small` | ? | — | _pending_ | — | (free tier throttled — test later or paid) |

Finding so far: **failures vary by embedder** — Jina v3 misses q008; qwen3-0.6b misses
q013 (dense table) + q014 (multi-hop). No small bi-encoder nails all three; they're the
genuinely hard cases. **Jina v3 (0.94) is still the best so far.**

## Reproduce

Swap `EMBED_MODEL` (and `EMBED_BASE_URL` for a different provider), re-ingest, re-eval.
Keys exported: `EMBED_API_KEY` (embedder), `GEN_API_KEY` (Groq), `DATABASE_URL` (Neon).

```bash
# re-ingest pgvector with the candidate embedder
NODE_USE_ENV_PROXY=1 NO_PROXY=localhost,127.0.0.1 \
  EMBEDDER=openai EMBED_BASE_URL=<provider /v1> EMBED_MODEL=<model> \
  VECTOR_STORE=pg npx tsx scripts/ingest.ts

# eval it (embedder + Groq generator)
NODE_USE_ENV_PROXY=1 NO_PROXY=localhost,127.0.0.1 \
  EMBEDDER=openai EMBED_BASE_URL=<provider /v1> EMBED_MODEL=<model> \
  GENERATOR=openai GEN_BASE_URL=https://api.groq.com/openai/v1 GEN_MODEL=llama-3.3-70b-versatile \
  VECTOR_STORE=pg TOP_K=20 npx tsx eval/run-eval.ts
```
