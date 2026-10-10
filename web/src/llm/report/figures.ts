// Figures for the report: a slice drawn the way the console's viewers draw it
// (its own colour scale and colormap, the axes at their real angle, the origin
// in the middle) into an n × n raster, then encoded as a PNG data URL.

import type { Slice } from "../../api/types";
import { COLORMAPS } from "../../colormaps/luts";
import { makeScaler, type AutoLevels, type ScaleKind } from "../../components/colorScale";
import { axesTrig } from "../../components/oblique";

export interface RasterOptions {
  n: number; // pixels per side
  half: number; // half-extent shown, in the slice's axis units (r.l.u. or Å)
  colormap: string;
  scale: ScaleKind;
  levels: AutoLevels;
  diverging: boolean;
}

const BACKGROUND = [13, 17, 23] as const; // outside the data
const MASKED = [128, 128, 128] as const; // NaN, as the viewers draw it

/** The slice as an n × n RGBA raster, y up, centred on the origin. */
export function rasterize(slice: Slice, o: RasterOptions): Uint8ClampedArray {
  const { nx, ny, x_axis, y_axis } = slice.header;
  const { cos, sin } = axesTrig(slice.header.axes_angle ?? 90);
  const lut = COLORMAPS[o.colormap] ?? COLORMAPS.inferno;
  const t = makeScaler({ lo: o.levels.lo, hi: o.levels.hi }, o.scale, o.levels.soft, o.diverging);
  const x0 = x_axis[0] ?? 0;
  const y0 = y_axis[0] ?? 0;
  const dx = nx > 1 ? ((x_axis[nx - 1] ?? 0) - x0) / (nx - 1) : 1;
  const dy = ny > 1 ? ((y_axis[ny - 1] ?? 0) - y0) / (ny - 1) : 1;
  const out = new Uint8ClampedArray(o.n * o.n * 4);
  const px = (2 * o.half) / o.n;
  const put = (k: number, r: number, g: number, b: number) => {
    out[k] = r;
    out[k + 1] = g;
    out[k + 2] = b;
    out[k + 3] = 255;
  };
  for (let rr = 0; rr < o.n; rr++) {
    const v = (o.half - (rr + 0.5) * px) / sin; // along the y axis
    const iy = Math.round((v - y0) / dy);
    for (let cc = 0; cc < o.n; cc++) {
      const k = (rr * o.n + cc) * 4;
      const h = -o.half + (cc + 0.5) * px - v * cos; // along the x axis
      const ix = Math.round((h - x0) / dx);
      if (iy < 0 || iy >= ny || ix < 0 || ix >= nx) {
        put(k, ...BACKGROUND);
        continue;
      }
      const value = slice.data[iy * nx + ix];
      if (!Number.isFinite(value)) {
        put(k, ...MASKED);
        continue;
      }
      const li = (t(value) * 255) | 0;
      put(k, lut[li * 4], lut[li * 4 + 1], lut[li * 4 + 2]);
    }
  }
  return out;
}

/** An RGBA raster as a PNG data URL, or null where the page has no canvas. */
export function pngDataUrl(rgba: Uint8ClampedArray, n: number): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(n, n);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

/** The largest |coordinate| along either axis: the whole plane. */
export const fullHalf = (slice: Slice): number => {
  const { nx, ny, x_axis, y_axis } = slice.header;
  return Math.max(Math.abs(x_axis[0] ?? 0), Math.abs(x_axis[nx - 1] ?? 0), Math.abs(y_axis[0] ?? 0), Math.abs(y_axis[ny - 1] ?? 0));
};
