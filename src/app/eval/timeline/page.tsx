import { listRuns, type EvalRunRow } from "../../../core/evalLog";

// Timeline — the eval's history as a narrative spine, in truthful created_at order
// (oldest first). Each run carries its story in `note`; the metric delta vs the
// previous run is the through-line (what each change bought). NOT backdated: this
// literally reads the real record order. The cross-corpus past (v0/v1 on smaller
// corpora) isn't here because it isn't comparable — that lives in git + docs.
export const dynamic = "force-dynamic";

function pct(x: number): string {
  return (x * 100).toFixed(0) + "%";
}
function when(r: EvalRunRow): string {
  return new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ");
}
function shortConfig(r: EvalRunRow): string {
  const emb = r.embedder.replace(/^[a-z]+:/, "").replace("jina-embeddings-", "jina-");
  const gen = r.generator.replace(/^[a-z]+:/, "");
  return `${emb} + ${gen} · k=${r.top_k}${r.chunk_chars ? ` · ${r.chunk_chars}ch` : ""}`;
}
// pp = percentage points vs the previous run; green = better (both metrics: higher is better).
function delta(cur: number, prev: number | null): { text: string; color: string } {
  if (prev == null) return { text: "", color: "#57606a" };
  const d = cur - prev;
  if (Math.abs(d) < 0.005) return { text: "±0", color: "#57606a" };
  return { text: `${d > 0 ? "▲ +" : "▼ "}${(d * 100).toFixed(0)}pp`, color: d > 0 ? "#1a7f37" : "#cf222e" };
}

export default async function Timeline() {
  let runs: EvalRunRow[] = [];
  let error: string | null = null;
  try {
    runs = (await listRuns(50)).reverse(); // oldest first — story reads top to bottom
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <main>
      <p>
        <a href="/eval">← eval history</a>
      </p>
      <h1>Eval timeline</h1>
      <p style={{ color: "#57606a" }}>
        Every recorded run in true chronological order, with the metric change vs the previous
        run. The story is in each run&apos;s note; the deltas show what each change bought. (Only
        runs on the current corpus are comparable and shown here — the earlier mock/nomic/Jina
        milestones ran on smaller corpora and live in the git history and{" "}
        <a href="https://github.com/canglang-social/ragx/blob/master/docs/eval-case-studies.md">eval-case-studies.md</a>.)
      </p>

      {error && <p style={{ color: "#cf222e" }}>Could not load runs: {error}</p>}
      {!error && runs.length === 0 && <p style={{ color: "#57606a" }}>No runs recorded yet.</p>}

      <div style={{ borderLeft: "2px solid #d0d7de", marginLeft: 8, paddingLeft: 20 }}>
        {runs.map((r, i) => {
          const prev = i > 0 ? runs[i - 1] : null;
          const dR = delta(r.retrieval_hit, prev?.retrieval_hit ?? null);
          const dA = delta(r.answer_acc, prev?.answer_acc ?? null);
          return (
            <div key={r.id} style={{ position: "relative", marginBottom: 28 }}>
              <span
                style={{
                  position: "absolute",
                  left: -27,
                  top: 4,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#0969da",
                  border: "2px solid #fff",
                }}
              />
              <div style={{ fontSize: 13, color: "#57606a" }}>{when(r)}</div>
              <div style={{ fontSize: 16, fontWeight: 600, margin: "2px 0" }}>
                <a href={`/eval/${r.id}`} style={{ color: "#0969da", textDecoration: "none" }}>
                  {shortConfig(r)}
                </a>
                {r.label && (
                  <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, background: "#ddf4ff", padding: "1px 8px", borderRadius: 999 }}>
                    {r.label}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 14 }}>
                retrieval <strong>{pct(r.retrieval_hit)}</strong>{" "}
                <span style={{ color: dR.color }}>{dR.text}</span>
                {"   ·   "}
                answer <strong>{pct(r.answer_acc)}</strong>{" "}
                <span style={{ color: dA.color }}>{dA.text}</span>
              </div>
              {r.note && <div style={{ fontSize: 14, color: "#57606a", marginTop: 4 }}>{r.note}</div>}
            </div>
          );
        })}
      </div>
    </main>
  );
}
