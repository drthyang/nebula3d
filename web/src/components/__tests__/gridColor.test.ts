// The unit-cell lines are white or near-black, against the image's background.

import { describe, expect, it } from "vitest";

import { COLORMAPS, DIVERGING_NAMES, SEQUENTIAL_NAMES } from "../../colormaps/luts";
import { GRID_BLACK, GRID_WHITE, gridColor, isDiverging, lightnessAt } from "../gridColor";

describe("gridColor", () => {
  it("tells diverging maps from sequential ones", () => {
    for (const n of DIVERGING_NAMES) expect(isDiverging(COLORMAPS[n]), n).toBe(true);
    for (const n of SEQUENTIAL_NAMES) expect(isDiverging(COLORMAPS[n]), n).toBe(false);
  });

  it("is white on the sequential maps' dark low end", () => {
    for (const n of ["inferno", "viridis", "magma", "plasma", "cividis", "gray"]) {
      expect(gridColor(COLORMAPS[n]), n).toBe(GRID_WHITE);
    }
  });

  it("is near-black on the diverging maps' light centre", () => {
    for (const n of DIVERGING_NAMES) expect(gridColor(COLORMAPS[n]), n).toBe(GRID_BLACK);
  });

  it("always contrasts with the background colour", () => {
    for (const [n, lut] of Object.entries(COLORMAPS)) {
      const bg = lightnessAt(lut, isDiverging(lut) ? 128 : 0);
      expect(Math.abs((gridColor(lut) === GRID_WHITE ? 1 : 0.1) - bg), n).toBeGreaterThan(0.35);
    }
  });
});
