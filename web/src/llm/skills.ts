// NEBULA Pilot's skills: the user's methods, written where Claude Code reads
// them in this repository (`.claude/skills/<name>/SKILL.md`), and bundled into
// the app for the in-app agent.
//
// Progressive disclosure: the system prompt lists each skill's name and
// description only; the model reads a skill with read_skill when the task
// calls for it. A skill is written as a head (what it is for), `## Gates` (its
// thresholds and rules), `## Steps` and `## Details` (THY-63 R4,
// docs/pilot-context-design.md C5): read_skill returns the core (the head, the
// gates and the steps), and Details, or one part of it, on request with
// `section`. A reference (listed in the skill's "## References" section) is
// read the same way: a short page whole, a long one by section from the index
// of its headings, each read at most REFERENCE_MAX_CHARS. The fixed prompt
// stays small, which a local model's context needs.
//
// A firm rule rides on them: a pipeline stage's settings change, and the stage
// is tuned, only after its skill's core has been read in this reply (runToolCall
// enforces it on every call the model makes), or while its text is in the
// messages the reply was sent (skillsCarriedIn). The chat sends an earlier
// turn as its text alone, so a skill read there is gone, and the refusal asks
// for it again. The tools that change or tune a stage declare their gate in
// their facts (tools/defs/); this module words the refusal. It never imports
// the registry: the registry imports it, and the cycle would read SKILL_TREE
// before it is set (imports.test.ts holds it).
//
// One switch takes the skills away (the validation's arm C): `skills: false`,
// on the conversation's tool context (ToolContext, which the agent loop, the
// executor and the tools read) and on the builders of the opening messages
// (prompts/templates.ts). It is the seam every builder of model-visible text
// reads, so nothing that names a skill is cut out of text after it is built.
// Off, the system prompt has no skills' section, read_skill is not offered (its
// facts' `needsSkills`), and no stage waits for a skill to be read. Left unset,
// the skills are on: the console and arm B.

import type { AgentStep } from "./agent";
import type { ChatMessage } from "./provider/client";
import type { Gate } from "./tools/facts";
import type { TuneStage } from "./tune/catalog";

/** Every Markdown file under the skills folder, keyed by repo path. */
const SKILL_TREE = repoKeyed(import.meta.glob("../../../.claude/skills/**/*.md", { query: "?raw", import: "default", eager: true }));
/** The docs the skills cite as references. */
const DOCS = repoKeyed(import.meta.glob("../../../docs/algorithms/*.md", { query: "?raw", import: "default", eager: true }));

/** The skill that is each stage's method: read before the stage's settings change or it is tuned. */
export const STAGE_SKILL: Readonly<Record<TuneStage, string>> = {
  rings: "reduction-qc",
  punch: "bragg-node-audit",
  backfill: "bragg-node-audit",
  flatten: "reduction-qc",
  pdf: "delta-pdf-interpretation",
};

const STAGE_LABEL: Readonly<Record<TuneStage, string>> = {
  rings: "ring removal",
  punch: "Bragg punch",
  backfill: "backfill",
  flatten: "flatten",
  pdf: "3D-ΔPDF",
};

export interface SkillReference {
  /** What read_skill's `reference` takes: the link's label. */
  readonly name: string;
  /** Repo path of the file. */
  readonly path: string;
  /** What the reference covers (the text after the link). */
  readonly description: string;
  readonly text: string;
}

export interface Skill {
  readonly name: string;
  readonly description: string;
  /** SKILL.md without its frontmatter. */
  readonly body: string;
  /**
   * What read_skill returns of the skill by default: the body up to its
   * `## Details` (or `## References`) section. In the skills' form (head,
   * `## Gates`, `## Steps`, `## Details`) it is the head, the gates and the
   * steps: the method, read whole and kept through compaction. Without those
   * sections, the whole body.
   */
  readonly core: string;
  /** The `## Details` section, heading included, read on request (read_skill's `section`); "" when it has none. */
  readonly details: string;
  readonly references: readonly SkillReference[];
}

/** The section of a skill read on request, not with its core. */
export const DETAILS = "Details";

/** Parse a SKILL.md: frontmatter `name` and `description`, its core and details, and a "## References" list. */
export function parseSkill(source: string, dir: string, files: Readonly<Record<string, string>>): Skill {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) throw new Error(`${dir}/SKILL.md has no frontmatter`);
  const meta = frontmatter(m[1]);
  if (!meta.name || !meta.description) throw new Error(`${dir}/SKILL.md needs a name and a description`);
  const body = source.slice(m[0].length).trim();
  const coreEnd = /^## (?:Details|References)[ \t]*$/m.exec(body);
  const core = (coreEnd ? body.slice(0, coreEnd.index) : body).trim();
  const details = sectionAt(body, DETAILS, 2) ?? "";
  return { name: meta.name, description: meta.description, body, core, details, references: referencesOf(body, dir, files) };
}

