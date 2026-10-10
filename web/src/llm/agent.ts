// One assistant reply as an agent loop: stream the model's answer; when it calls
// tools, run them here in the browser, send the results back, and let it carry
// on — within a budget — until it answers in plain text.  A model or server
// that cannot call tools gets the same request without them.

import {
  isMalformedOutput,
  isToolsUnsupported,
  streamChat,
  type ChatMessage,
  type TokenUsage,
  type ToolCall,
} from "./provider/client";
import type { LlmSettings } from "./settings";
import { runToolCall, toolSpecs, type AgentTool, type ToolContext, type ViewTarget } from "./tools";
import { openView } from "./tools/openView";

export interface AgentStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  summary?: string;
  progress?: string; // a running tool's live line (run_pipeline: stage, %, log)
  result?: string; // the JSON the model read
  view?: ViewTarget;
}

export interface AgentProgress {
  content: string;
  reasoning: string;
  steps: AgentStep[];
}

export interface AgentResult extends AgentProgress {
  note?: string;
  // With `usage`: the reply's token counts over all its requests, when the
  // server reported them (null when it did not).
  usage?: (TokenUsage & { requests: number }) | null;
}

// Rounds of tool calls before the model is asked to answer with what it has;
// each round may call several tools.  Enough to change a setting, rerun and
// measure a few times over.
export const MAX_TOOL_ROUNDS = 12;

// Servers known (this session) to refuse `tools`, keyed by base URL + model, so
// the next request goes straight to the plain path.
const noTools = new Set<string>();
export const toolsKnownUnsupported = (s: Pick<LlmSettings, "baseUrl" | "model">): boolean =>
  noTools.has(`${s.baseUrl}|${s.model}`);

export const TOOLS_UNSUPPORTED_NOTE =
  "This model cannot call tools, so it answered from the fixed-cut metrics only. Pick a tool-capable model (Ollama and LM Studio mark them) to let it measure other cuts.";

export const CUT_OFF_NOTE =
  "The reply was cut off: the model ran out of room (its context window, or its output limit), so its last step was not run. Load the model with a larger Context Length (32k: with Tools on, the first request alone is about 8k tokens, and a full assessment reaches about 18k), or turn Tools off; Clear starts a shorter conversation.";

// A reply its server could not parse ran none of its tools, so the same request
// is sent again, at most this many times in one reply.
export const MALFORMED_RETRIES = 2;

const joinText = (a: string, b: string): string => (a && b ? `${a}\n\n${b}` : a || b);

// A call whose arguments are not a JSON object goes back to the model with {}
// (its result says what was wrong): a server that renders the history through
// the model's chat template parses them, and fails the whole request on a
// call cut off mid-way (LM Studio: HTTP 500).
const replayable = (call: ToolCall): ToolCall => {
  try {
    const args: unknown = JSON.parse(call.function.arguments || "{}");
    if (args && typeof args === "object" && !Array.isArray(args)) return call;
  } catch {
    // not JSON at all
  }
  return { ...call, function: { ...call.function, arguments: "{}" } };
};

// A call's arguments as soon as it starts, so the console can show what the
// step works on while it runs (the tool checks them properly).
const startArgs = (call: ToolCall): Record<string, unknown> => {
  try {
    const a = JSON.parse(call.function.arguments || "{}");
    return a && typeof a === "object" && !Array.isArray(a) ? a : {};
  } catch {
    return {};
  }
};

