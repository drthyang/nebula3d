// The Configure page's "Enable stage" switches reach the backend as the
// stages' switches, not only as stages left out of the run: the backend reads
// a stage left out as a partial re-run, which hands the next stage its output
// on disk. formToParams sends each switch; the run sends the stages switched
// on, with the switches.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PipelineRunRequest } from "../../api/types";
import { enabledStages, formToParams, usePipelineStore, type PipelineConfig } from "../pipelineStore";

const api = vi.hoisted(() => ({
  runPipeline: vi.fn(),
  cancelJob: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const SWITCHES = [
  ["ringsEnabled", "rings_enabled", "rings"],
  ["punchEnabled", "punch_enabled", "punch"],
  ["backfillEnabled", "backfill_enabled", "backfill"],
] as const;

const ALL_ON = { ringsEnabled: true, punchEnabled: true, backfillEnabled: true, flatten: true, pdfEnabled: true };
const form = (patch: Partial<PipelineConfig> = {}): PipelineConfig => ({ ...usePipelineStore.getState(), ...patch });
const sent = (): PipelineRunRequest => api.runPipeline.mock.calls[0][0] as PipelineRunRequest;

beforeEach(() => {
  usePipelineStore.setState({ ...ALL_ON, force: false, running: false, events: [], times: [], terminal: null });
  api.runPipeline.mockReset().mockResolvedValue({ id: "job-1", input: "x", status: "running", n_events: 0 });
  // The native run streams its progress over SSE; nothing is streamed here.
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage: unknown = null;
      onerror: unknown = null;
      close() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("formToParams", () => {
  it("sends every cleanup stage's switch, on by default", () => {
    expect(formToParams(form())).toMatchObject({ rings_enabled: true, punch_enabled: true, backfill_enabled: true });
  });

  it.each(SWITCHES)("sends %s off as %s: false, the others on", (field, flag) => {
    const params = formToParams(form({ [field]: false }));
    for (const [, other] of SWITCHES) expect(params[other]).toBe(other !== flag);
  });

  it("sends every switch that is off, together", () => {
    expect(formToParams(form({ ringsEnabled: false, punchEnabled: false, backfillEnabled: false }))).toMatchObject({
      rings_enabled: false,
      punch_enabled: false,
      backfill_enabled: false,
    });
  });

  it("sends the symmetry average only switched on, with its Laue class", () => {
    const off = formToParams(form({ symmetryAverageEnabled: false, symmetryLaue: "6/mmm", symmetryReaverage: true }));
    expect(Object.keys(off).filter((k) => k.startsWith("symmetry"))).toEqual([]);
    expect(formToParams(form({ symmetryAverageEnabled: true, symmetryLaue: " 6/mmm ", symmetryReaverage: false }))).toMatchObject({
      symmetry_average_enabled: true,
      symmetry_average_laue: "6/mmm",
    });
    const blank = formToParams(form({ symmetryAverageEnabled: true, symmetryLaue: "", symmetryReaverage: true }));
    expect(blank).toMatchObject({ symmetry_average_enabled: true, symmetry_average_reaverage: true });
    expect("symmetry_average_laue" in blank).toBe(false);
    // Proceeding despite the metric change: sent only when on, and only with the stage on.
    expect("symmetry_average_allow_metric_change" in blank).toBe(false);
    const proceed = formToParams(form({ symmetryAverageEnabled: true, symmetryLaue: "6/mmm", symmetryAllowMetricChange: true }));
    expect(proceed).toMatchObject({ symmetry_average_allow_metric_change: true });
    const stageOff = formToParams(form({ symmetryAverageEnabled: false, symmetryAllowMetricChange: true }));
    expect("symmetry_average_allow_metric_change" in stageOff).toBe(false);
  });

  // The sample's modulation goes as `modulation`, never as the legacy H
  // fractions (which the backend still reads from an older console).
  it("sends the sample's modulation as declared, nothing for a blank k, and never the legacy H planes", () => {
    const blank = formToParams(form({ modulationK: "", modulationOrder: "2", modulationForm: "planes", modulationHalfWidth: "0.05" }));
    expect(blank).not.toHaveProperty("modulation");
    const declared = formToParams(form({ modulationK: " 1/3, 0, 0 ", modulationOrder: "", modulationForm: "planes", modulationHalfWidth: "0.05" }));
    expect(declared.modulation).toEqual({ k: "1/3, 0, 0", form: "planes", half_width: "0.05" });
    expect(formToParams(form({ modulationK: "0.2, 0, 1/2", modulationOrder: "2", modulationForm: "", modulationHalfWidth: "" })).modulation).toEqual({ k: "0.2, 0, 1/2", order: "2" });
    expect(formToParams(form({ modulationK: "None" })).modulation).toBe("none");
    for (const params of [blank, declared]) {
      expect(params).not.toHaveProperty("punch_search_protect_h");
      expect(params).not.toHaveProperty("punch_search_protect_half_width");
    }
  });
});

describe("the run", () => {
  it.each(SWITCHES)("with %s off sends %s: false and runs the stages switched on", async (field, flag, stage) => {
    usePipelineStore.setState({ [field]: false });
    await usePipelineStore.getState().run();

    expect(api.runPipeline).toHaveBeenCalledTimes(1);
    expect(sent().params[flag]).toBe(false);
    expect(sent().stages).toEqual(enabledStages(form()));
    expect(sent().stages).not.toContain(stage);
    expect(sent().stages).toContain("pdf");
    expect(sent().flatten_enabled).toBe(true);
  });

  it("runs the symmetry average first when it is on, and not at all off", async () => {
    usePipelineStore.setState({ symmetryAverageEnabled: true, symmetryLaue: "m-3m" });
    await usePipelineStore.getState().run();
    expect(sent().stages?.[0]).toBe("symmetry_average");
    expect(sent().params).toMatchObject({ symmetry_average_enabled: true, symmetry_average_laue: "m-3m" });
    usePipelineStore.setState({ symmetryAverageEnabled: false, symmetryLaue: "" });
    expect(enabledStages(form())).not.toContain("symmetry_average");
  });

  it("sends the switches with a run of chosen stages too (the Pilot's and the tuning's)", async () => {
    usePipelineStore.setState({ ringsEnabled: false });
    const ended = usePipelineStore.getState().runStages(["punch"], { datasetId: "demo", force: true });
    await vi.waitFor(() => expect(api.runPipeline).toHaveBeenCalledTimes(1));
    expect(sent().stages).toEqual(["punch"]);
    expect(sent().params).toMatchObject({ rings_enabled: false, punch_enabled: true, backfill_enabled: true });
    usePipelineStore.setState({ running: false, terminal: "done" }); // the job's end, as the SSE stream sets it
    expect(await ended).toBe("done");
  });
});
