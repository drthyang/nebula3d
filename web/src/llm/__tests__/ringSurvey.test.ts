// The pre-run ring survey (THY-43) in the Pilot: ring_survey's result, its
// transcript line and the data its overlays draw (tools/defs/ring_survey.ts);
// its offer, before a run only, a call by name running all the same
// (localTools.ts offeredOn, agent.ts); and its overlays on the raw view, from
// that data or, for a step drawn again without it, from the result's lines
// (examine/overlays.ts). Synthetic only: the API client is mocked.

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Dataset, RingSurvey } from "../../api/types";
import { runAgent } from "../agent";
import { examining, overlaysOf, surveyShellsFromResult } from "../examine/overlays";
import { offeredOn, ranOn, toolsFor } from "../localTools";
import type { StreamDelta, ToolSpec } from "../provider/client";
import { DEFAULT_SETTINGS } from "../settings";
import { callTool, CHAT_TOOLS, factsOf } from "../tools";
import { DATASET, DATASETS, freshConsole, installBackend } from "./syntheticCrystal";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
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

const model = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: model.streamChat,
}));

// The synthetic crystal before its run: its raw volume alone.
const BEFORE: Dataset = { ...DATASET, stages: DATASET.stages.map((s) => (s.name === "raw" ? s : { ...s, exists: false })) };

// Al, Bi and a ring no line explains, as the survey's Python labels them
// (nebula3d.preprocessing.ring_survey), on a volume of three phases.
const THREE: RingSurvey = {
  id: "x.raw",
  version: 1,
  dry_run: true,
  plane: "0kl",
  slice_axis: "H",
  edge_trim: 1,
  q_range: [1.5, 10.5],
  q_step: 0.02,
  al_lattice_a: 4.0367,
  noise: 0.1,
  rings: [
    { q: 1.9275, fwhm: 0.08, snr: 16.4, code: "PH", line: "Bi012", phase: "Bi", status: "likely", ring: true, removed: true, source: "detected" },
    { q: 2.6925, fwhm: 0.08, snr: 192.9, code: "AL", line: "Al111", ring: true, removed: true, source: "detected" },
    { q: 3.0975, fwhm: 0.08, snr: 95.4, code: "AL", line: "Al200", ring: true, removed: true, source: "detected" },
    { q: 3.5925, fwhm: 0.08, snr: 84.8, code: "UNK", ring: true, removed: true, source: "detected" },
    { q: 3.4575, fwhm: 0.1, snr: 43.9, code: "XTAL", ring: false, removed: false, why: "isotropy", source: "detected" },
    { q: 4.1, fwhm: 0.1, snr: 7.1, code: "NR", ring: false, removed: false, why: "snr", source: "detected" },
    { q: 9.99, fwhm: 0.05, snr: 12, code: "NJ", ring: null, removed: false, why: "flank", source: "weak" },
  ],
  faint: 3,
  phases: null,
  phase_summary: "likely Bi flux: 1 of 1 rings matched, scale -0.4 %; lines 012 1.93; unmatched 3.59",
  phase_unsupported: null,
  not_judged: null,
  timing_s: { profiles: 0.4, detect: 1.5, total: 1.5 },
  lines: {
    al: "a=4.0367 Å; lines 111 2.69, 200 3.10",
    phases: "likely Bi flux: 1 of 1 rings matched, scale -0.4 %; lines 012 1.93; unmatched 3.59",
    unrecognized: "3.59 (snr 85, removed)",
    unconfirmed: "9.99 (snr 12, flank)",
    removal: "would remove 4 (Al 2, phase 1, unrecognized 1); keep 2 (2 not rings)",
  },
};

beforeAll(() => {
  installBackend(api);
});

describe("ring_survey's result", () => {
  it("is the survey's lines; its transcript line and overlay data are beside it", async () => {
    freshConsole();
    api.fetchRingSurvey.mockResolvedValueOnce(THREE);
    const r = await callTool({ dataset: BEFORE, datasets: DATASETS }, "ring_survey", {});
    expect(r.ok, r.text).toBe(true);
    expect(JSON.parse(r.text)).toEqual({
      al: "a=4.0367 Å; lines 111 2.69, 200 3.10",
      phases: THREE.lines!.phases,
      unrecognized: "3.59 (snr 85, removed)",
      unconfirmed: "9.99 (snr 12, flank)",
      removal: THREE.lines!.removal,
    });
    expect(r.summary).toBe("Al a=4.037 Å, 2 lines · possibly Bi · unrecognized 3.59");
    // The survey reads the raw volume with the ring stage's stack axis and the run's edge trim.
    expect(api.fetchRingSurvey).toHaveBeenLastCalledWith(`${DATASET.id}.raw`, "H", 1);
  });

  it("reads the Configure page's stack axis and edge trim", async () => {
    freshConsole();
    const { usePipelineStore } = await import("../../state/pipelineStore");
    usePipelineStore.setState({ ringSliceAxis: "L", edgeTrim: "2" });
    await callTool({ dataset: BEFORE, datasets: DATASETS }, "ring_survey", {});
    expect(api.fetchRingSurvey).toHaveBeenLastCalledWith(`${DATASET.id}.raw`, "L", 2);
  });
});

