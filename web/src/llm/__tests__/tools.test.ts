// The assistant's tools against a mocked API: argument checking, the line
// profile's row/column pick, the Bragg-peak sort, show_in_viewer moving the
// console's stores, mark_region's marks and refusals, and the two that act:
// update_settings and run_pipeline.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraggProfile, Dataset, LaueComparison, VolumeMeta, VolumeTexture } from "../../api/types";
import { useAgentEdits } from "../../state/agentEdits";
import { useDpdfStore } from "../../state/dpdfStore";
import { useMarkStore } from "../../state/markStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { SIGMA_OF } from "../metrics/dpdf";
import { loadSettings, saveSettings } from "../settings";
import { useTuneStore, type StageRun } from "../tune/tuner";
import type { AgentStep } from "../agent";
import { callTool, CHAT_TOOLS, toolsWithSkills, type Args, type RunModel, type ToolContext } from "../tools";
import { offLatticeBunching } from "../metrics/bunching";
import { cut, DECLARED, directGroup, HEXAGONAL, orbit } from "./constructedDpdf";
import { tableRows } from "../tools/shared/table";
import { TERSE_CRITERION, WORDS } from "../verdicts/rules";
import { BUNCHED_AT_THIRDS, makeSlice, recordOf } from "./helpers";
import braggOverDiffuse from "../../state/__tests__/__fixtures__/laue-compare-bragg-over-diffuse.json";
import hex6m from "../../state/__tests__/__fixtures__/laue-compare-hex-6m.json";
import poorlyCovered from "../../state/__tests__/__fixtures__/laue-compare-poorly-covered.json";

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
  compareLaueClasses: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
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
    // A row per peak, in a column table (THY-63 R1).
    expect(bySig.peaks.cols).toEqual(["hkl", "q", "intensity", "local_background", "significance", "measured_width_q", "resolution_limited", "anisotropy", "fit"]);
    expect(tableRows(bySig.peaks).map((p) => p.hkl)).toEqual([[2, 0, 0], [0, 1, 0], [1, 0, 0]]);
    expect(tableRows(bySig.peaks)[0].anisotropy).toBe(2);
    const near = JSON.parse((await run("bragg_peaks", { near_hkl: [0, 1, 0], limit: 1 })).text);
    expect(tableRows(near.peaks)).toEqual([expect.objectContaining({ hkl: [0, 1, 0] })]);
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

