// The validation module (validation.ts), graded without a model: the split holds
// apart, the arms differ only in their skills, the graders pass the right
// answer and fail the wrong one, and a run's record says what it decided, where
// each number came from and what it concluded.

import { describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { buildChatMessages, systemPrompt } from "../prompts/templates";
import * as readings from "../readings";
import { fit, found, seen } from "../readings";
import { allSkills } from "../skills";
import { CHAT_TOOLS, MAX_RESULT_CHARS, runToolCall, toolsWithSkills, unreadSkillRefusal } from "../tools";
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
  evalRunOf,
  FAMILIES,
  falseAlarmChecks,
  gradeRun,
  numberSources,
  regradeRecord,
  regradeRun,
  stepOf,
  TASK,
  unsafeActions,
  validationDatasets,
  WhyTracker,
  type Decision,
  type RunRecord,
  type ValidationCase,
} from "./validation";

// No failure here shows a held-out case: a check that meets the test split names a
// test case by its masked name (as pytest does, tests/conftest.py), states what is
// wrong by its kind, and expects a boolean or a count, so vitest prints no value.

/** How a failure names a case: a dev case by its id, a test case by its masked name. */
const shownAs = (c: ValidationCase, tests: ValidationCase[] = casesIn("test")): string =>
  c.split === "dev" ? c.id : `test-split-case-${tests.indexOf(c)}`;

/** A value with its objects' keys sorted, to compare two faults whatever their key order. */
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]))
      : v;

/** What a test case shares with its family's dev case that it must not: by kind, never a value. */
const sharedWithDev = (dev: ValidationCase, test: ValidationCase): string[] => {
  const vectors = (c: ValidationCase) => c.planted.map((p) => p.vector.join(","));
  const shared: string[] = [];
  if (test.cell_a === dev.cell_a) shared.push("the cell");
  if (vectors(test).some((v) => vectors(dev).includes(v))) shared.push("a planted vector");
  if (Object.keys(dev.fault).length && JSON.stringify(canonical(test.fault)) === JSON.stringify(canonical(dev.fault))) {
    shared.push("the fault");
  }
  return shared;
};

/** Whether two lists hold the same cases, in order (compared by id: a failure shows none). */
const sameCases = (a: ValidationCase[], b: ValidationCase[]): boolean => a.length === b.length && a.every((c, i) => c.id === b[i].id);

/** A model sees a dataset's stem: it must be opaque and name no case, family or split. */
const expectOpaqueStem = (c: ValidationCase, arm: string, stem: string, words: string[], tests?: ValidationCase[]) => {
  expect(/^v[0-9a-f]{6}_[BC]1$/.test(stem), `${shownAs(c, tests)} ${arm}: the stem is not opaque`).toBe(true);
  expect(words.filter((w) => stem.includes(w)).length, `${shownAs(c, tests)} ${arm}: the stem names a case, family or split`).toBe(0);
};

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
      // A family is public (one dev and one test case each); what is shared, by its kind.
      expect(sharedWithDev(dev, test), family).toEqual([]);
    }
  });

  it("runs the test split only to be reported", () => {
    expect(() => casesToRun("test")).toThrow(/held out/);
    expect(() => casesToRun("test", { report: false })).toThrow(/held out/);
    expect(sameCases(casesToRun("test", { report: true }), casesIn("test")), "the reported run is not the test split").toBe(true);
    expect(casesToRun("dev")).toEqual(casesIn("dev"));
  });

  it("gives the model a task that names no case, fault or size", () => {
    for (const c of CASES) expect(TASK.includes(c.id), `the task names ${shownAs(c)}`).toBe(false);
    expect(TASK).not.toMatch(/\d+(\.\d+)?\s*(°|Å|%|r\.l\.u)/);
    expect(ARMS).toEqual(["B", "C"]);
  });
});

