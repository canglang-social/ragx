# v1 TODO

Granular, churny task list. The stable "why" lives in [docs/DESIGN.md](docs/DESIGN.md).
v1 turns the v0 skeleton into a real, deployed RAG over financial filings.

> **Status: v1 SHIPPED** 🎉 — live at https://ragx-rosy.vercel.app/. Deployed stack (Jina + DeepSeek + pgvector on Vercel/Neon) evals **0.94 retrieval / 1.00 answer** (20-case demo, no-hallucination proven). _(v1 shipped on Groq; unified on DeepSeek 2026-06-20 — reliable from China and 20/20 vs Groq's 19/20 on the demo.)_
>
> **Since v1:** grew the eval to **45 cases over 4 filings** (JPMorgan / Microsoft / Costco + Berkshire — cross-document comparison + company disambiguation + harder multi-hop), added a live **`/eval` dashboard** (run history · per-case × per-config grid · per-run delta · question-history · timeline) and a DeepSeek generator path. **v2 + v1.5 (validated, off by default):** query decomposition (`PLANNER=llm`) + hybrid BM25+vector retrieval (`RETRIEVER=hybrid`, RRF) — measured **retrieval 0.63→0.70, answer 0.78→0.82**, grounding cross-document cases that were 0/6. Complementary: hybrid alone is a wash, but it makes the buried figure retrievable, which lets decomposition ground the comparison. Open: hybrid regresses q013/q017 (RRF-tuning lever); q035/q039/q041/q043 need table-aware chunking (B9 continues); prod enablement needs 4-filing pg ingest + pg FTS. Plus D11 (units), E14 (matcher guard).

## A. Ingestion — real data
- [x] A1. PDF text extractor via `unpdf`; `loadPdfs(dir)` → one chunk/page with `{sourceDoc, page, company, year}` (company/year from `company-year.pdf` filename). Synthetic 4-page fixture; eval holds 1.00/1.00, no regression.
- [ ] A2. PaddleOCR — NOT triggered. Berkshire (152pp) extracted clean text via unpdf; no scanned/garbage pages. Add only when a real scanned filing produces blank/garbage pages.
- [x] A3. Token-aware overlapping windows (`src/core/chunker.ts`, ~200 tok / 15% overlap), within-page so citations stay exact. Caught + fixed a decimal-severing bug (`$96.2`→`$96. 2`) that corrupted every figure.
- [x] A4. Added `berkshire-2023.pdf` (real 152-page filing). Synthetic `meridian-2023.pdf` kept as a clean fixture.

## B. Embedding & retrieval
- [x] B5. Swap `MockEmbedder` → `OllamaEmbedder` (`nomic-embed-text`); proven: answer accuracy 0.67 → 1.00 (q001 fixed). NOTE: nomic vectors are NOT length-normalized, so full cosine (with magnitude division) is required.
- [x] B6. `makeEmbedder()` factory (in embedder.ts) — removes the duplicated env-ternary from ingest.ts + rag.ts; guarantees ingest and query pick the same embedder.
- [x] B7. Tried a lexical (keyword+vector) reranker. MEASURED NEGATIVE: it regresses vs feeding the wide retrieval (truncating to 5 drops gold chunks; keyword overlap not discriminative when a phrase repeats across tables). Shelved behind `RERANKER=lexical`. The real win was retrieval breadth: TOP_K 5 → 20 lifted answer 0.67 → 0.83. A cross-encoder reranker stays deferred until recall is high but rank is the proven gap.
- [x] B8. Fixed the q005 RECALL miss. Diagnosed: "$169B float" ranked 52/1008, diluted inside an 800-char reinsurance-jargon window. Cut chunk size 800 → 350 chars (60 overlap) → it surfaces; answer 0.83 → 1.00 (6/6). ⚠️ 6 single-fact cases overfit small chunks — re-validated under E11 (held up; honest 0.82/0.85 on 20).
- [ ] B9. Hybrid keyword+vector retrieval — NOW signal-justified by E11. q007 (float "2022" not retrieved though "2023" is — phrasing sensitivity) and q013 (railroad earnings in a dense numeric table — semantically thin) are both recall misses BM25/keyword would nail. Vector-only retrieval is weak on tables and exact tokens.

