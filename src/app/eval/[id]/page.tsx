import type { ReactNode } from "react";
import { listRuns, type EvalRunRow, type EvalCaseResult } from "../../../core/evalLog";
import questions from "../../../../eval/questions.sample.json";

// Per-run detail + delta. The id is the run's stable key. The delta auto-diffs this
// run against a baseline (the previous run by default, or ?vs=<id>): which cases this
// run SOLVED (were failing in the baseline, pass now) and which REGRESSED. That's the
// data-driven answer to "which question got fixed in which log" — no manual bookkeeping.
// The human "why/how" goes in the run's note. Server component, always fresh.
export const dynamic = "force-dynamic";

interface QuestionMeta {
  id: string;
  question: string;
  expected_answer: string;
  answer_type: string;
}
const QMETA = new Map((questions as QuestionMeta[]).map((q) => [q.id, q]));

function pct(x: number): string {
  return (x * 100).toFixed(0) + "%";
}
function shortConfig(r: EvalRunRow): string {
  const emb = r.embedder.replace(/^.*[:/]/, "").replace("jina-embeddings-", "jina-");
  const gen = r.generator.replace(/^.*[:/]/, "");
  return `${emb} + ${gen} · k=${r.top_k}`;
}
function when(r: EvalRunRow): string {
  return new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ");
}

