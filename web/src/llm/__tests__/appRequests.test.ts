// What the app sends each model server, byte for byte: a scripted reply in the
// console's chat (the agent loop on the console's settings, as session.ts asks
// it) and a tuning request (completeChat, as the tuner asks the console's
// model), on each transport: Claude through Anthropic's SDK, an
// OpenAI-compatible local server (LM Studio) and Ollama's own chat API. The
// bodies are pinned in __snapshots__/app-requests.json, written before the run
// policy (runPolicy.ts) existed: the policy and the validation's output cap
// change nothing the app sends.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { runAgent } from "../agent";
import { completeChat, type ChatMessage } from "../provider/client";
import { resetTokenState } from "../provider/tokens";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { CHAT_TOOLS, type AgentTool } from "../tools";
import { claudeServer, CLAUDE_URL, LM_STUDIO_URL, localServer, OLLAMA_URL, SDK, type Body, type Script } from "./scriptedTransports";

vi.mock("@anthropic-ai/sdk", async () => ({ default: (await import("./scriptedTransports")).SDK.Anthropic }));

const dataset: Dataset = { id: "d", temperature: null, raw_name: "d.nxs", stem: "d", stages: [] };
// Every tool the Pilot ships, by its own name (a local model is offered those
// its question is about), with a short definition and a stub: the bodies pin
// the request's form, not the tools' text (modelVisible.test.ts pins that).
const TOOLS: AgentTool[] = CHAT_TOOLS.map((t) => ({
  ...t,
  description: `${t.name}.`,
  parameters: { type: "object", properties: {} },
  run: async () => ({ result: { stub: t.name }, summary: `${t.name} stub` }),
}));
const messages: ChatMessage[] = [
  { role: "system", content: "You are the Pilot." },
  { role: "user", content: "Is the ring removal clean?" },
];

const script: Script = { sent: [] };

/** The console's settings on a server, as loadSettings gives them. */
const consoleSettings = (baseUrl: string, model: string, apiKey = ""): LlmSettings => ({ ...DEFAULT_SETTINGS, baseUrl, model, apiKey });

/** The bodies one reply in the console's chat sends, as session.ts asks it. */
async function chatReply(settings: LlmSettings, maxRounds?: number): Promise<Body[]> {
  script.sent = [];
  await runAgent({
    messages,
    tools: TOOLS,
    ctx: { dataset, datasets: [dataset] },
    settings,
    signal: new AbortController().signal,
    ...(maxRounds !== undefined ? { maxRounds } : {}),
  });
  return script.sent;
}

/** The body of one tuning request on the console's settings, as the tuner sends it (tune/tuner.ts, ask). */
async function tuningRequest(settings: LlmSettings): Promise<Body[]> {
  script.sent = [];
  await completeChat({
    baseUrl: settings.baseUrl,
    model: settings.model,
    messages: [{ role: "user", content: "Propose the next trial." }],
    temperature: settings.temperature,
    apiKey: settings.apiKey || undefined,
    signal: new AbortController().signal,
  });
  return script.sent;
}

beforeEach(() => {
  resetTokenState();
  SDK.stream.mockReset();
  SDK.create.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("what the app sends each model server", () => {
  it("is what it sent before the run policy, on every transport", async () => {
    claudeServer(SDK, script);
    localServer(script);
    const servers = {
      claude: consoleSettings(CLAUDE_URL, "claude-opus-5-5", "test-key"),
      lmstudio: consoleSettings(LM_STUDIO_URL, "lm"),
      ollama: consoleSettings(OLLAMA_URL, "gemma4:26b"),
    };
    const bodies: Record<string, { reply: Body[]; replyAtTheRoundCap: Body[]; tuning: Body[] }> = {};
    for (const [name, settings] of Object.entries(servers)) {
      bodies[name] = {
        reply: await chatReply(settings),
        // The last round asks for an answer without more calls (toolChoice "none").
        replyAtTheRoundCap: await chatReply(settings, 1),
        tuning: await tuningRequest(settings),
      };
    }
    for (const b of Object.values(bodies)) expect(b.reply).toHaveLength(2);
    await expect(`${JSON.stringify(bodies, null, 1)}\n`).toMatchFileSnapshot("__snapshots__/app-requests.json");
  });
});
