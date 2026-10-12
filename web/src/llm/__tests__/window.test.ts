// A request held to the model's context window before it is sent: the token
// estimate and its calibration, the context length asked of Ollama, and the
// refusal when LM Studio loaded the model with too short a window, or no
// window the model supports can hold the request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../provider/client";
import {
  CHARS_PER_TOKEN,
  estimateTokens,
  observeTokens,
  ollamaWindow,
  requestChars,
  resetTokenState,
  tokenRate,
} from "../provider/tokens";
import { planWindow } from "../provider/window";

beforeEach(() => resetTokenState());
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const asking = (chars: number): ChatMessage[] => [{ role: "user", content: "x".repeat(chars) }];

describe("the token estimate", () => {
  it("counts text, calls and tools, and an image as about a thousand tokens", () => {
    const text = requestChars([{ role: "user", content: "abcd" }]);
    const image = requestChars([
      { role: "user", content: [{ type: "text", text: "abcd" }, { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(500_000)}` } }] },
    ]);
    expect(image - text).toBe(4000);
    const tools = requestChars([], [{ type: "function", function: { name: "t", description: "d", parameters: {} } }]);
    expect(tools).toBeGreaterThan(40);
  });

  it("takes the lowest rate the server counted, and ignores a rate past reason", () => {
    const key = "http://localhost:1234/v1|m";
    expect(tokenRate(key)).toBe(CHARS_PER_TOKEN);
    observeTokens(key, 36_000, 9_000); // 4 characters a token
    expect(tokenRate(key)).toBe(CHARS_PER_TOKEN); // the lower start stands
    observeTokens(key, 30_000, 10_000); // 3 a token
    expect(tokenRate(key)).toBe(3);
    observeTokens(key, 30_000, 1_000); // 30 a token: a prompt the server cut
    expect(tokenRate(key)).toBe(3);
    expect(estimateTokens(3_001, key)).toBe(1_001);
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
  it("sizes Ollama's window for the prompt and room to reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ model_info: { "qwen3.context_length": 40_960 } })));
    const plan = await planWindow({ baseUrl: "http://localhost:11434/v1", model: "qwen3:32b", messages: asking(35_000) });
    expect(plan.prompt).toBe(10_005); // 35,016 characters at 3.5
    expect(plan.numCtx).toBe(16_384);
    expect(plan.refusal).toBeUndefined();
  });

  it("refuses a request no window of the model can hold", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ model_info: { "llama.context_length": 8_192 } })));
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
