# v1 TODO

Granular, churny task list. The stable "why" lives in [docs/DESIGN.md](docs/DESIGN.md).
v1 turns the v0 skeleton into a real, deployed RAG over financial filings.

> **Start here today:** B5 (Ollama swap) — cheapest win, gives the first measured improvement.

## A. Ingestion — real data
- [ ] A1. Add a PDF text extractor (TS lib); replace `loadDummyDoc()` with `loadPdfs(dir)`.
- [ ] A2. Add PaddleOCR as a separate Python preprocessing step (scanned / table-heavy pages) → JSON the loader reads.
- [ ] A3. Real chunking: token-aware overlapping windows; preserve `{sourceDoc, page, section}` metadata.
- [ ] A4. Add a few real annual-report PDFs to `data/pdfs/`.

## B. Embedding & retrieval
- [ ] B5. Swap `MockEmbedder` → `OllamaEmbedder` (`ollama pull nomic-embed-text`); re-run `pnpm eval` to prove `answer=0.67` climbs. **← today**
- [ ] B6. Extract a `makeEmbedder()` factory to remove the duplicated embedder-picking ternary (ingest.ts + rag.ts).
- [ ] B7. Add a real reranker — ONLY if eval shows high recall but the right chunk isn't ranked first.

## C. Vector store — deploy-critical
- [ ] C8. Implement `PgVectorStore` behind the `VectorStore` interface (pgvector on Supabase/Neon).
- [ ] C9. Table schema + connection config; point `ingest` at it.

## D. Generation
- [ ] D10. Replace `MockGenerator` → a real LLM generator with a grounded prompt: answer ONLY from context, cite pages, say "I don't know" if absent.

## E. Eval — the differentiator
- [ ] E11. Grow the eval set from 3 → 30–50 hand-written Q/A pairs.
- [ ] E12. Better matching: numeric tolerance for `answer_type:"numerical"` (use the existing hook); LLM-judge for free-form.
- [ ] E13. Record metric deltas per change → a results table in README.

## F. Web / UX
- [ ] F14. Error + loading states in `page.tsx` `ask()`. Optional: stream the answer; render sources nicely.

## G. Deploy — the URL
- [ ] G15. ⚠️ Vercel is serverless and CANNOT run Ollama. The deployed build must use a hosted embedder + hosted generator (e.g. Claude) at query time; local dev keeps Ollama. The four seams make this dual setup painless.
- [ ] G16. Configure env vars/secrets on Vercel (Postgres URL, model API keys); deploy; verify the live URL end-to-end.
