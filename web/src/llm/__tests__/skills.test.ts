// NEBULA Pilot's skills: bundled from .claude/skills, listed by name in the
// system prompt, read whole with read_skill, and a firm rule on top: a stage's
// settings change, and the stage is tuned, only after its skill has been read.

import { describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import {
  allSkills,
  frontmatter,
  readSkill,
  REFERENCE_MAX_CHARS,
  sectionsOf,
  skillsPrompt,
  skillsReadIn,
  STAGE_SKILL,
} from "../skills";
import { CHAT_TOOLS, runToolCall, unreadSkillRefusal, type ToolContext } from "../tools";

const call = (name: string, args: Record<string, unknown>) => ({ id: name, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });

describe("the skills", () => {
  it("bundles the three drafts, each with its parts and its status", () => {
    expect(allSkills().map((s) => s.name)).toEqual(["bragg-node-audit", "delta-pdf-interpretation", "reduction-qc"]);
    for (const s of allSkills()) {
      expect(s.description.length).toBeGreaterThan(80);
      expect(s.body).toContain("Draft: awaiting the user's interview");
      for (const part of ["## Steps", "## Firm rules (enforced in code)", "## Acceptance checklist", "## Failure modes", "## What to report"]) {
        expect(s.body, `${s.name}: ${part}`).toContain(part);
      }
      expect(s.body, `${s.name} marks its judgment calls`).toContain("(to confirm with the user)");
      expect(s.references.length).toBeGreaterThan(0);
    }
  });

  it("is the method of every stage", () => {
    const names = new Set(allSkills().map((s) => s.name));
    for (const skill of Object.values(STAGE_SKILL)) expect(names.has(skill)).toBe(true);
  });

  it("lists names and descriptions in the system prompt, not the bodies", () => {
    const prompt = skillsPrompt();
    for (const s of allSkills()) expect(prompt).toContain(`- ${s.name}: ${s.description}`);
    expect(prompt).toMatch(/only after its skill has been read/);
    expect(prompt).not.toContain("## Steps");
  });

  it("reads a skill whole, with its references named", () => {
    const text = readSkill("reduction-qc");
    expect(text.startsWith("Skill reduction-qc\n\n# Reduction QC")).toBe(true);
    expect(text).toContain("References of this skill");
    expect(text).toContain("- ub_refinement: how the UB is refined and checked");
    expect(() => readSkill("nope")).toThrow(/no skill named "nope"; the skills are bragg-node-audit, delta-pdf-interpretation, reduction-qc/);
  });

  it("reads a long reference by section, a short one whole", () => {
    const short = readSkill("reduction-qc", "ub_refinement");
    expect(short).toContain("docs/algorithms/ub_refinement.md");
    expect(short).not.toContain("The page continues");
    const long = readSkill("bragg-node-audit", "bragg_cleanup");
    expect(long).toContain("The page continues. Read one section");
    expect(long.length).toBeLessThan(REFERENCE_MAX_CHARS + 2000);
    const section = readSkill("bragg-node-audit", "bragg_cleanup", "significance gate");
    expect(section).toContain('section "Significance Gate"');
    expect(() => readSkill("bragg-node-audit", "bragg_cleanup", "nope")).toThrow(/has no section "nope"; its sections are/);
    expect(() => readSkill("bragg-node-audit", "nope")).toThrow(/has no reference "nope"; it has bragg_cleanup/);
  });

  it("splits a page at its ## headings, and parses folded frontmatter", () => {
    expect(sectionsOf("# T\nintro\n## A\na\n## B\nb").map((x) => x.heading)).toEqual(["A", "B"]);
    expect(frontmatter("name: x\ndescription: >-\n  one\n  two\nother: 'q'")).toEqual({ name: "x", description: "one two", other: "q" });
  });
});

describe("the firm rule", () => {
  it("refuses until each stage's skill is read, and names what to read", () => {
    const none = new Set<string>();
    expect(unreadSkillRefusal("update_settings", { changes: { punchMinSig: 6 } }, none)).toMatch(/call read_skill with name "bragg-node-audit"\. It is how the user works on the Bragg punch stage/);
    expect(unreadSkillRefusal("tune_pipeline", {}, none)).toMatch(/"reduction-qc" and "bragg-node-audit" and "delta-pdf-interpretation"/);
    expect(unreadSkillRefusal("update_settings", { changes: { punchMinSig: 6 } }, new Set(["bragg-node-audit"]))).toBeNull();
    expect(unreadSkillRefusal("assess_stage", { stage: "punch" }, none)).toBeNull();
  });

  it("counts the skills read earlier in the conversation, not a reference or a failed read", () => {
    const step = (args: Record<string, unknown>, status: "done" | "error" = "done") => ({ id: "s", name: "read_skill", args, status });
    const read = skillsReadIn([
      { steps: [step({ name: "reduction-qc" }), step({ name: "bragg-node-audit", reference: "bragg_cleanup" })] },
      { steps: [step({ name: "delta-pdf-interpretation" }, "error")] },
      {},
    ]);
    expect([...read]).toEqual(["reduction-qc"]);
  });

  it("holds in the executor: a change waits for read_skill, then goes through", async () => {
    usePipelineStore.setState({ punchMinSig: "4" });
    const dataset = { id: "demo", raw_name: "demo.nxs", stem: "demo", temperature: null, stages: [] } as unknown as Dataset;
    const ctx: ToolContext = { dataset, datasets: [dataset], skillsRead: new Set() };
    const refused = await runToolCall(call("update_settings", { changes: { punchMinSig: 6 } }), CHAT_TOOLS, ctx);
    expect(refused.ok).toBe(false);
    expect(refused.text).toMatch(/^Error: read the method first: call read_skill with name "bragg-node-audit"/);
    expect(usePipelineStore.getState().punchMinSig).toBe("4");

    const skill = await runToolCall(call("read_skill", { name: "bragg-node-audit" }), CHAT_TOOLS, ctx);
    expect(skill.ok).toBe(true);
    expect(skill.text.startsWith("Skill bragg-node-audit\n\n# Bragg-node audit")).toBe(true); // as written, not JSON
    expect(skill.text).not.toContain("… [truncated]");
    expect(ctx.skillsRead?.has("bragg-node-audit")).toBe(true);

    const changed = await runToolCall(call("update_settings", { changes: { punchMinSig: 6 } }), CHAT_TOOLS, ctx);
    expect(changed.ok).toBe(true);
    expect(usePipelineStore.getState().punchMinSig).toBe("6");

    // The app's own calls, which set no skillsRead, are not gated.
    const own = await runToolCall(call("update_settings", { changes: { punchMinSig: 5 } }), CHAT_TOOLS, { dataset, datasets: [dataset] });
    expect(own.ok).toBe(true);
    expect((await runToolCall(call("read_skill", { name: "nope" }), CHAT_TOOLS, ctx)).text).toMatch(/^Error: invalid arguments — no skill named "nope"/);
  });
});
