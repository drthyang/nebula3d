// The assistant's tools against a mocked API: argument checking, the line
// profile's row/column pick, the Bragg-peak sort, show_in_viewer moving the
// console's stores, and the two that act: update_settings and run_pipeline.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraggProfile, Dataset, VolumeMeta } from "../../api/types";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { useTuneStore, type StageRun } from "../tune/tuner";
import { callTool, CHAT_TOOLS, toolsWithSkills, type Args, type ToolContext } from "../tools";
import { makeSlice } from "./helpers";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchProtectedLabels: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const evaluate = vi.hoisted(() => ({ evaluateStage: vi.fn() }));
vi.mock("../tune/evaluate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tune/evaluate")>()),
  evaluateStage: evaluate.evaluateStage,
}));

const tuner = vi.hoisted(() => ({ startTuning: vi.fn() }));
vi.mock("../tune/tuner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tune/tuner")>()),
  startTuning: tuner.startTuning,
}));

const dataset: Dataset = {
  id: "demo",
  temperature: "T1",
  raw_name: "demo.nxs",
  stem: "demo",
  stages: [
    { name: "raw", exists: true, kind: "hkl", volume_id: "demo.raw" },
    { name: "flattened", exists: true, kind: "hkl", volume_id: "demo.flattened" },
    { name: "delta_pdf", exists: true, kind: "delta_pdf", volume_id: "demo.delta_pdf" },
  ],
};
const ctx: ToolContext = { dataset, datasets: [dataset] };

const META: VolumeMeta = {
  id: "demo.raw",
  stage: "raw",
  kind: "hkl",
  shape: [21, 21, 11],
  h_range: [-2, 2],
  k_range: [-2, 2],
  l_range: [-1, 1],
  lattice: { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 90 },
  planes: ["hk0", "h0l", "0kl"],
};

const run = (name: string, args: Args) => callTool(ctx, name, args);

beforeEach(() => {
  vi.resetAllMocks();
  api.fetchMeta.mockResolvedValue(META);
  api.fetchDpdfMeta.mockResolvedValue({
    id: "demo.delta_pdf",
    shape: [41, 41, 21],
    x_range: [-20, 20],
    y_range: [-20, 20],
    z_range: [-10, 10],
    lattice: META.lattice,
    q_max: 6,
    planes: ["xy", "xz", "yz"],
  });
});

describe("callTool", () => {
  it("reports unparseable arguments and unknown tools to the model", async () => {
    const bad = await callTool(ctx, "describe_dataset", "{oops");
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/not a JSON object/);
    const unknown = await run("delete_everything", {});
    expect(unknown.text).toMatch(/no tool named delete_everything/);
  });

  it("runs the registry's tools unless it is given others, against the context it is given", async () => {
    const own: ToolContext = { dataset, datasets: [dataset], skillsRead: new Set() };
    const read = await callTool(own, "read_skill", { name: "reduction-qc" });
    expect(read.ok).toBe(true);
    expect(own.skillsRead?.has("reduction-qc")).toBe(true); // the context itself, not a copy of it
    const off = await callTool(own, "read_skill", { name: "reduction-qc" }, { tools: toolsWithSkills(CHAT_TOOLS, false) });
    expect(off.text).toMatch(/^Error: no tool named read_skill\. Available: describe_dataset, /);
  });

  it("rejects an out-of-range cut with the valid range", async () => {
    const r = await run("measure_reciprocal_cut", { plane: "hk0", value: 5 });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/invalid arguments — L = 5 is outside the data range \[-1, 1\]/);
  });

  it("rejects an unknown plane", async () => {
    const r = await run("measure_reciprocal_cut", { plane: "hkl", value: 0 });
    expect(r.text).toMatch(/plane must be one of hk0, h0l, 0kl/);
  });
});

describe("describe_dataset", () => {
  it("says whether σ came with the data, and when √|I| makes it count nothing fixed", async () => {
    const plain = JSON.parse((await run("describe_dataset", {})).text);
    expect(plain.sigma).toBeNull();
    expect(plain).not.toHaveProperty("sigma_note");
    const note = "No σ came with this volume, so σ is taken as √|I| …";
    api.fetchMeta.mockResolvedValue({ ...META, sigma: "estimated", sigma_note: note });
    const estimated = JSON.parse((await run("describe_dataset", {})).text);
    expect(estimated.sigma).toBe("estimated");
    expect(estimated.sigma_note).toBe(note);
  });
});

describe("line_profile", () => {
  it("reads the row through the requested coordinate and finds its maximum", async () => {
    // hk0 plane: x = H, y = K.  A peak on the K = 1 row at H = 0.6.
    api.fetchSlice.mockResolvedValue(
      makeSlice(21, 21, (x, y) => (Math.abs(y - 1) < 1e-9 && Math.abs(x - 0.6) < 1e-9 ? 50 : 1), { half: 2 }),
    );
    const r = await run("line_profile", { stage: "flattened", along: "H", at: { K: 1, L: 0 }, n_points: 21 });
    expect(r.ok).toBe(true);
    expect(api.fetchSlice).toHaveBeenCalledWith("demo.flattened", "hk0", 0);
    const res = JSON.parse(r.text);
    expect(res.through).toEqual({ K: 1, L: 0 });
    expect(res.max).toEqual({ at: 0.6, value: 50 });
    expect(res.points).toHaveLength(21);
  });

  it("reads a column when the line runs along the plane's y axis", async () => {
    // Line along L through H = 0.4, K = 0 → the h0l plane (x = H, y = L) at K = 0,
    // on the meta's grid: H ∈ [-2, 2] (21 points), L ∈ [-1, 1] (11 points).
    const slice = makeSlice(21, 11, () => 0);
    slice.header.x_axis = Array.from({ length: 21 }, (_v, i) => -2 + 0.2 * i);
    slice.header.y_axis = Array.from({ length: 11 }, (_v, i) => -1 + 0.2 * i);
    slice.data[3 * 21 + 12] = 9; // L = -0.4 (row 3), H = 0.4 (column 12)
    api.fetchSlice.mockResolvedValue(slice);
    const r = await run("line_profile", { stage: "raw", along: "L", at: { H: 0.4, K: 0 } });
    expect(api.fetchSlice).toHaveBeenCalledWith("demo.raw", "h0l", 0);
    const res = JSON.parse(r.text);
    expect(res.through).toEqual({ H: 0.4, K: 0 });
    expect(res.max).toEqual({ at: -0.4, value: 9 });
  });
});

describe("bragg_peaks", () => {
  it("sorts by significance by default and by distance on request", async () => {
    const peak = (hkl: [number, number, number], sig: number) => ({
      index: 0,
      source_node_hkl: null,
      center_hkl: hkl,
      q_abs: 1,
      intensity: 10,
      local_background: 1,
      significance: sig,
      width_hkl: [0.1, 0.1, 0.1],
      width_q: [0.1, 0.1, 0.1],
      measured_width_q: [0.05, 0.05, 0.1],
      principal_directions_hkl: [],
      fit_kind: "covariance",
    });
    api.fetchBraggProfile.mockResolvedValue({
      has_profile: true,
      n_peaks: 3,
      punch_frame: "spherical",
      peaks: [peak([1, 0, 0], 8), peak([2, 0, 0], 30), peak([0, 1, 0], 12)],
    } as unknown as BraggProfile);
    const bySig = JSON.parse((await run("bragg_peaks", {})).text);
    expect(bySig.peaks.map((p: { hkl: number[] }) => p.hkl)).toEqual([[2, 0, 0], [0, 1, 0], [1, 0, 0]]);
    expect(bySig.peaks[0].anisotropy).toBe(2);
    const near = JSON.parse((await run("bragg_peaks", { near_hkl: [0, 1, 0], limit: 1 })).text);
    expect(near.peaks).toEqual([expect.objectContaining({ hkl: [0, 1, 0] })]);
  });
});

describe("show_in_viewer", () => {
  it("opens the cleanup page at the cut on the right axis", async () => {
    const r = await run("show_in_viewer", { view: "cleanup", plane: "h0l", value: 0.5 });
    expect(r.ok).toBe(true);
    expect(r.view).toMatchObject({ view: "cleanup", axis: "K", value: 0.5, label: "H–L plane at K = 0.5" });
    expect(useViewerStore.getState().fixedAxis).toBe("K");
    expect(useViewerStore.getState().focus).toEqual({ axis: "K", value: 0.5 });
    expect(useNavStore.getState().tab).toBe("reciprocal");
  });

  it("opens the ΔPDF page with the cut index for the section", async () => {
    await run("show_in_viewer", { view: "dpdf", plane: "xy", value: 5 });
    const s = useDpdfStore.getState();
    // z ∈ [-10, 10] over 21 points → z = 5 is index 15; x and y stay centred.
    expect([s.cutX, s.cutY, s.cutZ]).toEqual([20, 20, 15]);
    expect(useNavStore.getState().tab).toBe("dpdf");
  });
});

