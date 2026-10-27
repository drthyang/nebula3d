// The colour of a region mark over a slice (RegionMarks.tsx): of a few
// saturated candidates, the one farthest in OKLab, lightness counted twice,
// from every colour of the view's colormap, so the outline stands out on any
// part of the image (green on inferno, magenta on viridis). Saturated only:
// the unit-cell lines are white or near-black (gridColor.ts), and a mark must
// not be taken for one. Its chip's text, and the outline's halo, are dark or
// white, whichever reads on that colour.

type RGB = readonly [number, number, number];

/** The candidates: saturated hues the colormaps lack. */
export const MARK_CANDIDATES: Readonly<Record<string, RGB>> = {
  green: [0, 168, 68],
  magenta: [255, 64, 214],
  cyan: [0, 229, 255],
  lime: [118, 255, 3],
};

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

/** How far `rgb` is from the nearest colour of a 256-entry RGBA LUT (OKLab, lightness counted twice). */
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

/** A mark's colour for a colormap's LUT (CSS rgb). */
export function markColor(lut: Uint8ClampedArray): string {
  const hit = cache.get(lut);
  if (hit) return hit;
  let best: RGB = MARK_CANDIDATES.green, far = -1;
  for (const c of Object.values(MARK_CANDIDATES)) {
    const d = distanceFromLut(c, lut);
    if (d > far) [best, far] = [c, d];
  }
  const css = `rgb(${best[0]}, ${best[1]}, ${best[2]})`;
  cache.set(lut, css);
  return css;
}

// WCAG relative luminance of an sRGB colour (0–255).
const luminance = ([r, g, b]: RGB): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** The text colour that reads on a mark's colour (`rgb(r, g, b)`): near-black, or white. */
export function readableOn(css: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  const rgb: RGB = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [255, 255, 255];
  // Contrast with black (L + 0.05) / 0.05 against white 1.05 / (L + 0.05): black wins above L ≈ 0.18.
  return luminance(rgb) > 0.179 ? "#0b0d10" : "#ffffff";
}
