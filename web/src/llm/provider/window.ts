// Whether a request fits the model's context window, before it is sent. A
// local server handed a longer prompt cuts it, or fails: Ollama keeps the end
// of it without a word, LM Studio fails or cuts it by its overflow setting. So
// Ollama gets a window sized to the request, and a request no window can hold,
// or longer than the window LM Studio loaded the model with, is not sent: the
// reply says why instead. Cloud models' windows are far longer than this app's
// requests.

import { isOllamaUrl, loadedContext, ollamaContext, TOOLS_CONTEXT, type ChatMessage, type ToolSpec } from "./client";
import { isLocalUrl } from "./presets";
import { baseTokens, estimateTokens, MIN_REPLY, REPLY_RESERVE } from "./tokens";

export interface WindowPlan {
  key: string; // base URL + model: whose counts scale the estimate
  base: number; // the request's tokens at the starting rates, to calibrate by its counts
  prompt: number; // its estimated prompt tokens
  numCtx?: number; // Ollama: the context length to ask for
  window: number | null; // the window the prompt and reply must fit, where known
  refusal?: string; // why the request is not sent
}

const n = (x: number): string => x.toLocaleString("en-US");

// The context length the refusal below suggests loading a model with: 48k at
// least (TOOLS_CONTEXT: a full assessment that reads two skills reaches about
// 45.6k tokens with room for the reply, tokenBudget.test.ts), then a power of
// two. Text only: nothing here sizes or refuses a request by it.
const suggestion = (prompt: number, max: number | null): number => {
  let size = TOOLS_CONTEXT;
  for (let next = 65536; size < prompt + REPLY_RESERVE; next *= 2) size = next;
  return max != null ? Math.min(size, max) : size;
};

export async function planWindow({
  baseUrl,
  model,
  messages,
  tools,
  signal,
}: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
}): Promise<WindowPlan> {
  const key = `${baseUrl}|${model}`;
  const base = baseTokens(messages, tools);
  const prompt = estimateTokens(base, key);
  if (isOllamaUrl(baseUrl)) {
    // The length the model runs with when it holds the request (no reload under
    // another app), else room for thinking and the answer, else the least.
    const { numCtx, max } = await ollamaContext(baseUrl, model, prompt, signal);
    if (numCtx == null) {
      return {
        key,
        base,
        prompt,
        window: max,
        refusal:
          `This request needs about ${n(prompt)} tokens, more than ${model} can hold (${n(max ?? 0)}), ` +
          "so it was not sent: Ollama would drop the start of the conversation. Press Clear to start a shorter " +
          "conversation, or pick a model with a longer context.",
      };
    }
    return { key, base, prompt, numCtx, window: numCtx };
  }
  if (!isLocalUrl(baseUrl)) return { key, base, prompt, window: null };
  // LM Studio fixes the window when it loads the model; elsewhere it is unknown.
  const context = await loadedContext(baseUrl, model, { signal });
  const loaded = context?.loaded ?? null;
  if (loaded != null && prompt + MIN_REPLY > loaded) {
    return {
      key,
      base,
      prompt,
      window: loaded,
      refusal:
        `This request needs about ${n(prompt)} tokens with room for the reply, and ${model} is loaded with a ` +
        `${n(loaded)}-token context, so it was not sent: the server would cut the conversation or fail. In LM Studio, ` +
        `load the model with a Context Length of ${n(suggestion(prompt, context?.max ?? null))} and ask again, ` +
        "or press Clear to start a shorter conversation.",
    };
  }
  return { key, base, prompt, window: loaded };
}
