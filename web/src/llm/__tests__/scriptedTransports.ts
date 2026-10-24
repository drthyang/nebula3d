// Scripted model servers on each transport the client speaks, for the tests
// that drive the agent loop, or a tuning request, through the real client and
// read what goes over the wire (appRequests.test.ts, runPolicy.test.ts,
// evals/validationCap.test.ts): Claude through Anthropic's SDK (mocked by the
// test file, handed in), an OpenAI-compatible local server (LM Studio: its
// model list, then SSE) and Ollama's own chat API (/api/show, /api/ps, then a
// JSON object a line). Each records every chat request's body. A reply first
// calls a tool, with its thinking, then answers; `cut` stops the answer at
// the output limit (Claude's "max_tokens", the others' "length"), and
// `tuningCut` a request read whole (a tuning run's) the same way.

import { vi, type Mock } from "vitest";

export type Body = Record<string, unknown>;

export interface Script {
  sent: Body[]; // each chat request's body, in order
  cut?: boolean; // the answer stops at the output limit
  tuningCut?: boolean; // a request read whole stops at the output limit
  tool?: string | null; // the tool the first round calls (default describe_dataset); null: it answers at once
}

export const CLAUDE_URL = "https://api.anthropic.com";
export const LM_STUDIO_URL = "http://localhost:1234/v1";
export const OLLAMA_URL = "http://localhost:11434/v1";

/** The assistant turns that called tools in a request's messages: the round it answers. */
export const roundOf = (body: Body): number =>
  ((body.messages as { role: string; tool_calls?: unknown; content?: unknown }[]) ?? []).filter(
    (m) => m.role === "assistant" && (m.tool_calls || (Array.isArray(m.content) && m.content.some((b: { type?: string }) => b.type === "tool_use"))),
  ).length;

const sse = (...chunks: unknown[]): Response =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
const ndjson = (...lines: unknown[]): Response => new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));

// The tool the first round calls, as the script says when the request comes.
const toolOf = (script: Script): string | null => (script.tool === undefined ? "describe_dataset" : script.tool);

/** LM Studio (loaded with a 64k context) and Ollama (a 128k model, none running), on this machine. */
export function localServer(script: Script): void {
  const stop = (cut?: boolean) => (cut ? "length" : "stop");
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
      script.sent.push(body);
      const round = roundOf(body);
      const tool = toolOf(script);
      if (url.endsWith("/chat/completions")) {
        if (!body.stream) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: '{"best": 1}' }, finish_reason: stop(script.tuningCut) }], usage: { prompt_tokens: 50, completion_tokens: 5 } }),
          );
        }
        if (round === 0 && tool) {
          return sse(
            { choices: [{ delta: { reasoning_content: "Look first." } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: tool, arguments: "{}" } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
            { choices: [], usage: { prompt_tokens: 900, completion_tokens: 20 } },
          );
        }
        return sse(
          { choices: [{ delta: { content: "Done." } }] },
          { choices: [{ delta: {}, finish_reason: stop(script.cut) }] },
          { choices: [], usage: { prompt_tokens: 950, completion_tokens: 3 } },
        );
      }
      // Ollama's /api/chat
      if (!body.stream) {
        return new Response(
          JSON.stringify({ message: { content: '{"best": 1}' }, done: true, done_reason: stop(script.tuningCut), prompt_eval_count: 50, eval_count: 5 }),
        );
      }
      if (round === 0 && tool) {
        return ndjson(
          { message: { thinking: "Look first." } },
          { message: { tool_calls: [{ function: { name: tool, arguments: {} } }] } },
          { done: true, done_reason: "stop", prompt_eval_count: 900, eval_count: 20 },
        );
      }
      return ndjson({ message: { content: "Done." } }, { done: true, done_reason: stop(script.cut), prompt_eval_count: 950, eval_count: 3 });
    }),
  );
}

const fakeStream = (events: object[], message: object) => ({
  async *[Symbol.asyncIterator]() {
    for (const e of events) yield e;
  },
  finalMessage: async () => message,
});

/** Claude through the test file's mock of Anthropic's SDK: each streamed turn's body, and each turn read whole. */
export function claudeServer(sdk: { stream: Mock; create: Mock }, script: Script): void {
  const usage = { input_tokens: 900, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  sdk.stream.mockImplementation((body: Body) => {
    script.sent.push(structuredClone(body));
    const tool = toolOf(script);
    if (roundOf(body) === 0 && tool) {
      const content = [
        { type: "thinking", thinking: "Look first.", signature: "sig" },
        { type: "tool_use", id: "tu1", name: tool, input: {} },
      ];
      return fakeStream([{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Look first." } }], { content, stop_reason: "tool_use", usage });
    }
    return fakeStream([{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } }], {
      content: [{ type: "text", text: "Done." }],
      stop_reason: script.cut ? "max_tokens" : "end_turn",
      usage,
    });
  });
  sdk.create.mockImplementation(async (body: Body) => {
    script.sent.push(structuredClone(body));
    return { content: [{ type: "text", text: '{"best": 1}' }], stop_reason: script.tuningCut ? "max_tokens" : "end_turn", usage };
  });
}

/**
 * A stand-in for Anthropic's SDK, one per test file: the file mocks the SDK
 * with it,
 *   vi.mock("@anthropic-ai/sdk", async () => ({ default: (await import("./scriptedTransports")).SDK.Anthropic }));
 * and hands it to claudeServer.
 */
export const SDK = (() => {
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
})();
