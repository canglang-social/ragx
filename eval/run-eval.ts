import { readFile } from "node:fs/promises";
import path from "node:path";
import { answerQuestion, defaultDeps } from "../src/core/rag";

// The executable spec. Reports TWO numbers, deliberately separated so a failure
// points at its cause: retrieval hit@k measures the retriever; answer accuracy
// measures the generator GIVEN good retrieval.

// A single grounding location: the fact lives in a chunk of this doc containing
// this substring. source_page PINS the page when the substring is non-distinctive
// (e.g. Berkshire "operating earnings" recurs, so the page disambiguates which
// chunk is gold). For big filings a headline figure repeats across many pages
// (JPMorgan net income is on p3/85/101/205) and any of them grounds the answer —
// there source_page is null and we match on the distinctive number alone.
interface GoldChunk {
  source_doc: string;
  source_page: number | null;
  contains: string;
}

interface EvalCase {
  id: string;
  question: string;
  expected_answer: string;
  answer_type: string; // "numerical" | "freeform" | "absent"
  source_doc: string | null; // null for absent (answer is not in any doc)
  source_page: number | null;
  gold_chunk_contains: string;
  // Cross-document cases need MULTIPLE gold chunks (e.g. comparing two filings):
  // the answer isn't grounded unless ALL of them were retrieved. When present this
  // supersedes the single source_doc/source_page/gold_chunk_contains fields above.
  gold_chunks?: GoldChunk[];
}

// Normalize a case to its required gold chunks. Single-source cases (the common
// kind) project to a one-element list, so the scorer has one code path.
function goldChunksOf(c: EvalCase): GoldChunk[] {
  if (c.gold_chunks?.length) return c.gold_chunks;
  if (c.source_doc)
    return [{ source_doc: c.source_doc, source_page: c.source_page, contains: c.gold_chunk_contains }];
  return [];
}

// --- Answer matching (E12) -------------------------------------------------
// Substring match is too brittle for financial figures: the same fact appears
// rounded in prose ("$37.4 billion") and precise in tables ("$37,350" million,
// unit dropped). For answer_type:"numerical" we compare NUMBERS, not strings.

const UNIT_SCALE: Record<string, number> = {
  trillion: 1e12,
  billion: 1e9,
  bn: 1e9,
  million: 1e6,
  mn: 1e6,
  mm: 1e6,
  thousand: 1e3,
};

interface Amount {
  value: number; // normalized to base units (or the raw percent number)
  percent: boolean;
  explicitUnit: boolean;
}

function extractAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(%|trillion|billion|bn|million|mn|mm|thousand)?/gi;
  for (const m of text.replace(/,/g, "").matchAll(re)) {
    const num = Number.parseFloat(m[1]);
    const unit = (m[2] ?? "").toLowerCase();
    if (unit === "%") out.push({ value: num, percent: true, explicitUnit: true });
    else if (UNIT_SCALE[unit]) out.push({ value: num * UNIT_SCALE[unit], percent: false, explicitUnit: true });
    else out.push({ value: num, percent: false, explicitUnit: false });
  }
  return out;
}

function numbersMatch(gold: Amount, got: Amount, relTol = 0.01): boolean {
  if (gold.percent !== got.percent) return false;
  if (gold.percent) return Math.abs(gold.value - got.value) <= Math.max(0.05, gold.value * relTol);
  // Money: if the answer carried no unit (e.g. a table cell "$37,350" stated in
  // millions elsewhere on the page), try financial scale steps of 10^3.
  const scales = got.explicitUnit ? [1] : [1, 1e3, 1e6, 1e9];
  return scales.some((k) => Math.abs(got.value * k - gold.value) <= gold.value * relTol);
}

