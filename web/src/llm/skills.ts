// NEBULA Pilot's skills: the user's methods, written where Claude Code reads
// them in this repository (`.claude/skills/<name>/SKILL.md`), and bundled into
// the app for the in-app agent.
//
// Progressive disclosure: the system prompt lists each skill's name and
// description only; the model reads a skill's body with read_skill when the
// task calls for it, and a reference (listed in the skill's "## References"
// section) the same way. The fixed prompt stays small, which a local model's
// context needs.
//
// A firm rule rides on them: a pipeline stage's settings change, and the stage
// is tuned, only after its skill has been read in the conversation (runToolCall
// enforces it on every call the model makes). The tools that change or tune a
// stage declare their gate in their facts (tools/index.ts); this module words
// the refusal. It never imports the registry: the registry imports it, and the
// cycle would read SKILL_TREE before it is set.
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
  readonly references: readonly SkillReference[];
}

/** Parse a SKILL.md: frontmatter `name` and `description`, and a "## References" list. */
export function parseSkill(source: string, dir: string, files: Readonly<Record<string, string>>): Skill {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) throw new Error(`${dir}/SKILL.md has no frontmatter`);
  const meta = frontmatter(m[1]);
  if (!meta.name || !meta.description) throw new Error(`${dir}/SKILL.md needs a name and a description`);
  const body = source.slice(m[0].length).trim();
  return { name: meta.name, description: meta.description, body, references: referencesOf(body, dir, files) };
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

/** The longest reference text read_skill returns at once; a longer page is read by section. */
export const REFERENCE_MAX_CHARS = 12000;

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

/**
 * What read_skill returns: the skill's body and its references' names, or one
 * reference's text (a long page: its opening and its sections, or one section).
 * Plain Markdown, so the model reads it as written.
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
    const sections = sectionsOf(ref.text);
    if (section !== undefined) {
      const hit = sections.find((x) => x.heading.toLowerCase() === section.trim().toLowerCase());
      if (!hit) throw new Error(`${ref.name} has no section "${section}"; its sections are ${sections.map((x) => x.heading).join("; ")}`);
      return `${head}, section "${hit.heading}"\n\n${clip(hit.text)}`;
    }
    const text = ref.text.trim();
    if (text.length <= REFERENCE_MAX_CHARS) return `${head}\n\n${text}`;
    return (
      `${head}\n\n${clip(text)}\n\n[The page continues. Read one section with read_skill and \`section\`: ` +
      `${sections.map((x) => x.heading).join("; ")}]`
    );
  }
  const refs = skill.references.length
    ? `\n\n---\nReferences of this skill (read one with read_skill and \`reference\`):\n${skill.references.map((r) => `- ${r.name}: ${r.description}`).join("\n")}`
    : "";
  return `Skill ${skill.name}\n\n${skill.body}${refs}`;
}

/**
 * Why a call that changes or tunes the stages `acted` must wait, or null: the
 * skills of those stages that have not been read in the conversation.
 */
export function refusalFor(acted: readonly TuneStage[], doing: Gate["doing"], read: ReadonlySet<string>): string | null {
  const stages = acted.filter((s) => !read.has(STAGE_SKILL[s]) && skillNamed(STAGE_SKILL[s]));
  if (!stages.length) return null;
  const skills = unique(stages.map((s) => STAGE_SKILL[s]));
  const what = stages.map((s) => STAGE_LABEL[s]).join(", ");
  return (
    `read the method first: call read_skill with name ${skills.map((s) => `"${s}"`).join(" and ")}. ` +
    `It is how the user works on the ${what} stage${stages.length > 1 ? "s" : ""}, and this ${doing} ` +
    "waits until it has been read in this conversation."
  );
}

/** The skills read in a conversation: every read_skill step that ran without an error. */
export function skillsReadIn(turns: readonly { steps?: readonly AgentStep[] }[]): Set<string> {
  const read = new Set<string>();
  for (const t of turns) {
    for (const s of t.steps ?? []) {
      if (s.name === "read_skill" && s.status === "done" && typeof s.args.name === "string" && s.args.reference === undefined) read.add(s.args.name);
    }
  }
  return read;
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

const clip = (text: string): string => (text.length <= REFERENCE_MAX_CHARS ? text : `${text.slice(0, REFERENCE_MAX_CHARS)}…`);
