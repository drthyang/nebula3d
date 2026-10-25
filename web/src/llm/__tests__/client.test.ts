// The provider client's function-calling path: tool calls assembled from the
// shapes real servers stream (OpenAI fragments by index, Ollama whole calls,
// servers without an index), the request body, and the "no tools" error test.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeChat,
  contextWarning,
  isMalformedOutput,
  isToolsUnsupported,
  loadedContext,
  stoppedAtLimit,
  streamChat,
  ToolCallAssembler,
  type HttpError,
  type StreamDelta,
  withContextHint,
} from "../provider/client";
import { StallError } from "../recovery";

const sse = (chunks: string[]): Response => {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
};
const line = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n`;

afterEach(() => vi.unstubAllGlobals());

describe("ToolCallAssembler", () => {
  it("joins OpenAI-style argument fragments by index", () => {
    const a = new ToolCallAssembler();
    a.add({ index: 0, id: "call_a", function: { name: "measure_reciprocal_cut", arguments: "" } });
    a.add({ index: 0, function: { arguments: '{"plane":' } });
    a.add({ index: 1, id: "call_b", function: { name: "describe_dataset", arguments: "{}" } });
    a.add({ index: 0, function: { arguments: '"h0l","value":0}' } });
    expect(a.calls()).toEqual([
      { id: "call_a", type: "function", function: { name: "measure_reciprocal_cut", arguments: '{"plane":"h0l","value":0}' } },
      { id: "call_b", type: "function", function: { name: "describe_dataset", arguments: "{}" } },
    ]);
  });

  it("takes whole calls with object arguments and no index (Ollama-style)", () => {
    const a = new ToolCallAssembler();
    a.add({ id: "x1", function: { name: "bragg_peaks", arguments: { limit: 3 } } });
    a.add({ id: "x2", function: { name: "current_view", arguments: {} } });
    const calls = a.calls();
    expect(calls.map((c) => c.function.name)).toEqual(["bragg_peaks", "current_view"]);
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ limit: 3 });
  });

  it("appends an id-less fragment to the last call and names unnamed ids", () => {
    const a = new ToolCallAssembler();
    a.add({ function: { name: "line_profile", arguments: '{"stage":' } });
    a.add({ function: { arguments: '"raw"}' } });
    expect(a.calls()).toEqual([
      { id: "call_0", type: "function", function: { name: "line_profile", arguments: '{"stage":"raw"}' } },
    ]);
  });
});

describe("streamChat", () => {
  it("streams text, then yields the assembled tool calls once", async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        line({ content: "Let me " }),
        // a chunk boundary in the middle of a line
        line({ content: "check." }).slice(0, 20),
        line({ content: "check." }).slice(20),
        line({ tool_calls: [{ index: 0, id: "c1", function: { name: "describe_dataset", arguments: "{}" } }] }),
        "data: [DONE]\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const deltas = [];
    for await (const d of streamChat({
      baseUrl: "http://localhost:1234/v1/",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      tools: [{ type: "function", function: { name: "describe_dataset", description: "d", parameters: {} } }],
      toolChoice: "auto",
    })) {
      deltas.push(d);
    }
    expect(deltas.filter((d) => d.content).map((d) => d.content).join("")).toBe("Let me check.");
    expect(deltas[deltas.length - 1]?.toolCalls?.[0].function.name).toBe("describe_dataset");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
  });

  it("omits tools from the request when none are given", async () => {
    const fetchMock = vi.fn(async () => sse([line({ content: "ok" }), "data: [DONE]\n"]));
    vi.stubGlobal("fetch", fetchMock);
    for await (const d of streamChat({ baseUrl: "u", model: "m", messages: [], temperature: 0 })) void d;
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("raises an HTTP error that carries the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "m does not support tools" } }), { status: 400 })),
    );
    const run = async () => {
      for await (const d of streamChat({ baseUrl: "u", model: "m", messages: [], temperature: 0 })) void d;
    };
    await expect(run()).rejects.toMatchObject({ status: 400 });
    await run().catch((e) => expect(isToolsUnsupported(e)).toBe(true));
  });

  it("reports a reply that stopped because it ran out of room", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([line({ content: "Che" }), `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n`])));
    const got: StreamDelta[] = [];
    for await (const d of streamChat({ baseUrl: "u", model: "m", messages: [], temperature: 0 })) got.push(d);
    expect(got[got.length - 1]).toEqual({ truncated: true, stopReason: "length" });
  });

  it("asks for the output cap it is given, sends no temperature when told none, and names a reply cut at the cap", async () => {
    const fetchMock = vi.fn(async () => sse([line({ content: "Che" }), `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n`]));
    vi.stubGlobal("fetch", fetchMock);
    const got: StreamDelta[] = [];
    for await (const d of streamChat({ baseUrl: "u", model: "m", messages: [], temperature: null, maxTokens: 16_000 })) got.push(d);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ model: "m", messages: [], stream: true, max_tokens: 16_000 });
    expect(got.filter((d) => d.stopReason)).toEqual([{ truncated: true, stopReason: "length" }]);
    // A reply that ended on its own names no stop reason.
    vi.stubGlobal("fetch", vi.fn(async () => sse([line({ content: "ok" }), `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n`])));
    const ended: StreamDelta[] = [];
    for await (const d of streamChat({ baseUrl: "u", model: "m", messages: [], temperature: 0 })) ended.push(d);
    expect(ended.some((d) => d.stopReason || d.truncated)).toBe(false);
  });

  it("explains a streamed error the model's own output caused, and keeps its status", async () => {
    const body = `data: ${JSON.stringify({ error: { code: 500, message: "The model produced output that does not match the expected peg-native format" } })}\n\n`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const run = async () => {
      for await (const d of streamChat({ baseUrl: "u", model: "m", messages: [], temperature: 0 })) void d;
    };
    const error = (await run().catch((e: unknown) => e)) as Error & { status?: number };
    expect(error.message).toMatch(/could not parse .* asking again usually works/);
    expect(error.status).toBe(500);
    expect(isMalformedOutput(error)).toBe(true);
    expect(isMalformedOutput(new Error("HTTP 500"))).toBe(false);
  });

  it("reads the context length LM Studio loaded the model with, and warns when Tools need more", async () => {
    const models = {
      data: [
        { id: "small", state: "loaded", loaded_context_length: 8192, max_context_length: 131072 },
        { id: "roomy", state: "loaded", loaded_context_length: 70656, max_context_length: 131072 },
        { id: "idle", state: "not-loaded", max_context_length: 262144 },
      ],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(models), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const small = await loadedContext("http://localhost:1234/v1", "small");
    expect(small).toEqual({ loaded: 8192, max: 131072 });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/api/v0/models", expect.anything());
    expect(contextWarning(small, "small")).toMatch(
      /^small is loaded with a 8,192-token context\. .* replies will be cut off\. In LM Studio, set this model's default Context Length to 57,344 \(it supports up to 131,072\)/,
    );
    expect(contextWarning(await loadedContext("http://localhost:1234/v1", "roomy"), "roomy")).toBeNull();
    // 32k: a full assessment that reads two skills needs about 48k (tokenBudget.test.ts), so 56k is suggested.
    expect(contextWarning({ loaded: 32_768, max: 131_072 }, "mid")).toMatch(
      /^mid is loaded with a 32,768-token context\. .* reaches about 48k, so on a long assessment the skills it read are shortened to stubs, or a request is not sent\. In LM Studio, set this model's default Context Length to 57,344/,
    );
    expect(contextWarning({ loaded: 57_344, max: 131_072 }, "enough")).toBeNull();
    // 48k, enough until a full assessment carried a full list of the ΔPDF's features, is not now.
    expect(contextWarning({ loaded: 49_152, max: 131_072 }, "was enough")).toMatch(/Context Length to 57,344/);
    expect(contextWarning({ loaded: 32_768, max: 40_960 }, "capped")).toMatch(/Context Length to 40,960 \(it supports up to 40,960\)/);
    // Not loaded: LM Studio will load it with its defaults, which is what to change.
    const idle = await loadedContext("http://localhost:1234/v1", "idle");
    expect(idle).toEqual({ loaded: null, max: 262144 });
    expect(contextWarning(idle, "idle")).toMatch(/^idle is not loaded: LM Studio will load it with its default Context Length/);
    expect(await loadedContext("http://localhost:1234/v1", "unlisted")).toBeNull();
    // Not asked of Ollama or of a cloud provider; a server without the API says nothing.
    fetchMock.mockClear();
    expect(await loadedContext("http://localhost:11434/v1", "small")).toBeNull();
    expect(await loadedContext("https://api.openai.com/v1", "small")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    expect(await loadedContext("http://localhost:8080/v1", "small")).toBeNull();
  });

  it("explains a bare HTTP 500 from the model server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<pre>Internal Server Error</pre>", { status: 500 })));
    const run = async () => {
      for await (const d of streamChat({ baseUrl: "u", model: "m", messages: [], temperature: 0 })) void d;
    };
    await expect(run()).rejects.toThrow(/^HTTP 500 — the model server failed before it could reply.*chat template/);
  });

  it("says how to fix a context window that is too small", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "Trying to keep the first 6012 tokens when context length is 4096" } }), { status: 400 }),
      ),
    );
    const run = async () => {
      for await (const d of streamChat({ baseUrl: "u", model: "m", messages: [], temperature: 0 })) void d;
    };
    await expect(run()).rejects.toThrow(/context window is full\. In LM Studio, raise the model's Context Length/);
    expect(withContextHint("model crashed")).toBe("model crashed");
  });

  it("raises an error the server streams after the 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sse([line({ content: "Che" }), `data: ${JSON.stringify({ error: { message: "model crashed" } })}\n`])),
    );
    const got: string[] = [];
    const run = async () => {
      for await (const d of streamChat({ baseUrl: "u", model: "m", messages: [], temperature: 0 })) got.push(d.content ?? "");
    };
    await expect(run()).rejects.toThrow("model crashed");
    expect(got).toEqual(["Che"]);
  });
});

// A body that sends `chunks` one every `everyMs`, and never ends unless they
// run out (`close`) or the request is aborted. A reader that cancels the body
// (the client does on `[DONE]`) stops its timer.
const slowBody = (chunks: string[], everyMs: number, signal: AbortSignal | undefined, close: boolean): Response => {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      clearInterval(timer);
    },
    start(controller) {
      let i = 0;
      timer = setInterval(() => {
        if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
        else if (close) {
          clearInterval(timer);
          controller.close();
        }
      }, everyMs);
      signal?.addEventListener("abort", () => {
        clearInterval(timer);
        controller.error(new DOMException("The operation was aborted.", "AbortError"));
      });
    },
  });
  return new Response(body, { status: 200 });
};

describe("completeChat with a stall watchdog (the tuner's requests)", () => {
  const args = { baseUrl: "http://127.0.0.1:1234/v1", model: "m", temperature: 0, messages: [{ role: "user" as const, content: "propose" }] };

  it("ends a request the server never answers with a StallError", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => slowBody([], 10, init.signal ?? undefined, false)));
    const t0 = Date.now();
    await expect(completeChat({ ...args, stallMs: { first: 150, idle: 100 } })).rejects.toBeInstanceOf(StallError);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("ends a reply that goes quiet part-way, after its idle limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => slowBody([line({ content: "{" })], 10, init.signal ?? undefined, false)));
    await expect(completeChat({ ...args, stallMs: { first: 150, idle: 100 } })).rejects.toBeInstanceOf(StallError);
  });

  it("reads a slow reply whole while its pieces keep coming, past the first-piece limit", async () => {
    const pieces = ['{"candidates"', ": ", "[]", "}"].map((c) => line({ content: c }));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => slowBody([...pieces, "data: [DONE]\n"], 60, init.signal ?? undefined, true)));
    // 5 pieces 60 ms apart: longer in all than `first`, never quiet for `idle`.
    await expect(completeChat({ ...args, stallMs: { first: 150, idle: 150 } })).resolves.toBe('{"candidates": []}');
  });

  it("tells the caller the request's token counts, or that the server gave none", async () => {
    const done = "data: [DONE]\n";
    const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 812, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 640 } } })}\n`;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => slowBody([line({ content: "{}" }), usage, done], 5, init.signal ?? undefined, true)));
    const seen: unknown[] = [];
    await completeChat({ ...args, stallMs: { first: 1000, idle: 1000 }, onUsage: (u) => seen.push(u) });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => slowBody([line({ content: "{}" }), done], 5, init.signal ?? undefined, true)));
    await completeChat({ ...args, stallMs: { first: 1000, idle: 1000 }, onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([{ input: 812, output: 9, cacheRead: 640 }, null]);
  });

  it("counts a thinking model's thoughts that Gemini leaves out of completion_tokens but puts in total_tokens", async () => {
    const done = "data: [DONE]\n";
    const counts = (usage: object) => `data: ${JSON.stringify({ choices: [], usage })}\n`;
    const seen: unknown[] = [];
    for (const usage of [
      { prompt_tokens: 500, completion_tokens: 40, total_tokens: 1340 }, // Gemini 2.5: 800 thinking tokens in the total only
      { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540 }, // OpenAI: the total adds up
      { prompt_tokens: 500, completion_tokens: 40 }, // no total
    ]) {
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => slowBody([line({ content: "{}" }), counts(usage), done], 5, init.signal ?? undefined, true)));
      await completeChat({ ...args, baseUrl: "http://127.0.0.1:1320/v1", stallMs: { first: 1000, idle: 1000 }, onUsage: (u) => seen.push(u) });
    }
    // Read whole (no stream), the same.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 500, completion_tokens: 40, total_tokens: 1340 } }))));
    await completeChat({ ...args, baseUrl: "http://127.0.0.1:1320/v1", onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([
      { input: 500, output: 840 },
      { input: 500, output: 40 },
      { input: 500, output: 40 },
      { input: 500, output: 840 },
    ]);
  });

  it("asks a server that refuses stream_options again without it", async () => {
    const bodies: { stream_options?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { stream_options?: unknown };
        bodies.push(body);
        if (body.stream_options) return new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: stream_options" } }), { status: 400 });
        return slowBody([line({ content: "{}" }), "data: [DONE]\n"], 5, init.signal ?? undefined, true);
      }),
    );
    const seen: unknown[] = [];
    const strict = { ...args, baseUrl: "http://127.0.0.1:1299/v1" };
    await expect(completeChat({ ...strict, stallMs: { first: 1000, idle: 1000 }, onUsage: (u) => seen.push(u) })).resolves.toBe("{}");
    expect(bodies.map((b) => Boolean(b.stream_options))).toEqual([true, false]);
    expect(seen).toEqual([null]); // no counts from it: the caller estimates
    // Remembered: the next request goes without it at once.
    await completeChat({ ...strict, stallMs: { first: 1000, idle: 1000 } });
    expect(bodies.map((b) => Boolean(b.stream_options))).toEqual([true, false, false]);
  });

  it("leaves the user's Stop an AbortError, not a stall", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => slowBody([], 10, init.signal ?? undefined, false)));
    const stop = new AbortController();
    const pending = completeChat({ ...args, signal: stop.signal, stallMs: { first: 5000, idle: 5000 } });
    setTimeout(() => stop.abort(), 50);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

