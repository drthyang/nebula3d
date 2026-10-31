// A restored session resumes accurately: Recompute runs with the settings of
// the run that made the outputs (not a form edited after it), on the input
// the session was saved with; outputs rewritten since are not taken for the
// session's; a file's values are used only when they have the type the
// console keeps them in; an earlier version's file still loads, saying what
// it cannot check.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The run goes to the in-browser engine, which records what it was asked.
const engine = vi.hoisted(() => ({
  PYODIDE_MODE: true,
  engine: { runPipeline: vi.fn<(req: { paramsJson: string; flattenEnabled: boolean; stages: string[] }) => Promise<void>>(async () => undefined) },
  cancelPipeline: vi.fn(),
}));
vi.mock("../../api/pyodideEngine", () => engine);

import type { Dataset, JobEvent } from "../../api/types";
import { toolStepsIn } from "../../llm/agent";
import { useChatStore } from "../../llm/chatStore";
import { rememberConfig } from "../configMemory";
import { useDatasetStore } from "../datasetStore";
import { usePipelineStore, STAGES } from "../pipelineStore";
import { APP_VERSION, captureSession, parseSession, restoreSession, type RestoreResult } from "../session";
import { useStructureStore } from "../structureStore";

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  const fake = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };
  vi.stubGlobal("localStorage", fake);
  vi.stubGlobal("sessionStorage", fake);
  usePipelineStore.setState(usePipelineStore.getInitialState(), true);
  useChatStore.setState({ turns: [], busy: false, live: null, error: null });
  useStructureStore.setState(useStructureStore.getInitialState(), true);
  useDatasetStore.setState({ datasetId: undefined });
  engine.engine.runPipeline.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const OUTPUTS = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"];
const T0 = 1_761_000_000.25; // when the outputs were written
// Dataset "S" as the server lists it: `present` outputs, each written at T0
// unless `times` says otherwise, and its raw file.
const dataset = (present: string[], opts: { times?: Record<string, number>; raw?: { size: number; mtime: number | null } | null } = {}): Dataset => ({
  id: "S",
  temperature: null,
  raw_name: "S.nxs",
  stem: "S",
  stages: OUTPUTS.map((name) => ({
    name,
    exists: present.includes(name),
    kind: name === "delta_pdf" ? "delta_pdf" : "hkl",
    volume_id: `S.${name}`,
    mtime: present.includes(name) && name !== "raw" ? (opts.times?.[name] ?? T0) : null,
  })),
  raw_file: opts.raw === undefined ? { size: 5_787_854, mtime: 1_760_000_000.5 } : opts.raw,
});

// The log of a run that computed `done` (and skipped `skipped`).
const log = (done: string[], skipped: string[] = []): JobEvent[] =>
  STAGES.flatMap((stage) =>
    done.includes(stage)
      ? [{ type: "progress", stage, status: "start" }, { type: "progress", stage, status: "done", message: `${stage} complete` }]
      : skipped.includes(stage)
        ? [{ type: "progress", stage, status: "skip", message: "exists" }]
        : [],
  );

// Run the pipeline at min σ 6 (as the page does: the form, then run), so the
// store's lastRun is the real one; then the form is edited to σ 8 without
// running. Returns the saved file's text.
async function runAt6ThenEditTo8(stages: string[] = [...STAGES], opts: { skipped?: string[]; force?: boolean } = {}): Promise<string> {
  useDatasetStore.setState({ datasetId: "S" });
  usePipelineStore.getState().patch({ punchMinSig: "6" });
  await usePipelineStore.getState().runStages(stages, { datasetId: "S", force: opts.force ?? true });
  const done = stages.filter((s) => !(opts.skipped ?? []).includes(s));
  usePipelineStore.setState({ events: log(done, opts.skipped), times: [] }); // the log the engine streamed
  usePipelineStore.getState().patch({ punchMinSig: "8" });
  return JSON.stringify(captureSession(dataset(OUTPUTS)));
}

// A fresh console (another browser) restores the file.
function restoreFresh(text: string, here: Dataset): RestoreResult {
  usePipelineStore.setState(usePipelineStore.getInitialState(), true);
  useChatStore.setState({ turns: [] });
  useDatasetStore.setState({ datasetId: undefined });
  engine.engine.runPipeline.mockClear();
  return restoreSession(parseSession(text), [here]);
}

