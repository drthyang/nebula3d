// The context meter by the chat box (contextMeter.ts, THY-74): the window of
// each kind of model, the room kept for the reply, the levels, the "?" line,
// and that what it measures is what the agent loop sends on its first
// request: the same messages, the same tools, the same estimate.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { runAgent } from "../agent";
import { claudeWindow, CLAUDE_DEFAULT_WINDOW, contextWindow, conversationCost, meterDetail, meterReading, openingSpecs, requestTokens, AMBER_AT, RED_ABOVE, type ContextWindow } from "../contextMeter";
import { STREAM_MAX_TOKENS } from "../provider/anthropic";
import { TOOLS_CONTEXT, type ChatMessage, type ToolSpec } from "../provider/client";
import { baseTokens, estimateTokens, observeTokens, ollamaWindow, REPLY_RESERVE, resetTokenState } from "../provider/tokens";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { CHAT_TOOLS, type ToolContext } from "../tools";

const client = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: client.streamChat,
}));

const OLLAMA = "http://localhost:11434/v1";
const LM_STUDIO = "http://localhost:1234/v1";
const CLAUDE = "https://api.anthropic.com";
const OPENAI = "https://api.openai.com/v1";
const on = (baseUrl: string, model = "m"): LlmSettings => ({ ...DEFAULT_SETTINGS, baseUrl, model });

beforeEach(() => {
  resetTokenState();
  client.streamChat.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
});

describe("the window of each kind of model, and the reply's room", () => {
  it("Ollama: the 32k Tools need, within the model's longest; longer once it ran with more", () => {
    const s = on(OLLAMA, "gemma");
    expect(contextWindow(s)).toEqual({ size: TOOLS_CONTEXT, reserve: REPLY_RESERVE, source: "tools" });
    expect(contextWindow(s, { ollamaMax: 131_072 })).toEqual({ size: 32_768, reserve: 6_144, source: "tools" });
    expect(contextWindow(s, { ollamaMax: 8_192 })).toEqual({ size: 8_192, reserve: 6_144, source: "tools" });
    // A request sized to 16k (the window plan's step): the window the app works to is still 32k.
    ollamaWindow(`${OLLAMA}|gemma`, 13_000, 131_072);
    expect(contextWindow(s, { ollamaMax: 131_072 }).size).toBe(32_768);
    // One that ran with 64k (a long request, or another app's length): its window is 64k.
    ollamaWindow(`${OLLAMA}|gemma`, 40_000, 131_072);
    expect(contextWindow(s, { ollamaMax: 131_072 })).toEqual({ size: 65_536, reserve: 6_144, source: "ollama" });
  });

  it("LM Studio: the length it loaded the model with, else the 32k Tools need", () => {
    const s = on(LM_STUDIO);
    expect(contextWindow(s, { loaded: { loaded: 16_384, max: 131_072 } })).toEqual({ size: 16_384, reserve: REPLY_RESERVE, source: "loaded" });
    expect(contextWindow(s, { loaded: { loaded: null, max: 131_072 } })).toEqual({ size: TOOLS_CONTEXT, reserve: REPLY_RESERVE, source: "tools" });
    expect(contextWindow(s)).toEqual({ size: TOOLS_CONTEXT, reserve: REPLY_RESERVE, source: "tools" });
  });

  it("Claude: the model's window, with the output cap the loop asks for as the reply's room", () => {
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-4-6", "claude-sonnet-4-6"]) {
      expect(contextWindow(on(CLAUDE, model))).toEqual({ size: 1_000_000, reserve: STREAM_MAX_TOKENS, source: "claude" });
    }
    expect(claudeWindow("claude-haiku-4-5")).toBe(200_000);
    expect(claudeWindow("claude-opus-4-5")).toBe(200_000);
    expect(claudeWindow("claude-next-9")).toBe(CLAUDE_DEFAULT_WINDOW);
  });

  it("another cloud model: no window known, so tokens only", () => {
    expect(contextWindow(on(OPENAI, "gpt"))).toEqual({ size: null, reserve: 0, source: "unknown" });
    const r = meterReading(9_812, contextWindow(on(OPENAI, "gpt")));
    expect(r).toEqual({ prompt: 9_812, used: 9_812, share: null, percent: null, level: "ok" });
  });
});