// A server that refuses stream_options may say so in any shape: the first
// request to it that does is asked once more without the field.
describe("a server that refuses stream_options in another error shape", () => {
  const ask = (baseUrl: string) => completeChat({ baseUrl, model: "m", temperature: 0, messages: [{ role: "user", content: "q" }], stallMs: { first: 1000, idle: 1000 } });
  const refusing = (status: number, payload: unknown) => {
    const bodies: { stream_options?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { stream_options?: unknown };
        bodies.push(body);
        if (body.stream_options) return new Response(payload === undefined ? "" : JSON.stringify(payload), { status });
        return slowBody([line({ content: "{}" }), "data: [DONE]\n"], 5, init.signal ?? undefined, true);
      }),
    );
    return bodies;
  };
  const shapes: [string, number, unknown][] = [
    ["a FastAPI detail list", 422, { detail: [{ loc: ["body", "stream_options"], msg: "extra fields not permitted", type: "value_error.extra" }] }],
    ["a bare 400", 400, undefined],
    ["an array-wrapped error", 400, [{ error: { code: 400, message: "Invalid JSON payload received. Unknown name" } }]],
    ["an error object with no message", 400, { error: { code: 400 } }],
  ];
  for (const [name, status, payload] of shapes) {
    it(`asks again without it after ${name}, and remembers the server`, async () => {
      const bodies = refusing(status, payload);
      const url = `http://127.0.0.1:1300/${encodeURIComponent(name)}/v1`;
      await expect(ask(url)).resolves.toBe("{}");
      await expect(ask(url)).resolves.toBe("{}");
      expect(bodies.map((b) => Boolean(b.stream_options))).toEqual([true, false, false]);
    });
  }

  it("asks the agent's streamed requests again the same way", async () => {
    const bodies = refusing(422, { detail: [{ loc: ["body", "stream_options"] }] });
    const got: StreamDelta[] = [];
    for await (const d of streamChat({ baseUrl: "http://127.0.0.1:1301/v1", model: "m", messages: [], temperature: 0, includeUsage: true })) got.push(d);
    expect(got).toEqual([{ content: "{}" }]);
    expect(bodies.map((b) => Boolean(b.stream_options))).toEqual([true, false]);
  });

  it("asks once only, on a server whose bad request is not about the field", async () => {
    const bodies: { stream_options?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ detail: "prompt too long" }), { status: 400 });
      }),
    );
    const url = "http://127.0.0.1:1302/v1";
    await expect(ask(url)).rejects.toMatchObject({ status: 400 });
    await expect(ask(url)).rejects.toMatchObject({ status: 400 });
    // The first request once more without the field; the server is still asked for its counts.
    expect(bodies.map((b) => Boolean(b.stream_options))).toEqual([true, false, true]);
  });

  it("never asks again on a server that took the field before", async () => {
    let n = 0;
    const bodies: { stream_options?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        if (n++ === 0) return slowBody([line({ content: "{}" }), "data: [DONE]\n"], 5, init.signal ?? undefined, true);
        return new Response("", { status: 400 });
      }),
    );
    const url = "http://127.0.0.1:1303/v1";
    await expect(ask(url)).resolves.toBe("{}");
    await expect(ask(url)).rejects.toMatchObject({ status: 400 });
    expect(bodies.map((b) => Boolean(b.stream_options))).toEqual([true, true]);
  });
});

