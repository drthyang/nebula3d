// The provider client's function-calling path: tool calls assembled from the
// shapes real servers stream (OpenAI fragments by index, Ollama whole calls,
// servers without an index), the request body, and the "no tools" error test.

import { afterEach, describe, expect, it, vi } from "vitest";

import { isToolsUnsupported, streamChat, ToolCallAssembler, type HttpError, withContextHint } from "../provider/client";

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