export async function runAgent({
  messages,
  tools,
  ctx,
  settings,
  signal,
  onProgress,
  maxRounds = MAX_TOOL_ROUNDS,
  usage: wantUsage = false,
}: {
  messages: ChatMessage[];
  tools: AgentTool[];
  ctx: ToolContext | null;
  settings: LlmSettings;
  signal: AbortSignal;
  onProgress?: (p: AgentProgress) => void;
  maxRounds?: number;
  usage?: boolean; // count the reply's tokens (the evals)
}): Promise<AgentResult> {
  const convo = [...messages];
  // The tools may refresh the dataset (run_pipeline does); keep that to this reply.
  const toolCtx = ctx && { ...ctx };
  let useTools = tools.length > 0 && ctx !== null && !toolsKnownUnsupported(settings);
  let content = "";
  let reasoning = "";
  let steps: AgentStep[] = [];
  let note: string | undefined = tools.length && !useTools && ctx ? TOOLS_UNSUPPORTED_NOTE : undefined;
  const emit = (roundText = "") => onProgress?.({ content: joinText(content, roundText), reasoning, steps });
  const setStep = (id: string, patch: Partial<AgentStep>) => {
    steps = steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    emit();
  };

  let retries = 0;
  const tokens = { input: 0, output: 0, requests: 0 }; // over the requests that reported them
  let requests = 0;
  for (let round = 0; ; round++) {
    const last = round >= maxRounds;
    let roundText = "";
    let calls: ToolCall[] = [];
    let native: unknown;
    let cutOff = false;
    const reasoningBefore = reasoning;
    try {
      for await (const delta of streamChat({
        baseUrl: settings.baseUrl,
        model: settings.model,
        messages: convo,
        temperature: settings.temperature,
        apiKey: settings.apiKey || undefined,
        signal,
        tools: useTools ? toolSpecs(tools) : undefined,
        toolChoice: useTools && last ? "none" : undefined,
        includeUsage: wantUsage,
      })) {
        if (delta.usage) {
          tokens.input += delta.usage.input;
          tokens.output += delta.usage.output;
          tokens.requests += 1;
        }
        if (delta.content) roundText += delta.content;
        if (delta.reasoning) reasoning += delta.reasoning;
        if (delta.toolCalls) calls = delta.toolCalls;
        if (delta.native) native = delta.native;
        if (delta.truncated) cutOff = true;
        emit(roundText);
      }
      requests += 1;
    } catch (e) {
      if (useTools && round === 0 && !roundText && isToolsUnsupported(e)) {
        noTools.add(`${settings.baseUrl}|${settings.model}`);
        useTools = false;
        note = TOOLS_UNSUPPORTED_NOTE;
        round = -1; // the same request again, without tools
        continue;
      }
      if (isMalformedOutput(e) && retries < MALFORMED_RETRIES && !signal.aborted) {
        retries += 1;
        reasoning = reasoningBefore; // the failed attempt's thinking goes with it
        round -= 1; // the same request again
        emit();
        continue;
      }
      throw e;
    }
    content = joinText(content, roundText);

    // A reply that ran out of room may end mid-call: never run that round's tools.
    if (cutOff) {
      note = CUT_OFF_NOTE;
      break;
    }
    if (!calls.length || !useTools) break;
    if (last) {
      note = `Stopped after ${maxRounds} rounds of tool calls; the answer uses what was gathered so far.`;
      break;
    }

    convo.push({ role: "assistant", content: roundText, tool_calls: calls.map(replayable), ...(native ? { native } : {}) });
    for (const call of calls) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const id = `${steps.length}:${call.id}`; // servers may reuse call ids across rounds
      steps = [...steps, { id, name: call.function.name, args: startArgs(call), status: "running" }];
      emit();
      const run = await runToolCall(call, tools, toolCtx!, {
        signal,
        progress: (progress) => setStep(id, { progress }),
      });
      setStep(id, {
        progress: undefined,
        args: run.args,
        status: run.ok ? "done" : "error",
        summary: run.summary,
        result: run.text,
        view: run.view,
      });
      // The console follows what the model looked at, step by step.
      if (run.ok && run.view && settings.followViews) openView(run.view);
      convo.push({ role: "tool", tool_call_id: call.id, content: run.text });
    }
  }

  // A server that reported some requests' counts but not all leaves the total unknown.
  const usage = wantUsage ? (tokens.requests > 0 && tokens.requests === requests ? tokens : null) : undefined;
  return { content, reasoning, steps, note, ...(wantUsage ? { usage } : {}) };
}
