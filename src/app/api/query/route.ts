import { NextResponse } from "next/server";
import { answerQuestion, defaultDeps } from "@/core/rag";

// NOTE: defaultDeps() uses InMemoryVectorStore, which reads data/index.json from
// disk. That works in `next dev` locally after `npm run ingest`, but NOT on
// Vercel (serverless, no persistent disk). Swap in a PgVectorStore before deploy.
export async function POST(req: Request): Promise<Response> {
  const { question } = (await req.json()) as { question?: string };
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  const result = await answerQuestion(question, defaultDeps());
  return NextResponse.json(result);
}
