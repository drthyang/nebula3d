// The assistant's tools: functions the model may call mid-answer to measure,
// look up or show something, instead of reasoning only from the one default
// cut it was handed.  Each validates its arguments (a model can send anything),
// reads through the same API the viewers use, and returns compact JSON.  Each
// also declares its facts (tools/facts.ts): whether it only reads or acts, and
// on what, the verdicts it settles, the questions a local model is offered it
// for, its label in the transcript.  The modules around the agent loop read
// them through factsOf and toolsWhere, at the end of this file; the model never
// sees them.

import { fetchDataset } from "../../api/client";
import type { JobEvent } from "../../api/types";
import { useNavStore } from "../../state/navStore";
import {
  enabledStages,
  STAGE_LABELS,
  STAGES,
  usePipelineStore,
  type PipelineConfig,
} from "../../state/pipelineStore";
import { loadSettings } from "../settings";
import {
  displayValue,
  SAMPLE_PARAMS,
  TUNE_PARAMS,
  TUNE_STAGE_LABELS,
  TUNE_STAGES,
  toFormValue,
  type TuneParam,
  type TuneStage,
} from "../tune/catalog";
import { headline, type StageEvaluation } from "../tune/evaluate";
import { startTuning, stopTuning, useTuneStore, type StageRun } from "../tune/tuner";
import { safe } from "../context/loadContext";
import type { ToolCall, ToolSpec } from "../provider/client";
import { ALL_STAGES, keysOf, resolveFacts, type Facts } from "./facts";
import type { ViewTarget } from "./openView";
import { withoutInference } from "../inference";
import { fit } from "../readings";
import { allSkills, readSkill, refusalFor, REFERENCE_MAX_CHARS, skillsOn } from "../skills";
import type { Outcome } from "../verdicts/rules";
import { num, oneOf } from "./shared/args";
import { checkIdle, unique } from "./shared/pipeline";
import { measure_reciprocal_cut } from "./defs/measure_reciprocal_cut";
import { measure_dpdf_cut } from "./defs/measure_dpdf_cut";
import { describe_dataset } from "./defs/describe_dataset";
import { line_profile } from "./defs/line_profile";
import { bragg_peaks } from "./defs/bragg_peaks";
import { consistency_details } from "./defs/consistency_details";
import { compare_datasets } from "./defs/compare_datasets";
import { current_view } from "./defs/current_view";
import { configure_settings } from "./defs/configure_settings";
import { show_in_viewer } from "./defs/show_in_viewer";
import { assess_stage } from "./defs/assess_stage";
import { radial_profile } from "./defs/radial_profile";
import { run_log } from "./defs/run_log";
import { texture_check } from "./defs/texture_check";
import { symmetry_check } from "./defs/symmetry_check";
import { dpdf_contrast } from "./defs/dpdf_contrast";
import { dpdf_peaks } from "./defs/dpdf_peaks";
import { grain_check } from "./defs/grain_check";
import { ub_check } from "./defs/ub_check";
import { qmax_coverage } from "./defs/qmax_coverage";
import { ToolArgError, type AgentTool, type Args, type ChatTool, type ToolContext, type ToolIO } from "./types";

export type { AgentTool, Args, ChatTool, ToolContext, ToolIO, ToolOutcome } from "./types";
export { ToolArgError } from "./types";
export type { ViewTarget } from "./openView";

// Two evaluations with the same numbers: the change had no measurable effect.
const sameNumbers = (a: StageEvaluation | undefined, b: StageEvaluation | undefined): boolean =>
  !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- actions

const SETTABLE = [...TUNE_PARAMS, ...SAMPLE_PARAMS];
const findParam = (key: string): TuneParam | undefined => SETTABLE.find((p) => p.key === key);

// The stage of each setting, for the skill gate (skills.ts).
const SETTING_STAGE = new Map([...TUNE_PARAMS, ...SAMPLE_PARAMS].map((p) => [p.key as string, p.stage]));

