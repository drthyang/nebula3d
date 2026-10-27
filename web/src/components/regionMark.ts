// A region marked in a volume, and where it meets the slice views: a box, an
// ellipsoid or a few points, in the volume's own coordinates (r.l.u. along
// H, K, L for reciprocal space; Å along a, b, c for the 3D-ΔPDF), as the NEBULA
// Pilot marks a finding for the user to look at (state/marks.ts).
//
// A slice view shows one plane of the grid, a slab one voxel thick about its
// cut (|w − cut| ≤ step/2 along the cut axis). The region meets it where it
// meets that slab: a box in the rectangle of its in-plane half-widths, an
// ellipsoid in the ellipse at the slab's point nearest its centre, a point
// when it lies in the slab. The section is drawn as the view draws its slice
// (viewport.ts sliceToDisplay: r.l.u. scaled to Å⁻¹, the vertical axis at the
// section's angle), so it stays on the data while the view is zoomed and
// panned, on an oblique section too.

import {
  displayToPixel,
  sliceToDisplay,
  type Bounds,
  type SliceGeom,
  type Viewport,
} from "./viewport";

export type Vec3 = [number, number, number];
export type Range = [number, number];
export type Axis = 0 | 1 | 2;

export type MarkRegion =
  | { shape: "box" | "ellipsoid"; center: Vec3; half: Vec3 } // half: the half-widths (a box) or semi-axes (an ellipsoid)
  | { shape: "points"; points: Vec3[] };

/** The most points one mark holds (satellites about a node, a few features). */
export const MAX_POINTS = 12;

/** A volume's grid: each axis's first and last sample, its sample count, and the axes' names and unit for the words. */
export interface VolumeGrid {
  ranges: [Range, Range, Range];
  shape: Vec3;
  names: [string, string, string]; // "H", "K", "L" or "x", "y", "z"
  unit: string; // "r.l.u." or "Å"
}

/** A plane of the grid as a view shows it: its in-plane axes (horizontal, vertical) and the axis it is cut along. */
export interface PlaneAxes {
  u: Axis;
  v: Axis;
  cut: Axis;
}

/** Sample spacing along an axis (0 for a single sample). */
export const gridStep = (g: Pick<VolumeGrid, "ranges" | "shape">, axis: Axis): number => {
  const [lo, hi] = g.ranges[axis];
  const n = g.shape[axis];
  return n > 1 ? (hi - lo) / (n - 1) : 0;
};

/** The sample index nearest `value` along an axis, as the pages snap a cut. */
export const snapIndex = (g: Pick<VolumeGrid, "ranges" | "shape">, axis: Axis, value: number): number => {
  const step = gridStep(g, axis);
  if (!(step > 0)) return 0;
  const i = Math.round((value - g.ranges[axis][0]) / step);
  return Math.max(0, Math.min(g.shape[axis] - 1, i));
};

/** The coordinate of sample `index` along an axis; the sample at the origin is exactly 0, not float noise beside it. */
export const gridValue = (g: Pick<VolumeGrid, "ranges" | "shape">, axis: Axis, index: number): number => {
  const step = gridStep(g, axis);
  const v = g.ranges[axis][0] + index * step;
  return Math.abs(v) < Math.abs(step) * 1e-9 ? 0 : v;
};

/** The extent the voxels cover along an axis: the samples' range, half a step past each end. */
const extent = (g: VolumeGrid, axis: Axis): Range => {
  const t = gridStep(g, axis) / 2;
  const [lo, hi] = g.ranges[axis];
  return [Math.min(lo, hi) - t, Math.max(lo, hi) + t];
};

