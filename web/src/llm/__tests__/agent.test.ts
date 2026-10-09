// The agent loop: tool calls run in the browser and their results go back to
// the model; a server that refuses tools gets the plain request; the loop
// stops at its round budget.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { runAgent, TOOLS_UNSUPPORTED_NOTE } from "../agent";
import type { ChatMessage, StreamDelta } from "../provider/client";
import { DEFAULT_SETTINGS } from "../settings";
import type { AgentTool } from "../tools";

const client = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: client.streamChat,
}));

type Reply = StreamDelta[] | Error;
// Each streamChat call plays the next scripted reply; the messages and tools
// each call was given are recorded.
function script(replies: Reply[]) {
  const seen: { messages: ChatMessage[]; tools?: unknown[]; toolChoice?: string }[] = [];
  client.streamChat.mockImplementation((args: { messages: ChatMessage[]; tools?: unknown[]; toolChoice?: string }) => {
    seen.push({ messages: [...args.messages], tools: args.tools, toolChoice: args.toolChoice });
    const reply = replies.shift();
    return (async function* () {
      if (reply instanceof Error) throw reply;
      for (const d of reply ?? []) yield d;
    })();
  });
  return seen;
}

const call = (id: string, name: string, args: object) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

const echo: AgentTool = {
  name: "echo",
  description: "returns its input",
  parameters: { type: "object", properties: { x: { type: "number" } } },
  run: async (args) => ({ result: { got: args.x }, summary: `got ${args.x}` }),
};

const ctx = { dataset: { id: "d" } as Dataset, datasets: [] };
const settings = { ...DEFAULT_SETTINGS, model: `m-${Math.random()}` };
const base: ChatMessage[] = [{ role: "user", content: "hi" }];

beforeEach(() => {
  client.streamChat.mockReset();
});

describe("runAgent", () => {
  it("runs a tool call and sends its result back before the answer", async () => {
    const seen = script([
      [{ content: "Checking." }, { toolCalls: [call("c1", "echo", { x: 7 })] }],
      [{ content: "x is 7." }],
    ]);
    const progress: string[] = [];
    const r = await runAgent({
      messages: base,
      tools: [echo],
      ctx,
      settings,
      signal: new AbortController().signal,
      onProgress: (p) => progress.push(p.steps.map((s) => s.status).join(",")),
    });
    expect(r.content).toBe("Checking.\n\nx is 7.");
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ name: "echo", status: "done", args: { x: 7 }, summary: "got 7" });
    expect(progress).toContain("running");
    // The second request carries the call and its result.
    const second = seen[1].messages;
    expect(second[second.length - 2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] });
    expect(second[second.length - 1]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"got":7}' });
    expect(seen[0].tools).toHaveLength(1);
  });

  it("returns a bad call to the model as an error it can correct", async () => {
    script([[{ toolCalls: [call("c1", "nope", {})] }], [{ content: "Sorry." }]]);
    const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal });
    expect(r.steps[0].status).toBe("error");
    expect(r.steps[0].result).toMatch(/no tool named nope/);
    expect(r.content).toBe("Sorry.");
  });

  it("retries without tools when the server refuses them, and remembers", async () => {
    const own = { ...settings, model: "no-tools-model" };
    const refuse = Object.assign(new Error("HTTP 400: no-tools-model does not support tools"), { status: 400 });
    const seen = script([refuse, [{ content: "From the context: fine." }]]);
    const r = await runAgent({ messages: base, tools: [echo], ctx, settings: own, signal: new AbortController().signal });
    expect(r.content).toBe("From the context: fine.");
    expect(r.note).toBe(TOOLS_UNSUPPORTED_NOTE);
    expect(seen[0].tools).toBeDefined();
    expect(seen[1].tools).toBeUndefined();
    // The next reply skips straight to the plain request.
    const again = script([[{ content: "ok" }]]);
    await runAgent({ messages: base, tools: [echo], ctx, settings: own, signal: new AbortController().signal });
    expect(again[0].tools).toBeUndefined();
  });

  it("stops at the round budget and asks for an answer without tools", async () => {
    const seen = script([
      [{ toolCalls: [call("a", "echo", { x: 1 })] }],
      [{ toolCalls: [call("b", "echo", { x: 2 })] }],
      [{ content: "Done." }, { toolCalls: [call("c", "echo", { x: 3 })] }],
    ]);
    const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal, maxRounds: 2 });
    expect(r.steps.map((s) => s.args.x)).toEqual([1, 2]);
    expect(seen[2].toolChoice).toBe("none");
    expect(r.content).toBe("Done.");
    expect(r.note).toMatch(/Stopped after 2 rounds/);
  });

  it("propagates other errors", async () => {
    script([new Error("HTTP 500: boom")]);
    await expect(
      runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal }),
    ).rejects.toThrow("boom");
  });
});
