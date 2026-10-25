// A saved session brings the analysis back: the settings, the last run's
// record and log, the Pilot conversation and the structure, on its dataset;
// and it says which outputs are gone and which stages bring them back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { useChatStore } from "../../llm/chatStore";
import { rememberConfig } from "../configMemory";
import { useDatasetStore } from "../datasetStore";
import { usePipelineStore } from "../pipelineStore";
import { captureSession, parseSession, restoreSession, SESSION_VERSION, stagesToRecompute } from "../session";
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
  useStructureStore.setState({ def: null });
  useDatasetStore.setState({ datasetId: undefined });
});
afterEach(() => vi.unstubAllGlobals());

const OUTPUTS = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"];
const dataset = (id: string, present: string[]): Dataset => ({
  id,
  temperature: null,
  raw_name: `${id}.nxs`,
  stem: id,
  stages: OUTPUTS.map((name) => ({ name, exists: present.includes(name), kind: name === "delta_pdf" ? "delta_pdf" : "hkl", volume_id: `${id}.${name}` })),
});

// The state of a finished analysis on dataset "S-60K".
function analysed() {
  useDatasetStore.setState({ datasetId: "S-60K" });
  usePipelineStore.getState().patch({ punchMinSig: "6", flattenIon: "Mn2+", force: true });
  usePipelineStore.setState({
    lastRun: { datasetId: "S-60K", stages: ["rings", "punch"], force: true, flattenEnabled: true, params: { punch_min_significance: 6 } },
    events: [
      { type: "progress", stage: "rings", status: "done", message: "ring removal complete" },
      { type: "progress", stage: "punch", status: "done", message: "punch complete" },
    ],
    times: [1000, 2000],
    terminal: "done",
  });
  useChatStore.getState().addTurn({ role: "user", content: "Is the punch clean?" });
  useChatStore.getState().addTurn({ role: "assistant", content: "Yes.", steps: [{ id: "0:a", name: "assess_stage", args: { stage: "punch" }, status: "done", summary: "clean", result: "{}" }] });
  useStructureStore.setState({ def: { name: "NaCl", cell: null, sites: [], ops: "x, y, z", centering: "F", notes: [] }, perm: 0, origin: null, hidden: [], depth: null, show: true });
}

