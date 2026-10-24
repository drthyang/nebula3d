// startFresh (validationRun.ts), the reset before each validation run, without
// a model or a backend: what it clears and what it keeps, and a run cut short
// by its time limit, whose pipeline run or tuning run it stops and waits for
// before it clears, or, when that does not end, refuses to start the next run.
// And TuningTokens: a run's tuning's tokens added to its usage, its cost and
// the paid model's spend; and TuningGate, a paid run's tunings past its first
// held to its spend budget. validationRun.replay.test.ts runs two runs back to
// back through runCase, one whose tuning asks the run's model, and runs whose
// second tuning the budget covers or does not.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { useDatasetStore } from "../../state/datasetStore";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { runAgent, toolsKnownUnsupported, type AgentStep } from "../agent";
import { observeTokens, resetTokenState, tokenCalibration } from "../provider/tokens";
import { CHAT_TOOLS, runToolCall, toolSpecs, toolsWithSkills } from "../tools";
import { useTuneStore } from "../tune/tuner";
import { scriptedModel, SCRIPTED_URL } from "./scripted";
import { TUNING_SKIPPED } from "./validation";
import { costOf, modelNamed, SPEND_CAP_USD, SpendTracker } from "./validationModels";
import { startFresh, TruncationTracker, TuningGate, TuningTokens } from "./validationRun";

const tuner = vi.hoisted(() => ({ stopTuning: vi.fn() }));
vi.mock("../tune/tuner", async (importOriginal) => ({ ...(await importOriginal<typeof import("../tune/tuner")>()), stopTuning: tuner.stopTuning }));

const DATASET: Dataset = { id: "v000000-B1", stem: "v000000_B1", temperature: null, raw_name: "v000000_B1.nxs", stages: [] };
const SETTINGS = { baseUrl: SCRIPTED_URL, model: "scripted", apiKey: "", temperature: 0, attachImages: false, useTools: true, followViews: false };
const EVENT = { type: "progress" as const, stage: "flatten", status: "done", message: "flatten: done" };

/** A store's state as a fresh page has it, its actions aside. */
const fresh = <S extends object>(store: { getInitialState: () => S }): Partial<S> =>
  Object.fromEntries(Object.entries(store.getInitialState()).filter(([, v]) => typeof v !== "function")) as Partial<S>;

const reset = <S>(store: { getInitialState: () => S; setState: (s: S, replace: true) => void }): void => store.setState(store.getInitialState(), true);

beforeEach(() => {
  reset(usePipelineStore);
  reset(useTuneStore);
  reset(useNavStore);
  reset(useViewerStore);
  reset(useDpdfStore);
  reset(useDatasetStore);
  tuner.stopTuning.mockReset();
  resetTokenState();
});

