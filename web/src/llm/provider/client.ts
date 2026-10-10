// Minimal OpenAI-compatible chat client for local LLM servers (Ollama's /v1,
// LM Studio) and cloud providers (OpenAI, Gemini).  Hand-rolled on fetch — no
// SDK, no SSE library — so the whole provider surface stays in one readable file
// and adds zero runtime dependencies.  Ported from rmc-toolkits, extended with
// multimodal content parts so a rendered slice image can ride along for
// vision-capable models, and with function calling ("tools") so the model can
// ask the app to measure, look up or show something mid-answer.  Claude goes
// through Anthropic's own SDK instead (anthropic.ts), behind the same calls.

import {
  checkAnthropicConnection,
  completeAnthropic,
  isAnthropicUrl,
  listAnthropicModels,
  streamAnthropic,
} from "./anthropic";
import { isLocalUrl, providerForUrl } from "./presets";

// A message's content is either plain text or a list of parts (text +
// image_url), the OpenAI vision shape that Ollama/LM Studio/Gemini also accept.
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

// One function call the model asked for; `arguments` is a JSON string.
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// A function the model may call, described by a JSON Schema for its arguments.
export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// An assistant message that called tools carries `tool_calls`; each result goes
// back as a `tool` message naming the call it answers.
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  // The provider's own form of an assistant turn that called tools, replayed
  // unchanged with their results (Claude: its content blocks, thinking included).
  native?: unknown;
}

const trimBase = (baseUrl: string): string => (baseUrl || "").replace(/\/+$/, "");

// Cloud providers (OpenAI, Gemini, …) authenticate with a Bearer token; local
// servers need none, so the header is only added when a key is present.
const authHeaders = (apiKey?: string): Record<string, string> =>
  apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

// A failed fetch to localhost surfaces as a bare TypeError both when the server
// is not running and when the browser blocked the response for CORS, so the
// hint names both causes — the user cannot tell them apart from the page.  It
// quotes this page's exact origin so the OLLAMA_ORIGINS value is copy-ready.
const unreachableHint = (baseUrl: string): string => {
  const origin = typeof window !== "undefined" ? window.location.origin : "this page";
  return (
    `Could not reach ${trimBase(baseUrl)}. Either the server is not running, or it is not ` +
    `allowing this page (${origin}) via CORS. Start Ollama with this origin allowed — ` +
    `OLLAMA_ORIGINS="${origin}" ollama serve — or enable CORS in LM Studio's server settings. ` +
    "Safari also blocks HTTPS pages from calling http://localhost; use Chrome, Edge, or Firefox " +
    "(or run the app locally)."
  );
};

export interface HttpError extends Error {
  status?: number;
}

