// The assistant's tools: functions the model may call mid-answer to measure,
// look up or show something, instead of reasoning only from the one default
// cut it was handed. This barrel is the tools' interface to the rest of the
// app; behind it, each module has one job:
//
// - types.ts: what a tool is, what it reads and what it returns;
// - defs/<tool_name>.ts: one tool each, named as the model calls it: its
//   facts (facts.ts), its description and parameters as the model reads
//   them, and its run, which checks its arguments and returns compact JSON;
//   shared/ holds what more than one of them uses;
// - registry.ts: CHAT_TOOLS in the model's order, and their facts, offer and
//   skill gate;
// - call.ts: the executor's one call, as the model wrote it (runToolCall)
//   or by the tool's name (callTool);
// - round.ts: the executor's round, a model turn's calls over the reply's
//   history (startReply, runRound, forget), with the repeat guard.
//
// facts.ts and openView.ts are leaf modules, imported directly.

export type { AgentTool, Args, ChatTool, ToolContext, ToolIO, ToolOutcome } from "./types";
export { ToolArgError } from "./types";
export type { ViewTarget } from "./openView";
export { CHAT_TOOLS, factsOf, toolSpecs, toolsWhere, toolsWithSkills, unreadSkillRefusal } from "./registry";
export { callTool, MAX_RESULT_CHARS, runToolCall, type ToolRun } from "./call";
export { BARREN_ROUNDS, callKey, forget, runRound, startReply, type CallKey, type History, type Round } from "./round";
