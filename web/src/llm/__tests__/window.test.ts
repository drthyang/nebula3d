// A request held to the model's context window before it is sent: the token
// estimate and its calibration, the context length asked of Ollama, and the
// refusal when LM Studio loaded the model with too short a window, or no
// window the model supports can hold the request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../provider/client";
import {
  baseTokens,
  DATA_CHARS_PER_TOKEN,
  estimateTokens,
  observeTokens,
  ollamaWindow,
  PROSE_CHARS_PER_TOKEN,
  resetTokenState,
  tokenScale,
} from "../provider/tokens";
import { planWindow } from "../provider/window";

beforeEach(() => resetTokenState());
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const asking = (chars: number): ChatMessage[] => [{ role: "user", content: "x".repeat(chars) }];

describe("the token estimate", () => {
  const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

  it("reads prose at 3.5 characters a token and data at 1.4: tool results, call arguments, fenced JSON", () => {
    const prose = "word ".repeat(700); // 3,500 characters
    const data = '{"at":4.39,"residual_fraction":0.149}'.repeat(100); // 3,700 characters
    close(baseTokens([{ role: "user", content: prose }]), 5 + 3500 / PROSE_CHARS_PER_TOKEN);
    close(baseTokens([{ role: "tool", tool_call_id: "c", content: data }]), 5 + 3700 / DATA_CHARS_PER_TOKEN);
    const fenced = "```json\n" + data + "\n```";
    close(baseTokens([{ role: "user", content: `Context:\n${fenced}` }]), 5 + 9 / PROSE_CHARS_PER_TOKEN + fenced.length / DATA_CHARS_PER_TOKEN);
    const args = '{"stage":"rings"}';
    close(
      baseTokens([{ role: "assistant", content: "", tool_calls: [{ id: "c", type: "function", function: { name: "assess_stage", arguments: args } }] }]),
      5 + 12 / PROSE_CHARS_PER_TOKEN + args.length / DATA_CHARS_PER_TOKEN,
    );
  });

  it("counts an image as about a thousand tokens, and the tools' definitions as prose", () => {
    const text = baseTokens([{ role: "user", content: "abcd" }]);
    const image = baseTokens([
      { role: "user", content: [{ type: "text", text: "abcd" }, { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(500_000)}` } }] },
    ]);
    expect(image - text).toBe(1000);
    const spec = [{ type: "function" as const, function: { name: "t", description: "d", parameters: {} } }];
    close(baseTokens([], spec), JSON.stringify(spec).length / PROSE_CHARS_PER_TOKEN);
  });

  it("scales by what the server counted, keeps the largest ratio, and ignores one past reason", () => {
    const key = "http://localhost:1234/v1|m";
    expect(tokenScale(key)).toBe(1);
    observeTokens(key, 10_000, 8_000); // the estimate ran long: 0.8
    expect(tokenScale(key)).toBe(0.8);
    observeTokens(key, 10_000, 7_000); // shorter still: the larger ratio stands
    expect(tokenScale(key)).toBe(0.8);
    observeTokens(key, 10_000, 12_000); // the estimate ran short: 1.2
    expect(tokenScale(key)).toBe(1.2);
    observeTokens(key, 10_000, 1_000); // 0.1: a prompt the server cut
    expect(tokenScale(key)).toBe(1.2);
    expect(estimateTokens(1_000, key)).toBe(1_200);
  });
});

describe("ollamaWindow", () => {
  it("asks for the smallest step that holds the request, never shrinks, and stays within the model", () => {
    const key = "ollama|m";
    expect(ollamaWindow(key, 9_000, 262_144)).toBe(16_384);
    expect(ollamaWindow(key, 3_000, 262_144)).toBe(16_384); // kept: a change reloads the model
    expect(ollamaWindow(key, 20_000, 262_144)).toBe(32_768);
    expect(ollamaWindow("ollama|small", 20_000, 24_000)).toBe(24_000);
    expect(ollamaWindow("ollama|small", 30_000, 24_000)).toBeNull();
    expect(ollamaWindow("ollama|big", 200_000, null)).toBe(200_000); // past the steps, as asked
  });
});

describe("planWindow", () => {
  // Ollama's /api/show and /api/ps.
  const ollama = (contextLength: number, running: { name: string; context_length: number }[] = []) =>
    vi.fn(async (url: string) => (url.endsWith("/api/ps") ? json({ models: running }) : json({ model_info: { "qwen3.context_length": contextLength } })));

  it("sizes Ollama's window for the prompt and room to reply", async () => {
    vi.stubGlobal("fetch", ollama(40_960));
    const plan = await planWindow({ baseUrl: "http://localhost:11434/v1", model: "qwen3:32b", messages: asking(35_000) });
    expect(plan.prompt).toBe(10_005); // 35,000 characters of prose at 3.5, and the message's own
    expect(plan.numCtx).toBe(16_384);
    expect(plan.refusal).toBeUndefined();
  });

  it("keeps the length a running model has when it holds the request: no reload under another app", async () => {
    vi.stubGlobal("fetch", ollama(262_144, [{ name: "gemma4:26b", context_length: 40_960 }]));
    const held = await planWindow({ baseUrl: "http://localhost:11434/v1", model: "gemma4:26b", messages: asking(35_000) });
    expect(held.numCtx).toBe(40_960);
    // One it cannot hold gets the step that does, which reloads the model.
    const longer = await planWindow({ baseUrl: "http://localhost:11434/v1", model: "gemma4:26b", messages: asking(140_000) });
    expect(longer.numCtx).toBe(65_536);
  });

  it("refuses a request no window of the model can hold", async () => {
    vi.stubGlobal("fetch", ollama(8_192));
    const plan = await planWindow({ baseUrl: "http://localhost:11434/v1", model: "tiny", messages: asking(35_000) });
    expect(plan.numCtx).toBeUndefined();
    expect(plan.refusal).toMatch(/about 10,005 tokens, more than tiny can hold \(8,192\)/);
    expect(plan.refusal).toMatch(/Press Clear/);
  });

  it("refuses a request longer than the window LM Studio loaded the model with", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ data: [{ id: "qwen", state: "loaded", loaded_context_length: 8_192, max_context_length: 131_072 }] })),
    );
    const plan = await planWindow({ baseUrl: "http://localhost:1234/v1", model: "qwen", messages: asking(35_000) });
    expect(plan.window).toBe(8_192);
    expect(plan.refusal).toMatch(/loaded with a 8,192-token context/);
    expect(plan.refusal).toMatch(/Context Length of 32,768/);
    // The same request fits a 32k window.
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ id: "qwen", state: "loaded", loaded_context_length: 32_768 }] })));
    expect((await planWindow({ baseUrl: "http://localhost:1234/v1", model: "qwen", messages: asking(35_000) })).refusal).toBeUndefined();
  });

  it("sends anyway where the window is unknown: a model LM Studio has not loaded, a cloud model", async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ id: "qwen", state: "not-loaded", max_context_length: 131_072 }] }));
    vi.stubGlobal("fetch", fetchMock);
    const local = await planWindow({ baseUrl: "http://localhost:1234/v1", model: "qwen", messages: asking(35_000) });
    expect(local).toMatchObject({ window: null });
    expect(local.refusal).toBeUndefined();
    fetchMock.mockClear();
    const cloud = await planWindow({ baseUrl: "https://api.openai.com/v1", model: "gpt", messages: asking(35_000) });
    expect(cloud).toMatchObject({ window: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
