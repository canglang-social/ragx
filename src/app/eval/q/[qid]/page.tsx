import { listRuns, type EvalRunRow, type EvalCaseResult } from "../../../../core/evalLog";
import questions from "../../../../../eval/questions.sample.json";

// Question-centric view — the transpose of /eval. For one question, its trajectory
// ACROSS configs/runs over time: when it went miss->hit (or regressed), and under
// which config. This is how you learn from the eval — watch a single question move
// from mistake to success as the embedder/chunking/generator changes.
export const dynamic = "force-dynamic";

interface QuestionMeta {
  id: string;
  question: string;
  expected_answer: string;
  answer_type: string;
  source_doc: string | null;
  source_page: number | null;
  gold_chunk_contains: string;
  gold_chunks?: { source_doc: string; source_page: number | null; contains: string }[];
}
const QMETA = new Map((questions as QuestionMeta[]).map((q) => [q.id, q]));

function shortConfig(r: EvalRunRow): string {
  const emb = r.embedder.replace(/^[a-z]+:/, "").replace("jina-embeddings-", "jina-");
  const gen = r.generator.replace(/^[a-z]+:/, "");
  return `${emb} + ${gen} · k=${r.top_k}${r.chunk_chars ? ` · ${r.chunk_chars}ch` : ""}`;
}
function when(r: EvalRunRow): string {
  return new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ");
}

function goldLocation(q: QuestionMeta): string {
  if (q.answer_type === "absent") return "— (absent: must refuse)";
  const gc = q.gold_chunks?.length
    ? q.gold_chunks
    : q.source_doc
      ? [{ source_doc: q.source_doc, source_page: q.source_page, contains: q.gold_chunk_contains }]
      : [];
  return gc.map((g) => `${g.source_doc}${g.source_page ? ` p${g.source_page}` : ""} ("${g.contains}")`).join("  +  ");
}

const RET_COLOR: Record<string, string> = { PASS: "#1a7f37", FAIL: "#cf222e", "n/a": "#57606a", ERR: "#9a6700" };

export default async function QuestionHistory({ params }: { params: Promise<{ qid: string }> }) {
  const { qid } = await params;
  const meta = QMETA.get(qid);

  let runs: EvalRunRow[] = [];
  let error: string | null = null;
  try {
    runs = await listRuns(50);
  } catch (e) {
    error = (e as Error).message;
  }

  // Chronological (oldest first) so the trajectory reads top-to-bottom.
  const history = runs
    .slice()
    .reverse()
    .map((r) => ({ run: r, c: r.per_case.find((pc) => pc.id === qid) }))
    .filter((x): x is { run: EvalRunRow; c: EvalCaseResult } => Boolean(x.c));

  const grounded = history.filter((h) => h.c.retrieval !== "n/a");
  const retrievedCount = grounded.filter((h) => h.c.retrieval === "PASS").length;
  const answeredCount = history.filter((h) => h.c.answer).length;

  return (
    <main>
      <p>
        <a href="/eval">← eval history</a>
      </p>
      <h1 style={{ marginBottom: 4 }}>
        <span style={{ fontFamily: "monospace" }}>{qid}</span>
      </h1>
      {!meta ? (
        <p>Unknown question id.</p>
      ) : (
        <p style={{ fontSize: 17, margin: "0 0 12px" }}>{meta.question}</p>
      )}
      {meta && (
        <p style={{ color: "#57606a", fontSize: 14, margin: "0 0 20px" }}>
          expected <strong>{meta.expected_answer}</strong> · type {meta.answer_type} · grounded in {goldLocation(meta)}
        </p>
      )}

      {error && <p style={{ color: "#cf222e" }}>Could not load runs: {error}</p>}

      {!error && history.length === 0 ? (
        <p style={{ color: "#57606a" }}>No recorded runs include this question yet.</p>
      ) : (
        <>
          <p style={{ color: "#57606a" }}>
            Retrieved by <strong>{retrievedCount}/{grounded.length}</strong> configs · answered correctly by{" "}
            <strong>{answeredCount}/{history.length}</strong>.
          </p>
          <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #d0d7de" }}>
                <th style={{ padding: "4px 8px" }}>When</th>
                <th style={{ padding: "4px 8px" }}>Config</th>
                <th style={{ padding: "4px 8px" }}>Retrieval</th>
                <th style={{ padding: "4px 8px" }}>Answer</th>
                <th style={{ padding: "4px 8px" }}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => {
                const prev = history[i - 1]?.c;
                const retFlip = prev && prev.retrieval !== h.c.retrieval && h.c.retrieval !== "n/a";
                const ansFlip = prev && prev.answer !== h.c.answer;
                const note =
                  (retFlip && h.c.retrieval === "PASS") || (ansFlip && h.c.answer)
                    ? "✓ improved"
                    : (retFlip && h.c.retrieval === "FAIL") || (ansFlip && !h.c.answer)
                      ? "⚠ regressed"
                      : "";
                return (
                  <tr key={h.run.id} style={{ borderBottom: "1px solid #eaeef2" }}>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{when(h.run)}</td>
                    <td style={{ padding: "4px 8px" }}>
                      <a href={`/eval/${h.run.id}`} style={{ color: "#0969da", textDecoration: "none" }}>
                        {shortConfig(h.run)}
                      </a>
                    </td>
                    <td style={{ padding: "4px 8px", color: RET_COLOR[h.c.retrieval], fontWeight: 600 }}>{h.c.retrieval}</td>
                    <td style={{ padding: "4px 8px", color: h.c.answer ? "#1a7f37" : "#cf222e", fontWeight: 600 }}>
                      {h.c.answer ? "PASS" : "FAIL"}
                    </td>
                    <td style={{ padding: "4px 8px", color: note.startsWith("✓") ? "#1a7f37" : "#cf222e" }}>{note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
