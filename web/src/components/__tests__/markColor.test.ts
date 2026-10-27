// A region mark's colour (markColor.ts): the saturated candidate farthest
// from the view's colormap, never white or near-black (the unit-cell lines'),
// and its chip's text and halo, dark or white by its luminance.

import { describe, expect, it } from "vitest";

import { COLORMAPS } from "../../colormaps/luts";
import { distanceFromLut, MARK_CANDIDATES, markColor, readableOn } from "../markColor";

const css = (rgb: readonly number[]) => `rgb(${rgb.join(", ")})`;

describe("markColor", () => {
  it("takes the candidate the colormap lacks most: green on inferno, magenta on viridis, lime on RdBu_r", () => {
    expect(markColor(COLORMAPS.inferno)).toBe(css(MARK_CANDIDATES.green));
    expect(markColor(COLORMAPS.viridis)).toBe(css(MARK_CANDIDATES.magenta));
    expect(markColor(COLORMAPS.RdBu_r)).toBe(css(MARK_CANDIDATES.lime));
  });

  it("stands apart from every colormap, and is never the unit-cell lines' white or near-black", () => {
    for (const [name, lut] of Object.entries(COLORMAPS)) {
      const pick = markColor(lut);
      const rgb = Object.values(MARK_CANDIDATES).find((c) => css(c) === pick)!;
      expect(rgb, name).toBeDefined();
      expect(distanceFromLut(rgb, lut), name).toBeGreaterThan(0.15);
      expect(pick).not.toMatch(/^rgb\((255, 255, 255|16, 18, 24)\)$/);
    }
  });
});

describe("readableOn", () => {
  it("writes dark on the bright candidates, white on a dark colour", () => {
    for (const c of Object.values(MARK_CANDIDATES)) expect(readableOn(css(c))).toBe("#0b0d10");
    expect(readableOn("rgb(16, 18, 24)")).toBe("#ffffff");
    expect(readableOn("rgb(0, 0, 160)")).toBe("#ffffff");
  });
});