describe("startFresh", () => {
  it("clears the run's log, the tuning store, the views, the settings and the servers found refusing tools, and selects the run's dataset", async () => {
    // A server found refusing tools, as an earlier run finds one: it fails the
    // request that carries tools, and the reply goes on without them.
    const model = scriptedModel([{ fail: { status: 400, message: "scripted does not support tools" } }, { text: "No tools." }]);
    const uninstall = model.install();
    try {
      const tool = { name: "t", description: "d", parameters: { type: "object", properties: {} }, run: async () => ({ result: {}, summary: "" }) };
      await runAgent({ messages: [{ role: "user", content: "Hi" }], tools: [tool], ctx: { dataset: DATASET, datasets: [DATASET] }, settings: SETTINGS, signal: new AbortController().signal });
    } finally {
      uninstall();
    }
    expect(model.requests()).toBe(2);
    expect(toolsKnownUnsupported(SETTINGS)).toBe(true);
    // What an earlier run leaves in the app.
    usePipelineStore.setState({ flattenQ2: true, events: [EVENT], times: [1], terminal: "done", jobId: "job-1" });
    useTuneStore.setState({ stages: [{ stage: "pdf", tuned: true, status: "done", trials: [{ n: 1, changes: {}, settings: {}, status: "done" }], best: 1 }], finishedNote: "Done." });
    useNavStore.setState({ tab: "execution" });
    useViewerStore.setState({ fixedAxis: "L", cutIndex: 7, focus: { axis: "L", value: 0.5 } });
    useDpdfStore.setState({ cutX: 3, centered: true, limit: { value: 2, dataset: "v000001-C1" } });
    useDatasetStore.setState({ datasetId: "v000001-C1" });
    observeTokens(`${SETTINGS.baseUrl}|${SETTINGS.model}`, 1000, 800);

    await startFresh(DATASET);
    expect(usePipelineStore.getState()).toMatchObject(fresh(usePipelineStore));
    expect(usePipelineStore.getState()).toMatchObject({ flattenQ2: false, events: [], times: [], terminal: null, jobId: null, running: false });
    expect(useTuneStore.getState()).toMatchObject(fresh(useTuneStore));
    expect(useNavStore.getState()).toMatchObject(fresh(useNavStore));
    expect(useViewerStore.getState()).toMatchObject(fresh(useViewerStore));
    expect(useDpdfStore.getState()).toMatchObject(fresh(useDpdfStore));
    expect(useDatasetStore.getState().datasetId).toBe(DATASET.id);
    expect(toolsKnownUnsupported(SETTINGS)).toBe(false);
    // The token calibration is kept: the model's and its server's, not the run's.
    expect(tokenCalibration(`${SETTINGS.baseUrl}|${SETTINGS.model}`)).toEqual({ scale: 0.8, ollamaNumCtx: null });
    expect(tuner.stopTuning).not.toHaveBeenCalled();
  });

  it("stops a pipeline run the run before left going, and waits for it to end before it clears", async () => {
    const cancel = vi.fn(async () => {
      // The run ends a moment later, its last event logged as it goes.
      setTimeout(() => usePipelineStore.setState((s) => ({ events: [...s.events, EVENT], running: false, terminal: "cancelled" })), 50);
    });
    usePipelineStore.setState({ running: true, events: [EVENT], terminal: null, cancel });
    await startFresh(DATASET, { settleMs: 5000 });
    expect(cancel).toHaveBeenCalledTimes(1);
    // Cleared after it ended: nothing it wrote is left.
    expect(usePipelineStore.getState()).toMatchObject({ running: false, events: [], terminal: null });
  });

  it("stops a tuning run the run before left going, and waits for it to end before it clears", async () => {
    tuner.stopTuning.mockImplementation(() => {
      setTimeout(() => useTuneStore.setState({ active: false, finishedNote: "Stopped." }), 50);
    });
    useTuneStore.setState({ active: true, stages: [{ stage: "pdf", tuned: true, status: "running", trials: [] }] });
    await startFresh(DATASET, { settleMs: 5000 });
    expect(tuner.stopTuning).toHaveBeenCalledTimes(1);
    expect(useTuneStore.getState()).toMatchObject(fresh(useTuneStore));
  });

  it("refuses to start the next run while what the run before left is still going, and clears nothing", async () => {
    useTuneStore.setState({ active: true });
    useNavStore.setState({ tab: "execution" });
    await expect(startFresh(DATASET, { settleMs: 1000 })).rejects.toThrow(
      "a tuning run the run before started is still going after 1 s; the next run would read it, so the runs stop here",
    );
    expect(useNavStore.getState().tab).toBe("execution");
  });
});

describe("a run's tuning tokens", () => {
  // The agent loop's usage, as runAgent counts it.
  const LOOP = { input: 9000, output: 400, cacheRead: 0, cacheWrite: 0, requests: 3 };

  it("adds the tuning's counts to the loop's and keeps them apart; a run that did not tune keeps the loop's", () => {
    const t = new TuningTokens();
    expect(t.addTo(LOOP)).toBe(LOOP);
    expect(t.addTo(null)).toBeNull();
    t.report({ input: 700, output: 50 });
    t.report({ input: 900, output: 20, cacheRead: 300, cacheWrite: 100 });
    expect(t.addTo(LOOP)).toEqual({
      input: 10_600,
      output: 470,
      cacheRead: 300,
      cacheWrite: 100,
      requests: 5,
      tuning: { input: 1600, output: 70, cacheRead: 300, cacheWrite: 100, requests: 2 },
    });
  });

  it("leaves the total unknown when the loop's is, or when a tuning request's counts were not reported", () => {
    const t = new TuningTokens();
    t.report({ input: 700, output: 50 });
    expect(t.addTo(null)).toBeNull();
    t.report(null);
    expect(t.addTo(LOOP)).toBeNull();
  });

  it("is charged at the run model's price, in the run's cost and the paid model's spend", () => {
    const price = modelNamed("claude-sonnet-5-5").price!;
    const t = new TuningTokens();
    t.report({ input: 1600, output: 70, cacheRead: 300, cacheWrite: 100 });
    const tracker = new SpendTracker(SPEND_CAP_USD);
    tracker.record({ case: "c", arm: "B", run: 1, usd: costOf(t.addTo(LOOP), price) });
    // By hand: the loop's 9000 tokens in and 400 out; the tuning's 1200 in
    // uncached, 300 read from the cache, 100 written to it, and 70 out.
    const loopUsd = (9000 * price.input + 400 * price.output) / 1e6;
    const tuningUsd = (1200 * price.input + 300 * price.cacheRead + 100 * price.cacheWrite + 70 * price.output) / 1e6;
    expect(tracker.spent).toBeCloseTo(loopUsd + tuningUsd, 12);
    expect(tracker.spent - costOf(LOOP, price)!).toBeCloseTo(tuningUsd, 12);
    // A tuning request without counts leaves the cost unknown: the run is charged the reserve.
    const unreported = new TuningTokens();
    unreported.report(null);
    expect(tracker.record({ case: "c", arm: "B", run: 2, usd: costOf(unreported.addTo(LOOP), price) }).estimated).toBe(true);
  });
});

