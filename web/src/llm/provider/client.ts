// Minimal OpenAI-compatible chat client for local LLM servers (Ollama's /v1,
// LM Studio) and cloud providers (OpenAI, Gemini).  Hand-rolled on fetch — no
// SDK, no SSE library — so the whole provider surface stays in one readable file
// and adds zero runtime dependencies.  Ported from rmc-toolkits, extended with
// multimodal content parts so a rendered slice image can ride along for
// vision-capable models, and with function calling ("tools") so the model can
// ask the app to measure, look up or show something mid-answer.  Claude goes
// through Anthropic's own SDK instead (anthropic.ts), behind the same calls,
// and Ollama through its own chat API, the one place a request sets its
// context length (see streamOllama).

import {
  checkAnthropicConnection,
  completeAnthropic,
  isAnthropicUrl,
  listAnthropicModels,
  streamAnthropic,
} from "./anthropic";
import { StallError } from "../recovery";
import { isLocalUrl, providerForUrl } from "./presets";
import { baseTokens, estimateTokens, keepWindow, MIN_REPLY, ollamaWindow, REPLY_RESERVE } from "./tokens";

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
    ? `${message} — the model's context window is full. In LM Studio, raise the model's Context Length in its load settings to 48k (49152) and reload it; start Ollama with OLLAMA_CONTEXT_LENGTH=49152. With Tools on, the first request alone is about 8k tokens, and a full assessment that reads two skills reaches about 46k; Tools off, or Clear, also helps.`
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
  // The context length the model was loaded with; null while it is not loaded
  // (LM Studio then loads it on the next request with the model's defaults).
  loaded: number | null;
  max: number | null; // the most it supports
}

// LM Studio's own REST API reports the context length a model was loaded with,
// which the OpenAI-style /models list leaves out.  Null wherever it cannot be
// read: another server, a model it does not list, an older LM Studio.  A model
// it lists but has not loaded comes back with `loaded: null`.
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
    if (!entry) return null;
    const max = typeof entry.max_context_length === "number" && entry.max_context_length > 0 ? entry.max_context_length : null;
    if (entry.state !== "loaded") return { loaded: null, max };
    const loaded = entry.loaded_context_length;
    return typeof loaded === "number" && loaded > 0 ? { loaded, max } : null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return null;
  }
};

// The context window the console suggests loading a local model with when
// Tools are on: 48k. The first request alone is about 8k tokens, and a full
// assessment that reads two skills reaches about 45.6k with room for the reply
// (measured through the agent loop: __tests__/tokenBudget.test.ts). A smaller
// window still works, but the window guard then shortens the skills just read
// to stubs, or refuses the request. The same number is the run policy's
// minimum for a local live run of the validation (evals/validationModels.ts).
// It is guidance only: what contextWarning and the window's refusal suggest.
// The guard's budgets and the window plan do not read it.
export const TOOLS_CONTEXT = 49152;

