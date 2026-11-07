// An auto reply's seeded checks on each transport (auto/transport.ts,
// agent.ts's seed), read off the wire: as a round of tool calls the app made
// on the transports that take one (LM Studio, Ollama's own chat API, Claude
// on a model without adaptive thinking), and in the phase message on those
// that refuse one (Claude with adaptive thinking, whose turn of calls must
// open with the model's own thinking block; Gemini). A transport that
// refuses the round all the same gets the same request again with the
// message form, once, and the run keeps it. Either way the seeded steps are
// the reply's own first steps.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { runAgent, type AgentStep, type SeedForm } from "../agent";
import { seedFormFor } from "../auto/transport";
import type { ChatMessage } from "../provider/client";
import { resetTokenState } from "../provider/tokens";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { CHAT_TOOLS, type AgentTool } from "../tools";
import { claudeServer, CLAUDE_URL, LM_STUDIO_URL, localServer, OLLAMA_URL, SDK, type Body, type Script } from "./scriptedTransports";

vi.mock("@anthropic-ai/sdk", async () => ({ default: (await import("./scriptedTransports")).SDK.Anthropic }));

const dataset: Dataset = { id: "d", temperature: null, raw_name: "d.nxs", stem: "d", stages: [] };
const TOOLS: AgentTool[] = CHAT_TOOLS.map((t) => ({
  ...t,
  description: `${t.name}.`,
  parameters: { type: "object", properties: {} },
  run: async () => ({ result: { stub: t.name }, summary: `${t.name} stub` }),
}));
const PROMPT = "Change or tune the Bragg punch so its check above passes.";
const messages: ChatMessage[] = [
  { role: "system", content: "You are the Pilot." },
  { role: "user", content: "Context: the dataset." },
  { role: "assistant", content: "Understood." },
  { role: "user", content: PROMPT },
];
const SEED: AgentStep[] = [
  { id: "auto:1", name: "assess_stage", args: { stage: "punch" }, status: "done", summary: "needs attention", result: '{"punch":{"verdict":"needs attention","leftover_at_nodes":1}}' },
  { id: "auto:2", name: "texture_check", args: {}, status: "done", summary: "no bias", result: '{"verdict":"no systematic fill bias"}' },
];
const SEEDED_TEXT =
  'Checks already run for this request, as tool calls (each result as its tool returned it):\n\n[step 1] assess_stage {"stage":"punch"}\n{"punch":{"verdict":"needs attention","leftover_at_nodes":1}}\n\n[step 2] texture_check {}\n{"verdict":"no systematic fill bias"}\n\n' +
  PROMPT;

const script: Script = { sent: [] };
const settingsOn = (baseUrl: string, model: string): LlmSettings => ({ ...DEFAULT_SETTINGS, baseUrl, model, apiKey: "k", followViews: false });

async function reply(settings: LlmSettings, form = seedFormFor(settings)) {
  script.sent = [];
  const forms: SeedForm[] = [];
  const result = await runAgent({
    messages,
    tools: TOOLS,
    ctx: { dataset, datasets: [dataset] },
    settings,
    signal: new AbortController().signal,
    userMessage: "",
    seed: { steps: SEED, form },
    onSeedForm: (f) => forms.push(f),
    checkAnswers: false,
  });
  return { result, sent: script.sent as Body[], forms };
}

type Msg = { role: string; content?: unknown; tool_calls?: { id?: string; function: { name: string; arguments: unknown } }[]; tool_call_id?: string };
const msgs = (b: Body): Msg[] => b.messages as Msg[];

beforeEach(() => {
  resetTokenState();
  SDK.stream.mockReset();
  SDK.create.mockReset();
  script.tool = null; // the server answers at once
});
afterEach(() => vi.unstubAllGlobals());

describe("the seed form, transport by transport", () => {
  it("is the message on Claude with adaptive thinking and on Gemini, a round of calls elsewhere", () => {
    expect(seedFormFor(settingsOn(CLAUDE_URL, "claude-opus-5-5"))).toBe("message");
    expect(seedFormFor(settingsOn(CLAUDE_URL, "claude-sonnet-5-5"))).toBe("message");
    expect(seedFormFor(settingsOn(CLAUDE_URL, "claude-haiku-4-5"))).toBe("round");
    expect(seedFormFor(settingsOn("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3-pro"))).toBe("message");
    expect(seedFormFor(settingsOn(LM_STUDIO_URL, "lm"))).toBe("round");
    expect(seedFormFor(settingsOn(OLLAMA_URL, "gemma4:26b"))).toBe("round");
    expect(seedFormFor(settingsOn("https://api.openai.com/v1", "gpt-5"))).toBe("round");
    // Once a refusal found the form, the run keeps it.
    expect(seedFormFor(settingsOn(LM_STUDIO_URL, "lm"), "message")).toBe("message");
  });
});

