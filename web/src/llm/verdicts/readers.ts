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
import type { Measured } from "../report/report";
import { outcomesOf, outcomesOfMeasured } from "./recorded";
import { isOriginProblem, judge, STAGES, type CheckId, type Kind, type Outcome, type Stage } from "./rules";

/** The verdict on a run: computed from its checks, never from the model's words. The validation's records persist it as computed_verdict. */
export interface ComputedVerdict {
  achieved: boolean | null; // null: not judged
  stages: Partial<Record<Stage, Kind>>; // each stage measured as it now is
  attention: string[]; // what needs attention
  notMeasured: string[]; // stages not measured since they were computed
  dataProblems: string[]; // what the data hold that no setting fixes
  text: string; // the verdict in words, as {{achieved}} quotes it
}

/** A run's verdicts: the run's achieved, and each check's kind as the run's other reader reads it (a reply's: the answer checks; a report's: its cards). */
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
 * D1, unified (plan 2.4.1, the user's decision of 2026-10-19): a passing
 * coverage verdict that rests on the reach inside full coverage ("the
 * transform reaches … inside full coverage") is coverage OK to the answer
 * checks, as to {{achieved}}. true: it settles nothing for the answer checks,
 * their reading before 2.4.1.
 */
export const D1_REACH_PASS_SETTLES_NOTHING = false;

/**
 * D3, for {{achieved}}, unified (plan 2.4.3, the user's decision of
 * 2026-10-19): grain_check counts as measured, and its "UB off" is a data
 * problem of the run's verdict (the grain rule writes it, ubOffProblem). true:
 * grain_check counted for nothing in the run's verdict, not even as measured,
 * its reading before 2.4.3.
 */
export const D3_ACHIEVED_IGNORES_GRAIN = false;

/**
 * D3, for the answer checks' grain topic: grain_check decides it only where its
 * words name a second grain or no second grain; its "UB off" and peaks beside
 * the nodes settle nothing there (grain_check stays the check for a second
 * grain, 2.4.3 keeps this).
 */
export const D3_ANSWER_GRAIN_SECOND_GRAIN_ONLY = true;

/**
 * D3, for the answer checks' UB topic, unified (plan 2.4.3, the user's
 * decision of 2026-10-19): grain_check, which settles the UB topic too (its
 * facts, tools/index.ts), decides it where it finds the UB off, which then
 * holds a claim that the UB is right to account; its other findings say
 * nothing of the UB. true: only ub_check decided it, before 2.4.3.
 */
export const D3_ANSWER_UB_FROM_UB_CHECK_ONLY = false;

/**
 * D7, unified (plan 2.4.7, the user's decision of 2026-10-19): which of a
 * check's current results a reader reads. Both read the newest, even one that
 * judged nothing ("info"). A result that decides nothing for a topic is not
 * read at all (its cell gives undefined), so it hides no earlier verdict: a
 * missing output (D11, but the 3D-ΔPDF's), words that are no label (D12), and
 * grain_check's findings that name no second grain (D3). On the UB, the newest
 * evidence across ub_check and grain_check's "UB off" wins, for both readers
 * (achievedOf, and the ub row's sources). "newest that decides" (passes or
 * needs attention): the answer checks' reading before 2.4.7.
 */
export const D7_SELECTION: Record<Reader, "newest" | "newest that decides"> = { achieved: "newest", answer: "newest" };

/**
 * D8, unified (plan 2.4.8, the user's decision of 2026-10-19): the answer
 * checks' backfill topic counts texture_check's fill bias, as {{achieved}} and
 * the report do. It reads the newest assess_stage backfill verdict and the
 * newest texture_check, each on its own, and combines them: it needs attention
 * if either needs attention, and passes only when both pass (one check's newer
 * pass never hides the other's attention). true: it read assess_stage only,
 * before 2.4.8.
 */
export const D8_ANSWER_BACKFILL_IGNORES_TEXTURE = false;

/**
 * D10: words no producer wrote ("past", "unmeasured", "not" opening a coverage
 * verdict, recorded.ts) are "not ok" to the answer checks and no attention to
 * {{achieved}}. Unify: set this to false; {{achieved}} then reads them as the
 * attention they are to the answer checks.
 */
export const D10_ACHIEVED_IGNORES_LEGACY_COVERAGE_WORDS = true;

/**
 * D11: the answer checks judge a stage whose output is missing (assess_stage
 * wrote "missing") from its numbers, as any result without a label: nothing to
 * judge, which decides nothing and is not read (D7), but for the 3D-ΔPDF a pass
 * (D15), which overrides an earlier verdict on it. {{achieved}} skips it.
 * Unify: set this to false; a missing output then decides nothing.
 */
export const D11_ANSWER_JUDGES_MISSING_OUTPUT = true;

/**
 * D12: the answer checks take a stage's recorded verdict that is no label as
 * deciding nothing (not read, D7); {{achieved}} judges the stage from its
 * numbers. Unify: set this to false; both judge the numbers.
 */
export const D12_ANSWER_SKIPS_WORDS_THAT_ARE_NO_LABEL = true;

/**
 * D2, unified (plan 2.4.2, the user's decision of 2026-10-19): the report's
 * 3D-ΔPDF card counts qmax_coverage's "too far" (its window's weight past the
 * limit, or the transform's reach past full coverage), read as {{achieved}}
 * reads it, besides the weight on unmeasured space. true: the card read the
 * coverage's weight only, where the ΔPDF's evaluation records none, and never
 * its verdict, the report's reading before 2.4.2.
 */
export const D2_REPORT_COVERAGE_BY_WEIGHT_ONLY = false;

/**
 * D9: without a ΔPDF evaluation, the report judges its 3D-ΔPDF card from the
 * coverage and the symmetry alone, where {{achieved}} says the ΔPDF was not
 * measured. Unify (2.4.9): set this to false; the card is then not judged.
 */
export const D9_REPORT_PDF_CARD_WITHOUT_EVALUATION = true;

/**
 * D13: the report's 3D-ΔPDF card reads the symmetry from symmetry_check alone,
 * never from the ΔPDF evaluation's own worst break, which the chat's ΔPDF stage
 * counts (the evaluation broken, symmetry_check kept or not run: attention in
 * the chat, none in the report). Unify: set this to false; the card then also
 * counts the evaluation's break.
 */
export const D13_REPORT_SYMMETRY_FROM_SYMMETRY_CHECK_ONLY = true;

/**
 * D14: the report counts texture_check's fill bias only on a Backfill card
 * whose seam it judged: with no backfill measured, or its seam not judged, a
 * fill bias needs no attention there, where {{achieved}} names the backfill's
 * texture. Unify: set this to false; the bias then needs attention on the
 * card (made for it when nothing else is measured).
 */
export const D14_REPORT_FILL_BIAS_ON_A_JUDGED_SEAM_ONLY = true;

// ---------------------------------------------------------------- the matrix

/** A stage, as {{achieved}} reads it: its kind; a missing output is no result. */
const stageForAchieved: Cell = (o) => (o.reasons.includes("no output") ? undefined : o.kind);

/** A stage, as the answer checks read it (D11, D12): what decides nothing is not read (D7), so it hides no earlier verdict. */
const stageForAnswer: Cell = (o) => {
  if (o.reasons.includes("no output")) {
    if (!D11_ANSWER_JUDGES_MISSING_OUTPUT) return undefined;
    const kind = judge(o.check, {} as never).kind;
    return kind === "info" ? undefined : kind;
  }
  if (D12_ANSWER_SKIPS_WORDS_THAT_ARE_NO_LABEL && o.reasons.includes("words not a label")) return undefined;
  return o.kind;
};

/** grain_check's outcome as the answer checks' UB topic reads it (D3): the UB off needs attention; anything else says nothing of the UB. */
const grainAsUb: Cell = (o) => (o.reasons.includes("UB off") ? "attention" : undefined);

/** The outcomes a reader reads for one reading, and how it reads each. */
type Sources = [CheckId, Cell][];

interface Row {
  achieved: Cell;
  // The answer checks' reading of this check's topic: the newest current result
  // across these sources; or (every) each group's newest, combined: it needs
  // attention if one does, and passes only when all pass (D8).
  answer: Sources | { every: Sources[] };
}

const stage = (check: Stage): Row => ({ achieved: stageForAchieved, answer: [[check, stageForAnswer]] });

const MATRIX: Record<CheckId, Row> = {
  rings: stage("rings"),
  punch: stage("punch"),
  backfill: D8_ANSWER_BACKFILL_IGNORES_TEXTURE
    ? stage("backfill")
    : { achieved: stageForAchieved, answer: { every: [[["backfill", stageForAnswer]], [["texture", asIs]]] } },
  flatten: stage("flatten"),
  pdf: stage("pdf"),
  coverage: {
    // D10: legacy words are no verdict to {{achieved}}.
    achieved: (o) => (D10_ACHIEVED_IGNORES_LEGACY_COVERAGE_WORDS && o.reasons.includes("legacy coverage words") ? "info" : o.kind),
    // D1: a pass by the reach inside full coverage is a pass (it settled nothing before 2.4.1).
    answer: [["coverage", (o) => (D1_REACH_PASS_SETTLES_NOTHING && o.kind === "pass" && o.reasons.includes("reach inside coverage") ? "info" : o.kind)]],
  },
  symmetry: { achieved: asIs, answer: [["symmetry", asIs]] },
  texture: { achieved: asIs, answer: [] },
  grain: {
    achieved: D3_ACHIEVED_IGNORES_GRAIN ? unread : () => "info",
    // D3: decided only by a second grain or none; a result without words judged nothing; any other finding is not read (D7).
    answer: [
      [
        "grain",
        (o) =>
          !D3_ANSWER_GRAIN_SECOND_GRAIN_ONLY
            ? o.kind
            : o.reasons.includes("second grain")
              ? "attention"
              : o.reasons.includes("no second grain")
                ? "pass"
                : o.reasons.includes("nothing to judge")
                  ? "info"
                  : undefined,
      ],
    ],
  },
  // ub_check writes the UB's data problems and its kind for the answer checks by one rule (D4, in rules.ts: UB_TURNED, UB_NOT_JUDGED).
  ub: { achieved: () => "info", answer: D3_ANSWER_UB_FROM_UB_CHECK_ONLY ? [["ub", asIs]] : [["ub", asIs], ["grain", grainAsUb]] },
};

// ---------------------------------------------------------------- a reply

interface Found {
  index: number;
  o: Outcome;
}

const decides = (k: Kind): boolean => k === "pass" || k === "attention";

/** The result a reader reads among a check's current outcomes, newest first, by its selection (D7), with the kind it reads. */
function pick(found: readonly Found[], at: Record<PipelineStage, number>, reader: Reader, sources: Sources): { o: Outcome; kind: Kind } | null {
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

/** The checks on the result that {{achieved}} names when they need attention, in its order, and how. The UB's two checks follow them (achievedOf). */
const ON_RESULT: [CheckId, string][] = [
  ["coverage", "the ΔPDF window against the coverage"],
  ["symmetry", "the ΔPDF's symmetry"],
  ["texture", "the backfill's texture"],
];

/** grain_check's outcome as UB evidence to {{achieved}} (D3, D7): its "UB off"; anything else says nothing of the UB. */
const grainUbForAchieved: Cell = (o) => (o.reasons.includes("UB off") ? MATRIX.grain.achieved(o) : undefined);

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
    if (p.kind === "attention") attention.push(label);
    dataProblems.push(...p.o.dataProblems);
  }
  // The UB (D7): the newest UB evidence across ub_check and grain_check's "UB
  // off" names the UB's problem, as the answer checks read the UB topic; the
  // HKL origin's shift is ub_check's alone, from its newest result. Either
  // check counts as measured, whatever it found (D3).
  const ubCheck = pick(found, at, "achieved", [["ub", MATRIX.ub.achieved]]);
  const grainCheck = pick(found, at, "achieved", [["grain", MATRIX.grain.achieved]]);
  if (ubCheck || grainCheck) measuredAny = true;
  const evidence = pick(found, at, "achieved", [["ub", MATRIX.ub.achieved], ["grain", grainUbForAchieved]]);
  if (evidence) dataProblems.push(...evidence.o.dataProblems.filter((p) => !isOriginProblem(p)));
  if (ubCheck) dataProblems.push(...ubCheck.o.dataProblems.filter(isOriginProblem));
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
    const answer = MATRIX[check].answer;
    const kind = Array.isArray(answer) ? pick(found, at, "answer", answer)?.kind : combined(answer.every.map((sources) => pick(found, at, "answer", sources)?.kind));
    if (kind) checks[check] = kind;
  }
  return checks;
}

