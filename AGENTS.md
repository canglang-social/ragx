# AGENTS.md

This is the Codex adapter for RAGX. It supplies repository guidance; it is not a
separate runtime, skill, hook, MCP server, or deployment mechanism.

## Authoritative sources

- Use `README.md` for the supported entry points, safety boundaries, and public
  handoff policy.
- Use `package.json` for executable command names, `.env.example` for the safe
  local defaults, and `scripts/` plus `src/core/` for runtime behavior.
- Use `docs/DESIGN.md` and `docs/principles.md` for architecture and design
  constraints. Do not copy branch, deployment, or quality status into this file.

## Safe default workflow

From a fresh clean workspace, use the tracked synthetic fixture and leave all
provider, Postgres, description, and eval-log environment switches unset:

```bash
pnpm install --frozen-lockfile
pnpm ingest
pnpm eval
pnpm dev
```

Run `pnpm typecheck` and `pnpm build` before declaring a code change complete.
The default path uses deterministic mock components and the local file-backed
index; it needs no provider account or production data.

## Boundaries

- Preserve the provider-neutral interfaces and `{sourceDoc, page}` metadata.
- Do not inspect or ingest private documents, corpora, existing index contents,
  credentials, or production data. Use tracked or temporary synthetic inputs.
- Do not make paid or hosted API calls, access Postgres, enable eval logging or
  TTS, deploy, or apply infrastructure unless the owner explicitly requests it
  and supplies the required external access.
- Ollama paths require a running local Ollama service and the configured models.
- `DRY_RUN=1 pnpm ingest` skips embed/store but prints document excerpts; use it
  only with data that is safe to expose in terminal output.
- `pnpm ingest:deployed` uses hosted services and resets the table selected by
  `PG_TABLE`; never use it as a smoke test or against an unconfirmed database.
- If an account, credential, provider, or service is unavailable, report that
  limitation and keep the independent mock/local path working.
