import { NextResponse } from "next/server";
import { answerQuestion, defaultDeps } from "@/core/rag";

// Node runtime (not edge): the pg driver needs Node APIs. Deps are env-selected —
// on Vercel: VECTOR_STORE=pg + hosted embedder/generator; locally: in-memory + Ollama.
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const { question } = (await req.json()) as { question?: string };
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  const result = await answerQuestion(question, defaultDeps());
  return NextResponse.json(result);
}
