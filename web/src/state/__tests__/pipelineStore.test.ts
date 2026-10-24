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