function answerMatches(c: EvalCase, answerText: string): boolean {
  // "absent": the fact isn't in the corpus, so a correct answer DECLINES rather
  // than inventing one. This is the no-hallucination test.
  if (c.answer_type === "absent") {
    return /\b(i\s+)?don'?t\s+know\b|not\s+(stated|provided|available|mentioned|specified|disclosed|in\s+the)/i.test(
      answerText,
    );
  }
  if (c.answer_type === "numerical") {
    const gold = extractAmounts(c.expected_answer)[0];
    if (gold) return extractAmounts(answerText).some((a) => numbersMatch(gold, a));
  }
  return answerText.toLowerCase().includes(c.expected_answer.toLowerCase());
}

async function main(): Promise<void> {
  const file = path.join(process.cwd(), "eval", "questions.sample.json");
  const cases: EvalCase[] = JSON.parse(await readFile(file, "utf8"));
  const deps = defaultDeps();
  const topK = deps.topK ?? 5;

  let hits = 0;
  let retrievalTotal = 0; // grounded cases only — absent cases have no gold chunk
  let correct = 0;
  let ctxSize = 0; // chunks actually fed to the generator (post-rerank), for honest labeling

  let errored = 0; // cases a transient failure (e.g. a flaky hosted API) knocked out

  for (const c of cases) {
    const t0 = Date.now();
    // One transient network failure (hosted generator drops a connection) must not
    // discard the whole run. Retry once, then record the case as errored and keep
    // going — a partial table beats no table.
    let result: Awaited<ReturnType<typeof answerQuestion>> | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await answerQuestion(c.question, deps);
      } catch (err) {
        if (attempt === 1) {
          errored++;
          console.log(`${c.id}  retrieval=ERR   answer=ERR   ${String(Date.now() - t0).padStart(5)}ms  | ${c.question}  (${(err as Error).message.slice(0, 60)})`);
        }
      }
    }
    if (!result) continue;
    const { answer, retrieved } = result;
    const ms = Date.now() - t0;
    ctxSize = Math.max(ctxSize, retrieved.length);

    const grounded = c.answer_type !== "absent";
    const golds = goldChunksOf(c);
    // A grounded case is retrieved iff EVERY required gold chunk is in context.
    // Match on sourceDoc AND page (not page alone): across a multi-filing corpus
    // page 3 of Costco and page 3 of JPMorgan collide, so page-only would score a
    // Costco question a hit on a JPMorgan chunk. For cross-doc cases all golds
    // must be present — a comparison isn't grounded if only one figure was found.
    const retrievalHit =
      grounded &&
      golds.length > 0 &&
      golds.every((g) =>
        retrieved.some(
          (r) =>
            r.metadata.sourceDoc === g.source_doc &&
            (g.source_page == null || r.metadata.page === g.source_page) &&
            r.text.toLowerCase().includes(g.contains.toLowerCase()),
        ),
      );
    const answerOk = answerMatches(c, answer.text);

    if (grounded) {
      retrievalTotal++;
      if (retrievalHit) hits++;
    }
    if (answerOk) correct++;

    const retrievalCol = grounded ? (retrievalHit ? "PASS" : "FAIL") : "n/a ";
    console.log(
      `${c.id}  retrieval=${retrievalCol}  answer=${answerOk ? "PASS" : "FAIL"}  ${String(ms).padStart(5)}ms  | ${c.question}`,
    );
  }

  const n = cases.length;
  console.log("\n--- Eval summary ---");
  console.log(`Cases:              ${n}  (${retrievalTotal} grounded, ${n - retrievalTotal} absent)${errored ? `  [⚠ ${errored} errored: excluded from retrieval denom, count as answer misses — re-run for a clean number]` : ""}`);
  console.log(`Pipeline:           retrieve ${topK} → ${deps.reranker?.name ?? "identity"} → ${deps.generator.name}`);
  console.log(`Retrieval hit@${ctxSize}:     ${(hits / retrievalTotal).toFixed(2)}  (${hits}/${retrievalTotal})  (gold in generator context, grounded only)`);
  console.log(`Answer accuracy:    ${(correct / n).toFixed(2)}  (${correct}/${n})`);

  await deps.store.close?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
