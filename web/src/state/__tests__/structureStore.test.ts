// The structure overlay's fill settings (state/structureStore.ts): where they
// start, what the slider may hold, and that Close puts them back.

import { beforeEach, describe, expect, it } from "vitest";

import { fillAboveOr, useStructureStore } from "../structureStore";
import { resetVolumeState } from "../volumeReset";

beforeEach(() => resetVolumeState());

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