describe("the offer: before a run only", () => {
  it("is a pre-run tool, offered on a dataset with its raw volume alone", () => {
    expect(CHAT_TOOLS.filter((t) => factsOf(t.name).preRun).map((t) => t.name)).toEqual(["ring_survey"]);
    expect([ranOn(BEFORE), ranOn(DATASET)]).toEqual([false, true]);
    expect(offeredOn(CHAT_TOOLS, BEFORE)).toHaveLength(CHAT_TOOLS.length);
    expect(offeredOn(CHAT_TOOLS, DATASET).map((t) => t.name)).not.toContain("ring_survey");
    // A local model, before a run, for a question about the rings or a general one.
    for (const q of ["Are there powder rings?", "What do you see?", "Run the pipeline and check it."]) {
      expect(toolsFor(q, offeredOn(CHAT_TOOLS, BEFORE)).map((t) => t.name), q).toContain("ring_survey");
    }
  });

  it("is held back from a reply after a run, and a call by name runs all the same", async () => {
    freshConsole();
    const sent: ToolSpec[][] = [];
    const script: StreamDelta[][] = [
      [{ toolCalls: [{ id: "c1", type: "function", function: { name: "ring_survey", arguments: "{}" } }] }],
      [{ content: "Done." }],
    ];
    model.streamChat.mockImplementation((args: { tools?: ToolSpec[] }) => {
      sent.push(args.tools ?? []);
      const reply = script.shift() ?? [];
      return (async function* () {
        for (const d of reply) yield d;
      })();
    });
    const run = (dataset: Dataset) =>
      runAgent({
        messages: [{ role: "system", content: "s" }, { role: "user", content: "Are there powder rings?" }],
        tools: CHAT_TOOLS,
        ctx: { dataset, datasets: DATASETS, skillsRead: new Set(), earlierSteps: [] },
        settings: { ...DEFAULT_SETTINGS, baseUrl: "https://api.anthropic.com", model: "scripted", followViews: false },
        signal: new AbortController().signal,
        checkAnswers: false,
      });
    const after = await run(DATASET);
    const names = (i: number) => sent[i].map((t) => t.function.name);
    expect(names(0)).not.toContain("ring_survey");
    expect(after.steps.map((s) => [s.name, s.status])).toEqual([["ring_survey", "done"]]);
    // Called by name, it joins the offer for the rest of the reply.
    expect(names(1)).toContain("ring_survey");
  });
});

describe("its overlays on the raw view", () => {
  const stepOf = (result: unknown, overlay?: unknown) => ({
    id: "0:c1",
    name: "ring_survey",
    args: {},
    status: "done" as const,
    result: JSON.stringify(result),
    ...(overlay ? { overlay } : {}),
  });

  it("draw each shell by its code, the Al lines and the phase's by their line, the unrecognized by their |Q|", () => {
    const set = overlaysOf(stepOf(THREE.lines, { ringSurvey: THREE.rings.map((r) => ({ q: r.q, code: r.code, line: r.line ?? null, phase: r.phase ?? null })) }))!;
    expect(set.title).toBe("Ring survey");
    expect(set.views).toEqual({ raw: "primary" });
    expect(set.where).toBe("2 Al lines · possibly Bi (1) · unrecognized 3.59 Å⁻¹");
    const shells = set.items.map((i) => (i.kind === "shell" ? [i.cls, i.q, i.label ?? null] : null));
    expect(shells).toEqual([
      ["PH", 1.9275, "Bi 012"],
      ["AL", 2.6925, "AL 111"],
      ["AL", 3.0975, "AL 200"],
      ["UNK", 3.5925, "? 3.59"],
      ["XTAL", 3.4575, null],
      // NR (not a ring by the test, on no line) is not drawn.
      ["NJ", 9.99, null],
    ]);
    // The legend in the registry's order.
    expect(set.classes.map((c) => c.id)).toEqual(["AL", "XTAL", "NJ", "PH", "UNK"]);
    expect(set.classes.find((c) => c.id === "UNK")).toMatchObject({ code: "?", label: "unrecognized ring", views: { raw: "full" } });
    expect(set.help.join(" ")).toMatch(/nothing removed/);
    expect(set.help).toContain("The fitted Al lattice: a = 4.0367 Å.");
  });

  it("draw from the result's lines when the step has no data (a step drawn again)", () => {
    expect(surveyShellsFromResult(THREE.lines as unknown as Record<string, unknown>)).toEqual([
      { q: 1.93, code: "PH", line: "Bi012", phase: "Bi" },
      { q: 2.69, code: "AL", line: "Al111", phase: null },
      { q: 3.1, code: "AL", line: "Al200", phase: null },
      { q: 3.59, code: "UNK", line: null, phase: null },
      { q: 9.99, code: "NJ", line: null, phase: null },
    ]);
    const set = overlaysOf(stepOf(THREE.lines))!;
    expect(set.items).toHaveLength(5);
    // A volume with no ring: nothing to draw.
    expect(overlaysOf(stepOf({ al: "no Al lattice fitted", phases: null, unrecognized: "none", removal: "would remove 0; keep 0" }))).toBeNull();
  });

  it("names its step while it runs", () => {
    expect(examining({ name: "ring_survey", args: {} })).toEqual({ title: "Ring survey", views: { raw: "primary" } });
  });
});