const fmt = (x: number): string => String(Number(x.toPrecision(4)) + 0);
const fmtRange = (r: Range): string => `${fmt(r[0])} to ${fmt(r[1])}`;
const finite3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** Why a region is no region (an empty box, a point list with no point), or null. */
export function regionProblem(region: MarkRegion): string | null {
  if (region.shape === "points") {
    if (!region.points.length) return "a points mark needs at least one point";
    if (region.points.length > MAX_POINTS) return `a points mark holds at most ${MAX_POINTS} points; got ${region.points.length}`;
    if (!region.points.every(finite3)) return "each point needs three finite coordinates";
    return null;
  }
  if (!finite3(region.center)) return "the centre needs three finite coordinates";
  if (!finite3(region.half)) return "half_size needs three finite half-widths";
  if (!region.half.every((h) => h > 0)) return `the ${region.shape} is empty: every half-width must be above 0; got ${region.half.map(fmt).join(", ")}`;
  return null;
}

/** A region cut to the volume, with what was cut in words; or why it misses the volume. */
export type Clipped = { ok: true; region: MarkRegion; clipped: string[] } | { ok: false; reason: string };

/**
 * The region as far as the volume holds it: a box cut to the voxels' extent
 * along each axis, points outside it left out, an ellipsoid kept whole when
 * it meets the volume (its drawing is clipped to each slice). A region the
 * volume does not hold at all is refused, saying where the volume ends.
 */
export function clipRegion(region: MarkRegion, grid: VolumeGrid): Clipped {
  const problem = regionProblem(region);
  if (problem) return { ok: false, reason: problem };
  const ext = [0, 1, 2].map((a) => extent(grid, a as Axis)) as [Range, Range, Range];
  const where = (a: Axis) => `${grid.names[a]} ${fmtRange(grid.ranges[a])} ${grid.unit}`;
  const volume = `the volume spans ${[0, 1, 2].map((a) => where(a as Axis)).join(", ")}`;

  if (region.shape === "points") {
    const inside = region.points.filter((p) => p.every((x, a) => x >= ext[a][0] && x <= ext[a][1]));
    if (!inside.length) return { ok: false, reason: `no point is inside the volume: ${volume}` };
    const left = region.points.length - inside.length;
    return { ok: true, region: { shape: "points", points: inside }, clipped: left ? [`${left} of ${region.points.length} points are outside the volume and were left out`] : [] };
  }

  const { center: c, half: h } = region;
  if (region.shape === "box") {
    const lo = [0, 1, 2].map((a) => Math.max(c[a] - h[a], ext[a][0]));
    const hi = [0, 1, 2].map((a) => Math.min(c[a] + h[a], ext[a][1]));
    const miss = [0, 1, 2].find((a) => !(hi[a] > lo[a]));
    if (miss !== undefined) {
      const a = miss as Axis;
      return { ok: false, reason: `the box (${grid.names[a]} ${fmtRange([c[a] - h[a], c[a] + h[a]])}) is outside the volume: ${volume}` };
    }
    // An axis the volume holds whole keeps its centre and half-width as given.
    const cut = ([0, 1, 2] as Axis[]).filter((a) => lo[a] > c[a] - h[a] || hi[a] < c[a] + h[a]);
    const center = [...c] as Vec3, half = [...h] as Vec3;
    for (const a of cut) [center[a], half[a]] = [(lo[a] + hi[a]) / 2, (hi[a] - lo[a]) / 2];
    return {
      ok: true,
      region: { shape: "box", center, half },
      clipped: cut.map((a) => `${grid.names[a]} ${fmtRange([c[a] - h[a], c[a] + h[a]])} cut to ${fmtRange([lo[a], hi[a]])} ${grid.unit}`),
    };
  }

  // An ellipsoid meets the volume (a box) when the box's point nearest its
  // centre, in the ellipsoid's own scaled coordinates, is inside it.
  const near = [0, 1, 2].reduce((s, a) => {
    const p = Math.min(ext[a][1], Math.max(ext[a][0], c[a]));
    return s + ((p - c[a]) / h[a]) ** 2;
  }, 0);
  if (near >= 1) return { ok: false, reason: `the ellipsoid is outside the volume: ${volume}` };
  const past = ([0, 1, 2] as Axis[]).filter((a) => c[a] - h[a] < ext[a][0] || c[a] + h[a] > ext[a][1]);
  return {
    ok: true,
    region,
    clipped: past.length ? [`the ellipsoid reaches past the volume along ${past.map((a) => grid.names[a]).join(", ")}; it is drawn only inside it`] : [],
  };
}

