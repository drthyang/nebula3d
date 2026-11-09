// Auto mode's fixed plan (docs/pilot-auto-mode-design.md §2.2): preflight, a
// run, check and fix each stage, then the report. What the controller
// (controller.ts) moves on by is computed here, from the tools' outcomes
// (verdicts/), never from the model's words: a stage's verdict from its
// checks, whether a fix made a check worse, which plan row a sample fact
// holds back, and the limits. Pure: steps and settings in, verdicts out.
// The model reads none of this but the digest's words (prompts.ts).

import type { AgentStep } from "../agent";
import type { Proposal } from "../apply/proposals";
import { cardSetting } from "../apply/proposals";
import { found } from "../readings";
import { SYMMETRY_AVERAGE_SETTINGS, TUNE_STAGES, type TuneStage } from "../tune/catalog";
import { outcomesOf } from "../verdicts/recorded";
import type { CheckId, Kind, Outcome, Reason } from "../verdicts/rules";

export type Stage = TuneStage;
export const STAGES: readonly Stage[] = TUNE_STAGES;

/** A row of the plan: the preflight, the run, a stage's check and fixes, the report. */
export type RowId = "preflight" | "run" | Stage | "report";
export const ROW_IDS: readonly RowId[] = ["preflight", "run", ...STAGES, "report"];

export type RowStatus =
  | "pending"
  | "running" // its checks or its run are under way
  | "fixing" // a fix reply, or the run and check after it
  | "passed" // its check met its goal
  | "fixed" // met its goal after a fix
  | "attention" // still needs attention: its fixes used up, or a limit hit
  | "not judged" // its check could not judge it
  | "done" // the preflight, the run, the report
  | "needs you" // paused before it for a sample fact
  | "stopped" // you stopped the run in it
  | "failed" // a run or the model server failed in it
  | "skipped"; // a limit ended the fixes before it

export interface PlanRow {
  id: RowId;
  title: string;
  status: RowStatus;
  tries: number; // fixes made on a stage
  detail?: string; // one plain line, result first
  outcome?: Kind; // a stage's verdict from its latest check
  evidence?: { step: string; label: string; text: string }[]; // the latest checks' own lines
  // A stage's checks as the run first found them, before its fixes: the report
  // sets them beside the latest (the run's report, read from the trimmed
  // context alone, said it did not have the flatten's numbers from before).
  before?: { step: string; label: string; text: string }[];
}

export const ROW_TITLES: Record<RowId, string> = {
  preflight: "Preflight",
  run: "Run",
  rings: "Ring removal",
  punch: "Bragg punch",
  backfill: "Backfill",
  flatten: "Background correction",
  pdf: "3D-ΔPDF",
  report: "Report",
};

export const freshPlan = (): PlanRow[] => ROW_IDS.map((id) => ({ id, title: ROW_TITLES[id], status: "pending", tries: 0 }));

export const isStage = (id: RowId): id is Stage => (STAGES as readonly string[]).includes(id);
export const rowIndex = (id: RowId): number => ROW_IDS.indexOf(id);

// ---------------------------------------------------------------- limits

/** What bounds a run (§2.5; the user's defaults of 2026-11-07). */
export interface AutoLimits {
  minutes: number; // working time, the time waiting for you not counted (10 to 60)
  fixesPerStage: number;
  replies: number; // model replies per run, the report's included
  costUsd: number; // on a priced model (Claude, cost.ts)
  fixRounds: number; // rounds of calls in a fix reply
  reportRounds: number; // rounds of calls in the report reply
}

export const AUTO_LIMITS: AutoLimits = { minutes: 30, fixesPerStage: 2, replies: 12, costUsd: 2, fixRounds: 6, reportRounds: 4 };

/**
 * What a tuning in a fix may take (tune/tuner.ts, TuneBudget): at most three
 * trials of a tuned stage, the current settings and two alternatives, and at
 * most four minutes of tuning a stage over the whole run, its trials not
 * started once they are spent, the stage not tuned again. A ring-removal
 * trial on a full-size volume (some 50 million voxels) takes about a minute,
 * so one tuning of three trials with its proposing and judging fits, and a
 * second one, after a first that adopted nothing, gets what is left; on a
 * small volume, whose trials take seconds, it never binds. Uncapped, the two
 * fixes of the ring removal each ran a tuning of four trials, some eleven
 * minutes with nothing adopted.
 */
export const AUTO_TUNING = { trials: 3, stageMinutes: 4 } as const;
export const MINUTES_RANGE = [10, 60] as const;

/** The limits as given, each held to its range. */
export function limitsOf(given: Partial<AutoLimits> = {}): AutoLimits {
  const l = { ...AUTO_LIMITS, ...given };
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));
  return {
    minutes: clamp(l.minutes, MINUTES_RANGE[0], MINUTES_RANGE[1]),
    fixesPerStage: clamp(l.fixesPerStage, 0, ORDINALS.length),
    replies: clamp(l.replies, 1, 50),
    costUsd: Math.max(0, l.costUsd),
    fixRounds: clamp(l.fixRounds, 1, 12),
    reportRounds: clamp(l.reportRounds, 1, 12),
  };
}

