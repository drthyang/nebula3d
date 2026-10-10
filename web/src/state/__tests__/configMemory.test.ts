// The Configure form follows its dataset: switching back brings back the
// settings last used with it; a dataset seen first keeps the form when it is
// the same sample, and starts from the defaults when it is another.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberConfig, sampleOf } from "../configMemory";
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
  useDatasetStore.setState({ datasetId: "S-45K-a" });
  usePipelineStore.setState({ punchProtectH: "", flattenIon: "" });
});
afterEach(() => vi.unstubAllGlobals());

describe("rememberConfig", () => {
  it("brings back each dataset's settings when switching between them", () => {
    const stop = rememberConfig();
    usePipelineStore.getState().patch({ punchProtectH: "none", flattenIon: "Tb3+" });
    useDatasetStore.getState().setDataset("S-22K-b");
    // first seen: keeps the form as it stands
    expect(usePipelineStore.getState()).toMatchObject({ punchProtectH: "none", flattenIon: "Tb3+" });
    usePipelineStore.getState().patch({ punchProtectH: "1/3, 2/3" });
    useDatasetStore.getState().setDataset("S-45K-a");
    expect(usePipelineStore.getState().punchProtectH).toBe("none");
    useDatasetStore.getState().setDataset("S-22K-b");
    expect(usePipelineStore.getState().punchProtectH).toBe("1/3, 2/3");
    expect(savedDatasetId()).toBe("S-22K-b");
    stop();
  });

  it("starts another sample from the defaults, not the last sample's facts", () => {
    const stop = rememberConfig();
    usePipelineStore.getState().patch({ punchProtectH: "none", flattenIon: "Tb3+", punchSupercellH: "1" });
    useDatasetStore.getState().setDataset("Other-90K-hex");
    expect(usePipelineStore.getState()).toMatchObject({ punchProtectH: "", flattenIon: "", punchSupercellH: "" });
    usePipelineStore.getState().patch({ punchSupercellH: "2" });
    useDatasetStore.getState().setDataset("S-45K-a");
    expect(usePipelineStore.getState()).toMatchObject({ flattenIon: "Tb3+", punchSupercellH: "1" });
    useDatasetStore.getState().setDataset("Other-90K-hex");
    expect(usePipelineStore.getState().punchSupercellH).toBe("2");
    stop();
  });

  it("drops settings the form no longer has when it restores a dataset's", () => {
    store.set("nebula3d.configByDataset.v1", JSON.stringify({ "S-22K-b": { punchProtectH: "none", punchMethod: "ellipsoid" } }));
    const stop = rememberConfig();
    useDatasetStore.getState().setDataset("S-22K-b");
    const state = usePipelineStore.getState() as unknown as Record<string, unknown>;
    expect(state.punchProtectH).toBe("none");
    expect(state).not.toHaveProperty("punchMethod");
    usePipelineStore.getState().patch({ flattenIon: "Tb3+" }); // a save
    expect(JSON.parse(store.get("nebula3d.configByDataset.v1")!)["S-22K-b"]).not.toHaveProperty("punchMethod");
    stop();
  });

  it("names the sample before the temperature", () => {
    expect(sampleOf("Fe3Ge2-90K-all-hex-h-k-0")).toBe("Fe3Ge2");
    expect(sampleOf("TbTi3Bi4-22K-mmm-0-k-l")).toBe("TbTi3Bi4");
    expect(sampleOf("demo")).toBe("demo");
  });

  it("ignores job events, which are not settings", () => {
    const stop = rememberConfig();
    const before = store.get("nebula3d.configByDataset.v1");
    usePipelineStore.setState({ events: [{ type: "progress", message: "x" }] });
    expect(store.get("nebula3d.configByDataset.v1")).toBe(before);
    expect(JSON.parse(before!)["S-45K-a"]).not.toHaveProperty("events");
    stop();
  });
});