/** Each group's kind, combined (D8): needs attention if one does, a pass only when every one passes, else not judged; undefined when none was read. */
function combined(kinds: readonly (Kind | undefined)[]): Kind | undefined {
  if (kinds.includes("attention")) return "attention";
  if (kinds.every((k) => k === "pass")) return "pass";
  return kinds.some((k) => k !== undefined) ? "info" : undefined;
}

// ---------------------------------------------------------------- a report

/** How the report names a stage: its card's title. */
const REPORT_TITLE: Record<Stage, string> = {
  rings: "Ring removal",
  punch: "Bragg punch",
  backfill: "Backfill",
  flatten: "Flatten",
  pdf: "3D-ΔPDF",
};

/** The Backfill card: the seam's verdict, and a cut whose fill is biased one way (D14). */
function backfillCard(own: Outcome | undefined, texture: Outcome | undefined): Kind | undefined {
  const biased = texture?.kind === "attention";
  if (own === undefined) return D14_REPORT_FILL_BIAS_ON_A_JUDGED_SEAM_ONLY || !biased ? undefined : "attention";
  if (own.kind === "info" && D14_REPORT_FILL_BIAS_ON_A_JUDGED_SEAM_ONLY) return "info";
  return own.kind === "attention" || biased ? "attention" : own.kind;
}