/** The limit that ended a run's fixes. */
export type LimitHit = "time" | "replies" | "cost";

export const LIMIT_WORDS: Record<LimitHit, string> = {
  time: "the time limit",
  replies: "the limit on model replies",
  cost: "the spend limit",
};

// Counts in the digest are words: a number the model reads in its context is
// a number its answer may quote (answerChecks.ts reads the context as a
// source), and a count of fixes is no measurement.
export const ORDINALS = ["first", "second", "third", "fourth", "fifth"] as const;
const COUNT = ["no", "one", "two", "three", "four", "five"] as const;
export const ordinal = (n: number): string => ORDINALS[n - 1] ?? "next";
export const countWord = (n: number): string => COUNT[n] ?? "several";

// ---------------------------------------------------------------- the checks

/** One call the app makes itself. */
export interface Call {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Each stage's checks (§2.2): its own verdict, and the checks on the result
 * that judge it with it: the backfill's fill bias (texture_check), the
 * ΔPDF's symmetry and the coverage of its |Q| band.
 */
export const STAGE_CHECKS: Record<Stage, Call[]> = {
  rings: [{ name: "assess_stage", args: { stage: "rings" } }],
  punch: [{ name: "assess_stage", args: { stage: "punch" } }],
  backfill: [
    { name: "assess_stage", args: { stage: "backfill" } },
    { name: "texture_check", args: {} },
  ],
  flatten: [{ name: "assess_stage", args: { stage: "flatten" } }],
  pdf: [
    { name: "assess_stage", args: { stage: "pdf" } },
    { name: "symmetry_check", args: {} },
    { name: "qmax_coverage", args: {} },
  ],
};

/** The checks each stage's verdict reads, its own first. */
const JUDGED_BY: Record<Stage, readonly CheckId[]> = {
  rings: ["rings"],
  punch: ["punch"],
  backfill: ["backfill", "texture"],
  flatten: ["flatten"],
  pdf: ["pdf", "symmetry", "coverage"],
};

/** The outcomes of `steps` that judge `stage`, newest of each check. */
export function stageOutcomes(stage: Stage, steps: readonly AgentStep[]): Outcome[] {
  const by = new Map<CheckId, Outcome>();
  for (const s of steps) {
    if (s.status !== "done") continue;
    for (const o of outcomesOf(s)) if (JUDGED_BY[stage].includes(o.check)) by.set(o.check, o);
  }
  return JUDGED_BY[stage].flatMap((c) => (by.has(c) ? [by.get(c)!] : []));
}

/**
 * A stage's verdict from its checks: attention when any of them needs
 * attention; a pass when its own check passes; else not judged (no output,
 * a grid too coarse, nothing to judge), which no fix can change.
 */
export function stageKind(stage: Stage, steps: readonly AgentStep[]): Kind {
  const os = stageOutcomes(stage, steps);
  if (os.some((o) => o.kind === "attention")) return "attention";
  return os.find((o) => o.check === stage)?.kind === "pass" ? "pass" : "info";
}

// ---------------------------------------------------------------- worse

// The measure each reason of a stage's rule rests on, and which way is worse:
// the numbers the rule itself compares with its limits (verdicts/rules.ts).
type Measure = (m: Readonly<Record<string, unknown>>) => number | null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const field = (k: string): Measure => (m) => num(m[k]);
const abs = (v: number | null): number | null => (v == null ? null : Math.abs(v));
const MEASURES: Partial<Record<Reason, { measures: Measure[]; worse: "higher" | "lower" }>> = {
  "ring left": { measures: [field("max_ring_left")], worse: "higher" },
  "ring dent": { measures: [field("max_ring_dent")], worse: "higher" },
  "missed at nodes": { measures: [field("leftover_at_nodes")], worse: "higher" },
  "Bragg tails": { measures: [field("leftover_bragg_tails")], worse: "higher" },
  // As the punch's rule counts them: those on protected planes stay by design.
  "sharp off-lattice": {
    measures: [(m) => (num(m.leftover_off_lattice_sharp) == null ? null : num(m.leftover_off_lattice_sharp)! - (num(m.leftover_on_protected_planes_sharp) ?? 0))],
    worse: "higher",
  },
  seam: { measures: [field("mean_median_seam_sigma")], worse: "higher" },
  // The trend's size: a floor falling with |Q| is as much a pedestal as one rising (pedestalLeft).
  pedestal: { measures: [(m) => abs(num(m.floor_trend) ?? num(m.max_floor_trend)), (m) => num(m.floor_span_fraction) ?? num(m.max_floor_span_fraction)], worse: "higher" },
  "back-FFT": { measures: [(m) => num(m.back_fft_pearson_r_even) ?? num(m.back_fft_pearson_r)], worse: "lower" },
  "window past limit": { measures: [field("window_weight_on_unmeasured")], worse: "higher" },
  "symmetry broken": { measures: [field("max_symmetry_break")], worse: "higher" },
};

/** A stage's numbers as its assess_stage step returned them, the newest. */
function stageNumbers(stage: Stage, steps: readonly AgentStep[]): Readonly<Record<string, unknown>> | null {
  for (const s of [...steps].reverse()) {
    if (s.name !== "assess_stage" || s.status !== "done") continue;
    const part = found(s)?.[stage];
    if (part && typeof part === "object" && !Array.isArray(part)) return part as Record<string, unknown>;
  }
  return null;
}

const rank = (k: Kind): number => (k === "attention" ? 1 : 0);

/**
 * Whether the checks after a fix (`after`) judge the stage worse than those
 * before it (`before`), by the stage's own rules: a check that passed or
 * could not judge now needs attention; a check needs attention for a reason
 * it did not have; or, for the same reasons, every number those reasons rest
 * on is no better and one is worse; or, for the ring removal, its worst ring
 * residual (left or dent) grew; or, for a pedestal the flatten left, the
 * larger of its floor trend (in size) and floor span grew. A fix that left the stage as it was, or
 * better on one number and worse on another, is not worse: it is kept, and
 * the next fix starts from it.
 */
export function madeWorse(stage: Stage, before: readonly AgentStep[], after: readonly AgentStep[]): boolean {
  const was = stageOutcomes(stage, before);
  const now = stageOutcomes(stage, after);
  for (const a of now) {
    const b = was.find((o) => o.check === a.check);
    if (!b) continue;
    if (rank(a.kind) > rank(b.kind)) return true;
    if (a.kind === "attention" && a.reasons.some((r) => !b.reasons.includes(r))) return true;
  }
  const own = now.find((o) => o.check === stage);
  if (own?.kind !== "attention") return false;
  const m0 = stageNumbers(stage, before);
  const m1 = stageNumbers(stage, after);
  if (!m0 || !m1) return false;
  // A ring left and a ring dent are one residual at the rings, above or below
  // the diffuse: a fix that trades a dent for a larger ring left (a model
  // change that subtracts less) is worse by its worst residual, whatever the
  // smaller one did.
  if (stage === "rings" && own.reasons.some((r) => r === "ring left" || r === "ring dent")) {
    const worst = (m: Readonly<Record<string, unknown>>) => Math.max(num(m.max_ring_left) ?? 0, num(m.max_ring_dent) ?? 0);
    if (worst(m1) > worst(m0)) return true;
  }
  // The same for a pedestal left: it rests on the floors' trend with |Q| and
  // their span, both near 1; a fix that eases one and raises the other further
  // (a wider fit range that tilts the floors at high |Q|) is worse by the
  // larger of the two.
  if (stage === "flatten" && own.reasons.includes("pedestal")) {
    const [trend, span] = MEASURES.pedestal!.measures;
    const worst = (m: Readonly<Record<string, unknown>>) => Math.max(trend(m) ?? 0, span(m) ?? 0);
    if (worst(m1) > worst(m0)) return true;
  }
  let worse = false;
  for (const r of own.reasons) {
    const rule = MEASURES[r];
    if (!rule) continue;
    for (const measure of rule.measures) {
      const x0 = measure(m0);
      const x1 = measure(m1);
      if (x0 == null || x1 == null || x0 === x1) continue;
      const up = x1 > x0;
      if (up === (rule.worse === "higher")) worse = true;
      else return false; // better on this number: not worse
    }
  }
  return worse;
}

// ---------------------------------------------------------------- facts

/** Whether a card is a fact the run pauses for: one only the user's own click applies (not a ring change the ring gate holds, which it logs). */
export const isFactCard = (p: Proposal): boolean => !!p.held && p.held !== "ring" && p.kind !== "run" && p.kind !== "trial";

const AVERAGE_KEYS: ReadonlySet<string> = new Set(["edgeTrim", ...SYMMETRY_AVERAGE_SETTINGS]);

/**
 * The row a fact holds back (§2.4: just before the stage it affects): the
 * run for what the symmetry average reads (a Laue class, the edge trim),
 * else the stage of its settings (a supercell or a modulation, the punch; a
 * |Q| band, the ΔPDF; the magnetic ion, the flatten).
 */
export function factRow(p: Proposal): RowId {
  const keys = Object.keys(p.change);
  if (keys.some((k) => AVERAGE_KEYS.has(k)) || p.runFrom === "symmetry_average") return "run";
  const stages = keys.map((k) => cardSetting(k)?.stage).filter((s): s is Stage => !!s);
  return stages.sort((a, b) => rowIndex(a) - rowIndex(b))[0] ?? p.runFrom ?? "run";
}

/**
 * Whether a fact held back at `factAt` keeps the run from starting `row`
 * (`ranAlready`: the run is done): a fact for the run holds back every row
 * once the run is done, as every output follows from what it changes; any
 * other holds back its own row and every one after it.
 */
export function holdsBack(factAt: RowId, row: RowId, ranAlready: boolean): boolean {
  if (factAt === "run" && ranAlready) return row !== "preflight";
  return rowIndex(row) >= rowIndex(factAt);
}