/** What to do about a model loaded with less context than Tools need, or null. */
// LM Studio unloads an idle model and loads it again on the next request with
// the model's default load settings, so a length set by hand does not last:
// the default is what to change.
export const contextWarning = (context: ModelContext | null, model: string): string | null => {
  if (!context || (context.loaded != null && context.loaded >= TOOLS_CONTEXT)) return null;
  const n = (x: number) => x.toLocaleString("en-US");
  const target = context.max != null ? Math.min(TOOLS_CONTEXT, context.max) : TOOLS_CONTEXT;
  const fix =
    `In LM Studio, set this model's default Context Length to ${n(target)}${context.max != null ? ` (it supports up to ${n(context.max)})` : ""}: ` +
    "it loads an idle model again with its defaults.";
  const need =
    "With Tools on, the first request alone is about 8k tokens and a full assessment that reads two skills reaches about 46k";
  if (context.loaded == null) {
    return `${model} is not loaded: LM Studio will load it with its default Context Length on the next request. ${need}. ${fix}`;
  }
  return (
    `${model} is loaded with a ${n(context.loaded)}-token context. ${need}, so ` +
    `${
      context.loaded < 12000
        ? "replies will be cut off"
        : "on a long assessment the skills it read are shortened to stubs, or a request is not sent"
    }. ${fix}`
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
  // Ask a streaming server for the request's token counts (stream_options):
  // the evals record them, and they calibrate the token estimate (tokens.ts).
  includeUsage?: boolean;
  // Ollama: the context length to run the model with (options.num_ctx); sized
  // from the request when left out.
  numCtx?: number;
}

// A failed request as an error that carries its status and says what to do.
const httpError = async (response: Response): Promise<HttpError> => {
  const message = await describeHttpError(response);
  const error = new Error(response.status === 500 ? `${message} — ${SERVER_ERROR_HINT}` : message) as HttpError;
  error.status = response.status;
  return error;
};

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
  includeUsage,
}: PostChatArgs): Promise<Response> => {
  const body: Record<string, unknown> = { model, messages, temperature, stream };
  if (stream && includeUsage) body.stream_options = { include_usage: true };
  if (tools?.length) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }
  const send = (b: Record<string, unknown>) =>
    fetch(`${trimBase(baseUrl)}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
      body: JSON.stringify(b),
      signal,
    });
  let response = await send(body);
  const server = trimBase(baseUrl);
  if (body.stream_options && !usageAnswered.has(server)) {
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      // A request with stream_options, to a server not yet known to take it,
      // refused as a bad request in whatever shape (a FastAPI `detail` list, a bare 400):
      // asked once more without it, as before the counts were asked for. A
      // request refused with a client error ran nothing, so nothing is
      // repeated. Once it has answered either way, or taken the field, a
      // later client error is not about the field.
      void response.body?.cancel().catch(() => {});
      const { stream_options: _asked, ...without } = body;
      void _asked;
      response = await send(without);
      if (response.ok) refuseUsage(baseUrl);
      usageAnswered.add(server);
    } else if (response.ok) usageAnswered.add(server);
  }
  if (!response.ok) throw await httpError(response);
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

// A server that does not take stream_options (asked for the token counts)
// refuses the request with a client error naming it.
export const isUsageUnsupported = (error: unknown): boolean => {
  const { status, message } = (error ?? {}) as HttpError;
  return status !== undefined && status >= 400 && status < 500 && /stream_options|include_usage/i.test(message ?? "");
};

// Servers known (this session) to refuse stream_options: asked without it.
const noUsage = new Set<string>();
// Servers whose first request with stream_options has had its answer (taken,
// or refused and asked again without it): a later client error is not about it.
const usageAnswered = new Set<string>();
export const usageRefused = (baseUrl: string): boolean => noUsage.has(trimBase(baseUrl));
export const refuseUsage = (baseUrl: string): void => void noUsage.add(trimBase(baseUrl));

// Ollama at its usual port goes through its own chat API (/api/chat), not /v1:
// only there does a request set the model's context length. Otherwise Ollama
// picks one by the machine's memory (4k on a small machine, far more on a large
// one) and cuts a longer prompt from its start without a word, or spends
// memory on a window the conversation never needs.
export const isOllamaUrl = (baseUrl: string): boolean => {
  if (providerForUrl(baseUrl)?.id === "ollama") return true;
  try {
    return new URL(baseUrl).port === "11434";
  } catch {
    return false;
  }
};

const serverRoot = (baseUrl: string): string => trimBase(baseUrl).replace(/\/v1$/, "");

export interface OllamaModel {
  maxContext: number | null; // the longest context the model supports
}

const ollamaModels = new Map<string, Promise<OllamaModel>>();

/** What Ollama says about a model (POST /api/show, which loads nothing), read once. */
export const ollamaModel = (baseUrl: string, model: string, signal?: AbortSignal): Promise<OllamaModel> => {
  const key = `${serverRoot(baseUrl)}|${model}`;
  let known = ollamaModels.get(key);
  if (!known) {
    known = (async (): Promise<OllamaModel> => {
      const response = await fetch(`${serverRoot(baseUrl)}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal,
      });
      if (!response.ok) return { maxContext: null };
      const payload = (await response.json()) as { model_info?: Record<string, unknown> };
      const length = Object.entries(payload.model_info ?? {}).find(
        ([k, v]) => k.endsWith(".context_length") && typeof v === "number" && v > 0,
      )?.[1];
      return { maxContext: typeof length === "number" ? length : null };
    })().catch((error) => {
      ollamaModels.delete(key); // a server that was down is asked again next time
      if ((error as Error)?.name === "AbortError") throw error;
      return { maxContext: null };
    });
    ollamaModels.set(key, known);
  }
  return known;
};