describe("a saved session", () => {
  it("brings back the settings, the run's record and log, the conversation and the structure", () => {
    analysed();
    const saved = JSON.stringify(captureSession(dataset("S-60K", OUTPUTS), new Date("2026-10-20T10:00:00Z")));
    const before = { pipeline: usePipelineStore.getState(), turns: useChatStore.getState().turns, structure: useStructureStore.getState().def };

    // A fresh console (another browser, or this one after the outputs were lost).
    usePipelineStore.setState(usePipelineStore.getInitialState(), true);
    useChatStore.setState({ turns: [] });
    useStructureStore.setState({ def: null });
    useDatasetStore.setState({ datasetId: "other" });

    const result = restoreSession(parseSession(saved), [dataset("other", ["raw"]), dataset("S-60K", OUTPUTS)]);
    expect(result).toMatchObject({ datasetFound: true, missing: [], recompute: [] });
    expect(useDatasetStore.getState().datasetId).toBe("S-60K");
    const p = usePipelineStore.getState();
    expect([p.punchMinSig, p.flattenIon, p.force]).toEqual(["6", "Mn2+", true]);
    expect([p.events, p.times, p.terminal, p.lastRun]).toEqual([before.pipeline.events, before.pipeline.times, "done", before.pipeline.lastRun]);
    // The same turns; their tool steps marked as from the file (agent.ts toolStepsIn).
    expect(useChatStore.getState().turns).toEqual(
      before.turns.map((t) => (t.steps ? { ...t, steps: t.steps.map((st) => ({ ...st, restored: true })) } : t)),
    );
    expect(useStructureStore.getState().def).toEqual(before.structure);
    // The next turn is numbered after the restored ones.
    useChatStore.getState().addTurn({ role: "user", content: "next" });
    expect(new Set(useChatStore.getState().turns.map((t) => t.id)).size).toBe(3);
  });

  it("keeps the session's settings over the ones the browser remembered for its dataset", () => {
    analysed();
    const saved = JSON.stringify(captureSession(dataset("S-60K", OUTPUTS)));
    const stop = rememberConfig();
    useDatasetStore.getState().setDataset("S-60K");
    usePipelineStore.getState().patch({ punchMinSig: "9" }); // remembered for S-60K
    useDatasetStore.getState().setDataset("other");
    restoreSession(parseSession(saved), [dataset("other", ["raw"]), dataset("S-60K", OUTPUTS)]);
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
    stop();
  });

  it("lists the outputs that are gone and the stages that bring them back", () => {
    analysed();
    const saved = parseSession(JSON.stringify(captureSession(dataset("S-60K", OUTPUTS))));
    const result = restoreSession(saved, [dataset("S-60K", ["raw", "ringremoved"])]);
    expect(result.missing).toEqual(["braggpunched", "backfilled", "flattened", "delta_pdf"]);
    expect(result.recompute).toEqual(["punch", "backfill", "flatten", "pdf", "pdf_check"]);
  });

  it("applies nothing when its dataset is not here, and says so", () => {
    analysed();
    const saved = parseSession(JSON.stringify(captureSession(dataset("S-60K", OUTPUTS))));
    usePipelineStore.setState(usePipelineStore.getInitialState(), true);
    useChatStore.setState({ turns: [] });
    useDatasetStore.setState({ datasetId: "other" });
    const result = restoreSession(saved, [dataset("other", ["raw"])]);
    expect(result.datasetFound).toBe(false);
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    expect(useChatStore.getState().turns).toEqual([]);
    expect(useDatasetStore.getState().datasetId).toBe("other");
  });

  it("drops settings the form no longer has, and never overwrites a run in progress", () => {
    analysed();
    const session = captureSession(dataset("S-60K", OUTPUTS));
    const saved = parseSession(JSON.stringify({ ...session, settings: { ...session.settings, punchMethod: "old" } }));
    usePipelineStore.setState({ running: true, events: [{ type: "progress", stage: "rings", status: "start" }], terminal: null });
    restoreSession(saved, [dataset("S-60K", OUTPUTS)]);
    const p = usePipelineStore.getState() as unknown as Record<string, unknown>;
    expect(p.punchMethod).toBeUndefined();
    expect(p.running).toBe(true);
    expect(p.events).toEqual([{ type: "progress", stage: "rings", status: "start" }]);
  });

  it("refuses a file that is not a session, or one from a newer format", () => {
    expect(() => parseSession("not json")).toThrow(/not a saved session/);
    expect(() => parseSession('{"format":"other"}')).toThrow(/not a saved NEBULA3D session/);
    expect(() => parseSession(JSON.stringify({ format: "nebula3d-session", version: SESSION_VERSION + 1 }))).toThrow(/newer NEBULA3D/);
  });

  it("restores a session without a run, a conversation or a structure", () => {
    const minimal = parseSession(JSON.stringify({ format: "nebula3d-session", version: 1, dataset: { id: "S-60K" }, settings: { punchMinSig: "7" } }));
    const result = restoreSession(minimal, [dataset("S-60K", ["raw"])]);
    expect(result.datasetFound).toBe(true);
    expect(usePipelineStore.getState().punchMinSig).toBe("7");
    expect(usePipelineStore.getState().terminal).toBeNull();
  });
});

describe("stagesToRecompute", () => {
  const settings = () => usePipelineStore.getState();
  it("runs from the first missing output through the last one saved, as the settings switch them on", () => {
    expect(stagesToRecompute(OUTPUTS, OUTPUTS, settings())).toEqual([]);
    expect(stagesToRecompute(OUTPUTS, ["raw"], settings())).toEqual(["rings", "punch", "backfill", "flatten", "pdf", "pdf_check"]);
    expect(stagesToRecompute(OUTPUTS, ["raw", "ringremoved", "braggpunched", "backfilled", "flattened"], settings())).toEqual(["pdf", "pdf_check"]);
    // A missing middle output: it and the stages after it that the session had.
    expect(stagesToRecompute(["raw", "ringremoved", "braggpunched"], ["raw", "ringremoved"], settings())).toEqual(["punch"]);
    // The flatten switched off: its stage is not run (the ΔPDF reads the backfilled volume).
    expect(stagesToRecompute(OUTPUTS, ["raw"], { ...settings(), flatten: false })).toEqual(["rings", "punch", "backfill", "pdf", "pdf_check"]);
  });
});
