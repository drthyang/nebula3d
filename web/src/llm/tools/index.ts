// The assistant's tools: functions the model may call mid-answer to measure,
// look up or show something, instead of reasoning only from the one default
// cut it was handed.  Each validates its arguments (a model can send anything),
// reads through the same API the viewers use, and returns compact JSON.  Each
// also declares its facts (tools/facts.ts): whether it only reads or acts, and
// on what, the verdicts it settles, the questions a local model is offered it
// for, its label in the transcript.  The modules around the agent loop read
// them through factsOf and toolsWhere, at the end of this file; the model never
// sees them.

import { withoutInference } from "../inference";
import type { ToolCall, ToolSpec } from "../provider/client";
import { fit } from "../readings";
import { refusalFor, skillsOn } from "../skills";
import type { Outcome } from "../verdicts/rules";
import { resolveFacts, type Facts } from "./facts";
import type { ViewTarget } from "./openView";
import { read_skill } from "./defs/read_skill";
import { describe_dataset } from "./defs/describe_dataset";
import { current_view } from "./defs/current_view";
import { measure_reciprocal_cut } from "./defs/measure_reciprocal_cut";
import { measure_dpdf_cut } from "./defs/measure_dpdf_cut";
import { assess_stage } from "./defs/assess_stage";
import { texture_check } from "./defs/texture_check";
import { qmax_coverage } from "./defs/qmax_coverage";
import { symmetry_check } from "./defs/symmetry_check";
import { dpdf_contrast } from "./defs/dpdf_contrast";
import { dpdf_peaks } from "./defs/dpdf_peaks";
import { grain_check } from "./defs/grain_check";
import { ub_check } from "./defs/ub_check";
import { radial_profile } from "./defs/radial_profile";
import { line_profile } from "./defs/line_profile";
import { bragg_peaks } from "./defs/bragg_peaks";
import { consistency_details } from "./defs/consistency_details";
import { run_log } from "./defs/run_log";
import { compare_datasets } from "./defs/compare_datasets";
import { configure_settings } from "./defs/configure_settings";
import { update_settings } from "./defs/update_settings";
import { run_pipeline } from "./defs/run_pipeline";
import { tune_pipeline } from "./defs/tune_pipeline";
import { show_in_viewer } from "./defs/show_in_viewer";
import { ToolArgError, type AgentTool, type Args, type ChatTool, type ToolContext, type ToolIO } from "./types";

export type { AgentTool, Args, ChatTool, ToolContext, ToolIO, ToolOutcome } from "./types";
export { ToolArgError } from "./types";
export type { ViewTarget } from "./openView";

export const CHAT_TOOLS: ChatTool[] = [
  read_skill,
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
  update_settings,
  run_pipeline,
  tune_pipeline,
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