describe("a failure that meets the test split", () => {
  // A made-up held-out case, never a real one: each check above made to fail on it.
  const fake: ValidationCase = {
    id: "test-fake-ub",
    label: "vfa4e00",
    family: "ub",
    split: "test",
    cell_a: 5.25,
    planted: [{ vector: [0.25, 1.75, 0.5], sign: "+", distance_A: 9.632 }],
    fault: { angle_deg: 1.37, axis: [0, 0, 1] },
    truth: { angle_deg: 1.37 },
  } as ValidationCase;
  const twin = { ...fake, id: "dev-fake-ub", split: "dev" } as ValidationCase;
  /** All a failure prints: its message, and the values vitest diffs. */
  const failure = (check: () => void): string => {
    try {
      check();
    } catch (e) {
      const err = e as Error & { actual?: unknown; expected?: unknown; diff?: string };
      return [err.message, JSON.stringify(err.actual), JSON.stringify(err.expected), err.diff ?? ""].join("\n");
    }
    throw new Error("the check did not fail");
  };
  const showsNothingOf = (text: string) => {
    for (const v of [fake.id, fake.label, "5.25", "1.75", "1.37", "9.632", "0.25,1.75,0.5"]) expect(text.includes(v), v).toBe(false);
  };

  it("names it by its masked name and what is wrong by its kind, never a value", () => {
    let text = failure(() => expect(sharedWithDev(twin, fake), fake.family).toEqual([]));
    for (const kind of ["the cell", "a planted vector", "the fault"]) expect(text).toContain(kind);
    showsNothingOf(text);
    text = failure(() => expect(`Look at ${fake.id}.`.includes(fake.id), `the task names ${shownAs(fake, [fake])}`).toBe(false));
    expect(text).toContain("the task names test-split-case-0");
    showsNothingOf(text);
    text = failure(() => expectOpaqueStem(fake, "B", `${fake.id}_B1`, [fake.id], [fake]));
    expect(text).toContain("test-split-case-0 B: the stem is not opaque");
    showsNothingOf(text);
    text = failure(() => expectOpaqueStem(fake, "B", `${fake.label}_B1`, [fake.label], [fake]));
    expect(text).toContain("test-split-case-0 B: the stem names a case");
    showsNothingOf(text);
    expect(sameCases([fake], [twin])).toBe(false);
    expect(sameCases([fake], [fake])).toBe(true);
  });
});

