// NEBULA Pilot's skills: bundled from .claude/skills, listed by name in the
// system prompt, read whole with read_skill, and a firm rule on top: a stage's
// settings change, and the stage is tuned, only after its skill has been read.
// One switch takes them away (the validation's arm C).

import { describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { SYSTEM, SYSTEM_PROMPT, TOOLS, TOOLS_PROMPT } from "../prompts/system";
import { buildChatMessages, buildStageReviewMessages, systemPrompt } from "../prompts/templates";
import type { ChatMessage } from "../provider/client";
import {
  allSkills,
  frontmatter,
  readSkill,
  REFERENCE_MAX_CHARS,
  sectionsOf,
  skillNamed,
  skillsCarriedIn,
  skillsOn,
  skillsPrompt,
  skillsReadIn,
  STAGE_SKILL,
} from "../skills";
import { callTool, CHAT_TOOLS, toolsWhere, toolsWithSkills, unreadSkillRefusal, type ToolContext } from "../tools";

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

  it("says when the flatten's Q² term goes on: when assess_stage reports a pedestal left (docs/pilot-review.md finding 5)", () => {
    const qc = allSkills().find((s) => s.name === "reduction-qc")!.body;
    const step = qc.slice(qc.indexOf("6. **The background-correction floor.**"), qc.indexOf("7. **Symmetry kept.**"));
    expect(step).toMatch(/When to turn the Q² term on:\*\* when `assess_stage` for the background\s+correction reports `pedestal_left`, set `flattenQ2` on, rerun/);
    expect(step).toMatch(/Leave it off otherwise/);
    // It names the fields assess_stage gives, judged over the whole volume
    // since 4.1, not the planes' largest it gave before.
    expect(step).toContain("`floor_trend`");
    expect(step).toContain("`floor_span_fraction`");
    expect(step).not.toMatch(/`max_floor_(trend|span_fraction)`/);
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

  it("asks again for a skill read in an earlier turn, and words the first refusal as it always has", () => {
    const none = new Set<string>();
    const flatten = { changes: { flattenQ2: true } };
    const first =
      'read the method first: call read_skill with name "reduction-qc". It is how the user works on the flatten stage, ' +
      "and this change waits until it has been read in this conversation.";
    expect(unreadSkillRefusal("update_settings", flatten, none)).toBe(first);
    expect(unreadSkillRefusal("update_settings", flatten, none, none)).toBe(first);
    expect(unreadSkillRefusal("update_settings", flatten, none, new Set(["bragg-node-audit"]))).toBe(first); // another skill read earlier
    const earlier = new Set(["reduction-qc"]);
    expect(unreadSkillRefusal("update_settings", flatten, none, earlier)).toBe(
      'read the method again: call read_skill with name "reduction-qc". It was read earlier in the conversation, but its text ' +
        "is not in this reply. It is how the user works on the flatten stage, and this change waits until it has been read in this reply.",
    );
    // Read again in this reply: the gate opens.
    expect(unreadSkillRefusal("update_settings", flatten, earlier, earlier)).toBeNull();
    // Two stages, one skill read earlier and one never: both asked for, the earlier one named.
    const both = { stages: ["flatten", "punch"] };
    expect(unreadSkillRefusal("tune_pipeline", both, none, earlier)).toBe(
      'read the method first: call read_skill with name "reduction-qc" and "bragg-node-audit". "reduction-qc" was read earlier ' +
        "in the conversation, but its text is not in this reply. It is how the user works on the flatten, Bragg punch stages, and this " +
        "tuning waits until it has been read in this reply.",
    );
    expect(unreadSkillRefusal("tune_pipeline", both, none, new Set(["reduction-qc", "bragg-node-audit"]))).toBe(
      'read the method again: call read_skill with name "reduction-qc" and "bragg-node-audit". They were read earlier in the ' +
        "conversation, but their text is not in this reply. It is how the user works on the flatten, Bragg punch stages, and this " +
        "tuning waits until it has been read in this reply.",
    );
  });

  it("counts a skill whose text the messages carry whole, not one only named or quoted in part", () => {
    const body = skillNamed("reduction-qc")!.body;
    expect([...skillsCarriedIn([{ role: "tool", tool_call_id: "c1", content: readSkill("reduction-qc") }])]).toEqual(["reduction-qc"]);
    const pasted: ChatMessage = { role: "user", content: [{ type: "text", text: `My method:\n${body}` }, { type: "image_url", image_url: { url: "data:," } }] };
    expect([...skillsCarriedIn([pasted])]).toEqual(["reduction-qc"]);
    expect(skillsCarriedIn([{ role: "assistant", content: "I read the reduction-qc skill and followed it." }]).size).toBe(0);
    expect(skillsCarriedIn([{ role: "assistant", content: body.slice(0, body.length - 1) }]).size).toBe(0);
    // The system prompt lists the skills by name and description: it carries none of them.
    expect(skillsCarriedIn(buildChatMessages({} as never, [], "q", null, { tools: true })).size).toBe(0);
    expect(skillsCarriedIn(buildStageReviewMessages({} as never, "flatten", null, { tools: true })).size).toBe(0);
  });

  it("lists the skills read in a conversation's turns, not a reference or a failed read", () => {
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
    const refused = await callTool(ctx, "update_settings", { changes: { punchMinSig: 6 } });
    expect(refused.ok).toBe(false);
    expect(refused.text).toMatch(/^Error: read the method first: call read_skill with name "bragg-node-audit"/);
    expect(usePipelineStore.getState().punchMinSig).toBe("4");

    const skill = await callTool(ctx, "read_skill", { name: "bragg-node-audit" });
    expect(skill.ok).toBe(true);
    expect(skill.text.startsWith("Skill bragg-node-audit\n\n# Bragg-node audit")).toBe(true); // as written, not JSON
    expect(skill.text).not.toContain("… [truncated]");
    expect(ctx.skillsRead?.has("bragg-node-audit")).toBe(true);

    const changed = await callTool(ctx, "update_settings", { changes: { punchMinSig: 6 } });
    expect(changed.ok).toBe(true);
    expect(usePipelineStore.getState().punchMinSig).toBe("6");

    // The app's own calls, which set no skillsRead, are not gated.
    const own = await callTool({ dataset, datasets: [dataset] }, "update_settings", { changes: { punchMinSig: 5 } });
    expect(own.ok).toBe(true);
    expect((await callTool(ctx, "read_skill", { name: "nope" })).text).toMatch(/^Error: invalid arguments — no skill named "nope"/);
  });
});

describe("the switch", () => {
  const dataset = { id: "demo", raw_name: "demo.nxs", stem: "demo", temperature: null, stages: [] } as unknown as Dataset;

  it("has the skills on unless it says skills: false", () => {
    expect([skillsOn(), skillsOn(null), skillsOn({}), skillsOn({ skills: true })]).toEqual([true, true, true, true]);
    expect(skillsOn({ skills: false })).toBe(false);
  });

  it("builds the system prompt from its sections, the skills' section only with the tools and the skills on", () => {
    expect(systemPrompt({ tools: true })).toBe([SYSTEM_PROMPT, TOOLS_PROMPT, skillsPrompt()].join("\n"));
    expect(systemPrompt({ tools: true, skills: true })).toBe(systemPrompt({ tools: true }));
    expect(systemPrompt({ tools: false })).toBe(SYSTEM_PROMPT);
    // Off: no skills' section, and the other sections without their inference (inference.ts).
    expect(systemPrompt({ tools: true, skills: false })).toBe([SYSTEM.definitions, TOOLS.definitions].join("\n"));
    expect(systemPrompt({ tools: false, skills: false })).toBe(SYSTEM.definitions);
    expect([SYSTEM.whole, TOOLS.whole]).toEqual([SYSTEM_PROMPT, TOOLS_PROMPT]);
    // Every builder of the opening messages reads it: the chat and the stage reviews.
    const chat = buildChatMessages({} as never, [], "How clean is this reduction?", null, { tools: true, skills: false });
    const review = buildStageReviewMessages({} as never, "flatten", null, { tools: true, skills: false });
    for (const opening of [chat, review]) {
      expect(opening[0].content).toBe(systemPrompt({ tools: true, skills: false }));
      for (const s of allSkills()) expect(JSON.stringify(opening)).not.toContain(s.name);
      expect(JSON.stringify(opening)).not.toMatch(/skill/i);
    }
    expect(buildChatMessages({} as never, [], "q", null, { tools: true })[0].content).toBe(systemPrompt({ tools: true }));
  });

  it("offers no read_skill with the skills off, and no description that names a skill or restates its step", () => {
    expect(toolsWhere((f) => f.needsSkills)).toEqual(["read_skill"]);
    expect(toolsWithSkills(CHAT_TOOLS, true)).toBe(CHAT_TOOLS);
    const off = toolsWithSkills(CHAT_TOOLS, false);
    expect(off.map((t) => t.name)).toEqual(CHAT_TOOLS.map((t) => t.name).filter((n) => n !== "read_skill"));
    for (const t of off) {
      for (const s of allSkills()) expect(t.description, t.name).not.toContain(s.name);
      expect(t.description, t.name).not.toMatch(/\bskills?\b/i);
      // Only the description changes, and only where the tool has one without the skills.
      const own = CHAT_TOOLS.find((x) => x.name === t.name)!;
      expect(t.description).toBe(own.descriptionWithoutSkills ?? own.description);
      expect(t.parameters).toBe(own.parameters);
    }
    // dpdf_peaks: with the skills on, the skill's name and its order; off, neither.
    const of = (tools: readonly { name: string; description: string }[], name: string) => tools.find((t) => t.name === name)!.description;
    expect(of(CHAT_TOOLS, "dpdf_peaks")).toMatch(/after the trust checks \(qmax_coverage, .*\(delta-pdf-interpretation\)/);
    expect(of(off, "dpdf_peaks")).not.toMatch(/trust checks/);
    // ub_check: with the skills on, how to read radial, reduction-qc's step 2 word for word; off, what radial is.
    const reading = /a UB error gives the same relative offset at every \|Q\| along a direction/;
    expect(of(CHAT_TOOLS, "ub_check")).toMatch(reading);
    expect(of(off, "ub_check")).not.toMatch(reading);
    expect(of(off, "ub_check")).toMatch(/radial is the peaks' median offset along Q from their nodes/);
    // Every description that holds inference (inference.ts) has its definitions only, and only those differ.
    expect(off.filter((t) => t.description !== of(CHAT_TOOLS, t.name)).map((t) => t.name)).toEqual([
      "measure_reciprocal_cut",
      "texture_check",
      "symmetry_check",
      "dpdf_peaks",
      "grain_check",
      "ub_check",
      "radial_profile",
      "line_profile",
      "consistency_details",
    ]);
    expect(toolsWithSkills(off, false)).toEqual(off); // the same either way it is applied
  });

  it("leaves no gate with the skills off: a change goes through with no skill read, and read_skill is no tool of the conversation", async () => {
    usePipelineStore.setState({ punchMinSig: "4" });
    const tools = toolsWithSkills(CHAT_TOOLS, false);
    const ctx: ToolContext = { dataset, datasets: [dataset], skills: false, skillsRead: new Set() };
    expect(unreadSkillRefusal("update_settings", { changes: { punchMinSig: 6 } }, ctx.skillsRead!)).not.toBeNull(); // the gate's own rule stands
    const changed = await callTool(ctx, "update_settings", { changes: { punchMinSig: 6 } }, { tools });
    expect(changed.ok, changed.text).toBe(true);
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
    // Nor a refusal that asks for a skill again: a skill read in an earlier turn changes nothing here.
    const earlier = new Set(["bragg-node-audit"]);
    expect(unreadSkillRefusal("update_settings", { changes: { punchMinSig: 7 } }, ctx.skillsRead!, earlier)).toMatch(/^read the method again/);
    const later = await callTool({ ...ctx, skillsReadEarlier: earlier }, "update_settings", { changes: { punchMinSig: 7 } }, { tools });
    expect(later.ok, later.text).toBe(true);
    expect(usePipelineStore.getState().punchMinSig).toBe("7");
    const read = await callTool(ctx, "read_skill", { name: "reduction-qc" }, { tools });
    expect(read.ok).toBe(false);
    expect(read.text).toMatch(/^Error: no tool named read_skill\. Available: describe_dataset, /);
    expect(ctx.skillsRead?.size).toBe(0);
  });
});
