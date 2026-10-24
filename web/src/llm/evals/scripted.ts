// The CI replay's stand-ins.  A scripted model: an OpenAI-compatible chat
// server played from a fixed script, one turn per request, by intercepting
// fetch for its base URL.  Each turn streams as the local servers do (SSE
// deltas: text in pieces, tool calls with their JSON arguments, a finish
// reason, a usage chunk when asked for), or, to a request that reads the
// reply whole (a tuning run's), comes back in one JSON body with its counts,
// or fails as a server does; the same behind Ollama's own chat API
// (scriptedOllama).  A tuning run's model on the console's settings,
// content with the current settings.  And the app's tools answering from
// recorded results, so the replay needs no backend.

import { loadSettings, saveSettings } from "../settings";
import { toolsWhere, type AgentTool } from "../tools";

export interface ScriptTurn {
  text?: string;
  calls?: { name: string; args?: Record<string, unknown> }[];
  // The server fails the request instead, with this HTTP status and message
  // (one that cannot call tools: 400, "… does not support tools").
  fail?: { status: number; message: string };
  // The reply stops at its output limit (finish_reason "length").
  cut?: boolean;
  // The token counts the reply reports, in place of the script's own (from the
  // request's and the reply's lengths): a request at its hard bound, say.
  usage?: { input: number; output: number };
}

export const SCRIPTED_URL = "http://scripted.invalid/v1";

/** One request the scripted model answered, as it saw it. */
export interface ScriptedRequest {
  model: string; // the model it named
  stream: boolean; // false: the reply read whole (a tuning run's request)
  usage: { input: number; output: number } | null; // the counts the reply reported; null: none
  maxTokens: number | null; // the output cap it asked for (max_tokens); null: none
  messages: number; // how many messages it sent
  chars: number; // their text, in characters: what the token estimate reads (provider/tokens.ts)
}

export interface ScriptedModel {
  install: () => () => void; // returns the uninstall
  requests: () => number;
  overrun: () => number; // requests after the script ran out
  sent: () => string[]; // each request's last user message: what the app said to the model
  log: () => ScriptedRequest[]; // each request, in order
}

export function scriptedModel(turns: ScriptTurn[]): ScriptedModel {
  let next = 0;
  let requests = 0;
  let overrun = 0;
  const sent: string[] = [];
  const log: ScriptedRequest[] = [];
  const encoder = new TextEncoder();

  const respond = (body: string): Response => {
    requests += 1;
    let request: {
      model?: string;
      stream?: boolean;
      stream_options?: { include_usage?: boolean };
      max_tokens?: unknown;
      messages?: { role: string; content: unknown }[];
    } = {};
    try {
      request = JSON.parse(body);
      const last = [...(request.messages ?? [])].reverse().find((m) => m.role === "user");
      sent.push(typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? ""));
    } catch {
      sent.push("");
    }
    const messages = request.messages ?? [];
    const textOf = (content: unknown): string => (typeof content === "string" ? content : JSON.stringify(content ?? ""));
    const entry: ScriptedRequest = {
      model: String(request.model ?? ""),
      stream: request.stream !== false,
      usage: null,
      maxTokens: typeof request.max_tokens === "number" ? request.max_tokens : null,
      messages: messages.length,
      chars: messages.reduce((n, m) => n + textOf(m.content).length, 0),
    };
    log.push(entry);
    const turn = turns[next++];
    if (!turn) overrun += 1;
    if (turn?.fail) {
      return new Response(JSON.stringify({ error: { message: turn.fail.message } }), {
        status: turn.fail.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Past the script the model has nothing more to say: an empty reply (the
    // agent keeps the answer it had), counted as an overrun.
    const text = turn ? (turn.text ?? "") : "";
    const counts = turn?.usage
      ? { prompt_tokens: turn.usage.input, completion_tokens: turn.usage.output }
      : { prompt_tokens: Math.round(body.length / 4), completion_tokens: Math.round(text.length / 4) + 10 };
    // A reply read whole carries its counts unasked, as OpenAI's and LM Studio's do.
    if (!entry.stream) {
      entry.usage = { input: counts.prompt_tokens, output: counts.completion_tokens };
      const reply = { choices: [{ message: { role: "assistant", content: text }, finish_reason: turn?.cut ? "length" : "stop" }], usage: counts };
      return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
    }
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
    push({ choices: [{ delta: {}, finish_reason: turn?.cut ? "length" : turn?.calls?.length ? "tool_calls" : "stop" }] });
    if (request.stream_options?.include_usage) {
      entry.usage = { input: counts.prompt_tokens, output: counts.completion_tokens };
      push({ choices: [], usage: counts });
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
    sent: () => [...sent],
    log: () => log.map((r) => ({ ...r })),
  };
}

// The same kind of script behind Ollama's own chat API, as the app talks to a
// model at Ollama's port (provider/client.ts: isOllamaUrl, streamOllama): one
// JSON object a line, text in pieces, each tool call whole with its arguments
// as an object, and the counts on the last line; a reply read whole in one
// object. It answers /api/show (a model that supports tools, with
// `contextLength`) and /api/ps (none running), and anything else under its
// root with a 404, so no request reaches an Ollama on this machine.
export const SCRIPTED_OLLAMA_URL = "http://localhost:11434/v1";
const OLLAMA_ROOT = SCRIPTED_OLLAMA_URL.replace(/\/v1$/, "");

export interface ScriptedOllama extends Omit<ScriptedModel, "log"> {
  paths: () => string[]; // every request's path, in order
  offered: () => string[][]; // each chat request's tool names, as its body carried them
}

export function scriptedOllama(turns: ScriptTurn[], { contextLength = 65_536 }: { contextLength?: number } = {}): ScriptedOllama {
  let next = 0;
  let requests = 0;
  let overrun = 0;
  const sent: string[] = [];
  const paths: string[] = [];
  const offered: string[][] = [];
  const encoder = new TextEncoder();
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

  const chat = (body: string): Response => {
    requests += 1;
    let request: { model?: string; stream?: boolean; messages?: { role: string; content: unknown }[]; tools?: { function?: { name?: string } }[] } = {};
    try {
      request = JSON.parse(body);
    } catch {
      // not JSON: an empty request
    }
    const last = [...(request.messages ?? [])].reverse().find((m) => m.role === "user");
    sent.push(typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? ""));
    offered.push((request.tools ?? []).map((t) => String(t.function?.name ?? "")));
    const turn = turns[next++];
    if (!turn) overrun += 1;
    if (turn?.fail) return json({ error: turn.fail.message }, turn.fail.status);
    const text = turn ? (turn.text ?? "") : "";
    const counts = { prompt_eval_count: Math.round(body.length / 4), eval_count: Math.round(text.length / 4) + 10 };
    const message = (content: string, extra: object = {}) => ({ model: request.model, message: { role: "assistant", content, ...extra } });
    if (request.stream === false) return json({ ...message(text), done: true, done_reason: "stop", ...counts });
    const lines: unknown[] = (text.match(/[\s\S]{1,40}/g) ?? []).map((piece) => ({ ...message(piece), done: false }));
    if (turn?.calls?.length) {
      lines.push({ ...message("", { tool_calls: turn.calls.map((c) => ({ function: { name: c.name, arguments: c.args ?? {} } })) }), done: false });
    }
    lines.push({ ...message(""), done: true, done_reason: "stop", ...counts });
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const l of lines) controller.enqueue(encoder.encode(`${JSON.stringify(l)}\n`));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
    );
  };

  const respond = (path: string, body: string): Response => {
    paths.push(path);
    if (path === "/api/chat") return chat(body);
    if (path === "/api/show") return json({ model_info: { "gemma4.context_length": contextLength }, capabilities: ["completion", "tools"] });
    if (path === "/api/ps") return json({ models: [] });
    return json({ error: `no ${path} here` }, 404);
  };

  return {
    install: () => {
      const real = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(OLLAMA_ROOT)) return Promise.resolve(respond(new URL(url).pathname, String(init?.body ?? "{}")));
        return real(input, init);
      }) as typeof fetch;
      return () => {
        globalThis.fetch = real;
      };
    },
    requests: () => requests,
    overrun: () => overrun,
    sent: () => [...sent],
    paths: () => [...paths],
    offered: () => offered.map((names) => [...names]),
  };
}

