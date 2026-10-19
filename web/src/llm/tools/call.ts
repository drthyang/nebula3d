// One call, run: the executor's single step. A call the model made runs
// through runToolCall, against the tools the reply offers and its tool
// context; callTool runs one by the tool's name, for the app's own callers
// and the tests. Either runs against the context it is given, which the tool
// may change (run_pipeline's fresh dataset, read_skill's skills read), and
// never throws: a bad call comes back as an error the model reads and can
// correct. What the model reads is the result fitted to the room it has
// (readings/), with the step's other fields beside it (ToolRun).

import { withoutInference } from "../inference";
import type { ToolCall } from "../provider/client";
import { fit } from "../readings";
import { skillsOn } from "../skills";
import type { Outcome } from "../verdicts/rules";
import type { ViewTarget } from "./openView";
import { CHAT_TOOLS, unreadSkillRefusal } from "./registry";
import { ToolArgError, type AgentTool, type Args, type ToolContext, type ToolIO } from "./types";

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

/**
 * One call by the tool's name: its arguments as an object, sent as the JSON a
 * model writes, or as the text a model wrote (left out: none). The tools are
 * the registry's unless `tools` names others (toolsWithSkills' list, a test's
 * own). It runs against `ctx` itself, as runToolCall does.
 */
export function callTool(
  ctx: ToolContext,
  name: string,
  args: Args | string = {},
  { tools = CHAT_TOOLS, ...io }: ToolIO & { tools?: readonly AgentTool[] } = {},
): Promise<ToolRun> {
  const text = typeof args === "string" ? args : JSON.stringify(args);
  return runToolCall({ id: name, type: "function", function: { name, arguments: text } }, tools, ctx, io);
}

/** A call's arguments as the model wrote them, parsed: the JSON object they are, or null when they are none (cut off mid-way, a list). */
export function parseArguments(text: string): Args | null {
  try {
    const parsed: unknown = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Args) : null;
  } catch {
    return null;
  }
}

// Run one call the model made.  Never throws: a bad call becomes an error
// message the model reads and can correct.
export async function runToolCall(
  call: ToolCall,
  tools: readonly AgentTool[],
  ctx: ToolContext,
  io: ToolIO = {},
): Promise<ToolRun> {
  return runParsed(call, parseArguments(call.function.arguments), tools, ctx, io);
}

/** runToolCall with the call's arguments parsed already (parseArguments; null: none): the round parses each call's once. */
export async function runParsed(
  call: ToolCall,
  parsed: Args | null,
  tools: readonly AgentTool[],
  ctx: ToolContext,
  io: ToolIO = {},
): Promise<ToolRun> {
  if (!parsed) {
    const text = `Error: the arguments were not a JSON object: ${call.function.arguments.slice(0, 200)}`;
    return { ok: false, args: {}, text, summary: "invalid arguments" };
  }
  const args = parsed;
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
