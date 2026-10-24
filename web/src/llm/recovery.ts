// What to do when a request to the model server fails. A local server on a
// shared machine fails in ways the same request survives a moment later: its
// model crashed (most often out of memory) and is loaded again on the next
// request, another app unloaded it, the server restarted, or it sat on the
// request. Those are asked again after a pause. What still fails ends the
// reply with a note saying what happened and what to do, never a bare
// exception, and the steps already run stay.

export type FailureKind =
  | "crash" // the model or its server failed mid-request
  | "memory" // not enough memory to load or run the model
  | "unloaded" // the model was unloaded while answering
  | "unreachable" // no connection to the server
  | "stalled" // the server sent nothing for too long
  | "busy" // the server is busy or rate-limiting
  | "context" // the conversation is longer than the model's window
  | "malformed" // the model wrote a reply its server could not parse
  | "error"; // anything else the server answered

export interface Failure {
  kind: FailureKind;
  message: string;
  attempts: number; // requests made, the first included
}

// A server that sends nothing for this long is taken as stuck: before the first
// piece of a reply (loading the model and reading a long prompt on a busy
// machine can take minutes), and between pieces. The agent loop and the
// tuner's requests (provider/client.ts, completeChat) both watch for it.
export const STALL_MS = { first: 300_000, idle: 120_000 };

/** The server sent nothing for too long: raised by the agent's watchdog. */
export class StallError extends Error {
  constructor(seconds: number) {
    super(`the model server sent nothing for ${seconds} s`);
    this.name = "StallError";
  }
}

const MEMORY = /out of memory|insufficient memory|requires more system memory|not enough memory|failed to allocate|\bOOM\b|cudaMalloc|OutOfMemory/i;
const CRASH = /crash|fatal exception|backend generation thread|runner (process )?has (unexpectedly )?(stopped|terminated)|unexpected EOF|signal: killed|exit code|segmentation fault|connection reset|socket hang up|ECONNRESET|terminated/i;
const UNLOADED = /model (is|was|has been) unloaded|model not loaded|no model (is )?loaded/i;
const UNREACHABLE = /failed to fetch|fetch failed|networkerror|network error|ECONNREFUSED|Could not reach/i;
const CONTEXT = /context (length|window|size)|n_ctx|maximum context|too many tokens|exceeds? the (model's )?context|prompt is too long|tokens to keep|context window is full/i;
const MALFORMED = /does not match the expected [\w -]*format|error parsing tool call|failed to parse (the )?(model|tool)/i;

/** The kind of a failed request; `stalled` when the agent's watchdog ended it. */
export function classifyFailure(error: unknown, stalled = false): FailureKind {
  if (stalled || error instanceof StallError) return "stalled";
  const message = (error as Error)?.message ?? String(error);
  const status = (error as { status?: number })?.status;
  if (MALFORMED.test(message)) return "malformed";
  if (CONTEXT.test(message)) return "context";
  if (MEMORY.test(message)) return "memory";
  if (UNLOADED.test(message)) return "unloaded";
  if (CRASH.test(message)) return "crash";
  if (status === 429 || status === 503 || /server busy|rate.?limit|overloaded/i.test(message)) return "busy";
  if (error instanceof TypeError || UNREACHABLE.test(message)) return "unreachable";
  // A bare 500 from a local server is often its model failing; once more may do.
  if (status === 500) return "crash";
  return "error";
}

// How many times a request is asked again, and the pauses before each: long
// enough for a server to load the model again or for another app to let go of
// memory. Memory gets one longer wait; the rest gets two tries.
export const RETRIES: Partial<Record<FailureKind, number>> = { crash: 2, unloaded: 2, unreachable: 2, stalled: 1, busy: 2, memory: 1 };
export const RETRY_DELAYS_MS = [5_000, 20_000];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What happened, and what to do about it, as the reply's note. */
export function explainFailure(failure: Failure, stepsRan: boolean): string {
  const asked = failure.attempts > 1 ? `, and again when asked ${plural(failure.attempts - 1, "more time")}` : "";
  const kept = stepsRan ? " The steps above ran; ask again to continue from them." : "";
  const what = failure.message.replace(/\.$/, "");
  switch (failure.kind) {
    case "crash":
      return `The model server failed while answering (${what})${asked}. On a shared machine this is usually memory: close other models or apps, or load a smaller model or a shorter context, then ask again.${kept}`;
    case "memory":
      return `The model server ran out of memory (${what})${asked}. Close other models or apps, or pick a smaller model or a shorter context, then ask again.${kept}`;
    case "unloaded":
      return `The model was unloaded while answering (${what})${asked}: another app or the server freed it. Load it again, then ask again.${kept}`;
    case "unreachable":
      return `The model server could not be reached (${what})${asked}: it may have stopped or restarted. Check that it is running, then ask again.${kept}`;
    case "stalled":
      return `The model server sent nothing for too long (${what})${asked}: it may be stuck, or queued behind another app's request. Check the server, then ask again.${kept}`;
    case "busy":
      return `The model server is busy or limiting requests (${what})${asked}. Wait a little, then ask again.${kept}`;
    case "context":
    case "malformed":
    case "error":
      return `The reply ended with an error: ${what}.${kept}`;
  }
}

/** A pause that ends early, with an AbortError, if the reply is stopped. */
export const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