describe("a run's requests cut at the output limit", () => {
  it("keeps the loop's as runAgent reports them, and the tuning's by each request's stop reason, numbered over the tuning's", () => {
    const cut = new TruncationTracker("ollama");
    expect(cut.toRecord()).toEqual({ loop: 0, tuning: 0, requests: [] });
    cut.tuning({ input: 50, output: 5 }, "stop");
    cut.loop({ request: 3, reason: "length" });
    cut.tuning(null, null);
    cut.tuning({ input: 50, output: 16_000 }, "length");
    cut.tuning({ input: 50, output: 16_000 }, "max_tokens");
    cut.tuning({ input: 50, output: 5 }, undefined);
    expect(cut.toRecord()).toEqual({
      loop: 1,
      tuning: 2,
      requests: [
        { request: 3, source: "loop", transport: "ollama", reason: "length" },
        { request: 3, source: "tuning", transport: "ollama", reason: "length" },
        { request: 4, source: "tuning", transport: "ollama", reason: "max_tokens" },
      ],
    });
  });
});

describe("a paid run's tunings past its first", () => {
  const step = (name: string, summary: string, status: AgentStep["status"] = "done"): AgentStep => ({ id: `${name}-${summary}`, name, args: {}, status, summary });

  it("lets the run's first tuning start, and each past it only while the budget covers one more, drawing its share", () => {
    let answered = 0; // the run's tuning requests the server answered
    const gate = new TuningGate({ leftUsd: 7, perTuningUsd: SpendTracker.EXTRA_TUNING_USD }, () => answered);
    gate.admit(); // the run's first: the reserve covers it
    gate.admit(); // one that sent nothing leaves the next the first, and draws nothing
    answered = 3;
    gate.admit(); // past the first: $7.00 covers $3.47, and $3.53 is left
    gate.admit(); // $3.53 covers it, and $0.06 is left
    expect(() => gate.admit()).toThrow(TUNING_SKIPPED);
    expect(() => gate.admit()).toThrow(TUNING_SKIPPED);
    // The record finds each skip at its step: the call whose error the model read.
    const steps = [
      step("tune_pipeline", "3 min"),
      step("run_log", "12 lines"),
      step("tune_pipeline", TUNING_SKIPPED, "error"),
      step("tune_pipeline", "bad stage", "error"),
      step("tune_pipeline", TUNING_SKIPPED, "error"),
    ];
    expect(gate.toRecord(steps)).toEqual({
      left_usd: 7,
      per_tuning_usd: 3.47,
      skipped: [
        { step: 3, left_usd: 0.06 },
        { step: 5, left_usd: 0.06 },
      ],
    });
    // A skip whose step the run's steps do not hold (a run cut short) keeps no step.
    expect(gate.toRecord(steps.slice(0, 3))?.skipped).toEqual([
      { step: 3, left_usd: 0.06 },
      { step: null, left_usd: 0.06 },
    ]);
  });

  it("without a budget, tunes as often as asked, hands the loop the tools as they are, and records none", () => {
    const gate = new TuningGate(null, () => 5);
    for (let i = 0; i < 5; i++) gate.admit();
    expect(gate.tools(CHAT_TOOLS)).toBe(CHAT_TOOLS);
    expect(gate.toRecord([step("tune_pipeline", TUNING_SKIPPED, "error")])).toBeNull();
  });

  it("holds tune_pipeline alone, offered as it is in either arm, and refuses before the tool runs", async () => {
    const gate = new TuningGate({ leftUsd: 0, perTuningUsd: SpendTracker.EXTRA_TUNING_USD }, () => 1);
    const held = gate.tools(CHAT_TOOLS);
    held.forEach((t, i) => (t.name === "tune_pipeline" ? expect(t).not.toBe(CHAT_TOOLS[i]) : expect(t).toBe(CHAT_TOOLS[i])));
    // What the model is offered is unchanged: the tools' names, descriptions and parameters, with the skills on and off.
    expect(toolSpecs(held)).toEqual(toolSpecs(CHAT_TOOLS));
    expect(toolSpecs(toolsWithSkills(held, false))).toEqual(toolSpecs(toolsWithSkills(CHAT_TOOLS, false)));
    const tune = held.find((t) => t.name === "tune_pipeline")!;
    const shipped = CHAT_TOOLS.find((t) => t.name === "tune_pipeline")!;
    expect({ ...tune, run: null }).toEqual({ ...shipped, run: null });
    // A call the budget does not cover: its error is what the model reads, and nothing ran.
    const out = await runToolCall(
      { id: "c1", type: "function", function: { name: "tune_pipeline", arguments: JSON.stringify({ stages: ["pdf"] }) } },
      held,
      { dataset: DATASET, datasets: [DATASET], skills: false },
    );
    expect(out).toMatchObject({ ok: false, text: `Error: ${TUNING_SKIPPED}`, summary: TUNING_SKIPPED });
    expect(TUNING_SKIPPED).toBe("tune_pipeline did not run: the spend budget left does not cover another tuning");
    expect(useTuneStore.getState()).toMatchObject({ active: false, run: null, stages: [] });
  });
});