describe("completeChat", () => {
  const reply = (payload: unknown) => vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  const ask = (onUsage: (u: unknown) => void) => completeChat({ baseUrl: "u", model: "m", messages: [], temperature: 0, onUsage });

  it("reads the reply whole, as before, and reports its token counts, or null when the server gave none, with its stop reason", async () => {
    const fetchMock = reply({ choices: [{ message: { content: '{"best": 2}' }, finish_reason: "stop" }], usage: { prompt_tokens: 812, completion_tokens: 40 } });
    vi.stubGlobal("fetch", fetchMock);
    const onUsage = vi.fn();
    expect(await ask(onUsage)).toBe('{"best": 2}');
    expect(onUsage.mock.calls).toEqual([[{ input: 812, output: 40 }, "stop"]]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ model: "m", messages: [], temperature: 0, stream: false });

    vi.stubGlobal("fetch", reply({ choices: [{ message: { content: "{}" } }] }));
    onUsage.mockClear();
    await ask(onUsage);
    expect(onUsage.mock.calls).toEqual([[null, null]]);
  });

  it("asks for the output cap it is given, and reports a reply cut at it", async () => {
    const fetchMock = reply({ choices: [{ message: { content: '{"be' }, finish_reason: "length" }], usage: { prompt_tokens: 812, completion_tokens: 16_000 } });
    vi.stubGlobal("fetch", fetchMock);
    const onUsage = vi.fn();
    await completeChat({ baseUrl: "u", model: "m", messages: [], temperature: 0, maxTokens: 16_000, onUsage });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ model: "m", messages: [], temperature: 0, stream: false, max_tokens: 16_000 });
    expect(onUsage.mock.calls).toEqual([[{ input: 812, output: 16_000 }, "length"]]);
    expect([stoppedAtLimit("length"), stoppedAtLimit("max_tokens")]).toEqual([true, true]);
    expect([stoppedAtLimit("stop"), stoppedAtLimit("end_turn"), stoppedAtLimit(null), stoppedAtLimit(undefined)]).toEqual([false, false, false, false]);
  });

  it("reports the counts of a reply without text before it fails: they were spent", async () => {
    vi.stubGlobal("fetch", reply({ choices: [{ message: {} }], usage: { prompt_tokens: 90, completion_tokens: 3 } }));
    const onUsage = vi.fn();
    await expect(ask(onUsage)).rejects.toThrow("The model returned no message content");
    expect(onUsage.mock.calls).toEqual([[{ input: 90, output: 3 }, null]]);
  });
});
describe("isToolsUnsupported", () => {
  const err = (status: number, message: string) => Object.assign(new Error(message), { status }) as HttpError;
  it("recognises a client error about tools only", () => {
    expect(isToolsUnsupported(err(400, "registry.ollama.ai/library/gemma2 does not support tools"))).toBe(true);
    expect(isToolsUnsupported(err(400, "context length exceeded"))).toBe(false);
    expect(isToolsUnsupported(err(500, "tool crashed"))).toBe(false);
    expect(isToolsUnsupported(new TypeError("Failed to fetch"))).toBe(false);
  });
});
