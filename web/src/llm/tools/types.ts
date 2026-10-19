// The types every tool module shares: what a tool is (AgentTool, and ChatTool
// with its facts), what it reads (ToolContext, ToolIO) and returns
// (ToolOutcome), and the error that sends bad arguments back to the model
// (ToolArgError). A leaf module: it imports types only, so each tool's
// definition (defs/), the registry, the executor (call.ts, round.ts) and the
// modules around the agent loop can import it without a cycle.

import type { Dataset } from "../../api/types";
import type { Outcome } from "../verdicts/rules";
import type { ToolFacts } from "./facts";
import type { ViewTarget } from "./openView";

/** A call's arguments, as the model sent them: a JSON object. */
export type Args = Record<string, unknown>;

// The dataset the tools read.  run_pipeline replaces `dataset` with its fresh
// listing after a run, so the tools called after it see the new outputs.
export interface ToolContext {
  dataset: Dataset;
  datasets: Dataset[];
  // The skills' switch (skills.ts): on unless false. Off (the validation's arm
  // C), the conversation has no skills: read_skill is not offered (toolsWithSkills)
  // and no stage waits for one to be read (runToolCall).
  skills?: boolean;
  // The skills read in this conversation (read_skill adds to it). Set on every
  // call the model makes, which gates a stage's changes on its skill; left
  // unset by the app's own calls (the report), which change nothing.
  skillsRead?: Set<string>;
  // The tool results of the conversation's earlier turns: what an answer's
  // numbers may come from besides this reply's own results (agent.ts).
  earlierResults?: readonly string[];
}

export interface ToolOutcome {
  result: unknown;
  summary: string; // one line for the transcript
  view?: ViewTarget;
  // The checks' outcomes the tool judged (verdicts/): beside the result, never
  // in it, so the model reads no more than the result.
  outcomes?: Outcome[];
}

// What a long tool gets besides its arguments: the reply's abort signal, and a
// live line for its transcript step while it runs.
export interface ToolIO {
  signal?: AbortSignal;
  progress?: (text: string) => void;
}

export interface AgentTool {
  name: string;
  description: string;
  // The description with the skills off (the switch, skills.ts): without what
  // names a skill or restates a skill's step. Left out: the description names
  // none, and serves either way.
  descriptionWithoutSkills?: string;
  parameters: Record<string, unknown>; // JSON Schema of the arguments
  run: (args: Record<string, unknown>, ctx: ToolContext, io: ToolIO) => Promise<ToolOutcome>;
  maxResultChars?: number; // above MAX_RESULT_CHARS, for a result that must arrive whole (a skill)
}

/** A tool of the registry: what the model reads and runs, and the facts the modules around it read. */
export type ChatTool = AgentTool & { facts: ToolFacts };

/** Bad arguments: the message goes back to the model so it can correct itself. */
export class ToolArgError extends Error {}
