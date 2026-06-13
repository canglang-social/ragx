import { readFile } from "node:fs/promises";
import path from "node:path";
import { answerQuestion, defaultDeps } from "../src/core/rag";

// The executable spec. Reports TWO numbers, deliberately separated so a failure
// points at its cause: retrieval hit@k measures the retriever; answer accuracy
// measures the generator GIVEN good retrieval.

interface EvalCase {
  id: string;
  question: string;
  expected_answer: string;
  answer_type: string;
  source_doc: string;
  source_page: number;
  gold_chunk_contains: string;
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
  let correct = 0;
  let ctxSize = 0; // chunks actually fed to the generator (post-rerank), for honest labeling

  for (const c of cases) {
    const { answer, retrieved } = await answerQuestion(c.question, deps);
    ctxSize = Math.max(ctxSize, retrieved.length);

    const retrievalHit = retrieved.some(
      (r) =>
        r.metadata.page === c.source_page &&
        r.text.toLowerCase().includes(c.gold_chunk_contains.toLowerCase()),
    );
    const answerOk = answerMatches(c, answer.text);

    if (retrievalHit) hits++;
    if (answerOk) correct++;

    console.log(
      `${c.id}  retrieval=${retrievalHit ? "PASS" : "FAIL"}  answer=${answerOk ? "PASS" : "FAIL"}  | ${c.question}`,
    );
  }

  const n = cases.length;
  console.log("\n--- Eval summary ---");
  console.log(`Cases:              ${n}`);
  console.log(`Pipeline:           retrieve ${topK} → ${deps.reranker?.name ?? "identity"} → ${deps.generator.name}`);
  console.log(`Retrieval hit@${ctxSize}:     ${(hits / n).toFixed(2)}  (${hits}/${n})  (gold in generator context)`);
  console.log(`Answer accuracy:    ${(correct / n).toFixed(2)}  (${correct}/${n})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
