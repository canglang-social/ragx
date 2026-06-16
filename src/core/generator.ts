import type { Answer, Citation, RetrievedChunk } from "./types";

// SEAM 3: Generator. Turns retrieved context into a cited answer. The real one
// (Claude / Ollama LLM) goes behind this interface in v1.

export interface Generator {
  readonly name: string;
  generate(question: string, context: RetrievedChunk[]): Promise<Answer>;
}

function dedupeCitations(context: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of context) {
    const key = `${c.metadata.sourceDoc}#${c.metadata.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sourceDoc: c.metadata.sourceDoc, page: c.metadata.page });
  }
  return out;
}

// No-LLM generator: echoes the top retrieved passage and attaches citations.
// Lets you measure RETRIEVAL quality in isolation before adding a real model.
export class MockGenerator implements Generator {
  readonly name = "mock";

  async generate(_question: string, context: RetrievedChunk[]): Promise<Answer> {
    const top = context[0];
    const text = top
      ? `Based on the retrieved context: "${top.text}"`
      : "No relevant context was retrieved.";
    return { text, citations: dedupeCitations(context) };
  }
}

// Real local generator (D10). Grounded: answers ONLY from the retrieved context,
// says "I don't know" when the answer isn't there. temperature 0 so eval runs
// are deterministic. Requires `ollama serve` + a chat model (default llama3).
export class OllamaGenerator implements Generator {
  readonly name: string;

  constructor(
    private model = process.env.GEN_MODEL ?? "llama3",
    private host = process.env.OLLAMA_HOST ?? "http://localhost:11434",
  ) {
    this.name = `ollama:${this.model}`;
  }

  async generate(question: string, context: RetrievedChunk[]): Promise<Answer> {
    if (context.length === 0) {
      return { text: "I don't know.", citations: [] };
    }
    const passages = context
      .map((c, i) => `[${i + 1}] (${c.metadata.sourceDoc} p${c.metadata.page})\n${c.text}`)
      .join("\n\n");
    const system =
      "You answer questions about financial filings using ONLY the provided context passages. " +
      'Quote the exact figure or fact. If the answer is not in the context, reply exactly "I don\'t know." ' +
      "Be concise: one sentence, no preamble, no commentary.";
    const user = `Context:\n${passages}\n\nQuestion: ${question}`;

    const res = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama chat failed: ${res.status}`);
    const json = (await res.json()) as { message: { content: string } };
    return { text: json.message.content.trim(), citations: dedupeCitations(context) };
  }
}

// OpenAI-compatible generator (G15). One impl for ANY provider that speaks the
// OpenAI chat API — OpenAI, Groq, Together, Fireworks, even a self-hosted Ollama.
// Switch provider with env (GEN_BASE_URL / GEN_MODEL / GEN_API_KEY), no code change.
// This is the deploy generator, since Vercel can't run Ollama.
export class OpenAIGenerator implements Generator {
  readonly name: string;

  constructor(
    private model = process.env.GEN_MODEL ?? "gpt-4o-mini",
    private baseUrl = process.env.GEN_BASE_URL ?? "https://api.openai.com/v1",
    private apiKey = process.env.GEN_API_KEY ?? "",
  ) {
    this.name = `openai:${this.model}`;
  }

  async generate(question: string, context: RetrievedChunk[]): Promise<Answer> {
    if (context.length === 0) {
      return { text: "I don't know.", citations: [] };
    }
    const passages = context
      .map((c, i) => `[${i + 1}] (${c.metadata.sourceDoc} p${c.metadata.page})\n${c.text}`)
      .join("\n\n");
    const system =
      "You answer questions about financial filings using ONLY the provided context passages. " +
      'Quote the exact figure or fact. If the answer is not in the context, reply exactly "I don\'t know." ' +
      "Be concise: one sentence, no preamble, no commentary.";
    const user = `Context:\n${passages}\n\nQuestion: ${question}`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI-compatible chat failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return { text: json.choices[0].message.content.trim(), citations: dedupeCitations(context) };
  }
}
