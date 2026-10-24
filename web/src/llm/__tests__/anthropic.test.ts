// Claude through Anthropic's SDK (mocked): the OpenAI-shaped messages mapped to
// the Messages API, a streamed turn with thinking, text and tool calls, the
// stop reasons that must not run tools, and the model list.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adaptiveThinking,
  checkAnthropicConnection,
  COMPLETE_MAX_TOKENS,
  listAnthropicModels,
  STREAM_MAX_TOKENS,
  streamAnthropic,
  toAnthropicMessages,
} from "../provider/anthropic";
import { completeChat, streamChat, type ChatMessage, type StreamDelta } from "../provider/client";

const sdk = vi.hoisted(() => {
  class APIError extends Error {
    status?: number;
    error?: unknown;
    constructor(status?: number, error?: unknown, message = "api error") {
      super(message);
      this.status = status;
      this.error = error;
    }
  }
  class APIConnectionError extends APIError {}
  class APIUserAbortError extends APIError {}
  const stream = vi.fn();
  const create = vi.fn();
  const list = vi.fn();
  const ctor = vi.fn();
  class Anthropic {
    static APIError = APIError;
    static APIConnectionError = APIConnectionError;
    static APIUserAbortError = APIUserAbortError;
    beta = { messages: { stream, create } };
    models = { list };
    constructor(opts: unknown) {
      ctor(opts);
    }
  }
  return { Anthropic, APIError, stream, create, list, ctor };
});
vi.mock("@anthropic-ai/sdk", () => ({ default: sdk.Anthropic }));

// A stream that plays `events`, then resolves finalMessage() with `message`.
const fakeStream = (events: object[], message: object) => ({
  async *[Symbol.asyncIterator]() {
    for (const e of events) yield e;
  },
  finalMessage: async () => message,
});
const textDelta = (text: string) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const thinkingDelta = (thinking: string) => ({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } });

const collect = async (gen: AsyncGenerator<StreamDelta>) => {
  const out: StreamDelta[] = [];
  for await (const d of gen) out.push(d);
  return out;
};

const tool = { type: "function" as const, function: { name: "run_pipeline", description: "run", parameters: { type: "object", properties: {} } } };
const base = { baseUrl: "https://api.anthropic.com", apiKey: "test-key", messages: [{ role: "user", content: "hi" }] as ChatMessage[] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toAnthropicMessages", () => {
  it("lifts the system prompt, maps images, and returns one round's results in one user message", () => {
    const native = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "t1", name: "a", input: {} }];
    const { system, messages } = toAnthropicMessages([
      { role: "system", content: "You are the assistant." },
      { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
      { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "a", arguments: "{}" } }], native },
      { role: "tool", tool_call_id: "t1", content: '{"x":1}' },
      { role: "tool", tool_call_id: "t2", content: '{"y":2}' },
      { role: "assistant", content: "Done.", tool_calls: [{ id: "t3", type: "function", function: { name: "b", arguments: '{"v":3}' } }] },
    ]);
    expect(system).toBe("You are the assistant.");
    expect(messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ],
    });
    expect(messages[1].content).toBe(native); // replayed exactly as Claude returned it
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: '{"x":1}' },
        { type: "tool_result", tool_use_id: "t2", content: '{"y":2}' },
      ],
    });
    expect(messages[3].content).toEqual([
      { type: "text", text: "Done." },
      { type: "tool_use", id: "t3", name: "b", input: { v: 3 } },
    ]);
  });
});