describe("the meter's maths and levels", () => {
  const w32: ContextWindow = { size: 32_768, reserve: 6_144, source: "tools" };
  // The prompt that makes the share exactly `share` of the window, with the reserve.
  const promptAt = (w: ContextWindow, share: number) => Math.round(share * w.size!) - w.reserve;

  it("counts the reply's room: (prompt + reserve) / window", () => {
    const r = meterReading(14_336, w32); // 14,336 + 6,144 = 20,480 = 62.5 %, shown as 62 %
    expect(r).toEqual({ prompt: 14_336, used: 20_480, share: 0.625, percent: 62, level: "ok" });
  });

  it("neutral below 70 %, amber from 70 % to 90 %, red above 90 %, by the percent shown", () => {
    const w = { size: 100_000, reserve: 6_144, source: "tools" as const };
    expect(meterReading(promptAt(w, 0.6999), w)).toMatchObject({ percent: 69, level: "ok" });
    expect(meterReading(promptAt(w, AMBER_AT), w)).toMatchObject({ percent: 70, level: "amber" });
    expect(meterReading(promptAt(w, RED_ABOVE), w)).toMatchObject({ percent: 90, level: "amber" });
    // Past 90 % but shown as 90 %: amber, as the number says.
    expect(meterReading(promptAt(w, 0.9099), w)).toMatchObject({ percent: 90, level: "amber" });
    expect(meterReading(promptAt(w, 0.91), w)).toMatchObject({ percent: 91, level: "red" });
    expect(meterReading(promptAt(w, 1.2), w)).toMatchObject({ percent: 120, level: "red" });
  });

  it("per model window: the same request reads differently on each", () => {
    const prompt = 20_000;
    expect(meterReading(prompt, contextWindow(on(OLLAMA))).percent).toBe(79); // 26,144 / 32,768 = 79.8 %
    expect(meterReading(prompt, contextWindow(on(LM_STUDIO), { loaded: { loaded: 65_536, max: null } })).percent).toBe(39); // 26,144 / 65,536 = 39.9 %
    expect(meterReading(prompt, contextWindow(on(LM_STUDIO), { loaded: { loaded: 16_384, max: null } })).level).toBe("red");
    expect(meterReading(prompt, contextWindow(on(CLAUDE, "claude-opus-5-5"))).percent).toBe(8); // 84,000 / 1M
    expect(meterReading(prompt, contextWindow(on(CLAUDE, "claude-haiku-4-5"))).percent).toBe(42); // 84,000 / 200k
  });

  it("the ? line: tokens of the window, the reply's room, and on Claude the spend so far", () => {
    const r = meterReading(14_336, w32);
    expect(meterDetail(r, w32, null)).toBe("≈ 20,480 of 32,768 tokens, 6,144 of them kept for the reply.");
    const claude = contextWindow(on(CLAUDE, "claude-opus-5-5"));
    expect(meterDetail(meterReading(10_000, claude), claude, "$0.04")).toBe("≈ 74,000 of 1,000,000 tokens, 64,000 of them kept for the reply · $0.04 so far.");
    const cloud = contextWindow(on(OPENAI));
    expect(meterDetail(meterReading(9_812, cloud), cloud, null)).toBe("≈ 9,812 tokens for the next request; this model's window is not known here.");
  });

  it("the spend: on Claude only, at its price", () => {
    const usage = { input: 100_000, output: 10_000, cacheRead: 0, cacheWrite: 0, requests: 3, estimated: 0 };
    expect(conversationCost(on(CLAUDE, "claude-opus-5-5"), usage)).toBe("$0.60"); // 0.1M × $4 + 0.01M × $20
    expect(conversationCost(on(CLAUDE, "claude-opus-5-5"), null)).toBe("$0.00");
    expect(conversationCost(on(OLLAMA), usage)).toBeNull();
    expect(conversationCost(on(OPENAI), usage)).toBeNull();
  });
});

describe("what the meter measures is the loop's first request", () => {
  const ctx = { dataset: { id: "d" } as Dataset, datasets: [] } as ToolContext;
  const messages: ChatMessage[] = [
    { role: "system", content: "You are the Pilot." },
    { role: "user", content: "Context: the dataset." },
    { role: "assistant", content: "Understood." },
    { role: "user", content: "How clean is the ring removal?" },
  ];

  const firstRequest = async (settings: LlmSettings, c: ToolContext | null = ctx) => {
    const seen: { messages: ChatMessage[]; tools?: ToolSpec[] }[] = [];
    client.streamChat.mockImplementation((args: { messages: ChatMessage[]; tools?: ToolSpec[] }) => {
      seen.push({ messages: [...args.messages], tools: args.tools });
      return (async function* () {
        yield { content: "Done." };
      })();
    });
    await runAgent({ messages, tools: CHAT_TOOLS, ctx: c, settings, signal: new AbortController().signal, checkAnswers: false });
    return seen[0];
  };

  for (const [name, settings] of [
    ["Ollama (the tools a local question is offered)", on(OLLAMA, "g")],
    ["LM Studio", on(LM_STUDIO, "lm")],
    ["Claude (every tool)", on(CLAUDE, "claude-opus-5-5")],
  ] as const) {
    it(name, async () => {
      const sent = await firstRequest(settings);
      const specs = openingSpecs(messages, CHAT_TOOLS, ctx, settings);
      expect(specs).toEqual(sent.tools);
      expect(sent.messages).toEqual(messages);
      expect(requestTokens(messages, specs, settings)).toBe(estimateTokens(baseTokens(sent.messages, sent.tools), `${settings.baseUrl}|${settings.model}`));
    });
  }

  it("without a context, or Tools off: no tools, as the loop sends none", async () => {
    const s = on(OLLAMA, "g2");
    expect(openingSpecs(messages, CHAT_TOOLS, null, s)).toBeUndefined();
    expect((await firstRequest(s, null)).tools).toBeUndefined();
    expect(openingSpecs(messages, [], ctx, s)).toBeUndefined();
  });

  it("scaled by what the server counted, as the loop's window plan is", () => {
    const s = on(OLLAMA, "g3");
    const specs = openingSpecs(messages, CHAT_TOOLS, ctx, s);
    const base = baseTokens(messages, specs);
    observeTokens(`${s.baseUrl}|${s.model}`, base, Math.round(base * 1.3));
    expect(requestTokens(messages, specs, s)).toBe(Math.ceil(base * (Math.round(base * 1.3) / base)));
  });
});
