// The dev-data module's own tests: the interface (devCase) holds the dev split
// and starts each handle fresh, every Pilot tool that reaches the backend runs
// through the CPython bridge, a bridge that dies is replaced, and the Worker
// seam's two adapters carry the same messages (this file pins bridgeWorker.ts
// to pyodideWorker.ts's WorkerRequest union; tests/test_webbridge.py pins
// bridge.py to it).

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { fetchDatasets } from "../../../api/client";
import { cancelPipeline } from "../../../api/pyodideEngine";
import { usePipelineStore } from "../../../state/pipelineStore";
import type { WorkerRequest } from "../../../workers/pyodideWorker";
import { toolsWhere } from "../../tools";
import { contentTuner } from "../scripted";
import { casesIn } from "../validation";
import { bridgeConfig, bridgesStarted, clearRelayedErrors, currentBridge, relayedErrors, WORKER_MESSAGES } from "./bridgeWorker";
import { DEV_CASE_IDS, devCase } from "./index";

describe("the dev split only", () => {
  it("names the manifest's dev cases, every one of them", () => {
    expect([...DEV_CASE_IDS].sort()).toEqual(casesIn("dev").map((c) => c.id).sort());
  });

  it("refuses any other id before Python starts, and the bridge refuses it too", async () => {
    const before = bridgesStarted();
    // @ts-expect-error an id outside the dev split is no DevCaseId
    expect(() => devCase("not-a-dev-case")).toThrow(/"not-a-dev-case" is not a dev case of the validation/);
    expect(bridgesStarted()).toBe(before);

    // The bridge's own check, past the type and the manifest.
    await devCase("dev-control").dataset();
    const { n } = bridgeConfig();
    await expect(currentBridge()!.control({ type: "dev_case", case: "not-a-dev-case", n, arm: "B", run: 1 })).rejects.toThrow(
      /'not-a-dev-case' is not a dev case of the validation: the bridge builds the dev split only/,
    );
  });

  it("gives each case its truth and fault from the manifest", () => {
    const ub = devCase("dev-ub");
    expect(ub.truth).toEqual(casesIn("dev").find((c) => c.id === "dev-ub")!.truth);
    expect(ub.fault).toEqual(casesIn("dev").find((c) => c.id === "dev-ub")!.fault);
  });
});

describe("each handle starts fresh", () => {
  it("from its case's default run: the settings, the outputs and the run's log", async () => {
    const a = devCase("dev-flatten");
    const before = await a.tool("assess_stage", { stage: "flatten" });
    const log = await a.tool("run_log");
    expect(log.ok, log.summary).toBe(true);
    expect((await a.tool("update_settings", { changes: { flattenQ2: true } })).ok).toBe(true);
    const rerun = await a.tool("run_pipeline", { from_stage: "flatten" });
    expect(rerun.ok, rerun.summary).toBe(true);
    expect(rerun.result.stages).toEqual({ flatten: "computed", pdf: "computed", pdf_check: "computed" });
    const after = await a.tool("assess_stage", { stage: "flatten" });
    expect(after.result).not.toEqual(before.result);

    const b = devCase("dev-flatten");
    const fresh = await b.tool("assess_stage", { stage: "flatten" });
    expect(usePipelineStore.getState().flattenQ2).toBe(false);
    expect(fresh.result).toEqual(before.result);
    expect((await b.tool("run_log")).result).toEqual(log.result);
    // The bridge holds one workspace: the older handle's calls fail.
    await expect(a.tool("assess_stage", { stage: "flatten" })).rejects.toThrow(/superseded/);
  });

  it("returns a tool's failure as ok: false, with its message", async () => {
    const c = devCase("dev-control");
    const bad = await c.tool("measure_reciprocal_cut", { plane: "hk0", value: 99 });
    expect(bad).toMatchObject({ ok: false, result: { error: expect.stringMatching(/L = 99 is outside the data range/) }, outcomes: [] });
    await expect(c.tool("no_such_tool")).rejects.toThrow(/no tool named no_such_tool/);
  });
});

