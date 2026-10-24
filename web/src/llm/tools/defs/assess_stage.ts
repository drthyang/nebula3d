// assess_stage: a stage's output judged against its goal, by the stage's rule
// (verdicts/), on the principal planes and the records the stage writes.

import { stageVolumeId } from "../../context/loadContext";
import { skillsOn } from "../../skills";
import { TUNE_STAGE_LABELS, TUNE_STAGES, type TuneStage } from "../../tune/catalog";
import { evaluateStage, headline } from "../../tune/evaluate";
import { judge, WORDS, type Outcome } from "../../verdicts/rules";
import { ALL_STAGES, stageKey } from "../facts";
import type { ViewTarget } from "../openView";
import { oneOf } from "../shared/args";
import { cleanupView, planeLabel } from "../shared/cuts";
import type { ChatTool } from "../types";

// The output each stage writes, as the dataset lists it.
const STAGE_OUTPUT: Record<TuneStage, string> = {
  rings: "ringremoved",
  punch: "braggpunched",
  backfill: "backfilled",
  flatten: "flattened",
  pdf: "delta_pdf",
};

const ASSESS_CHOICES = [...TUNE_STAGES, "all"] as const;

// The detail a stage's result leaves out with every stage's (stage=all): its
// per-plane numbers, and the flatten's judged |Q| range.
const DETAIL: Record<TuneStage, string[]> = {
  rings: ["per_plane"],
  punch: ["per_plane"],
  backfill: ["per_plane"],
  flatten: ["per_plane", "floor_judged_q"],
  pdf: ["per_plane"],
};

// The per-plane number that is worse when larger, for each reciprocal stage.
const WORSE_WHEN_LARGER: Partial<Record<TuneStage, string>> = {
  rings: "ring_energy_ratio",
  punch: "at_nodes",
  backfill: "median_seam_sigma",
  flatten: "after_floor_max_sigma",
};

// The plane where a stage did worst, to show it there; the first plane when
// none stands out.
function worstPlane(stage: TuneStage, evaluation: Record<string, unknown>): string | null {
  const per = evaluation.per_plane as Record<string, Record<string, unknown> | null> | undefined;
  const key = WORSE_WHEN_LARGER[stage];
  if (!per || !key) return null;
  let worst: string | null = null;
  let worstValue = -Infinity;
  for (const [plane, m] of Object.entries(per)) {
    const v = m?.[key];
    if (typeof v === "number" && v > worstValue) [worst, worstValue] = [plane, v];
  }
  return worst ?? Object.keys(per)[0] ?? null;
}

export const assess_stage: ChatTool = {
  name: "assess_stage",
  facts: {
    label: "Assessed a stage",
    acts: null,
    // A stage's verdict; with no stage, or "all", every stage's.
    settles: (args) => TUNE_STAGES.filter((st) => args.stage === undefined || ["all", st].includes(String(args.stage))),
    reportable: true,
    highlights: (args) => {
      const s = typeof args.stage === "string" ? args.stage : "all";
      if (s === "all") return ALL_STAGES;
      const k = stageKey(s);
      return k === "pdf" ? ["pdf", "check"] : k ? [k] : [];
    },
  },
  description:
    "Judge a stage's output against its goal, on the three principal planes through the origin plus the records the stage writes — the evaluation the tuning run judges trials by. rings: ring-energy ratio and over-subtraction per plane; punch: leftover peaks, punched fraction, fitted peaks; backfill: seam σ and bright fills; flatten: shell floors in σ; pdf: back-FFT r and RMS, feature SNR per section. Returns the stage's goal with the numbers. stage=all gives each stage's headline numbers; one stage adds the per-plane detail. Use it for a verdict on a stage, after a run, and before and after a change.",
  parameters: {
    type: "object",
    properties: {
      stage: { type: "string", enum: ASSESS_CHOICES, description: "The stage to judge, or all (default)" },
    },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    // A stage's goal as the skills' switch has it (skills.ts): off, without a skill's step.
    const goals = skillsOn(ctx) ? WORDS.goal : WORDS.goalWithoutSkills;
    const pick = oneOf(args, "stage", ASSESS_CHOICES, "all");
    const stages: TuneStage[] = pick === "all" ? [...TUNE_STAGES] : [pick];
    const result: Record<string, unknown> = {};
    const outcomes: Outcome[] = [];
    const lines: string[] = [];
    let view: ViewTarget | undefined;
    let measuredOn: string[] | undefined;
    for (const stage of stages) {
      if (!stageVolumeId(dataset, STAGE_OUTPUT[stage])) {
        result[stage] = { missing: `no ${STAGE_OUTPUT[stage]} output yet; run_pipeline computes it` };
        outcomes.push(judge(stage, result[stage] as Record<string, unknown>));
        continue;
      }
      const evaluation = await evaluateStage(stage, dataset);
      const planes = Object.keys((evaluation.per_plane as object | undefined) ?? {});
      if (!measuredOn && planes.length) measuredOn = planes.map((p) => planeLabel(p, 0));
      if (!view) {
        const plane = stage === "pdf" ? null : worstPlane(stage, evaluation);
        if (plane) view = cleanupView(plane, 0);
        else if (stage === "pdf") view = { view: "consistency", label: "the back-FFT check" };
      }
      // The verdict is computed from the numbers, by the stage's rule
      // (verdicts/), never left to the model (answerChecks.ts holds the model to it).
      const outcome = judge(stage, evaluation, { skills: skillsOn(ctx) });
      outcomes.push(outcome);
      const verdict = outcome.words;
      // All five stages' detail, or their goals, would overflow the result
      // (MAX_RESULT_CHARS): one stage at a time gives both.
      if (pick === "all") for (const key of DETAIL[stage]) delete evaluation[key];
      result[stage] = {
        verdict,
        criterion: outcome.criterion,
        headline: headline(stage, evaluation),
        ...evaluation,
        ...(pick === "all" ? {} : { goal: goals[stage] }),
      };
      lines.push(`${TUNE_STAGE_LABELS[stage]}: ${verdict} · ${headline(stage, evaluation)}`);
    }
    if (measuredOn) result.measured_on = measuredOn;
    return { result, summary: lines.join(" · ") || "no stage outputs yet", view, outcomes };
  },
};
