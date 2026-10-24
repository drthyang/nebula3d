// The grader and the app on each dev case's own UB turn (plan 3.2): ub_check
// on every dev case without a turned UB, built on 81 points per axis, and an
// answer that quotes the turn it found ("The UB is turned by …°"). The app
// calls the UB turned at 0.05° or more from an unsymmetrised fit (UB_TURNED);
// the grader charges the answer with a misorientation that is not there at
// its own 0.05° (evals/validation.ts). On every such case the two agree.
//
// The cases whose turn falls in [0.05°, 0.1°) are those the grader's 0.1° of
// before let through and the shared limit charges: IN_THE_BAND names them
// (none), so a case that moves into the band fails here first. A case in the
// band would be the fit's own turn read as a data problem by the app as well:
// a finding about the UB fit, not about the grader.

import { describe, expect, it } from "vitest";

import { UB_TURNED } from "../../verdicts/rules";
import type { EvalRun } from "../harness";
import { caseNamed, falseAlarmChecks } from "../validation";
import { DEV_GRIDS } from "./bridgeWorker";
import { DEV_CASE_IDS, devCase, type DevCaseId } from "./index";

const N = DEV_GRIDS[0]; // 81
const IN_THE_BAND: readonly DevCaseId[] = [];

const run = (content: string): EvalRun => ({ scenario: "ub", steps: [], content, latencyMs: 0, usage: null });

/** The grader's charge on the case's own false alarms: the answer claims a misorientation the case does not have. */
const charges = (id: DevCaseId, answer: string): boolean => {
  const alarm = falseAlarmChecks(caseNamed(id)!).find((k) => k.name.endsWith("(ub)"));
  expect(alarm, `${id} is graded on a turned UB it does not have`).toBeDefined();
  return !alarm!.grade(run(answer)).pass;
};

describe(`the grader and the app on each dev case's own UB turn (n=${N})`, () => {
  const band: DevCaseId[] = [];
  for (const id of DEV_CASE_IDS.filter((x) => x !== "dev-ub")) {
    it(`${id}: an answer quoting the turn is charged exactly where the app calls the UB turned`, async () => {
      const ub = await devCase(id, { n: N }).tool("ub_check");
      expect(ub.ok, ub.summary).toBe(true);
      const turn = ub.result.orientation_change_deg;
      const msg = `${id} at n=${N}: turned ${String(turn)}° (fit ${String(ub.result.fit)}, symmetrised ${String(ub.result.symmetrised)})`;
      console.log(msg);
      expect(typeof turn, msg).toBe("number");
      expect(charges(id, `The UB is turned by ${String(turn)}°.`), msg).toBe(UB_TURNED(ub.result));
      if ((turn as number) >= 0.05 && (turn as number) < 0.1) band.push(id);
    });
  }

  it("names the cases whose turn falls in [0.05°, 0.1°)", () => {
    expect(band).toEqual(IN_THE_BAND);
  });
});
