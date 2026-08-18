# CLAUDE.md

This is the Claude Code adapter for RAGX. It supplies repository guidance; it is
not a separate runtime, command set, hook, MCP server, or deployment mechanism.

## Canonical routing

- Read `README.md` for supported entry points, the safe default workflow,
  external-service limitations, and the public handoff policy.
- Treat `package.json` as command truth, `.env.example` as the safe local default,
  and `scripts/` plus `src/core/` as runtime truth.
- Follow `docs/DESIGN.md` and `docs/principles.md` for architecture. Preserve the
  provider-neutral interfaces and `{sourceDoc, page}` metadata.
- Do not duplicate branch, deployment, roadmap, or quality status here; reconcile
  such claims against the live implementation and authoritative documentation.

## Working boundary

Use the README's mock/local workflow unless the owner explicitly requests an
external path. Do not inspect private corpora or indexes, expose credentials, make
paid or hosted calls, access production Postgres, enable TTS or eval logging,
deploy, or apply infrastructure by default. Use synthetic inputs and fail closed
when an external account, credential, provider, or service is unavailable.
