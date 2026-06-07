"use client";

import { useState, type FormEvent } from "react";

interface Citation {
  sourceDoc: string;
  page: number;
}

interface ApiResult {
  answer: { text: string; citations: Citation[] };
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(e: FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    setResult(await res.json());
    setLoading(false);
  }

  return (
    <main>
      <h1>ragx</h1>
      <p>Ask a question about the ingested financial filings.</p>

      <form onSubmit={ask} style={{ display: "flex", gap: 8 }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What were Acme's total net sales in fiscal 2023?"
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={loading || !question}>
          Ask
        </button>
      </form>

      {loading && <p>Thinking…</p>}

      {result && (
        <section style={{ marginTop: 16 }}>
          <p>{result.answer.text}</p>
          {result.answer.citations.length > 0 && (
            <>
              <strong>Sources</strong>
              <ul>
                {result.answer.citations.map((c, i) => (
                  <li key={i}>
                    {c.sourceDoc} — p.{c.page}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
