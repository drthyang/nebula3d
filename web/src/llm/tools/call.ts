// One call, run: the executor's single step. A call the model made runs
// against the tools the reply offers and its tool context, which the tool
// may change (run_pipeline's fresh dataset, read_skill's skills read). It
// never throws: a bad call comes back as an error the model reads and can
// correct. What the model reads is the result fitted to the room it has
// (readings/), with the step's other fields beside it (ToolRun).

import { withoutInference } from "../inference";
import type { ToolCall } from "../provider/client";
import { fit } from "../readings";
import { skillsOn } from "../skills";
import type { Outcome } from "../verdicts/rules";
import type { ViewTarget } from "./openView";
import { unreadSkillRefusal } from "./registry";
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