// ---------------------------------------------------------------- sections

/** Where a region meets a slab, in the plane's slice coordinates (u, v). */
export type Section =
  | { kind: "rect"; u: Range; v: Range }
  | { kind: "ellipse"; cu: number; cv: number; au: number; av: number }
  | { kind: "points"; pts: [number, number][] };

/**
 * The region's section by the slab |w − cut| ≤ slab along `plane.cut`, in the
 * plane's (u, v); null where it misses the slab.
 */
export function sectionOf(region: MarkRegion, plane: PlaneAxes, cut: number, slab: number): Section | null {
  const { u, v, cut: w } = plane;
  const eps = 1e-9 * Math.max(1, Math.abs(cut), slab);
  if (region.shape === "points") {
    const pts = region.points.filter((p) => Math.abs(p[w] - cut) <= slab + eps).map((p) => [p[u], p[v]] as [number, number]);
    return pts.length ? { kind: "points", pts } : null;
  }
  const { center: c, half: h } = region;
  const off = Math.abs(cut - c[w]);
  if (region.shape === "box") {
    if (off > h[w] + slab + eps) return null;
    return { kind: "rect", u: [c[u] - h[u], c[u] + h[u]], v: [c[v] - h[v], c[v] + h[v]] };
  }
  // The slab's point nearest the centre along the cut axis.
  const d = Math.max(0, off - slab);
  if (d >= h[w]) return null;
  const s = Math.sqrt(1 - (d / h[w]) ** 2);
  return { kind: "ellipse", cu: c[u], cv: c[v], au: h[u] * s, av: h[v] * s };
}

/** Segments of an ellipse's outline: enough that it reads round at any zoom of the section it marks. */
export const ELLIPSE_SEGMENTS = 96;

/**
 * The section in display units, as the view draws its slice: a closed polygon
 * (a rectangle's four corners, the ellipse's outline), or a points section's
 * points. An ellipse in (u, v) stays an ellipse under the slice's affine map,
 * so the polygon traces its true image, sheared on an oblique section.
 */
export function sectionDisplay(s: Section, g: SliceGeom, n = ELLIPSE_SEGMENTS): [number, number][] {
  if (s.kind === "points") return s.pts.map(([x, y]) => sliceToDisplay(x, y, g));
  if (s.kind === "rect") {
    const [u0, u1] = s.u, [v0, v1] = s.v;
    return [sliceToDisplay(u0, v0, g), sliceToDisplay(u1, v0, g), sliceToDisplay(u1, v1, g), sliceToDisplay(u0, v1, g)];
  }
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push(sliceToDisplay(s.cu + s.au * Math.cos(t), s.cv + s.av * Math.sin(t), g));
  }
  return out;
}

/** The display rectangle around a section (its points' or outline's bounding box). */
export function sectionBounds(s: Section, g: SliceGeom): Bounds {
  // An ellipse's extremes in display units, exactly: X = a·cos t + b·sin t
  // reaches ±√(a² + b²) about the centre.
  if (s.kind === "ellipse") {
    const [cx, cy] = sliceToDisplay(s.cu, s.cv, g);
    const [ax, ay] = sliceToDisplay(s.au, 0, g);
    const [bx, by] = sliceToDisplay(0, s.av, g);
    const hx = Math.hypot(ax, bx), hy = Math.hypot(ay, by);
    return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
  }
  const pts = sectionDisplay(s, g);
  const X = pts.map((p) => p[0]), Y = pts.map((p) => p[1]);
  return { x0: Math.min(...X), x1: Math.max(...X), y0: Math.min(...Y), y1: Math.max(...Y) };
}

