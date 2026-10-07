// The square viewport every slice view draws: centre (cx, cy) and half-width
// `half` in display units — Å⁻¹ for reciprocal slices, Å for real-space ones —
// so zoom and pan mean the same thing in every view.
//
// Display coordinates follow oblique.ts: slice coordinates (x, y) are scaled to
// physical units (h = x·sx, v = y·sy; sx = 2π/a for an r.l.u. axis, 1 for Å)
// and drawn with the vertical axis at θ (the slice's axes_angle) from the
// horizontal one:  X = h + v·cos θ,  Y = v·sin θ.

import { axesTrig } from "./oblique";

export interface Viewport {
  cx: number;
  cy: number;
  half: number;
}

export interface SliceGeom {
  sx: number; // slice x unit → display unit
  sy: number;
  angle: number; // degrees between the displayed axes (90 for a right angle)
}

export interface AxisExtent {
  x_axis: number[];
  y_axis: number[];
}

export function displayToSlice(X: number, Y: number, g: SliceGeom): [number, number] {
  const { cos, sin } = axesTrig(g.angle);
  const v = Y / sin;
  const h = X - v * cos;
  return [h / g.sx, v / g.sy];
}

export function sliceToDisplay(x: number, y: number, g: SliceGeom): [number, number] {
  const { cos, sin } = axesTrig(g.angle);
  const h = x * g.sx, v = y * g.sy;
  return [h + v * cos, v * sin];
}

/** The viewport that shows the whole slice. */
export function fitViewport(ax: AxisExtent, g: SliceGeom): Viewport {
  const xs = ax.x_axis, ys = ax.y_axis;
  const corners = [
    sliceToDisplay(xs[0], ys[0], g),
    sliceToDisplay(xs[xs.length - 1], ys[0], g),
    sliceToDisplay(xs[0], ys[ys.length - 1], g),
    sliceToDisplay(xs[xs.length - 1], ys[ys.length - 1], g),
  ];
  const X = corners.map((c) => c[0]), Y = corners.map((c) => c[1]);
  const x0 = Math.min(...X), x1 = Math.max(...X), y0 = Math.min(...Y), y1 = Math.max(...Y);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, half: Math.max(x1 - x0, y1 - y0) / 2 || 1 };
}

/** Keep `half` between a few voxels and a little past the whole slice. */
export function clampHalf(half: number, fullHalf: number, voxel: number): number {
  const lo = Math.max(voxel * 3, fullHalf / 400);
  return Math.min(fullHalf * 1.25, Math.max(lo, half));
}

/**
 * Half-extents of a `w`×`h`-px view: `half` spans the shorter side, and the
 * longer side shows more of the slice (as the NeXus Viewer's views do).
 */
export function viewExtent(v: Viewport, w: number, h: number): { hx: number; hy: number } {
  const m = Math.min(w, h) || 1;
  return { hx: (v.half * w) / m, hy: (v.half * h) / m };
}

/** Display point under a pixel of a `w`×`h`-px view (square when `h` is omitted). */
export function pixelToDisplay(v: Viewport, px: number, py: number, w: number, h = w): [number, number] {
  const s = (2 * v.half) / (Math.min(w, h) || 1);
  return [v.cx + (px - w / 2) * s, v.cy - (py - h / 2) * s];
}

export function displayToPixel(v: Viewport, X: number, Y: number, w: number, h = w): [number, number] {
  const s = (Math.min(w, h) || 1) / (2 * v.half);
  return [w / 2 + (X - v.cx) * s, h / 2 - (Y - v.cy) * s];
}

/** Zoom by `k` (< 1 zooms in) keeping the display point (X, Y) fixed. */
export function zoomAbout(v: Viewport, X: number, Y: number, k: number, limit: (h: number) => number): Viewport {
  const half = limit(v.half * k);
  const r = half / v.half;
  return { cx: X - (X - v.cx) * r, cy: Y - (Y - v.cy) * r, half };
}

/** The viewport that fits a dragged box in a `w`×`h`-px view (one scale on both axes). */
export function boxViewport(
  a: [number, number],
  b: [number, number],
  limit: (h: number) => number,
  w = 1,
  h = 1,
): Viewport {
  const m = Math.min(w, h) || 1;
  return {
    cx: (a[0] + b[0]) / 2,
    cy: (a[1] + b[1]) / 2,
    half: limit(Math.max((Math.abs(a[0] - b[0]) * m) / w, (Math.abs(a[1] - b[1]) * m) / h) / 2),
  };
}

/** Pan by a pixel drag of (dx, dy) in a `w`×`h`-px view. */
export function panBy(v: Viewport, dx: number, dy: number, w: number, h = w): Viewport {
  const s = (2 * v.half) / (Math.min(w, h) || 1);
  return { ...v, cx: v.cx - dx * s, cy: v.cy + dy * s };
}

/** Nearest sample (ix, iy) of a slice at a display point, or null outside it. */
export function sampleIndex(ax: AxisExtent, X: number, Y: number, g: SliceGeom): [number, number] | null {
  const [x, y] = displayToSlice(X, Y, g);
  const ix = nearest(ax.x_axis, x), iy = nearest(ax.y_axis, y);
  return ix < 0 || iy < 0 ? null : [ix, iy];
}

function nearest(axis: number[], v: number): number {
  const n = axis.length;
  if (n === 0) return -1;
  if (n === 1) return Math.abs(v - axis[0]) < 1e-9 ? 0 : -1;
  const step = (axis[n - 1] - axis[0]) / (n - 1);
  const t = (v - axis[0]) / step;
  if (t < -0.5 || t > n - 0.5) return -1;
  return Math.max(0, Math.min(n - 1, Math.round(t)));
}

/** A tick step near `span / target` from the 1-2-5 series. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