describe("update_settings", () => {
  beforeEach(() => usePipelineStore.setState({ punchMinSig: "", ringModel: "pooled", running: false }));

  it("puts a checked change on the Configure page and says where to rerun from", async () => {
    const r = await run("update_settings", { changes: { punchMinSig: 6 } });
    expect(r.ok).toBe(true);
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
    expect(JSON.parse(r.text)).toEqual({ changed: [{ setting: "punchMinSig", from: 5, to: 6 }], rerun_from: "punch" });
  });

  it("leaves a setting already at the value alone", async () => {
    usePipelineStore.setState({ punchMinSig: "6" });
    const r = await run("update_settings", { changes: { punchMinSig: 6 } });
    expect(JSON.parse(r.text)).toEqual({ changed: [], already_set: ["punchMinSig"], rerun_from: null });
    expect(r.summary).toBe("no change: punchMinSig already set");
  });

  it("refuses settings outside the catalog and values out of range", async () => {
    const unknown = await run("update_settings", { changes: { flattenIon: "Fe2+" } });
    expect(unknown.text).toMatch(/invalid arguments — flattenIon cannot be changed/);
    const range = await run("update_settings", { changes: { punchMinSig: 1000 } });
    expect(range.text).toMatch(/punchMinSig must be within/);
    expect(usePipelineStore.getState().punchMinSig).toBe("");
  });

  // The facts about the sample (tune/catalog.ts, SAMPLE_PARAMS) change only
  // when the user's latest message names them: the agent loop hands it to
  // the tools as the context's userMessage.
  describe("a fact about the sample, which only the user sets", () => {
    const FACTS = { modulationK: "", modulationOrder: "", modulationForm: "", modulationHalfWidth: "", punchSupercellH: "", punchSupercellK: "", punchSupercellL: "", flattenIon: "" };
    const refusal = (key: string) => `${key} is a fact about the sample, which only the user sets: ask the user, and change it once they name it.`;
    /** update_settings after the user's latest message `said`. */
    const after = (said: string | undefined, changes: Args) => callTool({ ...ctx, userMessage: said }, "update_settings", { changes });
    beforeEach(() => usePipelineStore.setState(FACTS));

    it("refuses a change the user's latest message does not name, and leaves the store as it was", async () => {
      for (const said of [undefined, "Is the punch clean? Take it to a 3D-ΔPDF you would trust."]) {
        const r = await after(said, { punchSupercellH: 2 });
        expect(r.ok).toBe(false);
        expect(r.text).toBe(`Error: ${refusal("punchSupercellH")}`);
        expect(usePipelineStore.getState()).toMatchObject(FACTS);
      }
      // Each fact the call changes is refused in the same words, whatever its value.
      const both = await after("Rerun the punch.", { modulation: "none", punchSupercellK: 99 });
      expect(both.text).toBe(`Error: ${refusal("modulation")} ${refusal("punchSupercellK")}`);
      expect(usePipelineStore.getState()).toMatchObject(FACTS);
      // Satellites alone name nothing: what the data show is no declaration.
      const satellites = await after("Are there satellites at H = n ± 1/3? Keep them.", { modulation: { k: "1/3, 0, 0", form: "planes" } });
      expect(satellites.text).toBe(`Error: ${refusal("modulation")}`);
      expect(usePipelineStore.getState()).toMatchObject(FACTS);
    });

    it("makes the change once the user's latest message names it", async () => {
      const r = await after("The volume is indexed on a doubled cell along H: set the punch cell to 2 along H.", { punchSupercellH: 2 });
      expect(r.ok, r.text).toBe(true);
      expect(JSON.parse(r.text)).toEqual({ changed: [{ setting: "punchSupercellH", from: 1, to: 2 }], rerun_from: "punch" });
      expect(usePipelineStore.getState().punchSupercellH).toBe("2");
    });

    it("refuses the fact the message does not name and makes the call's other changes, and says both", async () => {
      const r = await after("Raise the punch significance to 6.", { punchMinSig: 6, punchSupercellH: 2 });
      expect(r.ok, r.text).toBe(true);
      expect(usePipelineStore.getState()).toMatchObject({ punchMinSig: "6", punchSupercellH: "" });
      expect(JSON.parse(r.text)).toEqual({
        changed: [{ setting: "punchMinSig", from: 5, to: 6 }],
        refused: [{ setting: "punchSupercellH", why: refusal("punchSupercellH") }],
        rerun_from: "punch",
      });
      expect(r.summary).toBe("punchMinSig 5 → 6; refused, a fact about the sample: punchSupercellH");
      // A fact the message names beside one it does not: the named one changes.
      const declared = await after("The sample has a modulation with k = (1/2, 0, 0); declare it as planes.", {
        modulation: { k: "1/2, 0, 0", form: "planes" },
        punchSupercellH: 2,
      });
      expect(JSON.parse(declared.text)).toEqual({
        changed: [{ setting: "modulation", from: "default", to: "k = (1/2, 0, 0), order 1, planes, ± 0.08 r.l.u." }],
        refused: [{ setting: "punchSupercellH", why: refusal("punchSupercellH") }],
        rerun_from: "punch",
      });
      expect(usePipelineStore.getState()).toMatchObject({ modulationK: "1/2, 0, 0", modulationForm: "planes", modulationOrder: "", modulationHalfWidth: "", punchSupercellH: "" });
    });

    it("declares the sample's modulation the user names, in the form the user names, as one setting of four fields", async () => {
      const said = "The sample's modulation is k = (0.2, 0, 1/2), order 2, as points, ± 0.05 r.l.u.";
      const r = await after(said, { modulation: { k: [0.2, 0, "1/2"], order: 2, form: "points", half_width: 0.05 } });
      expect(r.ok, r.text).toBe(true);
      expect(usePipelineStore.getState()).toMatchObject({ modulationK: "0.2, 0, 1/2", modulationOrder: "2", modulationForm: "points", modulationHalfWidth: "0.05" });
      expect(JSON.parse(r.text).changed).toEqual([{ setting: "modulation", from: "default", to: "k = (0.2, 0, 1/2), order 2, points, ± 0.05 r.l.u." }]);
      // The line configure_settings shows reads back as the same declaration: no change.
      const shown = (JSON.parse((await run("configure_settings", {})).text) as { settings: Record<string, unknown> }).settings;
      expect(shown.modulation).toBe("k = (0.2, 0, 1/2), order 2, points, ± 0.05 r.l.u.");
      expect(shown).not.toHaveProperty("modulationK");
      const same = await after(said, { modulation: shown.modulation });
      expect(JSON.parse(same.text)).toEqual({ changed: [], already_set: ["modulation"], rerun_from: null });
      // None, and back to the backend's default; k alone, in the default form.
      await after("Declare no modulation.", { modulation: "none" });
      expect(usePipelineStore.getState()).toMatchObject({ modulationK: "none", modulationOrder: "", modulationForm: "", modulationHalfWidth: "" });
      await after("Put the modulation back to the default.", { modulation: "default" });
      expect(usePipelineStore.getState().modulationK).toBe("");
      await after("The wave vector is k = (1/3, 1/3, 0).", { modulation: "1/3, 1/3, 0" });
      expect(usePipelineStore.getState()).toMatchObject({ modulationK: "1/3, 1/3, 0", modulationForm: "" });
      // What is no declaration is refused with what is wrong, and nothing changes.
      for (const [bad, why] of [
        [{ k: "thirds" }, /k is one or more vectors of three components/],
        [{ k: "0, 0, 0" }, /k is one or more vectors/],
        [{ k: "1/3, 0, 0", order: 7 }, /order is a whole number from 1 to 6/],
        [{ k: "1/3, 0, 0", form: "rods" }, /form is points or planes/],
        [{ k: "1/3, 0, 0", half_width: 0.5 }, /half_width is above 0 and below 0.5/],
        [{ form: "planes" }, /modulation needs k/],
        [{ k: "1/3, 0, 0", normal: [1, 0, 0] }, /modulation takes k, order, form and half_width; not normal/],
      ] as const) {
        const refused = await after("Set the modulation.", { modulation: bad });
        expect(refused.text, JSON.stringify(bad)).toMatch(why);
        expect(usePipelineStore.getState().modulationK).toBe("1/3, 1/3, 0");
      }
    });

    it("sets the punch cell the user names", async () => {
      // The punch cell, for a volume indexed on a doubled cell: the words name all three axes.
      await after("Index the punch on a 2×2×2 supercell.", { punchSupercellH: 2, punchSupercellK: 2, punchSupercellL: 2 });
      expect(usePipelineStore.getState()).toMatchObject({ punchSupercellH: "2", punchSupercellK: "2", punchSupercellL: "2" });
    });

    it("never sets the magnetic ion, which stays with the user, whatever the message says", async () => {
      const r = await after("Use Tb3+ for the flatten.", { flattenIon: "Tb3+" });
      expect(r.text).toMatch(/invalid arguments — flattenIon cannot be changed/);
      expect(usePipelineStore.getState().flattenIon).toBe("");
    });
  });
});

