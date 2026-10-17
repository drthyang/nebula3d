// The verdict on a whole reply's run, computed from the deterministic checks:
// is the reduction one the 3D-ΔPDF can be trusted from, and what problems do
// the data have that no setting fixes? The model explains it; it never decides
// it (THY-18). The answer quotes it as {{achieved}} (references.ts), the answer
// checks hold a claim of success to it (answerChecks.ts), and the console shows
// it under the reply.
//
// "achieved" is met when every stage of the run, measured after it was last
// computed, meets its goal by the report's own rules (report.ts, stageCheck),
// and none of the checks on the result that ran (the window against the
// coverage, the symmetry, the fill's texture) needs attention. With a stage
// not measured since it was computed, it is not judged.

import type { AgentStep } from "./agent";
import { current, PIPELINE_STAGES, recomputedAt, resultsNewestFirst, type PipelineStage } from "./evidence";
import { stageCheck, VERDICT_LABEL, type Verdict } from "./report/report";

export interface ComputedVerdict {
  achieved: boolean | null; // null: not judged
  stages: Partial<Record<PipelineStage, Verdict>>; // each stage measured as it now is
  attention: string[]; // what needs attention
  notMeasured: string[]; // stages not measured since they were computed
  dataProblems: string[]; // what the data hold that no setting fixes
  text: string; // the verdict in words, as {{achieved}} quotes it
}

const STAGE_LABEL: Record<PipelineStage, string> = {
  rings: "the ring removal",
  punch: "the Bragg punch",
  backfill: "the backfill",
  flatten: "the flatten",
  pdf: "the 3D-ΔPDF",
};

// A UB turned by this much (degrees) or more is reported (answerChecks.ts reads the UB the same way).
const UB_TURN = 0.05;

type Obj = Record<string, unknown>;

/** A stage's verdict from an assess_stage result: its verdict label, or computed from its numbers by the same rule. */
function stageVerdict(stage: PipelineStage, m: Obj): Verdict | null {
  if ("missing" in m) return null;
  if (typeof m.verdict === "string") {
    const hit = (Object.keys(VERDICT_LABEL) as Verdict[]).find((v) => VERDICT_LABEL[v] === m.verdict);
    if (hit) return hit;
  }
  return stageCheck(stage, m)?.verdict ?? null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The verdict on the run so far, or null when the reply measured nothing it rests on. */
export function computedVerdict(steps: readonly AgentStep[]): ComputedVerdict | null {
  const at = recomputedAt(steps);
  const stages: Partial<Record<PipelineStage, Verdict>> = {};
  const assessed = resultsNewestFirst(steps, "assess_stage");
  for (const stage of PIPELINE_STAGES) {
    for (const { index, result } of assessed) {
      const m = result[stage];
      if (!m || typeof m !== "object" || !current(at, stage, index)) continue;
      const v = stageVerdict(stage, m as Obj);
      if (v) {
        stages[stage] = v;
        break;
      }
    }
  }
  const attention = PIPELINE_STAGES.filter((s) => stages[s] === "attention").map((s) => STAGE_LABEL[s]);
  const notMeasured = PIPELINE_STAGES.filter((s) => stages[s] === undefined || stages[s] === "info").map((s) => STAGE_LABEL[s]);
  const dataProblems: string[] = [];
  let measuredAny = Object.keys(stages).length > 0;

  // The checks on the result: the newest of each, on the ΔPDF as it now is.
  const latest = (tool: string, stage: PipelineStage | null) => resultsNewestFirst(steps, tool).find((r) => current(at, stage, r.index))?.result;
  const coverage = latest("qmax_coverage", "pdf");
  if (coverage) {
    measuredAny = true;
    if (typeof coverage.verdict === "string" && /^too far/i.test(coverage.verdict)) attention.push("the ΔPDF window against the coverage");
    const raw = coverage.raw_counts as Obj | undefined;
    if (coverage.counts_end_inside_box === true && num(raw?.q_max_edge) != null) {
      dataProblems.push(`the counts end at ${raw!.q_max_edge} Å⁻¹, inside the box`);
    }
  }
  const symmetry = latest("symmetry_check", "pdf");
  if (symmetry) {
    measuredAny = true;
    if (typeof symmetry.verdict === "string" && /^not kept/i.test(symmetry.verdict)) attention.push("the ΔPDF's symmetry");
  }
  const texture = latest("texture_check", "backfill");
  if (texture) {
    measuredAny = true;
    const cuts = Array.isArray(texture.per_cut) ? (texture.per_cut as Obj[]) : [];
    if (cuts.some((c) => c.systematic_fill_bias === true)) attention.push("the backfill's texture");
  }
  const ub = latest("ub_check", null);
  if (ub) {
    measuredAny = true;
    const angle = num(ub.orientation_change_deg);
    if (angle != null && angle >= UB_TURN && ub.fit !== "symmetric") dataProblems.push(`the UB is turned by ${angle}°`);
    const shift = Array.isArray(ub.origin_shift_rlu) ? (ub.origin_shift_rlu as number[]) : null;
    if (shift) dataProblems.push(`the HKL origin is shifted by (${shift.join(", ")}) r.l.u.`);
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
