// The check-verdict module's interface. One module owns each check's rule,
// the kind of its outcome (met, needs attention, not judged, with its reasons
// and the data's problems), the words its tool writes from that kind, and the
// run's achieved. The tools that judge (the producers) call `judge`; the
// readers of a run's verdicts read `verdicts`. Everything else under
// verdicts/ is implementation: rules.ts, the table of the checks' rules.

export { judge, UNROUNDED, WORDS } from "./rules";
export type { CheckId, Kind, Measurements, Outcome, Reason, Stage, StageNumbers, Unrounded } from "./rules";
