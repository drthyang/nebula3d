// The verdict on a whole reply's run, computed from the deterministic checks:
// is the reduction one the 3D-ΔPDF can be trusted from, and what problems do
// the data have that no setting fixes? The model explains it; it never decides
// it (THY-18). The answer quotes it as {{achieved}} (references.ts), the answer
// checks hold a claim of success to it (answerChecks.ts), and the console shows
// it under the reply.
//
// The check-verdict module computes it (verdicts/, the achieved reader): met
// when every stage of the run, measured after it was last computed, meets its
// goal, and none of the checks on the result that ran (the window against the
// coverage, the symmetry, the fill's texture) needs attention. With a stage
// not measured since it was computed, it is not judged.

import type { AgentStep } from "./agent";
import { verdicts, type ComputedVerdict } from "./verdicts";

export type { ComputedVerdict } from "./verdicts";

/** The verdict on the run so far, or null when the reply measured nothing it rests on. */
export const computedVerdict = (steps: readonly AgentStep[]): ComputedVerdict | null => verdicts({ reply: steps }).achieved;

/**
 * The line under a reply: the verdict when the reply judged the run (met, or
 * not met), else the data's problems when it found any; nothing for a reply
 * that measured too little to judge the run (a question about one stage).
 */
export function verdictLine(v: ComputedVerdict | null | undefined): string | null {
  if (!v) return null;
  const end = (t: string) => (t.endsWith(".") ? t : `${t}.`); // "… r.l.u." takes no second stop
  if (v.achieved !== null) return end(`Verdict from the checks: ${v.text}`);
  return v.dataProblems.length ? end(`From the checks: data problems no setting fixes: ${v.dataProblems.join("; ")}`) : null;
}
