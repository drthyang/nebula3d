// The validation module (validation.ts), graded without a model: the split holds
// apart, the arms differ only in their skills, the graders pass the right
// answer and fail the wrong one, and a run's record says what it decided, where
// each number came from and what it concluded.

import { describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import type { AgentStep } from "../agent";
import { allSkills, unreadSkillRefusal } from "../skills";
import { CHAT_TOOLS } from "../tools";
import type { EvalRun } from "./harness";
import {
  ARMS,
  armSetup,
  buildRecord,
  CASES,
  casesIn,
  casesToRun,
  caseNamed,
  caseOfDataset,
  changedElsewhere,
  datasetStem,
  decisions,
  detectionChecks,
  FAMILIES,
  falseAlarmChecks,
  gradeRun,
  numberSources,
  TASK,
  unsafeActions,
  validationDatasets,
  WhyTracker,
} from "./validation";

const step = (name: string, args: Record<string, unknown> = {}, result: unknown = {}, status: AgentStep["status"] = "done"): AgentStep => ({
  id: `${name}-${Math.random()}`,
  name,
  args,
  status,
  summary: `${name} summary`,
  result: typeof result === "string" ? result : JSON.stringify(result),
});
const run = (content: string, steps: AgentStep[] = []): EvalRun => ({ scenario: "t", steps, content, latencyMs: 1200, usage: null });
const dataset = (id: string, stem = id, exists = false): Dataset => ({
  id,
  stem,
  temperature: null,
  raw_name: `${stem}.nxs`,
  stages: [{ name: "ring_removed", exists } as Dataset["stages"][number]],
});

describe("the split", () => {
  it("has at least eight cases in each split, one dev and one test per family", () => {
    expect(casesIn("dev").length).toBeGreaterThanOrEqual(8);
    expect(casesIn("test").length).toBe(casesIn("dev").length);
    for (const family of Object.keys(FAMILIES)) {
      expect(CASES.filter((c) => c.family === family).map((c) => c.split).sort()).toEqual(["dev", "test"]);
    }
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) expect(c.id.startsWith(`${c.split}-`)).toBe(true);
  });

  it("builds the test split from another crystal and another fault size", () => {
    for (const family of Object.keys(FAMILIES)) {
      const dev = CASES.find((c) => c.family === family && c.split === "dev")!;
      const test = CASES.find((c) => c.family === family && c.split === "test")!;
      expect(test.cell_a).not.toBe(dev.cell_a);
      const vectors = (c: typeof dev) => c.planted.map((p) => p.vector.join(","));
      expect(vectors(test).filter((v) => vectors(dev).includes(v))).toEqual([]);
      if (Object.keys(dev.fault).length) expect(test.fault).not.toEqual(dev.fault);
    }
  });

  it("runs the test split only to be reported", () => {
    expect(() => casesToRun("test")).toThrow(/held out/);
    expect(() => casesToRun("test", { report: false })).toThrow(/held out/);
    expect(casesToRun("test", { report: true })).toEqual(casesIn("test"));
    expect(casesToRun("dev")).toEqual(casesIn("dev"));
  });

  it("gives the model a task that names no case, fault or size", () => {
    for (const c of CASES) expect(TASK).not.toContain(c.id);
    expect(TASK).not.toMatch(/\d+(\.\d+)?\s*(°|Å|%|r\.l\.u)/);
    expect(ARMS).toEqual(["B", "C"]);
  });
});

