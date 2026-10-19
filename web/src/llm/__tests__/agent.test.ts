// The agent loop: tool calls run in the browser and their results go back to
// the model; a server that refuses tools gets the plain request; the loop
// stops at its round budget.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { useDpdfStore, type ManualLimit } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { CUT_OFF_NOTE, LOOP_NOTE, runAgent, TOOLS_UNSUPPORTED_NOTE } from "../agent";
import { isCompacted } from "../compact";
import { resetTokenState } from "../provider/tokens";
import type { ChatMessage, StreamDelta } from "../provider/client";
import { DEFAULT_SETTINGS } from "../settings";
import { CHAT_TOOLS, type AgentTool } from "../tools";
import { makeSlice } from "./helpers";

const client = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: client.streamChat,
}));

// The ΔPDF reads dpdf_contrast makes, for the loop guard's tests of it.
const api = vi.hoisted(() => ({ fetchDpdfMeta: vi.fn(), fetchDpdfSlice: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  fetchDpdfMeta: api.fetchDpdfMeta,
  fetchDpdfSlice: api.fetchDpdfSlice,
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

  it("shows a running tool's live line on its step, then clears it", async () => {
    script([[{ toolCalls: [call("c1", "slow", {})] }], [{ content: "Done." }]]);
    const slow: AgentTool = {
      name: "slow",
      description: "reports progress",
      parameters: { type: "object", properties: {} },
      run: async (_args, _ctx, io) => {
        io.progress?.("halfway");
        return { result: {}, summary: "finished" };
      },
    };
    const lines: (string | undefined)[] = [];
    const r = await runAgent({
      messages: base,
      tools: [slow],
      ctx,
      settings,
      signal: new AbortController().signal,
      onProgress: (p) => lines.push(p.steps[0]?.progress),
    });
    expect(lines).toContain("halfway");
    expect(r.steps[0]).toMatchObject({ status: "done", summary: "finished", progress: undefined });
  });

  it("sends a tool-calling turn back in the provider's own form", async () => {
    const native = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "c1", name: "echo", input: { x: 1 } }];
    const seen = script([[{ toolCalls: [call("c1", "echo", { x: 1 })], native }], [{ content: "x is 1." }]]);
    await runAgent({ messages: base, tools: [echo], ctx, settings, signal: new AbortController().signal });
    const replayed = seen[1].messages[seen[1].messages.length - 2];
    expect(replayed).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] });
    expect(replayed.native).toBe(native);
  });

  it("moves the console to each step's figure while Follow is on", async () => {
    const look: AgentTool = {
      name: "look",
      description: "looks at the run log",
      parameters: { type: "object", properties: {} },
      run: async () => ({ result: {}, summary: "looked", view: { view: "execution", label: "the run log" } }),
    };
    const signal = new AbortController().signal;
    useNavStore.setState({ tab: "config" });
    script([[{ toolCalls: [call("c1", "look", {})] }], [{ content: "ok" }]]);
    const r = await runAgent({ messages: base, tools: [look], ctx, settings, signal });
    expect(useNavStore.getState().tab).toBe("execution");
    expect(r.steps[0].view).toEqual({ view: "execution", label: "the run log" });
    useNavStore.setState({ tab: "config" });
    script([[{ toolCalls: [call("c2", "look", {})] }], [{ content: "ok" }]]);
    await runAgent({ messages: base, tools: [look], ctx, settings: { ...settings, followViews: false }, signal });
    expect(useNavStore.getState().tab).toBe("config");
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

  describe("the loop guard", () => {
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

    it("does not run a call again with the same arguments, in any order, and points at the result", async () => {
      const { tool, runs } = counting("measure");
      const seen = script([
        [{ toolCalls: [call("c1", "measure", { a: 1, b: 2 })] }],
        [{ toolCalls: [call("c2", "measure", { b: 2, a: 1 }), call("c3", "measure", { a: 5 })] }],
        [{ content: "Done." }],
      ]);
      const r = await runAgent({ messages: base, tools: [tool], ctx, settings, signal: new AbortController().signal });
      expect(runs).toEqual([{ a: 1, b: 2 }, { a: 5 }]);
      expect(r.steps.map((st) => st.summary)).toEqual(["run 1", "same call as step 1: not run again", "run 2"]);
      const sent = seen[2].messages.filter((m) => m.role === "tool").map((m) => m.content);
      expect(sent[1]).toMatch(/already_called.*step 1/);
      expect(r.note).toBeUndefined(); // a round with something new is no loop
    });

    it("reads again after a call that changes the settings", async () => {
      const { tool, runs } = counting("measure");
      const change = counting("update_settings");
      script([
        [{ toolCalls: [call("c1", "measure", { a: 1 })] }],
        [{ toolCalls: [call("c2", "update_settings", { a: 9 })] }],
        [{ toolCalls: [call("c3", "measure", { a: 1 })] }],
        [{ content: "Changed." }],
      ]);
      await runAgent({ messages: base, tools: [tool, change.tool], ctx, settings, signal: new AbortController().signal });
      expect(runs).toHaveLength(2);
    });

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

    // dpdf_contrast acts: it sets the 3D-ΔPDF viewer's ± colour limit, so the
    // limit the viewer shows is the one the last call set. A call pointed at an
    // earlier result instead of run would leave the model quoting a limit the
    // viewer no longer shows.
    describe("dpdf_contrast, which sets the ΔPDF viewer's colour limit", () => {
      const contrast = CHAT_TOOLS.find((t) => t.name === "dpdf_contrast")!;
      const dpdfCtx = {
        dataset: { id: "d", stages: [{ name: "delta_pdf", exists: true, kind: "delta_pdf", volume_id: "d.delta_pdf" }] } as Dataset,
        datasets: [],
      };
      // Ripple of amplitude 1, a huge origin peak and four compact features of
      // 100 (synthetic): the optimised limit lands on the features, at 100.
      const section = makeSlice(81, 81, (u, v) => {
        if (Math.hypot(u, v) < 1) return 1e6;
        const feature = [[20, 0], [-20, 0], [0, 20], [0, -20]].some(([a, b]) => Math.hypot(u - a, v - b) < 1.5);
        return feature ? 100 : Math.sin(3 * u) * Math.cos(3 * v);
      });
      const optimised: ManualLimit = { value: 100, dataset: "d" };
      // The viewer's limit, each time it changed.
      let shown: (ManualLimit | null)[] = [];
      let unsubscribe = () => {};
      beforeEach(() => {
        api.fetchDpdfMeta.mockReset();
        api.fetchDpdfSlice.mockReset();
        api.fetchDpdfMeta.mockResolvedValue({
          id: "d.delta_pdf",
          shape: [81, 81, 81],
          x_range: [-40, 40],
          y_range: [-40, 40],
          z_range: [-40, 40],
          lattice: { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 },
          q_max: 6,
          planes: ["xy", "xz", "yz"],
        });
        api.fetchDpdfSlice.mockResolvedValue(section);
        useDpdfStore.setState({ limit: null });
        shown = [];
        unsubscribe = useDpdfStore.subscribe((s, prev) => {
          if (s.limit !== prev.limit) shown.push(s.limit);
        });
      });
      afterEach(() => unsubscribe());

      it("runs a call again after another call changed the limit in between", async () => {
        const seen = script([
          [{ toolCalls: [call("c1", "dpdf_contrast", {})] }],
          [{ toolCalls: [call("c2", "dpdf_contrast", { reset: true })] }],
          [{ toolCalls: [call("c3", "dpdf_contrast", {})] }],
          [{ content: "Done." }],
        ]);
        const r = await runAgent({ messages: base, tools: [contrast], ctx: dpdfCtx, settings, signal: new AbortController().signal });
        expect(r.steps.map((st) => st.status)).toEqual(["done", "done", "done"]);
        expect(r.steps.map((st) => st.summary)).toEqual([expect.stringMatching(/^± 100 /), "back on Auto", expect.stringMatching(/^± 100 /)]);
        // The viewer followed each call: optimised, Auto, optimised again.
        expect(shown).toEqual([optimised, null, optimised]);
        expect(useDpdfStore.getState().limit).toEqual(optimised);
        expect(api.fetchDpdfSlice).toHaveBeenCalledTimes(6); // three sections for each optimised call
        // The model was told what the third call applied, not pointed at the first.
        const sent = seen[3].messages.filter((m) => m.role === "tool").map((m) => m.content as string);
        expect(sent[2]).not.toMatch(/already_called/);
        expect(JSON.parse(sent[2]).applied).toMatchObject({ limit: 100, from: expect.stringMatching(/^optimised/) });
      });

      it("runs an identical call again, with nothing in between, as the other calls that act do", async () => {
        const seen = script([
          [{ toolCalls: [call("c1", "dpdf_contrast", {})] }],
          [{ toolCalls: [call("c2", "dpdf_contrast", {})] }],
          [{ content: "Done." }],
        ]);
        const r = await runAgent({ messages: base, tools: [contrast], ctx: dpdfCtx, settings, signal: new AbortController().signal });
        expect(r.steps.map((st) => st.summary)).toEqual([expect.stringMatching(/^± 100 /), expect.stringMatching(/^± 100 /)]);
        expect(api.fetchDpdfSlice).toHaveBeenCalledTimes(6);
        // Set twice to the same value: the viewer shows it.
        expect(shown).toEqual([optimised, optimised]);
        const sent = seen[2].messages.filter((m) => m.role === "tool").map((m) => m.content as string);
        expect(sent[1]).not.toMatch(/already_called/);
      });
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
      await runAgent({ messages: [{ role: "user", content: "How does it look?" }], tools, ctx, settings, signal: new AbortController().signal });
      expect(specNames(seen[0].tools)).toEqual(["assess_stage"]);
      expect(specNames(seen[1].tools)).toEqual(["assess_stage", "texture_check"]); // the backfill's evidence
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
    });

    it("lets a shortened call run again, for the whole result", async () => {
      let runs = 0;
      const counted: AgentTool = {
        ...seriesTool,
        run: async (args, c, io) => {
          runs += 1;
          return seriesTool.run(args, c, io);
        },
      };
      script([
        [{ toolCalls: [call("c1", "series", { x: 1 })] }],
        [{ toolCalls: [call("c2", "series", { x: 2 })] }],
        [{ toolCalls: [call("c3", "series", { x: 3 })] }],
        [{ toolCalls: [call("c4", "series", { x: 4 })] }],
        [{ toolCalls: [call("c5", "series", { x: 1 })] }],
        [{ content: "Done." }],
      ]);
      await runAgent({ messages: base, tools: [counted], ctx, settings, signal: new AbortController().signal, softBudget: 1000 });
      expect(runs).toBe(5); // the first result was shortened, so asking again runs it
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