const allowedValues = (p: TuneParam): string =>
  p.kind === "enum"
    ? p.options!.map((o) => o.name).join("|")
    : p.kind === "boolean"
      ? "true|false"
      : p.kind === "fractions"
        ? 'H fractions like "1/3, 2/3", or none'
        : `${p.kind} ${p.min}–${p.max}`;

const updateSettings: ChatTool = {
  name: "update_settings",
  facts: {
    label: "Changed settings",
    acts: "settings",
    reachesBackend: false,
    invalidates: ["settings"],
    // The stages of the method choices and thresholds it changes.
    highlights: (args) => {
      const changes = args.changes && typeof args.changes === "object" ? Object.keys(args.changes) : [];
      return keysOf(changes.map((key) => TUNE_PARAMS.find((p) => p.key === key)?.stage));
    },
    // The stages of the settings it changes, the sample's facts included.
    gate: {
      doing: "change",
      stages: (args) => {
        const changes = args.changes;
        if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
        return unique(Object.keys(changes).flatMap((k) => (SETTING_STAGE.has(k) ? [SETTING_STAGE.get(k)!] : [])));
      },
    },
  },
  description:
    "Change settings on the Configure page; the next run_pipeline uses them and the user sees the fields change. " +
    `These method choices and thresholds can be changed: ${TUNE_PARAMS.map((p) => `${p.key} (${allowedValues(p)})`).join(", ")}. ` +
    `These facts about the sample only when the user asks for that change, never to improve a result: ${SAMPLE_PARAMS.map((p) => `${p.key} (${allowedValues(p)}; ${p.help})`).join(" ")} ` +
    "The magnetic ion and |Q| band stay with the user. " +
    "Change them when the user asks for a change, or asks you to improve or tune the result, and only the settings " +
    "the user named or agreed to; when unsure which setting the user means, ask instead of guessing. Settings " +
    "already at the value are left as they are. Returns each change and the stage to rerun from.",
  parameters: {
    type: "object",
    properties: {
      changes: { type: "object", description: 'Setting → new value, e.g. {"punchMinSig": 6}' },
    },
    required: ["changes"],
  },
  run: async (args) => {
    checkIdle();
    const changes = args.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
      throw new ToolArgError("changes must be an object of setting → value");
    }
    const patch: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(changes)) {
      const p = findParam(key);
      if (!p) throw new ToolArgError(`${key} cannot be changed; these can: ${SETTABLE.map((q) => q.key).join(", ")}`);
      try {
        patch[key] = toFormValue(key, value, p.stage, { sample: true });
      } catch (e) {
        throw new ToolArgError((e as Error).message);
      }
    }
    const before = usePipelineStore.getState();
    // A setting already at the value is no change: leave it out of the patch.
    const unchanged = Object.keys(patch).filter((key) => before[key as keyof PipelineConfig] === patch[key]);
    for (const key of unchanged) delete patch[key];
    before.patch(patch as Partial<PipelineConfig>);
    const after = usePipelineStore.getState();
    const changed = Object.keys(patch).map((key) => {
      const p = findParam(key)!;
      return {
        setting: key,
        from: displayValue(p, before[p.key]),
        to: displayValue(p, after[p.key]),
        ...(p.appliesWhen && !p.appliesWhen(after) ? { note: "no effect with the current model" } : {}),
      };
    });
    const rerunFrom = TUNE_STAGES.find((st) => changed.some((c) => findParam(c.setting)!.stage === st));
    return {
      result: { changed, ...(unchanged.length ? { already_set: unchanged } : {}), rerun_from: rerunFrom ?? null },
      summary: changed.length
        ? changed.map((c) => `${c.setting} ${c.from} → ${c.to}`).join(", ")
        : `no change: ${unchanged.join(", ")} already set`,
    };
  },
};

const stageLabel = (stage?: string): string => (stage ? STAGE_LABELS[stage] ?? stage : "");

