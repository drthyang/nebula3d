// The line under a reply: the verdict on its run, as the check-verdict module
// computed it from the checks the reply ran (verdicts/, the achieved reader),
// is the answer's {{achieved}} (references.ts), what the answer checks hold a
// claim of success to (answerChecks.ts), and what the console shows under the
// reply, here.

import type { ComputedVerdict } from "./verdicts";

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