// A local server whose model has too small a context window fails the request
// (LM Studio fixes the window when it loads the model; the chat endpoint cannot
// change it).  The raw message does not say what to do about it.
const CONTEXT_OVERFLOW = /context (length|window|size)|n_ctx|maximum context|too many tokens|exceeds? the (model's )?context|prompt is too long|tokens to keep/i;
export const withContextHint = (message: string): string =>
  CONTEXT_OVERFLOW.test(message)
    ? `${message} — the model's context window is full. In LM Studio, raise the model's Context Length in its load settings to 32k and reload it; start Ollama with OLLAMA_CONTEXT_LENGTH=32768. With Tools on, the first request alone is about 8k tokens, and a full assessment reaches about 18k; Tools off, or Clear, also helps.`
    : message;

// A local model that writes a reply its own server cannot parse — most often a
// tool call in the wrong syntax — fails the stream (LM Studio: "does not match
// the expected … format"; Ollama: "error parsing tool call").  It is a sampling
// slip: the same request usually goes through when asked again.
const MALFORMED_OUTPUT = /does not match the expected [\w -]*format|error parsing tool call|failed to parse (the )?(model|tool)/i;
export const isMalformedOutput = (error: unknown): boolean => MALFORMED_OUTPUT.test((error as Error)?.message ?? "");

const streamedError = (raw: unknown): HttpError => {
  const e = (raw && typeof raw === "object" ? raw : { message: String(raw) }) as { message?: unknown; code?: unknown; status?: unknown };
  const message = typeof e.message === "string" && e.message ? e.message : String(raw);
  const hinted = MALFORMED_OUTPUT.test(message)
    ? `${message} — the model wrote a reply its server could not parse (often a tool call in the wrong syntax); asking again usually works, and a model that keeps doing it is better replaced`
    : withContextHint(message);
  const error = new Error(hinted) as HttpError;
  const status = Number(e.code ?? e.status);
  if (Number.isInteger(status) && status >= 400) error.status = status;
  return error;
};

const describeHttpError = async (response: Response): Promise<string> => {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload?.error?.message || payload?.error || "";
  } catch {
    // Non-JSON error bodies are fine; the status code is enough.
  }
  return withContextHint(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
};

const httpHint = (status?: number): string | null => {
  if (status === 401) return "Got 401 — the provider rejected the API key. Check that your key is correct and active.";
  if (status === 404) return "Got 404 — check that the base URL ends in /v1 (e.g. http://localhost:11434/v1).";
  if (status === 403) return "Got 403 — the server rejected this origin or key. Check its CORS/allowed-origins or key permissions.";
  if (status === 429) return "Got 429 — the provider is rate-limiting or your quota is exhausted.";
  return null;
};

export interface ConnectionResult {
  ok: boolean;
  models: string[];
  error: string | null;
  hint: string | null;
}

export const listModels = async (
  baseUrl: string,
  { signal, apiKey }: { signal?: AbortSignal; apiKey?: string } = {},
): Promise<string[]> => {
  if (isAnthropicUrl(baseUrl)) return listAnthropicModels({ baseUrl, apiKey, signal });
  const response = await fetch(`${trimBase(baseUrl)}/models`, { signal, headers: authHeaders(apiKey) });
  if (!response.ok) {
    const error = new Error(await describeHttpError(response)) as HttpError;
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  return (payload.data || []).map((entry: { id?: string }) => entry.id).filter(Boolean) as string[];
};

export interface ModelContext {
  loaded: number; // the context length the model was loaded with
  max: number | null; // the most it supports
}

// LM Studio's own REST API reports the context length a model was loaded with,
// which the OpenAI-style /models list leaves out.  Null wherever it cannot be
// read: another server, a model not loaded yet (LM Studio loads it on the
// first request, with its default settings), an older LM Studio.
export const loadedContext = async (
  baseUrl: string,
  model: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ModelContext | null> => {
  if (!model || !isLocalUrl(baseUrl) || providerForUrl(baseUrl)?.id === "ollama") return null;
  try {
    const response = await fetch(`${trimBase(baseUrl).replace(/\/v1$/, "")}/api/v0/models`, { signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: { id?: string; state?: string; loaded_context_length?: unknown; max_context_length?: unknown }[];
    };
    const entry = payload.data?.find((m) => m.id === model);
    const loaded = entry?.state === "loaded" ? entry.loaded_context_length : null;
    if (typeof loaded !== "number" || !(loaded > 0)) return null;
    const max = entry?.max_context_length;
    return { loaded, max: typeof max === "number" && max > 0 ? max : null };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return null;
  }
};

// With Tools on, the first request alone is about 8k tokens, and a full
// assessment reaches about 18k (measured with LM Studio, 2026-10).
export const TOOLS_CONTEXT = 32768;

/** What to do about a model loaded with less context than Tools need, or null. */
export const contextWarning = (context: ModelContext | null, model: string): string | null => {
  if (!context || context.loaded >= TOOLS_CONTEXT) return null;
  const n = (x: number) => x.toLocaleString("en-US");
  const target = context.max != null ? Math.min(TOOLS_CONTEXT, context.max) : TOOLS_CONTEXT;
  return (
    `${model} is loaded with a ${n(context.loaded)}-token context. With Tools on, the first request alone is about 8k ` +
    `tokens and a full assessment reaches about 18k, so ${context.loaded < 12000 ? "replies will be cut off" : "long replies may be cut off"}. ` +
    `In LM Studio, load it again with a Context Length of ${n(target)}${context.max != null ? ` (it supports up to ${n(context.max)})` : ""}.`
  );
};

// Probe the server and translate failures into actionable setup hints.
// Returns { ok, models, error, hint } and never throws (except on abort).
export const checkConnection = async (
  baseUrl: string,
  { signal, apiKey }: { signal?: AbortSignal; apiKey?: string } = {},
): Promise<ConnectionResult> => {
  if (isAnthropicUrl(baseUrl)) return checkAnthropicConnection(baseUrl, apiKey);
  try {
    const models = await listModels(baseUrl, { signal, apiKey });
    return { ok: true, models, error: null, hint: null };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    const isNetworkError = error instanceof TypeError;
    return {
      ok: false,
      models: [],
      error: (error as Error).message || "Connection failed",
      hint: isNetworkError ? unreachableHint(baseUrl) : httpHint((error as HttpError).status),
    };
  }
};

interface PostChatArgs {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  stream: boolean;
  signal?: AbortSignal;
  apiKey?: string;
  // Functions the model may call; "none" asks it to answer without calling.
  tools?: ToolSpec[];
  toolChoice?: "auto" | "none";
}

const postChat = async ({
  baseUrl,
  model,
  messages,
  temperature,
  stream,
  signal,
  apiKey,
  tools,
  toolChoice,
}: PostChatArgs): Promise<Response> => {
  const body: Record<string, unknown> = { model, messages, temperature, stream };
  if (tools?.length) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }
  const response = await fetch(`${trimBase(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const message = await describeHttpError(response);
    const error = new Error(response.status === 500 ? `${message} — ${SERVER_ERROR_HINT}` : message) as HttpError;
    error.status = response.status;
    throw error;
  }
  return response;
};

// LM Studio answers a conversation its model's chat template cannot render
// with a bare 500 page: the message alone does not say what to do.
const SERVER_ERROR_HINT =
  "the model server failed before it could reply. With a local server this is usually the model's chat template failing on the conversation, often after a reply was cut off by a full context window: press Clear and ask again, and load the model with a larger Context Length.";

// A server that cannot do function calling answers a request with `tools` with
// an error naming them (Ollama: "<model> does not support tools").
export const isToolsUnsupported = (error: unknown): boolean => {
  const { status, message } = (error ?? {}) as HttpError;
  return status !== undefined && status >= 400 && status < 500 && /tool|function/i.test(message ?? "");
};

export interface StreamDelta {
  content?: string;
  reasoning?: string;
  // Emitted once, after the stream ends, when the model called tools.
  toolCalls?: ToolCall[];
  // With toolCalls: the provider's own form of the turn (ChatMessage.native).
  native?: unknown;
  // Emitted once, after the stream ends, when the model stopped because it ran
  // out of room (finish_reason "length": its context window or output limit),
  // so its last text or tool call may be cut off.
  truncated?: boolean;
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

// Assembles streamed tool calls.  OpenAI sends each call's id and name once and
// its `arguments` JSON in fragments, keyed by `index`; Ollama sends each call
// whole in one chunk; some servers omit `index`, so a part with a new id opens
// the next slot and a part with neither continues the last one.
export class ToolCallAssembler {
  private slots: { id: string; name: string; args: string }[] = [];

  add(part: ToolCallDelta): void {
    let slot: number;
    if (typeof part.index === "number") slot = part.index;
    else if (part.id) {
      const known = this.slots.findIndex((c) => c?.id === part.id);
      slot = known >= 0 ? known : this.slots.length;
    } else slot = Math.max(0, this.slots.length - 1);
    const call = (this.slots[slot] ??= { id: "", name: "", args: "" });
    if (part.id) call.id = part.id;
    if (part.function?.name && !call.name) call.name = part.function.name;
    const args = part.function?.arguments;
    if (typeof args === "string") call.args += args;
    else if (args && typeof args === "object") call.args += JSON.stringify(args);
  }

  calls(): ToolCall[] {
    return this.slots
      .filter((c) => c && c.name)
      .map((c, i) => ({
        id: c.id || `call_${i}`,
        type: "function" as const,
        function: { name: c.name, arguments: c.args || "{}" },
      }));
  }
}

// Stream a chat completion, yielding `{ content }` or `{ reasoning }` deltas as
// they arrive, then `{ toolCalls }` if the model called tools.  The SSE body is
// `data: {json}` lines terminated by `data: [DONE]`; chunks can split mid-line,
// so incomplete tail lines are buffered across reads.  Reasoning models stream
// their chain-of-thought in a separate `reasoning`/`reasoning_content` field
// before the answer arrives in `content`.
export async function* streamChat({
  baseUrl,
  model,
  messages,
  temperature = 0.2,
  signal,
  apiKey,
  tools,
  toolChoice,
}: Omit<PostChatArgs, "stream">): AsyncGenerator<StreamDelta> {
  if (isAnthropicUrl(baseUrl)) {
    yield* streamAnthropic({ baseUrl, model, messages, apiKey, signal, tools, toolChoice });
    return;
  }
  const response = await postChat({
    baseUrl,
    model,
    messages,
    temperature,
    stream: true,
    signal,
    apiKey,
    tools,
    toolChoice,
  });
  if (!response.body) throw new Error("The server returned no response body to stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const assembler = new ToolCallAssembler();
  let buffer = "";
  let finish: string | undefined;
  try {
    read: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") break read;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        // A failure after the 200 (Ollama, OpenRouter, LM Studio) arrives as an error chunk.
        if (parsed.error) throw streamedError(parsed.error);
        const reason = parsed.choices?.[0]?.finish_reason;
        if (reason) finish = reason;
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) yield { content: delta.content };
        const reasoning = delta.reasoning ?? delta.reasoning_content;
        if (reasoning) yield { reasoning };
        for (const part of delta.tool_calls ?? []) assembler.add(part);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const toolCalls = assembler.calls();
  if (toolCalls.length) yield { toolCalls };
  if (finish === "length") yield { truncated: true };
}

// Non-streaming completion, used where the whole reply is parsed at once.
export const completeChat = async ({
  baseUrl,
  model,
  messages,
  temperature = 0,
  signal,
  apiKey,
}: Omit<PostChatArgs, "stream">): Promise<string> => {
  if (isAnthropicUrl(baseUrl)) return completeAnthropic({ baseUrl, model, messages, apiKey, signal });
  const response = await postChat({ baseUrl, model, messages, temperature, stream: false, signal, apiKey });
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("The model returned no message content");
  return content;
};
