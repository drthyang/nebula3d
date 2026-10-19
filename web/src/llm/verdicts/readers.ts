// The readers of a run's verdicts, and the reader matrix: one row per check,
// one column per reader. The readers are the chat's achieved ({{achieved}},
// the verdict computed on a reply's run), the answer checks (what a claim in
// the answer is held to) and the report. A cell reads a check's outcome as
// that reader reads it; a cell that departs from the outcome's kind names its
// rule, and the rule's comment says the one line that unifies it.
//
// Implementation behind verdicts/index.ts. It reads tool results only, never
// the model's words; a step's outcomes come from the word-reading adapter
// (recorded.ts). Freshness comes from evidence.ts: a check's result counts
// only after the last run that recomputed the stage it reads.

import type { AgentStep } from "../agent";
import { current, recomputedAt, type PipelineStage } from "../evidence";
import { outcomesOf } from "./recorded";
import { judge, STAGES, type CheckId, type Kind, type Outcome, type Stage } from "./rules";

/** The verdict on a run: computed from its checks, never from the model's words. The validation's records persist it as computed_verdict. */
export interface ComputedVerdict {
  achieved: boolean | null; // null: not judged
  stages: Partial<Record<Stage, Kind>>; // each stage measured as it now is
  attention: string[]; // what needs attention
  notMeasured: string[]; // stages not measured since they were computed
  dataProblems: string[]; // what the data hold that no setting fixes
  text: string; // the verdict in words, as {{achieved}} quotes it
}

/** A run's verdicts: the run's achieved, and each check's kind as the run's other reader reads it (a reply's: the answer checks). */
export interface Verdicts {
  achieved: ComputedVerdict | null;
  checks: Partial<Record<CheckId, Kind>>;
}

/** The stage whose outputs each check reads: a run that recomputes it makes the check's result stale. null: the raw volume, which no run changes. */
export const READS: Record<CheckId, PipelineStage | null> = {
  rings: "rings",
  punch: "punch",
  backfill: "backfill",
  flatten: "flatten",
  pdf: "pdf",
  coverage: "pdf",
  symmetry: "pdf",
  texture: "backfill",
  grain: "punch",
  ub: null,
};

type Reader = "achieved" | "answer";

/** How a reader reads one outcome: its kind, or undefined where it does not read it at all. */
type Cell = (o: Outcome) => Kind | undefined;

const asIs: Cell = (o) => o.kind;
const unread: Cell = () => undefined;

// ---------------------------------------------------------------- the rules the readers keep

/**
 * D1: the answer checks take nothing from a passing coverage verdict that
 * rests on the reach inside full coverage ("the transform reaches … inside full
 * coverage"): it settles nothing, where {{achieved}} reads it as a pass.
 * Unify (2.4.1): set this to false.
 */
export const D1_REACH_PASS_SETTLES_NOTHING = true;

/**
 * D3, for {{achieved}}: grain_check counts for nothing in the run's verdict, not
 * even as measured. Unify (2.4.3): set this to false, with the grain rule
 * writing its "UB off" data problem (it writes none yet, as nobody read one).
 */
export const D3_ACHIEVED_IGNORES_GRAIN = true;

/**
 * D3, for the answer checks' grain topic: grain_check decides it only where its
 * words name a second grain or no second grain; its "UB off" and peaks beside
 * the nodes settle nothing there (grain_check stays the check for a second
 * grain, 2.4.3 keeps this).
 */
export const D3_ANSWER_GRAIN_SECOND_GRAIN_ONLY = true;

/**
 * D3, for the answer checks' UB topic: only ub_check decides it, though
 * grain_check settles the UB topic too (its facts, tools/index.ts). Unify
 * (2.4.3): set this to false; grain_check's "UB off" then holds a claim that
 * the UB is right to account.
 */
export const D3_ANSWER_UB_FROM_UB_CHECK_ONLY = true;

/**
 * D7: which of a check's current results a reader reads. {{achieved}} reads
 * the newest, even one that judged nothing ("info"); the answer checks the
 * newest that decides (passes or needs attention). Unify (2.4.7): set the
 * answer checks' to "newest".
 */
export const D7_SELECTION: Record<Reader, "newest" | "newest that decides"> = { achieved: "newest", answer: "newest that decides" };