// One log line: "Bragg punch 45% · fitting 312 peaks".
const eventLine = (ev: JobEvent): string =>
  [
    stageLabel(ev.stage) + (ev.fraction != null && ev.status === "progress" ? ` ${Math.round(ev.fraction * 100)}%` : ""),
    ev.message,
  ]
    .filter(Boolean)
    .join(" · ");

const runPipeline: ChatTool = {
  name: "run_pipeline",
  facts: {
    label: "Ran the pipeline",
    runningLabel: "Running the pipeline",
    acts: "run",
    // It writes the stage outputs, and moves the console to the Execution page.
    invalidates: ["outputs", "view"],
    reportable: true,
    highlights: (args) => (args.from_stage === undefined ? ALL_STAGES : keysOf([args.from_stage])),
  },
  description:
    "Run the reduction pipeline on the selected dataset with the Configure page's settings, as the Run button does: " +
    "it writes the dataset's stage outputs, and the console shows the run on its Execution page while it goes. " +
    "Without from_stage, outputs that already exist are reused (unless the user switched Force on), so it computes " +
    "what is missing. With from_stage, that stage and every enabled stage after it are recomputed: use it after " +
    "update_settings. A run takes seconds to minutes. Returns how it ended, which stages were computed or reused, " +
    "and the outputs that now exist; measure them afterwards.",
  parameters: {
    type: "object",
    properties: {
      from_stage: {
        type: "string",
        enum: TUNE_STAGES,
        description: "Recompute from this stage on; omit to compute only what is missing",
      },
    },
  },
  run: async (args, ctx, io) => {
    checkIdle();
    const from = args.from_stage === undefined ? null : oneOf(args, "from_stage", TUNE_STAGES);
    const pipe = usePipelineStore.getState();
    const stages = enabledStages(pipe).filter(
      (st) => !from || STAGES.indexOf(st as (typeof STAGES)[number]) >= STAGES.indexOf(from),
    );
    if (!stages.length) throw new Error(`every stage${from ? ` from ${stageLabel(from)} on` : ""} is switched off`);
    const force = from ? true : pipe.force;

    useNavStore.getState().setTab("execution");
    let seen = 0;
    const unsubscribe = usePipelineStore.subscribe(({ events }) => {
      if (events.length === seen) return;
      seen = events.length;
      const ev = events[events.length - 1];
      const at = ev.stage ? stages.indexOf(ev.stage) : -1;
      io.progress?.((at >= 0 ? `${at + 1}/${stages.length} ` : "") + eventLine(ev));
    });
    const cancel = () => void usePipelineStore.getState().cancel();
    io.signal?.addEventListener("abort", cancel);
    const t0 = performance.now();
    let ended: string;
    try {
      ended = await usePipelineStore.getState().runStages(stages, { datasetId: ctx.dataset.id, force });
    } finally {
      unsubscribe();
      io.signal?.removeEventListener("abort", cancel);
    }
    const seconds = Math.round((performance.now() - t0) / 100) / 10;
    const events = usePipelineStore.getState().events;

    if (ended !== "done") {
      const failed = [...events].reverse().find((e) => e.status === "error");
      throw new Error(`the run ${ended === "cancelled" ? "was cancelled" : "failed"}${failed ? `: ${eventLine(failed)}` : ""}`);
    }
    // The last word on each stage: done = computed, skip = its output was reused.
    const outcome: Record<string, string> = {};
    for (const e of events) {
      if (e.stage && (e.status === "done" || e.status === "skip")) outcome[e.stage] = e.status === "done" ? "computed" : "reused";
    }
    const fresh = await safe(fetchDataset(ctx.dataset.id));
    if (fresh) ctx.dataset = fresh;
    const computed = Object.values(outcome).filter((o) => o === "computed").length;
    const result = {
      ended,
      seconds,
      stages: outcome,
      outputs: ctx.dataset.stages.filter((s) => s.exists).map((s) => s.name),
      log_tail: events.filter((e) => e.message).slice(-5).map(eventLine),
    };
    return {
      result,
      summary: `done in ${seconds} s · ${computed} computed, ${Object.keys(outcome).length - computed} reused`,
    };
  },
};