describe("run_pipeline", () => {
  const events = [
    { type: "progress", stage: "rings", status: "skip", message: "ring-removed output exists" },
    { type: "progress", stage: "punch", status: "start", message: "Bragg punch" },
    { type: "progress", stage: "punch", status: "progress", fraction: 0.5, message: "fitting peaks" },
    { type: "progress", stage: "punch", status: "done", fraction: 1, message: "punch complete" },
  ];
  // A run that streams `events` into the store, then ends `ending`.
  const fakeRun = (ending: string, evs = events) =>
    vi.fn(async () => {
      usePipelineStore.setState({ running: true, events: [] });
      for (const ev of evs) usePipelineStore.setState((s) => ({ events: [...s.events, ev] }));
      usePipelineStore.setState({ running: false, terminal: ending });
      return ending;
    });

  beforeEach(() => {
    usePipelineStore.setState({ running: false, force: false, flatten: true, pdfEnabled: true, events: [] });
    useNavStore.setState({ tab: "config" });
  });

  it("runs the enabled stages, streams its progress, and reads the fresh dataset", async () => {
    const runStages = fakeRun("done");
    usePipelineStore.setState({ runStages });
    const fresh = { ...dataset, stages: [...dataset.stages, { name: "braggpunched", exists: true, kind: "hkl", volume_id: "demo.braggpunched" }] };
    api.fetchDataset.mockResolvedValue(fresh);
    const own = { ...ctx };
    const lines: string[] = [];
    const r = await callTool(own, "run_pipeline", {}, { progress: (t) => lines.push(t) });
    expect(r.ok).toBe(true);
    expect(runStages).toHaveBeenCalledWith(["rings", "punch", "backfill", "flatten", "pdf", "pdf_check"], { datasetId: "demo", force: false });
    expect(useNavStore.getState().tab).toBe("execution");
    expect(lines).toContain("2/6 Bragg punch 50% · fitting peaks");
    const out = JSON.parse(r.text);
    expect(out.stages).toEqual({ rings: "reused", punch: "computed" });
    expect(out.outputs).toContain("braggpunched");
    expect(own.dataset).toBe(fresh);
    expect(r.summary).toMatch(/^done in .* s · 1 computed, 1 reused$/);
  });

  it("recomputes from a stage on", async () => {
    const runStages = fakeRun("done");
    usePipelineStore.setState({ runStages, flatten: false });
    api.fetchDataset.mockResolvedValue(dataset);
    await callTool({ ...ctx }, "run_pipeline", { from_stage: "punch" });
    expect(runStages).toHaveBeenCalledWith(["punch", "backfill", "pdf", "pdf_check"], { datasetId: "demo", force: true });
  });

  it("reports a failed run as an error with its last error line", async () => {
    usePipelineStore.setState({
      runStages: fakeRun("error", [{ type: "progress", stage: "backfill", status: "error", message: "out of memory" }]),
    });
    const r = await callTool({ ...ctx }, "run_pipeline", {});
    expect(r.ok).toBe(false);
    expect(r.text).toBe("Error: the run failed: Backfill · out of memory");
  });

  it("will not start while another run is going", async () => {
    const runStages = vi.fn();
    usePipelineStore.setState({ running: true, runStages });
    const r = await callTool({ ...ctx }, "run_pipeline", {});
    expect(r.text).toMatch(/a pipeline run is in progress/);
    expect(runStages).not.toHaveBeenCalled();
  });

  it("cancels the run when the reply is stopped", async () => {
    const abort = new AbortController();
    const cancel = vi.fn(async () => undefined);
    usePipelineStore.setState({
      cancel,
      runStages: vi.fn(async () => {
        abort.abort();
        return "cancelled";
      }),
    });
    const r = await callTool({ ...ctx }, "run_pipeline", {}, { signal: abort.signal });
    expect(cancel).toHaveBeenCalled();
    expect(r.text).toMatch(/the run was cancelled/);
  });
});

describe("tune_pipeline", () => {
  const stage = (s: Partial<StageRun> & Pick<StageRun, "stage">): StageRun => ({ tuned: true, status: "waiting", trials: [], ...s });

  beforeEach(() => {
    usePipelineStore.setState({ running: false });
    useTuneStore.setState({ active: false, stages: [], error: null, finishedNote: null });
  });

  it("tunes the chosen stages, streams its trials, and returns what it kept", async () => {
    tuner.startTuning.mockImplementation(async () => {
      useTuneStore.setState({
        active: true,
        stages: [
          stage({ stage: "punch", status: "running", trials: [{ n: 1, changes: {}, settings: {}, status: "done" }, { n: 2, changes: { punchMinSig: 6 }, settings: {}, status: "running" }] }),
          stage({ stage: "backfill", tuned: false }),
        ],
      });
      useTuneStore.setState({
        active: false,
        finishedNote: "Done.",
        stages: [
          stage({ stage: "punch", status: "done", best: 2, why: "fewer leftover peaks", trials: [{ n: 1, changes: {}, settings: {}, status: "done" }, { n: 2, changes: { punchMinSig: 6 }, settings: {}, status: "done" }] }),
          stage({ stage: "backfill", tuned: false, status: "done", best: 1, trials: [{ n: 1, changes: {}, settings: {}, status: "done" }] }),
        ],
      });
    });
    const lines: string[] = [];
    const r = await callTool({ ...ctx }, "tune_pipeline", { stages: ["backfill", "punch"], trials_per_stage: 2 }, { progress: (t) => lines.push(t) });
    expect(r.ok).toBe(true);
    expect(tuner.startTuning).toHaveBeenCalledWith(expect.objectContaining({ dataset, stages: ["backfill", "punch"], trialsPerStage: 2 }));
    expect(lines).toEqual(["1/2 Bragg punch · trial 2/2 running"]);
    const out = JSON.parse(r.text);
    expect(out.stages[0]).toMatchObject({ stage: "punch", chosen_trial: 2, of: 2, changes: { punchMinSig: 6 }, why: "fewer leftover peaks" });
    expect(out.write_outputs_with).toEqual({ tool: "run_pipeline", from_stage: "punch" });
    expect(r.summary).toMatch(/settings changed on 1 of 2 stages$/);
    expect(useNavStore.getState().tab).toBe("execution");
  });

  it("returns every trial's numbers, marks a trial with no effect, and asks for no write when nothing changed", async () => {
    const same = { leftover_at_nodes: 16, leftover_off_lattice_sharp: 8, leftover_off_lattice_broad: 360, mean_punched_fraction: 0.099 };
    tuner.startTuning.mockImplementation(async () => {
      useTuneStore.setState({
        active: false,
        finishedNote: "Done. Your settings won every tuned stage, so nothing changed.",
        stages: [
          stage({
            stage: "punch",
            status: "done",
            best: 1,
            why: "the others did no better",
            trials: [
              { n: 1, changes: {}, settings: {}, status: "done", evaluation: same },
              { n: 2, changes: { punchMinSig: 3 }, settings: {}, status: "done", evaluation: { ...same } },
              { n: 3, changes: { punchSearchFloor: 20 }, settings: {}, status: "done", evaluation: { ...same, mean_punched_fraction: 0.102 } },
            ],
          }),
        ],
      });
    });
    const out = JSON.parse((await callTool({ ...ctx }, "tune_pipeline", { stages: ["punch"] })).text);
    const trials = out.stages[0].trials;
    expect(trials.map((t: { n: number }) => t.n)).toEqual([1, 2, 3]);
    expect(trials[1]).toMatchObject({ changes: { punchMinSig: 3 }, no_effect: true });
    expect(trials[2].no_effect).toBeUndefined();
    expect(trials[2].result).toMatch(/punched 0.102/);
    expect(out.write_outputs_with).toBeUndefined();
  });

  it("reports a tuning run that stopped on an error", async () => {
    tuner.startTuning.mockImplementation(async () => useTuneStore.setState({ error: "the run with your settings failed" }));
    const r = await callTool({ ...ctx }, "tune_pipeline", {});
    expect(r.text).toBe("Error: tuning stopped: the run with your settings failed");
  });

  it("checks its arguments before starting", async () => {
    const r = await callTool({ ...ctx }, "tune_pipeline", { trials_per_stage: 9 });
    expect(r.text).toMatch(/trials_per_stage must be within \[2, 5\]/);
    expect(tuner.startTuning).not.toHaveBeenCalled();
  });
});

// Every stage on disk, for the tools that compare stages.
const STAGE_NAMES = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened"];
const full: Dataset = {
  ...dataset,
  stages: [
    ...STAGE_NAMES.map((name) => ({ name, exists: true, kind: "hkl" as const, volume_id: `demo.${name}` })),
    { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: "demo.delta_pdf" },
  ],
};
const runOn = (ds: Dataset, name: string, args: Args) => callTool({ dataset: ds, datasets: [ds] }, name, args);