// What Recompute (the page's button) sends to the pipeline.
async function recompute(r: RestoreResult) {
  await usePipelineStore.getState().runStages(r.recompute, { datasetId: "S", force: true, ...(r.recomputeWith ?? {}) });
  const req = engine.engine.runPipeline.mock.calls[0][0];
  return { stages: req.stages, params: JSON.parse(req.paramsJson) as Record<string, unknown>, flattenEnabled: req.flattenEnabled };
}

describe("Recompute after the form was edited", () => {
  it("runs with the settings of the run that made the outputs, and says the form differs", async () => {
    const text = await runAt6ThenEditTo8();
    const r = restoreFresh(text, dataset(["raw", "ringremoved"]));
    expect(usePipelineStore.getState().punchMinSig).toBe("8"); // the form, as saved
    expect(r.recompute).toEqual(["punch", "backfill", "flatten", "pdf", "pdf_check"]);
    expect(r.warnings.join(" ")).toMatch(/settings of the last run.*form was changed after that run/);
    const sent = await recompute(r);
    expect(sent.params.punch_min_significance).toBe(6);
    expect(sent.flattenEnabled).toBe(true);
    expect(sent.stages).toEqual(["punch", "backfill", "flatten", "pdf", "pdf_check"]);
  });

  it("uses the form, and warns, when the last run did not make the missing output", async () => {
    // The last run was only the ΔPDF; the punch was made by an earlier one.
    const text = await runAt6ThenEditTo8(["pdf", "pdf_check"]);
    const r = restoreFresh(text, dataset(["raw", "ringremoved"]));
    expect(r.recomputeWith).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/did not make all of these outputs.*uses the restored Configure form, which differs from the last run's settings/);
    expect((await recompute(r)).params.punch_min_significance).toBe(8);
  });

  it("does not take a stage the last run skipped (its output existed) for one it made", async () => {
    const text = await runAt6ThenEditTo8([...STAGES], { force: false, skipped: ["punch"] });
    const r = restoreFresh(text, dataset(["raw", "ringremoved"]));
    expect(r.recomputeWith).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/did not make all of these outputs/);
  });

  it("brings back an output of a stage the restored form switches off, with the run's switch", async () => {
    const text = await runAt6ThenEditTo8();
    const s = JSON.parse(text);
    s.settings.flatten = false; // switched off after the run
    const r = restoreFresh(JSON.stringify(s), dataset(["raw", "ringremoved", "braggpunched", "backfilled"]));
    expect(r.recompute).toEqual(["flatten", "pdf", "pdf_check"]);
    expect((await recompute(r)).flattenEnabled).toBe(true);
  });

  it("says which outputs it cannot bring back when only the form is known and switches their stage off", () => {
    useDatasetStore.setState({ datasetId: "S" });
    usePipelineStore.getState().patch({ flatten: false });
    const text = JSON.stringify(captureSession(dataset(OUTPUTS))); // no run in the session
    const r = restoreFresh(text, dataset(["raw", "ringremoved", "braggpunched", "backfilled"]));
    expect(r.recompute).toEqual(["pdf", "pdf_check"]);
    expect(r.warnings.join(" ")).toMatch(/cannot bring back Background correction: the restored settings switch its stage off/);
  });
});