// A tuning run's state as one live line: "2/5 Bragg punch · trial 3/4 running".
const tuneLine = (stages: StageRun[]): string => {
  const i = stages.findIndex((r) => !["waiting", "done", "skipped", "failed"].includes(r.status));
  if (i < 0) return "";
  const r = stages[i];
  const t = r.trials.find((x) => x.status === "running");
  const what = t ? `trial ${t.n}/${r.trials.length} running` : r.status;
  return `${i + 1}/${stages.length} ${TUNE_STAGE_LABELS[r.stage]} · ${what}`;
};

const tunePipeline: ChatTool = {
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
      await startTuning({ dataset: ctx.dataset, stages, trialsPerStage: trials, llm: loadSettings(), skills: skillsOn(ctx) });
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

// The user's methods (skills.ts): the system prompt lists their names, and
// this reads one, or a document it cites, when the task calls for it.
const readSkillTool: ChatTool = {
  name: "read_skill",
  facts: { label: "Read a skill", acts: null, reachesBackend: false, needsSkills: true },
  description:
    "Read one of the user's skills: their method for a topic, with the steps, the checks and what to report. " +
    "Name it from the list in the system prompt. With reference, read one of the documents the skill cites (a long " +
    "one by section). Read a stage's skill before you change that stage's settings or tune it: those calls are " +
    "refused until it has been read in this conversation.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", enum: allSkills().map((s) => s.name), description: "The skill" },
      reference: { type: "string", description: "One of the skill's references, by the name the skill lists" },
      section: { type: "string", description: "With reference: one section of that document, by its heading" },
    },
    required: ["name"],
  },
  maxResultChars: REFERENCE_MAX_CHARS + 2000,
  run: async (args, ctx) => {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) throw new ToolArgError("name must be one of the skills listed in the system prompt");
    const reference = typeof args.reference === "string" && args.reference.trim() ? args.reference.trim() : undefined;
    const section = typeof args.section === "string" && args.section.trim() ? args.section.trim() : undefined;
    let text: string;
    try {
      text = readSkill(name, reference, section);
    } catch (e) {
      throw new ToolArgError((e as Error).message);
    }
    if (!reference) ctx.skillsRead?.add(name);
    return { result: text, summary: reference ? `${name}: ${reference}${section ? ` (${section})` : ""}` : `Read the ${name} skill` };
  },
};

export const CHAT_TOOLS: ChatTool[] = [
  readSkillTool,
  describe_dataset,
  current_view,
  measure_reciprocal_cut,
  measure_dpdf_cut,
  assess_stage,
  texture_check,
  qmax_coverage,
  symmetry_check,
  dpdf_contrast,
  dpdf_peaks,
  grain_check,
  ub_check,
  radial_profile,
  line_profile,
  bragg_peaks,
  consistency_details,
  run_log,
  compare_datasets,
  configure_settings,
  updateSettings,
  runPipeline,
  tunePipeline,
  show_in_viewer,
];

// The facts by tool name, indexed on the first lookup.
let factsByName: Map<string, Facts> | null = null;

/**
 * A tool's facts, by its name. Never throws: a name the registry does not hold
 * (a tool a test made up, one the model invented) gets the fallbacks
 * (resolveFacts): it only reads, needs the server, is offered for every
 * question and settles nothing.
 */
export function factsOf(name: string): Facts {
  if (!factsByName) factsByName = new Map(CHAT_TOOLS.map((t) => [t.name, resolveFacts(t.name, t.facts)]));
  return factsByName.get(name) ?? resolveFacts(name);
}

/** The names of the registry's tools whose facts pass `pred`, in the registry's order. */
export const toolsWhere = (pred: (facts: Facts) => boolean): string[] =>
  CHAT_TOOLS.filter((t) => pred(factsOf(t.name))).map((t) => t.name);