describe("the arms", () => {
  it("gives arm B the Pilot as shipped: its skills listed, read_skill offered, nothing read yet", async () => {
    const { buildChatMessages } = await import("../prompts/templates");
    const real = buildChatMessages({} as never, [], TASK, null, { tools: true });
    const b = armSetup("B", CHAT_TOOLS, real);
    expect(b.tools).toBe(CHAT_TOOLS);
    expect(b.skillsRead.size).toBe(0);
    expect(JSON.stringify(b.messages)).toContain("read_skill");
  });

  it("takes arm C's skills away without leaving the gate to refuse its changes", async () => {
    const { buildChatMessages } = await import("../prompts/templates");
    const real = buildChatMessages({} as never, [], TASK, null, { tools: true });
    const c = armSetup("C", CHAT_TOOLS, real);
    expect(c.tools.some((t) => t.name === "read_skill")).toBe(false);
    expect(c.tools.length).toBe(CHAT_TOOLS.length - 1);
    const system = JSON.stringify(c.messages[0]);
    for (const s of allSkills()) expect(system).not.toContain(s.name);
    expect(JSON.stringify(real[0])).toContain(allSkills()[0].name); // B's prompt does list them
    const change = { changes: { punchMinSig: 6 } };
    expect(unreadSkillRefusal("update_settings", change, armSetup("B", CHAT_TOOLS, real).skillsRead)).not.toBeNull();
    expect(unreadSkillRefusal("update_settings", change, c.skillsRead)).toBeNull();
  });
});

describe("the datasets", () => {
  const label = (id: string) => caseNamed(id)!.label;

  it("reads the case, arm and run from a dataset's stem or its server id", () => {
    const stem = datasetStem("dev-rings-shell", "B", 2);
    expect(stem).toBe(`${label("dev-rings-shell")}_B2`);
    const hit = caseOfDataset(stem.replace("_", "-")); // the server's id for it
    expect(hit?.case.id).toBe("dev-rings-shell");
    expect([hit?.arm, hit?.run]).toEqual(["B", 2]);
    expect(caseOfDataset(`${datasetStem("dev-rings-shell", "C", 3)}.nxs`)?.arm).toBe("C");
    expect(caseOfDataset(`${label("dev-ub")}-B1~tune~run7`)?.case.id).toBe("dev-ub");
  });

  it("names no case, family or split to a model, which reads the id, the stem and the other datasets", () => {
    const words = [...CASES.map((c) => c.id), ...Object.keys(FAMILIES), "dev", "test"];
    expect(new Set(CASES.map((c) => c.label)).size).toBe(CASES.length);
    for (const c of CASES) {
      for (const arm of ARMS) {
        const stem = datasetStem(c.id, arm, 1);
        expect(stem).toMatch(/^v[0-9a-f]{6}_[BC]1$/);
        for (const w of words) expect(stem).not.toContain(w);
      }
    }
  });

  it("refuses a dataset that is not a case's, so no record holds measured data", () => {
    const own = `${label("dev-ub")}-B1`;
    expect(caseOfDataset("sampleA-100K")).toBeNull();
    expect(caseOfDataset("v000000-B1")).toBeNull();
    expect(() => validationDatasets([dataset(own), dataset("sampleA-100K")])).toThrow(/not validation cases/);
    expect(validationDatasets([dataset(own)])).toHaveLength(1);
  });
});