describe("mark_region", () => {
  // A measurement this reply took, which a mark may rest on.
  const measured = (name: string, result: unknown, id = "0:a"): AgentStep => ({ id, name, args: {}, status: "done", result: JSON.stringify(result) });
  const CUT = measured("measure_reciprocal_cut", { cut: "H–K plane at L = 0", flatten: { after_floor_max_sigma: 1.1 } });
  const PEAKS = measured("dpdf_peaks", { features: [{ sign: "+", vectors_A: [[2, 0, 0]] }] }, "1:b");
  const withSteps = (replySteps: AgentStep[], earlierSteps: AgentStep[] = []): ToolContext => ({ dataset, datasets: [dataset], replySteps, earlierSteps });
  const SATELLITES = { where: "flatten", shape: "points", points: [[1.25, 0, 0], [0.75, 0, 0]], label: "satellites at H = 1 ± 0.25", evidence: ["measure_reciprocal_cut"] };

  beforeEach(() => {
    useMarkStore.setState({ marks: [], next: 1, showAll: true, layoutRequest: null });
    useViewerStore.setState(useViewerStore.getInitialState(), true);
    useNavStore.setState({ tab: "config" });
  });

  it("marks a finding on the stage it was measured on, and says what it drew where", async () => {
    const r = await callTool(withSteps([CUT]), "mark_region", SATELLITES);
    expect(r.ok, r.text).toBe(true);
    expect(JSON.parse(r.text)).toEqual({
      marked: "M1",
      label: "satellites at H = 1 ± 0.25",
      where: "flatten",
      page: "Reciprocal cleanup",
      region: { shape: "points", points: [[1.25, 0, 0], [0.75, 0, 0]], unit: "r.l.u." },
      // The dataset has these two reciprocal outputs; the points lie on L = 0 (and K = 0): L comes first.
      drawn_on: [{ view: "H–K plane at L = 0", stages: ["raw", "flatten"], points: 2 }],
      zoomed: false,
      evidence: ["measure_reciprocal_cut (step 1)"],
    });
    expect(r.summary).toBe("M1 · satellites at H = 1 ± 0.25: H–K plane at L = 0, outlined on Background-corrected");
    expect(r.view).toEqual({ view: "mark", label: "M1 · satellites at H = 1 ± 0.25", mark: "M1" });
    expect(useMarkStore.getState().marks.map((m) => [m.id, m.datasetId, m.where])).toEqual([["M1", "demo", "flatten"]]);
    expect(useViewerStore.getState().fixedAxis).toBe("L");
    expect(useNavStore.getState().tab).toBe("reciprocal");
  });

  it("marks a ΔPDF region on each section through it, in Å", async () => {
    const r = await callTool(withSteps([], [PEAKS]), "mark_region", {
      where: "pdf",
      shape: "ellipsoid",
      center: [2, 0, 0],
      half_size: [1, 1, 1],
      label: "the strongest + pair",
      evidence: ["dpdf_peaks.features.0"],
    });
    expect(r.ok, r.text).toBe(true);
    const out = JSON.parse(r.text);
    expect(out.region).toEqual({ shape: "ellipsoid", center: [2, 0, 0], half_size: [1, 1, 1], unit: "Å" });
    expect(out.drawn_on.map((d: { view: string }) => d.view)).toEqual(["ΔPDF x–y section at z = 0 Å", "ΔPDF x–z section at y = 0 Å", "ΔPDF y–z section at x = 2 Å"]);
    expect(out.zoomed).toBe(true);
    expect(out.evidence).toEqual(["dpdf_peaks.features.0 (an earlier turn)"]);
    expect(useDpdfStore.getState().cutX).toBe(22);
    expect(useNavStore.getState().tab).toBe("dpdf");
  });

  it("takes what a local model may write: a stage's output name, one half-width, points in one list, evidence as text", async () => {
    const r = await callTool(withSteps([CUT]), "mark_region", {
      where: "flattened",
      shape: "box",
      center: ["1", 0, 0],
      half_size: 0.2,
      label: "  a leftover ring segment ",
      evidence: "{{measure_reciprocal_cut.flatten}}",
    });
    expect(r.ok, r.text).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ where: "flatten", label: "a leftover ring segment", region: { shape: "box", center: [1, 0, 0], half_size: [0.2, 0.2, 0.2] } });
    const flat = await callTool(withSteps([CUT]), "mark_region", { ...SATELLITES, label: "flat", points: [1.25, 0, 0, 0.75, 0, 0] });
    expect(JSON.parse(flat.text).region.points).toEqual([[1.25, 0, 0], [0.75, 0, 0]]);
  });

  it("refuses a mark without its evidence, and moves nothing", async () => {
    const none = await callTool(withSteps([]), "mark_region", { ...SATELLITES, evidence: [] });
    expect(none.ok).toBe(false);
    expect(none.text).toBe("Error: not marked: a mark needs its evidence: name the tool calls whose results show the region, by the tool's name or as tool.field (dpdf_peaks.features.0)");
    const notRun = await callTool(withSteps([PEAKS]), "mark_region", SATELLITES);
    expect(notRun.text).toBe("Error: not marked: measure_reciprocal_cut: measure_reciprocal_cut has not run in this conversation; call it, and mark what its result shows");
    expect(useMarkStore.getState().marks).toEqual([]);
    expect(useNavStore.getState().tab).toBe("config");
  });

  it("refuses a region outside the volume, an empty one, and a stage with no output, saying why", async () => {
    const out = await callTool(withSteps([CUT]), "mark_region", { ...SATELLITES, points: [[3, 0, 0]] });
    expect(out.text).toBe("Error: not marked: no point is inside the volume: the volume spans H -2 to 2 r.l.u., K -2 to 2 r.l.u., L -1 to 1 r.l.u.");
    const empty = await callTool(withSteps([CUT]), "mark_region", { ...SATELLITES, shape: "box", center: [0, 0, 0], half_size: [0.1, 0, 0.1] });
    expect(empty.text).toMatch(/^Error: not marked: the box is empty/);
    const punch = await callTool(withSteps([CUT]), "mark_region", { ...SATELLITES, where: "punch" });
    expect(punch.text).toBe("Error: not marked: the punch stage has no output for this dataset yet (the cleanup page shows raw, flatten); run the pipeline first");
    expect(useMarkStore.getState().marks).toEqual([]);
  });

  it("reports what the volume cut off, and that a mark made again is the same mark", async () => {
    const args = { ...SATELLITES, points: [[1.25, 0, 0], [2.5, 0, 0]] };
    const first = JSON.parse((await callTool(withSteps([CUT]), "mark_region", args)).text);
    expect(first.clipped).toEqual(["1 of 2 points are outside the volume and were left out"]);
    expect(first.region.points).toEqual([[1.25, 0, 0]]);
    const again = JSON.parse((await callTool(withSteps([CUT]), "mark_region", args)).text);
    expect(again).toMatchObject({ marked: "M1", already_marked: true });
    expect(useMarkStore.getState().marks).toHaveLength(1);
  });

  it("sends bad arguments back as such", async () => {
    const cases: [Args, RegExp][] = [
      [{ ...SATELLITES, where: "elsewhere" }, /where must be one of raw, rings, punch, backfill, flatten, pdf/],
      [{ ...SATELLITES, shape: undefined, points: undefined }, /shape must be one of box, ellipsoid, points/],
      [{ ...SATELLITES, shape: "box", center: [1, 0], half_size: [1, 1, 1] }, /center must be three numbers/],
      [{ ...SATELLITES, points: [[1, 0, 0], [1, 0]] }, /points\[1\] must be three numbers/],
      [{ ...SATELLITES, points: Array.from({ length: 13 }, (_, i) => [i / 10, 0, 0]) }, /at most 12 positions/],
      [{ ...SATELLITES, label: " " }, /label must name what is there/],
    ];
    for (const [args, message] of cases) {
      const r = await callTool(withSteps([CUT]), "mark_region", args);
      expect(r.text, JSON.stringify(args)).toMatch(/^Error: invalid arguments — /);
      expect(r.text).toMatch(message);
    }
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

  it("tells the Configure page which fields it changed, and only when it changed them (state/agentEdits.ts)", async () => {
    usePipelineStore.setState({ punchHGuard: "", punchFitUnconstrained: false });
    useAgentEdits.setState({ last: null, shown: 0 });
    await run("update_settings", { changes: { punchHGuard: 0.2, punchFitUnconstrained: true } });
    const first = useAgentEdits.getState().last!;
    expect([...first.fields].sort()).toEqual(["punchFitUnconstrained", "punchHGuard"]);
    expect(first.seq).toBe(1);
    // A setting already at the value, a refused value, and the user's own edit are no agent change to show.
    await run("update_settings", { changes: { punchHGuard: 0.2 } });
    await run("update_settings", { changes: { punchHGuard: 5 } });
    usePipelineStore.getState().patch({ punchSearchFloor: "30" });
    expect(useAgentEdits.getState().last).toBe(first);
    // A partly new change names only what changed.
    await run("update_settings", { changes: { punchHGuard: 0.2, punchMinSig: 7 } });
    expect(useAgentEdits.getState().last).toEqual({ fields: ["punchMinSig"], seq: 2 });
  });

  it("refuses settings outside the catalog and values out of range", async () => {
    const unknown = await run("update_settings", { changes: { flattenIon: "Fe2+" } });
    expect(unknown.text).toMatch(/invalid arguments — flattenIon cannot be changed/);
    const range = await run("update_settings", { changes: { punchMinSig: 1000 } });
    expect(range.text).toMatch(/punchMinSig must be within/);
    expect(usePipelineStore.getState().punchMinSig).toBe("");
  });

  // The symmetry average (pipeline stage 0): the sample's Laue class, and
  // whether to average at all, are the user's to set on the Configure page.
  // update_settings refuses them whatever the user said; the model suggests.
  describe("the symmetry average, which the user sets", () => {
    const refusal = (key: string) => `${key} is the user's to set, on the Configure page: suggest a Laue class to the user, with your evidence, and let them set it.`;
    const OFF = { symmetryAverageEnabled: false, symmetryLaue: "", symmetryReaverage: false, symmetryAllowMetricChange: false, punchMinSig: "" };
    beforeEach(() => usePipelineStore.setState(OFF));

    it("refuses the Laue class and the switch, even when the user names them", async () => {
      for (const said of [undefined, "Set the Laue class to 6/mmm and switch the symmetry average on."]) {
        const r = await callTool({ ...ctx, userMessage: said }, "update_settings", { changes: { symmetryLaue: "6/mmm", symmetryAverageEnabled: true } });
        expect(r.ok).toBe(false);
        expect(r.text).toBe(`Error: ${refusal("symmetryLaue")} ${refusal("symmetryAverageEnabled")}`);
        expect(usePipelineStore.getState()).toMatchObject(OFF);
      }
    });

    it("refuses to proceed despite a metric change, whatever the user said", async () => {
      const said = "Proceed despite the metric change: average over 6/mmm anyway.";
      const r = await callTool({ ...ctx, userMessage: said }, "update_settings", { changes: { symmetryAllowMetricChange: true } });
      expect(r.ok).toBe(false);
      expect(r.text).toBe(`Error: ${refusal("symmetryAllowMetricChange")}`);
      expect(usePipelineStore.getState()).toMatchObject(OFF);
    });

    it("makes the call's other changes, and says what it refused", async () => {
      const r = await run("update_settings", { changes: { punchMinSig: 6, symmetryReaverage: true } });
      expect(r.ok, r.text).toBe(true);
      expect(usePipelineStore.getState()).toMatchObject({ punchMinSig: "6", symmetryReaverage: false });
      expect(JSON.parse(r.text)).toEqual({
        changed: [{ setting: "punchMinSig", from: 5, to: 6 }],
        refused: [{ setting: "symmetryReaverage", why: refusal("symmetryReaverage") }],
        rerun_from: "punch",
      });
      expect(r.summary).toBe("punchMinSig 5 → 6; refused, the user's to set: symmetryReaverage");
    });

    it("shows a blank Laue class as none chosen, not as a default", async () => {
      const shown = (JSON.parse((await run("configure_settings", {})).text) as { settings: Record<string, unknown> }).settings;
      expect(shown).toMatchObject({
        symmetryAverageEnabled: false,
        symmetryLaue: "(none chosen: the user's to set)",
        symmetryReaverage: false,
        symmetryAllowMetricChange: false,
      });
    });
  });

  // The raw edge trim (tune/catalog.ts, USER_CHOICE_PARAMS), a data choice no
  // fact about the sample, changes under the same gate: only when the user's
  // latest message names it.
  describe("the raw edge trim, which only the user's request changes", () => {
    const refusal = "edgeTrim is the user's to choose: ask the user, and change it once they name it.";
    const after = (said: string | undefined, changes: Args) =>
      callTool({ ...ctx, userMessage: said, skillsRead: new Set(["reduction-qc", "bragg-node-audit"]) }, "update_settings", { changes });
    beforeEach(() => usePipelineStore.setState({ edgeTrim: "", punchMinSig: "" }));

    it("refuses a change the user's latest message does not name", async () => {
      for (const said of [undefined, "Take it to a 3D-ΔPDF you would trust.", "Fix the edges of the plot."]) {
        const r = await after(said, { edgeTrim: 2 });
        expect(r.ok).toBe(false);
        expect(r.text).toBe(`Error: ${refusal}`);
        expect(usePipelineStore.getState().edgeTrim).toBe("");
      }
      const mixed = await after("Raise the punch significance to 6.", { punchMinSig: 6, edgeTrim: 2 });
      expect(mixed.ok).toBe(true);
      expect(mixed.summary).toBe("punchMinSig 5 → 6; refused, the user's to choose: edgeTrim");
    });

    it("makes the change once the user names it, and checks the value", async () => {
      const r = await after("Trim two voxel layers off the coverage edge.", { edgeTrim: 2 });
      expect(r.ok, r.text).toBe(true);
      expect(JSON.parse(r.text)).toEqual({ changed: [{ setting: "edgeTrim", from: 1, to: 2 }], rerun_from: "rings" });
      expect(usePipelineStore.getState().edgeTrim).toBe("2");
      // Back to the default: the field's blank.
      await after("Set the edge trim back to 1.", { edgeTrim: 1 });
      expect(usePipelineStore.getState().edgeTrim).toBe("");
      const bad = await after("Use an edge trim of 5.", { edgeTrim: 5 });
      expect(bad.ok).toBe(false);
      expect(bad.text).toMatch(/edgeTrim takes 0 to 3 voxel layers/);
    });
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
    expect(out).not.toHaveProperty("off_lattice_bunching");
  });

  it("puts the question for the user in its result when the punch's record says its sharp peaks off the lattice bunch (plan 4.15)", async () => {
    usePipelineStore.setState({ runStages: fakeRun("done") });
    const fresh = { ...dataset, stages: [...dataset.stages, { name: "braggpunched", exists: true, kind: "hkl", volume_id: "demo.braggpunched" }] };
    api.fetchDataset.mockResolvedValue(fresh);
    api.fetchBraggProfile.mockResolvedValue({ has_profile: true, n_peaks: 0, peaks: [], modulation: recordOf({ bunching: BUNCHED_AT_THIRDS }) });
    const out = JSON.parse((await callTool({ ...ctx }, "run_pipeline", {})).text);
    expect(api.fetchBraggProfile).toHaveBeenCalledWith("demo");
    expect(out.off_lattice_bunching).toEqual(offLatticeBunching(recordOf({ bunching: BUNCHED_AT_THIRDS })));
    expect(out.off_lattice_bunching.ask_user).toBe(
      "14 of the 17 sharp peaks off the lattice sit at H = n ± 1/3, where about 2 would by chance. Does the sample have a modulation with k = (1/3, 0, 0)?",
    );
    // A record whose peaks did not bunch, or a record from before the punch kept it: no question.
    for (const modulation of [recordOf(), null, undefined]) {
      api.fetchBraggProfile.mockResolvedValue({ has_profile: true, n_peaks: 0, peaks: [], modulation });
      expect(JSON.parse((await callTool({ ...ctx }, "run_pipeline", {})).text)).not.toHaveProperty("off_lattice_bunching");
    }
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

  it("asks the model on the console's settings in the app, and a validation run's own model in a run", async () => {
    tuner.startTuning.mockImplementation(async () => useTuneStore.setState({ finishedNote: "Done." }));
    const before = loadSettings();
    saveSettings({ baseUrl: "http://console.invalid/v1", model: "console", apiKey: "", temperature: 0.4 });
    try {
      // The app: the console's settings, as read when it starts, and nothing counts its tokens.
      expect((await callTool({ ...ctx }, "tune_pipeline", { stages: ["pdf"] })).ok).toBe(true);
      const app = tuner.startTuning.mock.calls[0][0];
      expect(app.llm).toBe(loadSettings());
      expect(app.llm).toMatchObject({ baseUrl: "http://console.invalid/v1", model: "console", temperature: 0.4 });
      expect(app).not.toHaveProperty("onUsage");
      expect(app).not.toHaveProperty("maxTokens");

      // A validation run (ToolContext.model): the run's model, its output cap, and its counts to the run.
      const model: RunModel = { settings: { baseUrl: "http://run.invalid/v1", model: "run", apiKey: "k", temperature: 0.2 }, usage: vi.fn(), maxTokens: 16_000 };
      expect((await callTool({ ...ctx, model }, "tune_pipeline", { stages: ["pdf"] })).ok).toBe(true);
      const run = tuner.startTuning.mock.calls[1][0];
      expect(run.llm).toBe(model.settings);
      expect(run.onUsage).toBe(model.usage);
      expect(run.maxTokens).toBe(16_000);
    } finally {
      saveSettings(before);
    }
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

  it("sends a stage's whole criterion once in a reply, and the terse one on its later results there (THY-63 R1)", async () => {
    evaluate.evaluateStage.mockResolvedValue({ max_after_floor_sigma: 0.8, floor_trend: 0.3, floor_span_fraction: 0.6, per_plane: { hk0: {} } });
    const first = await runOn(full, "assess_stage", { stage: "flatten" });
    const whole = JSON.parse(first.text).flatten.criterion;
    expect(whole).toBe(WORDS.criterion.flatten);
    const earlier: AgentStep[] = [{ id: "0:call_0", name: "assess_stage", args: { stage: "flatten" }, status: "done", result: first.text }];
    const again = (args: Args, replySteps: AgentStep[]) => callTool({ dataset: full, datasets: [full], replySteps }, "assess_stage", args);
    const later = JSON.parse((await again({}, earlier)).text);
    expect(later.flatten.criterion).toBe(TERSE_CRITERION.flatten);
    // The other stages' whole criteria were not sent yet; a reply that has sent none, or only terse ones, gets them whole.
    expect(later.pdf.criterion).toBe(WORDS.criterion.pdf);
    expect(JSON.parse((await again({ stage: "flatten" }, [])).text).flatten.criterion).toBe(whole);
    const terseOnly: AgentStep[] = [{ ...earlier[0], result: JSON.stringify({ flatten: { criterion: TERSE_CRITERION.flatten } }) }];
    expect(JSON.parse((await again({ stage: "flatten" }, terseOnly)).text).flatten.criterion).toBe(whole);
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

  it("carries the question for the user beside the punch's verdict, which it leaves as it was (plan 4.15)", async () => {
    const e = { leftover_at_nodes: 0, leftover_off_lattice: 0, leftover_on_protected_planes: 0, leftover_on_protected_planes_sharp: 0, leftover_off_lattice_broad: 0, leftover_off_lattice_sharp: 0, mean_punched_fraction: 0.03, per_plane: {} };
    evaluate.evaluateStage.mockResolvedValue({ ...e, off_lattice_bunching: offLatticeBunching(recordOf({ bunching: BUNCHED_AT_THIRDS })) });
    const out = JSON.parse((await runOn(full, "assess_stage", { stage: "punch" })).text);
    expect(out.punch.verdict).toBe("meets its goal");
    expect(out.punch.off_lattice_bunching.ask_user).toMatch(/Does the sample have a modulation with k = \(1\/3, 0, 0\)\?$/);
    // With every stage too: it is no per-plane detail.
    evaluate.evaluateStage.mockResolvedValue({ ...e, off_lattice_bunching: offLatticeBunching(recordOf({ bunching: BUNCHED_AT_THIRDS })) });
    const all = JSON.parse((await runOn(full, "assess_stage", {})).text);
    expect(all.punch.off_lattice_bunching).toEqual(out.punch.off_lattice_bunching);
  });

  it("keeps the per-plane detail for one stage", async () => {
    evaluate.evaluateStage.mockResolvedValue({ max_after_floor_sigma: 0.8, per_plane: { hk0: { after_floor_max_sigma: 0.8 } } });
    const out = JSON.parse((await run("assess_stage", { stage: "flatten" })).text);
    expect(out.flatten.per_plane.hk0).toEqual({ after_floor_max_sigma: 0.8 });
    expect(out.flatten.goal).toMatch(/floor/);
    expect(out.flatten).not.toHaveProperty("sigma_of");
  });

  it("names the σ the ΔPDF sections' feature_snr are in beside their per-plane detail, which stage=all leaves out (4.10)", async () => {
    evaluate.evaluateStage.mockResolvedValue({ back_fft_pearson_r: 0.99, mean_feature_snr: 40, per_plane: { xy: { feature_snr: 40 } } });
    const one = JSON.parse((await runOn(full, "assess_stage", { stage: "pdf" })).text);
    expect(one.pdf.sigma_of).toBe(SIGMA_OF.sections);
    expect(Object.keys(one.pdf).slice(-3)).toEqual(["per_plane", "sigma_of", "goal"]);
    const all = JSON.parse((await runOn(full, "assess_stage", {})).text);
    expect(all.pdf.mean_feature_snr).toBe(40);
    expect(all.pdf).not.toHaveProperty("per_plane");
    expect(all.pdf).not.toHaveProperty("sigma_of");
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
    expect(all.lines.cols).toEqual(["stage", "status", "message"]);
    expect(tableRows(all.lines).map((l) => l.message)).toEqual(["9 shells fitted", "188 peaks punched"]);
    const punch = JSON.parse((await run("run_log", { stage: "punch" })).text);
    expect(punch.lines.rows).toEqual([["punch", "done", "188 peaks punched"]]);
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
    expect(tableRows(b.lines)).toEqual([{ stage: "rings", status: "done", message: `${summary}. ⚠ ${NOTICE}` }]);
    const c = JSON.parse((await callTool({ ...ctx, skills: false }, "run_log", {})).text);
    expect(tableRows(c.lines).map((l) => l.message)).toEqual([`${summary}. ⚠ ${NOTICE_DEFINITION}`, "188 peaks punched"]);
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
  // A hexagonal ΔPDF (constructedDpdf.ts): 6/mmm's orbit of a correlation, and
  // a pair ±(0.4, 0, 0) that keeps the two-fold ∥ c but not the six-fold.
  const hexagonal = async () => {
    const meta = await api.fetchDpdfMeta();
    api.fetchDpdfMeta.mockResolvedValue({ ...meta, lattice: { a: HEXAGONAL.a, b: HEXAGONAL.a, c: HEXAGONAL.c, alpha: 90, beta: 90, gamma: 120 } });
    const features = [...orbit([{ at: [0.3, 0.1, 0.25], amp: 1, width: 0.35 }], directGroup(DECLARED["6/mmm"])), { at: [0.4, 0, 0], amp: 0.5, width: 0.35 }];
    api.fetchDpdfSlice.mockImplementation(async (_id: string, plane: "xy" | "xz" | "yz", value: number) => cut(HEXAGONAL, features, plane, value));
  };

  it("reports each operation of a hexagonal ΔPDF of data declared symmetrised: with none declared, the cell's in-plane ones", async () => {
    await hexagonal();
    api.fetchMeta.mockResolvedValue({ ...META, symmetry: "6/mmm" });
    const r = await runOn(full, "symmetry_check", {});
    const out = JSON.parse(r.text);
    expect(out.operations).toBe("the cell's in-plane ones (hexagonal): no operations declared");
    expect(out.symmetry_declared).toBe(true);
    expect(out.holds).toEqual(["two-fold ∥ c"]);
    expect(out.ops.map((o: { op: string }) => o.op)).toEqual(["six-fold ∥ c (60°)", "three-fold ∥ c (120°)", "two-fold ∥ c", "mirror ⊥ [1-10]"]);
    expect(r.outcomes).toMatchObject([{ check: "symmetry", kind: "attention", reasons: ["symmetry broken"], words: out.verdict }]);
    expect(api.fetchDpdfSlice).toHaveBeenCalledWith("demo.delta_pdf", "xy", 0);
    expect(api.fetchDpdfSlice).toHaveBeenCalledWith("demo.delta_pdf", "xz", 0);
    expect(api.fetchDpdfSlice).toHaveBeenCalledWith("demo.delta_pdf", "yz", 0);
  });

  it("tests the declared group's operations where the file declares them, those that move c included", async () => {
    await hexagonal();
    api.fetchMeta.mockResolvedValue({ ...META, symmetry: "6/mmm", symmetry_ops: DECLARED["6/mmm"] });
    const out = JSON.parse((await runOn(full, "symmetry_check", {})).text);
    expect(out.operations).toBe("declared (6/mmm): 23 besides the identity");
    // Each of the eleven rotations with its product with the inversion, and the inversion.
    expect(out.ops).toHaveLength(12);
    // The mirror ⊥ c, with the two-fold ∥ c, on the sections it maps onto themselves, off the x–y plane.
    expect(out.ops.find((o: { op: string }) => o.op === "two-fold ∥ c / mirror ⊥ c")).toMatchObject({ tested_on: "xz; yz" });
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

describe("the ΔPDF's sections in σ (4.10)", () => {
  // Ripple of amplitude 1 and one feature of 50, 8 Å from the origin.
  const section = makeSlice(41, 41, (x, y) => (Math.abs(x - 8) < 1e-9 && Math.abs(y) < 1e-9 ? 50 : Math.sin(3 * x + 1) * Math.cos(3 * y + 1)), { half: 20 });

  it("measure_dpdf_cut names its σ: the section's own", async () => {
    api.fetchDpdfSlice.mockResolvedValue(section);
    const r = await run("measure_dpdf_cut", { plane: "xz", value: 0 });
    expect(r.ok, r.text).toBe(true);
    const out = JSON.parse(r.text);
    expect(out.sigma_of).toBe(SIGMA_OF.section);
    expect(out.delta_pdf.feature_snr).toBeCloseTo(50 / out.delta_pdf.background_sigma, -1);
  });

  it("compare_datasets names its σ for the ΔPDF: each dataset's own on the section", async () => {
    api.fetchDpdfSlice.mockResolvedValue(section);
    api.fetchConsistencyCheck.mockResolvedValue({ dataset_id: "demo", check_path: "", has_check: false, metrics: null });
    const dpdf = JSON.parse((await run("compare_datasets", { kind: "dpdf", plane: "xy", value: 0 })).text);
    expect(Object.keys(dpdf)).toEqual(["cut", "sigma_of", "rows"]);
    expect(dpdf.sigma_of).toBe(SIGMA_OF.datasets);
    expect(dpdf.rows[0].feature_snr).toBeGreaterThan(5);
    // The reciprocal stages' numbers are not the ΔPDF's.
    const recip = JSON.parse((await run("compare_datasets", { kind: "reciprocal", plane: "hk0", value: 9 })).text);
    expect(recip).not.toHaveProperty("sigma_of");
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
    expect(out.sigma_of).toBe(SIGMA_OF.centre);
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

describe("compare_laue_classes", () => {
  const HEX = hex6m as unknown as LaueComparison;
  const FLAG = braggOverDiffuse as unknown as LaueComparison;
  beforeEach(() => usePipelineStore.setState({ edgeTrim: "", symmetryLaue: "", punchSupercellH: "", punchSupercellK: "", punchSupercellL: "" }));

  it("compares the raw volume's classes with the run's settings, and returns the table compactly", async () => {
    api.compareLaueClasses.mockResolvedValue(HEX);
    usePipelineStore.setState({ edgeTrim: "2", punchSupercellH: "2", punchSupercellK: "2", punchSupercellL: "2" });
    const progress = vi.fn();
    const r = await callTool(ctx, "compare_laue_classes", {}, { progress });
    expect(r.ok, r.text).toBe(true);
    const [id, params, extra] = api.compareLaueClasses.mock.lastCall!;
    expect(id).toBe("demo.raw");
    expect(params).toMatchObject({ edge_trim: 2, punch_supercell_h: 2, punch_supercell_k: 2, punch_supercell_l: 2 });
    expect(extra).toEqual([]);
    const out = JSON.parse(r.text);
    expect(out.suggestion).toBe("6/m");
    expect(out.classes.map((c: { class: string }) => c.class)).toEqual(["-1", "2/m (c unique)", "-3", "-3m1", "-31m", "6/m", "6/mmm"]);
    const sixMmm = out.classes.find((c: { class: string }) => c.class === "6/mmm");
    expect(sixMmm.contains).toEqual(["-3m1", "-31m", "6/m"]);
    expect(sixMmm.verdict).toMatch(/^rose \d\.\d+× against /);
    expect(sixMmm.r_int).toHaveLength(2);
    expect(sixMmm.chi2[0]).toBeGreaterThan(2);
    expect(out.classes.find((c: { class: string }) => c.class === "6/m").chi2[0]).toBeCloseTo(1, 1);
    expect(out.classes[0].contains).toBeUndefined();
    expect(out.flag).toBeNull();
    expect(out.common_flag).toBeUndefined();
    expect(out.rule).toMatch(/^Rises: x_noise above a subgroup's by >10% and 2 SE of the difference \(block bootstrap, \d+ effective blocks\)\./);
    expect(out.refused).toEqual(["2/m (b unique), mmm, 4/m, 4/mmm, m-3, m-3m: metric changes 100%"]);
    expect(r.summary).toBe("suggests 6/m");
  });

  it("passes the common subset's flag, terse, only when it is raised", async () => {
    api.compareLaueClasses.mockResolvedValue(poorlyCovered as unknown as LaueComparison);
    const r = await run("compare_laue_classes", {});
    const out = JSON.parse(r.text);
    expect(out.suggestion).toBe("2/m (c unique)");
    expect(out.common_flag).toMatch(/^On the voxels -1 can judge .* the rule supports 6\/m/);
    expect(r.summary).toBe("suggests 2/m (c unique); common-subset flag: 6/m");
  });

  it("compares the form's custom class beside the presets", async () => {
    api.compareLaueClasses.mockResolvedValue(HEX);
    usePipelineStore.setState({ symmetryLaue: "h+k,-h,l" });
    await run("compare_laue_classes", {});
    expect(api.compareLaueClasses.mock.lastCall![2]).toEqual(["h+k,-h,l"]);
    usePipelineStore.setState({ symmetryLaue: "6/m" });
    await run("compare_laue_classes", {});
    expect(api.compareLaueClasses.mock.lastCall![2]).toEqual([]);
  });

  it("says when the diffuse supports less than every measured voxel", async () => {
    api.compareLaueClasses.mockResolvedValue(FLAG);
    const r = await run("compare_laue_classes", {});
    const out = JSON.parse(r.text);
    expect(out.suggestion).toBe("4/mmm");
    expect(out.suggested_by).toEqual({ all: "m-3m", diffuse: "4/mmm" });
    expect(out.flag).toMatch(/diffuse alone supports only 4\/mmm/);
    expect(r.summary).toBe("suggests 4/mmm; flag: the diffuse supports only 4/mmm");
  });

  it("passes the backend's refusal of a volume symmetrized already on", async () => {
    api.compareLaueClasses.mockRejectedValue(new Error("demo.nxs declares 6/mmm (24 operations): it is symmetrized already"));
    const r = await run("compare_laue_classes", {});
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/symmetrized already/);
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
  // shortened: the strongest correlation, and a planted one at ⟨3/2 0 0⟩. Its
  // raw file declares no symmetry: grouped by sign, length and size.
  const features = {
    id: "demo.delta_pdf", sigma: 6.174, min_sigma: 5, origin_radius: 1.95, n_extrema: 619,
    grouped_by: "sign, length and size (no symmetry declared)",
    groups: [
      { sign: -1, length: 2.7393, size_sigma: 1515.5, mean_size_sigma: 1514.2, value: -9357, n: 6, multiplicity: null,
        vectors: [[1.9383, 1.9383, 0], [0, 1.9383, -1.9383], [0, 1.9383, 1.9383], [1.9383, 0, -1.9383], [1.9383, 0, 1.9383]],
        vectors_rlu: [[0.497, 0.497, 0], [0, 0.497, -0.497], [0, 0.497, 0.497], [0.497, 0, -0.497], [0.497, 0, 0.497]],
        sizes_sigma: [1515.5, 1515.3, 1514.1, 1513.7, 1513.4] },
      { sign: 1, length: 5.8383, size_sigma: 238.39, mean_size_sigma: 238.3, value: 1472, n: 3, multiplicity: null,
        vectors: [[5.8383, 0.0039, 0]], vectors_rlu: [[1.497, 0.001, 0]], sizes_sigma: [238.39] },
    ],
  };

  // What the server returns on a constructed ΔPDF (cubic, a = 4 Å, built as
  // tests/test_dpdf_features.py's write_declared_dataset builds it, with its
  // ⟨1 0 0⟩ copy along c left out), shortened: peaks on the m-3m orbit of
  // (¼, ½, ¾), their copies 0.9 to 1.1 of one size, and a negative ⟨1 0 0⟩
  // along a and b. Its raw file declares m-3m: each orbit is one entry, the
  // general one 24 of its 24 vectors (one per ± pair), ⟨1 0 0⟩ 2 of its 3.
  const general = {
    vectors: [[2.9913, -0.9994, 2.0022], [1.0049, 2.0006, -2.9958], [3.0014, 0.9954, 2.0027], [1.0029, -2.9916, 1.9997], [0.9964, -2.998, -1.9977]],
    vectors_rlu: [[0.7478, -0.2498, 0.5005], [0.2512, 0.5002, -0.7489], [0.7503, 0.2489, 0.5007], [0.2507, -0.7479, 0.4999], [0.2491, -0.7495, -0.4994]],
    sizes_sigma: [63.669, 62.9163, 61.9904, 61.9312, 61.7096],
  };
  const declared = {
    id: "demo.delta_pdf", sigma: 1.0458, min_sigma: 8, origin_radius: 0.375, n_extrema: 26,
    grouped_by: "declared symmetry (m-3m: 48 operations, r ≡ −r)",
    groups: [
      { sign: 1, length: 3.7357, size_sigma: 63.669, mean_size_sigma: 57.8497, value: 66.587, n: 24, multiplicity: 24, ...general },
      { sign: -1, length: 3.9999, size_sigma: 38.8873, mean_size_sigma: 37.2247, value: -40.67, n: 2, multiplicity: 3,
        vectors: [[3.9999, -0.0121, 0.0027], [0.0048, 3.9911, 0.0046]], vectors_rlu: [[1, -0.003, 0.0007], [0.0012, 0.9978, 0.0012]],
        sizes_sigma: [38.8873, 35.562] },
    ],
  };
  // The same ΔPDF with nothing declared: by sign, length and size the unequal
  // copies of the general orbit split by size, and ⟨1 0 0⟩'s two by size too
  // (shortened to one vector an entry).
  const byShape = (sign: 1 | -1, length: number, size: number, mean: number, n: number, rlu: number[]) => ({
    sign, length, size_sigma: size, mean_size_sigma: mean, value: sign * size * declared.sigma, n, multiplicity: null,
    vectors: [rlu.map((x) => 4 * x)], vectors_rlu: [rlu], sizes_sigma: [size],
  });
  const plain = {
    ...declared,
    grouped_by: "sign, length and size (no symmetry declared)",
    groups: [
      byShape(1, 3.7357, 63.669, 62.1074, 7, [0.7478, -0.2498, 0.5005]),
      byShape(1, 3.7458, 60.1438, 58.784, 7, [0.2513, 0.5018, 0.7497]),
      byShape(1, 3.7473, 56.8872, 55.4586, 6, [0.5007, 0.2502, -0.7513]),
      byShape(1, 3.7472, 53.8623, 53.0155, 3, [0.5007, -0.2517, -0.7507]),
      byShape(1, 3.7501, 50.3539, 50.3539, 1, [0.2496, 0.7514, -0.502]),
      byShape(-1, 3.9999, 38.8873, 38.8873, 1, [1, -0.003, 0.0007]),
      byShape(-1, 3.9911, 35.562, 35.562, 1, [0.0012, 0.9978, 0.0012]),
    ],
  };
  // An entry's fields when the extrema are grouped by sign, length and size: as they were before.
  // The sign is the size's own (THY-63 R1).
  const PLAIN_ENTRY = ["length_A", "size_sigma", "n_vectors", "vectors_rlu", "vectors_A"];

  it("lists the strongest features with their vectors, signs and sizes", async () => {
    api.fetchDpdfFeatures.mockResolvedValue(features);
    const r = await run("dpdf_peaks", {});
    expect(r.ok).toBe(true);
    expect(api.fetchDpdfFeatures).toHaveBeenLastCalledWith("demo.delta_pdf", 5, 12);
    const out = JSON.parse(r.text);
    expect(out.grouped_by).toBe("sign, length and size (no symmetry declared)");
    expect(out.features[0]).toEqual({
      length_A: 2.739, size_sigma: -1520, n_vectors: 6,
      vectors_rlu: [[0.497, 0.497, 0], [0, 0.497, -0.497], [0, 0.497, 0.497], [0.497, 0, -0.497]],
      vectors_A: [[1.938, 1.938, 0], [0, 1.938, -1.938], [0, 1.938, 1.938], [1.938, 0, -1.938]],
    });
    expect(out.features[1]).toMatchObject({ length_A: 5.838, size_sigma: 238, n_vectors: 3, vectors_rlu: [[1.5, 0.001, 0]] });
    for (const e of out.features) expect(Object.keys(e)).toEqual(PLAIN_ENTRY);
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

  it("with a declared point group, names it, and gives each orbit its multiplicity and its copies' mean size", async () => {
    api.fetchDpdfFeatures.mockResolvedValue(declared);
    const r = await run("dpdf_peaks", { min_sigma: 8 });
    expect(r.ok).toBe(true);
    const out = JSON.parse(r.text);
    expect(out.grouped_by).toBe("declared symmetry (m-3m: 48 operations, r ≡ −r)");
    // Each orbit one entry: the vectors found (n_vectors) and the orbit's (multiplicity) apart.
    // A multiplicity equal to n_vectors is not repeated.
    expect(out.features.map((e: Record<string, unknown>) => [Math.sign(e.size_sigma as number), e.n_vectors, e.multiplicity])).toEqual([[1, 24, undefined], [-1, 2, 3]]);
    expect(out.features[0]).toEqual({
      length_A: 3.736, size_sigma: 63.7, mean_size_sigma: 57.8, n_vectors: 24,
      vectors_rlu: [[0.748, -0.25, 0.5], [0.251, 0.5, -0.749], [0.75, 0.249, 0.501], [0.251, -0.748, 0.5]],
      vectors_A: [[2.991, -0.9994, 2.002], [1.005, 2.001, -2.996], [3.001, 0.9954, 2.003], [1.003, -2.992, 2]],
    });
    expect(out.features[1]).toEqual({
      length_A: 4, size_sigma: -38.9, mean_size_sigma: -37.2, n_vectors: 2, multiplicity: 3,
      vectors_rlu: [[1, -0.003, 0.0007], [0.0012, 0.998, 0.0012]],
      vectors_A: [[4, -0.0121, 0.0027], [0.0048, 3.991, 0.0046]],
    });
    expect([out.robust_sigma, out.threshold_sigma, out.extrema_above_threshold]).toEqual([1.05, 8, 26]);
    expect(r.summary).toBe("26 extrema above 8σ; strongest + at (0.748, -0.25, 0.5) r.l.u., 3.74 Å, 63.7σ");
  });

  it("without one, says so, and lists the entries as before: no multiplicity, no mean size", async () => {
    api.fetchDpdfFeatures.mockResolvedValue(plain);
    const out = JSON.parse((await run("dpdf_peaks", { min_sigma: 8 })).text);
    expect(out.grouped_by).toBe("sign, length and size (no symmetry declared)");
    // The orbits split by size: seven entries, the 26 extrema between them.
    expect(out.features.map((e: Record<string, unknown>) => [Math.sign(e.size_sigma as number), e.n_vectors])).toEqual([[1, 7], [1, 7], [1, 6], [1, 3], [1, 1], [-1, 1], [-1, 1]]);
    expect(out.features.reduce((sum: number, e: { n_vectors: number }) => sum + e.n_vectors, 0)).toBe(26);
    for (const e of out.features) expect(Object.keys(e)).toEqual(PLAIN_ENTRY);
    expect(out.features[0]).toEqual({ length_A: 3.736, size_sigma: 63.7, n_vectors: 7, vectors_rlu: [[0.748, -0.25, 0.5]], vectors_A: [[2.991, -0.9992, 2.002]] });

    // A symmetry declared that cannot be applied: grouped as without one, and grouped_by says why.
    const why = "sign, length and size (the declared symmetry 6/mmm is not applied: the ΔPDF file records no cell)";
    api.fetchDpdfFeatures.mockResolvedValue({ ...plain, grouped_by: why });
    const notApplied = JSON.parse((await run("dpdf_peaks", { min_sigma: 8 })).text);
    expect(notApplied.grouped_by).toBe(why);
    expect(notApplied.features).toEqual(out.features);
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
  // The cuts, for the azimuthal texture: 3×3 holes on the nodes of a noisy
  // diffuse (±3 r.l.u., 0.05 r.l.u. a voxel), filled with the diffuse, or
  // `plug` above it.
  const noise = (ix: number, iy: number) => (((ix * 7919 + iy * 104729) % 1000) / 500) - 1;
  const hole = (ix: number, iy: number) => [19, 0, 1].includes(ix % 20) && [19, 0, 1].includes(iy % 20);
  const cut = (f: (ix: number, iy: number) => number) => makeSlice(121, 121, (_x, _y, ix, iy) => f(ix, iy), { half: 3 });
  const stages = (plug: number): Record<string, ReturnType<typeof makeSlice>> => ({
    "demo.ringremoved": cut((ix, iy) => 100 + 4 * noise(ix, iy)),
    "demo.braggpunched": cut((ix, iy) => (hole(ix, iy) ? NaN : 100 + 4 * noise(ix, iy))),
    "demo.backfilled": cut((ix, iy) => 100 + 4 * noise(ix, iy) + (hole(ix, iy) ? plug : 0)),
  });
  const onCuts = (plug: number) => {
    const slices = stages(plug);
    api.fetchSlice.mockImplementation(async (id: string) => slices[id]);
  };

  // What the server returns (GET /api/volumes/{id}/texture, limit 1, the
  // rule's limits asked for) on the constructed volumes of
  // tests/test_fill_texture.py (_lattice; the coarse grid as its _on_grid
  // puts it), written as a dataset's stages as tests/test_server.py writes
  // them: holes three voxels in radius, punched on the nodes of a smooth
  // diffuse that peaks at them, the nodes 20 voxels apart. Each lists the hole
  // farthest outside its range.
  type Hole = VolumeTexture["holes"][number];
  const row = (index: number, centre_hkl: number[], voxels: number, rim_voxels: number, values: number[]): Hole => {
    const [fill, level, sigma, slope, edge, peaked, bias, bias_sigma, bias_level] = values;
    return { index, centre_hkl, voxels, rim_voxels, fill, level, sigma, slope, edge, peaked, bias, bias_sigma, bias_level, not_judged: null };
  };
  const server = (over: Partial<VolumeTexture>): VolumeTexture => ({
    id: "demo.backfilled", punched_id: "demo.braggpunched", holes_from: "punch_record", rim: 4, min_rim: 8,
    min_sigma: 0.5, one_way: 0.75, min_holes: 5, floor: 0.2,
    n_holes: 125, n_judged: 125, judged: true, node_spacing: 20, room_needed: 14, not_judged: null,
    median_fill_bias_sigma: 0, median_fill_bias_level: 0, above_fraction: 0, below_fraction: 0,
    above_floor_fraction: 0, below_floor_fraction: 0, systematic_fill_bias: false, holes: [],
    ...over,
  });
  // A fill equal to the truth (_lattice()): no hole outside its range.
  const TRUTH = server({
    holes: [row(0, [-1.951724, -1.951724, -1.951724], 29, 363, [1.2676029908859836, 1.2407635975742777, 0.012642325063012515, -0.010843542091501825, 1.2636129322113534, 1.277073881014597, 0, 0, 0])],
  });
  // Half the level too high in 80 % of the holes (bias=0.5, share=0.8).
  const BIAS_80 = server({
    median_fill_bias_sigma: 39.119839779229835, median_fill_bias_level: 0.5061428748347895, above_fraction: 0.8, above_floor_fraction: 0.8, systematic_fill_bias: true,
    holes: [row(62, [0, 0, 0], 123, 2418, [1.9523023411431835, 1.2671364760287895, 0.011486059140566576, -0.011051517523915392, 1.2904796045027955, 1.30323826701008, 0.6490640741331035, 56.508857057921, 0.5122290190613664])],
  });
  // Satellites at (½, ½, 0.15) beside the nodes on a diffuse sharply peaked at
  // every one, all filled 12 % too high (width=4, amp=1, bias=0.12): 125 nodes
  // and 80 satellites, 64 of them whole. Every node and every whole satellite
  // reads 0.28 to 0.30 of the level outside its range, nodes and satellites
  // alike: the 16 holes under the floor (0.17) are the satellites the box's
  // face cuts down to a single voxel, their poles, as a cut through the nodes
  // crossed them (docs/pipeline.md, the fills' texture).
  const SATELLITES = server({
    n_holes: 205, n_judged: 205,
    median_fill_bias_sigma: 5.363201185121478, median_fill_bias_level: 0.2910240219427689, above_fraction: 1, above_floor_fraction: 0.9219512195121952, systematic_fill_bias: true,
    holes: [row(90, [0, -1.953191, -1.953191], 47, 684, [2.0284386042421496, 1.2916152081934598, 0.06682883141019066, -0.10194819777087087, 1.512923388159816, 1.636562691839383, 0.39187591240276665, 5.86387497931035, 0.30339989024352754])],
  });
  // Half the level too high in every hole, the grid's nodes 13 voxels apart:
  // under the 14 the holes, reaching 3 voxels, and their rims need.
  const COARSE = server({
    n_holes: 27, n_judged: 27, judged: false, node_spacing: 13,
    not_judged: "grid too coarse: the nodes are 13 voxels apart, under 14: a hole reaches 3 voxels and its rim 4 more",
    median_fill_bias_sigma: 4.727975561695145, median_fill_bias_level: 0.5102970053410898, above_fraction: 1, above_floor_fraction: 1,
    holes: [row(0, [-1, -1, -1], 123, 2418, [2.1367289559837643, 1.3582709527243337, 0.1495568028563944, -0.017704561668688803, 1.4134041424917692, 1.4338435551499302, 0.7028854008338341, 4.699788892309701, 0.5174854099795266])],
  });
  // Half the level too high in each of four holes: under the five the rule needs.
  const FOUR = server({
    n_holes: 4, n_judged: 4, judged: false,
    median_fill_bias_sigma: 41.412564914693164, median_fill_bias_level: 0.5163301414738879, above_fraction: 1, above_floor_fraction: 1,
    holes: [row(0, [-1, -1, 0], 123, 2418, [1.7900651656929363, 1.1389149366967461, 0.013955049115759488, -0.01893101790564045, 1.179545958419301, 1.2014012799038618, 0.5886638857890745, 42.182860189599346, 0.5168637857155572])],
  });
  const LIMITS = { minSigma: 0.5, oneWay: 0.75, minHoles: 5, floor: 0.2 };

  it("judges a fill equal to the truth by every hole in 3-D: no bias", async () => {
    onCuts(0);
    api.fetchVolumeTexture.mockResolvedValue(TRUTH);
    const r = await runOn(full, "texture_check", {});
    expect(r.ok).toBe(true);
    // The backfilled stage's holes, judged by the rule's own limits, the farthest one listed.
    expect(api.fetchVolumeTexture).toHaveBeenCalledWith("demo.backfilled", 1, LIMITS);
    const out = JSON.parse(r.text);
    expect(out).toEqual({
      n_holes: 125, n_judged: 125, median_fill_bias_sigma: 0, median_fill_bias_level: 0, above_fraction: 0, below_fraction: 0,
      above_floor_fraction: 0, below_floor_fraction: 0, systematic_fill_bias: false,
      // The cuts carry the azimuthal texture only.
      per_cut: ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"].map((c) => ({ cut: c, azimuthal_ratio: expect.any(Number) })),
    });
    for (const c of out.per_cut) expect(Math.abs(c.azimuthal_ratio - 1)).toBeLessThan(0.25); // as texture.test.ts holds a fill that matches
    expect(r.outcomes).toEqual([{ check: "texture", kind: "pass", reasons: [], dataProblems: [], words: null }]);
    expect(r.summary).toMatch(/^no systematic fill bias over 125 holes in 3-D · azimuthal ratio /);
    // No hole outside its range: the first cut.
    expect(r.view?.label).toBe("H–K plane at L = 0");
  });

  it("flags half the level too high in 80 % of the holes, and shows the plane through the farthest", async () => {
    onCuts(30);
    api.fetchVolumeTexture.mockResolvedValue(BIAS_80);
    const r = await runOn(full, "texture_check", {});
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ n_holes: 125, n_judged: 125, median_fill_bias_sigma: 39.1, median_fill_bias_level: 0.506, above_fraction: 0.8, below_fraction: 0, above_floor_fraction: 0.8, systematic_fill_bias: true });
    expect(out).not.toHaveProperty("not_judged");
    expect(r.outcomes?.[0]).toMatchObject({ kind: "attention", reasons: ["fill bias"] });
    expect(r.summary).toMatch(/^systematic fill bias over 125 holes in 3-D \(median 0\.506 of the level\)/);
    expect(r.view).toMatchObject({ view: "cleanup", plane: "hk0", value: 0, label: "H–K plane at L = 0" });
  });

  it("reads satellites beside the nodes as the nodes: all filled 12 % high, every whole hole past the floor", async () => {
    onCuts(0);
    api.fetchVolumeTexture.mockResolvedValue(SATELLITES);
    const r = await runOn(full, "texture_check", {});
    const out = JSON.parse(r.text);
    // 189 of the 205 holes beyond the floor: the 125 nodes and the 64 whole satellites.
    expect(out).toMatchObject({ n_holes: 205, n_judged: 205, median_fill_bias_level: 0.291, above_fraction: 1, above_floor_fraction: 0.922, systematic_fill_bias: true });
    expect(Math.round(out.above_floor_fraction * out.n_judged)).toBe(125 + 64);
    expect(r.outcomes?.[0]).toMatchObject({ kind: "attention", reasons: ["fill bias"] });
    // The hole farthest outside its range: the H–K plane through it.
    expect(r.view).toMatchObject({ plane: "hk0", value: -1.953, label: "H–K plane at L = -1.953" });
    // A cut asked for is the figure.
    expect((await runOn(full, "texture_check", { plane: "h0l", value: 0.5 })).view).toMatchObject({ plane: "h0l", value: 0.5 });
  });

  it("does not judge the fills on a grid too coarse for the holes' rims, and says why (the 3-D not_judged)", async () => {
    onCuts(30);
    api.fetchVolumeTexture.mockResolvedValue(COARSE);
    const r = await runOn(full, "texture_check", {});
    const out = JSON.parse(r.text);
    // No bias measured, though the rims read past the midpoint call it 0.51 of the level: no verdict either way.
    expect(out).toEqual({
      n_holes: 27,
      not_judged: "grid too coarse: the nodes are 13 voxels apart, under 14: a hole reaches 3 voxels and its rim 4 more",
      median_fill_bias_sigma: null, median_fill_bias_level: null, above_fraction: null, below_fraction: null,
      above_floor_fraction: null, below_floor_fraction: null, systematic_fill_bias: null,
      per_cut: expect.any(Array),
    });
    expect(r.outcomes).toEqual([{ check: "texture", kind: "info", reasons: ["grid too coarse"], dataProblems: [], words: null }]);
    expect(r.summary).toMatch(/^fill bias not judged: grid too coarse · azimuthal ratio /);
    expect(r.view?.label).toBe("H–K plane at L = 0");
  });

  it("does not judge fewer holes than the rule needs, and says why", async () => {
    onCuts(30);
    api.fetchVolumeTexture.mockResolvedValue(FOUR);
    const out = JSON.parse((await runOn(full, "texture_check", {})).text);
    expect(out).toMatchObject({ n_holes: 4, n_judged: 4, not_judged: "too few holes judged: 4 of 4, under 5", median_fill_bias_level: 0.516, above_floor_fraction: 1, systematic_fill_bias: null });
    expect((await runOn(full, "texture_check", {})).outcomes?.[0]).toMatchObject({ kind: "info", reasons: ["too few holes"] });
    api.fetchVolumeTexture.mockResolvedValue(server({ n_holes: 0, n_judged: 0, judged: false, median_fill_bias_sigma: null, median_fill_bias_level: null, above_fraction: null, below_fraction: null, above_floor_fraction: null, below_floor_fraction: null }));
    const none = await runOn(full, "texture_check", {});
    expect(JSON.parse(none.text)).toMatchObject({ n_holes: 0, not_judged: "no filled punch hole", systematic_fill_bias: null });
    expect(none.outcomes?.[0]).toMatchObject({ kind: "info", reasons: ["too few holes"] });
  });

  it("reads the fill bias from the volume's holes, not from the cuts", async () => {
    // Bright plugs on every cut, as the per-cut rule flagged them before 4.2, where the 3-D read finds none.
    onCuts(30);
    api.fetchVolumeTexture.mockResolvedValue(TRUTH);
    const r = await runOn(full, "texture_check", {});
    const out = JSON.parse(r.text);
    expect(out.systematic_fill_bias).toBe(false);
    for (const c of out.per_cut) {
      expect(Object.keys(c)).toEqual(["cut", "azimuthal_ratio"]);
      expect(c.azimuthal_ratio).toBeGreaterThan(1.25); // the plugs vary around the shells
    }
    expect(r.outcomes?.[0]).toMatchObject({ kind: "pass" });
  });

  it("refuses a 3-D read judged by other limits than the rule's", async () => {
    onCuts(0);
    api.fetchVolumeTexture.mockResolvedValue({ ...TRUTH, floor: 0.1 });
    const r = await runOn(full, "texture_check", {});
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/the backend judged the fills by other limits \(\{"minSigma":0\.5,"oneWay":0\.75,"minHoles":5,"floor":0\.1\}\)/);
  });

  it("needs the punched and backfilled outputs", async () => {
    expect((await run("texture_check", {})).text).toMatch(/needs the punched and backfilled outputs/);
    expect(api.fetchVolumeTexture).not.toHaveBeenCalled();
  });
});

describe("radial_profile", () => {
  it("puts the stages' shell medians side by side", async () => {
    api.fetchSlice.mockImplementation(async (id: string) =>
      makeSlice(21, 21, (x, y) => (id === "demo.raw" ? 10 : 2) + Math.hypot(x, y), { half: 2 }),
    );
    const out = JSON.parse((await runOn(full, "radial_profile", { stages: ["raw", "flattened"], bins: 8 })).text);
    expect(out.q_unit).toBe("|Q| in Å⁻¹");
    // A row per shell, in a column table (THY-63 R1).
    expect(out.shells.cols).toEqual(["q", "raw", "flattened"]);
    const rows = tableRows(out.shells) as { q: number; raw: number; flattened: number }[];
    expect(rows[0].raw - rows[0].flattened).toBeCloseTo(8, 5);
    expect(rows[rows.length - 1].q).toBeGreaterThan(rows[0].q);
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
