# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A portfolio RAG (Retrieval-Augmented Generation) system over **financial filings / annual reports**. Goal: a deployed demo URL + an eval table proving retrieval and answer quality. Audience: recruiters hiring AI application engineers.

## Commands

This project uses **pnpm** (not npm).

```bash
pnpm install           # one-time
pnpm ingest            # build the vector index from source docs into data/index.json
pnpm eval              # run the eval set, prints retrieval hit@k + answer accuracy
pnpm dev               # Next.js dev server (run `ingest` first so the index exists)
pnpm typecheck         # tsc --noEmit
pnpm build             # production build
```

Switch the embedder with an env var: `EMBEDDER=ollama pnpm ingest` (default is `mock`, a zero-dependency deterministic embedder so the skeleton runs without Ollama).

## Architecture

Two pipelines, wired through four swappable interfaces in `src/core/`:

- **Ingestion** (`scripts/ingest.ts`): docs → chunk (with `{sourceDoc, page}` metadata) → `Embedder` → `VectorStore`.
- **Query** (`src/app/api/query/route.ts` → `src/core/rag.ts`): question → `Embedder` → `VectorStore` retrieve → `Reranker` → `Generator` → answer + citations.

The four seams — `Embedder`, `VectorStore`, `Generator`, `Reranker` — are interfaces with mock + real implementations. **Depend on these interfaces, never on a concrete vendor.** This is what makes A/B-testing models a one-file change.

## Project-specific rules (the non-obvious ones)

- **Add machinery only on a measured signal.** No LangGraph, no custom sub-agents, no reranker model until the eval set proves the simpler version fails. The query pipeline is a straight line by design.
- **Every chunk must carry `{sourceDoc, page}` metadata.** It powers BOTH user-facing citations AND eval retrieval scoring. Never drop it through the pipeline.
- **`InMemoryVectorStore` is local-only.** Vercel is serverless (no persistent disk), so before deploying, implement a `PgVectorStore` behind the `VectorStore` interface. The seam already exists for this.
- **PaddleOCR is a separate Python preprocessing step**, not part of the TS app. It outputs JSON/text that ingestion consumes.
- **The eval set is the source of truth for quality.** Any change to retrieval, chunking, or model → re-run `pnpm eval` and compare numbers before/after. Don't claim an improvement without the delta.

## Roadmap (see docs/DESIGN.md)

- **v0 (now):** walking skeleton — mock embedder/generator, in-memory store, dummy doc, 3 eval cases.
- **v1:** real PDFs + PaddleOCR ingestion, Ollama embeddings, pgvector store, real LLM generator, 30–50 eval cases, deploy.
- **v2:** agentic RAG (query rewriting, multi-hop, self-correction loop) — this is where LangGraph.js finally earns its place.