describe("on the wire", () => {
  it("Claude with adaptive thinking: the checks in the phase message, no turn of calls the model did not make", async () => {
    claudeServer(SDK, script);
    const { result, sent } = await reply(settingsOn(CLAUDE_URL, "claude-opus-5-5"));
    const body = sent[0] as { messages: { role: string; content: unknown }[] };
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(body.messages[2].content).toBe(SEEDED_TEXT);
    expect(JSON.stringify(body.messages)).not.toContain("tool_use");
    expect(result.steps.map((s) => [s.id, s.name])).toEqual([
      ["0:seed_1", "assess_stage"],
      ["1:seed_2", "texture_check"],
    ]);
  });

  it("Claude without adaptive thinking: a turn of tool_use blocks and their results", async () => {
    claudeServer(SDK, script);
    const { result, sent } = await reply(settingsOn(CLAUDE_URL, "claude-haiku-4-5"));
    const body = sent[0] as { messages: { role: string; content: { type: string; id?: string; tool_use_id?: string }[] | string }[] };
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(body.messages[2].content).toBe(PROMPT);
    expect((body.messages[3].content as { type: string; id?: string }[]).map((b) => [b.type, b.id])).toEqual([
      ["tool_use", "seed_1"],
      ["tool_use", "seed_2"],
    ]);
    expect((body.messages[4].content as { tool_use_id?: string }[]).map((b) => b.tool_use_id)).toEqual(["seed_1", "seed_2"]);
    expect(result.steps).toHaveLength(2);
  });

  for (const [name, url] of [
    ["LM Studio", LM_STUDIO_URL],
    ["Ollama", OLLAMA_URL],
  ] as const) {
    it(`${name}: an assistant turn of the app's calls after the prompt, then their results`, async () => {
      localServer(script);
      const { result, sent } = await reply(settingsOn(url, url === OLLAMA_URL ? "gemma4:26b" : "lm"));
      const m = msgs(sent[0]);
      expect(m.map((x) => x.role)).toEqual(["system", "user", "assistant", "user", "assistant", "tool", "tool"]);
      expect(m[3].content).toBe(PROMPT);
      expect(m[4].tool_calls!.map((c) => c.function.name)).toEqual(["assess_stage", "texture_check"]);
      expect(m[5].content).toBe(SEED[0].result);
      expect(m[6].content).toBe(SEED[1].result);
      if (url === LM_STUDIO_URL) expect(m.slice(5).map((x) => x.tool_call_id)).toEqual(["seed_1", "seed_2"]);
      expect(result.steps.map((s) => s.id)).toEqual(["0:seed_1", "1:seed_2"]);
      expect(result.content).toBe("Done.");
    });
  }
});

describe("the fallback", () => {
  it("an OpenAI-compatible server that refuses the round gets the message form, once, and the reply says so", async () => {
    localServer(script);
    const served = globalThis.fetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    let refused = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Body) : null;
      if (body?.stream && msgs(body).some((x) => x.tool_calls?.some((c) => c.id?.startsWith("seed_")))) {
        refused += 1;
        script.sent.push(body);
        return new Response(JSON.stringify({ error: { message: "tool_calls with no matching call from the model" } }), { status: 400 });
      }
      return served(input, init);
    });
    const { result, sent, forms } = await reply(settingsOn(LM_STUDIO_URL, "lm"), "round");
    // Refused (asked again by the client without stream_options, refused again), then in the message form.
    expect(refused).toBeGreaterThan(0);
    expect(forms).toEqual(["message"]);
    const after = sent.slice(refused);
    expect(after).toHaveLength(1);
    expect(msgs(after[0]).map((x) => x.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs(after[0])[3].content).toBe(SEEDED_TEXT);
    expect(result.steps.map((s) => s.id)).toEqual(["0:seed_1", "1:seed_2"]);
    expect(result.content).toBe("Done.");
  });

  it("Claude refusing a turn of calls with no thinking block (the round forced): the message form after the refusal", async () => {
    claudeServer(SDK, script);
    const answer = SDK.stream.getMockImplementation()!;
    SDK.stream.mockImplementation((body: Body) => {
      const last = [...(body.messages as { role: string; content: unknown }[])].reverse().find((m) => m.role === "assistant");
      if (Array.isArray(last?.content) && last.content[0]?.type === "tool_use") {
        script.sent.push(structuredClone(body));
        const e = new SDK.Anthropic.APIError("thinking block required") as Error & { status?: number; error?: unknown };
        e.status = 400;
        e.error = { error: { message: "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `tool_use`." } };
        throw e;
      }
      return answer(body);
    });
    const { result, sent, forms } = await reply(settingsOn(CLAUDE_URL, "claude-opus-5-5"), "round");
    expect(forms).toEqual(["message"]);
    expect(sent).toHaveLength(2);
    expect((sent[1] as { messages: { content: unknown }[] }).messages[2].content).toBe(SEEDED_TEXT);
    expect(result.steps).toHaveLength(2);
  });
});
