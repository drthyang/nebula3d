// The tools' result contracts (tools/contracts.ts): every tool of the
// registry has one, or returns text; the check names where a result
// disagrees; and the paths the samples do not reach (a tool's other shapes,
// its fields left out) keep their contracts too, each run by the tool on the
// synthetic crystal (syntheticCrystal.ts) with the API answer that leads there.
// The samples are held to their contracts where they are made:
// modelVisible.test.ts ("4. a sample of each tool's result"), and the live
// results on the dev control in contracts.replay.test.ts.
//
// Hermetic and synthetic: a mocked API, a stubbed tuning run, no model.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { callTool, CHAT_TOOLS, type ToolRun } from "../tools";
import { useTuneStore } from "../tune/tuner";
import { DATASET, DATASETS, freshConsole, installBackend } from "./syntheticCrystal";
import {
  arr,
  bool,
  contractDisagreements,
  describe as describeShape,
  disagreements,
  lit,
  nul,
  nullable,
  num,
  obj,
  oneOf,
  optional,
  rec,
  RESULT_CONTRACTS,
  str,
  TEXT_RESULTS,
  tuple,
  union,
} from "../tools/contracts";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const tuner = vi.hoisted(() => ({ startTuning: vi.fn() }));
vi.mock("../tune/tuner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tune/tuner")>()),
  startTuning: tuner.startTuning,
}));

describe("the contracts cover the registry", () => {
  it("one per tool whose result is an object; the text tools have none", () => {
    const names = CHAT_TOOLS.map((t) => t.name);
    expect([...Object.keys(RESULT_CONTRACTS), ...TEXT_RESULTS].sort()).toEqual([...names].sort());
    for (const name of TEXT_RESULTS) expect(RESULT_CONTRACTS[name], name).toBeUndefined();
  });

  it("each is an object, or a union of objects (a tool's paths)", () => {
    for (const [name, shape] of Object.entries(RESULT_CONTRACTS)) {
      const alternatives = shape.kind === "union" ? shape.of : [shape];
      expect(alternatives.map((s) => s.kind), name).toEqual(alternatives.map(() => "object"));
    }
  });

  it("a tool without one is a disagreement, and a text tool's result is text", () => {
    expect(contractDisagreements("no_such_tool", {})).toEqual(["no_such_tool: no contract (tools/contracts.ts)"]);
    expect(contractDisagreements("read_skill", "Skill reduction-qc …")).toEqual([]);
    expect(contractDisagreements("read_skill", { text: "…" })).toEqual(["read_skill: expected text, got object"]);
  });
});

describe("a result against its contract", () => {
  const shape = obj({
    cut: str,
    n: num,
    flag: nullable(bool),
    note: optional(str),
    range: tuple(num, num),
    rows: arr(obj({ q: num, v: nullable(num) })),
    by: rec(num),
    sign: oneOf("+", "−"),
  });
  const good = { cut: "H–K plane at L = 0", n: 3, flag: null, range: [0, 1], rows: [{ q: 1, v: null }], by: { a: 1 }, sign: "+" };

  it("agrees when every field is there with its type, an optional one left out", () => {
    expect(disagreements(shape, good)).toEqual([]);
    expect(disagreements(shape, { ...good, note: "a note" })).toEqual([]);
  });

  it("names a field left out, one the contract does not hold, and one of another type, by its path", () => {
    const { n: _n, ...withoutN } = good;
    void _n;
    expect(disagreements(shape, withoutN)).toEqual(["result.n: missing (number)"]);
    expect(disagreements(shape, { ...good, renamed: 3 })).toEqual(["result.renamed: not in the contract (got number)"]);
    expect(disagreements(shape, { ...good, rows: [{ q: "1", v: 2 }] })).toEqual(['result.rows[0].q: expected number, got "1"']);
    expect(disagreements(shape, { ...good, by: { a: true } })).toEqual(["result.by.a: expected number, got boolean"]);
    expect(disagreements(shape, { ...good, sign: "-" })).toEqual(['result.sign: expected "+" | "−", got "-"']);
  });

  it("holds a tuple to its length, and null to nullable fields only", () => {
    expect(disagreements(shape, { ...good, range: [0, 1, 2] })).toEqual(["result.range: expected 2 items ([number, number]), got 3"]);
    expect(disagreements(shape, { ...good, cut: null })).toEqual(["result.cut: expected string, got null"]);
  });

  it("agrees with a union when one shape does, and else names the closest one's disagreements", () => {
    const paths = union(obj({ note: str }), obj({ section: str, ops: arr(num) }));
    expect(disagreements(paths, { note: "nothing to test" })).toEqual([]);
    expect(disagreements(paths, { section: "x–y", ops: [1, 2] })).toEqual([]);
    expect(disagreements(paths, { section: "x–y", ops: [1, "2"] })).toEqual(['result.ops[1]: expected number, got "2"']);
    expect(disagreements(union(lit(false), nul), true)).toEqual(["result: expected false | null, got boolean"]);
    expect(disagreements(paths, "nothing")).toEqual(['result: expected { note } | { section, ops }, got "nothing"']);
  });

  it("describes a shape in a few words", () => {
    expect(describeShape(shape)).toBe("{ cut, n, flag, note?, range, rows, by, sign }");
    expect(describeShape(nullable(arr(tuple(num, nullable(num)))))).toBe("array of [number, number | null] | null");
  });
});

