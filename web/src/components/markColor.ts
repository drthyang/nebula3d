// The colour of a region mark over a slice (RegionMarks.tsx): the candidate
// the unit-cell lines take (gridColor.ts: farthest in OKLab, lightness
// counted twice, from every colour of the view's colormap), opaque: a mark's
// outline must read at a glance where the grid's dashes recede. Its chip's
// text is dark or white, whichever reads on that colour.

import { distanceFromLut, GRID_CANDIDATES } from "./gridColor";

type RGB = readonly [number, number, number];

const cache = new WeakMap<Uint8ClampedArray, string>();

/** A mark's colour for a colormap's LUT (CSS rgb). */
export function markColor(lut: Uint8ClampedArray): string {
  const hit = cache.get(lut);
  if (hit) return hit;
  let best: RGB = GRID_CANDIDATES.white, far = -1;
  for (const c of Object.values(GRID_CANDIDATES)) {
    const d = distanceFromLut(c, lut);
    if (d > far) [best, far] = [c, d];
  }
  const css = `rgb(${best[0]}, ${best[1]}, ${best[2]})`;
  cache.set(lut, css);
  return css;
}

// WCAG relative luminance of an sRGB colour (0–255).
const luminance = ([r, g, b]: RGB): number => {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** The text colour that reads on a mark's colour (`rgb(r, g, b)`): near-black, or white. */
export function readableOn(css: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  const rgb: RGB = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [255, 255, 255];
  // Contrast with black (L + 0.05) / 0.05 against white 1.05 / (L + 0.05): black wins above L ≈ 0.18.
  return luminance(rgb) > 0.179 ? "#0b0d10" : "#ffffff";
}
