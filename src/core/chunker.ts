// Splits page text into overlapping windows small enough to embed well.
// Not a seam — pure ingestion logic — but kept here as a testable unit.
//
// WHY: real filing pages run 4k–10k chars. One vector can't represent a page
// that mixes ten facts, and it overflows the embedder's context (nomic ~2048
// tokens). We split into ~200-token windows with overlap so a fact isn't
// severed at a window boundary. Token count is approximated as chars/4.

export interface ChunkOptions {
  maxChars?: number; // target window size; nomic token ≈ 4 chars, so 800 ≈ 200 tokens
  overlapChars?: number; // carried-over tail between consecutive windows
}

const DEFAULTS = { maxChars: 800, overlapChars: 120 };

export function splitText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = opts.maxChars ?? DEFAULTS.maxChars;
  const overlapChars = opts.overlapChars ?? DEFAULTS.overlapChars;

  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // Atomic segments: prefer sentence boundaries, fall back to words. Any segment
  // longer than maxChars (e.g. a dense table row) is hard-split so no window
  // ever exceeds the limit.
  const raw = clean.match(/[^.!?]+[.!?]+|\S+/g) ?? [clean];
  const segments = raw.flatMap((s) => (s.length > maxChars ? hardSplit(s.trim(), maxChars) : [s.trim()]));

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

function hardSplit(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