describe("assess_stage", () => {
  it("judges each stage that exists by its criterion, headline numbers only for all", async () => {
    evaluate.evaluateStage.mockImplementation(async (stage: string) =>
      stage === "flatten"
        ? { max_after_floor_sigma: 0.8, max_floor_trend: 0.3, max_floor_span_fraction: 0.6, per_plane: { hk0: {} } }
        : { back_fft_pearson_r: 0.99, back_fft_normalized_rms: 0.1, mean_feature_snr: 40, per_plane: {} },
    );
    const r = await run("assess_stage", {});
    const out = JSON.parse(r.text);
    expect(out.rings.missing).toMatch(/no ringremoved output yet/);
    expect(out.flatten).toMatchObject({ headline: "floor ≤ 0.8σ · trend ≤ 0.3 · span ≤ 0.6", max_after_floor_sigma: 0.8 });
    expect(out.flatten.criterion).toMatch(/pedestal/);
    // Five stages' per-plane detail and goals would overflow the result.
    expect(out.flatten).not.toHaveProperty("per_plane");
    expect(out.flatten).not.toHaveProperty("goal");
    expect(r.summary).toBe("Flatten: meets its goal · floor ≤ 0.8σ · trend ≤ 0.3 · span ≤ 0.6 · 3D-ΔPDF: needs attention · r 0.99 · RMS 0.1 · SNR 40");
    expect(r.view).toMatchObject({ view: "cleanup", plane: "hk0", value: 0, axis: "L" });
  });

  it("keeps each stage's outcome beside its result, never in it", async () => {
    evaluate.evaluateStage.mockResolvedValue({ max_after_floor_sigma: 0.8, max_floor_trend: 0.9, max_floor_span_fraction: 0.9, per_plane: {} });
    const r = await run("assess_stage", {});
    // The rings' and the punch's outputs are missing on this dataset: no verdict for them.
    expect(r.outcomes?.map((o) => [o.check, o.kind, o.reasons[0] ?? null])).toEqual([
      ["rings", "info", "no output"],
      ["punch", "info", "no output"],
      ["backfill", "info", "no output"],
      ["flatten", "attention", "pedestal"],
      ["pdf", "info", "nothing to judge"], // a ΔPDF evaluation that measured nothing is not judged (D15)
    ]);
    expect(r.text).not.toMatch(/"(outcomes|reasons|dataProblems)"/);
  });

  it("shows the sharp leftovers on protected planes on their own line, out of the punch's verdict (D5, 2.4.5)", async () => {
    evaluate.evaluateStage.mockResolvedValue({ leftover_at_nodes: 0, leftover_off_lattice: 3, leftover_on_protected_planes: 3, leftover_on_protected_planes_sharp: 3, leftover_off_lattice_broad: 0, leftover_off_lattice_sharp: 3, mean_punched_fraction: 0.03, per_plane: {} });
    const out = JSON.parse((await runOn(full, "assess_stage", { stage: "punch" })).text);
    expect(out.punch).toMatchObject({ verdict: "meets its goal", leftover_off_lattice_sharp: 3, leftover_on_protected_planes: 3, leftover_on_protected_planes_sharp: 3 });
    expect(out.punch.goal).toMatch(/sit on protected planes and stay by design/);
  });

  it("keeps the per-plane detail for one stage", async () => {
    evaluate.evaluateStage.mockResolvedValue({ max_after_floor_sigma: 0.8, per_plane: { hk0: { after_floor_max_sigma: 0.8 } } });
    const out = JSON.parse((await run("assess_stage", { stage: "flatten" })).text);
    expect(out.flatten.per_plane.hk0).toEqual({ after_floor_max_sigma: 0.8 });
    expect(out.flatten.goal).toMatch(/floor/);
  });

  it("says the rings the removal left unconfirmed on its grid, the remedy with the skills on only (G1)", async () => {
    evaluate.evaluateStage.mockResolvedValue({
      notice: NOTICE,
      mean_ring_energy_ratio: 1,
      max_ring_dent: null,
      max_ring_left: null,
      ring_rule: "not judged: grid too coarse: 0.99 voxels across a ring's width (at most 0.16 Å⁻¹), under 1",
      per_plane: {},
    });
    const b = JSON.parse((await runOn(full, "assess_stage", { stage: "rings" })).text);
    expect(b.rings).toMatchObject({ verdict: "not judged", notice: NOTICE });
    const armC = await callTool({ dataset: full, datasets: [full], skills: false }, "assess_stage", { stage: "rings" });
    const c = JSON.parse(armC.text);
    expect(c.rings).toMatchObject({ verdict: "not judged", notice: NOTICE_DEFINITION });
    expect(armC.text).not.toContain("pooled_confirm_rings");
  });
});

// The ring removal's notice as the pipeline writes it (nebula3d.pipeline.unconfirmed_rings_notice), and its definition: arm C's.
const NOTICE_DEFINITION =
  "4 ring candidates (shells that may be powder rings or the crystal's own scattering) detected but not confirmed at this grid (needs ≥ 1 voxel across 0.16 Å⁻¹); not subtracted.";
const NOTICE = `${NOTICE_DEFINITION} Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract every candidate, the crystal's own shells included.`;

describe("run_log", () => {
  it("returns the last run's lines, for one stage on request", async () => {
    usePipelineStore.setState({
      running: false,
      terminal: "done",
      events: [
        { type: "progress", stage: "rings", status: "done", message: "9 shells fitted" },
        { type: "progress", stage: "punch", status: "progress", fraction: 0.5 },
        { type: "progress", stage: "punch", status: "done", message: "188 peaks punched" },
      ],
    });
    const all = JSON.parse((await run("run_log", {})).text);
    expect(all.ended).toBe("done");
    expect(all.lines.map((l: { message: string }) => l.message)).toEqual(["9 shells fitted", "188 peaks punched"]);
    const punch = JSON.parse((await run("run_log", { stage: "punch" })).text);
    expect(punch.lines).toEqual([{ stage: "punch", status: "done", message: "188 peaks punched" }]);
  });

  it("says when there is no run yet", async () => {
    usePipelineStore.setState({ events: [] });
    expect((await run("run_log", {})).text).toMatch(/no pipeline run in this session yet/);
  });

  it("gives the ring removal's notice whole with the skills on, without its remedy with them off (G1)", async () => {
    const summary = "pooled ring removal no_confirmed_rings: 0 shells confirmed as rings, 0 not (the crystal's own scattering, kept) (of 81/81 planes fitted), removed 0% of |I|";
    usePipelineStore.setState({
      running: false,
      terminal: "done",
      events: [
        { type: "progress", stage: "rings", status: "done", message: `${summary}. ⚠ ${NOTICE}` },
        { type: "progress", stage: "punch", status: "done", message: "188 peaks punched" },
      ],
    });
    const b = JSON.parse((await run("run_log", { stage: "rings" })).text);
    expect(b.lines).toEqual([{ stage: "rings", status: "done", message: `${summary}. ⚠ ${NOTICE}` }]);
    const c = JSON.parse((await callTool({ ...ctx, skills: false }, "run_log", {})).text);
    expect(c.lines.map((l: { message: string }) => l.message)).toEqual([`${summary}. ⚠ ${NOTICE_DEFINITION}`, "188 peaks punched"]);
  });
});

