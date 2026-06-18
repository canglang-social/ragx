import { listRuns, type EvalRunRow } from "../../../core/evalLog";

// Timeline — the eval's REAL history, end to end. Two eras, honestly distinguished:
//   1. Pre-logger milestones (curated, sourced from git + README + embedder-comparison.md):
//      real runs from before the eval logger existed, on SMALLER/different corpora, so they
//      have headline numbers but no per-case capture → shown as milestones, no detail page.
//   2. Logged runs (from eval_runs): every run since the logger, on the 45-case / 4-filing
//      corpus, with full per-case detail + delta vs the previous run.
// Nothing is backdated or faked: era 1 is documented fact (with its source), era 2 is recorded
// data. The metrics are NOT one comparable series — each era ran on a different corpus, and a
// SMALLER eval scored HIGHER precisely because it was less trustworthy (the 6-case 1.00).
export const dynamic = "force-dynamic";

interface Milestone {
  date: string;
  title: string;
  corpus: string;
  retrieval?: string;
  answer?: string;
  note: string;
  ref: string;
}

// Curated, real, sourced. (See git log + README "How we tuned the pipeline" + embedder-comparison.md.)
const MILESTONES: Milestone[] = [
  {
    date: "2026-06-07",
    title: "v0 — walking skeleton",
    corpus: "3 cases (dummy doc)",
    note: "Mock embedder + in-memory store + mock generator: the pipeline walks end-to-end. No real quality signal yet — by design.",
    ref: "08f3144",
  },
  {
    date: "2026-06-12",
    title: "Real-PDF ingestion + page chunking",
    corpus: "6 cases (Berkshire 2023)",
    note: "unpdf ingestion + token-aware per-page chunking. Caught a chunker bug that severed decimals ($96.2 → \"$96. 2\").",
    ref: "7f9ac66 / 29176bf",
  },
  {
    date: "2026-06-13",
    title: "Tuning: breadth 5→20, chunks 800→350",
    corpus: "6 cases",
    retrieval: "1.00",
    answer: "1.00",
    note: "Wider retrieval lifted answer 0.67→0.83; 350-char chunks then fixed the q005 float-dilution miss → 1.00. The 6-case 1.00 was UNTRUSTWORTHY — too small — which is exactly why we grew the set.",
    ref: "2ea089a / 19fb493",
  },
  {
    date: "2026-06-13",
    title: "Honest 20-case baseline (local)",
    corpus: "20 cases (Berkshire + Meridian)",
    retrieval: "0.82",
    answer: "0.85",
    note: "nomic-embed-text + llama3, in-memory. Growing 6→20 (multi-fact + refusal) dropped the score to an honest 0.82/0.85 and surfaced the real misses (q008/q013/q014).",
    ref: "69e8dba",
  },
  {
    date: "2026-06-16",
    title: "pgvector store (Neon)",
    corpus: "20 cases",
    note: "PgVectorStore behind the VectorStore seam — serverless-ready, so the index can live off-disk for deploy.",
    ref: "b5d3452 / ff72942",
  },
  {
    date: "2026-06-17",
    title: "v1 deployed — Jina v3 + Groq 70b",
    corpus: "20 cases (Berkshire + Meridian)",
    retrieval: "0.94",
    answer: "0.95",
    note: "Hosted stack: Jina v3 + Groq llama-3.3-70b + pgvector. The stronger embedder lifted retrieval 0.82→0.94. Live demo shipped.",
    ref: "d5b8613 / dfea5c7",
  },
  {
    date: "2026-06-17",
    title: "Embedder study (eval-driven selection)",
    corpus: "20 cases · retrieval hit@20",
    retrieval: "0.94",
    note: "nomic 0.82 · nomic+prefix 0.71 (regressed) · qwen3-0.6b 0.88 · qwen3-8b 0.88 · Jina v3 0.94 (winner). Query/doc asymmetry + reranker shelved as measured negatives. MTEB rank ≠ our-eval.",
    ref: "embedder-comparison.md",
  },
  {
    date: "2026-06-18",
    title: "Multi-hop probe (24 cases)",
    corpus: "24 cases (Berkshire)",
    note: "Added 4 multi-hop cases (q021–q024). Groq computed same-chunk and one cross-page difference correctly — encouraging, but too few cases to decide on v2.",
    ref: "q021–q024",
  },
];

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
function delta(cur: number, prev: number | null): { text: string; color: string } {
  if (prev == null) return { text: "", color: "#57606a" };
  const d = cur - prev;
  if (Math.abs(d) < 0.005) return { text: "±0", color: "#57606a" };
  return { text: `${d > 0 ? "▲ +" : "▼ "}${(d * 100).toFixed(0)}pp`, color: d > 0 ? "#1a7f37" : "#cf222e" };
}

