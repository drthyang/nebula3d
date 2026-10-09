// Minimal OpenAI-compatible chat client for local LLM servers (Ollama's /v1,
// LM Studio) and cloud providers (OpenAI, Gemini).  Hand-rolled on fetch — no
// SDK, no SSE library — so the whole provider surface stays in one readable file
// and adds zero runtime dependencies.  Ported from rmc-toolkits, extended with
// multimodal content parts so a rendered slice image can ride along for
// vision-capable models, and with function calling ("tools") so the model can
// ask the app to measure, look up or show something mid-answer.

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

const describeHttpError = async (response: Response): Promise<string> => {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload?.error?.message || payload?.error || "";
  } catch {
    // Non-JSON error bodies are fine; the status code is enough.
  }
  return `HTTP ${response.status}${detail ? `: ${detail}` : ""}`;
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
  const response = await fetch(`${trimBase(baseUrl)}/models`, { signal, headers: authHeaders(apiKey) });
  if (!response.ok) {
    const error = new Error(await describeHttpError(response)) as HttpError;
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  return (payload.data || []).map((entry: { id?: string }) => entry.id).filter(Boolean) as string[];
};

// Probe the server and translate failures into actionable setup hints.
// Returns { ok, models, error, hint } and never throws (except on abort).
export const checkConnection = async (
  baseUrl: string,
  { signal, apiKey }: { signal?: AbortSignal; apiKey?: string } = {},
): Promise<ConnectionResult> => {
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
    const error = new Error(await describeHttpError(response)) as HttpError;
    error.status = response.status;
    throw error;
  }
  return response;
};

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
  const response = await postChat({ baseUrl, model, messages, temperature, stream: false, signal, apiKey });
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("The model returned no message content");
  return content;
};
