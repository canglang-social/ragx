# Learning log

Concepts worked through while building ragx — the **reference layer**, organized by
**topic** so you can look something up without remembering when you learned it. Each
entry carries a `(captured YYYY-MM-DD)` tag so the timeline survives too.

> Capture vs reference are different jobs: capture by date (low-friction, your dated
> notes), distill into topic notes here. Companion to [principles.md](principles.md)
> (the rules), [eval-case-studies.md](eval-case-studies.md) (the debugging), and
> [learning-cards.md](learning-cards.md) (the same material as Logseq → Anki flashcards
> for spaced repetition).

## Env & Bash

**Env-var prefix `EMBEDDER=ollama npx tsx …` → `process.env`** *(captured 2026-06-14)*
`KEY=value command` puts `KEY` into the *environment* of that one process (and its
children), then runs it — nothing persists. A Unix principle, not a bash trick: every
process inherits an environment, Node exposes it as `process.env.KEY`. Distinct from
**arguments** (words *after* the command → `process.argv`). Three scopes: inline (one
command) · `export` (the session) · `~/.zshrc` (permanent). Inline is leak-free and
self-documenting.

## Eval & measurement

**A/B testing** *(captured 2026-06-14)*
Run two variants changing **exactly one** variable, hold everything else fixed, let a
metric decide. We have no users, so the **eval set is the judge**. Change one thing or
you get a *confound*. A win is only as trustworthy as the eval is large/representative
(20 cases → one case = 5%). → [principles.md](principles.md) §1.

## Retrieval & reranking

**Lexical reranker — logic, kinds, two-stage retrieval** *(captured 2026-06-14)*
*Logic:* blend each candidate's (min-max normalized) vector score with keyword overlap,
keep top-N. *Why I tried it:* a hypothesis (feed fewer-but-better), not knowledge — the
A/B **rejected it** (it regressed). *Kinds:* lexical/BM25, cross-encoder (the "real"
one), LLM-as-judge, fusion. *Two-stage retrieval:* bi-encoder (fast, separate
embeddings) retrieves wide → cross-encoder (slow, reads query+chunk together) reranks
narrow. *Verdict:* learn the concept now; defer a hands-on build until the eval proves
a reranker is needed.

## Tokens & models

**Context length, tokens, Chinese vs English** *(captured 2026-06-14)*
`ollama show <model>` (or model cards) gives the context length. Unit = **tokens**
(subword pieces): English ≈ 4 chars/token, Chinese ≈ 1–1.5. Tokenization differs **by
model and by language**. Two limits to separate: the **hard context window** (looked
up) vs the **practical sweet spot** (found empirically, below the ceiling — "lost in
the middle"). And the **embedder's** limit (nomic 2048) ≠ the **generator's** window
(llama3 8192) — different models.

## Chunking & parameters

**How 800/120 → 350 chunk size was chosen** *(captured 2026-06-14)*
800/120 were a **convention-based defensible default** (≈200 tokens, well below the
embedder ceiling, 15% overlap), *not* measured. 350 was the **measured correction**:
q005 showed the float fact diluted in an 800-char window (ranked 52/1008); a smaller
window was the hypothesis; the eval confirmed it (0.83 → 1.00). Caveat: only one
smaller value was tried, not a full sweep — "eval-blessed," not "proven optimal."
Principle: *default behind a knob → eval moves it.* → [principles.md](principles.md) §4.

## Embeddings & math

**Embeddings & cosine & L1/L2** *(captured 2026-06-10, `/learn` session)*
An **embedding** converts text → a vector; meaning is distributed across the model's
learned dimensions. Similarity *intuition* = distance between vectors; `sum(|aᵢ−bᵢ|)`
is the **L1 / Manhattan** distance, `√Σ(aᵢ−bᵢ)²` is **L2 / Euclidean**. But raw
distance is distorted by length, so we compare **direction (the angle)** instead:
**cosine = dot(a,b) / (‖a‖·‖b‖)** — drop magnitude, keep meaning. Key finding: nomic
vectors are **not** length-normalized, so our `cosine()` must divide by the magnitudes
itself (a dot-product alone would be wrong). [Self-derived in the /learn loop; the
common slip is dropping the `√` in the denominator — the denominator is each vector's
*length* `√Σx²`, not `Σx²`.]

**Norm vs normalization (min-max)** *(captured 2026-06-14)*
A **norm** measures *one vector's* length (L1, L2). **Normalization** rescales *a set
of values* — **min-max** = `(x−min)/(max−min)` → [0,1]; **z-score** = `(x−mean)/std`.
Different categories despite the shared word "normal-". We min-max the reranker's two
signals so each has **equal voice despite different spreads** (cosine clusters in a
narrow 0.76–0.79 band; lexical spans 0–1) — not just to fix nominal range.

## Agents & Claude Code

*From a handwritten draft (captured 2026-06-07); answered across the early sessions.*

**1. Claude Code's built-in agents.** Claude Code ships ready-made agent types you
*invoke* (general-purpose, Explore, Plan, …) — you don't build these; you delegate a
sub-task to one.

**2. Sub-agents — what & when.** *What:* a separate agent run with its **own context
window**, spawned for a self-contained task. *When:* only for a **big, isolatable
fan-out** that benefits from a clean separate context — never for a small step (a cold
agent re-derives context and costs more).

**3. The two axes that govern agent boundaries.** ① **Context isolation** — does this
work need its own clean context, apart from the main thread? ② **Tool scoping** — does
it need a restricted/different tool set? Anti-pattern: "**role**" agents (a
"researcher", a "writer") — job titles map to *neither* axis, so they're not a real
reason to split.

**4. Why this RAG needs no sub-agents.** The query pipeline is a **straight line**
(embed → retrieve → rerank → generate): no context to isolate, no tools to scope.
Signal-driven minimalism — don't add agents until the eval forces branching
(multi-hop / self-correction → v2). q014 is the first such signal.

**5. Best portfolio corpus.** **Financial filings / annual reports** — the answers are
numbers, so "correct" is unambiguous, which makes the eval *credible* to a recruiter.

**6. CLAUDE.md — why / when / how.** *Why:* persistent project instructions that load
into context every session, so Claude follows your conventions and they **override
default behavior**. *When to add:* when there's a non-obvious rule worth enforcing
(the "non-obvious ones"), not things derivable from the code. *How it works:* loaded as
context at session start; treated as higher-priority instructions.

## Pipeline basics (earlier in the build)

- **Why `pnpm ingest` if `index.json` exists?** ingest *rebuilds* the index from source
  docs — needed whenever docs/chunker/embedder change. The index is derived, not source.
- **Why delete the dummy doc, not comment it out?** Git is your memory; commented code
  rots (never type-checked/run) and lies to the next reader. (A deliberate *fixture* is
  different — it has a job.)
- **Could a sub-agent fetch the PDFs?** Over-machinery for a one-shot task. (We
  generated a synthetic PDF inline instead.)
- **Plain `pnpm eval` returned 0.00 — why?** The index was built with the Ollama
  embedder (768-dim) but plain `eval` defaults to the mock embedder (256-dim) — query
  and index in different spaces. *Ingest and query must use the same embedder.*

## Recording requests (produced these docs)

- Diagnose + fix q001–q006 → [eval-case-studies.md](eval-case-studies.md).
- List all principles & rules → [principles.md](principles.md).
- Record the questions I asked → this file.