/** The weight on unmeasured space an outcome judged: past the limit, within it, or none judged. */
const windowOf = (o: Outcome | undefined): "past" | "within" | null =>
  o?.reasons.includes("window past limit") ? "past" : o?.reasons.includes("window within limit") ? "within" : null;

/** The 3D-ΔPDF card: the round trip by the ΔPDF's rule, its window (D2), the symmetry (D13), and without an evaluation (D9). */
function pdfCard(pdf: Outcome | undefined, coverage: Outcome | undefined, symmetry: Outcome | undefined): Kind | undefined {
  if (!pdf && !coverage && !symmetry) return undefined;
  if (!pdf && !D9_REPORT_PDF_CARD_WITHOUT_EVALUATION) return "info";
  const back = pdf?.reasons.includes("back-FFT") ?? false;
  // The evaluation's weight, else the coverage's; and the coverage's verdict, as {{achieved}} reads it (D2).
  const window = windowOf(pdf) ?? windowOf(coverage);
  const far = !D2_REPORT_COVERAGE_BY_WEIGHT_ONLY && coverage !== undefined && MATRIX.coverage.achieved(coverage) === "attention";
  const broken = symmetry?.kind === "attention" || (!D13_REPORT_SYMMETRY_FROM_SYMMETRY_CHECK_ONLY && (pdf?.reasons.includes("symmetry broken") ?? false));
  return back || window === "past" || far || broken ? "attention" : "pass";
}

