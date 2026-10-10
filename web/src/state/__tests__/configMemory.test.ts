// The Configure form follows its dataset: switching back brings back the
// settings last used with it, and a dataset seen first keeps the form.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberConfig } from "../configMemory";
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
  useDatasetStore.setState({ datasetId: "45K" });
  usePipelineStore.setState({ punchProtectH: "", flattenIon: "" });
});
afterEach(() => vi.unstubAllGlobals());

describe("rememberConfig", () => {
  it("brings back each dataset's settings when switching between them", () => {
    const stop = rememberConfig();
    usePipelineStore.getState().patch({ punchProtectH: "none", flattenIon: "Tb3+" });
    useDatasetStore.getState().setDataset("22K");
    // first seen: keeps the form as it stands
    expect(usePipelineStore.getState()).toMatchObject({ punchProtectH: "none", flattenIon: "Tb3+" });
    usePipelineStore.getState().patch({ punchProtectH: "1/3, 2/3" });
    useDatasetStore.getState().setDataset("45K");
    expect(usePipelineStore.getState().punchProtectH).toBe("none");
    useDatasetStore.getState().setDataset("22K");
    expect(usePipelineStore.getState().punchProtectH).toBe("1/3, 2/3");
    expect(savedDatasetId()).toBe("22K");
    stop();
  });

  it("ignores job events, which are not settings", () => {
    const stop = rememberConfig();
    const before = store.get("nebula3d.configByDataset.v1");
    usePipelineStore.setState({ events: [{ type: "progress", message: "x" }] });
    expect(store.get("nebula3d.configByDataset.v1")).toBe(before);
    expect(JSON.parse(before!)["45K"]).not.toHaveProperty("events");
    stop();
  });
});