/**
 * The frontmatter's top-level scalars: `key: value`, a quoted value, or a
 * folded or literal block (`>-`, `|`) of indented lines.
 */
export function frontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (/^[>|][-+]?$/.test(raw)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1] === "")) block.push(lines[++i].trim());
      out[key] = raw.startsWith(">") ? block.join(" ").replace(/\s+/g, " ").trim() : block.join("\n").trim();
    } else {
      out[key] = raw.replace(/^(["'])(.*)\1$/, "$2").trim();
    }
  }
  return out;
}

/** The "## References" list: `- [label](relative/path.md) — what it covers`, continued on indented lines. */
function referencesOf(body: string, dir: string, files: Readonly<Record<string, string>>): SkillReference[] {
  const section = /^## References[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body);
  if (!section) return [];
  const items: string[] = [];
  for (const line of section[1].split("\n")) {
    if (/^\s*[-*]\s+/.test(line)) items.push(line.trim());
    else if (/^\s+\S/.test(line) && items.length) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items.flatMap((item) => {
    const ref = /^[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]+\s*)?(.*)$/.exec(item);
    if (!ref) return [];
    const path = joinPath(dir, ref[2].trim());
    const text = files[path];
    if (text === undefined) throw new Error(`${dir}/SKILL.md cites ${ref[2]}, which is not bundled (${path})`);
    return [{ name: ref[1].replace(/`/g, "").trim(), path, description: ref[3].trim(), text }];
  });
}

/** `dir` joined with a relative path, `..` resolved: a repo path. */
export function joinPath(dir: string, rel: string): string {
  const out: string[] = [];
  for (const p of [...dir.split("/"), ...rel.split("/")]) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Glob results keyed by repo path ("../../../docs/x.md" → "docs/x.md"). */
function repoKeyed(files: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [joinPath("web/src/llm", k), String(v)]));
}

let cached: readonly Skill[] | null = null;

/** Every skill in the repository, sorted by name. */
export function allSkills(): readonly Skill[] {
  if (cached) return cached;
  const files = { ...SKILL_TREE, ...DOCS };
  cached = Object.entries(SKILL_TREE)
    .filter(([path]) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(path))
    .map(([path, source]) => parseSkill(source, path.replace(/\/SKILL\.md$/, ""), files))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cached;
}

export const skillNamed = (name: string): Skill | undefined => allSkills().find((s) => s.name === name);

/** The switch, as a conversation or a builder carries it: the skills are on unless it says `skills: false`. */
export interface SkillsSwitch {
  skills?: boolean;
}

/** Whether the switch has the skills on: anything but an explicit `skills: false` (the validation's arm C). */
export const skillsOn = (s?: SkillsSwitch | null): boolean => s?.skills !== false;

/** The system prompt's skills: names and descriptions only, and the rule that rides on them. */
export function skillsPrompt(): string {
  const skills = allSkills();
  if (!skills.length) return "";
  return [
    "",
    "Skills are the user's methods, one per topic. Before you act on a topic, read its skill",
    "with read_skill: it gives the steps, the checks and what to report. A stage's settings",
    "change, and the stage is tuned, only after its skill has been read in this conversation.",
    ...skills.map((s) => `- ${s.name}: ${s.description}`),
  ].join("\n");
}

/**
 * The longest text read_skill returns of a reference page or a section at
 * once (THY-63 R4, docs/pilot-context-design.md C5: 12,000 before). A longer
 * page is read by section, from an index of its headings; a longer section,
 * part by part ("<heading> (part 2)"). A skill's core is read whole.
 */
export const REFERENCE_MAX_CHARS = 4000;

/** A Markdown page's "## " sections: heading → text, in order. */
export function sectionsOf(text: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  const re = /^## (.+)$/gm;
  const marks = [...text.matchAll(re)];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index! : text.length;
    out.push({ heading: m[1].trim(), text: text.slice(m.index!, end).trim() });
  });
  return out;
}

/** A page's headings of level 2 to 4, outside code fences, in order: what read_skill's `section` names. */
export function headingsOf(text: string): { level: number; heading: string; at: number }[] {
  const out: { level: number; heading: string; at: number }[] = [];
  let fenced = false;
  let at = 0;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const h = fenced ? null : /^(#{2,4}) (.+?)[ \t]*$/.exec(line);
    if (h) out.push({ level: h[1].length, heading: h[2].trim(), at });
    at += line.length + 1;
  }
  return out;
}

/** The section under a heading (level 2 to 4, matched without case), heading included, to the next heading of its level or above. */
function sectionAt(text: string, heading: string, level?: number): string | null {
  const heads = headingsOf(text);
  const want = heading.trim().toLowerCase();
  const i = heads.findIndex((h) => h.heading.toLowerCase() === want && (level === undefined || h.level === level));
  if (i < 0) return null;
  const next = heads.slice(i + 1).find((h) => h.level <= heads[i].level);
  return text.slice(heads[i].at, next ? next.at : text.length).trim();
}

/**
 * A text in parts of at most `max` characters, in order, cut where a paragraph
 * ends (never inside a code fence), else where a line ends, else anywhere. A
 * part is the text between two cuts as written, its blank edges trimmed.
 */
export function partsOf(text: string, max: number = REFERENCE_MAX_CHARS): string[] {
  if (text.length <= max) return [text];
  // Where a cut may fall: after a line that ends a paragraph (a blank line next, outside a fence), or after any line.
  const paragraphs: number[] = [];
  const lines: number[] = [];
  let fenced = false;
  let at = 0;
  const all = text.split("\n");
  all.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const end = at + line.length; // the line's end, before its newline
    lines.push(end);
    if (!fenced && line.trim() && i + 1 < all.length && !all[i + 1].trim()) paragraphs.push(end);
    at = end + 1;
  });
  const parts: string[] = [];
  let start = 0;
  while (text.length - start > max) {
    const fits = (c: number): boolean => c > start && c - start <= max;
    const cut = [...paragraphs].reverse().find(fits) ?? [...lines].reverse().find(fits) ?? start + max;
    const part = text.slice(start, cut).trim();
    if (part) parts.push(part);
    start = cut;
  }
  const rest = text.slice(start).trim();
  if (rest) parts.push(rest);
  return parts;
}

/** A section's part, by the name read_skill's `section` takes: "<heading>" is part 1, "<heading> (part n)" part n. */
function partOf(text: string, section: string, where: string, headings: readonly string[]): { heading: string; text: string } {
  const m = /^(.*?)\s*\(part (\d+)\)$/i.exec(section.trim());
  const name = m ? m[1] : section.trim();
  const n = m ? Number(m[2]) : 1;
  const hit = sectionAt(text, name);
  if (hit === null) throw new Error(`${where} has no section "${section}"; its sections are ${headings.join("; ")}`);
  const heading = headingsOf(hit)[0]?.heading ?? name;
  const parts = partsOf(hit);
  if (n < 1 || n > parts.length) throw new Error(`section "${heading}" of ${where} has ${parts.length} part${parts.length > 1 ? "s" : ""}`);
  const label = parts.length > 1 ? `${heading} (part ${n} of ${parts.length})` : heading;
  const more = n < parts.length ? `\n\n[The section continues: read section "${heading} (part ${n + 1})".]` : "";
  return { heading: label, text: `${parts[n - 1]}${more}` };
}

/** A long page's opening and the index of its sections, at most REFERENCE_MAX_CHARS. */
function indexOf(text: string): string {
  const heads = headingsOf(text);
  const list = heads.map((h) => `${"  ".repeat(h.level - 2)}- ${h.heading}`).join("\n");
  const index = `Sections (read one with read_skill, \`reference\` and \`section\`, by its heading):\n${list}`;
  const opening = text.slice(0, heads[0]?.at ?? text.length).trim();
  const room = REFERENCE_MAX_CHARS - index.length - 2;
  const lead = opening.length <= room ? opening : `${opening.slice(0, Math.max(0, room - 1))}…`;
  return lead ? `${lead}\n\n${index}` : index;
}

/**
 * What read_skill returns, plain Markdown, so the model reads it as written:
 * - a skill's core (head, gates and steps), with what it leaves for a read on
 *   request: its details' parts and its references, by name;
 * - with `section`, one section of the skill (Details, or a part of it by its
 *   heading);
 * - with `reference`, one document the skill cites: whole when short, else its
 *   opening and the index of its sections; with `section` too, one section.
 * A section longer than REFERENCE_MAX_CHARS is read part by part.
 */
export function readSkill(name: string, reference?: string, section?: string): string {
  const skill = skillNamed(name);
  if (!skill) throw new Error(`no skill named "${name}"; the skills are ${allSkills().map((s) => s.name).join(", ")}`);
  if (reference !== undefined) {
    const ref = skill.references.find((r) => r.name === reference);
    if (!ref) {
      const names = skill.references.map((r) => r.name);
      throw new Error(`${name} has no reference "${reference}"${names.length ? `; it has ${names.join(", ")}` : ""}`);
    }
    const head = `Reference "${ref.name}" of skill ${name} (${ref.path})`;
    const text = ref.text.trim();
    if (section !== undefined) {
      const part = partOf(text, section, ref.name, headingsOf(text).map((h) => h.heading));
      return `${head}, section "${part.heading}"\n\n${part.text}`;
    }
    return `${head}\n\n${text.length <= REFERENCE_MAX_CHARS ? text : indexOf(text)}`;
  }
  if (section !== undefined) {
    const readable = headingsOf(skill.body).filter((h) => h.heading !== "References").map((h) => h.heading);
    const part = partOf(skill.body, section, `skill ${name}`, readable);
    return `Skill ${skill.name}, section "${part.heading}"\n\n${part.text}`;
  }
  const parts = headingsOf(skill.details).filter((h) => h.level === 3).map((h) => h.heading);
  // Names only (THY-63 R5): what each part or page holds, its own read says (a
  // long page opens with its headings).
  const later = [
    skill.details
      ? `Details of this skill (read with read_skill and \`section\` "${DETAILS}", or one part by its heading)${parts.length ? `: ${parts.join("; ")}` : ""}.`
      : "",
    skill.references.length
      ? `References of this skill (read one with read_skill and \`reference\`; a long one opens with its sections): ${skill.references.map((r) => r.name).join("; ")}.`
      : "",
  ].filter(Boolean);
  return `Skill ${skill.name}\n\n${skill.core}${later.length ? `\n\n---\n${later.join("\n")}` : ""}`;
}

/**
 * Why a call that changes or tunes the stages `acted` must wait, or null: the
 * skills of those stages that have not been read in this reply (`read`). A
 * skill read in an earlier turn (`earlier`) is asked for again: its text left
 * with that turn's steps. With none read earlier, the refusal is the one the
 * gate has always given, word for word (a validation run is one reply).
 */
export function refusalFor(
  acted: readonly TuneStage[],
  doing: Gate["doing"],
  read: ReadonlySet<string>,
  earlier: ReadonlySet<string> = new Set(),
): string | null {
  const stages = acted.filter((s) => !read.has(STAGE_SKILL[s]) && skillNamed(STAGE_SKILL[s]));
  if (!stages.length) return null;
  const skills = unique(stages.map((s) => STAGE_SKILL[s]));
  const what = stages.map((s) => STAGE_LABEL[s]).join(", ");
  const names = (xs: readonly string[]): string => xs.map((s) => `"${s}"`).join(" and ");
  const again = skills.filter((s) => earlier.has(s));
  if (!again.length) {
    return (
      `read the method first: call read_skill with name ${names(skills)}. ` +
      `It is how the user works on the ${what} stage${stages.length > 1 ? "s" : ""}, and this ${doing} ` +
      "waits until it has been read in this conversation."
    );
  }
  const all = again.length === skills.length;
  const many = again.length > 1;
  const who = all ? (many ? "They were" : "It was") : `${names(again)} ${many ? "were" : "was"}`;
  return (
    `read the method ${all ? "again" : "first"}: call read_skill with name ${names(skills)}. ` +
    `${who} read earlier in the conversation, but ${many ? "their" : "its"} text is not in this reply. ` +
    `It is how the user works on the ${what} stage${stages.length > 1 ? "s" : ""}, and this ${doing} ` +
    "waits until it has been read in this reply."
  );
}

/** A message's text: its content, or its text parts (an image's message). */
const textOf = (m: ChatMessage): string =>
  typeof m.content === "string" ? m.content : m.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");

/**
 * The skills whose text the messages carry: a skill's core (its method: the
 * head, the gates and the steps, as read_skill returns it), whole, in any of
 * them (a read_skill result sent back with them, a paste). A reply sent these
 * messages has the skill's method in front of it, so the gate counts it as
 * read; a skill only named, or quoted in part, is not.
 */
export function skillsCarriedIn(messages: readonly ChatMessage[]): Set<string> {
  const texts = messages.map(textOf);
  return new Set(allSkills().filter((s) => texts.some((t) => t.includes(s.core))).map((s) => s.name));
}

/** Whether a read_skill call reads a skill's core (its method), not a section or a reference: the reads the gate counts. */
export const readsCore = (args: Readonly<Record<string, unknown>>): boolean => !given(args.reference) && !given(args.section);

/** An argument given: a string with text in it, or any other value (read_skill reads a blank string as none). */
const given = (v: unknown): boolean => (typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null);

/**
 * The skills read in a conversation's turns: every read_skill step of a
 * skill's core that ran without an error. They open no gate in a later reply, whose messages carry
 * an earlier turn's text alone; its refusal asks for them again (refusalFor).
 */
export function skillsReadIn(turns: readonly { steps?: readonly AgentStep[] }[]): Set<string> {
  const read = new Set<string>();
  for (const t of turns) {
    for (const s of t.steps ?? []) {
      if (s.name === "read_skill" && s.status === "done" && typeof s.args.name === "string" && readsCore(s.args)) read.add(s.args.name);
    }
  }
  return read;
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
