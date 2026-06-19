// SEAM 5: Planner (v2). Decides whether a question needs MULTIPLE retrievals.
//
// Why this exists — earned on a measured signal: on the 45-case eval, cross-document
// comparison was 0/6 (embedder-independent — see /eval). A single query vector for
// "compare A and B" collapses onto ONE filing, so the other entity's figure is never
// retrieved. The fix is structural, not a better embedder: decompose into per-entity
// sub-queries, retrieve each, then compare. This is the first non-linear step in the
// pipeline — still one branch, NOT a loop, so still no orchestration framework.
//
// Default is NoPlanner (passthrough). LLMPlanner is opt-in (PLANNER=llm) and A/B'd
// against the linear baseline on the same eval.

export interface Planner {
  readonly name: string;
  // Returns the sub-queries to retrieve. Length 1 = no decomposition (linear path).
  plan(question: string): Promise<string[]>;
}

// Passthrough: the question is its own only sub-query. The v0/v1 linear pipeline.
export class NoPlanner implements Planner {
  readonly name = "none";
  async plan(question: string): Promise<string[]> {
    return [question];
  }
}

// Pull a JSON string array out of an LLM reply (tolerant of code fences / prose).
function parseSubQueries(content: string, fallback: string): string[] {
  const m = content.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr: unknown = JSON.parse(m[0]);
      if (Array.isArray(arr)) {
        const qs = arr.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean);
        if (qs.length) return qs;
      }
    } catch {
      /* fall through to fallback */
    }
  }
  return [fallback];
}

// LLM planner (OpenAI-compatible chat, reuses the generator's provider/env by default).
// One call per question: emit one self-contained sub-question per entity when the
// question compares/ranks/aggregates multiple entities, else echo the question.
// FAIL-SAFE: any error or unparseable reply falls back to [question] — the planner
// must never break the pipeline, only (sometimes) improve retrieval.
export class LLMPlanner implements Planner {
  readonly name: string;

  constructor(
    private model = process.env.PLANNER_MODEL ?? process.env.GEN_MODEL ?? "gpt-4o-mini",
    private baseUrl = process.env.PLANNER_BASE_URL ?? process.env.GEN_BASE_URL ?? "https://api.openai.com/v1",
    private apiKey = process.env.PLANNER_API_KEY ?? process.env.GEN_API_KEY ?? "",
  ) {
    this.name = `llm:${this.model}`;
  }

  async plan(question: string): Promise<string[]> {
    const system =
      "You split questions about financial filings into retrieval sub-queries. " +
      "If the question compares, ranks, or aggregates MULTIPLE companies/entities " +
      '(e.g. "which had higher X, A or B", "combined X of A and B", "how much more X did A have than B"), ' +
      "output a JSON array of self-contained sub-questions — ONE per entity — each asking that entity's value in isolation. " +
      "Otherwise output a JSON array containing only the original question. " +
      "Output ONLY the JSON array.";

    const body = JSON.stringify({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
    });

    try {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body,
        });
        if (res.status === 429 && attempt < 4) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
          await new Promise((r) => setTimeout(r, waitMs + 250));
          continue;
        }
        if (!res.ok) throw new Error(`planner chat failed: ${res.status}`);
        const json = (await res.json()) as { choices: { message: { content: string } }[] };
        return parseSubQueries(json.choices[0]?.message?.content ?? "", question);
      }
    } catch {
      return [question]; // fail-safe: behave like NoPlanner
    }
  }
}

// Composition-root factory. PLANNER=llm turns on decomposition; default is passthrough.
export function makePlanner(): Planner {
  return process.env.PLANNER === "llm" ? new LLMPlanner() : new NoPlanner();
}
