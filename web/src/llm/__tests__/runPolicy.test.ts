// The run policy (runPolicy.ts): each transport's, field by field, against the
// constant or setting that decides it; which policy a base URL gets; and that
// the agent loop reads it and each transport sends what it says, through the
// real client against scripted servers (scriptedTransports.ts). What the app
// sends is pinned byte for byte in appRequests.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { KEEP_FULL, MAX_TOOL_ROUNDS, runAgent, SOFT_BUDGET } from "../agent";
import { toolsFor } from "../localTools";
import { COMPLETE_MAX_TOKENS, STREAM_MAX_TOKENS } from "../provider/anthropic";
import { completeChat, type ChatMessage } from "../provider/client";
import { MIN_REPLY, REPLY_RESERVE, resetTokenState } from "../provider/tokens";
import { RUN_POLICIES, runPolicyOf, transportOf, type RunPolicy } from "../runPolicy";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { CHAT_TOOLS, type AgentTool } from "../tools";
import { claudeServer, CLAUDE_URL, LM_STUDIO_URL, localServer, OLLAMA_URL, SDK, type Body, type Script } from "./scriptedTransports";

vi.mock("@anthropic-ai/sdk", async () => ({ default: (await import("./scriptedTransports")).SDK.Anthropic }));

const OPENAI_URL = "https://api.openai.com/v1";

describe("each transport's policy", () => {
  it("is read from the constants that decide it", () => {
    const local = { softBudget: SOFT_BUDGET, keepFull: KEEP_FULL };
    expect(RUN_POLICIES.claude).toEqual({
      transport: "anthropic",
      local: false,
      maxRounds: MAX_TOOL_ROUNDS,
      toolScoping: "all",
      pruning: null,
      temperature: null, // the transport sends none (anthropic.ts, requestBody)
      outputCap: { loop: STREAM_MAX_TOKENS, tuning: COMPLETE_MAX_TOKENS },
      reasoningReplay: true,
      window: { plan: "none", replyReserve: null, minReply: null },
    });
    expect(RUN_POLICIES.lmStudio).toEqual({
      transport: "openai-compatible",
      local: true,
      maxRounds: MAX_TOOL_ROUNDS,
      toolScoping: "question",
      pruning: local,
      temperature: DEFAULT_SETTINGS.temperature,
      outputCap: { loop: null, tuning: null },
      reasoningReplay: false,
      window: { plan: "loaded", replyReserve: null, minReply: MIN_REPLY },
    });
    expect(RUN_POLICIES.ollama).toEqual({
      transport: "ollama",
      local: true,
      maxRounds: MAX_TOOL_ROUNDS,
      toolScoping: "question",
      pruning: local,
      temperature: DEFAULT_SETTINGS.temperature,
      outputCap: { loop: null, tuning: null },
      reasoningReplay: false,
      window: { plan: "sized", replyReserve: REPLY_RESERVE, minReply: MIN_REPLY },
    });
    expect(RUN_POLICIES.openAiCloud).toEqual({
      transport: "openai-compatible",
      local: false,
      maxRounds: MAX_TOOL_ROUNDS,
      toolScoping: "all",
      pruning: null,
      temperature: DEFAULT_SETTINGS.temperature,
      outputCap: { loop: null, tuning: null },
      reasoningReplay: false,
      window: { plan: "none", replyReserve: null, minReply: null },
    });
  });

  it("is the one a base URL gets, with the settings' temperature where the transport sends one", () => {
    const on = (baseUrl: string, temperature: number | null = DEFAULT_SETTINGS.temperature) => runPolicyOf({ baseUrl, temperature });
    expect(on(CLAUDE_URL)).toEqual(RUN_POLICIES.claude);
    expect(on(LM_STUDIO_URL)).toEqual(RUN_POLICIES.lmStudio);
    expect(on(OLLAMA_URL)).toEqual(RUN_POLICIES.ollama);
    expect(on("http://127.0.0.1:11434/v1")).toEqual(RUN_POLICIES.ollama);
    expect(on(OPENAI_URL)).toEqual(RUN_POLICIES.openAiCloud);
    expect(on("https://generativelanguage.googleapis.com/v1beta/openai")).toEqual(RUN_POLICIES.openAiCloud);
    // Claude takes no temperature, whatever the settings say; the others the settings'.
    expect(on(CLAUDE_URL, 0.7).temperature).toBeNull();
    expect(on(LM_STUDIO_URL, 0.7).temperature).toBe(0.7);
    expect(on(OLLAMA_URL, null).temperature).toBeNull();
    // An Ollama server off this machine is sized as Ollama, and offered every tool, unpruned, as a cloud model is.
    expect(on("http://gpu-box:11434/v1")).toEqual({ ...RUN_POLICIES.ollama, local: false, toolScoping: "all", pruning: null });
    expect([CLAUDE_URL, LM_STUDIO_URL, OLLAMA_URL, OPENAI_URL].map(transportOf)).toEqual(["anthropic", "openai-compatible", "ollama", "openai-compatible"]);
  });
});

// ---------------------------------------------------------------- what goes over the wire

