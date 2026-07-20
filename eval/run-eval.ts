import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { answerQuestion, defaultDeps } from '../src/core/rag';
import { logRun, type EvalCaseResult } from '../src/core/evalLog';

// A flaky hosted API can reject a socket LATE — after the per-case retry already moved
// on — which would otherwise crash the whole run as an unhandled rejection (it killed an
// overnight run on a dropped proxy socket). The per-case loop already records such cases
// as errored; swallow the late straggler (logged, not silent) so the run still finishes.
process.on('unhandledRejection', (reason) => {
  console.error(
    `[ignored late rejection] ${(reason as Error)?.message ?? reason}`,
  );
});

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
    return [
      {
        source_doc: c.source_doc,
        source_page: c.source_page,
        contains: c.gold_chunk_contains,
      },
    ];
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
  const re =
    /(\d+(?:\.\d+)?)\s*(%|trillion|billion|bn|million|mn|mm|thousand)?/gi;
  for (const m of text.replace(/,/g, '').matchAll(re)) {
    const num = Number.parseFloat(m[1]);
    const unit = (m[2] ?? '').toLowerCase();
    if (unit === '%')
      out.push({ value: num, percent: true, explicitUnit: true });
    else if (UNIT_SCALE[unit])
      out.push({
        value: num * UNIT_SCALE[unit],
        percent: false,
        explicitUnit: true,
      });
    else out.push({ value: num, percent: false, explicitUnit: false });
  }
  return out;
}

function numbersMatch(gold: Amount, got: Amount, relTol = 0.01): boolean {
  if (gold.percent !== got.percent) return false;
  if (gold.percent)
    return (
      Math.abs(gold.value - got.value) <= Math.max(0.05, gold.value * relTol)
    );
  // Money: if the answer carried no unit (e.g. a table cell "$37,350" stated in
  // millions elsewhere on the page), try financial scale steps of 10^3.
  const scales = got.explicitUnit ? [1] : [1, 1e3, 1e6, 1e9];
  return scales.some(
    (k) => Math.abs(got.value * k - gold.value) <= gold.value * relTol,
  );
}

// LLM judge for FREE-FORM answers (E14). Substring matching can't tell a correct
// conclusion from a wrong one that happens to name the expected entity — a comparison
// that wrongly concludes "JPMorgan had higher net income (than Microsoft)" still contains
// "Microsoft", so `includes` falsely passes it. The judge reads the question + expected +
// answer and decides if the CONCLUSION matches. Opt-in (EVAL_JUDGE=llm) so the offline /
// mock eval stays deterministic; reuses the generator's provider unless JUDGE_* overrides.
async function llmJudge(
  question: string,
  expected: string,
  answer: string,
): Promise<boolean> {
  const model =
    process.env.JUDGE_MODEL ?? process.env.GEN_MODEL ?? 'gpt-4o-mini';
  const baseUrl =
    process.env.JUDGE_BASE_URL ??
    process.env.GEN_BASE_URL ??
    'https://api.openai.com/v1';
  const apiKey = process.env.JUDGE_API_KEY ?? process.env.GEN_API_KEY ?? '';
  const system =
    "You grade a model's answer to a question about financial filings against the expected answer. " +
    'Reply YES only if the model answer reaches the SAME conclusion as the expected answer; reply NO if it is ' +
    "wrong, contradictory, or concludes a different entity or value (e.g. names the wrong company as 'higher'). " +
    "The answer may include extra reasoning — judge only its final conclusion. Reply with ONLY 'YES' or 'NO'.";
  const user = `Question: ${question}\nExpected answer: ${expected}\nModel answer: ${answer}`;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`judge failed: ${res.status}`);
  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return /\byes\b/i.test(json.choices[0]?.message?.content ?? '');
}

async function answerMatches(
  c: EvalCase,
  answerText: string,
): Promise<boolean> {
  // "absent": the fact isn't in the corpus, so a correct answer DECLINES rather
  // than inventing one. This is the no-hallucination test.
  if (c.answer_type === 'absent') {
    return /\b(i\s+)?don'?t\s+know\b|not\s+(stated|provided|available|mentioned|specified|disclosed|in\s+the)/i.test(
      answerText,
    );
  }
  if (c.answer_type === 'numerical') {
    const gold = extractAmounts(c.expected_answer)[0];
    if (gold)
      return extractAmounts(answerText).some((a) => numbersMatch(gold, a));
  }
  // Free-form: prefer the LLM judge when enabled (it catches wrong-but-keyword-present
  // conclusions), else fall back to the substring check.
  if (
    process.env.EVAL_JUDGE === 'llm' &&
    (process.env.JUDGE_API_KEY || process.env.GEN_API_KEY)
  ) {
    try {
      return await llmJudge(c.question, c.expected_answer, answerText);
    } catch {
      /* judge unreachable — fall back to substring */
    }
  }
  return answerText.toLowerCase().includes(c.expected_answer.toLowerCase());
}

