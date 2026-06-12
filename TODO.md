# v1 TODO

Granular, churny task list. The stable "why" lives in [docs/DESIGN.md](docs/DESIGN.md).
v1 turns the v0 skeleton into a real, deployed RAG over financial filings.

> **Start here today:** B5 (Ollama swap) — cheapest win, gives the first measured improvement.

## A. Ingestion — real data
- [x] A1. PDF text extractor via `unpdf`; `loadPdfs(dir)` → one chunk/page with `{sourceDoc, page, company, year}` (company/year from `company-year.pdf` filename). Synthetic 4-page fixture; eval holds 1.00/1.00, no regression.
- [ ] A2. PaddleOCR — NOT triggered. Berkshire (152pp) extracted clean text via unpdf; no scanned/garbage pages. Add only when a real scanned filing produces blank/garbage pages.
- [x] A3. Token-aware overlapping windows (`src/core/chunker.ts`, ~200 tok / 15% overlap), within-page so citations stay exact. Caught + fixed a decimal-severing bug (`$96.2`→`$96. 2`) that corrupted every figure.
- [x] A4. Added `berkshire-2023.pdf` (real 152-page filing). Synthetic `meridian-2023.pdf` kept as a clean fixture.

## B. Embedding & retrieval
- [x] B5. Swap `MockEmbedder` → `OllamaEmbedder` (`nomic-embed-text`); proven: answer accuracy 0.67 → 1.00 (q001 fixed). NOTE: nomic vectors are NOT length-normalized, so full cosine (with magnitude division) is required.
- [ ] B6. Extract a `makeEmbedder()` factory to remove the duplicated embedder-picking ternary (ingest.ts + rag.ts).
- [ ] B7. Add a real reranker — ONLY if eval shows high recall but the right chunk isn't ranked first.

## C. Vector store — deploy-critical
- [ ] C8. Implement `PgVectorStore` behind the `VectorStore` interface (pgvector on Supabase/Neon).
- [ ] C9. Table schema + connection config; point `ingest` at it.

## D. Generation
- [x] D10. `OllamaGenerator` (llama3) behind the seam: grounded prompt, temp 0, GENERATOR=ollama switch. Grounding works — answered q004 correctly from the table ($37,350M) and honestly said "I don't know" on q005 (no context). Hosted generator for deploy is still G15.

## E. Eval — the differentiator
- [ ] E11. Grow the eval set from 3 → 30–50 hand-written Q/A pairs.
- [ ] E12. Better matching — NOW TRIGGERED by a measured false-negative: q004's correct answer "$37,350" (million) is marked wrong vs gold "$42.5 billion"-style strings. Need numeric/unit-tolerant matching (or LLM-judge). The metric currently UNDER-reports quality.
- [ ] E13. Record metric deltas per change → a results table in README.

## F. Web / UX
- [ ] F14. Error + loading states in `page.tsx` `ask()`. Optional: stream the answer; render sources nicely.

## G. Deploy — the URL
- [ ] G15. ⚠️ Vercel is serverless and CANNOT run Ollama. The deployed build must use a hosted embedder + hosted generator (e.g. Claude) at query time; local dev keeps Ollama. The four seams make this dual setup painless.
- [ ] G16. Configure env vars/secrets on Vercel (Postgres URL, model API keys); deploy; verify the live URL end-to-end.