describe("the registry's contracts, on results with a field renamed", () => {
  // What a renamed or retyped field does to a real contract: the test that
  // holds the tool's results to it fails, naming the field.
  it("fails a tool's result whose field was renamed, or changed type", () => {
    const view = { page: "reciprocal", dataset: "a", reciprocal_cut: null, dpdf_cuts_A: { x: 0, y: 0, z: 4 } };
    expect(contractDisagreements("current_view", view)).toEqual([]);
    const { dpdf_cuts_A: cuts, ...rest } = view;
    expect(contractDisagreements("current_view", { ...rest, dpdf_cuts: cuts })).toEqual([
      "current_view.dpdf_cuts_A: missing ({ x, y, z } | null)",
      "current_view.dpdf_cuts: not in the contract (got object)",
    ]);
    expect(contractDisagreements("current_view", { ...view, page: 3 })).toEqual(["current_view.page: expected string, got number"]);
  });
});

describe("the paths the samples do not reach, on the synthetic crystal", () => {
  beforeEach(() => {
    installBackend(api);
    freshConsole();
  });

  /** One call by name, its whole result as JSON reads it, held to its contract. */
  async function run(name: string, args: Record<string, unknown> = {}, dataset: Dataset = DATASET): Promise<Record<string, unknown>> {
    const r: ToolRun = await callTool({ dataset, datasets: DATASETS }, name, args);
    expect(r.ok, `${name}: ${r.text}`).toBe(true);
    const result = JSON.parse(r.full ?? r.text) as Record<string, unknown>;
    expect(contractDisagreements(name, result)).toEqual([]);
    return result;
  }

  /** The synthetic dataset with only these stage outputs on disk. */
  const withOutputs = (...names: string[]): Dataset => ({
    ...DATASET,
    stages: DATASET.stages.map((s) => ({ ...s, exists: names.includes(s.name) })),
  });

  it("assess_stage: a stage whose output is missing", async () => {
    const result = await run("assess_stage", { stage: "all" }, withOutputs("raw", "ringremoved", "braggpunched", "backfilled"));
    expect(result.flatten).toEqual({ missing: "no flattened output yet; run_pipeline computes it" });
    expect(result.pdf).toEqual({ missing: "no delta_pdf output yet; run_pipeline computes it" });
    expect(result.rings).toHaveProperty("verdict");
  });

  it("describe_dataset, current_view and measure_reciprocal_cut on a dataset without its ΔPDF or later stages", async () => {
    const early = withOutputs("raw", "ringremoved");
    expect((await run("describe_dataset", {}, early)).delta_pdf).toBeNull();
    expect((await run("current_view", {}, early)).dpdf_cuts_A).toBeNull();
    const cut = await run("measure_reciprocal_cut", { plane: "hk0", value: 0 }, early);
    expect([cut.bragg_punch_leftover, cut.backfill, cut.flatten]).toEqual([null, null, null]);
  });

  it("texture_check: a cut whose slices could not be read is its label alone", async () => {
    const real = api.fetchSlice.getMockImplementation()!;
    api.fetchSlice.mockImplementation(async (id: string, ...rest: unknown[]) => {
      if (id.endsWith(".backfilled")) throw new Error("the slice could not be read");
      return real(id, ...rest);
    });
    const result = await run("texture_check", { plane: "hk0", value: 0 });
    expect(result.per_cut).toEqual([{ cut: "H–K plane at L = 0" }]);
  });

  it("qmax_coverage: without the raw volume's coverage, no raw_counts, suggested_band or band_check", async () => {
    api.fetchVolumeCoverage.mockRejectedValue(new Error("no coverage"));
    const result = await run("qmax_coverage");
    expect(result).not.toHaveProperty("raw_counts");
    expect(result).not.toHaveProperty("suggested_band");
    expect(result).not.toHaveProperty("band_check");
    expect(result.counts_end_inside_box).toBe(false);
  });

  it("symmetry_check: a cell with no in-plane symmetry to test is a note alone", async () => {
    const real = api.fetchDpdfMeta.getMockImplementation()!;
    api.fetchDpdfMeta.mockImplementation(async (id: string) => ({ ...(await real(id)), lattice: { a: null, b: null, c: null } }));
    expect(Object.keys(await run("symmetry_check"))).toEqual(["note"]);
  });

  it("dpdf_contrast: reset reads what the viewer went back to; a brighter limit adds its note", async () => {
    expect(await run("dpdf_contrast", { reset: true })).toEqual({ applied: "Auto: the 99.9th percentile of |ΔPDF|" });
    expect(await run("dpdf_contrast", { percentile: 99 })).toHaveProperty("note");
  });

  it("bragg_peaks and consistency_details: without a profile, or a saved check", async () => {
    api.fetchBraggProfile.mockResolvedValue({ has_profile: false, peaks: [], n_peaks: 0 });
    api.fetchConsistencyCheck.mockResolvedValue({ dataset_id: DATASET.id, check_path: "", has_check: false, metrics: null });
    expect(await run("bragg_peaks")).toEqual({ has_profile: false });
    expect(await run("consistency_details")).toEqual({ has_check: false });
  });

  it("ub_check: a check that measured no mean offset", async () => {
    const real = api.fetchUbCheck.getMockImplementation()!;
    api.fetchUbCheck.mockImplementation(async (...args: unknown[]) => ({ ...(await real(...args)), mean_offset_rlu: null }));
    const result = await run("ub_check");
    expect([result.mean_offset_rlu, result.origin_shift_rlu]).toEqual([null, null]);
  });

  it("compare_datasets: the ΔPDF's rows, and a dataset the cut could not be measured on", async () => {
    const dpdf = await run("compare_datasets", { kind: "dpdf", plane: "xy", value: 0 });
    expect((dpdf.rows as object[]).every((r) => "back_fft_r" in r)).toBe(true);
    const outside = await run("compare_datasets", { kind: "reciprocal", plane: "hk0", value: 9 });
    expect((outside.rows as object[]).map((r) => Object.keys(r))).toEqual([["dataset", "error"], ["dataset", "error"]]);
  });

  it("line_profile and radial_profile through the ΔPDF, and on chosen stages", async () => {
    expect((await run("line_profile", { stage: "delta_pdf", along: "x", at: { y: 0, z: 0 } })).units).toBe("Å");
    const radial = await run("radial_profile", { plane: "0kl", stages: ["raw", "flattened"], bins: 8 });
    expect(Object.keys((radial.rows as object[])[0])).toEqual(["q", "raw", "flattened"]);
  });

  it("update_settings: a setting already at its value, and one with no effect under the current model", async () => {
    const result = await run("update_settings", { changes: { ringNFourier: 6, pdfWindowSupport: true } });
    expect(result.already_set).toEqual(["pdfWindowSupport"]);
    expect(result.changed).toEqual([{ setting: "ringNFourier", from: 8, to: 6, note: "no effect with the current model" }]);
    const none = await run("update_settings", { changes: { ringNFourier: 6 } });
    expect([none.changed, none.rerun_from]).toEqual([[], null]);
  });

  it("run_log: one stage's lines", async () => {
    usePipelineStore.setState({ events: [{ type: "progress", stage: "punch", status: "done", message: "13 peaks punched" }], terminal: "done", running: false });
    expect(await run("run_log", { stage: "punch", limit: 5 })).toEqual({
      ended: "done",
      lines: [{ stage: "punch", status: "done", message: "13 peaks punched" }],
    });
  });

  it("tune_pipeline: a trial that failed, a stage run once between tuned ones, and no settings changed", async () => {
    const evaluation = { leftover_at_nodes: 1, leftover_off_lattice_sharp: 0, leftover_off_lattice_broad: 2, mean_punched_fraction: 0.031 };
    tuner.startTuning.mockImplementation(async () => {
      useTuneStore.setState({
        active: false,
        finishedNote: null,
        stages: [
          {
            stage: "punch",
            tuned: true,
            status: "done",
            best: 1,
            why: "Trial 2 failed; the current settings stay.",
            trials: [
              { n: 1, changes: {}, settings: {}, status: "done", evaluation },
              { n: 2, changes: { punchMinSig: 4 }, settings: {}, status: "error", error: "the run failed" },
            ],
          },
          { stage: "backfill", tuned: false, status: "done", trials: [{ n: 1, changes: {}, settings: {}, status: "done", evaluation: {} }], best: 1 },
          { stage: "flatten", tuned: true, status: "failed", trials: [], message: "the trial's run failed" },
        ],
      });
    });
    const result = await run("tune_pipeline", { stages: ["punch", "flatten"], trials_per_stage: 2 });
    const stages = result.stages as Record<string, unknown>[];
    expect((stages[0].trials as object[])[1]).toEqual({ n: 2, changes: { punchMinSig: 4 }, status: "error", error: "the run failed" });
    expect(stages[1]).not.toHaveProperty("trials");
    expect(stages[2]).toEqual({ stage: "flatten", status: "failed", tuned: true, message: "the trial's run failed" });
    expect(result).not.toHaveProperty("write_outputs_with");
    expect(result.note).toBeNull();
  });
});
