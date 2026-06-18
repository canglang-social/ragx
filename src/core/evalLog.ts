import postgres from "postgres";

// Eval run logging (Postgres). The per-case × per-config record that turns a pile
// of one-off eval runs into a comparable history — so we can SEE which
// (embedder, generator, top_k, chunk) solved which qNNN, and tell a model-fixable
// case apart from one that needs an architecture change. Same Neon DB + connection
// conventions as PgVectorStore (separate `eval_runs` table — never touches `chunks`).

export interface EvalCaseResult {
  id: string;
  retrieval: "PASS" | "FAIL" | "n/a" | "ERR"; // n/a = absent case (no gold)
  answer: boolean;
  ms: number;
}

export interface EvalRun {
  git_sha: string;
  embedder: string;
  generator: string;
  reranker: string;
  top_k: number;
  chunk_chars: number | null; // null = chunker default
  n: number;
  grounded: number;
  retrieval_hit: number;
  answer_acc: number;
  errored: number;
  per_case: EvalCaseResult[];
  note: string | null; // human commentary: what changed / what this run fixed
  label: string | null; // free-text grouping for A/B pairs, e.g. "ab:jina-vs-qwen"
}

export interface EvalRunRow extends EvalRun {
  id: number;
  created_at: string;
}

function connect(url = process.env.DATABASE_URL): ReturnType<typeof postgres> {
  if (!url) throw new Error("eval logging needs DATABASE_URL");
  const local = /@(localhost|127\.0\.0\.1)/.test(url);
  return postgres(url, { max: 1, ssl: local ? false : "require", onnotice: () => {} });
}

async function ensureSchema(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS eval_runs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    git_sha text NOT NULL,
    embedder text NOT NULL,
    generator text NOT NULL,
    reranker text NOT NULL,
    top_k int NOT NULL,
    chunk_chars int,
    n int NOT NULL,
    grounded int NOT NULL,
    retrieval_hit real NOT NULL,
    answer_acc real NOT NULL,
    errored int NOT NULL DEFAULT 0,
    per_case jsonb NOT NULL
  )`);
  // Added after the table shipped — idempotent so existing Neon tables get them too.
  await sql.unsafe(`ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS note text`);
  await sql.unsafe(`ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS label text`);
}

export async function logRun(run: EvalRun): Promise<void> {
  const sql = connect();
  try {
    await ensureSchema(sql);
    await sql`INSERT INTO eval_runs
      (git_sha, embedder, generator, reranker, top_k, chunk_chars, n, grounded, retrieval_hit, answer_acc, errored, per_case, note, label)
      VALUES (${run.git_sha}, ${run.embedder}, ${run.generator}, ${run.reranker}, ${run.top_k},
              ${run.chunk_chars}, ${run.n}, ${run.grounded}, ${run.retrieval_hit}, ${run.answer_acc},
              ${run.errored}, ${sql.json(run.per_case as unknown as Parameters<typeof sql.json>[0])},
              ${run.note}, ${run.label})`;
  } finally {
    await sql.end();
  }
}

export async function listRuns(limit = 50): Promise<EvalRunRow[]> {
  const sql = connect();
  try {
    await ensureSchema(sql);
    const rows = await sql<EvalRunRow[]>`
      SELECT * FROM eval_runs ORDER BY created_at DESC LIMIT ${limit}`;
    return rows.map((r) => ({
      ...r,
      per_case: (typeof r.per_case === "string"
        ? JSON.parse(r.per_case as unknown as string)
        : r.per_case) as EvalCaseResult[],
    }));
  } finally {
    await sql.end();
  }
}
