// Close (state/closeVolume.ts): every store back to the state the app starts
// in, the caches emptied, a run cancelled first, the engine's memory given
// back, nothing deleted. The first test reads the source for every zustand
// store, so a store added later that does not say how Close treats it
// (volumeReset.ts) fails here.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let reject: ((e: Error) => void) | null = null;
  const mode = { pyodide: true };
  return {
    mode,
    engine: {
      get PYODIDE_MODE() {
        return mode.pyodide;
      },
      engine: {
        runPipeline: vi.fn(
          () =>
            new Promise<void>((_resolve, r) => {
              reject = r;
            }),
        ),
      },
      cancelPipeline: vi.fn(() => reject?.(new Error("Pipeline cancelled"))),
      restartEngine: vi.fn(),
    },
    releaseServerCaches: vi.fn(async () => undefined),
  };
});
vi.mock("../../api/pyodideEngine", () => mocks.engine);
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  releaseServerCaches: mocks.releaseServerCaches,
}));

import type { Dataset } from "../../api/types";
import { queryClient } from "../../api/queryClient";
import { useChatStore } from "../../llm/chatStore";
import { closeNeedsConfirm, closeVolume } from "../closeVolume";
import { useDatasetStore } from "../datasetStore";
import { useMarkStore } from "../markStore";
import { usePipelineStore } from "../pipelineStore";
import { captureSession, noteSessionSaved, sessionUnsaved } from "../session";
import { useViewerStore } from "../viewerStore";
import { declaredForClose, keptOnClose, resetVolumeState } from "../volumeReset";

// The app's source (tests and the evals aside): its text, and its modules.
const TEXT = import.meta.glob<string>(["../../**/*.{ts,tsx}", "!../../**/*.test.ts", "!../../**/__tests__/**", "!../../llm/evals/**"], { query: "?raw", import: "default", eager: true });
const MODULES = import.meta.glob<Record<string, unknown>>(["../../**/*.{ts,tsx}", "!../../**/*.test.ts", "!../../**/__tests__/**", "!../../llm/evals/**"]);

// Every `export const useX = create…` in a file that takes create from zustand.
const STORES = Object.entries(TEXT).flatMap(([path, text]) => {
  if (!/import \{[^}]*\bcreate\b[^}]*\} from "zustand"/.test(text)) return [];
  return [...text.matchAll(/export const (use\w+) = create\b/g)].map((m) => ({ path, name: m[1] }));
});

interface Store {
  getState: () => Record<string, unknown>;
  getInitialState: () => Record<string, unknown>;
  setState: (s: Record<string, unknown>) => void;
}

async function loadStore(path: string, name: string): Promise<Store> {
  return (await MODULES[path]())[name] as Store;
}

const MARK = "__closed_volume__";

// A value of the field's kind that no initial state holds.
function marked(v: unknown): unknown {
  if (typeof v === "string") return MARK;
  if (typeof v === "number") return 987_654;
  if (typeof v === "boolean") return !v;
  if (Array.isArray(v)) return [MARK];
  return { [MARK]: true };
}

const DATASET = { id: "demo", raw_name: "demo.nxs", stem: "demo", temperature: null, stages: [] } as unknown as Dataset;

describe("every store says how Close treats it", () => {
  it("finds the stores in the source", () => {
    expect(STORES.length).toBeGreaterThanOrEqual(15);
  });

  it.each(STORES.map((s) => [s.path.replace("../../", ""), s.name, s.path]))("%s: %s", async (_rel, name, path) => {
    const store = await loadStore(path, name);
    expect(declaredForClose(store), `${name} must call resetsWithVolume or holdsNoVolume (state/volumeReset.ts)`).toBe(true);
  });

  it("leaves no store holding what it held of the volume", async () => {
    const resetting: [string, Store, readonly string[]][] = [];
    for (const { path, name } of STORES) {
      const store = await loadStore(path, name);
      const keep = keptOnClose(store);
      if (keep) resetting.push([name, store, keep]);
    }
    for (const [, store, keep] of resetting) {
      const s = store.getState();
      store.setState(
        Object.fromEntries(
          Object.entries(s)
            .filter(([k, v]) => typeof v !== "function" && !keep.includes(k))
            .map(([k, v]) => [k, marked(v)]),
        ),
      );
    }
    resetVolumeState();
    for (const [name, store, keep] of resetting) {
      const s = store.getState();
      const initial = store.getInitialState();
      for (const [k, v] of Object.entries(s)) {
        if (typeof v === "function" || keep.includes(k)) continue;
        const where = `${name}.${k}`;
        expect(JSON.stringify(v ?? null), where).not.toContain(MARK);
        expect(v, where).not.toBe(987_654);
        if (typeof v === "boolean") expect(v, where).toBe(initial[k]);
      }
    }
  });

  it("keeps the preferences a store keeps", () => {
    useViewerStore.getState().setColormap("magma");
    useViewerStore.getState().setCutIndex(17);
    resetVolumeState();
    expect(useViewerStore.getState().colormap).toBe("magma");
    expect(useViewerStore.getState().cutIndex).toBe(0);
  });
});

