import type { Chunk } from "./types";

// The text actually EMBEDDED and BM25-INDEXED: the contextual header (company/year/
// section) prepended to the raw window. Stored apart from chunk.text (the raw window)
// so retrieval gets the entity/section anchor while the reranker, generator, and
// citation see clean text. Ingest (embedding) and the BM25 index MUST agree on this
// string, so it has exactly one home.
export function contextualize(chunk: Chunk): string {
  const h = chunk.metadata.contextHeader;
  return h ? `${h}\n${chunk.text}` : chunk.text;
}

// Splits page text into overlapping windows small enough to embed well.
// Not a seam — pure ingestion logic — but kept here as a testable unit.
//
// WHY: real filing pages run 4k–10k chars. One vector can't represent a page
// that mixes ten facts, and it overflows the embedder's context (nomic ~2048
// tokens). We split into small overlapping windows so a fact isn't severed at a
// boundary and isn't diluted by surrounding text. Token count ≈ chars/4.
//
// SIZE IS TUNED, NOT GUESSED: 350 chars (~90 tokens) beat 800 on the eval — at
// 800 the "$169B float" fact was diluted inside a jargon-heavy window and ranked
// 52/1008; at 350 it surfaces and q005 passes (answer 0.83 → 1.00 on 6 cases).
// Override per-ingest with CHUNK_CHARS / CHUNK_OVERLAP to re-tune. NOTE: validate
// against a larger eval (E11) — our cases are all single-fact, which favors small
// chunks; multi-fact questions may want more context.

export interface ChunkOptions {
  maxChars?: number; // target window size; nomic token ≈ 4 chars, so 350 ≈ ~90 tokens
  overlapChars?: number; // carried-over tail between consecutive windows
}

const DEFAULTS = { maxChars: 350, overlapChars: 60 };

export function splitText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = opts.maxChars ?? DEFAULTS.maxChars;
  const overlapChars = opts.overlapChars ?? DEFAULTS.overlapChars;

  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // Atomic segments: split on sentence punctuation FOLLOWED BY whitespace, so a
  // decimal like "$96.2" (no space after the dot) is never severed — splitting on
  // the bare "." would corrupt every figure in a financial filing. Any sentence
  // longer than maxChars (e.g. a dense table row) is word-split so no window
  // exceeds the limit and no token is broken.
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const segments = sentences.flatMap((s) => (s.length > maxChars ? hardSplit(s, maxChars) : [s]));

  const windows: string[] = [];
  let cur = "";
  for (const seg of segments) {
    if (!seg) continue;
    if (cur && cur.length + 1 + seg.length > maxChars) {
      windows.push(cur);
      cur = overlapChars > 0 ? tail(cur, overlapChars) : "";
    }
    cur = cur ? `${cur} ${seg}` : seg;
  }
  if (cur) windows.push(cur);
  return windows;
}

// Last n chars of s, snapped forward to a word boundary so the overlap doesn't
// start mid-word.
function tail(s: string, n: number): string {
  if (s.length <= n) return s;
  const slice = s.slice(s.length - n);
  const sp = slice.indexOf(" ");
  return sp === -1 ? slice : slice.slice(sp + 1);
}

// Split an over-long sentence on word boundaries so no window exceeds size and
// no token (e.g. a decimal figure) is broken. A single token longer than size
// is char-split only as a last resort.
function hardSplit(s: string, size: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of s.split(/\s+/)) {
    if (word.length > size) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      for (let i = 0; i < word.length; i += size) out.push(word.slice(i, i + size));
      continue;
    }
    if (cur && cur.length + 1 + word.length > size) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out;
}
