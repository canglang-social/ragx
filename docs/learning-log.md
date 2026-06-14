# Learning log

Questions asked while building ragx, each with a self-contained takeaway and a
pointer to the fuller answer. A review sheet — re-read it cold to check the
concept still holds. Companion to [principles.md](principles.md) (the rules) and
[eval-case-studies.md](eval-case-studies.md) (the debugging).

## 2026-06-14 — concepts

**Q1. How does a bash env-var prefix like `EMBEDDER=ollama npx tsx …` work, and how does it reach `process.env`?**
`KEY=value command` puts `KEY` into the *environment* of that one process (and its
children), then runs it — nothing persists. It's a Unix principle, not a bash trick:
every process inherits an environment, and Node exposes it as `process.env.KEY`.
Distinct from **arguments** (the words *after* the command → `process.argv`). Three
scopes: inline (one command) · `export` (the session) · `~/.zshrc` (permanent). I used
inline everywhere because it's leak-free and self-documenting.

**Q2. What is an A/B test?**
Run two variants changing **exactly one** variable, hold everything else fixed, and
let a measured metric decide. We have no users, so the **eval set is the judge**. The
one rule that makes it valid: change one thing, or you get a *confound* and can't
attribute the delta. A win is only as trustworthy as the eval is large/representative
(20 cases → one case = 5%). → [principles.md](principles.md) §1.

**Q3. The lexical reranker — its logic, why use it, what kinds exist, should I `/learn` it?**
*Logic:* score each candidate by blending the (min-max normalized) vector score with
keyword overlap, keep top-N. *Why I tried it:* a hypothesis (feed fewer-but-better) —
not knowledge; the A/B **rejected it** (it regressed). *Kinds:* lexical/BM25,
cross-encoder (the "real" one), LLM-as-judge, fusion. *Key concept:* two-stage
retrieval — bi-encoder (fast, separate embeddings) retrieves wide → cross-encoder
(slow, reads query+chunk together) reranks narrow. *Verdict:* learn the concept now
(interview-relevant); defer a hands-on build until the eval proves a reranker is needed.

**Q4. How do I find a model's context length? What unit — tokens? Chinese vs English?**
`ollama show <model>` (or model cards / config). Unit = **tokens** (subword pieces),
not chars/words: English ≈ 4 chars/token, Chinese ≈ 1–1.5 chars/token. Tokenization
differs **by model and by language**. Two limits to keep separate: the **hard context
window** (a fact you look up) vs the **practical sweet spot** (found empirically,
usually well below the ceiling — "lost in the middle"). And the **embedder's** limit
(nomic 2048) ≠ the **generator's** window (llama3 8192) — different models.

**Q6. How were maxChars 800 / overlap 120 chosen, and why change to 350?**
800/120 were a **convention-based defensible default** (≈200 tokens, well below the
embedder ceiling, 15% overlap) — *not* measured. 350 was the **measured correction**:
the q005 diagnosis showed the float fact diluted in an 800-char window (ranked
52/1008), so a smaller window was the hypothesis; the eval confirmed it (0.83 → 1.00).
Honest caveat: only one smaller value was tried, not a full sweep — so 350 is
"eval-blessed," not "proven optimal." Principle: *default behind a knob → eval moves
it.* → [principles.md](principles.md) §4.

## 2026-06-14 — recording requests (produced these docs)

- **Q5.** Diagnose + fix each of q001–q006 → [eval-case-studies.md](eval-case-studies.md).
- **Q7.** List all the principles & rules → [principles.md](principles.md).
- **Q8.** Record the questions I asked → *this file*.

## Earlier in the build — concepts that came up as questions

- **Why `pnpm ingest` if `index.json` already exists?** Because ingest *rebuilds* the
  index from source docs — needed whenever the docs, chunker, or embedder change. The
  index is a derived artifact, not the source.
- **Why delete the dummy doc instead of commenting it out?** Git is your memory —
  commented code rots (never type-checked/run) and lies to the next reader. Delete it;
  `git show` brings it back. (A deliberate *test fixture* is different — that has a job.)
- **Could a sub-agent fetch the PDFs?** Over-machinery for a one-shot task — a cold
  agent re-derives context and costs more. Sub-agents are for big, self-contained
  fan-out, not small steps. (We generated a synthetic PDF inline instead.)
- **Plain `pnpm eval` returned 0.00 — why did even q001–q003 fail?** The index was
  built with the Ollama embedder (768-dim) but plain `eval` defaults to the mock
  embedder (256-dim) — query and index in different spaces → retrieval is meaningless.
  *Ingest and query must use the same embedder.*
