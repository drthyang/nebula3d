// A tool result's two readings (readings/): what the tool found and what the
// model read. `fit` makes the model's copy of a result and keeps the whole
// beside it; `shorten` shortens that copy later in a long reply; `found`,
// `seen` and `whole` read a step, live, old (without `full`) or round-tripped
// through JSON, and never throw.

import { describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import type { AgentStep } from "../agent";
import { fit, found, seen, shorten, whole, type Readable } from "../readings";
import { COMPACTED, coreOf, GATES_MAX, gatesOf, isCompacted, SKILL_CORE_MAX, SKILL_STUB_MAX, TEXT_HEAD } from "../readings/compact";
import { MAX_TEXTS } from "../readings/found";
import { allSkills, readSkill } from "../skills";
import { callTool, MAX_RESULT_CHARS } from "../tools";

// An assess_stage rings result past the limit: a long goal, long per-plane lists.
const residuals = (n: number) => Array.from({ length: n }, (_, i) => ({ at: 1 + i / 10, residual_fraction: 0.1, noise_fraction: 0.05, significant: true, ring: false }));
const long = {
  rings: {
    verdict: "needs attention",
    headline: "ring ratio 0.7 · left ≤ 0.4 (h0l, 3.16 Å⁻¹)",
    max_ring_left: 0.4,
    per_plane: { hk0: { ring_residuals: residuals(30) }, h0l: { ring_residuals: residuals(30) }, "0kl": { ring_residuals: residuals(30) } },
    goal: "g".repeat(1500),
  },
};

const done = (result: string, full?: string): AgentStep => ({ id: "1", name: "assess_stage", args: {}, status: "done", result, ...(full !== undefined ? { full } : {}) });
/** A step whose result went through fit, as the executor hands it to the loop. */
const fitted = (value: unknown, max = MAX_RESULT_CHARS): AgentStep => {
  const { text, full } = fit(value, max);
  return done(text, full);
};
/** How many times JSON.parse read *text* while *read* ran. */
const parsesOf = (text: string, read: () => void): number => {
  const spy = vi.spyOn(JSON, "parse");
  try {
    read();
    return spy.mock.calls.filter(([t]) => t === text).length;
  } finally {
    spy.mockRestore();
  }
};

describe("fit: what the model reads of a result, and the whole beside it", () => {
  it("leaves a result that fits as it is, with nothing beside it", () => {
    expect(fit({ a: 1 }, 100)).toEqual({ text: '{"a":1}' });
    expect("full" in fit({ a: 1 }, 100)).toBe(false);
  });

  it("drops the bulkiest parts first, keeps the verdict, and names what it left out", () => {
    expect(JSON.stringify(long).length).toBeGreaterThan(MAX_RESULT_CHARS);
    const { text, full } = fit(long, MAX_RESULT_CHARS);
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    const read = JSON.parse(text) as { rings: Record<string, unknown>; left_out: string[] };
    expect(read.rings.verdict).toBe("needs attention");
    expect(read.rings.headline).toBe(long.rings.headline);
    expect(read.rings.max_ring_left).toBe(0.4);
    expect(read.left_out.length).toBeGreaterThan(0);
    expect(read.left_out.every((x) => x.startsWith("rings."))).toBe(true);
    expect(full).toBe(JSON.stringify(long));
  });

  it("cuts a text result (a skill) at the limit, marked, and keeps the whole text", () => {
    const skill = `# A skill\n\n${"Step. ".repeat(40)}`;
    expect(fit(skill, 1000)).toEqual({ text: skill });
    expect(fit(skill, 20)).toEqual({ text: `${skill.slice(0, 20)}… [truncated]`, full: skill });
  });
});

describe("shorten: the model's copy, shortened later in a long reply", () => {
  const assessment = {
    rings: {
      verdict: "needs attention",
      criterion: "No powder ring left above, or dented below, three times its plane's noise. ".repeat(3),
      headline: "ring ratio 0.713 · left ≤ 0.149 (hk0, 2.45 Å⁻¹)",
      mean_ring_energy_ratio: 0.713,
      max_ring_left: 0.149,
      worst_ring_left: { plane: "hk0", at: 2.45, residual_fraction: 0.149 },
      ring_rule: { direction_share: 0.9, height_share: 0.15 },
      shells_judged: [{ at: 1.68, ring: false }, { at: 2.45, ring: true }, { at: 3.16, ring: false }, { at: 3.66, ring: true }, { at: 4.59, ring: false }],
      per_plane: { hk0: { ring_residuals: [{ at: 1.68, residual_fraction: 0.516 }] }, h0l: { ring_residuals: [] } },
      goal: "Remove powder/Al rings: ".repeat(20),
    },
    measured_on: ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"],
  };

  it("keeps the verdict, headline and numbers, and drops the per-plane lists and long texts", () => {
    const short = JSON.parse(shorten(JSON.stringify(assessment)));
    expect(short).toEqual({
      rings: {
        verdict: "needs attention",
        headline: "ring ratio 0.713 · left ≤ 0.149 (hk0, 2.45 Å⁻¹)",
        mean_ring_energy_ratio: 0.713,
        max_ring_left: 0.149,
        worst_ring_left: { plane: "hk0", at: 2.45, residual_fraction: 0.149 },
        ring_rule: { direction_share: 0.9, height_share: 0.15 },
        shells_judged: "(5 items)",
      },
      measured_on: ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"],
      compacted: COMPACTED,
    });
  });

  it("cuts a long text that is not JSON, and leaves a short or unshrinkable result alone", () => {
    const longText = "x".repeat(1000);
    const cut = shorten(longText);
    expect(cut.length).toBeLessThan(500);
    expect(isCompacted(cut)).toBe(true);
    expect(shorten('{"got":7}')).toBe('{"got":7}');
    expect(shorten("plain words")).toBe("plain words");
  });

  it("shortens a text once: one already shortened is left as it is", () => {
    for (const text of [JSON.stringify(assessment), "x".repeat(1000)]) {
      const once = shorten(text);
      expect(shorten(once)).toBe(once);
    }
  });
});

// How a text that is no JSON was shortened before a skill could keep its
// gates: its first 400 characters and the note. A skill without `## Gates`
// is shortened so still, byte for byte.
const before = (text: string): string => (text.length > 400 ? `${text.slice(0, 400)}… (${COMPACTED})` : text);

// The numbers a text writes, in order, as written.
const numbersIn = (text: string): string[] => text.match(/\d+(?:[.,/]\d+)*(?:e[-+]?\d+)?/g) ?? [];

/** The `## Gates` section of read_skill's text of a skill, as written. */
const gatesSection = (text: string): string => {
  const at = gatesOf(text);
  if (!at) throw new Error("no ## Gates section");
  return text.slice(at.start, at.end).trimEnd();
};

describe("shorten: a skill keeps its head, gates and steps; a section read becomes the line that names it", () => {
  // A synthetic skill as read_skill returns its core ("Skill <name>", the head,
  // `## Gates`, `## Steps`, then what is left for later after a `---`): its
  // gates are made up, no skill's or data's.
  const HEAD = "# A synthetic method\n\nRead the volume before you change it, and say what you read.";
  const GATES = [
    "## Gates",
    "",
    "- Rings: a ring left at most 0.37 of its plane's noise, at every ring seen in 85 % of the directions.",
    "- Punch: a node punched at 4.5σ or more; a second grain turned by under 7°.",
    "- Coverage: at most 2e-4 of the window's weight on unmeasured space, over 3/4 of the shells.",
    "",
    "### When two gates disagree",
    "",
    "- Report both, to 3 decimals, and the gate that failed first.",
  ].join("\n");
  const STEPS = `## Steps\n\n${Array.from({ length: 12 }, (_, i) => `${i + 1}. Call the step's tool and read its verdict before the next step.`).join("\n")}`;
  const LATER =
    "\n\n---\nDetails of this skill (read with read_skill and `section` \"Details\", or one part by its heading): Failure modes.\n" +
    "References of this skill (read one with read_skill and `reference`):\n- the method's page: 12 sections on 9 planes";
  const skill = (body: string, later = LATER) => `Skill synthetic-method\n\n${body}${later}`;
  const core = skill(`${HEAD}\n\n${GATES}\n\n${STEPS}`);

  it("keeps the name, the head, the gates and the steps whole, and lets what is left for later go", () => {
    const stub = shorten(core);
    expect(isCompacted(stub)).toBe(true);
    expect(stub.length).toBeLessThan(core.length);
    expect(stub.length).toBeLessThanOrEqual(SKILL_STUB_MAX);
    expect(stub).toBe(`Skill synthetic-method\n\n${HEAD}\n\n${GATES}\n\n${STEPS}\n\n(${COMPACTED})`);
    // Every gate number survives, in order.
    expect(numbersIn(gatesSection(stub))).toEqual(numbersIn(GATES));
    expect(numbersIn(GATES)).toEqual(["0.37", "85", "4.5", "7", "2e-4", "3/4", "3"]);
    for (const gone of ["Details of this skill", "References of this skill"]) expect(stub).not.toContain(gone);
    expect(shorten(stub)).toBe(stub);
  });

  it("ends the kept part at a heading of level 1 or 2 past the steps, or at the `---` before what is left for later", () => {
    const details = skill(`${HEAD}\n\n${GATES}\n\n${STEPS}\n\n## Details\n\n${"Why the steps are so. ".repeat(10)}`, "");
    expect(shorten(details)).not.toContain("## Details");
    expect(shorten(details)).toContain(STEPS);
    const top = skill(`${HEAD}\n\n${GATES}\n\n${STEPS}\n\n# Appendix\n\n${"At 11 planes. ".repeat(10)}`, "");
    expect(shorten(top)).not.toContain("Appendix");
    // Gates without steps: the gates alone, as before R5.
    const gatesOnly = skill(`${HEAD}\n\n${GATES}\n\n## Failure modes\n\nA failure mode.`);
    expect(coreOf(gatesOnly)).toEqual(gatesOf(gatesOnly));
    expect(shorten(gatesOnly)).toBe(`Skill synthetic-method\n\n${HEAD}\n\n${GATES}\n\n(${COMPACTED})`);
  });

  it("keeps a head of at most TEXT_HEAD characters whole, and cuts a longer one there", () => {
    const long = skill(`# A synthetic method\n\n${"Read the volume before you change it, and say what you read. ".repeat(8)}\n\n${GATES}\n\n${STEPS}`);
    const stub = shorten(long);
    expect(stub.startsWith(`${long.slice(0, TEXT_HEAD)}…\n\n${GATES}`)).toBe(true);
    expect(stub).toContain(STEPS);
  });

  it("cuts gates and steps past SKILL_CORE_MAX at a line boundary, and says how many lines it left out", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `${i + 1}. Step ${i + 1}: its quantity at most 0.${i + 10}, else the stage needs attention.`);
    const steps = ["## Steps", "", ...lines].join("\n");
    expect(GATES.length + steps.length).toBeGreaterThan(SKILL_CORE_MAX);
    const stub = shorten(skill(`${HEAD}\n\n${GATES}\n\n${steps}`));
    expect(isCompacted(stub)).toBe(true);
    expect(stub.length).toBeLessThanOrEqual(SKILL_STUB_MAX);
    const kept = stub.slice(stub.indexOf("## Gates"), stub.indexOf("\n[")); // up to the marker
    expect(HEAD.length + kept.length).toBeLessThanOrEqual(SKILL_CORE_MAX);
    expect(`${GATES}\n\n${steps}`.startsWith(`${kept}\n`)).toBe(true); // whole lines, from the gates' heading
    const keptSteps = kept.split("\n").filter((l) => /^\d+\. /.test(l)).length;
    expect(keptSteps).toBeGreaterThan(20);
    expect(stub).toContain(`\n[${80 - keptSteps} more lines of the gates and steps left out to save room: read the skill again for them]\n\n(${COMPACTED})`);
    expect(shorten(stub)).toBe(stub);
  });

  it("keeps a skill whole where its head, gates and steps would save nothing", () => {
    const short = skill(`# A short method: its gates come first\n\n${GATES}\n\n${STEPS}`, "");
    expect(short.length).toBeGreaterThan(TEXT_HEAD);
    expect(shorten(short)).toBe(short);
  });

  it("shortens a skill without the section exactly as before", () => {
    for (const text of [
      skill(`${HEAD}\n\n${STEPS}`),
      skill(`${HEAD}\n\n${GATES.replace("## Gates", "## Gates and limits")}\n\n${STEPS}`), // another heading
      skill(`${HEAD}\n\n${GATES.replace("## Gates", "### Gates")}\n\n${STEPS}`),
      skill("# Short\n\nA method of a few words.", ""),
    ]) {
      expect(gatesOf(text)).toBeNull();
      expect(shorten(text)).toBe(before(text));
    }
  });

  it("shortens one section of a skill, or a reference page, to the line that names it", () => {
    const body = `${HEAD}\n\n${GATES}\n\n${"A failure mode, and what it looks like on the cuts. ".repeat(12)}`;
    for (const first of [
      'Skill synthetic-method, section "Details"',
      'Skill synthetic-method, section "Failure modes (part 2 of 3)"',
      'Reference "the method\'s page" of skill synthetic-method (docs/x.md)',
      'Reference "the method\'s page" of skill synthetic-method (docs/x.md), section "Significance Gate"',
    ]) {
      const text = `${first}\n\n${body}`;
      expect(gatesOf(text)).toBeNull();
      expect(shorten(text)).toBe(`${first} (${COMPACTED})`);
    }
  });

  it("shortens any other text as before, a `## Gates` in it or not", () => {
    for (const text of [`Error: ${HEAD} ${"x".repeat(400)}\n\n${GATES}\n\n${STEPS}`, `${HEAD} ${"x".repeat(400)}\n\n${GATES}\n\n${STEPS}`]) {
      expect(gatesOf(text)).toBeNull();
      expect(shorten(text)).toBe(before(text));
    }
  });
});

