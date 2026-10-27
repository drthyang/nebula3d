// The colour of the unit-cell lines over a slice: white or near-black,
// whichever contrasts with the image's background colour — the low end of a
// sequential colormap (most of a diffuse slice sits near vmin), the centre of
// a diverging one (signed data sit around zero).  So white on inferno, viridis
// and gray; near-black on RdBu_r's white centre.

import { COLORMAPS, DIVERGING_NAMES } from "../colormaps/luts";

export const GRID_WHITE = "rgba(255, 255, 255, 0.85)";
export const GRID_BLACK = "rgba(16, 18, 24, 0.85)";

const linear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** OKLab lightness (0–1) of LUT entry `i`. */
export function lightnessAt(lut: Uint8ClampedArray, i: number): number {
  const R = linear(lut[i * 4]), G = linear(lut[i * 4 + 1]), B = linear(lut[i * 4 + 2]);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

const DIVERGING_LUTS = new Set(DIVERGING_NAMES.map((n) => COLORMAPS[n]));

/** One of the diverging maps (RdBu_r, coolwarm, seismic, PiYG). */
export function isDiverging(lut: Uint8ClampedArray): boolean {
  return DIVERGING_LUTS.has(lut);
}

/** The unit-cell lines' stroke colour for a colormap's LUT (CSS rgba). */
export function gridColor(lut: Uint8ClampedArray): string {
  const background = lightnessAt(lut, isDiverging(lut) ? 128 : 0);
  return background < 0.6 ? GRID_WHITE : GRID_BLACK;
}