describe("the input and outputs it was saved with", () => {
  it("refuses to recompute on a raw file replaced under the same name", async () => {
    const text = await runAt6ThenEditTo8();
    const r = restoreFresh(text, dataset(["raw"], { raw: { size: 6_000_000, mtime: 1_760_500_000 } }));
    expect(r.inputChanged).toBe(true);
    expect(r.recompute).toEqual([]);
    expect(r.missing).toHaveLength(5);
    expect(r.warnings.join(" ")).toMatch(/S\.nxs is not the file this session was saved with \(6000000 bytes; the session's had 5787854\)/);
  });

  it("warns on a raw file of the same size dated otherwise, and still offers to recompute", async () => {
    const text = await runAt6ThenEditTo8();
    const r = restoreFresh(text, dataset(["raw"], { raw: { size: 5_787_854, mtime: 1_760_900_000 } }));
    expect(r.inputChanged).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/S\.nxs was modified after the session was saved/);
    // Every stage the run had: all but the symmetry average, off by default.
    expect(r.recompute).toEqual(STAGES.filter((s) => s !== "symmetry_average"));
  });

  it("takes outputs written again after the save for not the session's, and recomputes them", async () => {
    const text = await runAt6ThenEditTo8();
    const r = restoreFresh(text, dataset(OUTPUTS, { times: { flattened: T0 + 60, delta_pdf: T0 + 61 } }));
    expect(r.missing).toEqual([]);
    expect(r.changed).toEqual(["flattened", "delta_pdf"]);
    expect(r.warnings.join(" ")).toMatch(/2 of its outputs were written again after the session was saved.*Background correction, 3D-ΔPDF/);
    expect(r.recompute).toEqual(["flatten", "pdf", "pdf_check"]);
    expect(r.recomputeWith?.params.punch_min_significance).toBe(6);
  });

  it("the same files as saved: nothing to warn about, nothing to recompute", async () => {
    const s = JSON.parse(await runAt6ThenEditTo8());
    s.settings.punchMinSig = "6"; // the form as the run had it
    const r = restoreFresh(JSON.stringify(s), dataset(OUTPUTS));
    expect([r.missing, r.changed, r.recompute, r.warnings]).toEqual([[], [], [], []]);
  });

  it("notes a session saved by another version", async () => {
    const s = JSON.parse(await runAt6ThenEditTo8());
    s.app = "0.1.0";
    const r = restoreFresh(JSON.stringify(s), dataset(["raw"]));
    expect(r.warnings.join(" ")).toContain(`saved by NEBULA3D 0.1.0; this is ${APP_VERSION}`);
  });
});

describe("a session file from the version before (format 1)", () => {
  // The keys and run record of the file the first end-to-end check saved.
  const v1 = {
    format: "nebula3d-session",
    version: 1,
    saved: "2026-10-23T19:20:00.000Z",
    dataset: { id: "S", rawName: "S.nxs", stem: "S", temperature: null },
    outputs: OUTPUTS,
    settings: { punchMinSig: "6", force: true },
    run: {
      record: { datasetId: "S", stages: [...STAGES], force: true, flattenEnabled: true, params: { rings_model: "pooled", rings_n_fourier: 8, rings_slice_axis: "H", punch_min_significance: 6, punch_frame: "spherical" } },
      terminal: "done",
      events: log([...STAGES]),
      times: [],
    },
    chat: [{ id: 1, role: "user", content: "Is the run sound?" }, { id: 2, role: "assistant", content: "Yes." }],
    structure: null,
  };
  it("still loads, recomputes with its run's settings, and says it cannot verify the input", async () => {
    const r = restoreSession(parseSession(JSON.stringify(v1)), [dataset(["raw"])]);
    expect(r.datasetFound).toBe(true);
    expect(r.unverified).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/earlier NEBULA3D.*cannot verify that S\.nxs and the outputs here are the ones it was saved with/);
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
    expect(useChatStore.getState().turns).toHaveLength(2);
    expect((await recompute(r)).params.punch_min_significance).toBe(6);
  });
});

