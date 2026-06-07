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

async function main(): Promise<void> {
  const file = path.join(process.cwd(), "eval", "questions.sample.json");
  const cases: EvalCase[] = JSON.parse(await readFile(file, "utf8"));
  const deps = defaultDeps();
  const topK = deps.topK ?? 5;

  let hits = 0;
  let correct = 0;

  for (const c of cases) {
    const { answer, retrieved } = await answerQuestion(c.question, deps);

    const retrievalHit = retrieved.some(
      (r) =>
        r.metadata.page === c.source_page &&
        r.text.toLowerCase().includes(c.gold_chunk_contains.toLowerCase()),
    );
    const answerOk = answer.text.toLowerCase().includes(c.expected_answer.toLowerCase());

    if (retrievalHit) hits++;
    if (answerOk) correct++;

    console.log(
      `${c.id}  retrieval=${retrievalHit ? "PASS" : "FAIL"}  answer=${answerOk ? "PASS" : "FAIL"}  | ${c.question}`,
    );
  }

  const n = cases.length;
  console.log("\n--- Eval summary ---");
  console.log(`Cases:              ${n}`);
  console.log(`Retrieval hit@${topK}:     ${(hits / n).toFixed(2)}  (${hits}/${n})`);
  console.log(`Answer accuracy:    ${(correct / n).toFixed(2)}  (${correct}/${n})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
