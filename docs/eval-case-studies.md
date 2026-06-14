# Eval case studies: diagnosis → fix (q001–q006)

How each of the first six eval cases was diagnosed and fixed. Each failure was
isolated using the two-metric design (retrieval hit vs answer accuracy) so the
cause was always attributable to a single stage, then fixed and re-measured.

| Case | Fact (source) | Failure mode | Root cause | Fix | Commit |
| --- | --- | --- | --- | --- | --- |
| q001 | Meridian net sales 2023 = $42.5B | answer wrong | mock embedder couldn't match meaning | real embeddings | `d1d3005` |
| q002 | Meridian gross margin 2023 = 38.2% | (stable) | — | hardened by % matching | `0d57526` |
| q003 | Meridian net sales 2022 = $39.4B | (stable) | — | hardened by numeric matching | `0d57526` |
| q004 | Berkshire operating earnings 2023 = $37.4B | answer FAIL, retrieval PASS | metric too strict (false negative) | unit/scale-tolerant matching | `0d57526` |
| q005 | Berkshire float end-2023 = $169B | retrieval FAIL (recall) | fact diluted in a large chunk | smaller chunks | `19fb493` |
| q006 | Berkshire net earnings 2023 = $96.2B | retrieval FAIL + corrupted data | decimal severed + rank too low | chunker fix + wider retrieval | `29176bf`, `2ea089a` |

---

## q001 — "What were Meridian's total net sales in fiscal 2023?" → $42.5 billion

- **Tests:** basic single-fact numeric retrieval + generation.
- **Diagnosis:** under the v0 `MockEmbedder` (bag-of-words hashing), answer accuracy
  sat at 0.67 and this was the failing case — a hashed word-count vector can't tell
  that the question "total net sales" *means* the same as the chunk; there is no
  semantics, only token overlap.
- **Fix:** swap to real embeddings (`OllamaEmbedder` / `nomic-embed-text`), whose
  vectors encode meaning, so the query lands near the right chunk. 0.67 → 1.00.
- **Commit:** `d1d3005` (B5).

## q002 — "What was Meridian's gross margin in fiscal 2023?" → 38.2%

- **Tests:** a **percentage**-valued answer (a different numeric shape than `$`).
- **Diagnosis:** stable once real embeddings were in; never the bottleneck.
- **Fix:** no retrieval/generation fix needed. The numeric matcher (E12) treats `%`
  as its own dimension with tolerance, so `38.2%` is matched robustly rather than by
  brittle string equality.
- **Commit:** `0d57526` (E12, hardening).

## q003 — "What were Meridian's net sales in fiscal 2022?" → $39.4 billion

- **Tests:** retrieving the **prior-year** figure that sits on the *same page* as the
  current-year one (q001) — the retriever must not confuse 2022 with 2023.
- **Diagnosis:** stable; both figures live in one short chunk, and the generator
  picks the right year from context.
- **Fix:** none needed; numeric matching (E12) guards the comparison.
- **Commit:** `0d57526` (E12, hardening).

## q004 — "What were Berkshire's operating earnings in 2023?" → $37.4 billion

- **Tests:** a fact the filing states **two ways** — rounded in the letter
  ("$37.4 billion") and precise in a table ("$37,350" million, unit dropped).
- **Diagnosis:** retrieval PASS, answer **FAIL** — but the pipeline was *correct*:
  llama3 answered `$37,350` from the table. The failure was the **metric**: a
  substring match for "$37.4 billion" can't see that `$37,350` million is the same
  quantity. A **false negative** — the eval under-reported real quality.
- **Fix:** numeric matching that normalizes units (billion/million/%), tolerates
  rounding (~1%), and tries 10³ scale steps when the answer omits its unit, so
  `$37,350` million ≈ `$37.4 billion`. 0.50 → 0.67.
- **Commit:** `0d57526` (E12).
- **Open follow-up:** the answer *should* be self-contained (state the unit) so it
  passes for the right reason rather than relying on a lenient matcher — see TODO D11.

## q005 — "What was Berkshire's insurance float at the end of 2023?" → $169 billion

- **Tests:** a single sentence of signal buried inside a dense, jargon-heavy page.
- **Diagnosis:** retrieval **FAIL** (recall) — not a ranking issue: the chunk was
  not retrieved even at K=40. Measured directly: the "Float was approximately $169
  billion…" sentence sat inside an 800-char window dominated by reinsurance-
  accounting boilerplate, so the window's embedding was pulled toward the jargon and
  ranked **52 / 1008**. The generator correctly said *"I don't know"* (no
  hallucination) because the fact never reached its context.
- **Fix:** cut the chunk size 800 → 350 chars. A smaller window isolates the float
  sentence, its embedding matches the query, and it climbs into the top-20.
  0.83 → 1.00 on the 6-case set.
- **Commit:** `19fb493` (B8).
- **Caveat:** validated under the larger E11 set (it held), but smaller chunks favor
  single-fact lookups — re-check when multi-fact cases grow.

## q006 — "What were Berkshire's net earnings attributable to shareholders in 2023?" → $96.2 billion

- **Tests:** a fact whose key phrase ("net earnings attributable to shareholders")
  **repeats across many subsidiary tables**, plus a decimal figure.
- **Diagnosis:** two independent bugs, found one after the other:
  1. **Corrupted data.** The chunker's sentence splitter treated the decimal point in
     `$96.2` as a sentence boundary and rejoined with a space → `$96. 2 billion`. The
     gold string `$96.2 billion` therefore *did not exist* in the index — unmatchable
     for any retriever or generator. (This corrupted **every** decimal in the corpus.)
  2. **Rank miss.** Even with clean data, the right chunk ranked ~6–20 by vector
     similarity — outside the top-5 the generator saw — so llama3 grabbed a wrong but
     plausible nearby table figure (`$97,512`) and answered confidently wrong.
- **Fix:**
  1. Split on punctuation **followed by whitespace** (a decimal has no space after the
     dot), so figures are never severed.
  2. Widen retrieval breadth TOP_K 5 → 20, so the rank ~6–20 chunk enters context.
- **Commits:** `29176bf` (decimal fix), `2ea089a` (TOP_K=20).

---

### What this set taught us about *method*

- **Separate retrieval from generation metrics** — it told us instantly whether a
  failure was upstream (q005 recall), downstream (none here), or neither (q004 metric).
- **A green checkmark is not proof** — q004 passed only because we loosened the
  matcher; q006 once "passed" on corrupted data nobody had inspected.
- **The eval can lie in both directions** — false negative (q004) and, on a tiny set,
  a misleading 1.00. Growing the eval (E11) is what makes any of these numbers trustworthy.
