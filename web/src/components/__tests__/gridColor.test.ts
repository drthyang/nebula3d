// The unit-cell lines take a colour the view's colormap lacks.

import { describe, expect, it } from "vitest";

import { COLORMAPS } from "../../colormaps/luts";
import { GRID_CANDIDATES, distanceFromLut, gridColor } from "../gridColor";

const rgbOf = (css: string) => css.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];

describe("gridColor", () => {
  it("picks the candidate farthest from every colour of the map", () => {
    for (const lut of Object.values(COLORMAPS)) {
      const chosen = distanceFromLut(rgbOf(gridColor(lut)), lut);
      for (const c of Object.values(GRID_CANDIDATES)) expect(chosen).toBeGreaterThanOrEqual(distanceFromLut(c, lut));
    }
  });

  it("stands clear of every map it is drawn on", () => {
    for (const [name, lut] of Object.entries(COLORMAPS)) {
      expect(distanceFromLut(rgbOf(gridColor(lut)), lut), name).toBeGreaterThan(0.25);
    }
  });

  it("is green on inferno, magenta on viridis and dark on RdBu_r's white centre", () => {
    expect(gridColor(COLORMAPS.inferno)).toBe("rgba(0, 168, 68, 0.85)");
    expect(gridColor(COLORMAPS.viridis)).toBe("rgba(255, 64, 214, 0.85)");
    expect(gridColor(COLORMAPS.RdBu_r)).toBe("rgba(16, 18, 24, 0.85)");
  });
});