async function main(): Promise<void> {
  const file = path.join(process.cwd(), 'eval', 'questions.sample.json');
  const all: EvalCase[] = JSON.parse(await readFile(file, 'utf8'));

  // Subset selection, so a slow/paid API isn't burned re-running stable cases
  // every iteration. EVAL_ONLY=q025,q038 picks exact ids; EVAL_FILTER=q0(3|4) is a
  // regex over ids. Either narrows to e.g. just the cross-doc cases under work.
  const only = process.env.EVAL_ONLY?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const filterRe = process.env.EVAL_FILTER
    ? new RegExp(process.env.EVAL_FILTER)
    : null;
  const cases = all.filter(
    (c) =>
      (!only?.length || only.includes(c.id)) &&
      (!filterRe || filterRe.test(c.id)),
  );
  if (cases.length !== all.length) {
    console.log(
      `Subset: ${cases.length}/${all.length} cases (${cases.map((c) => c.id).join(',')})\n`,
    );
  }

  const deps = defaultDeps();
  const topK = deps.topK ?? 5;

  let hits = 0;
  let retrievalTotal = 0; // grounded cases only — absent cases have no gold chunk
  let correct = 0;
  let ctxSize = 0; // chunks actually fed to the generator (post-rerank), for honest labeling

  let errored = 0; // cases a transient failure (e.g. a flaky hosted API) knocked out
  const perCase: EvalCaseResult[] = [];

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
          perCase.push({
            id: c.id,
            retrieval: 'ERR',
            answer: false,
            ms: Date.now() - t0,
          });
          console.log(
            `${c.id}  retrieval=ERR   answer=ERR   ${String(Date.now() - t0).padStart(5)}ms  | ${c.question}  (${(err as Error).message.slice(0, 60)})`,
          );
        }
      }
    }
    if (!result) continue;
    const { answer, retrieved } = result;
    const ms = Date.now() - t0;
    ctxSize = Math.max(ctxSize, retrieved.length);

    const grounded = c.answer_type !== 'absent';
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
    const answerOk = await answerMatches(c, answer.text);

    if (grounded) {
      retrievalTotal++;
      if (retrievalHit) hits++;
    }
    if (answerOk) correct++;

    const retrievalCol = grounded ? (retrievalHit ? 'PASS' : 'FAIL') : 'n/a ';
    perCase.push({
      id: c.id,
      retrieval: grounded ? (retrievalHit ? 'PASS' : 'FAIL') : 'n/a',
      answer: answerOk,
      ms,
    });
    console.log(
      `${c.id}  retrieval=${retrievalCol}  answer=${answerOk ? 'PASS' : 'FAIL'}  ${String(ms).padStart(5)}ms  | ${c.question}`,
    );
  }

  const n = cases.length;
  console.log('\n--- Eval summary ---');
  console.log(
    `Cases:              ${n}  (${retrievalTotal} grounded, ${n - retrievalTotal} absent)${errored ? `  [⚠ ${errored} errored: excluded from retrieval denom, count as answer misses — re-run for a clean number]` : ''}`,
  );
  console.log(
    `Pipeline:           retrieve ${topK} → ${deps.reranker?.name ?? 'identity'} → ${deps.generator.name}`,
  );
  console.log(
    `Retrieval hit@${ctxSize}:     ${(hits / retrievalTotal).toFixed(2)}  (${hits}/${retrievalTotal})  (gold in generator context, grounded only)`,
  );
  console.log(
    `Answer accuracy:    ${(correct / n).toFixed(2)}  (${correct}/${n})`,
  );

  // Opt-in (EVAL_LOG=1): persist this run to the eval_runs table so /eval can show
  // the per-case × per-config history. Opt-in so smoke subsets don't pollute it.
  if (process.env.EVAL_LOG) {
    let gitSha = 'unknown';
    try {
      gitSha = execSync('git rev-parse --short HEAD', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
    } catch {
      /* not a git repo — leave "unknown" */
    }
    await logRun({
      git_sha: gitSha,
      embedder: deps.embedder.name,
      generator: deps.generator.name,
      reranker: deps.reranker?.name ?? 'identity',
      top_k: topK,
      chunk_chars: process.env.CHUNK_CHARS
        ? Number(process.env.CHUNK_CHARS)
        : null,
      n,
      grounded: retrievalTotal,
      retrieval_hit: retrievalTotal
        ? Number((hits / retrievalTotal).toFixed(4))
        : 0,
      answer_acc: Number((correct / n).toFixed(4)),
      errored,
      per_case: perCase,
      note: process.env.EVAL_NOTE || null,
      label: process.env.EVAL_LABEL || null,
    });
    console.log(`\nLogged run to eval_runs (git ${gitSha}).`);
  }

  await deps.store.close?.();

  const minRetrieval = Number(process.env.EVAL_MIN_RETRIEVAL ?? 0);
  const minAnswerAcc = Number(process.env.EVAL_MIN_ANSWER ?? 0);
  const retrieval = retrievalTotal ? hits / retrievalTotal : 0;
  const answerAcc = correct / n;

  if (retrieval < minRetrieval || answerAcc < minAnswerAcc) {
    console.error(
      `FAIL: retrieval ${retrieval.toFixed(2)} (min ${minRetrieval}), ` +
        `answer ${answerAcc.toFixed(2)} (min ${minAnswerAcc})`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