describe("streamAnthropic", () => {
  it("streams thinking and text, then the tool calls with Claude's own turn", async () => {
    const content = [{ type: "thinking", thinking: "plan", signature: "s" }, { type: "text", text: "Running." }, { type: "tool_use", id: "tu1", name: "run_pipeline", input: { from_stage: "punch" } }];
    sdk.stream.mockReturnValue(fakeStream([thinkingDelta("plan"), textDelta("Running.")], { content, stop_reason: "tool_use" }));
    const signal = new AbortController().signal;
    const out = await collect(streamAnthropic({ ...base, model: "claude-opus-5-5", signal, tools: [tool] }));
    expect(out.slice(0, 2)).toEqual([{ reasoning: "plan" }, { content: "Running." }]);
    expect(out[2]).toEqual({
      toolCalls: [{ id: "tu1", type: "function", function: { name: "run_pipeline", arguments: '{"from_stage":"punch"}' } }],
      native: content,
    });
    expect(sdk.ctor).toHaveBeenCalledWith({ apiKey: "test-key", baseURL: "https://api.anthropic.com", dangerouslyAllowBrowser: true });
    const [body, options] = sdk.stream.mock.calls[0];
    expect(options).toEqual({ signal });
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      thinking: { type: "adaptive", display: "summarized" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body.tools[0]).toMatchObject({ name: "run_pipeline", eager_input_streaming: true, input_schema: { type: "object" } });
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("leaves thinking and fallbacks off for older models, and maps tool_choice none", async () => {
    sdk.stream.mockReturnValue(fakeStream([textDelta("ok")], { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }));
    await collect(streamAnthropic({ ...base, model: "claude-haiku-4-5", tools: [tool], toolChoice: "none" }));
    const [body] = sdk.stream.mock.calls[0];
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("fallbacks");
    expect(body.tool_choice).toEqual({ type: "none" });
  });

  it("never runs tools after a refusal or a tool call cut off at max_tokens", async () => {
    const use = { type: "tool_use", id: "tu1", name: "run_pipeline", input: {} };
    sdk.stream.mockReturnValueOnce(fakeStream([], { content: [use], stop_reason: "refusal", stop_details: { category: "cyber" } }));
    expect(await collect(streamAnthropic({ ...base, model: "claude-opus-5-5", tools: [tool] }))).toEqual([
      { content: "\n\n*Claude declined to continue (cyber).*" },
    ]);
    sdk.stream.mockReturnValueOnce(fakeStream([], { content: [use], stop_reason: "max_tokens" }));
    await expect(collect(streamAnthropic({ ...base, model: "claude-opus-5-5", tools: [tool] }))).rejects.toThrow(/cut off at the output limit/);
  });

  it("asks for the output cap it is given, and names a turn cut at it, keeping its own handling of the cut", async () => {
    // A cut answer stands, as it ships, and says it was cut.
    sdk.stream.mockReturnValueOnce(fakeStream([textDelta("Partial")], { content: [{ type: "text", text: "Partial" }], stop_reason: "max_tokens" }));
    const out = await collect(streamAnthropic({ ...base, model: "claude-opus-5-5", maxTokens: 16_000 }));
    expect(out).toEqual([{ content: "Partial" }, { stopReason: "max_tokens" }]);
    expect(sdk.stream.mock.calls[0][0]).toMatchObject({ max_tokens: 16_000 });
    // A cut tool call says so before it fails the turn.
    const use = { type: "tool_use", id: "tu1", name: "run_pipeline", input: {} };
    sdk.stream.mockReturnValueOnce(fakeStream([], { content: [use], stop_reason: "max_tokens" }));
    const seen: StreamDelta[] = [];
    await expect(
      (async () => {
        for await (const d of streamAnthropic({ ...base, model: "claude-opus-5-5", tools: [tool], maxTokens: 16_000 })) seen.push(d);
      })(),
    ).rejects.toThrow(/cut off at the output limit/);
    expect(seen).toEqual([{ stopReason: "max_tokens" }]);
    // A turn that ended on its own names no stop reason; without a cap given, the transport's own.
    sdk.stream.mockReturnValueOnce(fakeStream([textDelta("ok")], { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }));
    expect(await collect(streamAnthropic({ ...base, model: "claude-opus-5-5" }))).toEqual([{ content: "ok" }]);
    expect(sdk.stream.mock.calls[2][0]).toMatchObject({ max_tokens: STREAM_MAX_TOKENS });
  });

  it("sends no temperature, whatever the caller gives it", async () => {
    sdk.stream.mockReturnValue(fakeStream([textDelta("ok")], { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }));
    for (const temperature of [0.2, 0, null, undefined]) await collect(streamChat({ ...base, model: "claude-opus-5-5", temperature }));
    for (const [body] of sdk.stream.mock.calls) expect(body).not.toHaveProperty("temperature");
  });

  it("re-issues a turn whose tool input the SDK could not parse, saying the dropped one went uncounted", async () => {
    const broken = {
      async *[Symbol.asyncIterator]() {
        yield* [];
        throw new SyntaxError("Unexpected token");
      },
      finalMessage: async () => ({}),
    };
    sdk.stream.mockReturnValueOnce(broken).mockReturnValueOnce(fakeStream([textDelta("ok")], { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }));
    expect(await collect(streamAnthropic({ ...base, model: "claude-opus-5-5" }))).toEqual([{ discarded: true }, { content: "ok" }]);
    expect(sdk.stream).toHaveBeenCalledTimes(2);
  });

  it("reports an API error with its status", async () => {
    sdk.stream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield* [];
        throw new sdk.APIError(401, { error: { message: "invalid x-api-key" } });
      },
      finalMessage: async () => ({}),
    });
    await expect(collect(streamAnthropic({ ...base, model: "claude-opus-5-5" }))).rejects.toMatchObject({
      message: "HTTP 401: invalid x-api-key",
      status: 401,
    });
    expect(sdk.stream).toHaveBeenCalledTimes(1);
  });

  it("is what the shared client uses for an Anthropic base URL", async () => {
    sdk.stream.mockReturnValue(fakeStream([textDelta("hello")], { content: [{ type: "text", text: "hello" }], stop_reason: "end_turn" }));
    const out = await collect(streamChat({ ...base, model: "claude-opus-5-5", temperature: 0.2 }));
    expect(out).toEqual([{ content: "hello" }]);
  });
});

