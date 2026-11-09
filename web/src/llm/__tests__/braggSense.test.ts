// The pre-run Bragg sensing (THY-43) in the Pilot: bragg_sense's result (the
// sensing's lines and what to set), its transcript line and the data its
// overlays draw (tools/defs/bragg_sense.ts); the settings it reads from the
// Configure page; its offer, before a run only (localTools.ts offeredOn); the
// card that declares a symmetry the data were averaged with and declare none
// (apply/proposals.ts), the user's; its overlays on the raw view; and the
// answer checks reading an answer about the punch before a run on it.
// Synthetic only: the API client is mocked.

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { BraggSense, Dataset } from "../../api/types";
import type { AgentStep } from "../agent";
import { evidenceGaps } from "../answerChecks";
import { buildProposals } from "../apply/proposals";
import { examining, overlaysOf } from "../examine/overlays";
import { offeredOn, toolsFor } from "../localTools";
import { callTool, CHAT_TOOLS, factsOf } from "../tools";
import { usePipelineStore } from "../../state/pipelineStore";
import { BRAGG_SENSE_LINES, DATASET, DATASETS, freshConsole, installBackend } from "./syntheticCrystal";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchBraggSense: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchProtectedLabels: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingSurvey: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
}));
vi.mock("../../api/client", () => api);

// The synthetic crystal before its run: its raw volume alone.
const BEFORE: Dataset = { ...DATASET, stages: DATASET.stages.map((s) => (s.name === "raw" ? s : { ...s, exists: false })) };

// Round peaks of a volume symmetrised over mmm that declares none, as the
// sensing's Python reads the synthetic one of its tests (tests/test_bragg_sense.py:
// thin(gauss(0.8, 0.8)) on a 4.5 × 5.0 × 5.6 Å cell, symmetrised).
const ROUND_SYMMETRISED: BraggSense = {
  id: "x.raw",
  version: 1,
  sections: [
    { plane: "0kl", cut: 0, voxel_q: 0.0628 },
    { plane: "h0l", cut: 0, voxel_q: 0.0698 },
    { plane: "hk0", cut: 0, voxel_q: 0.0698 },
    { plane: "0kl", cut: 1, voxel_q: 0.0628 },
    { plane: "h0l", cut: 1, voxel_q: 0.0698 },
    { plane: "hk0", cut: 1, voxel_q: 0.0698 },
  ],
  n_nodes: 195,
  mirrors: { tested: 12, worst_share: 0, exact: true, declared: false, declare: "mmm" },
  not_judged: null,
  evidence: { tilted_elongated_share: 0, multi_lobe_share: 0, cap_binds_share: 0.728, median_elongation: 1.121, resolved_share: 1 },
  footprints: null,
  width_q: null,
  prediction: { footprint: "own", drop_fit_constraints: false, q_dependent_reach: false, compared: {} },
  flagged: [],
  seconds: 0.06,
  lines: {
    symmetry: "declares none, yet every axis mirror holds to 0.0e+00 of the spread: symmetrised already; declaring mmm is the user's",
    shape: "195 strong nodes on 6 sections: 0.0 % tilted and elongated, 0.0 % with several lobes; the fit's cap binds on 72.8 %",
    left: "median share each footprint leaves: own 0.3 %, ellipsoid 0.6 % (0.63× own's area), ellipsoid_unc 0.5 % (0.69× own's area)",
    footprint: "punchFootprint own (keep): the ellipsoid leaves 0.3 points more than own; tilted + lobed 0.0 %; 0.63× own's area",
  },
};

beforeAll(() => {
  installBackend(api);
});

const sensed = async (dataset: Dataset = BEFORE) => {
  const r = await callTool({ dataset, datasets: DATASETS }, "bragg_sense", {});
  expect(r.ok, r.text).toBe(true);
  return r;
};

