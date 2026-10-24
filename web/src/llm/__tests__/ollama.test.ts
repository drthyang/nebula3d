// Ollama through its own chat API: the request in Ollama's form (the context
// length, tools, images, call arguments as objects, results by tool name), its
// one-object-a-line stream, and a context length sized to the request when the
// caller gave none.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completeChat, isOllamaUrl, streamChat, toOllamaMessages, type ChatMessage, type StreamDelta } from "../provider/client";
import { resetTokenState } from "../provider/tokens";

const OLLAMA = "http://localhost:11434/v1";

const ndjson = (chunks: string[]): Response => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
};
const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const show = (contextLength: number) =>
  new Response(JSON.stringify({ model_info: { "gemma4.context_length": contextLength }, capabilities: ["tools"] }), { status: 200 });

// Routes /api/show, /api/ps (the models running now) and /api/chat; records
// each request's URL and body.
function server(chat: () => Response, contextLength = 40960, running: { name: string; context_length: number }[] = []) {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    seen.push({ url, body: init?.body ? JSON.parse(init.body as string) : {} });
    if (url.endsWith("/api/show")) return show(contextLength);
    if (url.endsWith("/api/ps")) return new Response(JSON.stringify({ models: running }), { status: 200 });
    return chat();
  });
  vi.stubGlobal("fetch", fetchMock);
  return seen;
}

const collect = async (gen: AsyncGenerator<StreamDelta>): Promise<StreamDelta[]> => {
  const out: StreamDelta[] = [];
  for await (const d of gen) out.push(d);
  return out;
};

beforeEach(() => resetTokenState());
afterEach(() => vi.unstubAllGlobals());

describe("isOllamaUrl", () => {
  it("knows Ollama by its preset or its port", () => {
    expect(isOllamaUrl(OLLAMA)).toBe(true);
    expect(isOllamaUrl("http://127.0.0.1:11434/v1/")).toBe(true);
    expect(isOllamaUrl("http://localhost:1234/v1")).toBe(false);
    expect(isOllamaUrl("https://api.openai.com/v1")).toBe(false);
    expect(isOllamaUrl("not a url")).toBe(false);
  });
});

describe("toOllamaMessages", () => {
  it("writes images as base64, call arguments as objects, and each result under its tool's name", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this." },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "assess_stage", arguments: '{"stage":"rings"}' } },
          { id: "c2", type: "function", function: { name: "run_log", arguments: "{oops" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: '{"verdict":"meets its goal"}' },
      { role: "tool", tool_call_id: "c2", content: "invalid arguments" },
    ];
    expect(toOllamaMessages(messages)).toEqual([
      { role: "user", content: "Look at this.", images: ["AAAA"] },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "assess_stage", arguments: { stage: "rings" } } },
          { function: { name: "run_log", arguments: {} } },
        ],
      },
      { role: "tool", content: '{"verdict":"meets its goal"}', tool_name: "assess_stage" },
      { role: "tool", content: "invalid arguments", tool_name: "run_log" },
    ]);
  });
});