/** A report's verdicts: each card's, and the goal, met when every stage's card passes (a second grain is the sample's, reported apart). */
function reportOf(m: Measured): Verdicts {
  // Each check's outcome as its producer judged it in the measurement pass
  // (collect.ts keeps them), else read from its measurements.
  const newest = (outcomes: readonly Outcome[], check: CheckId): Outcome | undefined =>
    [...outcomes].reverse().find((o) => o.check === check && !o.reasons.includes("no output"));
  const kept = m.outcomes ?? [];
  const measured = outcomesOfMeasured(m);
  const of = (check: CheckId): Outcome | undefined => newest(kept, check) ?? newest(measured, check);
  const grain = of("grain");
  const cards: Partial<Record<CheckId, Kind | undefined>> = {
    rings: of("rings")?.kind,
    punch: of("punch")?.kind,
    // Without its words, grain_check's result makes no card.
    grain: grain && grain.words !== null ? grain.kind : undefined,
    backfill: backfillCard(of("backfill"), of("texture")),
    flatten: of("flatten")?.kind,
    pdf: pdfCard(of("pdf"), of("coverage"), of("symmetry")),
  };
  const checks = Object.fromEntries(Object.entries(cards).filter(([, k]) => k !== undefined)) as Partial<Record<CheckId, Kind>>;
  const stages = Object.fromEntries(STAGES.filter((s) => checks[s] !== undefined).map((s) => [s, checks[s]])) as Partial<Record<Stage, Kind>>;
  const attention = STAGES.filter((s) => checks[s] === "attention").map((s) => REPORT_TITLE[s]);
  const notMeasured = STAGES.filter((s) => checks[s] === undefined || checks[s] === "info").map((s) => REPORT_TITLE[s]);
  const achieved = attention.length ? false : notMeasured.length ? null : true;
  const text = attention.length
    ? `not met: needs attention: ${attention.join(", ")}`
    : notMeasured.length
      ? `not judged: not measured: ${notMeasured.join(", ")}`
      : "met: every stage meets its goal";
  return { achieved: { achieved, stages, attention, notMeasured, dataProblems: [], text }, checks };
}

/** A run's verdicts: a reply's, from its steps' tool results; a report's, from its measurements. */
export function verdicts(run: { reply: readonly AgentStep[] } | { report: Measured }): Verdicts {
  if ("report" in run) return reportOf(run.report);
  const steps = run.reply;
  const at = recomputedAt(steps);
  const found = steps.flatMap((step, index) => outcomesOf(step).map((o) => ({ index, o })));
  return { achieved: achievedOf(found, at), checks: answerOf(found, at) };
}
