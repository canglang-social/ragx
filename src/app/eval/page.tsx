import { listRuns, type EvalRunRow } from "../../core/evalLog";

// Live eval dashboard. The per-case × per-config history: each run is a row, each
// eval case a column. Reading the grid horizontally shows a config's profile;
// reading a column vertically shows which configs solve a given question — the
// thing that separates a model-fixable case from one that needs an architecture
// change. Server component, always fresh (no cache).
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const FILTER_KEYS = ["embedder", "generator", "top_k", "label"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function pct(x: number): string {
  return (x * 100).toFixed(0) + "%";
}

function shortConfig(r: EvalRunRow): string {
  // Strip only the provider prefix (ollama:/openai:), not internal colons —
  // "ollama:qwen3-embedding:0.6b" must stay "qwen3-embedding:0.6b", not "0.6b".
  const emb = r.embedder.replace(/^[a-z]+:/, "").replace("jina-embeddings-", "jina-");
  const gen = r.generator.replace(/^[a-z]+:/, "");
  return `${emb} + ${gen} · k=${r.top_k}`;
}

// The value a run exposes for a given filter column.
function fieldOf(r: EvalRunRow, key: FilterKey): string {
  if (key === "top_k") return String(r.top_k);
  if (key === "label") return r.label ?? "";
  return r[key];
}

// Build /eval?… preserving other active filters; value=null clears this key.
function hrefWith(current: Record<string, string>, key: string, value: string | null): string {
  const next = { ...current };
  if (value === null || value === "") delete next[key];
  else next[key] = value;
  const qs = new URLSearchParams(next).toString();
  return qs ? `/eval?${qs}` : "/eval";
}

const CELL: Record<string, { bg: string; fg: string }> = {
  PASS: { bg: "#1a7f37", fg: "#fff" }, // retrieval hit
  FAIL: { bg: "#cf222e", fg: "#fff" }, // retrieval miss
  "n/a": { bg: "#d0d7de", fg: "#57606a" }, // absent case (no gold)
  ERR: { bg: "#9a6700", fg: "#fff" }, // transient error
};

export default async function EvalPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  // Normalize to a flat string map (first value wins for repeats).
  const active: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) active[k] = s;
  }

  let allRuns: EvalRunRow[] = [];
  let error: string | null = null;
  try {
    allRuns = await listRuns(50);
  } catch (e) {
    error = (e as Error).message;
  }

  // Distinct values per column (from ALL runs, so you can switch filters freely).
  const options: Record<FilterKey, string[]> = {
    embedder: [],
    generator: [],
    top_k: [],
    label: [],
  };
  for (const key of FILTER_KEYS) {
    options[key] = Array.from(new Set(allRuns.map((r) => fieldOf(r, key)).filter(Boolean))).sort();
  }

  const runs = allRuns.filter((r) =>
    (Object.keys(active) as FilterKey[]).every((k) => fieldOf(r, k) === active[k]),
  );

  const caseIds = Array.from(new Set(runs.flatMap((r) => r.per_case.map((c) => c.id)))).sort();
  const filtering = Object.keys(active).length > 0;

  return (
    <main>
      <p>
        <a href="/">← ragx</a>
      </p>
      <h1>Eval history</h1>
      <p style={{ color: "#57606a" }}>
        Every <code>EVAL_LOG=1</code> run, recorded. Two metrics, kept separate:{" "}
        <strong>retrieval hit@k</strong> (did the gold chunk reach the generator) vs{" "}
        <strong>answer accuracy</strong> (was the final answer right). A green retrieval cell
        with a ✗ means good retrieval but a wrong answer; a red cell with a ✓ usually means the
        model answered from parametric memory, not the document.
      </p>

      {error && <p style={{ color: "#cf222e" }}>Could not load runs: {error}</p>}
      {!error && allRuns.length === 0 && (
        <p style={{ color: "#57606a" }}>
          No runs yet. Run <code>EVAL_LOG=1 pnpm eval:deepseek</code> to record one.
        </p>
      )}

      {allRuns.length > 0 && (
        <>
          {/* Filter bar: pin every knob but one to isolate that knob's effect. */}
          <div style={{ fontSize: 13, margin: "12px 0", lineHeight: 2 }}>
            {FILTER_KEYS.map((key) =>
              options[key].length > 1 || active[key] ? (
                <div key={key}>
                  <span style={{ color: "#57606a", marginRight: 6 }}>{key}:</span>
                  {options[key].map((v) => {
                    const on = active[key] === v;
                    return (
                      <a
                        key={v}
                        href={hrefWith(active, key, on ? null : v)}
                        style={{
                          marginRight: 6,
                          padding: "1px 8px",
                          borderRadius: 999,
                          textDecoration: "none",
                          background: on ? "#0969da" : "#eaeef2",
                          color: on ? "#fff" : "#24292f",
                        }}
                      >
                        {v || "—"}
                        {on ? " ✕" : ""}
                      </a>
                    );
                  })}
                </div>
              ) : null,
            )}
            {filtering && (
              <a href="/eval" style={{ color: "#0969da" }}>
                clear filters
              </a>
            )}
          </div>

          <h2>
            Runs {filtering && <span style={{ fontWeight: 400, color: "#57606a", fontSize: 14 }}>({runs.length}/{allRuns.length})</span>}
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #d0d7de" }}>
                  <th style={{ padding: "4px 8px" }}>When</th>
                  <th style={{ padding: "4px 8px" }}>Config</th>
                  <th style={{ padding: "4px 8px" }}>Label</th>
                  <th style={{ padding: "4px 8px" }}>git</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Retrieval</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>Answer</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>n</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #eaeef2" }}>
                    <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
                      <a href={`/eval/${r.id}`} style={{ color: "#0969da", textDecoration: "none" }}>
                        {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}
                      </a>
                    </td>
                    <td style={{ padding: "4px 8px" }}>{shortConfig(r)}</td>
                    <td style={{ padding: "4px 8px", color: "#57606a" }}>{r.label ?? ""}</td>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{r.git_sha}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }}>
                      <strong>{pct(r.retrieval_hit)}</strong>
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }}>
                      <strong>{pct(r.answer_acc)}</strong>
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#57606a" }}>{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Per-case grid</h2>
          <p style={{ color: "#57606a", fontSize: 13 }}>
            Cell colour = retrieval (
            <span style={{ color: CELL.PASS.bg }}>■ hit</span>,{" "}
            <span style={{ color: CELL.FAIL.bg }}>■ miss</span>,{" "}
            <span style={{ color: "#57606a" }}>■ absent</span>). Glyph = answer (✓/✗).
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ padding: "2px 6px", textAlign: "left", position: "sticky", left: 0, background: "#fff" }}>
                    config
                  </th>
                  {caseIds.map((id) => (
                    <th
                      key={id}
                      style={{ padding: "2px 1px", writingMode: "vertical-rl", height: 48, fontWeight: 400 }}
                    >
                      <a href={`/eval/q/${id}`} style={{ color: "#57606a", textDecoration: "none" }}>
                        {id}
                      </a>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const byId = new Map(r.per_case.map((c) => [c.id, c]));
                  return (
                    <tr key={r.id}>
                      <td style={{ padding: "2px 6px", whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff" }}>
                        {shortConfig(r)} <span style={{ fontFamily: "monospace", color: "#8c959f" }}>{r.git_sha}</span>
                      </td>
                      {caseIds.map((id) => {
                        const c = byId.get(id);
                        if (!c) return <td key={id} style={{ background: "#f6f8fa" }} />;
                        const style = CELL[c.retrieval] ?? CELL["n/a"];
                        return (
                          <td
                            key={id}
                            title={`${id}: retrieval ${c.retrieval}, answer ${c.answer ? "PASS" : "FAIL"}, ${c.ms}ms`}
                            style={{
                              background: style.bg,
                              color: style.fg,
                              textAlign: "center",
                              width: 18,
                              height: 18,
                              fontWeight: 700,
                            }}
                          >
                            {c.answer ? "✓" : "✗"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
