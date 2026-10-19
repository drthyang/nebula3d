// startFresh (validationRun.ts), the reset before each validation run, without
// a model or a backend: what it clears and what it keeps, and a run cut short
// by its time limit, whose pipeline run or tuning run it stops and waits for
// before it clears, or, when that does not end, refuses to start the next run.
// validationRun.replay.test.ts runs two runs back to back through runCase.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { useDatasetStore } from "../../state/datasetStore";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { runAgent, toolsKnownUnsupported } from "../agent";
import { observeTokens, resetTokenState, tokenCalibration } from "../provider/tokens";
import { useTuneStore } from "../tune/tuner";
import { scriptedModel, SCRIPTED_URL } from "./scripted";
import { startFresh } from "./validationRun";

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