/** Display points as pixels of a `w`×`h`-px view of `viewport`. */
export const toPixels = (pts: [number, number][], viewport: Viewport, w: number, h: number): [number, number][] =>
  pts.map(([X, Y]) => displayToPixel(viewport, X, Y, w, h));

// ---------------------------------------------------------------- framing

/**
 * The cut through a region along `axis`, as a sample index: a box's or an
 * ellipsoid's centre; for points, the grid plane that holds the most of them
 * (the one nearest their mean among equals), so a satellite pair at h ± q
 * lands on the plane that shows both.
 */
export function cutIndexFor(region: MarkRegion, grid: VolumeGrid, axis: Axis): { index: number; count: number } {
  if (region.shape !== "points") return { index: snapIndex(grid, axis, region.center[axis]), count: 1 };
  const counts = new Map<number, number>();
  for (const p of region.points) {
    const i = snapIndex(grid, axis, p[axis]);
    counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const mean = region.points.reduce((s, p) => s + p[axis], 0) / region.points.length;
  const target = snapIndex(grid, axis, mean);
  let best = { index: target, count: 0 };
  for (const [index, count] of counts) {
    if (count > best.count || (count === best.count && Math.abs(index - target) < Math.abs(best.index - target))) best = { index, count };
  }
  return best;
}

/** A region shorter than this share of a view's width is zoomed to. */
export const SMALL_SHARE = 0.08;
/** A region zoomed to spans 1/MARGIN of the view: the rest is its surroundings. */
export const MARGIN = 3;
/** A zoom never closes in past this share of the full view, so a small region keeps its surroundings. */
export const MIN_VIEW_SHARE = 0.1;

/**
 * How a view frames a region, fixed by the volume and the view: the region's
 * section as a display rectangle (`target`), the view's full view (`fit`),
 * the data's display extent and the view's zoom limits. A mark keeps it, so
 * that showing the mark again frames it against the view as it is then.
 */
export interface Frame {
  target: Bounds;
  fit: Viewport;
  data: Bounds;
  minHalf: number;
  maxHalf: number;
}

/** The viewport that shows a frame's region in a view now at `current` (absent: the full view), or null to leave it (frameTarget). */
export const frameIn = (f: Frame, current: Viewport | undefined): Viewport | null =>
  frameTarget(f.target, current ?? f.fit, { fit: f.fit, data: f.data, limit: (h) => Math.min(f.maxHalf, Math.max(f.minHalf, h)) });

/**
 * The viewport that shows `target` (a section's display rectangle) in a view
 * now at `current`, or null to leave the view as it is: when the target is
 * inside the view's square (what any view shape shows) and not tiny in it.
 * Otherwise the view centres on it, about MARGIN times its size (never closer
 * than MIN_VIEW_SHARE of the full view `fit`, never wider than it), its centre
 * kept on the data (`data`) as a pan keeps it.
 */
export function frameTarget(
  target: Bounds,
  current: Viewport,
  { fit, data, limit }: { fit: Viewport; data: Bounds; limit: (half: number) => number },
): Viewport | null {
  const size = Math.max(target.x1 - target.x0, target.y1 - target.y0);
  const inside =
    target.x0 >= current.cx - current.half &&
    target.x1 <= current.cx + current.half &&
    target.y0 >= current.cy - current.half &&
    target.y1 <= current.cy + current.half;
  if (inside && size >= SMALL_SHARE * 2 * current.half) return null;
  const half = Math.min(fit.half, limit(Math.max((size / 2) * MARGIN, fit.half * MIN_VIEW_SHARE)));
  const cx = Math.min(data.x1, Math.max(data.x0, (target.x0 + target.x1) / 2));
  const cy = Math.min(data.y1, Math.max(data.y0, (target.y0 + target.y1) / 2));
  return { cx, cy, half };
}