## C. Vector store — deploy-critical
- [x] C8. `PgVectorStore` (postgres.js + pgvector) behind the seam: lazy schema (dim-sized table + HNSW cosine index), batched multi-row upsert, cosine query via `<=>`, SSL auto-on for hosted, jsonb metadata parsed on read. VALIDATED on Neon: eval holds 0.82/0.85, identical to in-memory — the seam swap is provably correct.
- [x] C9. Schema auto-created on first upsert; connection via `DATABASE_URL`; `makeStore()` factory + `VECTOR_STORE=pg`; `ingest:pg` / `eval:pg` scripts point at it.

## D. Generation
- [x] D10. `OllamaGenerator` (llama3) behind the seam: grounded prompt, temp 0, GENERATOR=ollama switch. Grounding works — answered q004 correctly from the table ($37,350M) and honestly said "I don't know" on q005 (no context). Hosted generator for deploy is still G15.
- [ ] D11. Prompt the generator to ALWAYS state the unit/scale (e.g. "$37.4 billion" / "$37,350 million"), so answers are self-contained. Right now q004 passes only because E12's matcher tolerates the unit-dropped "$37,350" — fixing the source makes it pass for the right reason and reduces reliance on lenient matching.

## E. Eval — the differentiator
- [x] E11. Grew eval 6 → 20 → **45 verified cases over 4 filings** (added JPMorgan / Microsoft / Costco; cross-document comparison + company disambiguation + harder multi-hop, on top of single/multi-fact + absent). Honest baseline held; fixed a multi-doc scoring bug (match `sourceDoc`, not page alone) + added `gold_chunks[]` for cross-doc. Surfaced the cross-document retrieval limit (→ v2) and within-document table misses (→ B9). The 30–50 / multi-filing target is met.
- [x] E12. Numeric/unit/scale-tolerant matching for `answer_type:"numerical"` (1% tol; tries 10^3 scale steps when the answer drops its unit). Fixed the q004 false-negative: answer accuracy 0.50 → 0.67. LLM-judge for free-form deferred until a free-form case needs it.
- [x] E13. Results table in README (retrieve-K sweep + the reranker negative result), with the per-change reasoning. Honest, apples-to-apples under E12 matching.
- [ ] E14. Guard E12 against FALSE-POSITIVES. Loosening the matcher traded false-negatives for possible false-positives; we only luck-checked it. Add a deliberately-ambiguous / wrong-but-close case (e.g. a near-miss number) that the matcher MUST still mark wrong, so the tolerance can't silently over-pass.

## F. Web / UX
- [x] F14. UX polish in `page.tsx`: error + loading states, clickable example questions (incl. one that demos the no-hallucination refusal), cited-answer rendering (answer card + monospace source chips), styling + footer with eval stats. Optional later: stream the answer.

## G. Deploy — the URL
- [x] G15. Hosted stack done + validated end-to-end. GENERATOR: `OpenAIGenerator` (Groq llama-3.3-70b free) with 429-retry. EMBEDDER: `OpenAIEmbedder` (Jina jina-embeddings-v3 free) with batching + 429-retry. Both behind the seams, env-switched, via `ingest:hosted` / `eval:hosted` (pgvector). **Deployed eval: retrieval 0.94 / answer 0.95 — beats the local nomic+llama3 stack (0.82/0.85)** because Jina v3 > nomic. Local-in-China needs `NODE_USE_ENV_PROXY=1` + `NO_PROXY=localhost` (Cloudflare 403s undici direct; Vercel's US IP won't).
- [x] G16. Deployed to Vercel (env vars/secrets: Jina + Groq keys, Neon pooled DATABASE_URL, VECTOR_STORE=pg). Live + query verified end-to-end: https://ragx-rosy.vercel.app/ — **v1 SHIPPED.**
