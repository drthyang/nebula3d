// The CI replay's stand-ins.  A scripted model: an OpenAI-compatible chat
// server played from a fixed script, one turn per request, by intercepting
// fetch for its base URL.  Each turn streams as the local servers do (SSE
// deltas: text in pieces, tool calls with their JSON arguments, a finish
// reason, a usage chunk when asked for).  And the app's tools answering from
// recorded results, so the replay needs no backend.

import type { AgentTool } from "../tools";

export interface ScriptTurn {
  text?: string;
  calls?: { name: string; args?: Record<string, unknown> }[];
}

export const SCRIPTED_URL = "http://scripted.invalid/v1";

export interface ScriptedModel {
  install: () => () => void; // returns the uninstall
  requests: () => number;
  overrun: () => number; // requests after the script ran out
}

export function scriptedModel(turns: ScriptTurn[]): ScriptedModel {
  let next = 0;
  let requests = 0;
  let overrun = 0;
  const encoder = new TextEncoder();

  const respond = (body: string): Response => {
    requests += 1;
    const turn = turns[next++];
    if (!turn) overrun += 1;
    const text = turn ? (turn.text ?? "") : "(the script ran out)";
    const chunks: string[] = [];
    const push = (o: unknown) => chunks.push(`data: ${JSON.stringify(o)}\n\n`);
    for (const piece of text.match(/[\s\S]{1,40}/g) ?? []) push({ choices: [{ delta: { content: piece } }] });
    (turn?.calls ?? []).forEach((c, i) =>
      push({
        choices: [
          {
            delta: {
              tool_calls: [{ index: i, id: `call_${requests}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }],
            },
          },
        ],
      }),
    );
    push({ choices: [{ delta: {}, finish_reason: turn?.calls?.length ? "tool_calls" : "stop" }] });
    const request = JSON.parse(body) as { stream_options?: { include_usage?: boolean } };
    if (request.stream_options?.include_usage) {
      push({ choices: [], usage: { prompt_tokens: Math.round(body.length / 4), completion_tokens: Math.round(text.length / 4) + 10 } });
    }
    chunks.push("data: [DONE]\n\n");
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };

  return {
    install: () => {
      const real = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(SCRIPTED_URL)) return Promise.resolve(respond(String(init?.body ?? "{}")));
        return real(input, init);
      }) as typeof fetch;
      return () => {
        globalThis.fetch = real;
      };
    },
    requests: () => requests,
    overrun: () => overrun,
  };
}

/** The app's tools, answering from results recorded as "<dataset>|<tool>|<args JSON>". */
export function replayTools(results: Record<string, string>, dataset: string, tools: AgentTool[]): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    run: async (args) => {
      const key = `${dataset}|${tool.name}|${JSON.stringify(args)}`;
      const text = results[key];
      if (text === undefined) throw new Error(`no recording of ${key}`);
      return { result: JSON.parse(text) as unknown, summary: "replayed" };
    },
  }));
}
