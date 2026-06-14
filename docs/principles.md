# Principles & rules

The reasoning rules this project is built on, collected in one place. Each is
tagged by *kind*, because conflating them is a common mistake:

- **[HARD]** — true regardless of this project: math, or how the technology
  fundamentally works. Don't violate these.
- **[CONV]** — a convention / sensible default. Defensible, but could reasonably
  differ; tune against evidence.
- **[PROJ]** — a choice specific to ragx (these also live in [CLAUDE.md](../CLAUDE.md)).

---

## 1. Eval & measurement

- **[PROJ]** The eval set is the source of truth for quality. Any change to
  retrieval, chunking, or model → re-run the eval and compare before/after.
- **[HARD]** Quality is a number, not a vibe — never claim an improvement without
  the measured delta.
- **[CONV]** Separate retrieval-hit from answer-accuracy, so a failure localizes to
  a stage (retrieval vs generation) instead of being a single opaque score.
- **[HARD]** A/B test = change **exactly one** variable, hold everything else fixed,
  let the metric decide. Two changes at once = a confound; you can't attribute the delta.
- **[HARD]** A result is only as trustworthy as the eval is large and representative.
  One case in 20 = 5%; a "win" on a tiny set can be noise.
- **[HARD]** A green checkmark is not proof — don't let a passing metric end your scrutiny.
- **[HARD]** The eval can lie in both directions: false negatives (a correct answer
  scored wrong) and false positives (a vague/wrong answer scored right).
- **[HARD]** Loosening a matcher trades false-negatives for false-positives — audit
  the new risk; it is not pure upside.
- **[HARD]** Never trust a gold/expected string you haven't verified against the
  actual extracted text.

## 2. Architecture

- **[PROJ]** Depend on interfaces (the four seams: Embedder, VectorStore, Generator,
  Reranker), never on a concrete vendor — swapping a model is a one-file change.
- **[PROJ]** Signal-driven minimalism: add machinery only when a measured signal
  demands it. No reranker / framework / sub-agents until the eval proves the simpler
  version fails.
- **[PROJ]** The query pipeline is a straight line until the eval forces branching
  (loops / multi-hop → that's when v2 / an agent framework earns its place).
- **[CONV]** Configure at the composition root (`defaultDeps` + env at the boundary);
  keep core functions pure and parameterized.
- **[CONV]** Two-stage retrieval: retrieve wide & cheap (bi-encoder) → rerank narrow
  & accurate (cross-encoder).
- **[HARD]** Don't ship machinery that loses to the baseline on the eval.
- **[CONV]** A documented negative result is valuable — keep it (behind a flag), with
  the data that killed it.
- **[HARD]** Right idea, wrong job: a technique that fails in one role (lexical as a
  *reranker*) can be correct in another (lexical for *recall-widening*).

## 3. Data & pipeline integrity

- **[PROJ]** Every chunk carries `{sourceDoc, page}` — it powers citations AND eval
  scoring. Never drop it through the pipeline.
- **[HARD]** Ingest and query MUST use the same embedder, or retrieval silently
  breaks — vectors from different models live in different spaces.
- **[HARD]** An embedding only has meaning relative to the model that produced it.
- **[HARD]** Fix the root cause, not the symptom (fix the chunker that severed
  decimals; don't paper over the damage downstream).
- **[HARD]** Verify against the actual data before asserting a diagnosis.

## 4. Parameters & tuning

- **[CONV]** Pick a defensible default, make it a knob, let the eval move it — don't
  agonize over the first value. Its only jobs are to be reasonable and adjustable.
- **[CONV]** Move a parameter only on a measured signal, via an A/B, then re-measure.
- **[CONV]** Cheapest lever first (raise `topK` before building a reranker).
- **[HARD]** Budget context in tokens; stay under the model's window; the practical
  sweet spot is usually well below the ceiling ("lost in the middle").

## 5. Tokens & models

- **[HARD]** LLMs process tokens, not chars or words. English ≈ 4 chars/token;
  Chinese ≈ 1–1.5 chars/token.
- **[HARD]** Tokenization differs by model and by language — the same text yields
  different token counts on different tokenizers.
- **[HARD]** Two different limits: a model's hard context window vs the practical
  quality sweet spot (the latter is found empirically, below the former).
- **[HARD]** The embedder's context limit ≠ the generator's context window — they are
  different models with different ceilings.

## 6. Math concepts

- **[HARD]** Cosine measures direction (angle), not magnitude — to compare *meaning*,
  drop length.
- **[HARD]** L1 / L2 are *norms* (they measure one vector's length); min-max / z-score
  are *normalizations* (they rescale a set of values). Different categories despite the
  shared word "normal-".
- **[HARD]** Normalize signals before blending them, so each has equal voice despite
  different spreads (not just different nominal ranges).

## 7. Git & workflow

- **[CONV]** Git is your memory — delete dead code, don't comment it out.
- **[PROJ]** Commit when asked; atomic commits that tell the story, including the
  *why* and the measured delta.

## 8. Honesty (how to work)

- **[HARD]** You never *know* a technique will help — you hypothesize; the eval judges.
- **[HARD]** Report faithfully: say when something failed, was skipped, or is only
  half-proven (e.g. a value validated on a tiny eval).