/**
 * D8: the answer checks' backfill topic reads assess_stage only, where
 * {{achieved}} and the report count texture_check's fill bias. Unify (2.4.8):
 * set this to false.
 */
export const D8_ANSWER_BACKFILL_IGNORES_TEXTURE = true;

/**
 * D10: words no producer wrote ("past", "unmeasured", "not" opening a coverage
 * verdict, recorded.ts) are "not ok" to the answer checks and no attention to
 * {{achieved}}. Unify: set this to false; {{achieved}} then reads them as the
 * attention they are to the answer checks.
 */
export const D10_ACHIEVED_IGNORES_LEGACY_COVERAGE_WORDS = true;

/**
 * D11: the answer checks judge a stage whose output is missing (assess_stage
 * wrote "missing") from its numbers, as any result without a label: not judged,
 * but for the 3D-ΔPDF a pass (D15), which overrides an earlier verdict on it.
 * {{achieved}} skips it. Unify: set this to false; a missing output then
 * decides nothing.
 */
export const D11_ANSWER_JUDGES_MISSING_OUTPUT = true;

/**
 * D12: the answer checks take a stage's recorded verdict that is no label as
 * deciding nothing; {{achieved}} judges the stage from its numbers. Unify: set
 * this to false; both judge the numbers.
 */
export const D12_ANSWER_SKIPS_WORDS_THAT_ARE_NO_LABEL = true;

// ---------------------------------------------------------------- the matrix

/** A stage, as {{achieved}} reads it: its kind; a missing output is no result. */
const stageForAchieved: Cell = (o) => (o.reasons.includes("no output") ? undefined : o.kind);

/** A stage, as the answer checks read it (D11, D12). */
const stageForAnswer: Cell = (o) => {
  if (o.reasons.includes("no output")) return D11_ANSWER_JUDGES_MISSING_OUTPUT ? judge(o.check, {} as never).kind : "info";
  if (D12_ANSWER_SKIPS_WORDS_THAT_ARE_NO_LABEL && o.reasons.includes("words not a label")) return "info";
  return o.kind;
};

/** grain_check's outcome as the answer checks' UB topic would read it, were D3 unified. */
const grainAsUb: Cell = (o) => (o.reasons.includes("UB off") ? "attention" : undefined);

interface Row {
  achieved: Cell;
  answer: [CheckId, Cell][]; // the outcomes the answer checks read for this check's topic
}

const stage = (check: Stage): Row => ({ achieved: stageForAchieved, answer: [[check, stageForAnswer]] });

const MATRIX: Record<CheckId, Row> = {
  rings: stage("rings"),
  punch: stage("punch"),
  backfill: D8_ANSWER_BACKFILL_IGNORES_TEXTURE ? stage("backfill") : { achieved: stageForAchieved, answer: [["backfill", stageForAnswer], ["texture", asIs]] },
  flatten: stage("flatten"),
  pdf: stage("pdf"),
  coverage: {
    // D10: legacy words are no verdict to {{achieved}}.
    achieved: (o) => (D10_ACHIEVED_IGNORES_LEGACY_COVERAGE_WORDS && o.reasons.includes("legacy coverage words") ? "info" : o.kind),
    // D1: a pass by the reach inside full coverage settles nothing.
    answer: [["coverage", (o) => (D1_REACH_PASS_SETTLES_NOTHING && o.kind === "pass" && o.reasons.includes("reach inside coverage") ? "info" : o.kind)]],
  },
  symmetry: { achieved: asIs, answer: [["symmetry", asIs]] },
  texture: { achieved: asIs, answer: [] },
  grain: {
    achieved: D3_ACHIEVED_IGNORES_GRAIN ? unread : () => "info",
    // D3: decided only by a second grain or none.
    answer: [
      [
        "grain",
        (o) =>
          !D3_ANSWER_GRAIN_SECOND_GRAIN_ONLY ? o.kind : o.reasons.includes("second grain") ? "attention" : o.reasons.includes("no second grain") ? "pass" : "info",
      ],
    ],
  },
  // ub_check writes the UB's data problems (UB_TURNED_FOR_ACHIEVED) and its kind for the answer checks (UB_OFF_FOR_ANSWER): D4, in rules.ts.
  ub: { achieved: () => "info", answer: D3_ANSWER_UB_FROM_UB_CHECK_ONLY ? [["ub", asIs]] : [["ub", asIs], ["grain", grainAsUb]] },
};

