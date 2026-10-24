// The agent loop: tool calls run in the browser and their results go back to
// the model; a server that refuses tools gets the plain request; the loop
// stops at its round budget. The executor's round (tools/round.ts) has tests
// of its own (round.test.ts): the repeats, the calls that act, the history.
// Here, the loop's wiring around it: the steps it shows, the figures it
// follows, the answer it asks for when a round is stuck, and the calls it
// forgets when it shortens their results.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { CUT_OFF_NOTE, LOOP_NOTE, runAgent, toolResultsIn, TOOLS_UNSUPPORTED_NOTE, type AgentStep } from "../agent";
import { resetTokenState } from "../provider/tokens";
import type { ChatMessage, StreamDelta } from "../provider/client";
import * as readings from "../readings";
import { isCompacted } from "../readings/compact";
import { DEFAULT_SETTINGS } from "../settings";
import { CHAT_TOOLS, MAX_RESULT_CHARS, type AgentTool } from "../tools";
import type { Outcome } from "../verdicts";

const client = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: client.streamChat,
}));

type Reply = StreamDelta[] | Error;
// Each streamChat call plays the next scripted reply; the messages and tools
// each call was given are recorded.
function script(replies: Reply[]) {
  const seen: { messages: ChatMessage[]; tools?: unknown[]; toolChoice?: string; numCtx?: number }[] = [];
  client.streamChat.mockImplementation((args: { messages: ChatMessage[]; tools?: unknown[]; toolChoice?: string; numCtx?: number }) => {
    seen.push({ messages: [...args.messages], tools: args.tools, toolChoice: args.toolChoice, numCtx: args.numCtx });
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
  // The window plan asks the model server about the model: none answers here.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  resetTokenState();
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

  it("replays a call whose arguments are not JSON with {}, so the history still renders", async () => {
    // Regression (LM Studio, 2026-10-10): a call cut off mid-way went back
    // verbatim, and the server failed the next request rendering it (HTTP 500).
    const broken = { id: "c1", type: "function" as const, function: { name: "echo", arguments: '{"x":' } };
    const seen = script([[{ toolCalls: [broken] }], [{ content: "Sorry." }]]);
    const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal });
    expect(r.steps[0].status).toBe("error");
    expect(r.steps[0].result).toMatch(/not a JSON object: \{"x":/);
    const replayed = seen[1].messages.find((m) => m.role === "assistant" && m.tool_calls);
    expect(replayed?.tool_calls?.[0].function.arguments).toBe("{}");
    expect(r.content).toBe("Sorry.");
  });

  it("stops without running the tools of a reply cut off by a full context", async () => {
    const run = vi.fn(echo.run);
    const seen = script([[{ content: "Let me look" }, { toolCalls: [call("c1", "echo", { x: 1 })] }, { truncated: true }]]);
    const r = await runAgent({ messages: base, tools: [{ ...echo, run }], ctx, settings, signal: new AbortController().signal });
    expect(run).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(r.content).toBe("Let me look");
    expect(r.note).toBe(CUT_OFF_NOTE);
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

  it("sends a tool-calling turn back in the provider's own form", async () => {
    const native = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "c1", name: "echo", input: { x: 1 } }];
    const seen = script([[{ toolCalls: [call("c1", "echo", { x: 1 })], native }], [{ content: "x is 1." }]]);
    await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal });
    const replayed = seen[1].messages[seen[1].messages.length - 2];
    expect(replayed).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] });
    expect(replayed.native).toBe(native);
  });

  it("moves the console to each step's figure while Follow is on, before the next call runs", async () => {
    const look: AgentTool = {
      name: "look",
      description: "looks at the run log",
      parameters: { type: "object", properties: {} },
      run: async () => ({ result: {}, summary: "looked", view: { view: "execution", label: "the run log" } }),
    };
    // The page each call finds the console on.
    const tabs: string[] = [];
    const peek: AgentTool = {
      name: "peek",
      description: "notes the console's page",
      parameters: { type: "object", properties: {} },
      run: async () => {
        tabs.push(useNavStore.getState().tab);
        return { result: {}, summary: "peeked" };
      },
    };
    const signal = new AbortController().signal;
    useNavStore.setState({ tab: "config" });
    script([[{ toolCalls: [call("c1", "look", {}), call("c2", "peek", {})] }], [{ content: "ok" }]]);
    const r = await runAgent({ messages: base, tools: [look, peek], ctx, settings, signal });
    expect(useNavStore.getState().tab).toBe("execution");
    expect(r.steps[0].view).toEqual({ view: "execution", label: "the run log" });
    useNavStore.setState({ tab: "config" });
    script([[{ toolCalls: [call("c3", "look", {}), call("c4", "peek", {})] }], [{ content: "ok" }]]);
    await runAgent({ messages: base, tools: [look, peek], ctx, settings: { ...settings, followViews: false }, signal });
    expect(useNavStore.getState().tab).toBe("config");
    // Followed, the figure was open when the next call ran; not followed, it never opened.
    expect(tabs).toEqual(["execution", "config"]);
  });

  it("ends the reply with a note on an error a retry would not cure", async () => {
    const seen = script([new Error("HTTP 400: bad request")]);
    const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal });
    expect(seen).toHaveLength(1);
    expect(r.failure).toEqual({ kind: "error", message: "HTTP 400: bad request", attempts: 1 });
    expect(r.note).toBe("The reply ended with an error: HTTP 400: bad request.");
  });

  it("asks again when the server could not parse the model's reply", async () => {
    const malformed = () =>
      new Error('Engine protocol predict stream returned an error: {"code":500,"message":"The model produced output that does not match the expected peg-native format"}');
    const seen = script([malformed(), [{ content: "Clean." }]]);
    const result = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal });
    expect(result.content).toBe("Clean.");
    expect(result.note).toBeUndefined();
    expect(seen).toHaveLength(2);
    expect(seen[1].messages).toEqual(seen[0].messages); // the same request again

    // A model that keeps doing it ends the reply after the retries, saying so.
    script([malformed(), malformed(), malformed(), [{ content: "never" }]]);
    const kept = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal });
    expect(kept.failure?.kind).toBe("malformed");
    expect(kept.note).toMatch(/peg-native format/);
  });

  // update_settings changes a fact about the sample only when the user's
  // latest message names it (tune/catalog.ts): the loop hands that message to
  // the tools, as the conversation arrived.
  describe("the user's latest message, which the tools read", () => {
    afterEach(() => usePipelineStore.setState(usePipelineStore.getInitialState()));

    it("is the same in every round: never an earlier turn's, nor what the loop sends as the user", async () => {
      const heard: AgentTool = {
        name: "heard",
        description: "what the user said",
        parameters: { type: "object", properties: { n: { type: "number" } } },
        run: async (_args, own) => ({ result: { heard: own.userMessage ?? null }, summary: "heard" }),
      };
      // The first answer writes a number no tool gave: the answer checks send it back, as the user, and the model calls again.
      const seen = script([
        [{ toolCalls: [call("c1", "heard", { n: 1 })] }],
        [{ content: "The volume has 7777 voxels." }],
        [{ toolCalls: [call("c2", "heard", { n: 2 })] }],
        [{ content: "Done." }],
      ]);
      const messages: ChatMessage[] = [
        { role: "user", content: "Set the punch cell to 2 along H." },
        { role: "assistant", content: "Set." },
        { role: "user", content: "Is the punch clean?" },
      ];
      const r = await runAgent({ messages, tools: [heard], ctx, settings, signal: new AbortController().signal });
      expect(seen[2].messages[seen[2].messages.length - 1].role).toBe("user"); // the send-back
      expect(r.steps.map((s) => JSON.parse(s.result ?? "{}").heard)).toEqual(["Is the punch clean?", "Is the punch clean?"]);
    });

    it("lets update_settings change a fact the latest message names, and refuses one only an earlier turn named", async () => {
      usePipelineStore.setState({ punchSupercellH: "", running: false });
      const change = call("c1", "update_settings", { changes: { punchSupercellH: 2 } });
      const asked: ChatMessage = { role: "user", content: "The volume is indexed on a doubled cell: set the punch cell to 2 along H." };
      const signal = new AbortController().signal;
      const read = { ...ctx, skillsRead: new Set(["bragg-node-audit"]) }; // the punch's skill: its gate is not what this tests
      script([[{ toolCalls: [change] }], [{ content: "Asked." }]]);
      const later = [asked, { role: "assistant", content: "Set." } as ChatMessage, { role: "user", content: "Is the punch clean?" } as ChatMessage];
      const refused = await runAgent({ messages: later, tools: CHAT_TOOLS, ctx: read, settings, signal, checkAnswers: false });
      expect(refused.steps[0]).toMatchObject({ status: "error", result: expect.stringMatching(/^Error: punchSupercellH is a fact about the sample/) });
      expect(usePipelineStore.getState().punchSupercellH).toBe("");
      script([[{ toolCalls: [change] }], [{ content: "Set." }]]);
      const named = await runAgent({ messages: [asked], tools: CHAT_TOOLS, ctx: read, settings, signal, checkAnswers: false });
      expect(named.steps[0].status).toBe("done");
      expect(usePipelineStore.getState().punchSupercellH).toBe("2");
    });
  });

  // The round decides what repeats an earlier call and when a round brought
  // nothing new (round.test.ts); the loop asks for the answer then, and keeps
  // what it has when the model calls again all the same.
  describe("a round that brought nothing new", () => {
    // A tool that counts its runs.
    const counting = (name: string) => {
      const runs: unknown[] = [];
      const tool: AgentTool = {
        name,
        description: "counts",
        parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
        run: async (args) => {
          runs.push(args);
          return { result: { run: runs.length }, summary: `run ${runs.length}` };
        },
      };
      return { tool, runs };
    };

    it("asks for the answer after two rounds that brought nothing new, and says so", async () => {
      const { tool, runs } = counting("measure");
      const seen = script([
        [{ toolCalls: [call("c1", "measure", { a: 1 })] }],
        [{ toolCalls: [call("c2", "measure", { a: 1 })] }],
        [{ toolCalls: [call("c3", "measure", { a: 1 })] }],
        [{ content: "a is 1." }],
      ]);
      const r = await runAgent({ messages: base, tools: [tool], ctx, settings, signal: new AbortController().signal });
      expect(runs).toHaveLength(1);
      expect(seen).toHaveLength(4);
      expect(seen[3].toolChoice).toBe("none");
      expect(seen[3].messages[seen[3].messages.length - 1]).toMatchObject({ role: "user", content: expect.stringMatching(/Answer now/) });
      expect(r.content).toBe("a is 1.");
      expect(r.note).toBe(LOOP_NOTE);
    });

    it("keeps what it has when the model calls again after being asked to answer", async () => {
      const { tool } = counting("measure");
      script([
        [{ content: "Measuring." }, { toolCalls: [call("c1", "measure", { a: 1 })] }],
        [{ toolCalls: [call("c2", "measure", { a: 1 })] }],
        [{ toolCalls: [call("c3", "measure", { a: 1 })] }],
        [{ toolCalls: [call("c4", "measure", { a: 1 })] }],
      ]);
      const r = await runAgent({ messages: base, tools: [tool], ctx, settings, signal: new AbortController().signal });
      expect(r.content).toBe("Measuring.");
      expect(r.steps).toHaveLength(3); // the call after the request to answer did not run
    });
  });

  // The steps the transcript shows, as the round hands them over: each key
  // for key, and each change as it happens.
  describe("the steps", () => {
    const outcome: Outcome = { check: "rings", kind: "info", reasons: ["no output"], dataProblems: [], words: null };
    const tool = (name: string, run: AgentTool["run"]): AgentTool => ({ name, description: name, parameters: { type: "object", properties: {} }, run });
    const look = tool("look", async () => ({ result: {}, summary: "looked", view: { view: "execution", label: "the run log" }, outcomes: [outcome] }));
    const slow = tool("slow", async (_args, _ctx, io) => {
      io.progress?.("halfway");
      return { result: {}, summary: "finished" };
    });
    const items = { items: Array.from({ length: 2000 }, (_, i) => i) }; // past the result limit: the model reads it fitted
    const long = tool("long", async () => ({ result: items, summary: "2000 items" }));
    const broken = (id: string) => ({ id, type: "function" as const, function: { name: "echo", arguments: '{"x":' } });

    it("builds each step key for key, and shows each change as it happens: its start, its live line, its end", async () => {
      script([
        [{ toolCalls: [call("c1", "echo", { x: 1 }), call("c2", "look", {}), call("c3", "nope", {}), broken("c4"), call("c5", "slow", {})] }],
        [{ toolCalls: [call("c6", "echo", { x: 1 }), call("c7", "long", {})] }],
        [{ content: "Done." }],
      ]);
      const shown: string[] = [];
      const r = await runAgent({
        messages: base,
        tools: [echo, look, slow, long],
        ctx,
        settings: { ...settings, followViews: false },
        signal: new AbortController().signal,
        onProgress: (p) => shown.push(p.steps.map((s) => s.status + (s.progress ? `(${s.progress})` : "")).join(",")),
      });
      const fitted = readings.fit(items, MAX_RESULT_CHARS);
      const already = JSON.stringify({
        already_called: "Called with these arguments earlier in this reply (step 1); its result is above. Use it, or call with other arguments.",
      });
      const ran = (s: Partial<AgentStep>) => ({ progress: undefined, ...s, view: s.view, outcomes: s.outcomes });
      expect(r.steps).toStrictEqual([
        ran({ id: "0:c1", name: "echo", args: { x: 1 }, status: "done", summary: "got 1", result: '{"got":1}' }),
        ran({ id: "1:c2", name: "look", args: {}, status: "done", summary: "looked", result: "{}", view: { view: "execution", label: "the run log" }, outcomes: [outcome] }),
        ran({ id: "2:c3", name: "nope", args: {}, status: "error", summary: "unknown tool nope", result: "Error: no tool named nope. Available: echo, look, slow, long" }),
        ran({ id: "3:c4", name: "echo", args: {}, status: "error", summary: "invalid arguments", result: 'Error: the arguments were not a JSON object: {"x":' }),
        ran({ id: "4:c5", name: "slow", args: {}, status: "done", summary: "finished", result: "{}" }),
        { id: "5:c6", name: "echo", args: { x: 1 }, status: "done", summary: "same call as step 1: not run again", result: already },
        ran({ id: "6:c7", name: "long", args: {}, status: "done", summary: "2000 items", result: fitted.text, full: fitted.full }),
      ]);
      // In this order: a step's live fields after the ones it starts with.
      const keys = ["id", "name", "args", "status", "progress", "summary", "result", "view", "outcomes"];
      expect(r.steps.map((s) => Object.keys(s))).toEqual([
        keys,
        keys,
        keys,
        keys,
        keys,
        ["id", "name", "args", "status", "summary", "result"],
        ["id", "name", "args", "status", "progress", "summary", "result", "full", "view", "outcomes"],
      ]);
      // One change at a time: each step as it starts, its live line, its end.
      expect(shown).toEqual([
        "",
        "running",
        "done",
        "done,running",
        "done,done",
        "done,done,running",
        "done,done,error",
        "done,done,error,running",
        "done,done,error,error",
        "done,done,error,error,running",
        "done,done,error,error,running(halfway)",
        "done,done,error,error,done",
        "done,done,error,error,done",
        "done,done,error,error,done,done",
        "done,done,error,error,done,done,running",
        "done,done,error,error,done,done,done",
        "done,done,error,error,done,done,done",
      ]);
    });
  });

  describe("the tools a local model is offered", () => {
    const named = (name: string): AgentTool => ({
      name,
      description: name,
      parameters: { type: "object", properties: {} },
      run: async () => ({ result: { verdict: "meets its goal", tool: name }, summary: name }),
    });
    const tools = ["assess_stage", "ub_check", "texture_check"].map(named);
    const specNames = (specs?: unknown[]) => (specs as { function: { name: string } }[] | undefined)?.map((t) => t.function.name);

    it("offers the question's tools, and runs and then offers one it calls by name all the same", async () => {
      const seen = script([[{ toolCalls: [call("c1", "ub_check", {})] }], [{ content: "Done." }]]);
      const r = await runAgent({ messages: [{ role: "user", content: "Is the ring removal clean?" }], tools, ctx, settings, signal: new AbortController().signal, checkAnswers: false });
      expect(specNames(seen[0].tools)).toEqual(["assess_stage", "texture_check"]);
      expect(r.steps[0]).toMatchObject({ name: "ub_check", status: "done" });
      expect(specNames(seen[1].tools)).toEqual(["assess_stage", "ub_check", "texture_check"]);
    });

    it("offers a cloud model every tool", async () => {
      const seen = script([[{ content: "Fine." }]]);
      await runAgent({
        messages: [{ role: "user", content: "Is the ring removal clean?" }],
        tools,
        ctx,
        settings: { ...settings, baseUrl: "https://api.example.com/v1" },
        signal: new AbortController().signal,
        checkAnswers: false,
      });
      expect(specNames(seen[0].tools)).toEqual(["assess_stage", "ub_check", "texture_check"]);
    });

    it("offers the tool a revision asks for", async () => {
      const seen = script([[{ content: "The backfill is clean." }], [{ content: "Checked." }]]);
      // A question about the flatten: a generic one is offered texture_check from the start (Q10).
      await runAgent({ messages: [{ role: "user", content: "How does the flatten look?" }], tools, ctx, settings, signal: new AbortController().signal });
      expect(specNames(seen[0].tools)).toEqual(["assess_stage"]);
      expect(specNames(seen[1].tools)).toEqual(["assess_stage", "texture_check"]); // the backfill's evidence
    });
  });

  describe("a result the model reads fitted (readings/)", () => {
    // 600 readings: past the result limit, so the model reads the first ones
    // and left_out names the rest; the step keeps the whole beside them.
    const whole = { verdict: "meets its goal", items: Array.from({ length: 600 }, (_, i) => ({ at: Number((1 + i / 1000).toFixed(3)), w: 0.5 })) };
    const longTool: AgentTool = {
      name: "long",
      description: "a long reading",
      parameters: { type: "object", properties: {} },
      run: async () => ({ result: whole, summary: "600 items" }),
    };

    it("fills a reference to a field the model's copy left out, from the whole result the step carries", async () => {
      const seen = script([[{ toolCalls: [call("c1", "long", {})] }], [{ content: "The last item is at {{long.items.599.at}}." }]]);
      const r = await runAgent({ messages: base, tools: [longTool], ctx, settings, signal: new AbortController().signal });
      const step = r.steps[0];
      expect(step.full).toBe(JSON.stringify(whole));
      // What the model read: the tool message as it was sent, which holds the first items only.
      const sent = seen[1].messages.find((m) => m.role === "tool")?.content;
      expect(readings.seen(step)).toBe(sent);
      const read = JSON.parse(readings.seen(step)) as { items: unknown[]; left_out: string[] };
      expect(read.items.length).toBeLessThan(600);
      expect(read.left_out).toEqual(["items: its last items"]);
      expect(readings.found(step)).toEqual(whole);
      // The reference is filled from the whole result, and its number traced there.
      expect(r.content).toBe("The last item is at 1.599.");
      expect(r.note).toBeUndefined();
    });

    it("gives the next reply an earlier turn's results as the model read them", () => {
      const step = { id: "0:c1", name: "long", args: {}, status: "done" as const, result: '{"items":[1],"left_out":["items: its last items"]}', full: '{"items":[1,2,3]}' };
      const turns = [{ steps: [step] }, { steps: [{ ...step, id: "1:c1", status: "error" as const }] }, {}];
      expect(toolResultsIn(turns)).toEqual(['{"items":[1],"left_out":["items: its last items"]}']);
    });
  });

  describe("a long reply on a local model", () => {
    // A reading with a long series; x picks where the series starts.
    const seriesTool: AgentTool = {
      name: "series",
      description: "a long series",
      parameters: { type: "object", properties: { x: { type: "number" } } },
      run: async (args) => {
        const x = args.x as number;
        const series = Array.from({ length: 200 }, (_, i) => Number((x + i / 1000).toFixed(3)));
        return { result: { verdict: "meets its goal", peak: x, series }, summary: `series ${x}` };
      },
    };
    const toolTexts = (messages: ChatMessage[]) => messages.filter((m) => m.role === "tool").map((m) => String(m.content));

    it("shortens older results past the budget, keeps the newest whole, and checks numbers against the whole ones", async () => {
      const seen = script([
        [{ toolCalls: [call("c1", "series", { x: 1 })] }],
        [{ toolCalls: [call("c2", "series", { x: 2 })] }],
        [{ toolCalls: [call("c3", "series", { x: 3 })] }],
        [{ toolCalls: [call("c4", "series", { x: 4 })] }],
        [{ content: "The first series reaches 1.199." }],
      ]);
      const r = await runAgent({ messages: base, tools: [seriesTool], ctx, settings, signal: new AbortController().signal, softBudget: 1000 });
      const sent = toolTexts(seen[4].messages);
      expect(sent.map(isCompacted)).toEqual([true, false, false, false]);
      expect(JSON.parse(sent[0])).toMatchObject({ verdict: "meets its goal", peak: 1, series: "(200 items)" });
      // 1.199 is only in the whole first series: the checks read it there.
      expect(r.content).toBe("The first series reaches 1.199.");
      expect(r.note).toBeUndefined();
      // The model's copy was shortened; what the model read when the call
      // returned was not: `seen` stays the text sent then, and the step says so.
      expect(r.steps.map((s) => s.shortened)).toEqual([true, undefined, undefined, undefined]);
      expect(readings.seen(r.steps[0])).toBe(toolTexts(seen[1].messages)[0]);
      expect(readings.seen(r.steps[0])).not.toBe(sent[0]);
      expect(readings.found(r.steps[0])).toMatchObject({ peak: 1, series: expect.arrayContaining([1.199]) });
    });

    it("keeps a skill's `## Gates` section when it shortens the skill's text", async () => {
      // A skill's text as read_skill returns it, synthetic: its gates are made up.
      const gates = "## Gates\n\n- Rings: a ring left at most 0.37 of its plane's noise.\n- Punch: a node punched at 4.5σ or more.";
      const text = `Skill synthetic-method\n\n# A synthetic method\n\n${"Read the volume first. ".repeat(40)}\n\n${gates}\n\n## Steps\n\n${"A step. ".repeat(60)}`;
      const method: AgentTool = {
        name: "read_method",
        description: "a skill's text",
        parameters: { type: "object", properties: {} },
        run: async () => ({ result: text, summary: "read the method" }),
      };
      const seen = script([
        [{ toolCalls: [call("c1", "read_method", {})] }],
        [{ toolCalls: [call("c2", "series", { x: 2 })] }],
        [{ toolCalls: [call("c3", "series", { x: 3 })] }],
        [{ toolCalls: [call("c4", "series", { x: 4 })] }],
        [{ content: "Done." }],
      ]);
      const r = await runAgent({ messages: base, tools: [method, seriesTool], ctx, settings, signal: new AbortController().signal, softBudget: 1000 });
      const sent = toolTexts(seen[4].messages);
      expect(sent.map(isCompacted)).toEqual([true, false, false, false]);
      expect(sent[0]).toBe(`${text.slice(0, 400)}…\n\n${gates}\n\n(shortened to save room; call the tool again for the whole result)`);
      expect(r.steps[0]).toMatchObject({ name: "read_method", shortened: true });
      expect(readings.seen(r.steps[0])).toBe(text);
    });

    it("lets a shortened call run again, for the whole result: forgotten by its key, a later run of the same call with it", async () => {
      const runs: unknown[] = [];
      const counted: AgentTool = {
        ...seriesTool,
        run: async (args, c, io) => {
          runs.push(args.x);
          return seriesTool.run(args, c, io);
        },
      };
      // A tool that acts (its facts': update_settings changes the settings).
      const change: AgentTool = {
        name: "update_settings",
        description: "changes settings",
        parameters: { type: "object", properties: {} },
        run: async () => ({ result: { changed: [] }, summary: "changed" }),
      };
      script([
        [{ toolCalls: [call("c1", "series", { x: 1 })] }],
        [{ toolCalls: [call("c2", "update_settings", {})] }],
        [{ toolCalls: [call("c3", "series", { x: 1 })] }], // runs: the change in between emptied the record
        [{ toolCalls: [call("c4", "series", { x: 2 })] }],
        // Before this request the first result is shortened, and its call
        // forgotten by its key: step 3's run of the same call with it.
        [{ toolCalls: [call("c5", "series", { x: 1 })] }],
        [{ content: "Done." }],
      ]);
      const r = await runAgent({ messages: base, tools: [counted, change], ctx, settings, signal: new AbortController().signal, softBudget: 1000 });
      expect(runs).toEqual([1, 1, 2, 1]);
      expect(r.steps.map((s) => s.summary)).toEqual(["series 1", "changed", "series 1", "series 2", "series 1"]);
      expect(r.steps.map((s) => s.shortened)).toEqual([true, undefined, undefined, undefined, undefined]);
      expect(Object.keys(r.steps[0])).toEqual(["id", "name", "args", "status", "progress", "summary", "result", "view", "outcomes", "shortened"]);
    });

    it("shortens a request too long for LM Studio's window down to its newest result before refusing it", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "qwen", state: "loaded", loaded_context_length: 3500 }] }), { status: 200 })),
      );
      const seen = script([
        [{ toolCalls: [call("c1", "series", { x: 1 })] }],
        [{ toolCalls: [call("c2", "series", { x: 2 })] }],
        [{ content: "Done." }],
      ]);
      const r = await runAgent({
        messages: base,
        tools: [seriesTool],
        ctx,
        settings: { ...settings, baseUrl: "http://localhost:1234/v1", model: "qwen" },
        signal: new AbortController().signal,
      });
      expect(seen).toHaveLength(3);
      expect(toolTexts(seen[2].messages).map(isCompacted)).toEqual([true, false]);
      expect(r.steps.map((s) => s.shortened)).toEqual([true, undefined]);
      expect(readings.seen(r.steps[0])).toBe(toolTexts(seen[1].messages)[0]);
      expect(r.content).toBe("Done.");
    });
  });

  describe("when the model server fails", () => {
    const quick = { retryDelaysMs: [1, 1], stallMs: { first: 60, idle: 60 } };
    const crashed = () => new Error("Error in iterating prediction stream: Exception: Encountered fatal exception in the backend generation thread:");

    it("asks a crashed server again after a pause, and carries on", async () => {
      const seen = script([[{ toolCalls: [call("c1", "echo", { x: 2 })] }], crashed(), [{ content: "x is 2." }]]);
      const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal, ...quick });
      expect(r.content).toBe("x is 2.");
      expect(r.failure).toBeUndefined();
      expect(seen).toHaveLength(3);
      expect(seen[2].messages).toEqual(seen[1].messages); // the same request again
    });

    it("ends with what happened and what to do once the retries are spent, keeping the steps", async () => {
      script([[{ toolCalls: [call("c1", "echo", { x: 3 })] }], crashed(), crashed(), crashed(), [{ content: "never" }]]);
      const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal, ...quick });
      expect(r.steps).toHaveLength(1);
      expect(r.failure).toMatchObject({ kind: "crash", attempts: 3 });
      expect(r.note).toMatch(/failed while answering .*and again when asked 2 more times\. On a shared machine this is usually memory/);
      expect(r.note).toMatch(/The steps above ran/);
    });

    it("tells memory from a crash, and gives it one longer try", async () => {
      const oom = () => Object.assign(new Error("HTTP 500: model requires more system memory (31.2 GiB) than is available (12.5 GiB)"), { status: 500 });
      const seen = script([oom(), oom(), [{ content: "never" }]]);
      const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal, ...quick });
      expect(seen).toHaveLength(2);
      expect(r.failure).toMatchObject({ kind: "memory", attempts: 2 });
      expect(r.note).toMatch(/ran out of memory/);
    });

    it("asks again when the model was unloaded mid-reply", async () => {
      const seen = script([new Error("Model is unloaded."), [{ content: "Back." }]]);
      const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal, ...quick });
      expect(r.content).toBe("Back.");
      expect(seen).toHaveLength(2);
    });

    it("does not retry a conversation too long for the window", async () => {
      const seen = script([new Error("HTTP 400: the input length exceeds the context length"), [{ content: "never" }]]);
      const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal, ...quick });
      expect(seen).toHaveLength(1);
      expect(r.failure?.kind).toBe("context");
    });

    it("ends a request the server sits on, asks again, and says so if it never answers", async () => {
      let calls = 0;
      client.streamChat.mockImplementation((args: { signal: AbortSignal }) => {
        calls += 1;
        return (async function* () {
          // Nothing, ever: until the watchdog ends the request.
          await new Promise((_, reject) => args.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
          yield { content: "unreachable" };
        })();
      });
      const r = await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal, ...quick });
      expect(calls).toBe(2); // one retry
      expect(r.failure).toMatchObject({ kind: "stalled", attempts: 2 });
      expect(r.note).toMatch(/sent nothing for too long/);
    });

    it("stops at once when the reply is stopped during a pause", async () => {
      script([crashed(), [{ content: "never" }]]);
      const abort = new AbortController();
      const run = runAgent({ messages: base, tools: [echo], ctx, settings, signal: abort.signal, retryDelaysMs: [60_000] });
      setTimeout(() => abort.abort(), 20);
      await expect(run).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  it("does not send a request longer than the window LM Studio loaded the model with, and says why", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "qwen", state: "loaded", loaded_context_length: 4096 }] }), { status: 200 })),
    );
    const seen = script([[{ content: "never sent" }]]);
    const r = await runAgent({
      messages: [{ role: "user", content: "x".repeat(20_000) }],
      tools: [echo],
      ctx,
      settings: { ...settings, baseUrl: "http://localhost:1234/v1", model: "qwen" },
      signal: new AbortController().signal,
    });
    expect(seen).toHaveLength(0);
    expect(r.content).toBe("");
    expect(r.note).toMatch(/loaded with a 4,096-token context, so it was not sent/);
  });

  it("asks Ollama for a context length that holds each request", async () => {
    const seen = script([[{ toolCalls: [call("c1", "echo", { x: 1 })] }], [{ content: "done" }]]);
    await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal });
    // A short exchange: the smallest step, kept for the second request.
    expect(seen.map((s) => s.numCtx)).toEqual([8192, 8192]);
  });
});
