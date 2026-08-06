# ElevenLabs in ragx

Two things live here: the Listen button that shipped (F15), and notes from reading the
Agents Platform quickstart — the part that is *not* built, and why.

## What shipped: the Listen button

The answer card has a `▶ Listen` control that speaks the generated answer.

| Piece | Where | Note |
| --- | --- | --- |
| Route | `src/app/api/tts/route.ts` | `POST {text}` → `audio/mpeg` |
| UI | `src/app/page.tsx` | `speak()` + the `listenRow` block in the answer card |
| Config | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` | server-side only |

Upstream call: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`,
auth via the `xi-api-key` header, body `{text, model_id}`.

Four decisions worth defending:

1. **The key never reaches the browser.** The API key is read from `process.env` inside a
   Node-runtime route handler; the client only ever receives audio bytes. A client-side
   ElevenLabs SDK call would have shipped the key to every visitor.
2. **The upstream body is piped, not buffered.** `new Response(upstream.body, …)` streams
   the MP3 straight through, so a long answer never sits in server memory. It also means
   audio starts arriving before the whole clip is generated.
3. **One clip is cached per answer, in a ref.** Every fetch is a billed call, so replaying
   the same answer reuses its blob URL. Asking a new question revokes it — a stale clip
   that no longer matches the text on screen is worse than no clip.
4. **`eleven_multilingual_v2`, not flash/turbo.** The latency models exist for live
   conversation, where time-to-first-token dominates. An answer card is read once, on a
   deliberate click, so quality is the better trade. Both are one env var apart.

A `MAX_CHARS` cap (2500) guards cost — it stops an unexpectedly long answer from turning
into a large bill. Upstream failures are mapped to short messages (bad key / quota /
other) rather than leaking the raw ElevenLabs payload to the page.

**Not done, deliberately:** streaming playback word-by-word as the answer generates. It
needs the query pipeline to stream first, which is parked (see F14).

## What the Agents Platform is, and why ragx doesn't use it

An ElevenLabs *agent* is a hosted **ASR → LLM → TTS** loop: it listens, thinks, and
speaks, with turn-taking and interruption handled for you. You create one in the
dashboard, through `@elevenlabs/cli` (`elevenlabs agents add` / `push`), or via
`conversational_ai.agents.create()` in `@elevenlabs/elevenlabs-js`. Clients connect with
the React SDK, or you drop in the `@elevenlabs/convai-widget-embed` widget. It ships a
**Knowledge Base** — upload docs, the agent retrieves against them — plus server tools so
the agent can call your own endpoints.

The overlap with this project is exact, and that is the point: their Knowledge Base *is*
a RAG system, with the retrieval hidden. ragx exists to show the retrieval — chunking,
embeddings, hybrid search, reranking, and a 45-case eval that scores it. Handing the
documents to a hosted knowledge base would delete the artifact.

The honest fit, if this project ever wants voice Q&A over the filings: keep ragx's
retrieval and expose it as a **server tool** to an ElevenLabs agent. The agent handles
the conversation loop it is good at; ragx stays the thing that answers, and the citations
still come from our own pipeline. That is a future branch, not a v2 item — nothing in the
eval has asked for it.
