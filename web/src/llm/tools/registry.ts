// The registry: the tools the model is offered, in the order it reads them
// (CHAT_TOOLS), and the interface through which the modules around the agent
// loop read their facts (factsOf, toolsWhere; the model never sees them),
// offer them (toolsWithSkills, toolSpecs) and hold a stage's changes to its
// skill (unreadSkillRefusal).
//
// Each tool is a module of its own, defs/<tool_name>.ts, imported here under
// the name the model calls it by. The order below is the order the model
// reads the tools in, with every request: registry.test.ts holds it, and the
// files to the registry one to one.

import type { ToolSpec } from "../provider/client";
import { refusalFor } from "../skills";
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
import { resolveFacts, type Facts } from "./facts";
import type { AgentTool, Args, ChatTool } from "./types";

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
export function toolsWithSkills(tools: readonly AgentTool[], skills: boolean): readonly AgentTool[] {
  if (skills) return tools;
  return tools
    .filter((t) => !factsOf(t.name).needsSkills)
    .map((t) => (t.descriptionWithoutSkills === undefined ? t : { ...t, description: t.descriptionWithoutSkills }));
}

// Only name, description and parameters: the facts never reach the model.
export const toolSpecs = (tools: readonly AgentTool[]): ToolSpec[] =>
  tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