// A tuning run asks its model for alternatives, not through the agent loop: in
// the app, and in a replay that calls tune_pipeline outside a validation run,
// the model on the console's settings (settings.ts); a validation run's tuning
// asks the run's own model (validationRun.ts). A model content with the
// current settings proposes none.
export const TUNER_URL = "http://tuner.invalid/v1";

/** Points the tuning run's model at one content with the current settings; returns the function that puts fetch and the settings back. */
export function contentTuner(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(TUNER_URL)) return real(input, init);
    const reply = { choices: [{ message: { content: JSON.stringify({ candidates: [], best: 1, why: "the current settings" }) } }] };
    return Promise.resolve(new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  const settings = loadSettings();
  saveSettings({ baseUrl: TUNER_URL, model: "content" });
  return () => {
    globalThis.fetch = real;
    saveSettings(settings);
  };
}

// run_log never touches the backend, but it reads the session's last pipeline
// run, and a replay has none: it answers from the recording, as the tools that
// read the backend do.
export const REPLAYED_THOUGH_LOCAL: readonly string[] = ["run_log"];

/**
 * The tools a replay runs as they are: those that never touch the backend (their
 * facts' `reachesBackend`): the skills, and the Configure page's settings (the
 * harness resets them per scenario); save REPLAYED_THOUGH_LOCAL.
 */
export const RUN_AS_THEY_ARE: readonly string[] = toolsWhere((f) => !f.reachesBackend).filter((name) => !REPLAYED_THOUGH_LOCAL.includes(name));

/** The app's tools, answering from results recorded as "<dataset>|<tool>|<args JSON>". */
export function replayTools(
  results: Record<string, string>,
  dataset: string,
  tools: AgentTool[],
  local: readonly string[] = RUN_AS_THEY_ARE,
): AgentTool[] {
  return tools.map((tool) => local.includes(tool.name) ? tool : ({
    ...tool,
    run: async (args) => {
      const key = `${dataset}|${tool.name}|${JSON.stringify(args)}`;
      const text = results[key];
      if (text === undefined) throw new Error(`no recording of ${key}`);
      return { result: JSON.parse(text) as unknown, summary: "replayed" };
    },
  }));
}
