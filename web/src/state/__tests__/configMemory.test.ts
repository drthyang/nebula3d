// The Configure form follows its dataset: switching back brings back the
// settings last used with it; a dataset seen first keeps the form when it is
// the same sample, and starts from the defaults when it is another. A form
// remembered before modulations were declared has its protected H planes
// migrated to the sample's modulation, once.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateSaved, rememberConfig, sampleOf } from "../configMemory";
import { savedDatasetId, useDatasetStore } from "../datasetStore";
import { usePipelineStore } from "../pipelineStore";

// localStorage for the node test environment.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  useDatasetStore.setState({ datasetId: "S-60K-a" });
  usePipelineStore.setState({ modulationK: "", modulationForm: "", flattenIon: "" });
});
afterEach(() => vi.unstubAllGlobals());

const KEY = "nebula3d.configByDataset.v1";

describe("rememberConfig", () => {
  it("brings back each dataset's settings when switching between them", () => {
    const stop = rememberConfig();
    usePipelineStore.getState().patch({ modulationK: "none", flattenIon: "Tb3+" });
    useDatasetStore.getState().setDataset("S-15K-b");
    // first seen: keeps the form as it stands
    expect(usePipelineStore.getState()).toMatchObject({ modulationK: "none", flattenIon: "Tb3+" });
    usePipelineStore.getState().patch({ modulationK: "1/3, 0, 0", modulationForm: "planes" });
    useDatasetStore.getState().setDataset("S-60K-a");
    expect(usePipelineStore.getState().modulationK).toBe("none");
    useDatasetStore.getState().setDataset("S-15K-b");
    expect(usePipelineStore.getState()).toMatchObject({ modulationK: "1/3, 0, 0", modulationForm: "planes" });
    expect(savedDatasetId()).toBe("S-15K-b");
    stop();
  });

  it("starts another sample from the defaults, not the last sample's facts", () => {
    const stop = rememberConfig();
    usePipelineStore.getState().patch({ modulationK: "none", flattenIon: "Tb3+", punchSupercellH: "1" });
    useDatasetStore.getState().setDataset("Other-150K-hex");
    expect(usePipelineStore.getState()).toMatchObject({ modulationK: "", flattenIon: "", punchSupercellH: "" });
    usePipelineStore.getState().patch({ punchSupercellH: "2" });
    useDatasetStore.getState().setDataset("S-60K-a");
    expect(usePipelineStore.getState()).toMatchObject({ flattenIon: "Tb3+", punchSupercellH: "1" });
    useDatasetStore.getState().setDataset("Other-150K-hex");
    expect(usePipelineStore.getState().punchSupercellH).toBe("2");
    stop();
  });

  it("drops settings the form no longer has when it restores a dataset's", () => {
    store.set(KEY, JSON.stringify({ "S-15K-b": { modulationK: "none", punchMethod: "ellipsoid" } }));
    const stop = rememberConfig();
    useDatasetStore.getState().setDataset("S-15K-b");
    const state = usePipelineStore.getState() as unknown as Record<string, unknown>;
    expect(state.modulationK).toBe("none");
    expect(state).not.toHaveProperty("punchMethod");
    usePipelineStore.getState().patch({ flattenIon: "Tb3+" }); // a save
    expect(JSON.parse(store.get(KEY)!)["S-15K-b"]).not.toHaveProperty("punchMethod");
    stop();
  });

  it("names the sample before the temperature", () => {
    expect(sampleOf("Ab2Cd3-150K-all-hex-h-k-0")).toBe("Ab2Cd3");
    expect(sampleOf("EfGh4-15K-mmm-0-k-l")).toBe("EfGh4");
    expect(sampleOf("demo")).toBe("demo");
  });

  it("ignores job events, which are not settings", () => {
    const stop = rememberConfig();
    const before = store.get(KEY);
    usePipelineStore.setState({ events: [{ type: "progress", message: "x" }] });
    expect(store.get(KEY)).toBe(before);
    expect(JSON.parse(before!)["S-60K-a"]).not.toHaveProperty("events");
    stop();
  });
});

describe("the protected H planes a form remembered, migrated to the sample's modulation once", () => {
  const BLANK = { modulationK: "", modulationOrder: "", modulationForm: "", modulationHalfWidth: "" };

  it("turns an explicit value into k = (f, 0, 0) in plane form, folding each fraction's twin in", () => {
    const saved = {
      thirds: { punchProtectH: "1/3, 2/3", punchMinSig: "6" },
      half: { punchProtectH: "0.5", punchProtectHalfWidth: "0.1" },
      two: { punchProtectH: "1/4; 1/2, 3/4" },
      decimals: { punchProtectH: "0.3333 0.6667" },
      none: { punchProtectH: "none" },
      zeroWidth: { punchProtectH: "1/3, 2/3", punchProtectHalfWidth: "0" },
      widthAlone: { punchProtectHalfWidth: "0.05" },
      blank: { punchProtectH: "", punchProtectHalfWidth: "" },
      unreadable: { punchProtectH: "thirds" },
      onTheLattice: { punchProtectH: "0" },
      declared: { punchProtectH: "none", modulationK: "0.2, 0, 1/2", modulationOrder: "2" },
      untouched: { punchMinSig: "6" },
    };
    expect(migrateSaved(saved)).toBe(true);
    expect(saved).toEqual({
      thirds: { ...BLANK, modulationK: "1/3, 0, 0", modulationForm: "planes", punchMinSig: "6" },
      half: { ...BLANK, modulationK: "0.5, 0, 0", modulationForm: "planes", modulationHalfWidth: "0.1" },
      two: { ...BLANK, modulationK: "1/4, 0, 0; 1/2, 0, 0", modulationForm: "planes" },
      decimals: { ...BLANK, modulationK: "0.3333, 0, 0", modulationForm: "planes" },
      none: { ...BLANK, modulationK: "none" },
      zeroWidth: { ...BLANK, modulationK: "none" },
      // The planes the old default protected, at the width the user set.
      widthAlone: { ...BLANK, modulationK: "1/3, 0, 0", modulationForm: "planes", modulationHalfWidth: "0.05" },
      // Blank, or what the old page could not read and never sent: the backend's default stands.
      blank: {},
      unreadable: {},
      onTheLattice: { ...BLANK, modulationK: "none" },
      // A form that declares a modulation keeps its own.
      declared: { modulationK: "0.2, 0, 1/2", modulationOrder: "2" },
      untouched: { punchMinSig: "6" },
    });
    // Once: nothing is left to migrate.
    expect(migrateSaved(saved)).toBe(false);
  });

  it("runs when the console starts remembering, and the restored form declares the modulation", () => {
    store.set(KEY, JSON.stringify({ "S-15K-b": { punchProtectH: "1/3, 2/3", punchProtectHalfWidth: "0.06" } }));
    const stop = rememberConfig();
    expect(JSON.parse(store.get(KEY)!)["S-15K-b"]).toEqual({ ...BLANK, modulationK: "1/3, 0, 0", modulationForm: "planes", modulationHalfWidth: "0.06" });
    useDatasetStore.getState().setDataset("S-15K-b");
    expect(usePipelineStore.getState()).toMatchObject({ modulationK: "1/3, 0, 0", modulationForm: "planes", modulationHalfWidth: "0.06" });
    expect(usePipelineStore.getState()).not.toHaveProperty("punchProtectH");
    stop();
  });
});