describe("bragg_sense's result", () => {
  it("is the sensing's lines and the settings to set; its transcript line and overlay data are beside it", async () => {
    freshConsole();
    const r = await sensed();
    expect(JSON.parse(r.text)).toEqual({ ...BRAGG_SENSE_LINES, recommend: { punchFootprint: "ellipsoid", punchFitUnconstrained: true } });
    expect(r.summary).toBe("195 strong nodes · punchFootprint ellipsoid, punchFitUnconstrained true · reach grows with |Q|");
    // The flagged peaks ride beside the result, for the overlays; the model reads the lines alone.
    expect(r.text).not.toMatch(/flagged|dirs|widths/);
  });

  it("keeps the defaults when the peaks ask for nothing, and says so", async () => {
    freshConsole();
    api.fetchBraggSense.mockResolvedValueOnce(ROUND_SYMMETRISED);
    const r = await sensed();
    const out = JSON.parse(r.text);
    expect(out.recommend).toBe("keep the defaults");
    expect(out.symmetry).toMatch(/declaring mmm is the user's$/);
    expect(r.summary).toBe("195 strong nodes · keep the default footprint · symmetrised, declares none (mmm)");
  });

  it("reads the run's edge trim and punch settings, and no other", async () => {
    freshConsole();
    usePipelineStore.setState({ edgeTrim: "2", punchMargin: "0.05", flattenQ2: true });
    await sensed();
    const [id, params] = api.fetchBraggSense.mock.lastCall!;
    expect(id).toBe(`${DATASET.id}.raw`);
    expect(params).toMatchObject({ edge_trim: 2, punch_margin: 0.05 });
    expect(Object.keys(params).every((k) => k === "edge_trim" || k.startsWith("punch_"))).toBe(true);
  });
});

describe("the offer: before a run only", () => {
  it("is a pre-run tool, offered for the punch or a general question before a run, never after it", () => {
    expect(factsOf("bragg_sense").preRun).toBe(true);
    expect(offeredOn(CHAT_TOOLS, DATASET).map((t) => t.name)).not.toContain("bragg_sense");
    for (const q of ["Is the punch clean?", "What do you see?", "Run the pipeline and check it."]) {
      expect(toolsFor(q, offeredOn(CHAT_TOOLS, BEFORE)).map((t) => t.name), q).toContain("bragg_sense");
    }
  });
});

describe("the card that declares a symmetry the data were averaged with", () => {
  // The step a reply keeps of a call, its overlay data beside its result (the backend mocked as each test sets it).
  const step = (): Promise<AgentStep> =>
    callTool({ dataset: BEFORE, datasets: DATASETS }, "bragg_sense", {}).then((r) => ({
      id: "0:c1",
      name: "bragg_sense",
      args: {},
      status: "done",
      result: r.text,
      summary: r.summary,
      ...(r.overlay ? { overlay: r.overlay } : {}),
    }));

  it("offers the symmetry average over the class, held for the user's click", async () => {
    freshConsole();
    api.fetchBraggSense.mockResolvedValueOnce(ROUND_SYMMETRISED);
    const s = await step();
    const ps = buildProposals({ turn: 1, steps: [s], answer: "", config: usePipelineStore.getState(), dataset: BEFORE.id, firstId: 1 });
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({
      kind: "fact",
      held: "symmetry",
      title: "Declare mmm (symmetry average)",
      change: { symmetryAverageEnabled: true, symmetryLaue: "mmm" },
      fields: { symmetryAverageEnabled: true, symmetryLaue: "mmm" },
      runFrom: "symmetry_average",
      source: { via: "suggestion" },
    });
  });

  it("offers nothing for data that declare their symmetry, or are not symmetrised", async () => {
    freshConsole();
    const s = await step(); // the crystal's own: declared
    expect(buildProposals({ turn: 1, steps: [s], answer: "", config: usePipelineStore.getState(), dataset: BEFORE.id, firstId: 1 })).toEqual([]);
  });

  it("never sets a method setting itself: the model does, with update_settings", async () => {
    freshConsole();
    const s = await step();
    const ps = buildProposals({ turn: 1, steps: [s], answer: "", config: usePipelineStore.getState(), dataset: BEFORE.id, firstId: 1 });
    expect(ps.some((p) => "punchFootprint" in p.change || "punchFitUnconstrained" in p.change)).toBe(false);
  });
});

describe("its overlays on the raw view", () => {
  it("draws each flagged peak as its fit's ellipse, tilted ones amber, lobed ones red", async () => {
    freshConsole();
    const r = await sensed();
    const set = overlaysOf({ id: "0:c1", name: "bragg_sense", args: {}, status: "done", result: r.text, ...(r.overlay ? { overlay: r.overlay } : {}) });
    expect(set?.title).toBe("Bragg peaks before the run");
    expect(set?.views).toEqual({ raw: "primary" });
    expect(set?.classes.map((c) => c.id)).toEqual(["sTilt", "sLobes"]);
    expect(set?.items.every((i) => i.kind === "footprint")).toBe(true);
    expect(examining({ name: "bragg_sense", args: {} })?.title).toBe("Bragg peaks before the run");
  });

  it("draws nothing for a step without its data", () => {
    expect(overlaysOf({ id: "0:c1", name: "bragg_sense", args: {}, status: "done", result: JSON.stringify(BRAGG_SENSE_LINES) })).toBeNull();
  });
});

describe("an answer about the punch, before a run and after it", () => {
  const ANSWER = "The Bragg punch is clean with the ellipsoid footprint, by the sensing: {{bragg_sense.footprint}}.";
  const step: AgentStep = { id: "0:c1", name: "bragg_sense", args: {}, status: "done", result: JSON.stringify({ ...BRAGG_SENSE_LINES, recommend: "keep the defaults" }) };
  const ran: AgentStep = { id: "0:c2", name: "run_pipeline", args: {}, status: "done", result: JSON.stringify({ stages: { rings: "computed", punch: "computed" } }) };
  it("stands on the sensing before a run, and needs the punch's check after one", () => {
    expect(evidenceGaps(ANSWER, [step])).toEqual({ missing: [], stale: [] });
    expect(evidenceGaps(ANSWER, [step, ran]).stale.map((t) => t.id)).toEqual(["punch"]);
  });
});
