// The provider client's function-calling path: tool calls assembled from the
// shapes real servers stream (OpenAI fragments by index, Ollama whole calls,
// servers without an index), the request body, and the "no tools" error test.

import { afterEach, describe, expect, it, vi } from "vitest";

import { contextWarning, isMalformedOutput, isToolsUnsupported, loadedContext, streamChat, ToolCallAssembler, type HttpError, type StreamDelta, withContextHint } from "../provider/client";

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
      baseUrl: "http://localhost:11434/v1/",
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
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
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
    expect(got[got.length - 1]).toEqual({ truncated: true });
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
      /^small is loaded with a 8,192-token context\. .* replies will be cut off\. In LM Studio, set this model's default Context Length to 32,768 \(it supports up to 131,072\)/,
    );
    expect(contextWarning(await loadedContext("http://localhost:1234/v1", "roomy"), "roomy")).toBeNull();
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

describe("isToolsUnsupported", () => {
  const err = (status: number, message: string) => Object.assign(new Error(message), { status }) as HttpError;
  it("recognises a client error about tools only", () => {
    expect(isToolsUnsupported(err(400, "registry.ollama.ai/library/gemma2 does not support tools"))).toBe(true);
    expect(isToolsUnsupported(err(400, "context length exceeded"))).toBe(false);
    expect(isToolsUnsupported(err(500, "tool crashed"))).toBe(false);
    expect(isToolsUnsupported(new TypeError("Failed to fetch"))).toBe(false);
  });
});