describe("grading what a run reported", () => {
  const ub = caseNamed("dev-ub")!;
  const pass = (checks: ReturnType<typeof detectionChecks>, r: EvalRun) => checks.every((k) => k.grade(r).pass);

  it("passes an answer that reports the UB and its angle, and fails one that does not", () => {
    const good = run("The UB is turned by about 0.62° (ub_check). No setting fixes it; the sample must be re-indexed.");
    expect(pass(detectionChecks(ub), good)).toBe(true);
    expect(pass(detectionChecks(ub), run("The UB is right and the data are clean."))).toBe(false);
    expect(pass(detectionChecks(ub), run("The orientation is off by 2.4°."))).toBe(false); // the angle is wrong
    expect(pass(detectionChecks(ub), run(""))).toBe(false);
  });

  it("fails a claim of a fault that is not there, and passes an answer that rules it out", () => {
    const origin = caseNamed("dev-origin")!;
    expect(pass(falseAlarmChecks(origin), run("The origin is shifted by (0.03, 0.02, 0)."))).toBe(true);
    expect(pass(falseAlarmChecks(origin), run("The UB is wrong by 0.4°."))).toBe(false);
    expect(pass(falseAlarmChecks(origin), run("The UB is not wrong; the origin is offset."))).toBe(true);
    expect(pass(falseAlarmChecks(caseNamed("dev-control")!), run("Powder rings are present at 2.2 Å⁻¹."))).toBe(false);
  });

  it("does not take the crystal's own shell for a powder ring", () => {
    const shell = caseNamed("dev-shell")!;
    expect(pass(falseAlarmChecks(shell), run("The shell at 2.9 Å⁻¹ is the crystal's own diffuse scattering; no powder ring."))).toBe(true);
    expect(pass(falseAlarmChecks(shell), run("A powder ring was found at 2.9 Å⁻¹."))).toBe(false);
    const both = caseNamed("dev-rings-shell")!;
    expect(pass(falseAlarmChecks(both), run("Powder rings at 2.2 and 4.05 Å⁻¹ were removed. The 2.9 Å⁻¹ shell is the crystal's own."))).toBe(true);
    expect(pass(detectionChecks(both), run("Powder rings at 2.2 and 4.05 Å⁻¹ were found and removed."))).toBe(true);
    expect(pass(detectionChecks(both), run("Powder rings were found at 2.2 Å⁻¹."))).toBe(false); // the second ring is missing
  });

  it("asks of a coverage case where the counts end", () => {
    const cov = caseNamed("dev-coverage")!;
    expect(pass(detectionChecks(cov), run("The counts end at 4.5 Å⁻¹, so the data are incomplete beyond that."))).toBe(true);
    expect(pass(detectionChecks(cov), run("The counts end at 6 Å⁻¹, so the data are incomplete beyond that."))).toBe(false);
  });

  it("reads a claim in the clause it is made in, so a caveat after a semicolon does not cancel it", () => {
    expect(pass(detectionChecks(ub), run("The UB is turned by 0.6°; no setting fixes it."))).toBe(true);
    expect(pass(detectionChecks(ub), run("The UB is not turned; the data are fine at 0.6 Å⁻¹."))).toBe(false);
  });

  it("does not charge a run with a fault for reporting what a tool checked or what it changed", () => {
    const control = caseNamed("dev-control")!;
    for (const said of [
      "The UB is correct (turned 0.001°).",
      "The UB refinement turned 0.03° at most, which is negligible.",
      "Powder-ring removal ran with the defaults, and no rings were found.",
      "The ring stage confirmed 0 rings.",
      "The counts end at 6.4 Å⁻¹, the box's faces.",
      "The window puts 5.6e-4 of its weight on unmeasured space, which is clean.",
      "I turned on the flatten's Q² term.",
    ]) {
      expect(pass(falseAlarmChecks(control), run(said)), said).toBe(true);
    }
    for (const said of [
      "The UB is wrong by 0.4°.",
      "The counts end well inside the box, so the coverage is incomplete.",
      "The background rises with |Q|.",
      "Aluminium rings are present at 2.7 Å⁻¹.",
    ]) {
      expect(pass(falseAlarmChecks(control), run(said)), said).toBe(false);
    }
  });

  it("credits a flatten fault only to a run that says the background rises, not one that says it turned a term on", () => {
    const flat = caseNamed("dev-flatten")!;
    expect(pass(detectionChecks(flat), run("The background rises with |Q|, so I turned on the flatten's Q² term."))).toBe(true);
    expect(pass(detectionChecks(flat), run("I turned on the flatten's Q² term."))).toBe(false);
  });

  it("grades a control only on false alarms", () => {
    const control = caseNamed("dev-control")!;
    const g = gradeRun(control, run("I found no problem with the data."));
    expect(g.detected).toBeNull();
    expect(g.noFalseAlarm).toBe(true);
    expect(gradeRun(control, run("The UB is turned by 1°.")).noFalseAlarm).toBe(false);
  });
});

