// Token usage: each model request counted as its server reported it, or, when
// the server reported nothing, by the console's own estimate (provider/
// tokens.ts), always marked as such; and the totals over one reply and over
// the conversation. Only requests that completed are counted: a request that
// was sent but failed, was stopped, or was dropped and asked again has no count
// from its server, and is said apart ("+1 request not counted"), so a total
// never looks whole when it is not. A request its server refused outright (a
// client error before any reply) or never received ran nothing, and is not one.
//
// What the servers report (provider/client.ts, anthropic.ts):
//  - OpenAI-compatible (OpenAI, Gemini, LM Studio): prompt_tokens and
//    completion_tokens in the stream's last chunk, asked for with
//    stream_options; OpenAI also prompt_tokens_details.cached_tokens;
//  - Ollama: prompt_eval_count (the prompt's tokens, its cached part included,
//    in its Go runner: 0.5 on) and eval_count; newer versions also
//    prompt_eval_cached_count, the part read from its cache;
//  - Anthropic: input_tokens, output_tokens, cache_read_input_tokens and
//    cache_creation_input_tokens.
// Input counts the cached part too (read or written), as the servers bill it.

import { useChatStore } from "./chatStore";
import type { TokenUsage } from "./provider/client";
import { classifyFailure } from "./recovery";

export interface Usage {
  input: number; // prompt tokens, any cached part included
  output: number; // reply tokens, thinking included
  cacheRead: number; // of input, read from the prompt cache
  cacheWrite: number; // of input, written to it
  requests: number; // completed requests counted
  estimated: number; // of those, the ones the server reported no counts for
  // Requests sent that did not complete (stopped, failed, asked again): no
  // counts, and none of their tokens in the numbers above. Absent when none.
  uncounted?: number;
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

/** One request sent that did not complete: not counted, and said so. */
export const notCounted = (): Usage => ({ ...NO_USAGE, uncounted: 1 });

/**
 * Whether a failed request ran nothing on its server: refused with a client
 * error (4xx: a bad request, a key, a rate limit) or never reached it. A reply
 * the model wrote that its server could not parse did run.
 */
export const ranNothing = (error: unknown): boolean => {
  const kind = classifyFailure(error);
  const status = (error as { status?: number })?.status;
  return kind === "unreachable" || (kind !== "malformed" && status !== undefined && status >= 400 && status < 500);
};

export const addUsage = (a: Usage, b: Usage): Usage => {
  const uncounted = (a.uncounted ?? 0) + (b.uncounted ?? 0);
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    requests: a.requests + b.requests,
    estimated: a.estimated + b.estimated,
    ...(uncounted ? { uncounted } : {}),
  };
};

/** "+2 requests not counted", or "" when every request was. */
export const uncountedText = (u: Usage | undefined | null): string =>
  u?.uncounted ? `+${u.uncounted} request${u.uncounted === 1 ? "" : "s"} not counted` : "";

const n = (x: number): string => x.toLocaleString("en-US");

/**
 * The usage in words: "12,345 tokens in (9,800 read from the prompt cache) ·
 * 678 out · 3 requests". Any estimated part is marked with ≈ and said, and
 * requests sent but not counted are said after the total; null when there
 * was no request.
 */
export function usageText(u: Usage | undefined | null): string | null {
  const why = " (stopped, failed or asked again: no counts from the server)";
  if (!u?.requests) return u?.uncounted ? `${uncountedText(u).slice(1)}${why}` : null;
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
    `${u.requests} request${u.requests === 1 ? "" : "s"}${how}` +
    (u.uncounted ? ` · ${uncountedText(u)}${why}` : "")
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
