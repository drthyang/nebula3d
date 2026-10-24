// A tool result shortened to save room in a long reply: its verdict, headline
// and the numbers its measures stand on stay; per-plane lists and long texts
// go. A text that is no JSON (a skill, an error) keeps its head; a skill that
// gives its gates a `## Gates` section keeps that section too (below).
// Implementation behind readings/index.ts (`shorten`): it shortens the model's
// copy of a result, in the conversation, and never the step's readings. The
// model can call the tool again for the whole result, and the answer checks
// always judge against the whole one (`found`).

export const COMPACTED = "shortened to save room; call the tool again for the whole result";

// A text that is no JSON keeps its first TEXT_HEAD characters.
export const TEXT_HEAD = 400;

// A skill's gates: the thresholds and rules the model works by, which a head
// of TEXT_HEAD characters cuts away. A skill opts in by writing them under a
// `## Gates` heading. Its text as read_skill returns it ("Skill <name>", then
// the body: skills.ts, readSkill) is then shortened to its head, as any text
// is, and the section whole, which runs to the next heading of level 1 or 2,
// a `---` line (readSkill's list of references follows one) or the end. A
// skill without the section is shortened as before, byte for byte.
//
// GATES_MAX bounds the section kept: past it, the section is cut at a line
// boundary and a marker says how many lines were left out. 1,200 characters
// hold 10 to 12 gates of a line each (a quantity, its limit and what follows,
// about 100 characters), twice the most a skill states today (reduction-qc
// states 5: skillLint.test.ts, GATES). They cost about 860 tokens at the
// estimator's data rate (provider/tokens.ts: 1.4 characters a token). A
// gated skill's stub stays under SKILL_STUB_MAX characters, well under half
// of any skill read today, so a turn that reads two gated skills grows by at
// most about 1.9k tokens over today's stubs once compacted: inside the 3.7k a
// 32k window keeps past MIN_REPLY on the worst turn (tokenBudget.test.ts
// holds it).
export const GATES_MAX = 1_200;
const GATES_MARKER = (lines: number): string =>
  `[${lines} more line${lines === 1 ? "" : "s"} of the gates left out to save room: read the skill again for them]`;
/** The longest a shortened skill with gates can be: the head, the section at its cap, the marker and the note. */
export const SKILL_STUB_MAX = TEXT_HEAD + GATES_MAX + 200;

// read_skill's text of a skill (skills.ts, readSkill): "Skill <name>", a blank line, the body.
const SKILL_TEXT = /^Skill [\w.-]+\n\n/;
const GATES_START = /^## Gates[ \t]*$/m;
const SECTION_END = /^(?:#{1,2} |---[ \t]*$)/m;

/** Where a skill's `## Gates` section is in read_skill's text of it, or null: no skill's text, or no section. */
export function gatesOf(text: string): { start: number; end: number } | null {
  if (!SKILL_TEXT.test(text)) return null;
  const heading = GATES_START.exec(text);
  if (!heading) return null;
  const bodyAt = heading.index + heading[0].length;
  const next = SECTION_END.exec(text.slice(bodyAt));
  return { start: heading.index, end: next ? bodyAt + next.index : text.length };
}

/** A section cut to `max` characters at a line boundary, with the marker; whole when it fits. */
function capSection(section: string, max: number): string {
  if (section.length <= max) return section;
  const lines = section.split("\n");
  let kept = lines[0]; // the heading
  let i = 1;
  for (; i < lines.length && kept.length + 1 + lines[i].length <= max; i++) kept += `\n${lines[i]}`;
  const left = lines.slice(i).filter((l) => l.trim()).length;
  return `${kept.trimEnd()}\n${GATES_MARKER(left)}`;
}

/**
 * A skill's text shortened to its head and its `## Gates` section; the text
 * whole where that saves nothing (a short skill keeps its gates whole too);
 * null when it is no skill's text with the section.
 */
function skillWithGates(text: string): string | null {
  const at = gatesOf(text);
  if (!at) return null;
  const before = text.slice(0, at.start);
  const head = before.length > TEXT_HEAD ? `${text.slice(0, TEXT_HEAD)}…` : before.trimEnd();
  const gates = capSection(text.slice(at.start, at.end).trimEnd(), GATES_MAX);
  const out = `${head}\n\n${gates}\n\n(${COMPACTED})`;
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
 * numbers; a skill's text with a `## Gates` section to its head and the
 * section; other text cut to its head.
 */
export function compactResult(text: string): string {
  let parsed: Json;
  try {
    parsed = JSON.parse(text) as Json;
  } catch {
    const gated = skillWithGates(text);
    if (gated !== null) return gated;
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
