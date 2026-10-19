// The check-verdict module's interface. One module owns each check's rule,
// the kind of its outcome (met, needs attention, not judged, with its reasons
// and the data's problems), the words its tool writes from that kind, and the
// run's achieved. The tools that judge (the producers) call `judge`; the
// readers of a run's verdicts call `verdicts`. Everything else under
// verdicts/ is implementation: rules.ts (the table of the checks' rules),
// readers.ts (the reader matrix and which result each reader reads) and
// recorded.ts (the word-reading adapter, for results without outcomes).
//
// Two exceptions read rules.ts itself. The tuning's modules (tune/evaluate.ts,
// tune/prompts.ts): the tools' registry imports them, and through this file
// they would import the readers, whose freshness (evidence.ts) imports the
// registry back: a cycle that the tests' module mocks cannot resolve. And the
// prompts (prompts/system.ts, prompts/templates.ts), which state what each
// check judges in the words its rule is stated in, without the readers and the
// registry behind them.

export { judge, UNROUNDED, WORDS } from "./rules";
export type {
  CheckId,
  CoverageMeasurements,
  Kind,
  Measurements,
  Outcome,
  Reason,
  Stage,
  StageNumbers,
  SymmetryMeasurements,
  Unrounded,
} from "./rules";
export { verdicts } from "./readers";
export type { ComputedVerdict, Verdicts } from "./readers";
