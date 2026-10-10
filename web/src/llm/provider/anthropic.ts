// Claude through Anthropic's own SDK, behind the same three calls the
// OpenAI-compatible client offers (list models, stream a turn, complete a
// turn), so the agent loop, the tools and the tuner run unchanged.  The SDK
// is loaded only when Claude is picked, and talks to the API straight from the
// browser (`dangerouslyAllowBrowser`): the key stays in this browser, as the
// other cloud providers' keys do.
//
// The app's messages are in the OpenAI shape; this module maps them to the
// Messages API: system messages become the top-level system prompt, tool
// results go back in one user message, and an assistant turn that called tools
// is replayed exactly as Claude returned it (`native`), thinking blocks
// included, so the tool loop only ever appends to the conversation.

import type Anthropic from "@anthropic-ai/sdk";

import type { ChatMessage, ContentPart, ConnectionResult, HttpError, StreamDelta, ToolCall, ToolSpec } from "./client";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

export const isAnthropicUrl = (baseUrl: string): boolean => {
  try {
    return new URL(baseUrl).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
};

// Room for a long answer after the model's thinking; streaming keeps a request
// this large clear of HTTP timeouts.  The non-streamed tuner calls stay lower.
const STREAM_MAX_TOKENS = 64000;
const COMPLETE_MAX_TOKENS = 16000;

// Models that take server-side fallback in its "default" form on the Claude
// API: a request a safety classifier declines is re-run on another model in
// the same call instead of ending in a refusal.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

// Adaptive thinking arrived with the 4.6 models; older ones (Haiku 4.5 and
// before) reject it, so they get no thinking parameter at all.
export function adaptiveThinking(model: string): boolean {
  const m = /^claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = m[2] && m[2].length <= 2 ? Number(m[2]) : 0; // not a date suffix
  return major >= 5 || (major === 4 && minor >= 6);
}

type Sdk = typeof import("@anthropic-ai/sdk");
let sdkPromise: Promise<Sdk> | null = null;
const loadSdk = (): Promise<Sdk> => (sdkPromise ??= import("@anthropic-ai/sdk"));

async function client(apiKey: string | undefined, baseUrl: string) {
  const { default: AnthropicClient } = await loadSdk();
  return new AnthropicClient({
    apiKey: apiKey ?? "",
    baseURL: new URL(baseUrl).origin,
    dangerouslyAllowBrowser: true,
  });
}

// The SDK's errors as the rest of the app expects them: a message, and the
// HTTP status for the setup hints.
async function asHttpError(error: unknown): Promise<unknown> {
  const { default: AnthropicClient } = await loadSdk();
  if (error instanceof AnthropicClient.APIUserAbortError) return new DOMException("Aborted", "AbortError");
  if (error instanceof AnthropicClient.APIConnectionError) {
    return new Error("Could not reach api.anthropic.com. Check your network connection.");
  }
  if (error instanceof AnthropicClient.APIError) {
    const body = error.error as { error?: { message?: string } } | undefined;
    const out = new Error(`HTTP ${error.status}: ${body?.error?.message ?? error.message}`) as HttpError;
    out.status = error.status;
    return out;
  }
  return error;
}

// ------------------------------------------------------------- messages

function partToBlock(part: ContentPart): Anthropic.Beta.BetaContentBlockParam {
  if (part.type === "text") return { type: "text", text: part.text };
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(part.image_url.url);
  if (m) {
    return {
      type: "image",
      source: { type: "base64", media_type: m[1] as Anthropic.Beta.BetaBase64ImageSource["media_type"], data: m[2] },
    };
  }
  return { type: "image", source: { type: "url", url: part.image_url.url } };
}

const toolUse = (call: ToolCall): Anthropic.Beta.BetaToolUseBlockParam => {
  let input: unknown = {};
  try {
    input = JSON.parse(call.function.arguments || "{}");
  } catch {
    // Replayed as an empty input; its tool result already says it was invalid.
  }
  return { type: "tool_use", id: call.id, name: call.function.name, input };
};

export function toAnthropicMessages(messages: ChatMessage[]): {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
} {
  const system: string[] = [];
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      system.push(typeof msg.content === "string" ? msg.content : msg.content.map((p) => (p.type === "text" ? p.text : "")).join("\n"));
      continue;
    }
    if (msg.role === "tool") {
      const result: Anthropic.Beta.BetaToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      };
      // Every result of one round goes back in a single user message.
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(result);
      } else {
        out.push({ role: "user", content: [result] });
      }
      continue;
    }
    if (msg.role === "assistant") {
      if (msg.native) {
        out.push({ role: "assistant", content: msg.native as Anthropic.Beta.BetaContentBlockParam[] });
        continue;
      }
      const text = typeof msg.content === "string" ? msg.content : msg.content.map((p) => (p.type === "text" ? p.text : "")).join("");
      const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (text) blocks.push({ type: "text", text });
      for (const call of msg.tool_calls ?? []) blocks.push(toolUse(call));
      if (blocks.length) out.push({ role: "assistant", content: blocks });
      continue;
    }
    out.push({ role: "user", content: typeof msg.content === "string" ? msg.content : msg.content.map(partToBlock) });
  }
  return { system: system.join("\n\n"), messages: out };
}

interface TurnArgs {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  apiKey?: string;
  signal?: AbortSignal;
  tools?: ToolSpec[];
  toolChoice?: "auto" | "none";
  includeUsage?: boolean; // report the turn's token counts (the evals)
}