describe("shorten over the real skills (.claude/skills), as read_skill returns them", () => {
  const dataset = { id: "demo", raw_name: "demo.nxs", stem: "demo", temperature: null, stages: [] } as unknown as Dataset;
  // What the loop shortens: the model's copy of the skill, as the executor sends it.
  const modelCopy = async (name: string): Promise<string> => {
    const run = await callTool({ dataset, datasets: [dataset], skillsRead: new Set() }, "read_skill", { name });
    expect(run.ok, run.text).toBe(true);
    expect(run.text).toBe(readSkill(name)); // whole: no skill is cut to fit
    return run.text;
  };
  const SKILLS = allSkills().map((s) => ({ name: s.name, gated: gatesOf(readSkill(s.name)) !== null }));

  it("reads every skill as a skill's text", () => {
    expect(SKILLS.length).toBeGreaterThan(0);
    // The recognised form is read_skill's own: every skill's text has it.
    for (const { name } of SKILLS) {
      expect(readSkill(name).startsWith(`Skill ${name}\n\n`)).toBe(true);
      expect(gatesOf(`${readSkill(name)}\n\n## Gates\n\n- A gate at 0.5.`), name).not.toBeNull();
    }
  });

  // Every skill has the skills' form (THY-63 R4; skillLint.test.ts holds it):
  // shortened, it is its name, its core whole (head, gates, steps) and the
  // note. Its core past SKILL_CORE_MAX would be cut: skillLint fails first.
  for (const { name } of SKILLS) {
    it(`${name}: shortened to its name, its head, gates and steps whole, and the note`, async () => {
      const text = await modelCopy(name);
      const skill = allSkills().find((s) => s.name === name)!;
      const section = gatesSection(text);
      const stub = shorten(text);
      expect(section.length, `${name}'s gates are ${section.length} characters, past GATES_MAX (${GATES_MAX})`).toBeLessThanOrEqual(GATES_MAX);
      expect(skill.core.length).toBeLessThanOrEqual(SKILL_CORE_MAX);
      expect(stub).toBe(`Skill ${name}\n\n${skill.core}\n\n(${COMPACTED})`);
      expect(numbersIn(stub)).toEqual([...numbersIn(`Skill ${name}\n\n${skill.core}`)]);
      expect(stub.length).toBeLessThanOrEqual(SKILL_STUB_MAX);
    });
  }

  it("shortens each skill's section reads to the line that names them", () => {
    for (const s of allSkills()) {
      for (const section of ["Details", ...s.details.split("\n").filter((l) => l.startsWith("### ")).map((l) => l.slice(4))]) {
        const text = readSkill(s.name, undefined, section);
        const first = text.slice(0, text.indexOf("\n"));
        expect(shorten(text), `${s.name} › ${section}`).toBe(`${first} (${COMPACTED})`);
      }
    }
  });
});

