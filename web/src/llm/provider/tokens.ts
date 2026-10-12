// How long a request is in tokens, before it is sent. No tokenizer runs in the
// browser, so a request is measured in characters at a starting rate per kind
// of text, then scaled by what the server itself counted for the model.
//
// Prose runs about 3.5 characters a token. Number-dense JSON runs far fewer: a
// tokenizer may give every digit its own token, and RMC's review measured tool
// results at 1.64 characters a token on gemma4:26b. So tool results, call
// arguments and fenced JSON (the run's context block) start at 1.4.

import type { ChatMessage, ToolSpec } from "./client";

export const PROSE_CHARS_PER_TOKEN = 3.5;
export const DATA_CHARS_PER_TOKEN = 1.4;

// An attached image costs the model about a thousand tokens, not the length of
// its base64 text; each message, a few for its role and the template's markers.
const IMAGE_TOKENS = 1000;
const MESSAGE_TOKENS = 5;

// Room left for the reply: thinking and answer (REPLY_RESERVE) where the window
// is ours to size, and at the least MIN_REPLY before a request is refused.
export const REPLY_RESERVE = 6144;
export const MIN_REPLY = 2048;

const FENCED_JSON = /```json\n[\s\S]*?```/g;

// A text's characters split into prose and data: fenced JSON blocks are data.
const splitText = (text: string): { prose: number; data: number } => {
  const data = (text.match(FENCED_JSON) ?? []).reduce((n, block) => n + block.length, 0);
  return { prose: text.length - data, data };
};

const messageTokens = (m: ChatMessage): number => {
  let prose = 0;
  let data = 0;
  let images = 0;
  for (const part of typeof m.content === "string" ? [m.content] : m.content) {
    if (typeof part !== "string" && part.type === "image_url") {
      images += 1;
      continue;
    }
    const text = typeof part === "string" ? part : part.text;
    if (m.role === "tool") data += text.length;
    else {
      const s = splitText(text);
      prose += s.prose;
      data += s.data;
    }
  }
  for (const c of m.tool_calls ?? []) {
    prose += c.function.name.length;
    data += c.function.arguments.length;
  }
  return MESSAGE_TOKENS + images * IMAGE_TOKENS + prose / PROSE_CHARS_PER_TOKEN + data / DATA_CHARS_PER_TOKEN;
};

/**
 * A request's tokens at the starting rates, before any server's counts: its
 * messages, and its tools' definitions (mostly descriptions: prose).
 */
export const baseTokens = (messages: ChatMessage[], tools?: ToolSpec[]): number =>
  messages.reduce((n, m) => n + messageTokens(m), 0) +
  (tools?.length ? JSON.stringify(tools).length / PROSE_CHARS_PER_TOKEN : 0);

// What each server counted over what the starting rates gave, keyed by base
// URL + model: its tokenizer against the estimate.
const scales = new Map<string, number>();

export const tokenScale = (key: string): number => scales.get(key) ?? 1;

/** A request's counted prompt tokens against its base estimate: the largest ratio seen is kept. */
export function observeTokens(key: string, base: number, promptTokens: number): void {
  if (!(base > 0 && promptTokens > 0)) return;
  const ratio = promptTokens / base;
  // A prompt the server cut to fit counts fewer tokens than it had: a ratio past
  // reason is left out, and the largest one kept errs on the long side.
  if (ratio >= 0.25 && ratio <= 4) scales.set(key, scales.has(key) ? Math.max(ratio, tokenScale(key)) : ratio);
}

/** A request's estimated prompt tokens, scaled by its server's counts where known. */
export const estimateTokens = (base: number, key: string): number => Math.ceil(base * tokenScale(key));

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

/** Run with the length the model is loaded with now (another app may hold it). */
export function keepWindow(key: string, size: number): number {
  windows.set(key, size);
  return size;
}

/** Forget what was measured and sized (tests). */
export function resetTokenState(): void {
  scales.clear();
  windows.clear();
}
