// Geometry for drawing a real-space section whose two axes meet at a non-right
// angle θ (a hexagonal ab-plane has θ = γ = 120°, a monoclinic ac-plane θ = β).
// The server keeps the ΔPDF on its native oblique grid and sends θ per slice
// (`axes_angle`); the display puts the horizontal axis to the right and the
// vertical one at θ counter-clockwise from it:
//
//   X = h + v·cos θ,   Y = v·sin θ          (true Å, Y up)
//
// Mirrors nebula3d.analysis.delta_pdf.section_geometry.

import type { Lattice } from "../api/types";

const DEG = Math.PI / 180;

/** cos/sin of the axes angle, snapping 90° to an exact right angle. */
export function axesTrig(angleDeg: number): { cos: number; sin: number } {
  if (Math.abs(angleDeg - 90) < 1e-9) return { cos: 0, sin: 1 };
  return { cos: Math.cos(angleDeg * DEG), sin: Math.sin(angleDeg * DEG) };
}

/** Oblique in-plane coordinates (h, v) → display (X, Y), both in Å. */
export function toDisplay(h: number, v: number, angleDeg: number): [number, number] {
  const { cos, sin } = axesTrig(angleDeg);
  return [h + v * cos, v * sin];
}

/** Display (X, Y) → oblique in-plane coordinates (h, v). */
export function fromDisplay(X: number, Y: number, angleDeg: number): [number, number] {
  const { cos, sin } = axesTrig(angleDeg);
  const v = Y / sin;
  return [X - v * cos, v];
}

/** True in-plane distance from the section origin of oblique (h, v). */
export function inPlaneRadius(h: number, v: number, angleDeg: number): number {
  const { cos } = axesTrig(angleDeg);
  return Math.sqrt(Math.max(0, h * h + v * v + 2 * h * v * cos));
}

export type Segment = [number, number, number, number]; // X1, Y1, X2, Y2 (Å)

/** A display rectangle (viewport.ts's Bounds). */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** More lines than this in one family would be denser than the pixels; none are drawn. */
export const MAX_GRID_LINES = 400;

/**
 * Lattice lines over the display rectangle `b`: lines of constant h at
 * multiples of `latX` (running along the vertical axis, so slanted by θ) and of
 * constant v at multiples of `latY` (horizontal), every one that crosses `b`.
 * Each segment spans `b`'s full height/width; the caller clips to the box.
 * With `latX`, `latY` the r.l.u. scales (2π/a, 2π/b in Å⁻¹, or 1 on an r.l.u.
 * display) these are the lines of integer h, k, l (viewport.ts hklGridSegments).
 */
export function gridSegments(b: Rect, latX: number | null, latY: number | null, angleDeg: number): Segment[] {
  const { cos, sin } = axesTrig(angleDeg);
  const cot = cos / sin;
  const out: Segment[] = [];
  if (latX && latX > 0) {
    // h = k·latX runs X = k·latX + Y·cot θ over the rectangle's Y range.
    const lo = Math.ceil((b.x0 - Math.max(b.y0 * cot, b.y1 * cot)) / latX) || 0; // never −0
    const hi = Math.floor((b.x1 - Math.min(b.y0 * cot, b.y1 * cot)) / latX);
    if (hi - lo < MAX_GRID_LINES) {
      for (let k = lo; k <= hi; k++) {
        const x0 = k * latX;
        out.push([x0 + b.y0 * cot, b.y0, x0 + b.y1 * cot, b.y1]);
      }
    }
  }
  if (latY && latY > 0) {
    // v = m·latY is the horizontal line Y = m·latY·sin θ.
    const step = latY * sin;
    const lo = Math.ceil(b.y0 / step) || 0;
    const hi = Math.floor(b.y1 / step);
    if (hi - lo < MAX_GRID_LINES) {
      for (let m = lo; m <= hi; m++) out.push([b.x0, m * step, b.x1, m * step]);
    }
  }
  return out;
}

/** Unit-cell lines over the square display window [-half, half]² (gridSegments). */
export function unitCellSegments(
  half: number,
  latX: number | null,
  latY: number | null,
  angleDeg: number,
): Segment[] {
  return gridSegments({ x0: -half, x1: half, y0: -half, y1: half }, latX, latY, angleDeg);
}

/** "a=… b=… c=… Å", plus "· α=… β=… γ=…°" when the cell angles are known. */
export function latticeLabel(lat: Lattice): string {
  const len = `a=${lat.a?.toFixed(2)}  b=${lat.b?.toFixed(2)}  c=${lat.c?.toFixed(2)} Å`;
  const { alpha, beta, gamma } = lat;
  if (alpha == null || beta == null || gamma == null) return len;
  return `${len} · α=${alpha.toFixed(2)}  β=${beta.toFixed(2)}  γ=${gamma.toFixed(2)}°`;
}

/** The steps (in r.l.u.) the h, k, l grid may take: every line, or every 2nd, 5th, 10th. */
export const HKL_GRID_STEPS = [1, 2, 5, 10] as const;
/** The closest two grid lines may come on screen (CSS px) before the grid steps up. */
export const HKL_GRID_MIN_PX = 40;

/**
 * The grid step along one axis: the smallest of 1, 2, 5, 10 r.l.u. whose lines
 * stand at least HKL_GRID_MIN_PX apart on screen.  `lat` is one r.l.u. in
 * display units, `pxPerUnit` the view's scale, `angleDeg` the axes' angle (the
 * lines' true separation is lat·sin θ).  Past 10 it stays 10.
 */
export function hklGridStep(lat: number, pxPerUnit: number, angleDeg = 90): number {
  const gap = lat * axesTrig(angleDeg).sin * pxPerUnit;
  return HKL_GRID_STEPS.find((s) => s * gap >= HKL_GRID_MIN_PX) ?? HKL_GRID_STEPS[HKL_GRID_STEPS.length - 1];
}
