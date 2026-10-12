// How long a request is in tokens, before it is sent. No tokenizer runs in the
// browser, so a request is measured in characters and divided by a rate: about
// 3.5 characters a token to start with (this app's prompts are JSON-heavy, and
// a tokenizer splits numbers finely), then the lowest rate the server itself
// reported for the model, once it has counted a request's prompt tokens.

import type { ChatMessage, ToolSpec } from "./client";

export const CHARS_PER_TOKEN = 3.5;

// An attached image costs the model about a thousand tokens, not the length of
// its base64 text.
const IMAGE_CHARS = 4000;

// Room left for the reply: thinking and answer (REPLY_RESERVE) where the window
// is ours to size, and at the least MIN_REPLY before a request is refused.
export const REPLY_RESERVE = 6144;
export const MIN_REPLY = 2048;

const messageChars = (m: ChatMessage): number => {
  const parts = typeof m.content === "string" ? [m.content] : m.content;
  const content = parts.reduce<number>(
    (n, p) => n + (typeof p === "string" ? p.length : p.type === "text" ? p.text.length : IMAGE_CHARS),
    0,
  );
  // The role and the template's markers around each message: a few tokens.
  return content + 16 + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0) + (m.tool_call_id?.length ?? 0);
};

/** The characters a request sends: its messages, and its tools as JSON. */
export const requestChars = (messages: ChatMessage[], tools?: ToolSpec[]): number =>
  messages.reduce((n, m) => n + messageChars(m), 0) + (tools?.length ? JSON.stringify(tools).length : 0);

// Characters per token, as each server counted them, keyed by base URL + model.
const rates = new Map<string, number>();

export const tokenRate = (key: string): number => rates.get(key) ?? CHARS_PER_TOKEN;

/** A request's characters over the prompt tokens its server counted: the lowest rate seen is kept. */
export function observeTokens(key: string, chars: number, promptTokens: number): void {
  if (!(chars > 0 && promptTokens > 0)) return;
  const rate = chars / promptTokens;
  // A prompt the server cut to fit counts fewer tokens than it had: a rate past
  // reason is left out, and the lowest one kept errs on the long side.
  if (rate >= 1.5 && rate <= 6) rates.set(key, Math.min(rate, tokenRate(key)));
}

export const estimateTokens = (chars: number, key: string): number => Math.ceil(chars / tokenRate(key));

// The context lengths asked of Ollama. Each change reloads the model, so a
// model keeps the largest it has run with in this session.
const WINDOW_STEPS = [8192, 16384, 32768, 65536, 131072];
const windows = new Map<string, number>();

/**
 * The context length to run an Ollama model with: the smallest step that holds
 * `needed` tokens, never below what it last ran with, and within `max`, the
 * longest it supports. Null when even `max` cannot hold them.
 */
export function ollamaWindow(key: string, needed: number, max: number | null): number | null {
  const want = Math.max(needed, windows.get(key) ?? 0);
  const step = WINDOW_STEPS.find((s) => s >= want) ?? want;
  const size = max != null ? Math.min(step, max) : step;
  if (size < needed) return null;
  windows.set(key, size);
  return size;
}

/** Forget what was measured and sized (tests). */
export function resetTokenState(): void {
  rates.clear();
  windows.clear();
}