export default async function RunDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vs?: string }>;
}) {
  const { id } = await params;
  const { vs } = await searchParams;

  let runs: EvalRunRow[] = [];
  let error: string | null = null;
  try {
    runs = await listRuns(50);
  } catch (e) {
    error = (e as Error).message;
  }

  const idx = runs.findIndex((r) => String(r.id) === id);
  const run = idx >= 0 ? runs[idx] : null;
  // Baseline: explicit ?vs=<id>, else the immediately-previous (older) run.
  const baseline = vs
    ? runs.find((r) => String(r.id) === vs) ?? null
    : idx >= 0 && idx + 1 < runs.length
      ? runs[idx + 1]
      : null;

  if (error) return <Shell><p style={{ color: "#cf222e" }}>Could not load: {error}</p></Shell>;
  if (!run) return <Shell><p>Run {id} not found.</p></Shell>;

  const curById = new Map(run.per_case.map((c) => [c.id, c]));
  const baseById = new Map((baseline?.per_case ?? []).map((c) => [c.id, c]));

  const solvedRetrieval: string[] = [];
  const regressedRetrieval: string[] = [];
  const solvedAnswer: string[] = [];
  const regressedAnswer: string[] = [];
  if (baseline) {
    for (const [cid, cur] of curById) {
      const base = baseById.get(cid);
      if (!base) continue;
      if (base.retrieval === "FAIL" && cur.retrieval === "PASS") solvedRetrieval.push(cid);
      if (base.retrieval === "PASS" && cur.retrieval === "FAIL") regressedRetrieval.push(cid);
      if (!base.answer && cur.answer) solvedAnswer.push(cid);
      if (base.answer && !cur.answer) regressedAnswer.push(cid);
    }
  }

  // This run's failures, for the symptom table.
  const failures = run.per_case
    .filter((c) => c.retrieval === "FAIL" || (c.retrieval !== "n/a" && !c.answer) || c.retrieval === "ERR")
    .sort((a, b) => a.id.localeCompare(b.id));

  return (
    <Shell>
      <h1 style={{ marginBottom: 4 }}>{shortConfig(run)}</h1>
      <p style={{ color: "#57606a", margin: "0 0 16px" }}>
        run #{run.id} · {when(run)} · git <code>{run.git_sha}</code>
        {run.label && <> · <span style={{ background: "#ddf4ff", padding: "1px 8px", borderRadius: 999 }}>{run.label}</span></>}
      </p>

      <div style={{ display: "flex", gap: 24, margin: "0 0 16px" }}>
        <Metric label="Retrieval hit@k" value={pct(run.retrieval_hit)} />
        <Metric label="Answer accuracy" value={pct(run.answer_acc)} />
        <Metric label="Cases" value={`${run.n} (${run.grounded} grounded)`} />
      </div>

      {run.note && (
        <p style={{ background: "#f6f8fa", borderLeft: "3px solid #0969da", padding: "8px 12px", margin: "0 0 20px" }}>
          {run.note}
        </p>
      )}

      <h2>Δ vs baseline</h2>
      {!baseline ? (
        <p style={{ color: "#57606a" }}>No prior run to compare against.</p>
      ) : (
        <>
          <p style={{ color: "#57606a", fontSize: 14 }}>
            Compared to <a href={`/eval/${baseline.id}`}>{shortConfig(baseline)} ({when(baseline)})</a>.
            A retrieval delta with the same generator isolates the embedder/retrieval change.
          </p>
          <ul style={{ lineHeight: 1.8 }}>
            <DeltaLine label="Retrieval solved here" ids={solvedRetrieval} good />
            <DeltaLine label="Retrieval regressed" ids={regressedRetrieval} />
            <DeltaLine label="Answer solved here" ids={solvedAnswer} good />
            <DeltaLine label="Answer regressed" ids={regressedAnswer} />
          </ul>
          {solvedRetrieval.length + regressedRetrieval.length + solvedAnswer.length + regressedAnswer.length === 0 && (
            <p style={{ color: "#57606a" }}>No per-case changes vs the baseline.</p>
          )}
        </>
      )}

      <h2>Failures in this run ({failures.length})</h2>
      {failures.length === 0 ? (
        <p style={{ color: "#1a7f37" }}>None — every case passed both metrics.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #d0d7de" }}>
              <th style={{ padding: "4px 8px" }}>Case</th>
              <th style={{ padding: "4px 8px" }}>Question</th>
              <th style={{ padding: "4px 8px" }}>Retrieval</th>
              <th style={{ padding: "4px 8px" }}>Answer</th>
              <th style={{ padding: "4px 8px" }}>Symptom</th>
            </tr>
          </thead>
          <tbody>
            {failures.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid #eaeef2", verticalAlign: "top" }}>
                <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{c.id}</td>
                <td style={{ padding: "4px 8px" }}>{QMETA.get(c.id)?.question ?? "—"}</td>
                <td style={{ padding: "4px 8px", color: c.retrieval === "PASS" ? "#1a7f37" : "#cf222e" }}>{c.retrieval}</td>
                <td style={{ padding: "4px 8px", color: c.answer ? "#1a7f37" : "#cf222e" }}>{c.answer ? "PASS" : "FAIL"}</td>
                <td style={{ padding: "4px 8px", color: "#57606a" }}>{symptom(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

// The mechanical symptom from the two metrics; the deeper cause/fix is human (note
// + docs/eval-case-studies.md). This just localizes failure to retrieval vs generation.
function symptom(c: EvalCaseResult): string {
  if (c.retrieval === "ERR") return "errored (transient failure)";
  if (c.retrieval === "FAIL" && !c.answer) return "gold chunk not retrieved → answer ungrounded";
  if (c.retrieval === "FAIL" && c.answer) return "answered without the gold chunk (parametric leak?)";
  if (c.retrieval === "PASS" && !c.answer) return "retrieved but generated wrong (generation/arithmetic)";
  return "";
}

function DeltaLine({ label, ids, good }: { label: string; ids: string[]; good?: boolean }) {
  if (ids.length === 0) return null;
  return (
    <li>
      <strong style={{ color: good ? "#1a7f37" : "#cf222e" }}>
        {good ? "✓" : "⚠"} {label} ({ids.length}):
      </strong>{" "}
      <span style={{ fontFamily: "monospace" }}>{ids.sort().join(", ")}</span>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#57606a", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main>
      <p>
        <a href="/eval">← eval history</a>
      </p>
      {children}
    </main>
  );
}
