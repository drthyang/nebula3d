// One assistant reply as an agent loop: stream the model's answer; when it calls
// tools, run them here in the browser, send the results back, and let it carry
// on — within a budget — until it answers in plain text.  A model or server
// that cannot call tools gets the same request without them.

import {
  isToolsUnsupported,
  streamChat,
  type ChatMessage,
  type ToolCall,
} from "./provider/client";
import type { LlmSettings } from "./settings";
import { runToolCall, toolSpecs, type AgentTool, type ToolContext, type ViewTarget } from "./tools";

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

const joinText = (a: string, b: string): string => (a && b ? `${a}\n\n${b}` : a || b);

export async function runAgent({
  messages,
  tools,
  ctx,
  settings,
  signal,
  onProgress,
  maxRounds = MAX_TOOL_ROUNDS,
}: {
  messages: ChatMessage[];
  tools: AgentTool[];
  ctx: ToolContext | null;
  settings: LlmSettings;
  signal: AbortSignal;
  onProgress?: (p: AgentProgress) => void;
  maxRounds?: number;
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

  for (let round = 0; ; round++) {
    const last = round >= maxRounds;
    let roundText = "";
    let calls: ToolCall[] = [];
    let native: unknown;
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
      })) {
        if (delta.content) roundText += delta.content;
        if (delta.reasoning) reasoning += delta.reasoning;
        if (delta.toolCalls) calls = delta.toolCalls;
        if (delta.native) native = delta.native;
        emit(roundText);
      }
    } catch (e) {
      if (useTools && round === 0 && !roundText && isToolsUnsupported(e)) {
        noTools.add(`${settings.baseUrl}|${settings.model}`);
        useTools = false;
        note = TOOLS_UNSUPPORTED_NOTE;
        round = -1; // the same request again, without tools
        continue;
      }
      throw e;
    }
    content = joinText(content, roundText);

    if (!calls.length || !useTools) break;
    if (last) {
      note = `Stopped after ${maxRounds} rounds of tool calls; the answer uses what was gathered so far.`;
      break;
    }

    convo.push({ role: "assistant", content: roundText, tool_calls: calls, ...(native ? { native } : {}) });
    for (const call of calls) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const id = `${steps.length}:${call.id}`; // servers may reuse call ids across rounds
      steps = [...steps, { id, name: call.function.name, args: {}, status: "running" }];
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
      convo.push({ role: "tool", tool_call_id: call.id, content: run.text });
    }
  }

  return { content, reasoning, steps, note };
}
