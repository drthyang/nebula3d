// tune_pipeline: searches for the best settings, one stage at a time, in a
// tuning folder. It waits for the skill of each stage it tunes (its facts' gate).

import { useNavStore } from "../../../state/navStore";
import { loadSettings } from "../../settings";
import { skillsOn } from "../../skills";
import { TUNE_STAGE_LABELS, TUNE_STAGES, type TuneStage } from "../../tune/catalog";
import { headline, type StageEvaluation } from "../../tune/evaluate";
import { startTuning, stopTuning, useTuneStore, type StageRun } from "../../tune/tuner";
import { ALL_STAGES, keysOf } from "../facts";
import { num, oneOf } from "../shared/args";
import { checkIdle, unique } from "../shared/pipeline";
import { ToolArgError, type ChatTool } from "../types";

// Two evaluations with the same numbers: the change had no measurable effect.
const sameNumbers = (a: StageEvaluation | undefined, b: StageEvaluation | undefined): boolean =>
  !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

// A tuning run's state as one live line: "2/5 Bragg punch · trial 3/4 running".
const tuneLine = (stages: StageRun[]): string => {
  const i = stages.findIndex((r) => !["waiting", "done", "skipped", "failed"].includes(r.status));
  if (i < 0) return "";
  const r = stages[i];
  const t = r.trials.find((x) => x.status === "running");
  const what = t ? `trial ${t.n}/${r.trials.length} running` : r.status;
  return `${i + 1}/${stages.length} ${TUNE_STAGE_LABELS[r.stage]} · ${what}`;
};

export const tune_pipeline: ChatTool = {
  name: "tune_pipeline",
  facts: {
    label: "Tuned the pipeline",
    runningLabel: "Tuning the pipeline",
    acts: "tune",
    // Its trials run in a tuning folder: the chosen settings end up on the
    // Configure page, the dataset's outputs stay as they were. It moves the
    // console to the Execution page.
    invalidates: ["settings", "view"],
    reportable: true,
    highlights: (args) => (args.stages === undefined ? ALL_STAGES : keysOf(args.stages)),
    gate: {
      doing: "tuning",
      stages: (args) => {
        const stages = Array.isArray(args.stages) && args.stages.length ? args.stages : TUNE_STAGES;
        return unique(stages.filter((s): s is TuneStage => (TUNE_STAGES as readonly unknown[]).includes(s)));
      },
    },
  },
  description:
    "Search for the best settings, one stage at a time: for each stage it runs the current settings, has you " +
    "propose alternatives, runs each, judges which best meets the stage's goal, keeps it and moves on, so later " +
    "stages build on the best earlier ones. Trials run in a tuning folder: the dataset's own outputs are not " +
    "changed, and the chosen settings end up on the Configure page. The user watches the trials in the chat, under " +
    "this reply, and each run on the Execution page. Takes minutes (one run per trial). Returns every trial's changes " +
    "and numbers (a trial that matched the current settings' numbers exactly is marked no_effect), and each stage's " +
    "chosen trial and why: quote these, never numbers the result does not hold.",
  parameters: {
    type: "object",
    properties: {
      stages: {
        type: "array",
        items: { type: "string", enum: TUNE_STAGES },
        description: "Stages to tune (default all); the stages between them are re-run once with their settings",
      },
      trials_per_stage: {
        type: "integer",
        minimum: 2,
        maximum: 5,
        description: "Trials per tuned stage, the current settings included (default 3)",
      },
    },
  },
  run: async (args, ctx, io) => {
    checkIdle();
    let stages: TuneStage[] = [...TUNE_STAGES];
    if (args.stages !== undefined) {
      if (!Array.isArray(args.stages) || !args.stages.length) throw new ToolArgError("stages must be a non-empty list");
      stages = args.stages.map((st) => oneOf({ stage: st }, "stage", TUNE_STAGES));
    }
    const trials = Math.round(num(args, "trials_per_stage", 3));
    if (trials < 2 || trials > 5) throw new ToolArgError("trials_per_stage must be within [2, 5]");

    useNavStore.getState().setTab("execution");
    let last = "";
    const unsubscribe = useTuneStore.subscribe(({ stages: runs }) => {
      const line = tuneLine(runs);
      if (line && line !== last) io.progress?.((last = line));
    });
    io.signal?.addEventListener("abort", stopTuning);
    const t0 = performance.now();
    try {
      // The tuning prompts read the skills' switch too: off, a stage's goal and settings without a skill's step.
      // Its requests go to a validation run's own model, and their counts to
      // the run (ctx.model); in the app, to the model on the console's settings.
      await startTuning({
        dataset: ctx.dataset,
        stages,
        trialsPerStage: trials,
        llm: ctx.model?.settings ?? loadSettings(),
        ...(ctx.model && { onUsage: ctx.model.usage, maxTokens: ctx.model.maxTokens }),
        skills: skillsOn(ctx),
      });
    } finally {
      unsubscribe();
      io.signal?.removeEventListener("abort", stopTuning);
    }
    const minutes = Math.round((performance.now() - t0) / 6000) / 10;
    const tune = useTuneStore.getState();
    if (tune.error) throw new Error(`tuning stopped: ${tune.error}`);
    const result = {
      minutes,
      stages: tune.stages.map((r) => {
        const best = r.trials.find((t) => t.n === r.best);
        return {
          stage: r.stage,
          status: r.status,
          tuned: r.tuned,
          ...(best && {
            chosen_trial: best.n,
            of: r.trials.length,
            changes: best.changes,
            result: headline(r.stage, best.evaluation),
          }),
          // Every trial, so the comparison can be quoted rather than recalled.
          ...(r.tuned && r.trials.length > 1 && {
            trials: r.trials.map((t) => ({
              n: t.n,
              changes: t.changes,
              ...(t.evaluation
                ? {
                    result: headline(r.stage, t.evaluation),
                    ...(t.n !== 1 && sameNumbers(t.evaluation, r.trials[0].evaluation) && { no_effect: true }),
                  }
                : { status: t.status, ...(t.error && { error: t.error }) }),
            })),
          }),
          ...(r.why && { why: r.why }),
          ...(r.message && { message: r.message }),
        };
      }),
      note: tune.finishedNote,
    };
    const changed = result.stages.filter((r) => r.changes && Object.keys(r.changes).length).length;
    // Writing the dataset's outputs is worth it only when a stage's settings changed.
    if (changed) {
      Object.assign(result, { write_outputs_with: { tool: "run_pipeline", from_stage: TUNE_STAGES.find((st) => stages.includes(st)) } });
    }
    return { result, summary: `${minutes} min · settings changed on ${changed} of ${stages.length} stages` };
  },
};
