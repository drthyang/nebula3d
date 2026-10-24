// The executor's round (tools/round.ts): a model turn's calls, run one at a
// time over the reply's history; the repeat guard, what an acting call and an
// error do to it, the rounds that bring nothing new, and the history the next
// round runs on, which a round never changes in place.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { useDpdfStore } from "../../state/dpdfStore";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import type { ChatMessage } from "../provider/client";
import { readSkill } from "../skills";
import { BARREN_ROUNDS, callKey, CHAT_TOOLS, forget, runRound, startReply, type AgentTool, type Args } from "../tools";
import { makeSlice } from "./helpers";

// The reads dpdf_contrast and run_pipeline make.
const api = vi.hoisted(() => ({ fetchDataset: vi.fn(), fetchDpdfMeta: vi.fn(), fetchDpdfSlice: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  fetchDataset: api.fetchDataset,
  fetchDpdfMeta: api.fetchDpdfMeta,
  fetchDpdfSlice: api.fetchDpdfSlice,
}));

const call = (id: string, name: string, args: Args | string) => ({
  id,
  type: "function" as const,
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

const tool = (name: string, run: AgentTool["run"]): AgentTool => ({ name, description: name, parameters: { type: "object", properties: {} }, run });

/** A tool that counts its runs: its result is the run's number. */
function counting(name: string) {
  const runs: Args[] = [];
  return {
    runs,
    tool: tool(name, async (args) => {
      runs.push(args);
      return { result: { run: runs.length }, summary: `run ${runs.length}` };
    }),
  };
}

const echo = tool("echo", async (args) => ({ result: { got: args }, summary: "echoed" }));
const fails = tool("fails", async () => {
  throw new Error("no data");
});

const dataset = { id: "d", stages: [] } as unknown as Dataset;
const ctx = { dataset, datasets: [dataset] };

describe("runRound", () => {
  it("does not run a call again with the same arguments, in any key order, and points the model at its step", async () => {
    const { tool: measure, runs } = counting("measure");
    const first = await runRound([call("c1", "measure", { a: 1, b: 2 }), call("c2", "measure", { a: 1, b: 2 })], startReply(ctx, [measure]));
    const second = await runRound([call("c3", "measure", { b: 2, a: 1 }), call("c4", "measure", { a: 5 })], first.history);
    expect(runs).toEqual([{ a: 1, b: 2 }, { a: 5 }]);
    const all = [...first.results, ...second.results];
    expect(all.map((r) => [r.step.summary, r.repeatOf])).toEqual([
      ["run 1", null],
      ["same call as step 1: not run again", 1], // in the same round
      ["same call as step 1: not run again", 1], // its keys in another order
      ["run 2", null],
    ]);
    expect(JSON.parse(String(all[2].message.content))).toEqual({
      already_called: "Called with these arguments earlier in this reply (step 1); its result is above. Use it, or call with other arguments.",
    });
    expect(all[2].key).toBe(callKey("measure", { a: 1, b: 2 }));
    expect(second.history.ran).toEqual([
      { key: callKey("measure", { a: 1, b: 2 }), step: 1 },
      { key: callKey("measure", { a: 5 }), step: 4 },
    ]);
  });

  it("never records an error: the same call runs again, bad arguments included", async () => {
    const { tool: measure, runs } = counting("measure");
    const tools = [measure, fails];
    const first = await runRound([call("c1", "fails", {}), call("c2", "measure", '{"a":')], startReply(ctx, tools));
    const second = await runRound([call("c3", "fails", {}), call("c4", "measure", '{"a":')], first.history);
    expect([...first.results, ...second.results].map((r) => [r.step.status, r.repeatOf])).toEqual([
      ["error", null],
      ["error", null],
      ["error", null],
      ["error", null],
    ]);
    expect(runs).toEqual([]);
    expect(second.history.ran).toEqual([]);
  });

  it("counts the rounds that bring nothing new, and is stuck after BARREN_ROUNDS of them", async () => {
    const { tool: measure } = counting("measure");
    let round = await runRound([call("c0", "measure", {})], startReply(ctx, [measure, fails]));
    expect([round.history.barren, round.stuck]).toEqual([0, false]);
    for (let i = 1; i <= BARREN_ROUNDS; i++) {
      // A repeat and an error: nothing new.
      round = await runRound([call(`r${i}`, "measure", {}), call(`f${i}`, "fails", {})], round.history);
      expect([round.history.barren, round.stuck]).toEqual([i, i >= BARREN_ROUNDS]);
    }
    // Anything new starts the count again.
    round = await runRound([call("n", "measure", { a: 2 }), call("f", "fails", {})], round.history);
    expect([round.history.barren, round.stuck]).toEqual([0, false]);
  });

  it("hands each call the reply's steps before it, across rounds, repeats and errors included (replySteps)", async () => {
    const before: string[][] = [];
    const reads = tool("reads", async (_args, c) => {
      before.push((c.replySteps ?? []).map((s) => `${s.id} ${s.name} ${s.status}`));
      return { result: {}, summary: "read" };
    });
    const start = startReply({ ...ctx, replySteps: [{ id: "x", name: "stale", args: {}, status: "done" }] }, [reads, echo, fails]);
    expect(start.ctx.replySteps).toEqual([]); // a reply starts with none
    const first = await runRound([call("c1", "echo", {}), call("c2", "fails", {}), call("c3", "reads", {})], start);
    const second = await runRound([call("c4", "echo", {}), call("c5", "reads", { a: 1 })], first.history);
    expect(before).toEqual([
      ["0:c1 echo done", "1:c2 fails error"],
      ["0:c1 echo done", "1:c2 fails error", "2:c3 reads done", "3:c4 echo done"],
    ]);
    expect(second.history.ctx.replySteps).toEqual([...first.results, ...second.results].map((r) => r.step));
    expect(first.history.ctx.replySteps).toHaveLength(3); // the round never changes the history it was given
  });

  it("numbers each step in the reply, so call ids a server reuses across rounds stay apart", async () => {
    const first = await runRound([call("c1", "echo", { a: 1 }), call("c2", "echo", { a: 2 })], startReply(ctx, [echo]));
    const second = await runRound([call("c1", "echo", { a: 3 }), call("c1", "echo", { a: 1 })], first.history);
    expect([...first.results, ...second.results].map((r) => r.step.id)).toEqual(["0:c1", "1:c2", "2:c1", "3:c1"]);
    expect(second.history.steps).toBe(4);
    expect(second.results.map((r) => r.message.tool_call_id)).toEqual(["c1", "c1"]);
  });

  it("replays a call whose arguments are no JSON object with {}, and tells the model what was wrong", async () => {
    const { tool: measure, runs } = counting("measure");
    const calls = [call("c1", "measure", '{"a":'), call("c2", "measure", "[1, 2]"), call("c3", "measure", { a: 1 })];
    const round = await runRound(calls, startReply(ctx, [measure]));
    expect(round.replay.map((c) => c.function.arguments)).toEqual(["{}", "{}", '{"a":1}']);
    expect(round.replay[2]).toBe(calls[2]); // a call whose arguments parse goes back as it came
    expect(round.results.map((r) => [r.step.status, r.step.args])).toEqual([
      ["error", {}],
      ["error", {}],
      ["done", { a: 1 }],
    ]);
    expect(round.results[0].message.content).toBe('Error: the arguments were not a JSON object: {"a":');
    expect(runs).toEqual([{ a: 1 }]);
  });

  it("shows each step as it changes, the call's end before the next call starts", async () => {
    const seen: string[] = [];
    const named = (name: string) =>
      tool(name, async (_args, _ctx, io) => {
        seen.push(`run ${name}`);
        io.progress?.("halfway");
        return { result: {}, summary: name };
      });
    await runRound([call("c1", "a", {}), call("c2", "b", {})], startReply(ctx, [named("a"), named("b")]), {
      onStep: (s: AgentStep) => seen.push(`${s.id} ${s.status}${s.progress ? ` (${s.progress})` : ""}`),
    });
    expect(seen).toEqual(["0:c1 running", "run a", "0:c1 running (halfway)", "0:c1 done", "1:c2 running", "run b", "1:c2 running (halfway)", "1:c2 done"]);
  });

  it("is pure over its history: it changes none of it, and the same history runs to the same round", async () => {
    const read = CHAT_TOOLS.find((t) => t.name === "read_skill")!;
    const history = startReply({ ...ctx, skillsRead: new Set<string>() }, [read, echo]);
    for (const part of [history, history.ran, history.tools, history.ctx]) expect(Object.isFrozen(part)).toBe(true);
    expect(() => {
      (history as { steps: number }).steps = 5;
    }).toThrow(TypeError);
    const calls = [call("c1", "read_skill", { name: "reduction-qc" }), call("c2", "echo", { a: 1 })];
    const a = await runRound(calls, history);
    const b = await runRound(calls, history);
    expect(b).toStrictEqual(a);
    expect(b.history).not.toBe(a.history);
    expect(a.history.ctx.skillsRead).toEqual(new Set(["reduction-qc"]));
    // The history it ran on is as it was: the read went to the round's copy of the context.
    expect([history.steps, history.ran, history.barren, history.ctx.skillsRead]).toEqual([0, [], 0, new Set()]);
  });

  it("hands every round's tools the user's latest message the reply started with, unchanged", async () => {
    const heard: (string | undefined)[] = [];
    const listen = tool("listen", async (_args, own) => {
      heard.push(own.userMessage);
      return { result: {}, summary: "heard" };
    });
    const said = "Set the punch cell to 2 along H.";
    const history = startReply({ ...ctx, userMessage: said }, [listen]);
    expect(Object.isFrozen(history.ctx)).toBe(true);
    const first = await runRound([call("c1", "listen", { a: 1 })], history);
    const second = await runRound([call("c2", "listen", { a: 2 })], first.history);
    expect(heard).toEqual([said, said]);
    expect(second.history.ctx.userMessage).toBe(said);
    // A context without one: the tools hear none.
    await runRound([call("c3", "listen", {})], startReply(ctx, [listen]));
    expect(heard[2]).toBeUndefined();
  });

  it("offers no read_skill with the skills off: a call to it is to a tool the reply does not hold", async () => {
    const off = startReply({ ...ctx, skills: false }, CHAT_TOOLS);
    expect(off.tools.map((t) => t.name)).not.toContain("read_skill");
    const round = await runRound([call("c1", "read_skill", { name: "reduction-qc" })], off);
    expect(round.results[0].step).toMatchObject({ status: "error", summary: "unknown tool read_skill" });
    // With the switch left unset, the skills are on: the tools given, as they are.
    expect(startReply(ctx, CHAT_TOOLS).tools).toEqual(CHAT_TOOLS);
  });

  describe("the context the next round runs on", () => {
    afterEach(() => usePipelineStore.setState(usePipelineStore.getInitialState()));

    it("lifts a stage's skill gate in the next round once read_skill read it, the conversation's own reads untouched", async () => {
      usePipelineStore.setState({ punchMinSig: "4", running: false });
      const own = { ...ctx, skillsRead: new Set<string>() };
      const history = startReply(own, CHAT_TOOLS);
      const change = { changes: { punchMinSig: 6 } };
      const first = await runRound([call("c1", "update_settings", change), call("c2", "read_skill", { name: "bragg-node-audit" })], history);
      expect(first.results.map((r) => r.step.status)).toEqual(["error", "done"]);
      expect(first.results[0].step.result).toMatch(/^Error: read the method first: call read_skill with name "bragg-node-audit"/);
      expect(usePipelineStore.getState().punchMinSig).toBe("4");
      const second = await runRound([call("c3", "update_settings", change)], first.history);
      expect(second.results[0].step.status).toBe("done");
      expect(usePipelineStore.getState().punchMinSig).toBe("6");
      expect(own.skillsRead.size).toBe(0);
      expect(history.ctx.skillsRead?.size).toBe(0);
    });

    it("starts with the context's skills read and those whose text the opening messages carry, never the earlier turns' reads", async () => {
      usePipelineStore.setState({ punchMinSig: "4", running: false });
      const pasted: ChatMessage[] = [{ role: "user", content: `My method:\n\n${readSkill("bragg-node-audit")}\n\nRaise the punch's threshold.` }];
      const asked: ChatMessage[] = [{ role: "user", content: "I read bragg-node-audit earlier. Raise the punch's threshold." }];
      expect(startReply({ ...ctx, skillsRead: new Set(["reduction-qc"]) }, CHAT_TOOLS, pasted).ctx.skillsRead).toEqual(
        new Set(["reduction-qc", "bragg-node-audit"]),
      );
      expect(startReply({ ...ctx, skillsRead: new Set() }, CHAT_TOOLS, asked).ctx.skillsRead).toEqual(new Set());
      // A skill read in an earlier turn opens nothing: it words the refusal.
      const earlier = startReply({ ...ctx, skillsRead: new Set(), skillsReadEarlier: new Set(["bragg-node-audit"]) }, CHAT_TOOLS, asked);
      expect(earlier.ctx.skillsRead).toEqual(new Set());
      const change = { changes: { punchMinSig: 6 } };
      const refused = await runRound([call("c1", "update_settings", change)], earlier);
      expect(refused.results[0].step.result).toMatch(/^Error: read the method again: call read_skill with name "bragg-node-audit"\. It was read earlier/);
      expect(usePipelineStore.getState().punchMinSig).toBe("4");
      // Its text in the messages opens it.
      const carried = await runRound([call("c1", "update_settings", change)], startReply({ ...ctx, skillsRead: new Set() }, CHAT_TOOLS, pasted));
      expect(carried.results[0].step.status).toBe("done");
      expect(usePipelineStore.getState().punchMinSig).toBe("6");
      // With the skills off there is no gate, and nothing is counted.
      expect(startReply({ ...ctx, skills: false }, CHAT_TOOLS, pasted).ctx.skillsRead).toEqual(new Set());
    });

    it("carries a run's fresh dataset into the next history", async () => {
      const fresh = { ...dataset, stages: [{ name: "braggpunched", exists: true, kind: "hkl", volume_id: "d.braggpunched" }] } as Dataset;
      api.fetchDataset.mockResolvedValue(fresh);
      usePipelineStore.setState({ running: false, flatten: true, pdfEnabled: true, events: [], runStages: vi.fn(async () => "done") });
      const history = startReply(ctx, CHAT_TOOLS);
      const round = await runRound([call("c1", "run_pipeline", {})], history);
      expect(round.results[0].step.status).toBe("done");
      expect(round.history.ctx.dataset).toBe(fresh);
      expect(history.ctx.dataset).toBe(dataset);
      expect(ctx.dataset).toBe(dataset);
    });
  });

  it("rejects with an AbortError once the reply is stopped, before the next call starts; the call under way ends first", async () => {
    const abort = new AbortController();
    const { tool: measure, runs } = counting("measure");
    const stops = tool("stops", async () => {
      abort.abort();
      return { result: {}, summary: "stopped the reply" };
    });
    const steps: string[] = [];
    const round = runRound([call("c1", "stops", {}), call("c2", "measure", {})], startReply(ctx, [stops, measure]), {
      signal: abort.signal,
      onStep: (s) => steps.push(`${s.id} ${s.status}`),
    });
    await expect(round).rejects.toMatchObject({ name: "AbortError" });
    expect(steps).toEqual(["0:c1 running", "0:c1 done"]);
    // Stopped before the round: no call starts.
    await expect(runRound([call("c3", "measure", {})], startReply(ctx, [measure]), { signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(runs).toEqual([]);
  });

  it("keeps a call that failed because the reply was stopped as stopped, not as an error (run_pipeline cancels its run on Stop)", async () => {
    const abort = new AbortController();
    // As run_pipeline: Stop cancels the run, and the call then fails saying so.
    const runs = tool("run_pipeline", (_args, _ctx, io) =>
      new Promise((_resolve, reject) => io.signal?.addEventListener("abort", () => reject(new Error("the run was cancelled")))),
    );
    const steps: string[] = [];
    const round = runRound([call("c1", "run_pipeline", {})], startReply(ctx, [runs]), {
      signal: abort.signal,
      onStep: (s) => steps.push(`${s.status}${s.summary ? ` ${s.summary}` : ""}`),
    });
    await vi.waitFor(() => expect(steps).toEqual(["running"]));
    abort.abort();
    const { results } = await round;
    expect(results[0].step.status).toBe("stopped");
    expect(steps).toEqual(["running", "stopped the run was cancelled"]);
    // A call that fails on its own, with the reply going on, is still an error.
    const fails = tool("fails", async () => {
      throw new Error("no such stage");
    });
    expect((await runRound([call("c2", "fails", {})], startReply(ctx, [fails]))).results[0].step.status).toBe("error");
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
    let shown: unknown[] = [];
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

    it("runs every time it is called, an identical call included, and empties the record of what ran", async () => {
      const { tool: measure, runs } = counting("measure");
      const first = await runRound(
        [call("c1", "measure", {}), call("c2", "dpdf_contrast", {}), call("c3", "dpdf_contrast", {})],
        startReply(dpdfCtx, [contrast, measure]),
      );
      expect(first.results.map((r) => [r.step.status, r.repeatOf])).toEqual([
        ["done", null],
        ["done", null],
        ["done", null],
      ]);
      expect(first.results.slice(1).map((r) => r.step.summary)).toEqual([expect.stringMatching(/^± 100 /), expect.stringMatching(/^± 100 /)]);
      expect(api.fetchDpdfSlice).toHaveBeenCalledTimes(6); // three sections for each call
      // Set twice to the same value: the viewer shows it.
      const optimised = { value: 100, dataset: "d" };
      expect(shown).toEqual([optimised, optimised]);
      // Not recorded, and what ran before it is forgotten: the next measure runs.
      expect(first.history.ran).toEqual([]);
      const second = await runRound([call("c4", "measure", {}), call("c5", "dpdf_contrast", { reset: true }), call("c6", "dpdf_contrast", {})], first.history);
      expect(second.results.map((r) => r.repeatOf)).toEqual([null, null, null]);
      expect(runs).toHaveLength(2);
      expect(shown).toEqual([optimised, optimised, null, optimised]);
      expect(JSON.parse(String(second.results[2].message.content)).applied).toMatchObject({ limit: 100, from: expect.stringMatching(/^optimised/) });
    });
  });
});

describe("forget", () => {
  it("forgets a call by its key, the step a later run of it re-recorded included, and leaves the history it was given", async () => {
    const { tool: measure, runs } = counting("measure");
    const settings = counting("update_settings"); // a tool that acts (its facts')
    const key = callKey("measure", { a: 1 });
    const first = await runRound([call("c1", "measure", { a: 1 }), call("c2", "measure", { a: 2 })], startReply(ctx, [measure, settings.tool]));
    const forgotten = forget(first.history, [key]);
    expect(forgotten.ran).toEqual([{ key: callKey("measure", { a: 2 }), step: 2 }]);
    expect(first.history.ran).toHaveLength(2);
    expect(Object.isFrozen(forgotten)).toBe(true);
    // The forgotten call runs again; the other is still a repeat.
    const second = await runRound([call("c3", "measure", { a: 1 }), call("c4", "measure", { a: 2 })], forgotten);
    expect(second.results.map((r) => r.repeatOf)).toEqual([null, 2]);
    expect(runs).toEqual([{ a: 1 }, { a: 2 }, { a: 1 }]);
    // After a call that acts, the same call is recorded at its new step; forgetting the key forgets that step too.
    const third = await runRound([call("c5", "update_settings", {}), call("c6", "measure", { a: 1 })], second.history);
    expect(third.history.ran).toEqual([{ key, step: 6 }]);
    expect(forget(third.history, [key]).ran).toEqual([]);
  });
});
