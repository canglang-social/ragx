"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

interface Citation {
  sourceDoc: string;
  page: number;
}

interface ApiResult {
  answer: { text: string; citations: Citation[] };
}

const EXAMPLES = [
  "What was Berkshire Hathaway's insurance float at the end of 2023?",
  "What were Berkshire Hathaway's operating earnings in 2023?",
  "How much bitcoin does Berkshire Hathaway hold?", // not in the filing → "I don't know"
];

export default function Home() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(q: string): Promise<void> {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setQuestion(trimmed);
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setResult((await res.json()) as ApiResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    void run(question);
  }

  return (
    <main style={styles.main}>
      <header>
        <h1 style={styles.h1}>ragx</h1>
        <p style={styles.subtitle}>
          Ask a question about real financial filings — answers are grounded in the source and
          cite the page. If the answer isn&apos;t in the documents, it says so.
        </p>
      </header>

      <form onSubmit={onSubmit} style={styles.form}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about the Berkshire Hathaway 2023 annual report…"
          style={styles.input}
          aria-label="Question"
        />
        <button type="submit" disabled={loading || !question.trim()} style={styles.button}>
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div style={styles.examples}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => void run(ex)} disabled={loading} style={styles.chip}>
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div style={styles.error} role="alert">
          ⚠️ {error}
        </div>
      )}

      {loading && <p style={styles.muted}>Retrieving and generating…</p>}

      {result && (
        <section style={styles.answer} aria-live="polite">
          <p style={styles.answerText}>{result.answer.text}</p>
          {result.answer.citations.length > 0 && (
            <div style={styles.sources}>
              <span style={styles.sourcesLabel}>Sources</span>
              <ul style={styles.sourceList}>
                {result.answer.citations.map((c) => (
                  <li key={`${c.sourceDoc}#${c.page}`} style={styles.sourceItem}>
                    {c.sourceDoc} · p.{c.page}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <footer style={styles.footer}>
        RAG over financial filings · retrieval 0.94 / answer 0.95 on a 20-case eval ·{" "}
        <a href="/eval" style={styles.evalLink}>
          see the eval dashboard →
        </a>
      </footer>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "48px 20px 64px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    color: "#1a1a1a",
    lineHeight: 1.55,
  },
  h1: { fontSize: 30, fontWeight: 700, margin: "0 0 6px" },
  subtitle: { margin: "0 0 24px", color: "#555", fontSize: 15 },
  form: { display: "flex", gap: 8 },
  input: {
    flex: 1,
    padding: "10px 12px",
    fontSize: 15,
    border: "1px solid #ccc",
    borderRadius: 8,
    outline: "none",
  },
  button: {
    padding: "10px 18px",
    fontSize: 15,
    fontWeight: 600,
    color: "#fff",
    background: "#2563eb",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  examples: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chip: {
    padding: "6px 12px",
    fontSize: 13,
    color: "#374151",
    background: "#f3f4f6",
    border: "1px solid #e5e7eb",
    borderRadius: 999,
    cursor: "pointer",
    textAlign: "left",
  },
  error: {
    marginTop: 20,
    padding: "12px 14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#991b1b",
    fontSize: 14,
  },
  muted: { marginTop: 20, color: "#777", fontSize: 14 },
  answer: {
    marginTop: 24,
    padding: 20,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
  },
  answerText: { margin: 0, fontSize: 17 },
  sources: { marginTop: 16, paddingTop: 14, borderTop: "1px solid #e5e7eb" },
  sourcesLabel: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#6b7280", letterSpacing: 0.5 },
  sourceList: { margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 8 },
  sourceItem: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    color: "#374151",
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: "4px 8px",
  },
  footer: { marginTop: 40, color: "#9ca3af", fontSize: 13 },
  evalLink: { color: "#2563eb", textDecoration: "none" },
};
