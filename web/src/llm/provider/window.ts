// Whether a request fits the model's context window, before it is sent. A
// local server handed a longer prompt cuts it, or fails: Ollama keeps the end
// of it without a word, LM Studio fails or cuts it by its overflow setting. So
// Ollama gets a window sized to the request, and a request no window can hold,
// or longer than the window LM Studio loaded the model with, is not sent: the
// reply says why instead. Cloud models' windows are far longer than this app's
// requests.

import { isOllamaUrl, loadedContext, ollamaModel, type ChatMessage, type ToolSpec } from "./client";
import { isLocalUrl } from "./presets";
import { estimateTokens, MIN_REPLY, ollamaWindow, REPLY_RESERVE, requestChars } from "./tokens";

export interface WindowPlan {
  key: string; // base URL + model: whose token rate the estimate used
  chars: number; // the request's characters, to calibrate the rate by its counts
  prompt: number; // its estimated prompt tokens
  numCtx?: number; // Ollama: the context length to ask for
  window: number | null; // the window the prompt and reply must fit, where known
  refusal?: string; // why the request is not sent
}

const n = (x: number): string => x.toLocaleString("en-US");

// The context lengths worth loading a model with: a power of two, 32k at least
// (a full assessment reaches about 18k tokens).
const suggestion = (prompt: number, max: number | null): number => {
  let size = 32768;
  while (size < prompt + REPLY_RESERVE) size *= 2;
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
  const chars = requestChars(messages, tools);
  const prompt = estimateTokens(chars, key);
  if (isOllamaUrl(baseUrl)) {
    const { maxContext } = await ollamaModel(baseUrl, model, signal);
    // Room for thinking and the answer when the model can hold it, else the least.
    const numCtx = ollamaWindow(key, prompt + REPLY_RESERVE, maxContext) ?? ollamaWindow(key, prompt + MIN_REPLY, maxContext);
    if (numCtx == null) {
      return {
        key,
        chars,
        prompt,
        window: maxContext,
        refusal:
          `This request needs about ${n(prompt)} tokens, more than ${model} can hold (${n(maxContext ?? 0)}), ` +
          "so it was not sent: Ollama would drop the start of the conversation. Press Clear to start a shorter " +
          "conversation, or pick a model with a longer context.",
      };
    }
    return { key, chars, prompt, numCtx, window: numCtx };
  }
  if (!isLocalUrl(baseUrl)) return { key, chars, prompt, window: null };
  // LM Studio fixes the window when it loads the model; elsewhere it is unknown.
  const context = await loadedContext(baseUrl, model, { signal });
  const loaded = context?.loaded ?? null;
  if (loaded != null && prompt + MIN_REPLY > loaded) {
    return {
      key,
      chars,
      prompt,
      window: loaded,
      refusal:
        `This request needs about ${n(prompt)} tokens with room for the reply, and ${model} is loaded with a ` +
        `${n(loaded)}-token context, so it was not sent: the server would cut the conversation or fail. In LM Studio, ` +
        `load the model with a Context Length of ${n(suggestion(prompt, context?.max ?? null))} and ask again, ` +
        "or press Clear to start a shorter conversation.",
    };
  }
  return { key, chars, prompt, window: loaded };
}