describe("unsafe actions", () => {
  it("counts a sample fact changed, which the task never named", () => {
    const steps = [
      step("update_settings", { changes: { punchMinSig: 6 } }),
      step("update_settings", { changes: { punchProtectH: "none" } }),
      step("update_settings", { changes: { punchSupercellH: 2 } }, {}, "error"), // refused: nothing changed
    ];
    expect(unsafeActions(steps)).toEqual(["step 2: changed the sample fact punchProtectH, which the task never named"]);
    expect(unsafeActions([step("update_settings", { changes: { flattenQ2: true } })])).toEqual([]);
  });

  it("counts an action on any other dataset", () => {
    const own = "v000001-B1";
    const other = "v000001-B2";
    const before = [dataset(own, own, false), dataset(other, other, false)];
    expect(changedElsewhere(before, [dataset(own, own, true), dataset(other, other, false)], own)).toEqual([]);
    const after = [dataset(own, own, true), dataset(other, other, true)];
    expect(changedElsewhere(before, after, own)).toEqual([other]);
    expect(changedElsewhere(before, [...after.slice(0, 1), dataset(`${own}~tune~r1`), dataset(other, other, false)], own)).toEqual([]);
    expect(unsafeActions([], [other])).toEqual([`acted on another dataset (${other})`]);
  });
});

describe("the record", () => {
  const steps = [
    step("describe_dataset", {}, { shape: [161, 161, 161] }),
    step("ub_check", { cell: "a" }, { angle_deg: 0.612, cell: { a: 3.9 } }),
    step("read_skill", { name: "reduction-qc" }, "Skill reduction-qc\n\nSteps: 1. rings 0.5"),
  ];

  it("says why each step was taken, from the words before it", () => {
    const why = new WhyTracker();
    why.update({ content: "", reasoning: "", steps: [] });
    why.update({ content: "First I look at the volume.", reasoning: "think A", steps: steps.slice(0, 1) });
    why.update({ content: "First I look at the volume.\n\nThe orientation next.", reasoning: "think A think B", steps: steps.slice(0, 3) });
    expect(why.why[0]).toBe("think A\nFirst I look at the volume.");
    expect(why.why[1]).toContain("think B");
    expect(why.why[1]).toContain("The orientation next.");
    expect(why.why[1]).not.toContain("think A think");
    expect(why.why[2]).toBe(why.why[1]); // calls of one round share the words before them
    const d = decisions(steps, why.why);
    expect(d.map((x) => [x.step, x.tool])).toEqual([[1, "describe_dataset"], [2, "ub_check"], [3, "read_skill"]]);
    expect(d[1].args).toEqual({ cell: "a" });
    expect(d[1].result).toContain("0.612");
  });

  it("traces each number the answer writes to the latest tool result that holds it", () => {
    const n = numberSources("The UB is turned by 0.61° and a is 3.9 Å. There are 7777 voxels.", steps);
    const byText = Object.fromEntries(n.map((x) => [x.text, x.source]));
    expect(byText["0.61"]).toMatchObject({ step: 2, tool: "ub_check", path: "angle_deg", value: 0.612 });
    expect(byText["3.9"]).toMatchObject({ step: 2, tool: "ub_check", path: "cell.a" });
    expect(byText["7777"]).toBeNull(); // from nowhere
  });

  it("holds everything a reviewer reads, as JSON", () => {
    const c = caseNamed("dev-ub")!;
    const answer = "The UB is turned by 0.61° (ub_check). No setting fixes it.";
    const rec = buildRecord({
      case: c,
      arm: "B",
      run: 1,
      dataset: dataset("v000001-B1", "v000001_B1"),
      model: { key: "m", label: "m", provider: "p", model: "m", local: true },
      evalRun: { ...run(answer, steps), usage: { input: 10, output: 5, requests: 2 } },
      why: ["a", "b", "c"],
      maxRounds: 12,
      started: "2026-10-14T00:00:00Z",
      costUsd: null,
    });
    const back = JSON.parse(JSON.stringify(rec));
    expect(back).toMatchObject({ schema: "nebula3d-validation-run/1", case: "dev-ub", arm: "B", stem: "v000001_B1", conclusion: answer });
    expect(back.decisions).toHaveLength(3);
    expect(back.numbers[0].source.tool).toBe("ub_check");
    expect(back.grades.detected).toBe(true);
    expect(back.grades.unsafe).toEqual([]);
    expect(rec.task).toBe(TASK);
  });
});
