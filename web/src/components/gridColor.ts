// The colour of the unit-cell lines over a slice: the candidate farthest from
// every colour of the view's colormap, so the dashes stand out on any part of
// the image (green on inferno, magenta on viridis, near-black on RdBu_r's
// white centre).  Distance is in OKLab with lightness counted twice, since a
// 1 px dash needs a lightness difference more than a hue one.

/** The candidates: saturated hues the maps lack, plus white and near-black. */
export const GRID_CANDIDATES = {
  green: [0, 168, 68],
  magenta: [255, 64, 214],
  cyan: [0, 229, 255],
  lime: [118, 255, 3],
  white: [255, 255, 255],
  black: [16, 18, 24],
} as const;

type RGB = readonly [number, number, number];

const linear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** sRGB (0–255) → OKLab [L, a, b]. */
export function oklab([r, g, b]: RGB): [number, number, number] {
  const R = linear(r), G = linear(g), B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** How far `rgb` is from the nearest colour of a 256-entry RGBA LUT. */
export function distanceFromLut(rgb: RGB, lut: Uint8ClampedArray): number {
  const [L, A, B] = oklab(rgb);
  let min = Infinity;
  for (let i = 0; i < 256; i += 4) {
    const [l, a, b] = oklab([lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2]]);
    min = Math.min(min, Math.hypot(2 * (L - l), A - a, B - b));
  }
  return min;
}

const cache = new WeakMap<Uint8ClampedArray, string>();

/** The unit-cell lines' stroke colour for a colormap's LUT (CSS rgba). */
export function gridColor(lut: Uint8ClampedArray): string {
  const hit = cache.get(lut);
  if (hit) return hit;
  let best: RGB = GRID_CANDIDATES.white, far = -1;
  for (const c of Object.values(GRID_CANDIDATES)) {
    const d = distanceFromLut(c, lut);
    if (d > far) [best, far] = [c, d];
  }
  const css = `rgba(${best[0]}, ${best[1]}, ${best[2]}, 0.85)`;
  cache.set(lut, css);
  return css;
}