describe("qmax_coverage", () => {
  // The coverage as Python measures and serves it (nebula3d.analysis.coverage)
  // for tests/test_coverage.py's constructed volumes, its known answers: a
  // cubic cell of 4 Å over ±3 r.l.u. (the nearest face at 4.712 Å⁻¹, the
  // corner at 8.162), counts out to 4.4 Å⁻¹, and past them unmeasured space
  // masked or NaN, where the measured voxels end with the counts, or zeros
  // the volume marks measured, where they fill the box.
  const CUT = {
    id: "demo.raw", q: [], counted: [], q_min_edge: null, q_max_edge: 4.4, full_q_min: 0.35, full_q_max: 4.35,
    measured_q_max: 4.35, box_q: 4.712, box_corner_q: 8.162, q_step: 0.1,
  };
  const ZEROS = { ...CUT, measured_q_max: 7.85 };
  // Counts to the box's corners.
  const FULL_BOX = { ...CUT, q_max_edge: null, full_q_max: 8.05, measured_q_max: 8.05 };
  beforeEach(() => {
    api.fetchVolumeCoverage.mockResolvedValue(CUT);
    usePipelineStore.setState({ pdfQMin: "", pdfQMax: "", pdfApod: "", pdfWindowShape: "", pdfWindowSupport: true });
  });
  const check = async () => JSON.parse((await run("qmax_coverage", {})).text);
  const judged = async () => (await run("qmax_coverage", {})).outcomes?.[0];

  it("reads the coverage Python measures, once, and shows it on the first plane through the origin", async () => {
    const r = await run("qmax_coverage", {});
    expect(api.fetchVolumeCoverage).toHaveBeenCalledWith("demo.raw");
    expect(api.fetchSlice).not.toHaveBeenCalled(); // the planes only show where
    expect(r.view).toMatchObject({ view: "cleanup", plane: "hk0", value: 0 });
    const out = JSON.parse(r.text);
    expect([out.full_coverage_q, out.box_face_q]).toEqual([4.35, 4.712]);
    expect(out.raw_counts).toEqual({ q_min_edge: null, q_max_edge: 4.4, fully_measured: [0.35, 4.35], box_face_q: 4.712 });
    expect(out).not.toHaveProperty("per_plane");
    expect(out).not.toHaveProperty("low_q_gap");
  });

  // The window tapered to the measured coverage reaches it by construction
  // (plan 4.5): the verdict says the reach is the backend's own target, and
  // judges where the counts end and the band.
  it("passes a window tapered to the measured coverage, masked or NaN past the counts, saying the reach is the backend's target", async () => {
    const r = await run("qmax_coverage", {});
    const out = JSON.parse(r.text);
    expect(out.transform_reach_q).toBe(4.35);
    expect(out.reach_from).toBe("the window is tapered to the measured coverage");
    expect(r.outcomes?.[0]).toMatchObject({ kind: "pass", reasons: ["window fitted"], dataProblems: ["the counts end at 4.4 Å⁻¹, inside the box"] });
    expect(out.verdict).toBe(
      "fitted to the coverage: the window is tapered to the measured coverage, where the backend fits it to keep at most 1e-3 of its weight on unmeasured reciprocal space: its own target, not a check; " +
        "the raw counts end at 4.4 Å⁻¹, inside the box (its nearest face at 4.712 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.4 Å⁻¹ (suggested_band), the user's to set",
    );
  });

  // Known answer (tests/test_coverage.py): with zeros stored past the counts and
  // marked measured, the backend's support takes them as data and does not fit
  // the window, so the transform reaches the box faces, past the counts.
  it("flags a volume that stores zeros past its counts: the taper cannot follow them", async () => {
    api.fetchVolumeCoverage.mockResolvedValue(ZEROS);
    const r = await run("qmax_coverage", {});
    const out = JSON.parse(r.text);
    expect(out.full_coverage_q).toBe(4.35); // the counts' edge, as on the NaN volume
    expect(out.transform_reach_q).toBe(4.712);
    expect(out.reach_from).toBe(
      "the window tapers to zero at the box faces: past its counts the volume stores zeros it marks measured, which the taper to the coverage takes as data",
    );
    expect(r.outcomes?.[0]).toMatchObject({ kind: "attention", reasons: ["reach past coverage"], dataProblems: ["the counts end at 4.4 Å⁻¹, inside the box"] });
    // The band is the remedy, not the taper; and no taper keeps the transform on the counts.
    expect(out.verdict).toMatch(/past full coverage at 4\.35 Å⁻¹; set a \|Q\| band at or below it; the raw counts end at 4\.4 Å⁻¹/);
    expect(out.verdict).toContain("and no |Q| band is set: the band they allow is 0–4.4 Å⁻¹");
    expect(out.verdict).not.toMatch(/taper the window|only the window's taper/);
    // Zeros stored up to inside the box, masked past them: the taper follows the measured voxels, past the counts.
    api.fetchVolumeCoverage.mockResolvedValue({ ...ZEROS, measured_q_max: 4.55 });
    const part = await check();
    expect([part.transform_reach_q, part.reach_from]).toEqual([4.55, "the window is tapered to the measured voxels, which run past the counts: the volume stores zeros there"]);
    expect(await judged()).toMatchObject({ kind: "attention", reasons: ["reach past coverage"] });
  });

  it("flags a window that tapers only at the box faces past the coverage", async () => {
    usePipelineStore.setState({ pdfWindowSupport: false });
    const out = await check();
    expect(out.transform_reach_q).toBe(out.box_face_q);
    expect(out.reach_from).toBe("the window tapers to zero at the box faces");
    expect(await judged()).toMatchObject({ kind: "attention", reasons: ["reach past coverage"] });
    // The backend never fits a separable window the page asks for, the support on or not.
    usePipelineStore.setState({ pdfWindowSupport: true, pdfWindowShape: "separable" });
    expect((await check()).reach_from).toBe("the window tapers to zero at the box faces");
    expect(await judged()).toMatchObject({ kind: "attention", reasons: ["reach past coverage"] });
  });

  it("passes the box faces inside a box measured to its corners", async () => {
    api.fetchVolumeCoverage.mockResolvedValue(FULL_BOX);
    const out = await check();
    expect([out.transform_reach_q, out.full_coverage_q, out.counts_end_inside_box]).toEqual([4.712, 8.05, false]);
    expect(out.verdict).toBe("the transform reaches 4.712 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 8.05 Å⁻¹");
  });

  it("gives where the raw counts begin and end, the band they allow, and checks a band that is set", async () => {
    api.fetchVolumeCoverage.mockResolvedValue({
      id: "demo.raw", q: [], counted: [], q_min_edge: 0.61, q_max_edge: 14.204,
      full_q_min: 0.74, full_q_max: 13.6, measured_q_max: 13.6, box_q: 11.05, box_corner_q: 29.4, q_step: 0.1,
    });
    usePipelineStore.setState({ pdfQMin: "", pdfQMax: "" });
    const none = await check();
    expect(none.raw_counts).toEqual({ q_min_edge: 0.61, q_max_edge: 14.2, fully_measured: [0.74, 13.6], box_face_q: 11.05 });
    expect(none.suggested_band).toEqual([0.65, 14.2]);
    expect(none.band_check).toMatch(/^no \|Q\| band is set/);
    usePipelineStore.setState({ pdfQMin: "0.65", pdfQMax: "14.2" });
    expect((await check()).band_check).toBe("the band 0.65–14.2 Å⁻¹ stays inside the counts");
    usePipelineStore.setState({ pdfQMin: "0.2", pdfQMax: "18" });
    expect((await check()).band_check).toMatch(/^Qmin below the counts' lower edge .*; Qmax past the counts' upper edge/);
    expect(api.fetchVolumeCoverage).toHaveBeenCalledWith("demo.raw");
    usePipelineStore.setState({ pdfQMin: "", pdfQMax: "" });
  });

  it("judges an explicit |Q| band by its reach where the window is not fitted, and a flat window by the box corners", async () => {
    usePipelineStore.setState({ pdfWindowSupport: false, pdfQMax: "0.1" });
    expect(await judged()).toMatchObject({ kind: "pass", reasons: ["reach inside coverage"] });
    usePipelineStore.setState({ pdfQMax: "4.6" });
    expect(await judged()).toMatchObject({ kind: "attention", reasons: ["reach past coverage"] });
    usePipelineStore.setState({ pdfWindowSupport: true, pdfQMax: "", pdfApod: "none" });
    const flat = await check();
    expect(flat.transform_reach_q).toBe(6); // the ΔPDF's recorded q_max, the box corner
    expect(flat.reach_from).toMatch(/out to the box corners$/);
    expect(await judged()).toMatchObject({ kind: "attention", reasons: ["reach past coverage"] });
  });

  it("judges by the window's recorded weight on unmeasured space where the window is not fitted to the coverage", async () => {
    usePipelineStore.setState({ pdfWindowSupport: false });
    const meta = await api.fetchDpdfMeta();
    api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "ellipsoid", window_scale: 1, window_open_weight: 4.1e-6 });
    const clean = await check();
    expect(clean.window_weight_on_unmeasured).toBe(4.1e-6);
    expect(clean.window_shape).toBe("ellipsoid");
    expect(clean.verdict).toMatch(/^clean: the ΔPDF's ellipsoid window puts 4\.1e-6 of its weight on unmeasured reciprocal space; /);
    api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "ellipsoid", window_scale: 1, window_open_weight: 4.1e-6 });
    expect(await judged()).toMatchObject({ kind: "pass", reasons: ["window within limit"] });
    // A record past the limit is judged, whatever the page says of the window.
    for (const support of [false, true]) {
      usePipelineStore.setState({ pdfWindowSupport: support });
      api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "separable", window_scale: 1, window_open_weight: 0.04 });
      expect(await judged()).toMatchObject({ kind: "attention", reasons: ["window past limit"] });
    }
  });

  // Plan 4.5: the support on and a window the backend fits, the weight the
  // ΔPDF records is the backend's own target; the verdict judges where the
  // counts end and a band that is set.
  it("says the recorded weight of a window fitted to the coverage is the backend's target, not a check", async () => {
    const meta = await api.fetchDpdfMeta();
    api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "ellipsoid", window_scale: 0.94, window_open_weight: 9.7e-4 });
    const r = await run("qmax_coverage", {});
    expect(r.outcomes?.[0]).toMatchObject({ kind: "pass", reasons: ["window fitted", "window within limit"], dataProblems: ["the counts end at 4.4 Å⁻¹, inside the box"] });
    expect(JSON.parse(r.text).verdict).toMatch(
      /^fitted to the coverage: the ΔPDF's ellipsoid window \(shrunk to 0\.94 × to fit the coverage\) puts 9\.7e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4\.4 Å⁻¹/,
    );
    // Counts that reach the box: nothing else to say.
    api.fetchVolumeCoverage.mockResolvedValue(FULL_BOX);
    api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "separable", window_scale: 1, window_open_weight: 6.3e-4 });
    const full = await run("qmax_coverage", {});
    expect(full.outcomes?.[0]).toMatchObject({ kind: "pass", reasons: ["window fitted", "window within limit"], dataProblems: [] });
    expect(JSON.parse(full.text).verdict).toMatch(/: its own target, not a check; the raw counts reach the box's nearest face$/);
    // Not fitted: zeros stored past the counts (the record's weight judged as before).
    api.fetchVolumeCoverage.mockResolvedValue(ZEROS);
    api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "separable", window_scale: 1, window_open_weight: 6.3e-4 });
    expect(await judged()).toMatchObject({ kind: "pass", reasons: ["window within limit"] });
  });

  it("judges a band set where the window is fitted: inside the counts it passes, past their edges it needs attention", async () => {
    const meta = await api.fetchDpdfMeta();
    const fittedRecord = () => api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "ellipsoid", window_scale: 0.94, window_open_weight: 9.7e-4 });
    usePipelineStore.setState({ pdfQMin: "0", pdfQMax: "4.4" });
    fittedRecord();
    const inside = await run("qmax_coverage", {});
    expect(inside.outcomes?.[0]).toMatchObject({ kind: "pass", reasons: ["window fitted", "window within limit"], dataProblems: ["the counts end at 4.4 Å⁻¹, inside the box"] });
    expect(JSON.parse(inside.text).verdict).toMatch(/: its own target, not a check; the band 0–4\.4 Å⁻¹ stays inside the counts$/);
    usePipelineStore.setState({ pdfQMax: "5.5" });
    fittedRecord();
    const past = await run("qmax_coverage", {});
    expect(past.outcomes?.[0]).toMatchObject({ kind: "attention", reasons: ["band past counts", "window within limit"] });
    expect(JSON.parse(past.text).verdict).toMatch(
      /^too far: Qmax past the counts' upper edge \(4\.4 Å⁻¹\): empty voxels enter the transform; the ΔPDF's ellipsoid window .*: its own target, not a check; the band the counts allow is suggested_band, the user's to set$/,
    );
    // Arm C reads it without the remedy.
    fittedRecord();
    const armC = await callTool({ ...ctx, skills: false }, "qmax_coverage", {});
    expect(JSON.parse(armC.text).verdict).toMatch(/: its own target, not a check$/);
    // No reach is judged with no ΔPDF weight either: the band is.
    expect(await judged()).toMatchObject({ kind: "attention", reasons: ["band past counts"] });
  });

  // A band set without a Qmin starts at 0: below the counts' lower edge only
  // where the counts begin above the origin (a beam stop).
  it("takes a band with no Qmin from 0, past the counts' lower edge only above a beam stop", async () => {
    usePipelineStore.setState({ pdfQMin: "", pdfQMax: "4.4" });
    expect((await check()).band_check).toBe("the band 0–4.4 Å⁻¹ stays inside the counts");
    expect(await judged()).toMatchObject({ kind: "pass", reasons: ["window fitted"] });
    api.fetchVolumeCoverage.mockResolvedValue({ ...CUT, q_min_edge: 0.61, full_q_min: 0.75 });
    expect((await check()).band_check).toBe("Qmin below the counts' lower edge (0.61 Å⁻¹): the beam stop's empty voxels enter the transform");
    expect(await judged()).toMatchObject({ kind: "attention", reasons: ["band past counts"] });
  });

  // The dev coverage case (docs/pilot-review.md finding 7): counts cut at
  // 4.511 Å⁻¹ of a box whose nearest face is 6.444 Å⁻¹, a window shrunk to fit.
  const cut = {
    id: "demo.raw", q: [], counted: [], q_min_edge: null, q_max_edge: 4.507, full_q_min: 0.15, full_q_max: 4.45,
    measured_q_max: 4.45, box_q: 6.444, box_corner_q: 11.16, q_step: 0.1,
  };
  const shrunk = async () => {
    const meta = await api.fetchDpdfMeta();
    api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "ellipsoid", window_scale: 0.695, window_open_weight: 9.8e-4 });
  };

  it("says in the verdict when the counts end inside the box and no band is set", async () => {
    usePipelineStore.setState({ pdfQMin: "", pdfQMax: "" });
    api.fetchVolumeCoverage.mockResolvedValue(cut);
    await shrunk();
    const r = await run("qmax_coverage", {});
    const out = JSON.parse(r.text);
    expect(out.counts_end_inside_box).toBe(true);
    expect(out.window_scale).toBe(0.695);
    // The data's problem, and the verdict's note that only the taper keeps the transform on the counts.
    expect(r.outcomes?.[0]).toMatchObject({ kind: "pass", dataProblems: ["the counts end at 4.507 Å⁻¹, inside the box"] });
    expect(out.verdict).toMatch(/raw counts end/);
    expect(out.band_check).toMatch(/the counts end at 4\.507 Å⁻¹, inside the box \(face 6\.444 Å⁻¹\): the band they allow is 0–4\.5 Å⁻¹$/);
    // With a band set inside the counts, the band does the work: nothing to add.
    usePipelineStore.setState({ pdfQMin: "0", pdfQMax: "4.5" });
    await shrunk();
    const banded = await check();
    expect(banded.verdict).not.toMatch(/raw counts end/);
    expect(banded.band_check).toBe("the band 0–4.5 Å⁻¹ stays inside the counts");
    usePipelineStore.setState({ pdfQMin: "", pdfQMax: "" });
  });

  it("adds nothing where the counts reach the box: a full box, or a turned one whose counts reach past its faces", async () => {
    usePipelineStore.setState({ pdfQMin: "", pdfQMax: "" });
    for (const edge of [null, 10.95, 6.4]) {
      api.fetchVolumeCoverage.mockResolvedValue({ ...cut, q_max_edge: edge, full_q_max: 8.45, measured_q_max: 8.45 });
      await shrunk();
      const out = await check();
      expect(out.counts_end_inside_box).toBe(false); // 6.4: within one coverage shell of the face
      expect(out.verdict).not.toMatch(/raw counts end/);
      expect(out.band_check).toBe("no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach");
    }
  });
});