describe("found, seen and whole: the two readings of a step", () => {
  it("reads a long result: seen is the fitted text sent, whole the whole, found the whole parsed as JSON has it", () => {
    // JSON-normalised: a field left undefined goes, a NaN reads as null.
    const value = { ...long, peak: 7.2, missing: undefined, nan: NaN };
    const step = fitted(value);
    expect(step.full).toBeDefined();
    expect(seen(step)).toBe(step.result);
    expect(seen(step).length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect((JSON.parse(seen(step)) as { left_out: string[] }).left_out.length).toBeGreaterThan(0);
    expect(whole(step)).toBe(JSON.stringify(value));
    expect(found(step)).toEqual(JSON.parse(JSON.stringify(value)));
    expect(found(step)).toMatchObject({ peak: 7.2, nan: null });
    expect(found(step)).not.toHaveProperty("missing");
  });

  it("reads a short result, which has no `full`: the three readings agree", () => {
    const step = fitted({ verdict: "meets its goal", peak: 7.2 });
    expect(step).not.toHaveProperty("full");
    expect(seen(step)).toBe('{"verdict":"meets its goal","peak":7.2}');
    expect(whole(step)).toBe(seen(step));
    expect(found(step)).toEqual({ verdict: "meets its goal", peak: 7.2 });
  });

  it("finds nothing in an error, a step still running, a skill's text or JSON that is no object, and reads their text whole", () => {
    const error: Readable = { status: "error", result: '{"verdict":"Error: not run"}' };
    expect(found(error)).toBeNull();
    expect([seen(error), whole(error)]).toEqual(['{"verdict":"Error: not run"}', '{"verdict":"Error: not run"}']);
    const running: Readable = { status: "running" };
    expect([found(running), seen(running), whole(running)]).toEqual([null, "", ""]);
    const text = `# A skill\n\n${"Step. ".repeat(40)}`;
    const skill = fitted(text, 20);
    expect(found(skill)).toBeNull();
    expect(whole(skill)).toBe(text);
    expect(seen(skill)).toBe(`${text.slice(0, 20)}… [truncated]`);
    for (const result of ["[1,2]", "42", "null", '"text"', "{", "", "Error: x"]) expect(found({ status: "done", result })).toBeNull();
  });

  it("reads a step round-tripped through JSON as it was, and an old step without `full` from its result", () => {
    const step = fitted(long);
    const back = JSON.parse(JSON.stringify(step)) as AgentStep;
    expect([seen(back), whole(back)]).toEqual([seen(step), whole(step)]);
    expect(found(back)).toEqual(found(step));
    const old: AgentStep = { id: "0", name: "ub_check", args: {}, status: "done", result: '{"angle_deg":0.61}' };
    expect([seen(old), whole(old)]).toEqual(['{"angle_deg":0.61}', '{"angle_deg":0.61}']);
    expect(found(old)).toEqual({ angle_deg: 0.61 });
  });

  it("parses each text once, and every reader shares the one frozen value", () => {
    const text = JSON.stringify({ rings: { verdict: "needs attention", series: [1, 2] }, unique: Math.random() });
    let first: ReturnType<typeof found> = null;
    let again: ReturnType<typeof found> = null;
    expect(
      parsesOf(text, () => {
        first = found(done(text));
        again = found(done("the model's copy", text)); // the same text, as another step's whole
      }),
    ).toBe(1);
    expect(again).toBe(first);
    const value = first as unknown as { rings: { verdict: string; series: number[] } };
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.rings)).toBe(true);
    expect(Object.isFrozen(value.rings.series)).toBe(true);
    expect(() => {
      value.rings.verdict = "meets its goal";
    }).toThrow(TypeError);
  });

  it("keeps a bounded number of texts: the oldest is parsed again once dropped", () => {
    const oldest = JSON.stringify({ oldest: Math.random() });
    found(done(oldest));
    expect(parsesOf(oldest, () => found(done(oldest)))).toBe(0);
    for (let i = 0; i < MAX_TEXTS; i++) found(done(JSON.stringify({ i, r: Math.random() })));
    expect(parsesOf(oldest, () => found(done(oldest)))).toBe(1);
  });
});
