// The structure overlay's fill settings (state/structureStore.ts): where they
// start, what the slider may hold, that they are kept across a reload, and
// that Close puts them back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fillAboveOr, useStructureStore } from "../structureStore";
import { resetVolumeState } from "../volumeReset";

beforeEach(() => resetVolumeState());
afterEach(() => vi.unstubAllGlobals());

// A browser's storage, for the tests that read what the store keeps.
function fakeStorage(): Map<string, string> {
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
  return kept;
}

describe("fill settings", () => {
  it("start at 3σ with the pairs without signal faded", () => {
    const s = useStructureStore.getState();
    expect([s.fillAbove, s.fadeQuiet]).toEqual([3, true]);
  });

  it("hold the threshold on the slider's steps, 2σ to 6σ", () => {
    const { setFillAbove } = useStructureStore.getState();
    setFillAbove(4.5);
    expect(useStructureStore.getState().fillAbove).toBe(4.5);
    setFillAbove(4.3);
    expect(useStructureStore.getState().fillAbove).toBe(4.5);
    setFillAbove(9);
    expect(useStructureStore.getState().fillAbove).toBe(6);
    setFillAbove(0);
    expect(useStructureStore.getState().fillAbove).toBe(2);
  });

  it("read anything else (an older or edited store) as the default", () => {
    expect(fillAboveOr(undefined)).toBe(3);
    expect(fillAboveOr("5")).toBe(3);
    expect(fillAboveOr(Number.NaN)).toBe(3);
    expect(fillAboveOr(null)).toBe(3);
    expect(fillAboveOr(2.5)).toBe(2.5);
  });

  it("switch the fade", () => {
    useStructureStore.getState().setFadeQuiet(false);
    expect(useStructureStore.getState().fadeQuiet).toBe(false);
  });

  it("go back to their defaults when the volume is closed", () => {
    useStructureStore.getState().setFillAbove(5);
    useStructureStore.getState().setFadeQuiet(false);
    resetVolumeState();
    const s = useStructureStore.getState();
    expect([s.fillAbove, s.fadeQuiet]).toEqual([3, true]);
  });
});

describe("ΔPDF type", () => {
  it("starts atomic", () => {
    expect(useStructureStore.getState().mapKind).toBe("atomic");
  });

  it("switches to magnetic and back, and holds nothing else", () => {
    const { setMapKind } = useStructureStore.getState();
    setMapKind("magnetic");
    expect(useStructureStore.getState().mapKind).toBe("magnetic");
    setMapKind("nuclear" as never);
    expect(useStructureStore.getState().mapKind).toBe("atomic");
  });

  it("is kept with the other settings, and read back when the page loads again", async () => {
    const kept = fakeStorage();
    useStructureStore.getState().setMapKind("magnetic");
    expect(JSON.parse(kept.get("nebula3d.structure")!)).toMatchObject({ mapKind: "magnetic", fillAbove: 3, fadeQuiet: true });
    vi.resetModules();
    const reloaded = await import("../structureStore");
    expect(reloaded.useStructureStore.getState().mapKind).toBe("magnetic");
  });

  it("is atomic in a store kept from before the setting, or one edited by hand", async () => {
    const kept = fakeStorage();
    kept.set("nebula3d.structure", JSON.stringify({ fillAbove: 4.5, fadeQuiet: false }));
    vi.resetModules();
    expect((await import("../structureStore")).useStructureStore.getState()).toMatchObject({ mapKind: "atomic", fillAbove: 4.5, fadeQuiet: false });
    kept.set("nebula3d.structure", JSON.stringify({ mapKind: "spin" }));
    vi.resetModules();
    expect((await import("../structureStore")).useStructureStore.getState().mapKind).toBe("atomic");
  });

  it("goes back to atomic when the volume is closed", () => {
    const kept = fakeStorage();
    useStructureStore.getState().setMapKind("magnetic");
    resetVolumeState();
    expect(useStructureStore.getState().mapKind).toBe("atomic");
    expect(JSON.parse(kept.get("nebula3d.structure")!).mapKind).toBe("atomic");
  });
});
