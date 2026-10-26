// The Bragg-profile page's three selected-peak tiles (a*·b*, a*·c*, b*·c*) as
// one linked view, on the shared ViewFrame (THY-38).
//
// The tiles display r.l.u. at one scale on both axes (sx = sy = 1, a right
// angle), centred on the peak.  Their one view is a point in hkl, kept as an
// offset from the peak centre, and a half-width: a tile on axes (xa, ya) shows
// (centre + offset)[xa], [ya] at its centre, so zooming or panning one tile
// moves the other two through the same point, and every tile zooms by the
// same factor.  The fit view (reset) is the window the page always opened at:
// 3.5× the peak's widest fitted width, clamped to 0.08–0.6 r.l.u.
//
// The fit ellipses are r.l.u. shapes about the peak centre, drawn with the
// same pixel mapping as the raster (viewport.ts), so they stay registered to
// the data at any zoom and pan.

import type { BraggPeakWidth } from "../api/types";
import { displayToPixel, type Bounds, type SliceGeom, type Viewport } from "./viewport";

export type Hkl = [number, number, number];
export type AxisIndex = 0 | 1 | 2;

/** One tile's displayed axes: indices into (h, k, l). */
export interface TileAxes {
  xa: AxisIndex;
  ya: AxisIndex;
}

/** The tiles' display geometry: r.l.u. on both axes, one scale, a right angle. */
export const RLU_GEOM: SliceGeom = { sx: 1, sy: 1, angle: 90 };

export interface Ellipse {
  rx: number; // semi-axis along `angle` (r.l.u.); tile x when no angle
  ry: number; // semi-axis perpendicular to `angle` (r.l.u.); tile y when no angle
  angle?: number; // rotation in degrees (SVG space, y down); omit for axis-aligned
}

/** Half-width (r.l.u.) of the window a peak's tiles open at: 3.5× its widest fitted width, 0.08–0.6. */
export function peakFitHalf(widthHkl: readonly number[]): number {
  const maxW = Math.max(...widthHkl.map(Math.abs).filter(Number.isFinite), 0.02);
  return Math.min(0.6, Math.max(0.08, maxW * 3.5));
}

/** Zooming out reaches 10× the fit window (the old Zoom slider stopped at ×0.1, 2^−3.3). */
export const PEAK_ZOOM_OUT = 10;

/**
 * The half-widths the tiles can zoom to: out to PEAK_ZOOM_OUT × the fit
 * window; in to a few voxels (2 voxels or a sixteenth of the fit window), and
 * at least as far in as the old slider's ×4.
 */
export function peakHalfLimit(fitHalf: number, voxel: number): (half: number) => number {
  const lo = Math.min(fitHalf / 4, Math.max(2 * voxel, fitHalf / 16));
  const hi = fitHalf * PEAK_ZOOM_OUT;
  return (half) => Math.min(hi, Math.max(lo, half));
}

/** One tile's viewport in the linked view: centre + offset on its axes, the shared half-width. */
export function tileViewport(centre: Hkl, offset: Hkl, half: number, t: TileAxes): Viewport {
  return { cx: centre[t.xa] + offset[t.xa], cy: centre[t.ya] + offset[t.ya], half };
}

/** The linked view after one tile moved to `v`: its two axes' offsets and the half-width; the third axis keeps its offset. */
export function linkFromTile(centre: Hkl, offset: Hkl, t: TileAxes, v: Viewport): { offset: Hkl; half: number } {
  const next: Hkl = [...offset];
  next[t.xa] = v.cx - centre[t.xa];
  next[t.ya] = v.cy - centre[t.ya];
  return { offset: next, half: v.half };
}

/** The hkl point under the pointer in a tile: its two axes from the pointer, the third the peak's (the tile's plane). */
export function cursorFromTile(centre: Hkl, t: TileAxes, p: [number, number]): Hkl {
  const q: Hkl = [...centre];
  q[t.xa] = p[0];
  q[t.ya] = p[1];
  return q;
}

/** A point in hkl on a tile's axes (the shared crosshair). */
export function tileCursor(q: Hkl, t: TileAxes): [number, number] {
  return [q[t.xa], q[t.ya]];
}

/** The display rectangle of a tile's data: the volume's ranges on its two axes. */
export function tileBounds(ranges: readonly (readonly [number, number])[], t: TileAxes): Bounds {
  const [x0, x1] = ranges[t.xa], [y0, y1] = ranges[t.ya];
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
}

/**
 * An r.l.u. ellipse about `c` in a `w`×`h`-px view of `v`: its centre and
 * semi-axes in px (both axes share one scale, so the SVG angle carries over).
 */
export function ellipseInView(
  e: Ellipse,
  c: [number, number],
  v: Viewport,
  w: number,
  h: number,
): { cx: number; cy: number; rx: number; ry: number; angle: number } {
  const [cx, cy] = displayToPixel(v, c[0], c[1], w, h);
  const s = (Math.min(w, h) || 1) / (2 * v.half);
  return { cx, cy, rx: e.rx * s, ry: e.ry * s, angle: e.angle ?? 0 };
}

/**
 * Accurate fitted ellipse on a slice plane from the principal-axis ellipsoid.
 * The slice passes through the peak centre, so the cross-section is the 2×2
 * block of the precision matrix M = Σ (1/rᵢ²) vᵢ vᵢᵀ restricted to the in-plane
 * axes (ix, iy); its eigen-decomposition gives the (possibly tilted) ellipse.
 * Returns r.l.u. semi-axes (rx along `angle`, ry perpendicular) + SVG-space angle.
 */
export function fittedEllipse(peak: BraggPeakWidth, ix: number, iy: number): Ellipse {
  const dirs = peak.principal_directions_hkl;
  const rs = peak.principal_width_hkl;
  if (dirs && dirs.length === 3 && rs && rs.length === 3) {
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < 3; i++) {
      const w = Math.abs(rs[i]);
      if (!(w > 0) || !dirs[i]) continue;
      const inv = 1 / (w * w);
      const vx = dirs[i][ix], vy = dirs[i][iy];
      a += inv * vx * vx; b += inv * vx * vy; c += inv * vy * vy;
    }
    const half = (a + c) / 2;
    const d = Math.sqrt(((a - c) / 2) ** 2 + b * b);
    const l1 = half + d, l2 = half - d;
    if (l1 > 0 && l2 > 0) {
      // SVG y points down, so negate the y-component of the eigenvector.
      const angle = (Math.atan2(-(l1 - a), b) * 180) / Math.PI;
      return { rx: 1 / Math.sqrt(l1), ry: 1 / Math.sqrt(l2), angle };
    }
  }
  return { rx: Math.abs(peak.width_hkl[ix]), ry: Math.abs(peak.width_hkl[iy]) };
}
