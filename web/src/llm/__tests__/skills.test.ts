// NEBULA Pilot's skills: bundled from .claude/skills, listed by name in the
// system prompt, read whole with read_skill, and a firm rule on top: a stage's
// settings change, and the stage is tuned, only after its skill has been read.
// One switch takes them away (the validation's arm C).

import { describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { CORE, CORE_PROMPT, IMAGE_LINE, roundsLine, SYSTEM, SYSTEM_PROMPT } from "../prompts/system";
import { buildChatMessages, buildStageReviewMessages, systemPrompt } from "../prompts/templates";
import type { ChatMessage } from "../provider/client";
import { MAX_TOOL_ROUNDS } from "../runPolicy";
import {
  allSkills,
  frontmatter,
  headingsOf,
  parseSkill,
  partsOf,
  readsCore,
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
      // The status line is a detail: not in the head compaction keeps (THY-63 R4).
      expect(s.details).toContain("Draft: awaiting the user's interview");
      expect(s.core).not.toContain("Draft: awaiting the user's interview");
      for (const part of ["## Gates", "## Steps", "**Report**", "## Details", "### Firm rules (enforced in code)", "### Acceptance checklist", "### Failure modes"]) {
        expect(s.body, `${s.name}: ${part}`).toContain(part);
      }
      expect(s.body, `${s.name} marks its judgment calls`).toContain("(to confirm with the user)");
      expect(s.references.length).toBeGreaterThan(0);
    }
  });

  it("says when the flatten's Q² term goes on: when assess_stage reports a pedestal left (docs/pilot-review.md finding 5)", () => {
    const qc = allSkills().find((s) => s.name === "reduction-qc")!.body;
    const step = qc.slice(qc.indexOf("6. **The flatten floor.**"), qc.indexOf("7. **Symmetry kept.**"));
    expect(step).toMatch(/When to turn the Q² term on:\*\* when\s+`assess_stage` for the flatten\s+reports `pedestal_left`, set `flattenQ2` on,\s+rerun/);
    // In the core, which read_skill returns and compaction keeps.
    expect(allSkills().find((s) => s.name === "reduction-qc")!.core).toContain(step.trim());
    expect(step).toMatch(/Leave it off\s+otherwise/);
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

  it("reads a skill's core, and names what it leaves for later: its details' parts and its references", () => {
    const text = readSkill("reduction-qc");
    const qc = skillNamed("reduction-qc")!;
    expect(text.startsWith(`Skill reduction-qc\n\n${qc.core}\n\n---\n`)).toBe(true);
    expect(text.startsWith("Skill reduction-qc\n\n# Reduction QC")).toBe(true);
    expect(text).toContain("References of this skill");
    expect(text).toContain("- ub_refinement: how the UB is refined and checked");
    expect(() => readSkill("nope")).toThrow(/no skill named "nope"; the skills are bragg-node-audit, delta-pdf-interpretation, reduction-qc/);
    for (const s of allSkills()) {
      const read = readSkill(s.name);
      expect(read, s.name).toContain(s.core);
      // The details are left for a read on request, and named.
      if (s.details) {
        expect(read, s.name).not.toContain(s.details);
        expect(read, s.name).toContain('`section` "Details"');
        for (const h of headingsOf(s.details).filter((x) => x.level === 3)) expect(read, `${s.name}: ${h.heading}`).toContain(h.heading);
      }
    }
  });

  it("reads a skill's section on request: Details, or one part of it by its heading", () => {
    for (const s of allSkills().filter((x) => x.details)) {
      const details = readSkill(s.name, undefined, "details");
      expect(details.startsWith(`Skill ${s.name}, section "Details`), s.name).toBe(true);
      // Not a skill's core as compaction recognises it (readings/compact.ts): a section read is shortened as any text.
      expect(details.startsWith(`Skill ${s.name}\n\n`)).toBe(false);
      for (const h of headingsOf(s.details).filter((x) => x.level === 3)) {
        expect(readSkill(s.name, undefined, h.heading), `${s.name}: ${h.heading}`).toContain(`### ${h.heading}`);
      }
    }
    expect(() => readSkill("reduction-qc", undefined, "nope")).toThrow(/skill reduction-qc has no section "nope"; its sections are .*Steps/);
  });

  it("reads a long reference by its index of sections, then a section, part by part", () => {
    const index = readSkill("bragg-node-audit", "bragg_cleanup");
    expect(index).toContain("docs/algorithms/bragg_cleanup.md");
    expect(index).toContain("Sections (read one with read_skill, `reference` and `section`, by its heading):");
    expect(index).toContain("\n- Significance Gate\n");
    expect(index).toContain("\n  - Scale-free node test\n"); // a subsection, indented under its section
    expect(index.length).toBeLessThanOrEqual(REFERENCE_MAX_CHARS + 200);
    const section = readSkill("bragg-node-audit", "bragg_cleanup", "significance gate");
    expect(section).toContain('section "Significance Gate"');
    // A section past the cap: its first part, and how to read on.
    const first = readSkill("bragg-node-audit", "bragg_cleanup", "Backfill Modes");
    expect(first).toMatch(/section "Backfill Modes \(part 1 of \d\)"/);
    expect(first).toContain('[The section continues: read section "Backfill Modes (part 2)".]');
    expect(readSkill("bragg-node-audit", "bragg_cleanup", "backfill modes (part 2)")).toMatch(/section "Backfill Modes \(part 2 of \d\)"/);
    expect(() => readSkill("bragg-node-audit", "bragg_cleanup", "Backfill Modes (part 9)")).toThrow(/section "Backfill Modes" of bragg_cleanup has \d parts/);
    expect(() => readSkill("bragg-node-audit", "bragg_cleanup", "nope")).toThrow(/has no section "nope"; its sections are/);
    expect(() => readSkill("bragg-node-audit", "nope")).toThrow(/has no reference "nope"; it has bragg_cleanup/);
  });

  it("leaves no text of a skill or a reference unreachable: every section read whole in parts of at most REFERENCE_MAX_CHARS", () => {
    const squash = (t: string): string => t.replace(/\s+/g, "");
    const pages = [
      ...allSkills().map((s) => ({ where: s.name, text: s.body, read: (sec: string) => readSkill(s.name, undefined, sec) })),
      ...allSkills().flatMap((s) => s.references.map((r) => ({ where: `${s.name} › ${r.name}`, text: r.text, read: (sec: string) => readSkill(s.name, r.name, sec) }))),
    ];
    for (const p of pages) {
      for (const h of headingsOf(p.text)) {
        if (h.heading === "References" && !p.where.includes("›")) continue; // a skill's references are read with `reference`
        const parts: string[] = [];
        for (let n = 1; ; n++) {
          const out = p.read(n === 1 ? h.heading : `${h.heading} (part ${n})`);
          const body = out.slice(out.indexOf("\n\n") + 2).replace(/\n\n\[The section continues: [^\]]*\]$/, "");
          expect(body.length, `${p.where} › ${h.heading}, part ${n}`).toBeLessThanOrEqual(REFERENCE_MAX_CHARS);
          parts.push(body);
          if (!out.includes("[The section continues:")) break;
        }
        // The parts are the section, every character but whitespace.
        const own = p.text.slice(h.at);
        const next = headingsOf(own).slice(1).find((x) => x.level <= h.level);
        expect(squash(parts.join("")), `${p.where} › ${h.heading}`).toBe(squash(own.slice(0, next ? next.at : own.length)));
      }
    }
  });

  it("cuts a text in parts between paragraphs, never inside a code fence, else between lines", () => {
    const para = (c: string, n: number) => `${c.repeat(n)}.`;
    const fence = "```\n\ncode 1\n\ncode 2\n\n```";
    const text = [para("a", 30), para("b", 30), fence, para("c", 30)].join("\n\n");
    expect(partsOf(text, 1000)).toEqual([text]);
    expect(partsOf(text, 70)).toEqual([`${para("a", 30)}\n\n${para("b", 30)}`, `${fence}\n\n${para("c", 30)}`]);
    // The fence whole, its blank lines kept: no cut inside it.
    expect(partsOf(text, 40)).toEqual([para("a", 30), para("b", 30), fence, para("c", 30)]);
    expect(partsOf("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
    expect(partsOf("l1\nl2\nl3", 5)).toEqual(["l1\nl2", "l3"]);
  });

  it("parses a skill's core and details: the body up to `## Details` or `## References`, or the whole body", () => {
    const md = (body: string) => `---\nname: x\ndescription: d\n---\n${body}`;
    const files = { "docs/p.md": "# P" };
    const four = parseSkill(md("# X\n\nHead.\n\n## Gates\n\n- g\n\n## Steps\n\n1. s\n\n## Details\n\n### A\n\na\n\n## References\n\n- [p](../docs/p.md) — p"), "x", files);
    expect(four.core).toBe("# X\n\nHead.\n\n## Gates\n\n- g\n\n## Steps\n\n1. s");
    expect(four.details).toBe("## Details\n\n### A\n\na");
    const old = parseSkill(md("# X\n\n## Steps\n\n1. s\n\n## References\n\n- [p](../docs/p.md) — p"), "x", files);
    expect([old.core, old.details]).toEqual(["# X\n\n## Steps\n\n1. s", ""]);
    expect(parseSkill(md("# X\n\nAll of it."), "x", files).core).toBe("# X\n\nAll of it.");
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

  it("counts a skill whose core the messages carry whole, not one only named or quoted in part", () => {
    const body = skillNamed("reduction-qc")!.body;
    const core = skillNamed("reduction-qc")!.core;
    expect([...skillsCarriedIn([{ role: "tool", tool_call_id: "c1", content: readSkill("reduction-qc") }])]).toEqual(["reduction-qc"]);
    const pasted: ChatMessage = { role: "user", content: [{ type: "text", text: `My method:\n${body}` }, { type: "image_url", image_url: { url: "data:," } }] };
    expect([...skillsCarriedIn([pasted])]).toEqual(["reduction-qc"]);
    expect(skillsCarriedIn([{ role: "assistant", content: "I read the reduction-qc skill and followed it." }]).size).toBe(0);
    expect(skillsCarriedIn([{ role: "assistant", content: core.slice(0, core.length - 1) }]).size).toBe(0);
    // One section alone carries no method.
    expect(skillsCarriedIn([{ role: "tool", tool_call_id: "c2", content: readSkill("reduction-qc", undefined, "Steps") }]).size).toBe(0);
    // The system prompt lists the skills by name and description: it carries none of them.
    expect(skillsCarriedIn(buildChatMessages({} as never, [], "q", null, { tools: true })).size).toBe(0);
    expect(skillsCarriedIn(buildStageReviewMessages({} as never, "flatten", null, { tools: true })).size).toBe(0);
  });

  it("lists the skills read in a conversation's turns, not a reference, a section or a failed read", () => {
    const step = (args: Record<string, unknown>, status: "done" | "error" = "done") => ({ id: "s", name: "read_skill", args, status });
    const read = skillsReadIn([
      { steps: [step({ name: "reduction-qc" }), step({ name: "bragg-node-audit", reference: "bragg_cleanup" })] },
      { steps: [step({ name: "delta-pdf-interpretation" }, "error"), step({ name: "delta-pdf-interpretation", section: "Details" })] },
      { steps: [step({ name: "bragg-node-audit", section: " " })] }, // a blank section is none: the core
      {},
    ]);
    expect([...read]).toEqual(["reduction-qc", "bragg-node-audit"]);
    expect([readsCore({}), readsCore({ reference: "" }), readsCore({ section: "Details" }), readsCore({ reference: "x" })]).toEqual([true, true, false, false]);
  });

  it("holds in the executor: a change waits for read_skill, then goes through", async () => {
    usePipelineStore.setState({ punchMinSig: "4" });
    const dataset = { id: "demo", raw_name: "demo.nxs", stem: "demo", temperature: null, stages: [] } as unknown as Dataset;
    const ctx: ToolContext = { dataset, datasets: [dataset], skillsRead: new Set() };
    const refused = await callTool(ctx, "update_settings", { changes: { punchMinSig: 6 } });
    expect(refused.ok).toBe(false);
    expect(refused.text).toMatch(/^Error: read the method first: call read_skill with name "bragg-node-audit"/);
    expect(usePipelineStore.getState().punchMinSig).toBe("4");

    // A section alone opens no gate: the method is the core.
    expect((await callTool(ctx, "read_skill", { name: "bragg-node-audit", section: "Steps" })).ok).toBe(true);
    expect(ctx.skillsRead?.has("bragg-node-audit")).toBe(false);
    expect((await callTool(ctx, "update_settings", { changes: { punchMinSig: 6 } })).ok).toBe(false);

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
    // With tools: the core (not the metrics' glossary), the rounds a reply may make, then the skills' section.
    const rounds = roundsLine(MAX_TOOL_ROUNDS);
    expect(systemPrompt({ tools: true })).toBe([CORE_PROMPT, rounds, skillsPrompt()].join("\n"));
    expect(systemPrompt({ tools: true, skills: true })).toBe(systemPrompt({ tools: true }));
    expect(systemPrompt({ tools: false })).toBe(SYSTEM_PROMPT);
    // Off: no skills' section, and the other sections without their inference (inference.ts).
    expect(systemPrompt({ tools: true, skills: false })).toBe([CORE.definitions, rounds].join("\n"));
    expect(systemPrompt({ tools: false, skills: false })).toBe(SYSTEM.definitions);
    expect([SYSTEM.whole, CORE.whole]).toEqual([SYSTEM_PROMPT, CORE_PROMPT]);
    // A run's own round limit, and a line on an image only when a message carries one, in either arm.
    expect(systemPrompt({ tools: true, rounds: 8 })).toBe([CORE_PROMPT, roundsLine(8), skillsPrompt()].join("\n"));
    expect(roundsLine(8)).toMatch(/at most 8 rounds of calls, a limit, not a target\.$/);
    expect(systemPrompt({ tools: true, image: true })).toBe([CORE_PROMPT, rounds, IMAGE_LINE, skillsPrompt()].join("\n"));
    const withImage = buildStageReviewMessages({} as never, "dpdf", "data:image/png;base64,", { tools: true, skills: false });
    expect(withImage[0].content).toBe([CORE.definitions, rounds, IMAGE_LINE].join("\n"));
    expect(buildChatMessages({} as never, [], "q", null, { tools: true })[0].content).not.toContain(IMAGE_LINE);
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
    // dpdf_peaks: with the skills on, the skill's order; off, not (THY-63 R2: the skill's name left the contract).
    const of = (tools: readonly { name: string; description: string }[], name: string) => tools.find((t) => t.name === name)!.description;
    expect(of(CHAT_TOOLS, "dpdf_peaks")).toMatch(/after the trust checks \(qmax_coverage, /);
    expect(of(off, "dpdf_peaks")).not.toMatch(/trust checks/);
    // ub_check: with the skills on, how to read radial, reduction-qc's step 2; off, what radial is.
    const reading = /An offset that changes with \|Q\| is no UB error/;
    expect(of(CHAT_TOOLS, "ub_check")).toMatch(reading);
    expect(of(off, "ub_check")).not.toMatch(reading);
    expect(of(off, "ub_check")).toMatch(/radial \(offset along Q per \|Q\| band and direction\)/);
    // Every description that holds inference (inference.ts) has its definitions only, and only those differ.
    expect(off.filter((t) => t.description !== of(CHAT_TOOLS, t.name)).map((t) => t.name)).toEqual([
      "measure_reciprocal_cut",
      "symmetry_check",
      "dpdf_contrast",
      "dpdf_peaks",
      "ub_check",
      "compare_laue_classes",
      "radial_profile",
      "line_profile",
      "consistency_details",
      "mark_region",
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
