// Token usage: each model request counted as its server reported it, or, when
// the server reported nothing, by the console's own estimate (provider/
// tokens.ts), always marked as such; and the totals over one reply and over
// the conversation. Only requests that completed are counted: a request that
// failed or was stopped has no count from its server.
//
// What the servers report (provider/client.ts, anthropic.ts):
//  - OpenAI-compatible (OpenAI, Gemini, LM Studio): prompt_tokens and
//    completion_tokens in the stream's last chunk, asked for with
//    stream_options; OpenAI also prompt_tokens_details.cached_tokens;
//  - Ollama: prompt_eval_count (the prompt tokens it evaluated; absent when the
//    whole prompt came from its cache) and eval_count;
//  - Anthropic: input_tokens, output_tokens, cache_read_input_tokens and
//    cache_creation_input_tokens.
// Input counts the cached part too (read or written), as the servers bill it.

import { useChatStore } from "./chatStore";
import type { TokenUsage } from "./provider/client";

export interface Usage {
  input: number; // prompt tokens, any cached part included
  output: number; // reply tokens, thinking included
  cacheRead: number; // of input, read from the prompt cache
  cacheWrite: number; // of input, written to it
  requests: number; // completed requests counted
  estimated: number; // of those, the ones the server reported no counts for
}

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, estimated: 0 };

/** One request as its server counted it. */
export const measured = (u: TokenUsage): Usage => ({
  input: u.input,
  output: u.output,
  cacheRead: u.cacheRead ?? 0,
  cacheWrite: u.cacheWrite ?? 0,
  requests: 1,
  estimated: 0,
});

/** One request the server did not count, by the console's estimate. */
export const estimated = (input: number, output: number): Usage => ({
  input: Math.round(input),
  output: Math.round(output),
  cacheRead: 0,
  cacheWrite: 0,
  requests: 1,
  estimated: 1,
});

export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  requests: a.requests + b.requests,
  estimated: a.estimated + b.estimated,
});

const n = (x: number): string => x.toLocaleString("en-US");

/**
 * The usage in words: "12,345 tokens in (9,800 read from the prompt cache) ·
 * 678 out · 3 requests". Any estimated part is marked with ≈ and said; null
 * when nothing was counted.
 */
export function usageText(u: Usage | undefined | null): string | null {
  if (!u?.requests) return null;
  const approx = u.estimated ? "≈ " : "";
  const cached = [
    u.cacheRead ? `${n(u.cacheRead)} read from the prompt cache` : "",
    u.cacheWrite ? `${n(u.cacheWrite)} written to it` : "",
  ].filter(Boolean);
  const how =
    u.estimated === 0
      ? ""
      : u.estimated === u.requests
        ? " (estimated: the server reported no token counts)"
        : ` (${u.estimated} of them estimated: the server reported no counts for them)`;
  return (
    `${approx}${n(u.input)} tokens in${cached.length ? ` (${cached.join(", ")})` : ""} · ${approx}${n(u.output)} out · ` +
    `${u.requests} request${u.requests === 1 ? "" : "s"}${how}`
  );
}

// The reply being written, which a tuning run inside it counts into too.
let reply: Usage | null = null;

/** Count one request: into the reply under way, if any, and the conversation. */
export function recordUsage(u: Usage): void {
  if (reply) reply = addUsage(reply, u);
  useChatStore.getState().addUsage(u);
}

/** A reply starts: its requests are counted apart, as well. */
export function beginReply(): void {
  reply = { ...NO_USAGE };
}

/** The reply's count, as it ends. */
export function endReply(): Usage {
  const done = reply ?? { ...NO_USAGE };
  reply = null;
  return done;
}