// ---------------------------------------------------------------- a reply

interface Found {
  index: number;
  o: Outcome;
}

const decides = (k: Kind): boolean => k === "pass" || k === "attention";

/** The result a reader reads among a check's current outcomes, newest first, by its selection (D7), with the kind it reads. */
function pick(found: readonly Found[], at: Record<PipelineStage, number>, reader: Reader, sources: [CheckId, Cell][]): { o: Outcome; kind: Kind } | null {
  for (let i = found.length - 1; i >= 0; i--) {
    const { index, o } = found[i];
    const source = sources.find(([check]) => check === o.check);
    if (!source || !current(at, READS[o.check], index)) continue;
    const kind = source[1](o);
    if (kind === undefined) continue;
    if (D7_SELECTION[reader] === "newest" || decides(kind)) return { o, kind };
  }
  return null;
}

/** How {{achieved}} names a stage. */
const STAGE_LABEL: Record<Stage, string> = {
  rings: "the ring removal",
  punch: "the Bragg punch",
  backfill: "the backfill",
  flatten: "the flatten",
  pdf: "the 3D-ΔPDF",
};

/** How {{achieved}} names the checks on the result that can need attention. */
const ON_RESULT: [CheckId, string][] = [
  ["coverage", "the ΔPDF window against the coverage"],
  ["symmetry", "the ΔPDF's symmetry"],
  ["texture", "the backfill's texture"],
  ["ub", ""],
  ["grain", ""],
];

/** {{achieved}}: met when every stage, measured as it now is, meets its goal and no check on the result needs attention; not judged with a stage not measured since it was computed; null when the reply measured nothing it rests on. */
function achievedOf(found: readonly Found[], at: Record<PipelineStage, number>): ComputedVerdict | null {
  const stages: Partial<Record<Stage, Kind>> = {};
  for (const s of STAGES) {
    const p = pick(found, at, "achieved", [[s, MATRIX[s].achieved]]);
    if (p) stages[s] = p.kind;
  }
  const attention = STAGES.filter((s) => stages[s] === "attention").map((s) => STAGE_LABEL[s]);
  const notMeasured = STAGES.filter((s) => stages[s] === undefined || stages[s] === "info").map((s) => STAGE_LABEL[s]);
  const dataProblems: string[] = [];
  let measuredAny = Object.keys(stages).length > 0;
  // The checks on the result: the newest of each, on the outputs as they now are.
  for (const [check, label] of ON_RESULT) {
    const p = pick(found, at, "achieved", [[check, MATRIX[check].achieved]]);
    if (!p) continue;
    measuredAny = true;
    if (p.kind === "attention" && label) attention.push(label);
    dataProblems.push(...p.o.dataProblems);
  }
  if (!measuredAny) return null;
  const achieved = attention.length ? false : notMeasured.length ? null : true;
  const words =
    achieved === true
      ? "met: every stage meets its goal"
      : achieved === false
        ? `not met: needs attention: ${attention.join(", ")}`
        : `not judged: not measured since it was last computed: ${notMeasured.join(", ")}`;
  const text = words + (dataProblems.length ? `; data problems no setting fixes: ${dataProblems.join("; ")}` : "");
  return { achieved, stages, attention, notMeasured, dataProblems, text };
}

/** Each check's kind as the answer checks read it: the result that decides, by its selection (D7). */
function answerOf(found: readonly Found[], at: Record<PipelineStage, number>): Partial<Record<CheckId, Kind>> {
  const checks: Partial<Record<CheckId, Kind>> = {};
  for (const check of Object.keys(MATRIX) as CheckId[]) {
    const p = pick(found, at, "answer", MATRIX[check].answer);
    if (p) checks[check] = p.kind;
  }
  return checks;
}

/** A run's verdicts: a reply's, from its steps' tool results. */
export function verdicts(run: { reply: readonly AgentStep[] }): Verdicts {
  const steps = run.reply;
  const at = recomputedAt(steps);
  const found = steps.flatMap((step, index) => outcomesOf(step).map((o) => ({ index, o })));
  return { achieved: achievedOf(found, at), checks: answerOf(found, at) };
}
