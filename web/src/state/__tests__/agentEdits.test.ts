// The agent's changes to the Configure form, as the page hears of them: one
// event per change (update_settings and a tuning run's kept settings say so;
// tools.test.ts and tune.test.ts check that), never for the user's own edits
// or a restored session, and each shown once.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A restored session's Recompute would go to the in-browser engine.
const engine = vi.hoisted(() => ({
  PYODIDE_MODE: true,
  engine: { runPipeline: vi.fn(async () => undefined) },
  cancelPipeline: vi.fn(),
}));
vi.mock("../../api/pyodideEngine", () => engine);

import type { Dataset } from "../../api/types";
import { noteAgentEdit, useAgentEdits } from "../agentEdits";
import { usePipelineStore } from "../pipelineStore";
import { APP_VERSION, parseSession, restoreSession } from "../session";

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
  useAgentEdits.setState({ last: null, shown: 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe("noteAgentEdit", () => {
  it("is one event per change, each field named once", () => {
    noteAgentEdit(["punchHGuard", "punchHGuard", "flattenQ2"]);
    expect(useAgentEdits.getState().last).toEqual({ fields: ["punchHGuard", "flattenQ2"], seq: 1 });
    noteAgentEdit(["punchHGuard"]);
    expect(useAgentEdits.getState().last).toEqual({ fields: ["punchHGuard"], seq: 2 });
  });

  it("says nothing for a change of nothing", () => {
    noteAgentEdit([]);
    expect(useAgentEdits.getState().last).toBeNull();
  });

  it("is shown once: markShown only moves forward", () => {
    noteAgentEdit(["pdfWindowShape"]);
    useAgentEdits.getState().markShown(1);
    useAgentEdits.getState().markShown(0);
    expect(useAgentEdits.getState().shown).toBe(1);
  });
});

describe("what is not the agent's change", () => {
  it("the user's own edits", () => {
    usePipelineStore.getState().patch({ punchHGuard: "0.2", flattenQ2: true, pdfWindowShape: "ellipsoid" });
    expect(useAgentEdits.getState().last).toBeNull();
  });

  it("a restored session, advanced settings and all", () => {
    const dataset: Dataset = {
      id: "S",
      temperature: null,
      raw_name: "S.nxs",
      stem: "S",
      stages: [{ name: "raw", exists: true, kind: "hkl", volume_id: "S.raw", mtime: null }],
      raw_file: { size: 5_787_854, mtime: 1_760_000_000.5 },
    };
    const file = JSON.stringify({
      format: "nebula3d-session",
      version: 2,
      saved: "",
      app: APP_VERSION,
      dataset: { id: "S", rawName: "S.nxs", stem: "S", rawFile: { size: 5_787_854, mtime: 1_760_000_000.5 } },
      outputs: ["raw"],
      outputTimes: {},
      settings: { punchHGuard: "0.2", flattenQ2: true, pdfWindowShape: "ellipsoid" },
      run: null,
      chat: [],
      structure: null,
    });
    restoreSession(parseSession(file), [dataset]);
    expect(usePipelineStore.getState().punchHGuard).toBe("0.2"); // restored…
    expect(useAgentEdits.getState().last).toBeNull(); // …and not taken for the agent's
  });
});