describe("symmetry_check", () => {
  const hexagonal = async () => {
    const meta = await api.fetchDpdfMeta();
    api.fetchDpdfMeta.mockResolvedValue({ ...meta, lattice: { a: 8, b: 8, c: 10, alpha: 90, beta: 90, gamma: 120 } });
    const section = makeSlice(41, 41, (u, v) => Math.cos(0.7 * u) + Math.cos(0.7 * v) + Math.cos(0.7 * (u - v)) + 0.3 * Math.cos(0.5 * u));
    section.header.axes_angle = 120;
    api.fetchDpdfSlice.mockResolvedValue(section);
  };

  it("reports each in-plane operation of a hexagonal ΔPDF section of data declared symmetrised", async () => {
    await hexagonal();
    api.fetchMeta.mockResolvedValue({ ...META, symmetry: "6/mmm" });
    const r = await runOn(full, "symmetry_check", {});
    const out = JSON.parse(r.text);
    expect(out.cell).toBe("hexagonal");
    expect(out.symmetry_declared).toBe(true);
    expect(out.holds).toEqual(["two-fold (180°)"]);
    expect(r.outcomes).toMatchObject([{ check: "symmetry", kind: "attention", reasons: ["symmetry broken"], words: out.verdict }]);
    expect(api.fetchDpdfSlice).toHaveBeenCalledWith("demo.delta_pdf", "xy", 0);
  });

  it("does not call an asymmetry a break when the file declares no symmetry: the data were not symmetrised", async () => {
    await hexagonal();
    api.fetchMeta.mockResolvedValue({ ...META, symmetry: null });
    const r = await runOn(full, "symmetry_check", {});
    const out = JSON.parse(r.text);
    expect(out.symmetry_declared).toBe(false);
    expect(r.outcomes).toMatchObject([{ check: "symmetry", kind: "info", reasons: ["not declared"], words: out.verdict }]);
    expect(out.ops.length).toBeGreaterThan(0); // the numbers are still there
    expect(r.summary).toBe("no symmetry declared: not judged");
  });
});

describe("dpdf_contrast", () => {
  // Ripple of amplitude 1 everywhere, a huge origin peak, and four compact
  // features of 100: the limit must land on the features.
  const section = makeSlice(81, 81, (u, v) => {
    if (Math.hypot(u, v) < 1) return 1e6;
    const feature = [[20, 0], [-20, 0], [0, 20], [0, -20]].some(([a, b]) => Math.hypot(u - a, v - b) < 1.5);
    return feature ? 100 : Math.sin(3 * u) * Math.cos(3 * v);
  });

  it("sets the viewer's ± limit on the features, not the ripple or the origin peak", async () => {
    api.fetchDpdfSlice.mockResolvedValue(section);
    useDpdfStore.setState({ limit: null });
    const r = await run("dpdf_contrast", {});
    expect(r.ok).toBe(true);
    const out = JSON.parse(r.text);
    expect(out.applied).toMatchObject({ limit: 100, share_of_strongest: 1, from: expect.stringMatching(/^optimised/) });
    expect(out.note).toBeUndefined();
    expect(Object.keys(out.not_applied)).toEqual(["99.5th percentile", "99.97th percentile"]);
    expect(useDpdfStore.getState().limit).toEqual({ value: 100, dataset: "demo" });
    expect(api.fetchDpdfSlice).toHaveBeenCalledWith("demo.delta_pdf", "yz", 0);
    expect(r.view).toMatchObject({ view: "dpdf", plane: "xy" });
  });

  it("takes a limit in σ, refuses a percentile out of range, and goes back to Auto", async () => {
    api.fetchDpdfSlice.mockResolvedValue(section);
    const out = JSON.parse((await run("dpdf_contrast", { limit_sigma: 3 })).text);
    expect(out.applied.limit_sigma).toBe(3);
    expect(out.note).toMatch(/brighter than the optimum .* the FFT ripple around the features will show/);
    expect(useDpdfStore.getState().limit?.value).toBeCloseTo(3 * out.robust_sigma, 1);
    expect((await run("dpdf_contrast", { percentile: 90 })).text).toMatch(/percentile must be within \[99, 99.99\]/);
    await run("dpdf_contrast", { reset: true });
    expect(useDpdfStore.getState().limit).toBeNull();
  });
});

describe("grain_check", () => {
  it("reads the punch's off-lattice peaks with the raw volume's UB and symmetry", async () => {
    const ub = [[2 * Math.PI / 4, 0, 0], [0, 2 * Math.PI / 4, 0], [0, 0, 2 * Math.PI / 6]];
    api.fetchMeta.mockResolvedValue({ ...META, ub_matrix: ub, symmetry: "mmm", symmetry_ops: [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, -1]]] });
    // Off-lattice peaks displaced 0.03 r.l.u. from Bragg nodes, plus a node peak the search did not record.
    const peaks = [
      { index: 0, source_node_hkl: [1, 0, 0], center_hkl: [1, 0, 0], q_abs: 1.6, intensity: 500, local_background: 0 },
      ...[[2, 1, 0], [1, 2, 1], [0, 1, 2], [2, 2, 1], [3, 0, 1], [1, 1, 3], [2, 0, 2], [0, 3, 1]].map(([h, k, l], i) => ({
        index: i + 1, source_node_hkl: null, center_hkl: [h + 0.03, k, l], q_abs: 2, intensity: 100 - i, local_background: 1,
      })),
    ];
    api.fetchBraggProfile.mockResolvedValue({ has_profile: true, n_peaks: peaks.length, peaks });
    usePipelineStore.setState({ punchSupercellH: "", punchSupercellK: "", punchSupercellL: "" }); // the parent cell
    const r = await run("grain_check", { top: 8 });
    expect(r.ok).toBe(true);
    const out = JSON.parse(r.text);
    expect(out.off_lattice_peaks).toBe(8);
    expect(out.declared_symmetry).toBe("mmm");
    expect(out.near_bragg_nodes).toBe(8);
    expect(r.outcomes?.[0]).toMatchObject({ check: "grain", words: out.verdict });
    expect(r.outcomes?.[0].reasons).not.toContain("second grain");
    expect((await run("grain_check", { top: 3 })).text).toMatch(/top must be within \[8, 120\]/);
  });

  it("says so when there is no punch record yet", async () => {
    api.fetchBraggProfile.mockResolvedValue({ has_profile: false, peaks: [] });
    expect((await run("grain_check", {})).text).toMatch(/no punch record yet/);
  });
});

