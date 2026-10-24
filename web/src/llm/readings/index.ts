// The tool-result readings module's interface. A tool call's step (agent.ts)
// carries two readings of its result: what the tool found, the whole result,
// and what the model read when the call returned, the text sent back to it,
// which the executor fits to the room the model has (`fit`). Where the two
// differ the step holds both: `result`, what the model read, and `full`, the
// whole. A reader names the reading it means:
//
// - `found`: what the tool found, parsed. The number readers read it: the
//   answer checks, the freshness of evidence (evidence.ts), the references
//   ({{tool.field}}), the check-verdict module's word-reading adapter
//   (verdicts/recorded.ts) and the record's number provenance.
// - `whole`: the whole text, where a reader needs the text (an answer's number
//   sources, a result that is no object).
// - `seen`: what the model read when the call returned, byte for byte as it
//   was sent. What the model saw reads it (the chat view, an earlier turn's
//   number sources), and so do the graders (evals/checks.ts), which parse it
//   themselves to stay independent of the app's reading.
//
// `fit` makes the model's copy (the executor, runToolCall, alone calls it) and
// `shorten` shortens that copy later in a long reply (the agent loop's
// compaction, compactOlder, alone calls it: a skill's text keeps its head and
// its `## Gates` section); neither changes a step's readings: `seen` stays
// what was sent, and the step is marked `shortened`.
//
// Everything else under readings/ is implementation: fit.ts (fitting a result
// to the limit), compact.ts (shortening) and found.ts (the parse, once per
// text, deep-frozen). Nothing here throws.

import type { AgentStep } from "../agent";
import { parsed } from "./found";

/** What a tool found: its whole result parsed to an object, deep-frozen, shared by every reader. */
export type Found = Readonly<Record<string, unknown>>;

/** What a reading reads of a step: a live step, an old one without `full`, or a record's decision mapped back (stepOf). */
export type Readable = Pick<AgentStep, "status" | "result" | "full">;

/** What the model read when the call returned: the tool message as it was sent, never shortened since. "" while it runs. */
export const seen = (step: Readable): string => step.result ?? "";

/** The whole text of the result (an error's or a skill's text as it is). "" while it runs. */
export const whole = (step: Readable): string => step.full ?? step.result ?? "";

/**
 * What the tool found: the whole result parsed, when the call ran without an
 * error and the result is an object; null otherwise (an error, a step still
 * running, a text such as a skill's, JSON that is no object). Deep-equal to
 * JSON.parse(whole(step)), parsed once per text and frozen.
 */
export const found = (step: Readable): Found | null => (step.status === "done" ? parsed(whole(step)) : null);

export { fit } from "./fit";
export { shorten } from "./compact";