describe("the arms", () => {
  const change = { id: "c1", type: "function" as const, function: { name: "update_settings", arguments: JSON.stringify({ changes: { punchMinSig: 6 } }) } };
  const ds = dataset("v000000-B1");

  it("gives arm B the Pilot as shipped: the skills on, their section in the system prompt, nothing read yet", async () => {
    const b = armSetup("B", {} as never);
    expect(b.skills).toBe(true);
    expect(b.skillsRead.size).toBe(0);
    expect(b.messages).toEqual(buildChatMessages({} as never, [], TASK, null, { tools: true }));
    expect(b.messages[0].content).toBe(systemPrompt({ tools: true }));
    expect(JSON.stringify(b.messages)).toContain("read_skill");
    expect(toolsWithSkills(CHAT_TOOLS, b.skills)).toBe(CHAT_TOOLS);
    // B's change waits for the punch's skill.
    const refused = await runToolCall(change, CHAT_TOOLS, { dataset: ds, datasets: [ds], skills: b.skills, skillsRead: b.skillsRead });
    expect(refused.text).toMatch(/^Error: read the method first/);
  });

  it("gives arm C the switch off: no skills' section, no read_skill, and no gate to refuse its changes", async () => {
    const c = armSetup("C", {} as never);
    expect(c.skills).toBe(false);
    expect(c.messages[0].content).toBe(systemPrompt({ tools: true, skills: false }));
    // The rest of the opening is B's.
    expect(c.messages.slice(1)).toEqual(armSetup("B", {} as never).messages.slice(1));
    const opening = JSON.stringify(c.messages);
    for (const s of allSkills()) expect(opening).not.toContain(s.name);
    expect(opening).not.toMatch(/skill/i);
    const offered = toolsWithSkills(CHAT_TOOLS, c.skills);
    expect(offered.map((t) => t.name)).toEqual(CHAT_TOOLS.map((t) => t.name).filter((n) => n !== "read_skill"));
    // No skill to read, and no gate: C may change what B may, with nothing read.
    usePipelineStore.setState({ punchMinSig: "4" });
    const changed = await runToolCall(change, offered, { dataset: ds, datasets: [ds], skills: c.skills, skillsRead: c.skillsRead });
    expect(changed.ok, changed.text).toBe(true);
    expect(c.skillsRead.size).toBe(0);
    expect(unreadSkillRefusal("update_settings", { changes: { punchMinSig: 6 } }, c.skillsRead)).not.toBeNull(); // the gate's rule, which C never meets
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
      for (const arm of ARMS) expectOpaqueStem(c, arm, datasetStem(c.id, arm, 1), words);
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

  describe("a result the model read fitted (readings/)", () => {
    // ub_check's whole result: 400 nodes, past the limit, so the model reads
    // the first nodes only; the last node's offset, 0.777, is left out.
    const whole = { angle_deg: 0.612, nodes: Array.from({ length: 400 }, (_, i) => ({ hkl: [i, 0, 0], offset: i === 399 ? 0.777 : 0.001 })) };
    const { text, full } = fit(whole, MAX_RESULT_CHARS);
    const fitted: AgentStep = { ...step("ub_check"), result: text, ...(full !== undefined ? { full } : {}), shortened: true };

    it("keeps what the model read as the result, and the whole beside it where they differ", () => {
      expect(full).toBe(JSON.stringify(whole));
      const d = decisions([steps[0], fitted], []);
      expect(d[0]).not.toHaveProperty("full");
      expect(d[0]).not.toHaveProperty("shortened");
      expect(d[1]).toMatchObject({ result: text, full, shortened: true });
      // A step whose `full` is no different keeps none.
      expect(decisions([{ ...steps[0], full: steps[0].result }], [])[0]).not.toHaveProperty("full");
    });

    it("maps a decision back to the step's readings, through JSON as a record keeps it", () => {
      const [d] = JSON.parse(JSON.stringify(decisions([fitted], []))) as Decision[];
      expect(stepOf(d)).toEqual({ status: "done", result: text, full });
      expect([seen(stepOf(d)), readings.whole(stepOf(d))]).toEqual([seen(fitted), readings.whole(fitted)]);
      expect(found(stepOf(d))).toEqual(whole);
      // A decision from a record made before `full`: its result is all there is.
      const [old] = decisions([steps[1]], []);
      expect(stepOf(old)).toEqual({ status: "done", result: steps[1].result });
    });

    it("traces a number only the whole result holds to it", () => {
      expect(text).not.toContain("0.777");
      const n = numberSources("The last node is offset by 0.777.", [steps[0], fitted]);
      expect(n[0].source).toEqual({ step: 2, tool: "ub_check", path: "nodes[399].offset", value: 0.777 });
    });

    it("keeps the schema: the record's new fields are optional", () => {
      const rec = buildRecord({
        case: caseNamed("dev-ub")!,
        arm: "B",
        run: 1,
        dataset: dataset("v000001-B1", "v000001_B1"),
        model: { key: "m", label: "m", provider: "p", model: "m", local: true },
        evalRun: run("The UB is turned by {{ub_check.angle_deg}}°; the last node is offset by 0.777.", [fitted]),
        why: [""],
        maxRounds: 12,
        started: "2026-10-19T00:00:00Z",
        costUsd: null,
      });
      const back = JSON.parse(JSON.stringify(rec)) as RunRecord;
      expect(back.schema).toBe("nebula3d-validation-run/1");
      expect(back.decisions[0]).toMatchObject({ result: text, full, shortened: true });
      expect(back.numbers.find((x) => x.text === "0.777")?.source).toMatchObject({ step: 1, path: "nodes[399].offset" });
      const old: Decision = { ...back.decisions[0] };
      delete old.full;
      delete old.shortened;
      expect(stepOf(old)).toEqual({ status: "done", result: text });
    });
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
    expect(back.failure).toBeNull();
    expect(back.tool_offers).toEqual([]);
    expect(rec.task).toBe(TASK);
    // No window given: recorded as unknown, not left out.
    expect(back.context_window).toBeNull();
  });

  it("keeps the context window the run had and the minimum it was held to", () => {
    const context = { tokens: 65_536, min_tokens: 49_152, read_from: "lmstudio-loaded" as const };
    const rec = buildRecord({
      case: caseNamed("dev-ub")!,
      arm: "C",
      run: 2,
      dataset: dataset("v000001-C2", "v000001_C2"),
      model: { key: "m", label: "m", provider: "p", model: "m", local: true },
      evalRun: run("No fault found.", []),
      why: [],
      maxRounds: 12,
      started: "2026-10-19T00:00:00Z",
      costUsd: null,
      context,
    });
    const back = JSON.parse(JSON.stringify(rec));
    expect(back.context_window).toEqual(context);
    // The schema is unchanged: the field is optional (`delete` compiles only on an
    // optional field), so records made before it stay valid.
    expect(back.schema).toBe("nebula3d-validation-run/1");
    const old: RunRecord = { ...rec };
    delete old.context_window;
    expect(old.context_window).toBeUndefined();
  });
});

describe("a record graded again (NEBULA_VALIDATION_REGRADE)", () => {
  const steps = [
    step("describe_dataset", {}, { shape: [161, 161, 161] }),
    step("ub_check", { cell: "a" }, { angle_deg: 0.612, cell: { a: 3.9 } }),
  ];
  const recorded = (): RunRecord =>
    JSON.parse(
      JSON.stringify(
        buildRecord({
          case: caseNamed("dev-ub")!,
          arm: "B",
          run: 1,
          dataset: dataset("v000001-B1", "v000001_B1"),
          model: { key: "m", label: "m", provider: "p", model: "m", local: true },
          evalRun: run("The UB is turned by 0.61° (ub_check). No setting fixes it.", steps),
          why: ["", ""],
          maxRounds: 12,
          started: "2026-10-19T00:00:00Z",
          costUsd: null,
          elsewhere: ["v000001-B2"],
        }),
      ),
    ) as RunRecord;

  it("rebuilds the run from its conclusion and decisions, and grades it as the run was graded", () => {
    const rec = recorded();
    const back = evalRunOf(rec);
    expect(back.content).toBe(rec.conclusion);
    expect(back.steps.map((s) => [s.name, s.status, s.args])).toEqual(steps.map((s) => [s.name, s.status, s.args]));
    expect(back.steps.map(seen)).toEqual(steps.map(seen));
    expect(regradeRun(rec)).toEqual(rec.grades);
  });

  it("grades the words again, and keeps the unsafe actions as the run counted them", () => {
    const rec = recorded();
    expect(rec.grades.unsafe).toEqual(["acted on another dataset (v000001-B2)"]);
    rec.grades = { ...rec.grades, detection: [], detected: false };
    expect(regradeRecord({ split: "dev", runs: [rec] })).toBe(1);
    expect([rec.grades.detected, rec.grades.unsafe]).toEqual([true, ["acted on another dataset (v000001-B2)"]]);
    expect(regradeRecord({ split: "dev", runs: [rec] })).toBe(0);
  });

  it("refuses a record of the held-out test split without the report's opt-in", () => {
    const fake = { ...recorded(), case: "test-fake-ub", split: "test" as const };
    expect(() => regradeRecord({ split: "test", runs: [fake] })).toThrow(/held-out test split/);
    expect(() => regradeRecord({ runs: [fake] })).toThrow(/held-out test split/);
  });
});