describe("values from a file that could hold anything", () => {
  const file = (extra: Record<string, unknown>) =>
    JSON.stringify({ format: "nebula3d-session", version: 2, saved: "", app: APP_VERSION, dataset: { id: "S", rawName: "S.nxs", stem: "S", rawFile: { size: 5_787_854, mtime: 1_760_000_000.5 } }, outputs: ["raw"], outputTimes: {}, settings: {}, run: null, chat: [], structure: null, ...extra });

  it("applies a setting only when the form has it as its own, with the form's type", async () => {
    const stop = rememberConfig();
    restoreSession(parseSession(file({ settings: { toString: 5, constructor: "x", hasOwnProperty: 1, punchSupercellH: 5, force: "yes", punchCutH: "2", punchSliceZoom: 2, punchMinSig: "7", flatten: false } })), [dataset(["raw"])]);
    const p = usePipelineStore.getState() as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(p, "toString")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(p, "hasOwnProperty")).toBe(false);
    expect([p.punchSupercellH, p.force, p.punchCutH]).toEqual(["", false, 0]); // wrong types: kept as they were
    expect(Object.prototype.hasOwnProperty.call(p, "punchSliceZoom")).toBe(false); // a setting the form no longer has (the old preview zoom)
    expect([p.punchMinSig, p.flatten]).toEqual(["7", false]); // right types: applied
    expect(JSON.parse(storage.get("nebula3d.configByDataset.v1")!).S.punchSupercellH).toBe("");
    // A run afterwards does not fail.
    expect(await usePipelineStore.getState().runStages(["punch"], { datasetId: "S" })).toBe("done");
    stop();
  });

  it("rebuilds the structure from its own keys, and drops one of the wrong shape", () => {
    const def = { name: "NaCl", cell: { a: 5.64, b: 5.64, c: 5.64, alpha: 90, beta: 90, gamma: 90 }, sites: [{ label: "Na1", element: "Na", x: 0, y: 0, z: 0, occ: 1, extra: "dropped" }], ops: "x, y, z", centering: "F", notes: [] };
    restoreSession(parseSession(file({ structure: { def, show: false, perm: 99, origin: 3, hidden: ["Na-Cl", 4], depth: -1, setShow: 1, setDef: "x" } })), [dataset(["raw"])]);
    const st = useStructureStore.getState();
    expect([typeof st.setShow, typeof st.setDef]).toEqual(["function", "function"]);
    expect(st.def?.sites).toEqual([{ label: "Na1", element: "Na", x: 0, y: 0, z: 0, occ: 1 }]);
    expect([st.show, st.perm, st.origin, st.hidden, st.depth]).toEqual([false, 0, null, ["Na-Cl"], null]);
    st.setShow(true); // the action still works
    expect(useStructureStore.getState().show).toBe(true);

    useStructureStore.setState({ def: null });
    restoreSession(parseSession(file({ structure: { def: { name: "x", sites: "notarray" }, setShow: 1 } })), [dataset(["raw"])]);
    expect(useStructureStore.getState().def).toBeNull();
    expect(typeof useStructureStore.getState().setShow).toBe("function");
  });

  it("keeps no run record whose settings are not plain values, and only well-formed log lines", () => {
    const run = { record: { datasetId: "S", stages: ["punch"], force: true, flattenEnabled: true, params: { punch_min_significance: { $gt: 1 } } }, terminal: "done", events: [{ type: "progress", stage: "punch", status: "done", message: 5 }, "junk", { stage: "x" }], times: [] };
    const s = parseSession(file({ run }));
    expect(s.run?.record).toBeNull();
    expect(s.run?.events).toEqual([{ type: "progress", stage: "punch", status: "done" }]);
  });

  it("does not apply a dataset-less session's settings to the dataset selected now", () => {
    useDatasetStore.setState({ datasetId: "S" });
    const r = restoreSession(parseSession(file({ dataset: null, settings: { punchMinSig: "9" } })), [dataset(["raw"])]);
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    expect(r.warnings.join(" ")).toMatch(/saved with no dataset selected/);
  });

  it("marks restored tool steps so a later reply's number check does not take them for tool results", () => {
    const steps = [{ id: "0:a", name: "assess_stage", args: {}, status: "done", result: "residual 0.0123" }, { id: 7, name: "bad" }];
    restoreSession(parseSession(file({ chat: [{ id: 1, role: "user", content: "q" }, { id: 2, role: "assistant", content: "a", steps }] })), [dataset(["raw"])]);
    const turns = useChatStore.getState().turns;
    expect(turns[1].steps).toEqual([{ ...steps[0], restored: true }]);
    expect(toolStepsIn(turns)).toEqual([]);
    // A tool result of this console still counts.
    useChatStore.getState().addTurn({ role: "assistant", content: "b", steps: [{ id: "1:a", name: "assess_stage", args: {}, status: "done", result: "residual 0.0456" }] });
    expect(toolStepsIn(useChatStore.getState().turns).map((s) => s.result)).toEqual(["residual 0.0456"]);
  });
});