const dataset: Dataset = { id: "d", temperature: null, raw_name: "d.nxs", stem: "d", stages: [] };
const TOOLS: AgentTool[] = CHAT_TOOLS.map((t) => ({
  ...t,
  description: `${t.name}.`,
  parameters: { type: "object", properties: {} },
  run: async () => ({ result: { stub: t.name }, summary: `${t.name} stub` }),
}));
const QUESTION = "Is the ring removal clean?";
const messages: ChatMessage[] = [
  { role: "system", content: "You are the Pilot." },
  { role: "user", content: QUESTION },
];
const SERVERS: Record<"claude" | "lmStudio" | "ollama", LlmSettings> = {
  claude: { ...DEFAULT_SETTINGS, baseUrl: CLAUDE_URL, model: "claude-opus-5-5", apiKey: "test-key" },
  lmStudio: { ...DEFAULT_SETTINGS, baseUrl: LM_STUDIO_URL, model: "lm" },
  ollama: { ...DEFAULT_SETTINGS, baseUrl: OLLAMA_URL, model: "gemma4:26b" },
};

let script: Script;
async function reply(settings: LlmSettings, policy?: RunPolicy) {
  script.sent = [];
  const cut: { request: number; reason: string }[] = [];
  const result = await runAgent({
    messages,
    tools: TOOLS,
    ctx: { dataset, datasets: [dataset] },
    settings,
    ...(policy ? { policy } : {}),
    signal: new AbortController().signal,
    onTruncated: (c) => cut.push(c),
  });
  return { sent: script.sent, cut, result };
}

// What each transport's request carries of the policy.
const capOf = (body: Body): number | null =>
  ((body.max_tokens ?? (body.options as { num_predict?: number } | undefined)?.num_predict) as number | undefined) ?? null;
const temperatureOf = (body: Body): number | null =>
  ((body.temperature ?? (body.options as { temperature?: number } | undefined)?.temperature) as number | undefined) ?? null;
const toolNames = (body: Body): string[] =>
  ((body.tools as { name?: string; function?: { name: string } }[] | undefined) ?? []).map((t) => t.function?.name ?? t.name ?? "");
// The assistant turn that called the tool, as the second request sends it back.
const replayed = (body: Body): unknown =>
  (body.messages as { role: string }[]).find((m) => m.role === "assistant");

beforeEach(() => {
  resetTokenState();
  SDK.stream.mockReset();
  SDK.create.mockReset();
  script = { sent: [] };
  claudeServer(SDK, script);
  localServer(script);
});
afterEach(() => vi.unstubAllGlobals());

describe("each transport sends what its policy says", () => {
  it.each(["claude", "lmStudio", "ollama"] as const)("%s: the tools, the temperature, the output cap, the thinking sent back and the window", async (name) => {
    const policy = RUN_POLICIES[name];
    const { sent } = await reply(SERVERS[name]);
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(toolNames(body)).toEqual(
        (policy.toolScoping === "question" ? toolsFor(QUESTION, TOOLS) : TOOLS).map((t) => t.name),
      );
      expect(temperatureOf(body)).toBe(policy.temperature);
      expect(capOf(body)).toBe(policy.outputCap.loop);
      // Ollama alone is asked for a context length: its window is sized.
      expect((body.options as { num_ctx?: number } | undefined)?.num_ctx !== undefined).toBe(policy.window.plan === "sized");
    }
    // The thinking goes back with the turn that called a tool (Claude's own blocks), or not at all.
    expect(JSON.stringify(replayed(sent[1])).includes("Look first.")).toBe(policy.reasoningReplay);
    // The tuning's request: its cap, as the policy says.
    script.sent = [];
    const s = SERVERS[name];
    await completeChat({ baseUrl: s.baseUrl, model: s.model, messages: [{ role: "user", content: "go" }], temperature: s.temperature, apiKey: s.apiKey || undefined });
    expect(capOf(script.sent[0])).toBe(policy.outputCap.tuning);
  });

  it("reads the round limit and the output cap of the policy it is given, on every transport", async () => {
    for (const name of ["claude", "lmStudio", "ollama"] as const) {
      const policy: RunPolicy = { ...runPolicyOf(SERVERS[name]), maxRounds: 1, outputCap: { loop: 16_000, tuning: 16_000 } };
      const { sent } = await reply(SERVERS[name], policy);
      expect(sent.map(capOf)).toEqual([16_000, 16_000]);
      // Its one round spent, the last request asks for an answer: no tool_choice is "auto" there.
      const last = sent[1];
      expect(last.tool_choice ?? (last.tools ? "auto" : "none")).toEqual(name === "claude" ? { type: "none" } : "none");
    }
  });

  it("reports each request cut at the output limit, by its number and the server's reason, on every transport", async () => {
    script.cut = true;
    const reasons = { claude: "max_tokens", lmStudio: "length", ollama: "length" };
    for (const name of ["claude", "lmStudio", "ollama"] as const) {
      const { cut, result } = await reply(SERVERS[name]);
      expect(cut).toEqual([{ request: 2, reason: reasons[name] }]);
      // Each transport keeps its own handling of the cut: a local server's ends the reply
      // with the cut-off note; Claude's answer stands, as it ships.
      expect(result.note ?? "").toMatch(name === "claude" ? /^$/ : /cut off/);
    }
    // None cut, none reported.
    script.cut = false;
    expect((await reply(SERVERS.lmStudio)).cut).toEqual([]);
  });
});