// Names Ollama treats as one model: "llama3.2" is "llama3.2:latest".
const sameModel = (a: string | undefined, b: string): boolean =>
  !!a && (a === b || a === `${b}:latest` || `${a}:latest` === b);

/** The context length an Ollama model runs with now, if it is loaded (GET /api/ps, which loads nothing). */
export const ollamaRunning = async (baseUrl: string, model: string, signal?: AbortSignal): Promise<number | null> => {
  try {
    const response = await fetch(`${serverRoot(baseUrl)}/api/ps`, { signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as { models?: { name?: string; model?: string; context_length?: unknown }[] };
    const length = payload.models?.find((m) => sameModel(m.name, model) || sameModel(m.model, model))?.context_length;
    return typeof length === "number" && length > 0 ? length : null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return null;
  }
};

/**
 * The context length to run an Ollama model with for a prompt of `prompt`
 * tokens. The one it runs with now, when that holds the prompt and the reply:
 * another app may be using the model (Athanor's critic, MATERIA), and any
 * other length reloads it under them. Else the smallest step that holds them
 * (tokens.ts), within the longest context the model supports. Null when
 * nothing it supports can hold the prompt.
 */
export const ollamaContext = async (
  baseUrl: string,
  model: string,
  prompt: number,
  signal?: AbortSignal,
): Promise<{ numCtx: number | null; max: number | null }> => {
  const key = `${baseUrl}|${model}`;
  const [{ maxContext: max }, running] = await Promise.all([
    ollamaModel(baseUrl, model, signal),
    ollamaRunning(baseUrl, model, signal),
  ]);
  if (running != null && running >= prompt + REPLY_RESERVE) return { numCtx: keepWindow(key, running), max };
  const sized = ollamaWindow(key, prompt + REPLY_RESERVE, max) ?? ollamaWindow(key, prompt + MIN_REPLY, max);
  if (sized != null) return { numCtx: sized, max };
  // Room for a short reply in what it runs with is still better than none.
  if (running != null && running >= prompt + MIN_REPLY) return { numCtx: keepWindow(key, running), max };
  return { numCtx: null, max };
};

// A call's arguments as the object Ollama's API takes; anything else as {}.
const argsObject = (json: string): Record<string, unknown> => {
  try {
    const args: unknown = JSON.parse(json || "{}");
    return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Messages in Ollama's own form: images as base64, call arguments as objects, results by tool name. */
export const toOllamaMessages = (messages: ChatMessage[]): Record<string, unknown>[] => {
  const names = new Map<string, string>(); // tool_call_id → the tool it called
  return messages.map((m) => {
    const parts = typeof m.content === "string" ? null : m.content;
    const out: Record<string, unknown> = {
      role: m.role,
      content: parts ? parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n") : m.content,
    };
    const images = parts?.flatMap((p) => (p.type === "image_url" ? [p.image_url.url.replace(/^data:[^,]*,/, "")] : []));
    if (images?.length) out.images = images;
    if (m.tool_calls?.length) {
      out.tool_calls = m.tool_calls.map((c) => {
        names.set(c.id, c.function.name);
        return { function: { name: c.function.name, arguments: argsObject(c.function.arguments) } };
      });
    }
    const name = m.role === "tool" && m.tool_call_id ? names.get(m.tool_call_id) : undefined;
    if (name) out.tool_name = name;
    return out;
  });
};

// The context length for a request whose caller did not size it.
const sizedWindow = async (args: Omit<PostChatArgs, "stream">): Promise<number | undefined> => {
  if (args.numCtx) return args.numCtx;
  const prompt = estimateTokens(baseTokens(args.messages, args.tools), `${args.baseUrl}|${args.model}`);
  const { numCtx, max } = await ollamaContext(args.baseUrl, args.model, prompt, args.signal);
  return numCtx ?? max ?? undefined;
};

const postOllama = async (args: Omit<PostChatArgs, "stream">, stream: boolean): Promise<Response> => {
  const numCtx = await sizedWindow(args);
  const body: Record<string, unknown> = {
    model: args.model,
    messages: toOllamaMessages(args.messages),
    stream,
    options: { temperature: args.temperature, ...(numCtx ? { num_ctx: numCtx } : {}) },
  };
  // Ollama takes no tool_choice: a request that must answer goes without tools.
  if (args.tools?.length && args.toolChoice !== "none") body.tools = args.tools;
  const response = await fetch(`${serverRoot(args.baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: args.signal,
  });
  if (!response.ok) throw await httpError(response);
  return response;
};

interface OllamaChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: unknown;
}

// Ollama's stream is one JSON object a line: text and thinking in pieces, each
// tool call whole, and the counts on the last line.
async function* streamOllama(args: Omit<PostChatArgs, "stream">): AsyncGenerator<StreamDelta> {
  const response = await postOllama(args, true);
  if (!response.body) throw new Error("The server returned no response body to stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls: ToolCall[] = [];
  let buffer = "";
  let doneReason: string | undefined;
  let usage: TokenUsage | undefined;
  function* take(line: string): Generator<StreamDelta> {
    if (!line.trim()) return;
    let chunk: OllamaChunk;
    try {
      chunk = JSON.parse(line) as OllamaChunk;
    } catch {
      return;
    }
    if (chunk.error) throw streamedError(chunk.error);
    if (chunk.message?.thinking) yield { reasoning: chunk.message.thinking };
    if (chunk.message?.content) yield { content: chunk.message.content };
    for (const c of chunk.message?.tool_calls ?? []) {
      if (!c.function?.name) continue;
      const a = c.function.arguments;
      calls.push({
        id: c.id || `call_${calls.length}`,
        type: "function",
        function: { name: c.function.name, arguments: typeof a === "string" ? a : JSON.stringify(a ?? {}) },
      });
    }
    if (chunk.done) {
      doneReason = chunk.done_reason;
      if (typeof chunk.prompt_eval_count === "number") {
        usage = { input: chunk.prompt_eval_count, output: chunk.eval_count ?? 0 };
      }
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) yield* take(line);
    }
    yield* take(buffer + decoder.decode());
  } finally {
    reader.cancel().catch(() => {});
  }
  if (calls.length) yield { toolCalls: calls };
  if (doneReason === "length") yield { truncated: true };
  if (usage) yield { usage };
}

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
  // Emitted once, after the stream ends, when the server reported the
  // request's token counts (includeUsage).
  usage?: TokenUsage;
}

export interface TokenUsage {
  input: number; // prompt tokens (an Anthropic request: input plus cache reads and writes)
  output: number; // completion tokens, thinking included
  cacheRead?: number; // of input, read from the prompt cache (Anthropic)
  cacheWrite?: number; // of input, written to it
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
  includeUsage,
  numCtx,
}: Omit<PostChatArgs, "stream">): AsyncGenerator<StreamDelta> {
  if (isAnthropicUrl(baseUrl)) {
    yield* streamAnthropic({ baseUrl, model, messages, apiKey, signal, tools, toolChoice, includeUsage });
    return;
  }
  if (isOllamaUrl(baseUrl)) {
    yield* streamOllama({ baseUrl, model, messages, temperature, signal, tools, toolChoice, numCtx });
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
    includeUsage,
  });
  if (!response.body) throw new Error("The server returned no response body to stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const assembler = new ToolCallAssembler();
  let buffer = "";
  let finish: string | undefined;
  let usage: TokenUsage | undefined;
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
        // The token counts come in the last chunk (with no choices) when asked for;
        // OpenAI also says how much of the prompt it read from its cache.
        if (parsed.usage && typeof parsed.usage.prompt_tokens === "number") {
          const cached = parsed.usage.prompt_tokens_details?.cached_tokens;
          usage = {
            input: parsed.usage.prompt_tokens,
            output: parsed.usage.completion_tokens ?? 0,
            ...(typeof cached === "number" && cached > 0 ? { cacheRead: cached } : {}),
          };
        }
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
  if (usage) yield { usage };
}

// A reply streamed and read whole, under the watchdog the agent loop keeps: a
// server that sends nothing for `first` ms before the reply's first piece, or
// for `idle` ms between pieces, is taken as stuck and the request ends with a
// StallError. A non-streamed request has no pieces to watch: its first byte is
// the whole reply, so only a stream tells a slow model from a stuck server.
async function completeWatched(
  args: Omit<PostChatArgs, "stream">,
  stallMs: { first: number; idle: number },
  onUsage?: (u: TokenUsage | null) => void,
): Promise<string> {
  const request = new AbortController();
  const stop = () => request.abort();
  if (args.signal?.aborted) request.abort();
  args.signal?.addEventListener("abort", stop, { once: true });
  let stalled = false;
  let heard = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const watch = (ms: number) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      stalled = true;
      request.abort();
    }, ms);
  };
  watch(stallMs.first);
  let text = "";
  let usage: TokenUsage | null = null;
  try {
    for await (const delta of streamChat({ ...args, signal: request.signal, includeUsage: !usageRefused(args.baseUrl) })) {
      heard = true;
      watch(stallMs.idle);
      if (delta.content) text += delta.content;
      if (delta.usage) usage = delta.usage;
    }
  } catch (e) {
    if (stalled && !args.signal?.aborted) throw new StallError(Math.round((heard ? stallMs.idle : stallMs.first) / 1000));
    if (!heard && isUsageUnsupported(e) && !usageRefused(args.baseUrl)) {
      // Asked again without the counts, which this server will not give.
      refuseUsage(args.baseUrl);
      clearTimeout(watchdog);
      args.signal?.removeEventListener("abort", stop);
      return completeWatched(args, stallMs, onUsage);
    }
    throw e;
  } finally {
    clearTimeout(watchdog);
    args.signal?.removeEventListener("abort", stop);
  }
  onUsage?.(usage);
  if (!text) throw new Error("The model returned no message content");
  return text;
}

// Completion read whole, used where the reply is parsed at once. Claude goes
// through its SDK, which times a request out itself. Elsewhere, with `stallMs`
// the reply is streamed under a stall watchdog (completeWatched); without, it
// is one non-streamed request that only `signal` ends. `onUsage` is told the
// request's token counts as the server gave them, or null when it gave none.
export const completeChat = async ({
  baseUrl,
  model,
  messages,
  temperature = 0,
  signal,
  apiKey,
  numCtx,
  stallMs,
  onUsage,
}: Omit<PostChatArgs, "stream"> & {
  stallMs?: { first: number; idle: number };
  onUsage?: (u: TokenUsage | null) => void;
}): Promise<string> => {
  if (isAnthropicUrl(baseUrl)) return completeAnthropic({ baseUrl, model, messages, apiKey, signal, onUsage });
  if (stallMs) return completeWatched({ baseUrl, model, messages, temperature, signal, apiKey, numCtx }, stallMs, onUsage);
  if (isOllamaUrl(baseUrl)) {
    const response = await postOllama({ baseUrl, model, messages, temperature, signal, numCtx }, false);
    const payload = (await response.json()) as OllamaChunk;
    if (payload.error) throw streamedError(payload.error);
    if (typeof payload.message?.content !== "string") throw new Error("The model returned no message content");
    onUsage?.(typeof payload.prompt_eval_count === "number" ? { input: payload.prompt_eval_count, output: payload.eval_count ?? 0 } : null);
    return payload.message.content;
  }
  const response = await postChat({ baseUrl, model, messages, temperature, stream: false, signal, apiKey });
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("The model returned no message content");
  const u = payload.usage;
  onUsage?.(u && typeof u.prompt_tokens === "number" ? { input: u.prompt_tokens, output: u.completion_tokens ?? 0 } : null);
  return content;
};
