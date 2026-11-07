// The stand-ins auto mode's tests (autoController*.test.ts, autoBudget in
// tokenBudget.test.ts) drive a whole run with: a scripted model behind the
// mocked client (each request answered from the phase it is in and its
// round), the pipeline's runs stubbed (each records the settings it ran
// with, and the evaluations then follow them: outputs.tweak), and a fake
// clock. The test file mocks the API client with syntheticCrystal's
// BackendMocks, the provider client's streamChat with `model.streamChat`,
// and tune/evaluate's evaluateStage through `outputs` (see autoController.test.ts).
// Synthetic only: no model, backend or measured data.

import { vi } from "vitest";

import type { JobEvent } from "../../api/types";
import { configOf } from "../../state/configMemory";
import { usePipelineStore, type PipelineConfig } from "../../state/pipelineStore";
import { clearDecisions } from "../apply/decisions";
import { REPORT_PROMPT } from "../auto/prompts";
import { useAutoStore } from "../auto/store";
import { useChatStore } from "../chatStore";
import type { ChatMessage, StreamDelta } from "../provider/client";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import type { TuneStage } from "../tune/catalog";
import { STAGE_NAMES } from "../verdicts/rules";
import { outputs } from "./autoOutputs";
import { DATASET, DATASETS, freshConsole } from "./syntheticCrystal";

export const SCRIPTED: LlmSettings = { ...DEFAULT_SETTINGS, baseUrl: "http://scripted.invalid/v1", model: "scripted", followViews: false };
export const CTX = { dataset: DATASET, datasets: DATASETS };

/** A user's own click, as a handler's nativeEvent has it; and a script's. */
export const TRUSTED = { isTrusted: true };
export const SCRIPTED_CLICK = { isTrusted: false };

// ---------------------------------------------------------------- the model

export type Phase = { kind: "fix"; stage: TuneStage } | { kind: "report" } | { kind: "other" };

const text = (m: ChatMessage): string => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));

/** The phase a request is in, from its phase prompt (the fourth message, in either seed form). */
export function phaseOf(messages: readonly ChatMessage[]): Phase {
  const prompt = messages[3] ? text(messages[3]) : "";
  for (const stage of Object.keys(STAGE_NAMES) as TuneStage[]) if (prompt.includes(`Change or tune ${STAGE_NAMES[stage]} `)) return { kind: "fix", stage };
  if (prompt.includes(REPORT_PROMPT)) return { kind: "report" };
  return { kind: "other" };
}

/** The model's own rounds of calls so far in the request (the seeded round not counted). */
export const roundOf = (messages: readonly ChatMessage[]): number =>
  messages.filter((m) => m.role === "assistant" && m.tool_calls?.length && !m.tool_calls.every((c) => c.id.startsWith("seed_"))).length;

let callN = 0;
/** A reply that calls one tool. */
export const call = (name: string, args: Record<string, unknown> = {}): StreamDelta[] => [
  { toolCalls: [{ id: `c${++callN}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
];
/** A reply that answers. */
export const say = (content: string): StreamDelta[] => [{ content }];

export interface Request {
  messages: ChatMessage[];
  tools?: { function: { name: string } }[];
  maxTokens?: number; // the output cap it asked for (the run policy's)
}

/** What the scripted model answers, and what it was sent. */
export const model = {
  sent: [] as Request[],
  // The reply to a request: by the phase and the model's round in it.
  respond: ((): StreamDelta[] => say("Done.")) as (phase: Phase, round: number, req: Request) => StreamDelta[],
  // Each request's token counts, when the test wants them reported (a priced model's spend).
  usage: null as null | { input: number; output: number },
};

/** The fake streamChat: hand to the provider client's mock. */
export function scriptedStream(args: Request & { signal?: AbortSignal }): AsyncGenerator<StreamDelta> {
  model.sent.push({ messages: [...args.messages], tools: args.tools, ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}) });
  const reply = model.respond(phaseOf(args.messages), roundOf(args.messages), args);
  return (async function* () {
    for (const d of reply) {
      if (args.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      yield d;
    }
    if (model.usage) yield { usage: { ...model.usage } };
  })();
}

/** The default fix: read the stage's skill, make `changes`, then answer. */
export const fixWith =
  (skill: string, changes: Record<string, unknown> | null, answer = "Changed it; the run from its stage will show whether it helped.") =>
  (round: number): StreamDelta[] =>
    round === 0 ? call("read_skill", { name: skill }) : round === 1 && changes ? call("update_settings", { changes }) : say(answer);

// ---------------------------------------------------------------- the pipeline

/** The stubbed runs: each one's stages and the settings it ran with; `hold`: a run that waits until released or cancelled. */
export const pipeline = {
  runs: [] as { stages: string[]; with: Partial<PipelineConfig>; ended: string }[],
  hold: null as null | { release: () => void; promise: Promise<void> },
  fail: false, // the next run fails
};

export { outputs } from "./autoOutputs";

export function holdRuns(): void {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  pipeline.hold = { release, promise };
}

export function stubRuns(): void {
  let cancelled = false;
  usePipelineStore.setState({
    runStages: vi.fn(async (stages: string[]) => {
      cancelled = false;
      const ranWith = configOf(usePipelineStore.getState());
      usePipelineStore.setState({ running: true, events: [], terminal: null });
      if (pipeline.hold) await pipeline.hold.promise;
      const ended = cancelled ? "cancelled" : pipeline.fail ? "error" : "done";
      pipeline.fail = false;
      const events: JobEvent[] = ended === "done" ? stages.map((stage) => ({ type: "progress", stage, status: "done", message: "" })) : [{ type: ended, status: "error", message: "the run stopped" }];
      usePipelineStore.setState({ running: false, events, terminal: ended });
      pipeline.runs.push({ stages, with: ranWith, ended });
      if (ended === "done") outputs.ranWith = ranWith;
      return ended;
    }),
    cancel: vi.fn(async () => {
      cancelled = true;
      pipeline.hold?.release();
    }),
  } as never);
}

/** A fresh console, chat, record and script. */
export function freshAuto(): void {
  freshConsole();
  stubRuns();
  useChatStore.getState().clear();
  useChatStore.setState({ busy: false, live: null, clock: null });
  clearDecisions();
  useAutoStore.setState({ run: null });
  model.sent = [];
  model.usage = null;
  model.respond = () => say("Done.");
  pipeline.runs = [];
  pipeline.hold = null;
  pipeline.fail = false;
  outputs.ranWith = {};
  outputs.tweak = (_s, e) => e;
}

/** A fake clock the test moves. */
export const clock = { t: 1_000_000, now: () => clock.t };