describe("asking first", () => {
  beforeEach(() => resetVolumeState());

  it("asks only when session state is not saved", () => {
    expect(sessionUnsaved(DATASET)).toBe(false);
    useChatStore.getState().addTurn({ role: "user", content: "about this volume" });
    expect(sessionUnsaved(DATASET)).toBe(true);
    noteSessionSaved(captureSession(DATASET));
    expect(sessionUnsaved(DATASET)).toBe(false);
    useChatStore.getState().addTurn({ role: "assistant", content: "and more" });
    expect(sessionUnsaved(DATASET)).toBe(true);
  });

  it("the settings alone do not ask (they are remembered per dataset)", () => {
    usePipelineStore.getState().patch({ punchMinSig: "4" });
    expect(closeNeedsConfirm(DATASET)).toBe(false);
  });
});

describe("closing", () => {
  beforeEach(() => {
    resetVolumeState();
    vi.clearAllMocks();
  });

  it("cancels a run first, then resets, restarts the engine and forgets the volume's queries", async () => {
    mocks.mode.pyodide = true;
    useDatasetStore.getState().setDataset("demo");
    useChatStore.getState().addTurn({ role: "user", content: "about this volume" });
    useMarkStore.getState().add({
      datasetId: "demo",
      where: "raw",
      region: { kind: "box", plane: "hk0", value: 0, u: [0, 1], v: [0, 1] },
      label: "a region",
      evidence: [],
      created: "2026-11-02T00:00:00Z",
      view: { plane: "hk0", value: 0 },
    } as never);
    queryClient.setQueryData(["slice", "demo.raw", "hk0", 0], { data: new Float32Array(4) });
    const run = usePipelineStore.getState().runStages(["rings"], { datasetId: "demo" });
    await vi.waitFor(() => expect(mocks.engine.engine.runPipeline).toHaveBeenCalled());
    expect(closeNeedsConfirm(DATASET)).toBe(true);

    await closeVolume();

    expect(await run).toBe("cancelled");
    expect(mocks.engine.cancelPipeline).toHaveBeenCalled();
    expect(mocks.engine.restartEngine).toHaveBeenCalled();
    expect(mocks.releaseServerCaches).not.toHaveBeenCalled();
    const p = usePipelineStore.getState();
    expect([p.running, p.terminal, p.events.length, p.lastRun]).toEqual([false, null, 0, null]);
    expect(useDatasetStore.getState()).toMatchObject({ datasetId: undefined, closed: true });
    expect(useChatStore.getState().turns).toEqual([]);
    expect(useMarkStore.getState().marks).toEqual([]);
    expect(queryClient.getQueryData(["slice", "demo.raw", "hk0", 0])).toBeUndefined();
    expect(closeNeedsConfirm(undefined)).toBe(false);
  });

  it("on the native server, asks it to let go of its cached volumes", async () => {
    mocks.mode.pyodide = false;
    useDatasetStore.getState().setDataset("demo");
    await closeVolume();
    expect(mocks.releaseServerCaches).toHaveBeenCalledTimes(1);
    expect(mocks.engine.restartEngine).not.toHaveBeenCalled();
    expect(useDatasetStore.getState().closed).toBe(true);
    // Picking a dataset again ends the closed state.
    useDatasetStore.getState().setDataset("demo");
    expect(useDatasetStore.getState().closed).toBe(false);
  });
});
