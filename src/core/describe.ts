// Family 3 (multi-representation) describer. Turns each statement-row chunk into a
// self-contained, search-friendly sentence the embedder + reranker can actually rank,
// e.g. "JPMorgan Chase 2023: total assets at year-end were $3,875,393 million." The
// embedder buries a bare number-row but ranks a sentence well — that's the whole point.
//
// ONE LLM call per statement page (all its rows at once), so cost scales with statement
// pages, not rows. OpenAI-compatible; reuses GEN_* unless DESCRIBE_* overrides. Returns
// one description per input row, or null for any row on ANY failure — descriptions are an
// optimization, never a dependency, so the caller falls back to contextHeader+text.

export async function describeRows(
  company: string | undefined,
  year: number | undefined,
  title: string,
  rows: string[],
): Promise<(string | null)[]> {
  if (rows.length === 0) return [];
  const model = process.env.DESCRIBE_MODEL ?? process.env.GEN_MODEL ?? "gpt-4o-mini";
  const baseUrl = process.env.DESCRIBE_BASE_URL ?? process.env.GEN_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.DESCRIBE_API_KEY ?? process.env.GEN_API_KEY ?? "";
  const fail = rows.map(() => null);
  const who = [company, year].filter(Boolean).join(" ") || "the company";

  const system =
    "You rewrite slices of a financial statement as search-friendly sentences. " +
    "For each numbered slice that contains figures, write a self-contained sentence (or two) naming the company, " +
    "the year, the line item(s), and the value(s) COPIED VERBATIM (keep exact figures and units). Add no facts not " +
    "present in the slice. Output ONLY a JSON array of objects {\"n\": <slice number>, \"s\": <sentence>}; you may " +
    "OMIT a slice that has no figures. Keep each n correct so descriptions stay aligned.";
  const user = `Company/year: ${who}\nStatement: ${title}\nSlices:\n${rows.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return fail;
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const m = (json.choices[0]?.message?.content ?? "").match(/\[[\s\S]*\]/);
    if (!m) return fail;
    const arr = JSON.parse(m[0]) as unknown;
    if (!Array.isArray(arr)) return fail;
    // Align by the slice number `n`, NOT array position — so a skipped slice can't shift
    // every later description onto the wrong row. Missing slices just stay null (partial
    // coverage beats wholesale fallback).
    const byN = new Map<number, string>();
    for (const o of arr) {
      const n = (o as { n?: unknown })?.n;
      const s = (o as { s?: unknown })?.s;
      if (typeof n === "number" && typeof s === "string" && s.trim()) byN.set(n, s.trim());
    }
    return rows.map((_, i) => byN.get(i + 1) ?? null);
  } catch {
    return fail;
  }
}