function Dot({ filled }: { filled: boolean }) {
  return (
    <span
      style={{
        position: "absolute",
        left: -27,
        top: 4,
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: filled ? "#0969da" : "#fff",
        border: `2px solid ${filled ? "#fff" : "#8c959f"}`,
        boxShadow: filled ? "none" : "0 0 0 1px #8c959f",
      }}
    />
  );
}

export default async function Timeline() {
  let runs: EvalRunRow[] = [];
  let error: string | null = null;
  try {
    runs = (await listRuns(50)).reverse(); // oldest first
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
        The whole story, in order. <strong>Milestones</strong> (hollow dots) are real runs from
        before the eval logger existed — sourced from the git history and{" "}
        <a href="https://github.com/canglang-social/ragx/blob/master/docs/embedder-comparison.md">docs</a>,
        on smaller corpora, so they have headline numbers but <strong>no per-case detail page</strong>
        {" "}(the per-case data was never captured). <strong>Logged runs</strong> (solid dots) are
        recorded since the logger, on the 45-case / 4-filing corpus, each with a clickable detail
        page and a delta vs the previous run.
      </p>
      <p style={{ color: "#9a6700", background: "#fff8c5", padding: "8px 12px", borderRadius: 6, fontSize: 14 }}>
        ⚠ These metrics are <strong>not one comparable series</strong> — each era ran on a different
        corpus. A <em>smaller</em> eval scored <em>higher</em> (the 6-case 1.00) precisely because it
        was less trustworthy; growing and hardening the set is what made the numbers honest. Compare
        within an era, not across.
      </p>

      <h2 style={{ fontSize: 15, color: "#57606a", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Milestones · pre-logger (documented)
      </h2>
      <div style={{ borderLeft: "2px solid #d0d7de", marginLeft: 8, paddingLeft: 20 }}>
        {MILESTONES.map((m, i) => (
          <div key={i} style={{ position: "relative", marginBottom: 24 }}>
            <Dot filled={false} />
            <div style={{ fontSize: 13, color: "#57606a" }}>
              {m.date} · <span style={{ fontFamily: "monospace" }}>{m.ref}</span> ·{" "}
              <span style={{ fontStyle: "italic" }}>milestone — no per-case data</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, margin: "2px 0" }}>{m.title}</div>
            <div style={{ fontSize: 14 }}>
              <span style={{ color: "#57606a" }}>{m.corpus}</span>
              {(m.retrieval || m.answer) && (
                <>
                  {"   ·   "}
                  {m.retrieval && (
                    <>
                      retrieval <strong>{m.retrieval}</strong>
                    </>
                  )}
                  {m.answer && (
                    <>
                      {"   ·   "}answer <strong>{m.answer}</strong>
                    </>
                  )}
                </>
              )}
            </div>
            <div style={{ fontSize: 14, color: "#57606a", marginTop: 4 }}>{m.note}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 15, color: "#1a7f37", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Logged runs · 45-case corpus (full per-case detail)
      </h2>
      {error && <p style={{ color: "#cf222e" }}>Could not load runs: {error}</p>}
      {!error && runs.length === 0 && <p style={{ color: "#57606a" }}>No runs recorded yet.</p>}
      <div style={{ borderLeft: "2px solid #0969da", marginLeft: 8, paddingLeft: 20 }}>
        {runs.map((r, i) => {
          const prev = i > 0 ? runs[i - 1] : null;
          const dR = delta(r.retrieval_hit, prev?.retrieval_hit ?? null);
          const dA = delta(r.answer_acc, prev?.answer_acc ?? null);
          return (
            <div key={r.id} style={{ position: "relative", marginBottom: 28 }}>
              <Dot filled />
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
