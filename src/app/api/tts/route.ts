import { NextResponse } from "next/server";

// Node runtime for parity with /api/query. The upstream response is piped through
// as a stream, so the server never buffers the whole MP3 in memory.
export const runtime = "nodejs";
export const maxDuration = 30;

// ElevenLabs' default public voice ("George"). Overridable per-deploy without a code change.
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
// multilingual_v2 is the quality default; flash/turbo trade quality for latency. An
// answer card is read once, not streamed word-by-word, so quality wins here.
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

// A generated answer is a paragraph or two. The cap is a cost guard: it stops a long
// paste (or a future long-form answer) from silently turning into a large TTS bill.
const MAX_CHARS = 2500;

export async function POST(req: Request): Promise<Response> {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const trimmed = text?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (trimmed.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `text is too long (${trimmed.length} chars, max ${MAX_CHARS})` },
      { status: 413 },
    );
  }

  // The key stays on the server — the browser only ever sees audio bytes.
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Text-to-speech is not configured." }, { status: 503 });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID;
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    `?output_format=mp3_44100_128`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ text: trimmed, model_id: modelId }),
  });

  if (!upstream.ok || !upstream.body) {
    // ElevenLabs returns JSON on error (401 bad key, 422 validation, 429 quota).
    // Surface a short reason instead of leaking the raw upstream payload.
    const detail = await upstream.text().catch(() => "");
    console.error(`[tts] ElevenLabs ${upstream.status}: ${detail.slice(0, 300)}`);
    const message =
      upstream.status === 401
        ? "Text-to-speech rejected the API key."
        : upstream.status === 429
          ? "Text-to-speech quota exceeded — try again later."
          : `Text-to-speech failed (${upstream.status}).`;
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store",
    },
  });
}