describe("streamChat with Ollama", () => {
  it("posts to /api/chat with the context length, and streams thinking, text, calls and counts", async () => {
    const seen = server(() =>
      ndjson([
        line({ message: { role: "assistant", content: "", thinking: "Let me measure." }, done: false }),
        line({ message: { role: "assistant", content: "Checking" }, done: false }),
        // a chunk boundary in the middle of a line
        line({ message: { role: "assistant", content: " now." }, done: false }).slice(0, 25),
        line({ message: { role: "assistant", content: " now." }, done: false }).slice(25),
        line({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "assess_stage", arguments: { stage: "punch" } } }] }, done: false }),
        // the last line without its newline
        JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 9120, eval_count: 41 }),
      ]),
    );
    const deltas = await collect(
      streamChat({
        baseUrl: OLLAMA,
        model: "gemma4:26b",
        messages: [{ role: "user", content: "Did the punch miss peaks?" }],
        temperature: 0.2,
        tools: [{ type: "function", function: { name: "assess_stage", description: "d", parameters: {} } }],
        toolChoice: "auto",
        numCtx: 32768,
      }),
    );
    expect(seen.map((s) => s.url)).toEqual(["http://localhost:11434/api/chat"]);
    expect(seen[0].body).toMatchObject({
      model: "gemma4:26b",
      stream: true,
      options: { temperature: 0.2, num_ctx: 32768 },
      tools: [{ type: "function", function: { name: "assess_stage" } }],
    });
    expect(seen[0].body).not.toHaveProperty("tool_choice");
    expect(deltas.filter((d) => d.reasoning).map((d) => d.reasoning).join("")).toBe("Let me measure.");
    expect(deltas.filter((d) => d.content).map((d) => d.content).join("")).toBe("Checking now.");
    expect(deltas.find((d) => d.toolCalls)?.toolCalls).toEqual([
      { id: "call_0", type: "function", function: { name: "assess_stage", arguments: '{"stage":"punch"}' } },
    ]);
    expect(deltas.find((d) => d.usage)?.usage).toEqual({ input: 9120, output: 41 });
    expect(deltas.some((d) => d.truncated)).toBe(false);
  });

  it("sends no tools when the reply must answer, and reports a reply cut at its length", async () => {
    const seen = server(() =>
      ndjson([line({ message: { content: "Partial" }, done: false }), line({ message: { content: "" }, done: true, done_reason: "length" })]),
    );
    const deltas = await collect(
      streamChat({
        baseUrl: OLLAMA,
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0,
        tools: [{ type: "function", function: { name: "x", description: "d", parameters: {} } }],
        toolChoice: "none",
        numCtx: 8192,
      }),
    );
    expect(seen[0].body).not.toHaveProperty("tools");
    expect(deltas.some((d) => d.truncated)).toBe(true);
  });

  it("asks for the output cap it is given (num_predict), sends no temperature when told none, and names a reply cut at the cap", async () => {
    const seen = server(() =>
      ndjson([line({ message: { content: "Partial" }, done: false }), line({ message: { content: "" }, done: true, done_reason: "length" })]),
    );
    const deltas = await collect(
      streamChat({ baseUrl: OLLAMA, model: "m", messages: [{ role: "user", content: "hi" }], temperature: null, numCtx: 8192, maxTokens: 16_000 }),
    );
    expect(seen[0].body.options).toEqual({ num_ctx: 8192, num_predict: 16_000 });
    expect(deltas.filter((d) => d.stopReason)).toEqual([{ truncated: true, stopReason: "length" }]);
  });

  it("sizes the context length from the request when none is given, within the model's longest", async () => {
    const seen = server(() => ndjson([line({ message: { content: "ok" }, done: true, done_reason: "stop" })]), 40960);
    const ask = (chars: number) =>
      collect(streamChat({ baseUrl: OLLAMA, model: "qwen3:32b", messages: [{ role: "user", content: "x".repeat(chars) }], temperature: 0 }));
    await ask(100); // ~30 tokens and room for the reply: the 8k step
    await ask(60_000); // ~17k tokens + reply: 32k
    await ask(100); // a short one keeps 32k: changing the length reloads the model
    await ask(200_000); // ~57k tokens: past the model's 40,960, which is all there is
    const chats = seen.filter((s) => s.url.endsWith("/api/chat"));
    expect(chats.map((s) => (s.body.options as { num_ctx?: number }).num_ctx)).toEqual([8192, 32768, 32768, 40960]);
    expect(seen.filter((s) => s.url.endsWith("/api/show"))).toHaveLength(1); // read once
  });

  it("runs with the length another app loaded the model with when it holds the request", async () => {
    const seen = server(() => ndjson([line({ message: { content: "ok" }, done: true })]), 262144, [
      { name: "gemma4:26b", context_length: 40960 },
    ]);
    await collect(streamChat({ baseUrl: OLLAMA, model: "gemma4:26b", messages: [{ role: "user", content: "hi" }], temperature: 0 }));
    const chat = seen.find((s) => s.url.endsWith("/api/chat"))!;
    expect((chat.body.options as { num_ctx?: number }).num_ctx).toBe(40960);
  });

  it("raises an error Ollama streams, with what to do about it", async () => {
    server(() => ndjson([line({ error: "the input length exceeds the context length" })]));
    const run = collect(streamChat({ baseUrl: OLLAMA, model: "m", messages: [], temperature: 0, numCtx: 8192 }));
    await expect(run).rejects.toThrow(/context window is full/);
  });

  it("names a model that cannot call tools so the agent can ask again without them", async () => {
    server(() => new Response(JSON.stringify({ error: "registry.ollama.ai/library/llava does not support tools" }), { status: 400 }));
    const run = collect(
      streamChat({
        baseUrl: OLLAMA,
        model: "llava",
        messages: [],
        temperature: 0,
        numCtx: 8192,
        tools: [{ type: "function", function: { name: "x", description: "d", parameters: {} } }],
      }),
    );
    await expect(run).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/does not support tools/) });
  });
});

describe("completeChat with Ollama", () => {
  it("returns the reply's text from one response", async () => {
    const seen = server(() => new Response(JSON.stringify({ message: { role: "assistant", content: '{"trial": 1}' }, done: true }), { status: 200 }));
    const text = await completeChat({ baseUrl: OLLAMA, model: "m", messages: [{ role: "user", content: "go" }], temperature: 0 });
    expect(text).toBe('{"trial": 1}');
    const chat = seen.find((s) => s.url.endsWith("/api/chat"))!;
    expect(chat.body).toMatchObject({ stream: false, options: { num_ctx: 8192 } });
  });

  it("reports the reply's token counts, or null when Ollama gave none", async () => {
    const answer = (counts: object) => () => new Response(JSON.stringify({ message: { role: "assistant", content: "{}" }, done: true, ...counts }), { status: 200 });
    const onUsage = vi.fn();
    server(answer({ prompt_eval_count: 640, eval_count: 12 }));
    await completeChat({ baseUrl: OLLAMA, model: "m", messages: [{ role: "user", content: "go" }], temperature: 0, onUsage });
    server(answer({}));
    await completeChat({ baseUrl: OLLAMA, model: "m", messages: [{ role: "user", content: "go" }], temperature: 0, onUsage });
    expect(onUsage.mock.calls).toEqual([[{ input: 640, output: 12 }, null], [null, null]]);
  });

  it("asks for the output cap it is given (num_predict), and reports a reply cut at it", async () => {
    const onUsage = vi.fn();
    const cut = { message: { role: "assistant", content: '{"tri' }, done: true, done_reason: "length", prompt_eval_count: 640, eval_count: 16_000 };
    const seen = server(() => new Response(JSON.stringify(cut), { status: 200 }));
    await completeChat({ baseUrl: OLLAMA, model: "m", messages: [{ role: "user", content: "go" }], temperature: 0, maxTokens: 16_000, onUsage });
    const chat = seen.find((s) => s.url.endsWith("/api/chat"))!;
    expect(chat.body.options).toEqual({ temperature: 0, num_ctx: 8192, num_predict: 16_000 });
    expect(onUsage.mock.calls).toEqual([[{ input: 640, output: 16_000 }, "length"]]);
  });
});