describe("ub_check", () => {
  const check = {
    id: "demo.raw", fit: "symmetric", cell_nodes: [2, 2, 2], operations: 24, operations_from: "demo.nxs", symmetry_break: 0, symmetrised: true,
    passes: [{ q_max: 4.71, n_found: 152, n_used: 152, rms_start: 0.0131, rms: 0.0094, angle_deg: 0 }],
    n_searched: 3912, n_used: 2655, n_rejected: 811, rms_start: 0.04872, rms: 0.03416, angle_deg: 0, axis_uvw: [0, 0, 0],
    cell_start: [6.12407, 6.11593, 9.41236, 90.0812, 90.1544, 119.9861], cell: [6.09922, 6.09111, 9.40151, 90.0812, 90.1544, 119.9861],
    transform: [[1.004073, 0, 0], [0, 1.004073, 0], [0, 0, 1.001154]], ub_start: [], ub: [],
    radial: [
      { q_lo: 0, q_hi: 4, direction: "in-plane", n: 16, before: 0.002611, after: -0.001054 },
      { q_lo: 14, q_hi: null, direction: "oblique", n: 5, before: 0.0036, after: 0.0003 },
    ],
  };

  it("checks the raw volume's UB with the punch cell as the Bragg nodes", async () => {
    api.fetchUbCheck.mockResolvedValue(check);
    usePipelineStore.setState({ punchSupercellH: "2", punchSupercellK: "2", punchSupercellL: "2" });
    const r = await run("ub_check", { q_max: 14 });
    expect(r.ok).toBe(true);
    expect(api.fetchUbCheck).toHaveBeenLastCalledWith("demo.raw", [2, 2, 2], 14);
    const out = JSON.parse(r.text);
    expect(out.fit).toBe("symmetric");
    expect(out.cell_start).toBe("6.1241, 6.1159, 9.4124 Å; 90.081°, 90.154°, 119.986°");
    expect(out.transform_diagonal).toEqual([1.004073, 1.004073, 1.001154]);
    expect(out.radial).toEqual([
      { q: "0–4", direction: "in-plane", n: 16, before: 0.0026, after: -0.0011 },
      { q: "≥ 14", direction: "oblique", n: 5, before: 0.0036, after: 0.0003 },
    ]);
    expect(out.reading).toMatch(/symmetrised: only the UB changes that commute/);
    expect(r.summary).toBe("symmetric: RMS 0.0487 → 0.0342 Å⁻¹ over 2655 peaks; a 6.124 → 6.099 Å, c 9.412 → 9.402 Å; turned 0.000°");
    expect((await run("ub_check", { q_max: -1 })).text).toMatch(/q_max must be positive/);
    expect(out.unexplained).toBe(false); // no voxel size reported: nothing to judge against
  });

  it("says when the peaks sit off their nodes for a reason no UB explains", async () => {
    // A shifted HKL origin: every peak off by the same vector, which the best UB cannot remove.
    api.fetchUbCheck.mockResolvedValue({ ...check, fit: "both", symmetrised: false, rms_start: 0.0445, rms: 0.0444, voxel_q: 0.0997 });
    const out = JSON.parse((await run("ub_check", {})).text);
    expect(out.unexplained).toBe(true);
    expect(out.reading).toMatch(/The fit removed little of the peaks' offset \(RMS 0\.0445 → 0\.0444 Å⁻¹, against a voxel of 0\.0997 Å⁻¹\): no UB change explains it/);
    // A turned UB: the fit takes the offset away.
    api.fetchUbCheck.mockResolvedValue({ ...check, fit: "both", symmetrised: false, rms_start: 0.0366, rms: 0.0037, voxel_q: 0.0997 });
    expect(JSON.parse((await run("ub_check", {})).text).unexplained).toBe(false);
  });

  // The dev origin case's check (validation sweep, docs/pilot-review.md finding 2):
  // the origin put off by (0.03, 0.02, 0) r.l.u. on a cubic cell of 3.9 Å.
  const cubic = [[1.611, 0, 0], [0, 1.611, 0], [0, 0, 1.611]];
  const shifted = {
    ...check, fit: "both", symmetrised: false, rms_start: 0.0583, rms: 0.0583, voxel_q: 0.0806, angle_deg: 0, ub: cubic, ub_start: cubic,
    mean_offset_rlu: { before: [0.0305, 0.0195, 0], after: [0.0305, 0.0195, 0], standard_error: [0.0002, 0.0002, 0.0002], n: 90 },
  };

  it("gives a shifted origin's size: the peaks' mean offset that the fit leaves", async () => {
    api.fetchUbCheck.mockResolvedValue(shifted);
    const r = await run("ub_check", {});
    const out = JSON.parse(r.text);
    expect(out.mean_offset_rlu).toEqual({ before: [0.0305, 0.0195, 0], after: [0.0305, 0.0195, 0], standard_error: [0.0002, 0.0002, 0.0002] });
    expect(out.origin_shift_rlu).toEqual([0.0305, 0.0195, 0]);
    expect(out.reading).toMatch(/Every peak sits a mean \(0\.0305, 0\.0195, 0\.0000\) r\.l\.u\. off its node.*the HKL origin shifted/);
    expect(r.summary).toMatch(/origin shifted \(0\.0305, 0\.0195, 0\.0000\) r\.l\.u\.$/);
  });

  it("names no origin shift for a turned UB, a clean volume, or offsets with no common vector", async () => {
    // A turned UB (0.6°): the offsets average out over the nodes, and the fit removes them.
    api.fetchUbCheck.mockResolvedValue({
      ...shifted, rms_start: 0.0491, rms: 0.0016, angle_deg: 0.601,
      mean_offset_rlu: { before: [0, 0, 0], after: [0, 0, 0], standard_error: [0.0016, 0.0016, 0.0023], n: 90 },
    });
    let out = JSON.parse((await run("ub_check", {})).text);
    expect([out.unexplained, out.origin_shift_rlu]).toEqual([false, null]);
    // The control: on their nodes.
    api.fetchUbCheck.mockResolvedValue({ ...shifted, rms_start: 0.0004, rms: 0.0004, mean_offset_rlu: { ...shifted.mean_offset_rlu, before: [0, 0, 0], after: [0, 0, 0] } });
    expect(JSON.parse((await run("ub_check", {})).text).origin_shift_rlu).toBeNull();
    // Unexplained offsets (|Q| assigned wrong: they grow outward) whose mean is small: not the origin.
    api.fetchUbCheck.mockResolvedValue({ ...shifted, mean_offset_rlu: { ...shifted.mean_offset_rlu, before: [0.002, 0, 0], after: [0.002, 0, 0] } });
    out = JSON.parse((await run("ub_check", {})).text);
    expect([out.unexplained, out.origin_shift_rlu]).toEqual([true, null]);
    expect(out.reading).toMatch(/Look at the origin of the HKL grid, or at how \|Q\| was assigned/);
  });

  it("reads the fit whole with the skills on, and without its inference with them off (inference.ts)", async () => {
    const off = () =>
      callTool({ ...ctx, skills: false }, "ub_check", {}, { tools: toolsWithSkills(CHAT_TOOLS, false) });
    const reading = async (r: Promise<{ text: string }>) => JSON.parse((await r).text).reading as string;
    // An origin shift: B names it and what to report; C, what the fit found.
    api.fetchUbCheck.mockResolvedValue(shifted);
    const b = await reading(run("ub_check", {}));
    const tail = ", the HKL origin shifted by about that much, which no UB can make. Report the origin, not the UB.";
    expect(b.endsWith(`Every peak sits a mean (0.0305, 0.0195, 0.0000) r.l.u. off its node, after the fit as before it: one vector moves them all${tail}`)).toBe(true);
    expect(await reading(off())).toBe(`${b.slice(0, -tail.length)}.`);
    // No common vector: B says where to look; C does not.
    api.fetchUbCheck.mockResolvedValue({ ...shifted, mean_offset_rlu: { ...shifted.mean_offset_rlu, before: [0.002, 0, 0], after: [0.002, 0, 0] } });
    const b2 = await reading(run("ub_check", {}));
    const look = " Look at the origin of the HKL grid, or at how |Q| was assigned, not at the UB.";
    expect(b2.endsWith(`no UB change explains it.${look}`)).toBe(true);
    expect(await reading(off())).toBe(b2.slice(0, -look.length));
  });
});

describe("dpdf_peaks", () => {
  // What the server returns on the dev control (docs/pilot-review.md finding 1),
  // shortened: the strongest correlation, and a planted one at ⟨3/2 0 0⟩.
  const features = {
    id: "demo.delta_pdf", sigma: 6.174, min_sigma: 5, origin_radius: 1.95, n_extrema: 619,
    groups: [
      { sign: -1, length: 2.7393, size_sigma: 1515.5, value: -9357, n: 6,
        vectors: [[1.9383, 1.9383, 0], [0, 1.9383, -1.9383], [0, 1.9383, 1.9383], [1.9383, 0, -1.9383], [1.9383, 0, 1.9383]],
        vectors_rlu: [[0.497, 0.497, 0], [0, 0.497, -0.497], [0, 0.497, 0.497], [0.497, 0, -0.497], [0.497, 0, 0.497]],
        sizes_sigma: [1515.5, 1515.3, 1514.1, 1513.7, 1513.4] },
      { sign: 1, length: 5.8383, size_sigma: 238.39, value: 1472, n: 3,
        vectors: [[5.8383, 0.0039, 0]], vectors_rlu: [[1.497, 0.001, 0]], sizes_sigma: [238.39] },
    ],
  };

  it("lists the strongest features with their vectors, signs and sizes", async () => {
    api.fetchDpdfFeatures.mockResolvedValue(features);
    const r = await run("dpdf_peaks", {});
    expect(r.ok).toBe(true);
    expect(api.fetchDpdfFeatures).toHaveBeenLastCalledWith("demo.delta_pdf", 5, 12);
    const out = JSON.parse(r.text);
    expect(out.features[0]).toEqual({
      sign: "−", length_A: 2.739, size_sigma: 1520, n_vectors: 6,
      vectors_rlu: [[0.497, 0.497, 0], [0, 0.497, -0.497], [0, 0.497, 0.497], [0.497, 0, -0.497]],
      vectors_A: [[1.938, 1.938, 0], [0, 1.938, -1.938], [0, 1.938, 1.938], [1.938, 0, -1.938]],
    });
    expect(out.features[1]).toMatchObject({ sign: "+", length_A: 5.838, n_vectors: 3, vectors_rlu: [[1.5, 0.001, 0]] });
    expect([out.robust_sigma, out.threshold_sigma, out.origin_disk_A, out.extrema_above_threshold]).toEqual([6.17, 5, 1.95, 619]);
    expect(r.summary).toBe("619 extrema above 5σ; strongest − at (0.497, 0.497, 0) r.l.u., 2.74 Å, 1520σ");
    expect(r.view).toMatchObject({ view: "dpdf", plane: "xy", value: 0 });
  });

  it("checks its arguments, and says when nothing stands out", async () => {
    expect((await run("dpdf_peaks", { min_sigma: 1 })).text).toMatch(/min_sigma must be within \[3, 1000\]/);
    expect((await run("dpdf_peaks", { limit: 50 })).text).toMatch(/limit must be within \[1, 30\]/);
    api.fetchDpdfFeatures.mockResolvedValue({ ...features, n_extrema: 0, groups: [] });
    const r = await run("dpdf_peaks", { min_sigma: 900, limit: 3 });
    expect(api.fetchDpdfFeatures).toHaveBeenLastCalledWith("demo.delta_pdf", 900, 3);
    expect(r.summary).toBe("no extremum above 5σ outside the origin's disk");
  });
});

describe("consistency_details", () => {
  it("gives r against the data's even part beside r against the data", async () => {
    api.fetchConsistencyCheck.mockResolvedValue({
      dataset_id: "demo", check_path: "x", has_check: true,
      metrics: { pearson_r: 0.989014, normalized_rms: 0.125311, rms: 0.03, n_voxels: 3617683, per_plane_r: { "+0.000": 0.98912 },
        q_band: null, crop_hkl: null, apodization: "gaussian", pearson_r_even: 0.99999999, normalized_rms_even: 1e-9, odd_share: 0.021851 },
    });
    const r = await run("consistency_details", {});
    const out = JSON.parse(r.text);
    expect([out.pearson_r, out.pearson_r_even, out.odd_share]).toEqual([0.989, 1, 0.02185]);
    expect(r.summary).toBe("r = 0.989, normalised RMS = 0.1253; against the even part r = 1 (odd share 0.02185)");
    // A check saved before the even part was compared reads as before.
    api.fetchConsistencyCheck.mockResolvedValue({
      dataset_id: "demo", check_path: "x", has_check: true,
      metrics: { pearson_r: 0.9995, normalized_rms: 0.01, rms: 0.001, n_voxels: 10, per_plane_r: {}, q_band: null, crop_hkl: null, apodization: "gaussian" },
    });
    const before = await run("consistency_details", {});
    expect(JSON.parse(before.text).pearson_r_even).toBeUndefined();
    expect(before.summary).toBe("r = 0.9995, normalised RMS = 0.01");
  });
});

describe("texture_check", () => {
  // Fills 30 above a noisy diffuse at nine nodes: a lattice of bright plugs,
  // the nodes 10 voxels apart (±1.5 r.l.u., 0.1 r.l.u. a voxel).
  const noise = (ix: number, iy: number) => (((ix * 7919 + iy * 104729) % 1000) / 500) - 1;
  const hole = (ix: number, iy: number) => [4, 5, 6].includes(ix % 10) && [4, 5, 6].includes(iy % 10);
  const cut = (f: (ix: number, iy: number) => number, half = 1.5) => makeSlice(31, 31, (_x, _y, ix, iy) => f(ix, iy), { half });
  const stages = (half?: number): Record<string, ReturnType<typeof makeSlice>> => ({
    "demo.ringremoved": cut((ix, iy) => 100 + 4 * noise(ix, iy), half),
    "demo.braggpunched": cut((ix, iy) => (hole(ix, iy) ? NaN : 100 + 4 * noise(ix, iy)), half),
    "demo.backfilled": cut((ix, iy) => 100 + 4 * noise(ix, iy) + (hole(ix, iy) ? 30 : 0), half),
  });

  it("flags fills that sit above their rims on every plane", async () => {
    const slices = stages();
    api.fetchSlice.mockImplementation(async (id: string) => slices[id]);
    const r = await runOn(full, "texture_check", {});
    const out = JSON.parse(r.text);
    expect(out.per_cut).toHaveLength(3);
    expect(out.per_cut[0]).toMatchObject({ cut: "H–K plane at L = 0", n_holes: 9, systematic_fill_bias: true, above_fraction: 1 });
    expect(out.per_cut[0].not_judged).toBeUndefined();
    expect(r.outcomes?.[0]).toMatchObject({ kind: "attention", reasons: ["fill bias"] });
    expect(r.summary).toMatch(/^systematic fill bias on 3 of 3 cut\(s\)/);
    expect(r.view?.label).toBe("H–K plane at L = 0");
  });

  it("does not judge cuts whose grid leaves the holes no room for their rims, and says why", async () => {
    // The same cuts at 0.2 r.l.u. a voxel: the nodes 5 voxels apart, under the 10 a hole reaching one voxel and its rim need.
    const slices = stages(3);
    api.fetchSlice.mockImplementation(async (id: string) => slices[id]);
    const r = await runOn(full, "texture_check", {});
    const out = JSON.parse(r.text);
    expect(out.per_cut[0]).toMatchObject({ n_holes: 9, not_judged: expect.stringMatching(/^grid too coarse: the nodes are 5 voxels apart, under 10/), systematic_fill_bias: null });
    expect(r.outcomes?.[0]).toMatchObject({ kind: "info", reasons: ["grid too coarse"] });
    expect(r.summary).toMatch(/^fill bias not judged · 3 of 3 cut\(s\) not judged: grid too coarse/);
  });

  it("needs the punched and backfilled outputs", async () => {
    expect((await run("texture_check", {})).text).toMatch(/needs the punched and backfilled outputs/);
  });
});

describe("radial_profile", () => {
  it("puts the stages' shell medians side by side", async () => {
    api.fetchSlice.mockImplementation(async (id: string) =>
      makeSlice(21, 21, (x, y) => (id === "demo.raw" ? 10 : 2) + Math.hypot(x, y), { half: 2 }),
    );
    const out = JSON.parse((await runOn(full, "radial_profile", { stages: ["raw", "flattened"], bins: 8 })).text);
    expect(out.q_unit).toBe("|Q| in Å⁻¹");
    expect(Object.keys(out.rows[0])).toEqual(["q", "raw", "flattened"]);
    expect(out.rows[0].raw - out.rows[0].flattened).toBeCloseTo(8, 5);
    expect(out.rows[out.rows.length - 1].q).toBeGreaterThan(out.rows[0].q);
  });
});

describe("the figure each step looked at", () => {
  it("is the cut a measurement was taken on", async () => {
    api.fetchSlice.mockResolvedValue(makeSlice(21, 21, () => 1, { half: 2 }));
    const r = await run("measure_reciprocal_cut", { plane: "h0l", value: 0.5 });
    expect(r.view).toEqual({ view: "cleanup", plane: "h0l", value: 0.5, label: "H–L plane at K = 0.5", axis: "K" });
  });

  it("is the plane a stage did worst on, or the back-FFT check for the ΔPDF", async () => {
    evaluate.evaluateStage.mockResolvedValue({
      mean_ring_energy_ratio: 0.5,
      per_plane: { hk0: { ring_energy_ratio: 0.4 }, h0l: { ring_energy_ratio: 0.7 }, "0kl": { ring_energy_ratio: 0.5 } },
    });
    expect((await runOn(full, "assess_stage", { stage: "rings" })).view).toMatchObject({ view: "cleanup", plane: "h0l", value: 0, axis: "K" });
    evaluate.evaluateStage.mockResolvedValue({ back_fft_pearson_r: 0.99, per_plane: {} });
    expect((await runOn(full, "assess_stage", { stage: "pdf" })).view).toEqual({ view: "consistency", label: "the back-FFT check" });
  });

  it("is the top peak on the Bragg page, the run log on the Execution page", async () => {
    api.fetchBraggProfile.mockResolvedValue({
      has_profile: true,
      n_peaks: 1,
      punch_frame: "spherical",
      peaks: [{ center_hkl: [2, 0, 0], q_abs: 1, intensity: 9, local_background: 1, significance: 20, fit_kind: "covariance" }],
    } as unknown as BraggProfile);
    expect((await run("bragg_peaks", {})).view).toEqual({ view: "bragg", hkl: [2, 0, 0], label: "the peak at (2, 0, 0)" });
    usePipelineStore.setState({ running: false, terminal: "done", events: [{ type: "progress", stage: "rings", status: "done", message: "ok" }] });
    expect((await run("run_log", {})).view).toEqual({ view: "execution", label: "the run log" });
  });
});

describe("openView", () => {
  it("selects a peak on the Bragg page and opens the back-FFT check and the run log", async () => {
    const { openView } = await import("../tools/openView");
    openView({ view: "bragg", hkl: [1, 1, 1], label: "the peak at (1, 1, 1)" });
    expect(useViewerStore.getState().peakFocus).toEqual([1, 1, 1]);
    expect(useNavStore.getState().tab).toBe("bragg");
    openView({ view: "consistency", label: "the back-FFT check" });
    expect(useNavStore.getState().tab).toBe("consistency");
    openView({ view: "execution", label: "the run log" });
    expect(useNavStore.getState().tab).toBe("execution");
  });
});
