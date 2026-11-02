// A tool result shortened to save room in a long reply: its verdict, headline
// and the numbers its measures stand on stay; per-plane lists and long texts
// go. A skill's core keeps its head, its `## Gates` and its `## Steps`; one
// section read on request, or a reference page, becomes one line naming it;
// another text that is no JSON (an error) keeps its head (below).
// Implementation behind readings/index.ts (`shorten`): it shortens the model's
// copy of a result, in the conversation, and never the step's readings. The
// model can call the tool again for the whole result, and the answer checks
// always judge against the whole one (`found`).

export const COMPACTED = "shortened to save room; call the tool again for the whole result";

// A text that is no JSON keeps its first TEXT_HEAD characters.
export const TEXT_HEAD = 400;

// A skill's core (THY-63 R4 and R5, docs/pilot-context-design.md C5 and C7):
// read_skill returns "Skill <name>", a blank line, the head (title and what
// the skill is for), `## Gates` (the thresholds and the rules), `## Steps`,
// then, after a `---` line, the parts left for a read on request (Details,
// references). Shortened, it keeps the head and everything from `## Gates` to
// the end of `## Steps` (the next heading of level 1 or 2 after them, a `---`
// line or the end): the method the model works by, which a head of TEXT_HEAD
// characters alone cut away until R5. What goes is the list of what is left
// for later. A skill's text without `## Gates` is shortened to its head, as
// any text.
//
// SKILL_CORE_MAX bounds what is kept: the head and the gates and steps
// together, as skillLint.test.ts holds each skill's core (head, gates, steps)
// within it, REFERENCE_MAX_CHARS (skills.ts: no read is longer). A text past it
// keeps its gates and steps to the cap, cut at a line boundary, and a marker
// says how many lines were left out. A shortened skill is at most
// SKILL_STUB_MAX characters: the cap, its name's line, the marker and the note.
//
// GATES_MAX is the cap the user's `## Gates` text is written to (plan 5.3;
// skillLint.test.ts): 1,000 characters, 8 to 10 gates of a line each. It was
// 1,200 until 2026-10-24, lowered on the user's delegation (review finding
// P5.3b) when the skills were read whole and kept only their gates.
export const GATES_MAX = 1_000;
export const SKILL_CORE_MAX = 4_000;
export const SKILL_STUB_MAX = SKILL_CORE_MAX + 300;
const CORE_MARKER = (lines: number): string =>
  `[${lines} more line${lines === 1 ? "" : "s"} of the gates and steps left out to save room: read the skill again for them]`;

// read_skill's text of a skill's core (skills.ts, readSkill): "Skill <name>", a blank line, the body.
const SKILL_TEXT = /^Skill [\w.-]+\n\n/;
const GATES_START = /^## Gates[ \t]*$/m;
const SECTION_END = /^(?:#{1,2} |---[ \t]*$)/m;
// Where the kept part ends: a heading of level 1, one of level 2 other than the gates and the steps, or a `---` line.
const CORE_END = /^(?:# |## (?!(?:Gates|Steps)[ \t]*$)|---[ \t]*$)/m;
// read_skill's text of one section of a skill, or of a reference page (whole, its index, or one section): its first line names it.
const SECTION_READ = /^(Skill [\w.-]+, section "[^"\n]*"|Reference "[^"\n]+" of skill [\w.-]+ \([^)\n]*\)(?:, section "[^"\n]*")?)\n/;

/** Where a skill's `## Gates` section is in read_skill's text of it, or null: no skill's text, or no section. */
export function gatesOf(text: string): { start: number; end: number } | null {
  if (!SKILL_TEXT.test(text)) return null;
  const heading = GATES_START.exec(text);
  if (!heading) return null;
  const bodyAt = heading.index + heading[0].length;
  const next = SECTION_END.exec(text.slice(bodyAt));
  return { start: heading.index, end: next ? bodyAt + next.index : text.length };
}

/** Where a skill's kept part (its `## Gates` to the end of its `## Steps`) is in read_skill's text of it, or null: no skill's core with gates. */
export function coreOf(text: string): { start: number; end: number } | null {
  const gates = gatesOf(text);
  if (!gates) return null;
  const next = CORE_END.exec(text.slice(gates.end));
  return { start: gates.start, end: next ? gates.end + next.index : text.length };
}

/** A part cut to `max` characters at a line boundary, with the marker; whole when it fits. */
function capPart(part: string, max: number): string {
  if (part.length <= max) return part;
  const lines = part.split("\n");
  let kept = lines[0]; // the heading
  let i = 1;
  for (; i < lines.length && kept.length + 1 + lines[i].length <= max; i++) kept += `\n${lines[i]}`;
  const left = lines.slice(i).filter((l) => l.trim()).length;
  return `${kept.trimEnd()}\n${CORE_MARKER(left)}`;
}

/**
 * A skill's text shortened to its head and its gates and steps; the text
 * whole where that saves nothing; null when it is no skill's core with gates.
 */
function skillCore(text: string): string | null {
  const at = coreOf(text);
  if (!at) return null;
  const before = text.slice(0, at.start);
  const head = before.length > TEXT_HEAD ? `${text.slice(0, TEXT_HEAD)}…` : before.trimEnd();
  const name = SKILL_TEXT.exec(text)![0].length;
  const kept = capPart(text.slice(at.start, at.end).trimEnd(), Math.max(GATES_MAX, SKILL_CORE_MAX - (head.length - name)));
  const out = `${head}\n\n${kept}\n\n(${COMPACTED})`;
  return out.length < text.length ? out : text;
}

/** One section of a skill, or a reference page, shortened to the line that names it; null when the text is neither. */
function sectionRead(text: string): string | null {
  const m = SECTION_READ.exec(text);
  if (!m) return null;
  const out = `${m[1]} (${COMPACTED})`;
  return out.length < text.length ? out : text;
}

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

/**
 * A tool result's text, shortened: a JSON result pruned to its readings and
 * numbers; a skill's core to its head, gates and steps; a section of a skill
 * or a reference page to the line that names it; other text cut to its head.
 */
export function compactResult(text: string): string {
  let parsed: Json;
  try {
    parsed = JSON.parse(text) as Json;
  } catch {
    const core = skillCore(text) ?? sectionRead(text);
    if (core !== null) return core;
    return text.length > TEXT_HEAD ? `${text.slice(0, TEXT_HEAD)}… (${COMPACTED})` : text;
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
