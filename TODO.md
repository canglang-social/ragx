# v1 TODO

Granular, churny task list. The stable "why" lives in [docs/DESIGN.md](docs/DESIGN.md).
v1 turns the v0 skeleton into a real, deployed RAG over financial filings.

> **Status:** real-PDF pipeline at **0.83/0.83** on 6 cases (retrieve 20 → identity → llama3, unit-tolerant matching). One open failure: **B8 (q005 recall)**. Deploy path (C8/C9 → G15/G16) is the road to the live URL.

## A. Ingestion — real data
- [x] A1. PDF text extractor via `unpdf`; `loadPdfs(dir)` → one chunk/page with `{sourceDoc, page, company, year}` (company/year from `company-year.pdf` filename). Synthetic 4-page fixture; eval holds 1.00/1.00, no regression.
- [ ] A2. PaddleOCR — NOT triggered. Berkshire (152pp) extracted clean text via unpdf; no scanned/garbage pages. Add only when a real scanned filing produces blank/garbage pages.
- [x] A3. Token-aware overlapping windows (`src/core/chunker.ts`, ~200 tok / 15% overlap), within-page so citations stay exact. Caught + fixed a decimal-severing bug (`$96.2`→`$96. 2`) that corrupted every figure.
- [x] A4. Added `berkshire-2023.pdf` (real 152-page filing). Synthetic `meridian-2023.pdf` kept as a clean fixture.

## B. Embedding & retrieval
- [x] B5. Swap `MockEmbedder` → `OllamaEmbedder` (`nomic-embed-text`); proven: answer accuracy 0.67 → 1.00 (q001 fixed). NOTE: nomic vectors are NOT length-normalized, so full cosine (with magnitude division) is required.
- [ ] B6. Extract a `makeEmbedder()` factory to remove the duplicated embedder-picking ternary (ingest.ts + rag.ts).
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
- [~] E11. Grew eval 6 → 20 verified cases (17 grounded: single-fact / multi-fact / free-form + 3 absent/refusal). Honest baseline: retrieval 0.82, answer 0.85 (was a fake 1.00 on 6). Exposed B9 (table + phrasing recall) and the first v2 signal (q014 multi-hop arithmetic). Keep growing toward 30–50, add a 2nd real filing.
- [x] E12. Numeric/unit/scale-tolerant matching for `answer_type:"numerical"` (1% tol; tries 10^3 scale steps when the answer drops its unit). Fixed the q004 false-negative: answer accuracy 0.50 → 0.67. LLM-judge for free-form deferred until a free-form case needs it.
- [x] E13. Results table in README (retrieve-K sweep + the reranker negative result), with the per-change reasoning. Honest, apples-to-apples under E12 matching.
- [ ] E14. Guard E12 against FALSE-POSITIVES. Loosening the matcher traded false-negatives for possible false-positives; we only luck-checked it. Add a deliberately-ambiguous / wrong-but-close case (e.g. a near-miss number) that the matcher MUST still mark wrong, so the tolerance can't silently over-pass.

## F. Web / UX
- [ ] F14. Error + loading states in `page.tsx` `ask()`. Optional: stream the answer; render sources nicely.

## G. Deploy — the URL
- [ ] G15. ⚠️ Vercel is serverless and CANNOT run Ollama. The deployed build must use a hosted embedder + hosted generator (e.g. Claude) at query time; local dev keeps Ollama. The four seams make this dual setup painless.
- [ ] G16. Configure env vars/secrets on Vercel (Postgres URL, model API keys); deploy; verify the live URL end-to-end.