/**
 * Why a call must wait, or null: a call to a tool with a skill gate (its
 * facts' `gate`) waits until the skills of the stages it changes or tunes
 * have been read in the conversation (skills.ts words it).
 */
export function unreadSkillRefusal(name: string, args: Args, read: ReadonlySet<string>): string | null {
  const gate = factsOf(name).gate;
  return gate ? refusalFor(gate.stages(args), gate.doing, read) : null;
}

/**
 * The tools as a conversation with the skills on or off offers them (the
 * switch, skills.ts): on, the tools as they are (the same list); off (the
 * validation's arm C), without the tools that work only with the skills (their
 * facts' `needsSkills`: read_skill), and each with its description without
 * what names a skill or restates a skill's step (descriptionWithoutSkills).
 * The agent loop offers, runs and checks answers against this list alone, so a
 * call to a tool it left out is refused as one the registry does not hold.
 */
export function toolsWithSkills(tools: AgentTool[], skills: boolean): AgentTool[] {
  if (skills) return tools;
  return tools
    .filter((t) => !factsOf(t.name).needsSkills)
    .map((t) => (t.descriptionWithoutSkills === undefined ? t : { ...t, description: t.descriptionWithoutSkills }));
}

// Only name, description and parameters: the facts never reach the model.
export const toolSpecs = (tools: AgentTool[]): ToolSpec[] =>
  tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

// Tool results go back into the model's context window; keep each bounded.
export const MAX_RESULT_CHARS = 5000;

export interface ToolRun {
  ok: boolean;
  args: Args;
  text: string; // what the model reads (the step's `result`)
  full?: string; // the whole result, where the model reads it fitted (the step's `full`: readings/)
  summary: string;
  view?: ViewTarget;
  outcomes?: Outcome[]; // the tool's outcomes (ToolOutcome), carried to the step
}

// Run one call the model made.  Never throws: a bad call becomes an error
// message the model reads and can correct.
export async function runToolCall(
  call: ToolCall,
  tools: AgentTool[],
  ctx: ToolContext,
  io: ToolIO = {},
): Promise<ToolRun> {
  let args: Args = {};
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Args;
    else throw new Error("not an object");
  } catch {
    const text = `Error: the arguments were not a JSON object: ${call.function.arguments.slice(0, 200)}`;
    return { ok: false, args, text, summary: "invalid arguments" };
  }
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) {
    const text = `Error: no tool named ${call.function.name}. Available: ${tools.map((t) => t.name).join(", ")}`;
    return { ok: false, args, text, summary: `unknown tool ${call.function.name}` };
  }
  // A firm rule: a stage's settings change, and the stage is tuned, only after
  // its skill has been read in the conversation (skills.ts). With the skills
  // off (the switch) there is no skill to read, so there is no gate.
  const refusal = skillsOn(ctx) && ctx.skillsRead ? unreadSkillRefusal(tool.name, args, ctx.skillsRead) : null;
  if (refusal) return { ok: false, args, text: `Error: ${refusal}`, summary: "refused until its skill is read" };
  try {
    const out = await tool.run(args, ctx, io);
    // With the skills off its prose written once is its definitions only
    // (inference.ts); a tool renders what it builds for each call by the switch itself.
    const result = skillsOn(ctx) ? out.result : withoutInference(out.result);
    // A text result (a skill) goes as written; anything else as JSON, fitted
    // to valid JSON when it is long, with the whole result beside it (fit).
    const { text, full } = fit(result, tool.maxResultChars ?? MAX_RESULT_CHARS);
    return { ok: true, args, text, ...(full !== undefined ? { full } : {}), summary: out.summary, view: out.view, ...(out.outcomes ? { outcomes: out.outcomes } : {}) };
  } catch (e) {
    const msg = (e as Error).message;
    const text = e instanceof ToolArgError ? `Error: invalid arguments — ${msg}` : `Error: ${msg}`;
    return { ok: false, args, text, summary: msg };
  }
}
