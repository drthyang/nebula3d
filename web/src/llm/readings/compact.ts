// A tool result shortened to save room in a long reply: its verdict, headline
// and the numbers its measures stand on stay; per-plane lists and long texts
// go. Implementation behind readings/index.ts (`shorten`): it shortens the
// model's copy of a result, in the conversation, and never the step's
// readings. The model can call the tool again for the whole result, and the
// answer checks always judge against the whole one (`found`).

export const COMPACTED = "shortened to save room; call the tool again for the whole result";

// Texts that carry the reading itself stay, cut to this length; others longer
// than LONG_TEXT go.
const READING_KEYS = new Set(["verdict", "headline", "summary", "reading", "error", "missing", "already_called"]);
const READING_TEXT = 240;
const LONG_TEXT = 120;
const MAX_DEPTH = 3;
const MAX_LIST = 4; // a short list of plain values stays

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isPlain = (v: Json): v is null | boolean | number | string => v === null || typeof v !== "object";

function prune(value: Json, key: string, depth: number): Json | undefined {
  if (typeof value === "string") {
    if (READING_KEYS.has(key)) return value.length > READING_TEXT ? `${value.slice(0, READING_TEXT)}…` : value;
    return value.length > LONG_TEXT ? undefined : value;
  }
  if (isPlain(value)) return value;
  if (Array.isArray(value)) {
    if (value.length <= MAX_LIST && value.every(isPlain)) return value;
    return `(${value.length} items)`;
  }
  if (depth >= MAX_DEPTH) return undefined;
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(value)) {
    const kept = prune(v, k, depth + 1);
    if (kept !== undefined) out[k] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A tool result's text, shortened: a JSON result pruned to its readings and numbers, other text cut. */
export function compactResult(text: string): string {
  let parsed: Json;
  try {
    parsed = JSON.parse(text) as Json;
  } catch {
    return text.length > 400 ? `${text.slice(0, 400)}… (${COMPACTED})` : text;
  }
  if (isPlain(parsed)) return text;
  const pruned = prune(parsed, "", 0);
  const body = pruned && typeof pruned === "object" && !Array.isArray(pruned) ? pruned : { result: pruned ?? null };
  const out = JSON.stringify({ ...body, compacted: COMPACTED });
  return out.length < text.length ? out : text;
}

/** Whether a tool message's text was already shortened. */
export const isCompacted = (text: string): boolean => text.includes(COMPACTED);

/** A tool message's text, shortened once: a text already shortened is left as it is. */
export const shorten = (text: string): string => (isCompacted(text) ? text : compactResult(text));
