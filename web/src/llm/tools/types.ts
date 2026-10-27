// The types every tool module shares: what a tool is (AgentTool, and ChatTool
// with its facts), what it reads (ToolContext, ToolIO) and returns
// (ToolOutcome), and the error that sends bad arguments back to the model
// (ToolArgError). A leaf module: it imports types only, so each tool's
// definition (defs/), the registry, the executor (call.ts, round.ts) and the
// modules around the agent loop can import it without a cycle.

import type { Dataset } from "../../api/types";
import type { AgentStep } from "../agent";
import type { UsageReport } from "../provider/client";
import type { LlmSettings } from "../settings";
import type { Outcome } from "../verdicts/rules";
import type { ToolFacts } from "./facts";
import type { ViewTarget } from "./openView";

/** A call's arguments, as the model sent them: a JSON object. */
export type Args = Record<string, unknown>;

/**
 * A validation run's model (evals/validationRun.ts), for the requests a tool
 * makes of its own: tune_pipeline's proposals and judgements go to it, as the
 * run's replies do, each asking for the run's output cap (`maxTokens`, its
 * run policy's), and each request's token counts and stop reason go to
 * `usage`, which the run adds to its own.
 */
export interface RunModel {
  settings: Pick<LlmSettings, "baseUrl" | "model" | "apiKey" | "temperature">;
  usage: UsageReport;
  maxTokens?: number;
}

// The dataset the tools read.  run_pipeline replaces `dataset` with its fresh
// listing after a run, so the tools called after it see the new outputs.
export interface ToolContext {
  dataset: Dataset;
  datasets: Dataset[];
  // The skills' switch (skills.ts): on unless false. Off (the validation's arm
  // C), the conversation has no skills: read_skill is not offered (toolsWithSkills)
  // and no stage waits for one to be read (runToolCall).
  skills?: boolean;
  // The skills read in this reply (read_skill adds to it), with those whose
  // text the reply's messages carry (startReply, round.ts). Set on every call
  // the model makes, which gates a stage's changes on its skill; left unset by
  // the app's own calls (the report), which change nothing.
  skillsRead?: Set<string>;
  // The skills read in the conversation's earlier turns. They open no gate:
  // the chat sends an earlier turn as its text alone, so the skill's text is
  // not in this reply, and the refusal asks for it again (skills.ts).
  skillsReadEarlier?: ReadonlySet<string>;
  // The tool calls of the conversation's earlier turns that ran, oldest first
  // (toolStepsIn, agent.ts): what an answer's numbers may come from besides
  // this reply's own results, while what each measured stands (earlierSources,
  // answerChecks.ts).
  earlierSteps?: readonly AgentStep[];
  // The marks the conversation's earlier turns made, by id (marksMade,
  // answerChecks.ts): what an answer may name besides this reply's own marks.
  // A restored turn's count: its marks came back with it.
  marksEarlier?: ReadonlySet<string>;
  // This reply's steps before the call, oldest first, as the agent loop keeps
  // them: what the run's verdict ({{achieved}}, references.ts) is computed
  // from at this point (run_verdict reads it). The round sets it on every call
  // the model makes (round.ts); unset (the app's own calls), the reply has run
  // nothing.
  replySteps?: readonly AgentStep[];
  // The user's latest message, the one this reply answers: set by the agent
  // loop from the conversation as it arrived, never from what the loop itself
  // sends the model as the user (a send-back). update_settings changes a fact
  // about the sample only when it names that fact (tune/catalog.ts). Unset
  // (the app's own calls), it names none.
  readonly userMessage?: string;
  // The run's model (RunModel): set by a validation run alone, so a tool's own
  // requests go to the model the run is graded on and count in its usage.
  // Unset (the app), tune_pipeline asks the model on the console's settings
  // (settings.ts), and nothing counts its tokens.
  readonly model?: RunModel;
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