// The request body: no sampling parameters (current Claude models reject
// them), adaptive thinking with a readable summary where the model has it,
// and tools that stream their input as it is written.  Two cache
// breakpoints: one after the system prompt, so every conversation shares the
// tools and the prompt, and the automatic one (top level), which moves to the
// end of the conversation so each round of tool calls reads the last round's
// prefix from the cache.
function requestBody(
  { model, messages, tools, toolChoice }: TurnArgs,
  maxTokens: number,
): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const { system, messages: converted } = toAnthropicMessages(messages);
  const body: Anthropic.Beta.MessageCreateParamsNonStreaming = { model, max_tokens: maxTokens, messages: converted };
  if (system) body.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  (body as unknown as Record<string, unknown>).cache_control = { type: "ephemeral" };
  if (adaptiveThinking(model)) body.thinking = { type: "adaptive", display: "summarized" };
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters as Anthropic.Beta.BetaTool["input_schema"],
      eager_input_streaming: true,
    }));
    if (toolChoice === "none") body.tool_choice = { type: "none" };
  }
  if (FALLBACK_MODELS.has(model)) {
    body.betas = ["server-side-fallback-2026-07-01"];
    body.fallbacks = "default";
  }
  return body;
}

const refusalNote = (message: Anthropic.Beta.BetaMessage): string => {
  const category = message.stop_details?.category;
  return `\n\n*Claude declined to continue${category ? ` (${category})` : ""}.*`;
};

// ------------------------------------------------------------- the calls

export async function listAnthropicModels({
  baseUrl = ANTHROPIC_BASE_URL,
  apiKey,
  signal,
}: { baseUrl?: string; apiKey?: string; signal?: AbortSignal }): Promise<string[]> {
  const api = await client(apiKey, baseUrl);
  const ids: string[] = [];
  try {
    for await (const model of api.models.list({}, { signal })) ids.push(model.id);
  } catch (e) {
    throw await asHttpError(e);
  }
  // Claude Opus 5.5 first, so a fresh connection picks it.
  return ids.includes(DEFAULT_CLAUDE_MODEL) ? [DEFAULT_CLAUDE_MODEL, ...ids.filter((id) => id !== DEFAULT_CLAUDE_MODEL)] : ids;
}

export async function checkAnthropicConnection(baseUrl: string, apiKey?: string): Promise<ConnectionResult> {
  if (!apiKey) {
    return { ok: false, models: [], error: "No API key", hint: "Paste a Claude API key (from the Claude Console) to connect." };
  }
  try {
    return { ok: true, models: await listAnthropicModels({ baseUrl, apiKey }), error: null, hint: null };
  } catch (e) {
    const status = (e as HttpError).status;
    return {
      ok: false,
      models: [],
      error: (e as Error).message,
      hint:
        status === 401
          ? "Anthropic rejected the API key. Check that it is correct and active."
          : status === 403
            ? "This key is not allowed to list models. Check its workspace permissions."
            : null,
    };
  }
}

// One streamed turn: thinking and text as they arrive, then the tool calls,
// carrying Claude's own form of the turn to replay with their results.
export async function* streamAnthropic(args: TurnArgs): AsyncGenerator<StreamDelta> {
  const { default: AnthropicClient } = await loadSdk();
  const api = await client(args.apiKey, args.baseUrl);
  const body = requestBody(args, STREAM_MAX_TOKENS);
  // A tool input the SDK cannot parse at all fails the turn before any tool
  // call exists to answer, so the turn is re-issued, at most twice.
  for (let attempt = 0; ; attempt++) {
    const stream = api.beta.messages.stream(body, { signal: args.signal });
    let message: Anthropic.Beta.BetaMessage;
    let streamed = false;
    try {
      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type === "text_delta") {
          streamed = true;
          yield { content: event.delta.text };
        } else if (event.delta.type === "thinking_delta" && event.delta.thinking) {
          streamed = true;
          yield { reasoning: event.delta.thinking };
        }
      }
      message = await stream.finalMessage();
    } catch (e) {
      if (!(e instanceof AnthropicClient.APIError) && !args.signal?.aborted && !streamed && attempt < 2) continue;
      throw await asHttpError(e);
    }
    if (args.includeUsage) {
      const u = message.usage;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheWrite = u.cache_creation_input_tokens ?? 0;
      yield { usage: { input: u.input_tokens + cacheRead + cacheWrite, output: u.output_tokens, cacheRead, cacheWrite } };
    }

    if (message.stop_reason === "refusal") {
      yield { content: refusalNote(message) };
      return; // a refusal can cut a tool call short: never run that turn's tools
    }
    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length) return;
    if (message.stop_reason === "max_tokens") {
      throw new Error("Claude's tool call was cut off at the output limit; ask again for a shorter answer.");
    }
    yield {
      toolCalls: uses.map((u) => ({
        id: u.id,
        type: "function" as const,
        function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) },
      })),
      native: message.content,
    };
    return;
  }
}

// One turn read whole (the tuner parses its JSON reply).
export async function completeAnthropic(args: TurnArgs): Promise<string> {
  const api = await client(args.apiKey, args.baseUrl);
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await api.beta.messages.create(requestBody({ ...args, tools: undefined }, COMPLETE_MAX_TOKENS), {
      signal: args.signal,
    });
  } catch (e) {
    throw await asHttpError(e);
  }
  if (message.stop_reason === "refusal") throw new Error(refusalNote(message).trim());
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error("Claude returned no text");
  return text;
}
