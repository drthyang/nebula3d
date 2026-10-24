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

const sdk = vi.hoisted(() => {
  class APIError extends Error {}
  class APIConnectionError extends APIError {}
  class APIUserAbortError extends APIError {}
  const stream = vi.fn();
  const create = vi.fn();
  class Anthropic {
    static APIError = APIError;
    static APIConnectionError = APIConnectionError;
    static APIUserAbortError = APIUserAbortError;
    beta = { messages: { stream, create } };
    models = { list: vi.fn() };
  }
  return { Anthropic, stream, create };
});
vi.mock("@anthropic-ai/sdk", () => ({ default: sdk.Anthropic }));

const CLAUDE = "https://api.anthropic.com";
const LM_STUDIO = "http://localhost:1234/v1";
const OLLAMA = "http://localhost:11434/v1";

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

type Body = Record<string, unknown>;
let sent: Body[] = [];

// The assistant turns that called tools in a request: the round it answers.
const roundOf = (body: Body): number =>
  ((body.messages as { role: string; tool_calls?: unknown; content?: unknown }[]) ?? []).filter(
    (m) => m.role === "assistant" && (m.tool_calls || (Array.isArray(m.content) && m.content.some((b: { type?: string }) => b.type === "tool_use"))),
  ).length;

const sse = (...chunks: unknown[]): Response =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
const ndjson = (...lines: unknown[]): Response => new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));

// A local server: LM Studio's model list, Ollama's /api/show and /api/ps, and
// each chat request: a tool call with its thinking first, then the answer.
function localServer(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v0/models")) {
        return new Response(JSON.stringify({ data: [{ id: "lm", state: "loaded", loaded_context_length: 65_536, max_context_length: 131_072 }] }));
      }
      if (url.endsWith("/api/show")) return new Response(JSON.stringify({ model_info: { "gemma4.context_length": 131_072 } }));
      if (url.endsWith("/api/ps")) return new Response(JSON.stringify({ models: [] }));
      const body = JSON.parse(String(init?.body)) as Body;
      sent.push(body);
      const round = roundOf(body);
      if (url.endsWith("/chat/completions")) {
        if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: '{"best": 1}' }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 5 } }));
        if (round === 0) {
          return sse(
            { choices: [{ delta: { reasoning_content: "Look first." } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "describe_dataset", arguments: "{}" } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
            { choices: [], usage: { prompt_tokens: 900, completion_tokens: 20 } },
          );
        }
        return sse({ choices: [{ delta: { content: "Done." } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 950, completion_tokens: 3 } });
      }
      // Ollama's /api/chat
      if (!body.stream) return new Response(JSON.stringify({ message: { content: '{"best": 1}' }, done: true, done_reason: "stop", prompt_eval_count: 50, eval_count: 5 }));
      if (round === 0) {
        return ndjson(
          { message: { thinking: "Look first." } },
          { message: { tool_calls: [{ function: { name: "describe_dataset", arguments: {} } }] } },
          { done: true, done_reason: "stop", prompt_eval_count: 900, eval_count: 20 },
        );
      }
      return ndjson({ message: { content: "Done." } }, { done: true, done_reason: "stop", prompt_eval_count: 950, eval_count: 3 });
    }),
  );
}

// Claude: each streamed turn's body; a tool call with its thinking first, then the answer.
const fakeStream = (events: object[], message: object) => ({
  async *[Symbol.asyncIterator]() {
    for (const e of events) yield e;
  },
  finalMessage: async () => message,
});
function claudeServer(): void {
  const usage = { input_tokens: 900, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  sdk.stream.mockImplementation((body: Body) => {
    sent.push(structuredClone(body));
    if (roundOf(body) === 0) {
      const content = [
        { type: "thinking", thinking: "Look first.", signature: "sig" },
        { type: "tool_use", id: "tu1", name: "describe_dataset", input: {} },
      ];
      return fakeStream([{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Look first." } }], { content, stop_reason: "tool_use", usage });
    }
    return fakeStream([{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } }], {
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
      usage,
    });
  });
  sdk.create.mockImplementation(async (body: Body) => {
    sent.push(structuredClone(body));
    return { content: [{ type: "text", text: '{"best": 1}' }], stop_reason: "end_turn", usage };
  });
}

/** The console's settings on a server, as loadSettings gives them. */
const consoleSettings = (baseUrl: string, model: string, apiKey = ""): LlmSettings => ({ ...DEFAULT_SETTINGS, baseUrl, model, apiKey });

/** The bodies one reply in the console's chat sends, as session.ts asks it. */
async function chatReply(settings: LlmSettings, maxRounds?: number): Promise<Body[]> {
  sent = [];
  await runAgent({
    messages,
    tools: TOOLS,
    ctx: { dataset, datasets: [dataset] },
    settings,
    signal: new AbortController().signal,
    ...(maxRounds !== undefined ? { maxRounds } : {}),
  });
  return sent;
}

/** The body of one tuning request on the console's settings, as the tuner sends it (tune/tuner.ts, ask). */
async function tuningRequest(settings: LlmSettings): Promise<Body[]> {
  sent = [];
  await completeChat({
    baseUrl: settings.baseUrl,
    model: settings.model,
    messages: [{ role: "user", content: "Propose the next trial." }],
    temperature: settings.temperature,
    apiKey: settings.apiKey || undefined,
    signal: new AbortController().signal,
  });
  return sent;
}

beforeEach(() => {
  resetTokenState();
  sdk.stream.mockReset();
  sdk.create.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("what the app sends each model server", () => {
  it("is what it sent before the run policy, on every transport", async () => {
    claudeServer();
    localServer();
    const servers = {
      claude: consoleSettings(CLAUDE, "claude-opus-5-5", "test-key"),
      lmstudio: consoleSettings(LM_STUDIO, "lm"),
      ollama: consoleSettings(OLLAMA, "gemma4:26b"),
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