// The arguments each tool that reaches the backend runs with here; the test
// below fails until a new such tool is given its own.
const BACKEND_CALLS: Record<string, Record<string, unknown>> = {
  describe_dataset: {},
  current_view: {},
  measure_reciprocal_cut: { plane: "h0l", value: 0 },
  measure_dpdf_cut: { plane: "xy", value: 0 },
  assess_stage: { stage: "all" },
  texture_check: {},
  qmax_coverage: {},
  symmetry_check: {},
  dpdf_contrast: {},
  dpdf_peaks: {},
  grain_check: {},
  ub_check: {},
  radial_profile: {},
  line_profile: { stage: "flattened", along: "H", at: { K: 0, L: 0 } },
  bragg_peaks: {},
  consistency_details: {},
  compare_datasets: { kind: "dpdf", plane: "xy", value: 0 },
  show_in_viewer: { view: "cleanup", plane: "hk0", value: 0 },
  mark_region: { where: "flatten", shape: "ellipsoid", center: [0.5, 0.5, 0], half_size: [0.2, 0.2, 0.2], label: "a diffuse maximum", evidence: ["measure_reciprocal_cut"] },
  run_pipeline: { from_stage: "pdf" },
  tune_pipeline: { stages: ["pdf"], trials_per_stage: 2 },
  regrid_refined_ub: {},
};

// The user's latest message for a tool that runs only when it is asked for (its facts' askedFor).
const ASKED: Record<string, string> = { regrid_refined_ub: "Regrid the volume onto the refined UB." };

// The reply's steps before a call that rests on one (mark_region's evidence):
// the cut measured earlier in this loop, before the run that recomputes the ΔPDF alone.
const MEASURED = { id: "0:c", name: "measure_reciprocal_cut", args: { plane: "h0l", value: 0 }, status: "done" as const, result: JSON.stringify({ cut: "H–L plane at K = 0" }) };
const REPLY: Record<string, (typeof MEASURED)[]> = { mark_region: [MEASURED] };

describe("the tools, through the bridge", () => {
  it("runs every tool that reaches the backend on dev-control, and no bridge call fails", async () => {
    expect(Object.keys(BACKEND_CALLS).sort()).toEqual(toolsWhere((f) => f.reachesBackend).sort());
    const c = devCase("dev-control");
    await c.dataset();
    clearRelayedErrors();
    const restore = contentTuner();
    try {
      for (const [name, args] of Object.entries(BACKEND_CALLS)) {
        const r = await c.tool(name, args, { userMessage: ASKED[name], replySteps: REPLY[name] });
        expect(r.ok, `${name}: ${r.summary}`).toBe(true);
      }
    } finally {
      restore();
    }
    // The tools read through safe(), which hides a failed call: the bridge saw none.
    expect(relayedErrors()).toEqual([]);
  });
});

describe("a bridge that dies", () => {
  it("fails the calls in flight with the tail of its stderr, and the next handle starts a new one", async () => {
    // The Cancel button's path first: the worker ends without an error, and
    // the next call boots a new bridge (the case's run is restored in it).
    cancelPipeline();
    const c = devCase("dev-control");
    const { id } = await c.dataset();
    const dying = currentBridge()!;
    const started = bridgesStarted();

    const run = usePipelineStore.getState().runStages(["pdf", "pdf_check"], { datasetId: id, force: true });
    await vi.waitFor(() => expect(dying.requestsInFlight()).toBeGreaterThan(0), { interval: 5 });
    dying.kill();
    expect(await run).toBe("error");
    const { events } = usePipelineStore.getState();
    const failed = events[events.length - 1]?.message ?? "";
    expect(failed).toMatch(/^Worker error: the CPython bridge \(pid \d+\) exited \(signal SIGKILL\); its stderr ends:\n/);
    // The bridge writes a line to stderr as it starts, so its tail is never empty.
    expect(dying.stderrTail()).not.toBe("");
    expect(failed.endsWith(`\n${dying.stderrTail()}`)).toBe(true);
    expect(currentBridge()).toBeNull();

    const next = devCase("dev-control");
    expect((await next.tool("ub_check")).ok).toBe(true);
    expect(bridgesStarted()).toBe(started + 1);
    expect(currentBridge()!.pid).not.toBe(dying.pid);
    expect((await fetchDatasets()).map((d) => d.id)).toEqual([id]);
  });
});

describe("the Worker seam's protocol", () => {
  it("carries every WorkerRequest type of the pipeline worker", () => {
    // A type test: tsc fails here when WorkerRequest gains or loses a type.
    expectTypeOf<keyof typeof WORKER_MESSAGES>().toEqualTypeOf<WorkerRequest["type"]>();
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    expect(WORKER_MESSAGES.load_file({ id: 7, type: "load_file", name: "v.nxs", buffer })).toEqual({
      header: { id: 7, type: "load_file", name: "v.nxs" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(WORKER_MESSAGES.json_call({ id: 8, type: "json_call", method: "datasets_json", args: [] })).toEqual({
      header: { id: 8, type: "json_call", method: "datasets_json", args: [] },
    });
  });

  it("refuses the ring workers' port: the pool is off", async () => {
    await devCase("dev-control").dataset();
    expect(() => currentBridge()!.postMessage({ type: "ring_port" })).toThrow(/carries no Worker message "ring_port"/);
  });
});
