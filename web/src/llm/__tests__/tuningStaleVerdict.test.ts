// THY-82: a tuning inside a reply, then the reply's claim on the tuned stage.
// Found in the THY-65 PR 6 smoke run, and again in the quick-auto run of
// 2026-11-25 (dev-flatten): an auto fix reply, seeded with the app's flatten
// check (a pedestal left), tuned the flatten; the app reran it after the
// reply. The reply's claim that the pedestal is gone was sent back as
// contradicting the flatten verdict from before the tuning.
//
// The owner's rule (2026-11-25, option B): a tuning's verdict on the trial it
// kept, by the checks' own rule (tune_pipeline, its outcomes beside its
// result), is the answer checks' newest verdict on the stage it tuned.
// THY-18 stays as strict: the verdict is a tool's, never the model's, and a
// claim the kept trial does not bear out is still sent back. {{achieved}},
// the report, the ring gate and auto mode's problems and plan read the
// outputs on disk alone.

import { describe, expect, it } from "vitest";
import type { AgentStep } from "../agent";
import { answerIssues, contradictions, evidenceGaps } from "../answerChecks";
import { judge, verdicts } from "../verdicts";
import { outcomesOf, trialOutcomesOf } from "../verdicts/recorded";

const step = (id: string, name: string, args: Record<string, unknown>, result: unknown, outcomes?: AgentStep["outcomes"]): AgentStep => ({
  id,
  name,
  args,
  status: "done",
  result: JSON.stringify(result),
  ...(outcomes ? { outcomes } : {}),
});

const PEDESTAL = { floor_trend: 0.97, floor_span_fraction: 0.97 };
const FLAT = { floor_trend: 0.04, floor_span_fraction: 0.6 };

/** The app's check, seeded into the fix reply: the flatten left a pedestal. */
const seededCheck = step("auto:assess", "assess_stage", { stage: "flatten" }, { flatten: { verdict: "needs attention", ...PEDESTAL } });

/** The reply's tuning of the flatten, as tune_pipeline returns it: its result, and its verdict on the trial it kept beside it. */
const tuning = (kept: Record<string, number>): AgentStep =>
  step(
    "tune",
    "tune_pipeline",
    { stages: ["flatten"] },
    {
      minutes: 2.1,
      stages: [{ stage: "flatten", status: "done", tuned: true, chosen_trial: 2, of: 3, changes: { flattenQ2: true }, result: "floor trend 0.04 · span 0.6" }],
      write_outputs_with: { tool: "run_pipeline", from_stage: "flatten" },
    },
    [judge("flatten", kept)],
  );

const CLAIM = "The flatten now passes: the tuning removed the pedestal (trial 2 of 3).";

describe("a tuning inside a reply and the verdict before it (THY-82)", () => {
  it("does not hold a claim on the tuned stage to the verdict from before the tuning", () => {
    expect(contradictions(CLAIM, [seededCheck, tuning(FLAT)]).map((t) => t.id)).not.toContain("flatten");
    const issues = answerIssues(CLAIM, [seededCheck, tuning(FLAT)], "trial 2 of 3"); // its numbers, from the tuning's result
    expect(issues).toBeNull(); // nothing sent back
  });

  it("still holds it to that verdict without a tuning", () => {
    expect(contradictions(CLAIM, [seededCheck]).map((t) => t.id)).toEqual(["flatten"]);
  });

  it("holds it to the kept trial's verdict: a pedestal the trial kept is still a contradiction", () => {
    expect(contradictions(CLAIM, [seededCheck, tuning(PEDESTAL)]).map((t) => t.id)).toEqual(["flatten"]);
  });

  it("reads a check after the tuning over the tuning's verdict, as the newest", () => {
    const after = step("assess2", "assess_stage", { stage: "flatten" }, { flatten: { verdict: "needs attention", ...PEDESTAL } });
    expect(contradictions(CLAIM, [seededCheck, tuning(FLAT), after]).map((t) => t.id)).toEqual(["flatten"]);
  });

  it("counts the tuning as evidence on the stage it judged, and on no other", () => {
    expect(evidenceGaps(CLAIM, [tuning(FLAT)])).toEqual({ missing: [], stale: [] });
    const nothingKept = { ...tuning(FLAT), outcomes: [] };
    expect(evidenceGaps(CLAIM, [nothingKept]).missing.map((t) => t.id)).toEqual(["flatten"]);
    expect(evidenceGaps("The punch is clean.", [tuning(FLAT)]).missing.map((t) => t.id)).toEqual(["punch"]);
  });

  it("goes stale, as a check does, once a run recomputes the stage", () => {
    const run = step("run", "run_pipeline", { from_stage: "flatten" }, { stages: { flatten: "computed", pdf: "computed" } });
    expect(evidenceGaps(CLAIM, [tuning(FLAT), run]).stale.map((t) => t.id)).toEqual(["flatten"]);
  });

  it("leaves {{achieved}} on the outputs on disk", () => {
    const v = verdicts({ reply: [seededCheck, tuning(FLAT)] });
    expect(v.checks.flatten).toBe("pass"); // the answer checks: the kept trial's
    expect(v.achieved?.stages.flatten).toBe("attention"); // the run's verdict: the check's, on disk
  });

  it("gives its verdict to the answer checks alone: every other reader of a step's outcomes sees none", () => {
    expect(outcomesOf(tuning(FLAT))).toEqual([]);
    expect(trialOutcomesOf(tuning(FLAT))).toEqual([judge("flatten", FLAT)]);
    expect(trialOutcomesOf(seededCheck)).toEqual([]);
    expect(trialOutcomesOf({ ...tuning(FLAT), status: "error" })).toEqual([]);
  });
});