describe("completeAnthropic", () => {
  it("reports the turn's token counts, the cache's reads and writes in the input, a refusal's too", async () => {
    const usage = { input_tokens: 500, output_tokens: 30, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 };
    const onUsage = vi.fn();
    const ask = () => completeChat({ ...base, model: "claude-sonnet-5-5", temperature: 0, onUsage });
    sdk.create.mockResolvedValueOnce({ content: [{ type: "text", text: '{"best": 1}' }], stop_reason: "end_turn", usage });
    expect(await ask()).toBe('{"best": 1}');
    expect(onUsage.mock.calls).toEqual([[{ input: 1700, output: 30, cacheRead: 1000, cacheWrite: 200 }, "end_turn"]]);
    expect(sdk.create.mock.calls[0][0]).not.toHaveProperty("stream");
    expect(sdk.create.mock.calls[0][0]).toMatchObject({ max_tokens: COMPLETE_MAX_TOKENS });
    expect(sdk.create.mock.calls[0][0]).not.toHaveProperty("temperature");
    sdk.create.mockResolvedValueOnce({ content: [], stop_reason: "refusal", stop_details: null, usage });
    await expect(ask()).rejects.toThrow(/declined to continue/);
    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it("asks for the output cap it is given, and reports a turn cut at it", async () => {
    const usage = { input_tokens: 500, output_tokens: 16_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const onUsage = vi.fn();
    sdk.create.mockResolvedValueOnce({ content: [{ type: "text", text: '{"be' }], stop_reason: "max_tokens", usage });
    await completeChat({ ...base, model: "claude-sonnet-5-5", temperature: null, maxTokens: 16_000, onUsage });
    expect(sdk.create.mock.calls[0][0]).toMatchObject({ max_tokens: 16_000 });
    expect(onUsage.mock.calls).toEqual([[{ input: 500, output: 16_000, cacheRead: 0, cacheWrite: 0 }, "max_tokens"]]);
  });
});

describe("models", () => {
  it("lists the models with Claude Opus 5.5 first", async () => {
    sdk.list.mockReturnValue((async function* () {
      yield { id: "claude-sonnet-5-5" };
      yield { id: "claude-opus-5-5" };
      yield { id: "claude-haiku-5-5" };
    })());
    expect(await listAnthropicModels({ apiKey: "k" })).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  });

  it("asks for a key, and explains a rejected one", async () => {
    expect((await checkAnthropicConnection("https://api.anthropic.com")).hint).toMatch(/Paste a Claude API key/);
    sdk.list.mockReturnValue((async function* () {
      yield* [];
      throw new sdk.APIError(401, { error: { message: "invalid x-api-key" } });
    })());
    const r = await checkAnthropicConnection("https://api.anthropic.com", "bad");
    expect(r).toMatchObject({ ok: false, error: "HTTP 401: invalid x-api-key" });
    expect(r.hint).toMatch(/rejected the API key/);
  });

  it("knows which models take adaptive thinking", () => {
    expect(["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-4-6", "claude-haiku-5-5"].every(adaptiveThinking)).toBe(true);
    expect(["claude-haiku-4-5", "claude-sonnet-4-5-20250929", "claude-3-7-sonnet-latest", "gpt-5"].some(adaptiveThinking)).toBe(false);
  });
});
