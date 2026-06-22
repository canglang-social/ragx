import { NextResponse } from "next/server";
import { answerQuestion, defaultDeps } from "@/core/rag";

// Node runtime (not edge): the pg driver needs Node APIs. Deps are env-selected —
// on Vercel: VECTOR_STORE=pg + hosted embedder/generator; locally: in-memory + Ollama.
export const runtime = "nodejs";

// The v2 stack is multi-step — a cross-document query fans out (planner) into several
// sub-queries, each a vector + full-text round-trip, then a rerank and a generation.
// That can run ~15s, past Vercel's default function limit. 60s needs a Pro plan (Hobby
// caps at 10s regardless); on Hobby the heaviest cross-doc queries may still time out.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const { question } = (await req.json()) as { question?: string };
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  const result = await answerQuestion(question, defaultDeps());
  return NextResponse.json(result);
}
