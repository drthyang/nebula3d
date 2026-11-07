// An overlay set (overlays.ts) on one stage's view of the cleanup page: what
// it draws there, in display units (Å⁻¹, as the view's slice: X = x·2π/a), and
// how many of each class. Computed once per set, view, cut and slice, and
// cached: panning and zooming only re-project it (HighlightLayer), so no frame
// recomputes anything. The punch holes are traced from the slice's own NaN
// voxels, against the slice before the punch (a hole there was no coverage,
// not the punch), once per pair of slices.

import type { Lattice, Slice } from "../../api/types";
import { qShellEllipseForPlane, type DisplayEllipse } from "../../components/punchGeometry";
import type { PunchPlane } from "../../state/pipelineStore";
import type { ClassId, OverlaySet, Style } from "./overlays";

/** At most this many primitives a view draws: the strongest peaks first (design §3.4). */
export const MAX_PRIMITIVES = 400;

// The cleanup page's planes ("0kl" …) as the punch geometry names them ("kl" …), and their axes' indices.
const PLANE_ID: Record<string, PunchPlane> = { hk0: "hk", h0l: "hl", "0kl": "kl" };
const PLANE_AXES: Record<string, [number, number, number]> = { hk0: [0, 1, 2], h0l: [0, 2, 1], "0kl": [1, 2, 0] }; // x, y, cut

export interface ViewContext {
  stage: string; // the view's stage output ("braggpunched", …)
  plane: string; // "hk0" | "h0l" | "0kl"
  cut: number; // r.l.u. along the fixed axis
  cutStep: number; // the grid's step along it
  sx: number; // display units per r.l.u. along the slice's x and y (2π/a)
  sy: number;
  lattice: Lattice;
  ub?: number[][];
  slice?: Slice; // the view's slice: its extent, and the punch holes
  before?: Slice; // the slice before the punch, at the same cut
}

export interface DrawnPeak {
  cls: ClassId;
  style: Style;
  X: number;
  Y: number;
  sigma: number;
}
export interface DrawnShell {
  cls: ClassId;
  style: Style;
  e: DisplayEllipse;
  tick?: "up" | "down";
}
export interface DrawnBand {
  cls: ClassId;
  style: Style;
  outer: DisplayEllipse | null; // null: the band reaches past this plane
  inner: DisplayEllipse | null;
}
export interface DrawnHatch {
  cls: ClassId;
  inside: DisplayEllipse | null; // hatched within (a beam stop)
  outside: DisplayEllipse | null; // hatched past; null: the whole plane lies past the counts
}
export interface DrawnPath {
  cls: ClassId;
  style: Style;
  d: string; // in r.l.u. (scale by sx, sy to display units)
}

export interface ViewDraw {
  peaks: DrawnPeak[];
  shells: DrawnShell[];
  bands: DrawnBand[];
  hatches: DrawnHatch[];
  paths: DrawnPath[];
  counts: Partial<Record<ClassId, number>>;
}

const EMPTY: ViewDraw = { peaks: [], shells: [], bands: [], hatches: [], paths: [], counts: {} };

// ---------------------------------------------------------------- the punch holes

export interface HoleTrace {
  d: string; // the holes' outline, voxel edges, in r.l.u.
  count: number; // separate holes (4-connected)
}

const holeCache = new WeakMap<Slice, WeakMap<object, HoleTrace>>();
const NO_BEFORE = {};

/**
 * The punch's holes on a slice: its NaN voxels the slice before the punch
 * holds (finite there), outlined along the voxel edges, and counted. Without
 * the slice before, every NaN voxel. Cached per pair of slices.
 */
export function traceHoles(slice: Slice, before?: Slice): HoleTrace {
  const key = before ?? NO_BEFORE;
  let byBefore = holeCache.get(slice);
  if (!byBefore) holeCache.set(slice, (byBefore = new WeakMap()));
  const hit = byBefore.get(key);
  if (hit) return hit;
  const { nx, ny, x_axis: xs, y_axis: ys } = slice.header;
  const same = before && before.header.nx === nx && before.header.ny === ny;
  const hole = new Uint8Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) hole[i] = !Number.isFinite(slice.data[i]) && (!same || Number.isFinite(before!.data[i])) ? 1 : 0;
  const dx = nx > 1 ? (xs[nx - 1] - xs[0]) / (nx - 1) : 1;
  const dy = ny > 1 ? (ys[ny - 1] - ys[0]) / (ny - 1) : 1;
  const ex = (i: number) => (xs[0] + (i - 0.5) * dx).toFixed(4); // the edge left of voxel i
  const ey = (j: number) => (ys[0] + (j - 0.5) * dy).toFixed(4);
  const parts: string[] = [];
  // Horizontal edges (between rows j-1 and j), merged along a row.
  for (let j = 0; j <= ny; j++) {
    let start = -1;
    for (let i = 0; i <= nx; i++) {
      const a = i < nx && j > 0 ? hole[(j - 1) * nx + i] : 0;
      const b = i < nx && j < ny ? hole[j * nx + i] : 0;
      const edge = i < nx && a !== b;
      if (edge && start < 0) start = i;
      if (!edge && start >= 0) {
        parts.push(`M${ex(start)} ${ey(j)}H${ex(i)}`);
        start = -1;
      }
    }
  }
  // Vertical edges (between columns i-1 and i), merged along a column.
  for (let i = 0; i <= nx; i++) {
    let start = -1;
    for (let j = 0; j <= ny; j++) {
      const a = j < ny && i > 0 ? hole[j * nx + i - 1] : 0;
      const b = j < ny && i < nx ? hole[j * nx + i] : 0;
      const edge = j < ny && a !== b;
      if (edge && start < 0) start = j;
      if (!edge && start >= 0) {
        parts.push(`M${ex(i)} ${ey(start)}V${ey(j)}`);
        start = -1;
      }
    }
  }
  // The holes, counted: 4-connected components, by a flood fill.
  let count = 0;
  const stack: number[] = [];
  for (let s = 0; s < nx * ny; s++) {
    if (hole[s] !== 1) continue;
    count += 1;
    hole[s] = 2;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const i = p % nx;
      const near = [i > 0 ? p - 1 : -1, i < nx - 1 ? p + 1 : -1, p - nx, p + nx];
      for (const q of near) {
        if (q >= 0 && q < nx * ny && hole[q] === 1) {
          hole[q] = 2;
          stack.push(q);
        }
      }
    }
  }
  const out = { d: parts.join(""), count };
  byBefore.set(key, out);
  return out;
}

// ---------------------------------------------------------------- the rest

/** Round 2's voxels on this cut, as squares a voxel wide, in r.l.u.; and how many. */
export function voxelsOnCut(hkl: readonly number[], plane: string, cut: number, cutStep: number, dx: number, dy: number): { d: string; count: number } {
  const [ix, iy, ic] = PLANE_AXES[plane] ?? [0, 1, 2];
  const tol = cutStep / 2 + 1e-9;
  const parts: string[] = [];
  for (let i = 0; i + 2 < hkl.length; i += 3) {
    if (Math.abs(hkl[i + ic] - cut) > tol) continue;
    const x = hkl[i + ix] - dx / 2;
    const y = hkl[i + iy] - dy / 2;
    parts.push(`M${x.toFixed(4)} ${y.toFixed(4)}h${dx.toFixed(4)}v${dy.toFixed(4)}h${(-dx).toFixed(4)}z`);
  }
  return { d: parts.join(""), count: parts.length };
}

/** Whether an ellipse crosses a display rectangle (sampled around it). */
function crosses(e: DisplayEllipse, b: { x0: number; x1: number; y0: number; y1: number }): boolean {
  const t = (e.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * 2 * Math.PI;
    const [u, v] = [e.rx * Math.cos(a), e.ry * Math.sin(a)];
    const X = e.cx + u * c - v * s;
    const Y = e.cy + u * s + v * c;
    if (X >= b.x0 && X <= b.x1 && Y >= b.y0 && Y <= b.y1) return true;
  }
  return false;
}

const drawCache = new WeakMap<OverlaySet, Map<string, { slice?: Slice; before?: Slice; lattice: Lattice; out: ViewDraw }>>();

/** The set on one view: what it draws there, and how many of each class. Cached per set, view, cut and slices. */
export function viewDraw(set: OverlaySet, v: ViewContext): ViewDraw {
  let bySet = drawCache.get(set);
  if (!bySet) drawCache.set(set, (bySet = new Map()));
  const key = `${v.stage}|${v.plane}|${v.cut}|${v.cutStep}|${v.sx}|${v.sy}`;
  const hit = bySet.get(key);
  if (hit && hit.slice === v.slice && hit.before === v.before && hit.lattice === v.lattice) return hit.out;
  const out = computeDraw(set, v);
  bySet.set(key, { slice: v.slice, before: v.before, lattice: v.lattice, out });
  return out;
}

function computeDraw(set: OverlaySet, v: ViewContext): ViewDraw {
  const styleOf = new Map(set.classes.map((c) => [c.id, c.views[v.stage]] as const));
  if (![...styleOf.values()].some(Boolean)) return EMPTY;
  const out: ViewDraw = { peaks: [], shells: [], bands: [], hatches: [], paths: [], counts: {} };
  const add = (cls: ClassId, n = 1) => (out.counts[cls] = (out.counts[cls] ?? 0) + n);
  const plane = PLANE_ID[v.plane];
  const xs = v.slice?.header.x_axis ?? [];
  const ys = v.slice?.header.y_axis ?? [];
  // The slice's extent in display units: what is drawn, and counted, is on it.
  const box = xs.length && ys.length
    ? { x0: Math.min(xs[0], xs[xs.length - 1]) * v.sx, x1: Math.max(xs[0], xs[xs.length - 1]) * v.sx, y0: Math.min(ys[0], ys[ys.length - 1]) * v.sy, y1: Math.max(ys[0], ys[ys.length - 1]) * v.sy }
    : null;
  const shell = (q: number): DisplayEllipse | null => (plane ? qShellEllipseForPlane(plane, q, v.lattice, v.ub, v.cut) : null);
  const tol = v.cutStep / 2 + 1e-9;
  const peaks: DrawnPeak[] = [];
  for (const item of set.items) {
    const style = styleOf.get(item.cls);
    if (!style) continue;
    switch (item.kind) {
      case "peak": {
        if (item.plane !== v.plane || Math.abs(item.cut - v.cut) > tol) break;
        const X = item.x * v.sx;
        const Y = item.y * v.sy;
        if (box && (X < box.x0 || X > box.x1 || Y < box.y0 || Y > box.y1)) break;
        peaks.push({ cls: item.cls, style, X, Y, sigma: item.sigma });
        break;
      }
      case "shell": {
        const e = shell(item.q);
        if (!e || (box && !crosses(e, box))) break;
        out.shells.push({ cls: item.cls, style, e, ...(item.tick ? { tick: item.tick } : {}) });
        add(item.cls);
        break;
      }
      case "band": {
        const outer = shell(item.q1);
        const inner = shell(item.q0);
        if (!outer && !inner) break; // the plane lies past the band
        out.bands.push({ cls: item.cls, style, outer, inner });
        add(item.cls);
        break;
      }
      case "hatch": {
        out.hatches.push({ cls: item.cls, inside: item.inside != null ? shell(item.inside) : null, outside: shell(item.outside) });
        add(item.cls);
        break;
      }
      case "holes": {
        if (!v.slice) break;
        const t = traceHoles(v.slice, v.before);
        if (t.count) out.paths.push({ cls: item.cls, style, d: t.d });
        add(item.cls, t.count);
        break;
      }
      case "voxels": {
        const dx = xs.length > 1 ? Math.abs(xs[xs.length - 1] - xs[0]) / (xs.length - 1) : 0.01;
        const dy = ys.length > 1 ? Math.abs(ys[ys.length - 1] - ys[0]) / (ys.length - 1) : 0.01;
        const r = voxelsOnCut(item.hkl, v.plane, v.cut, v.cutStep, dx, dy);
        if (r.count) out.paths.push({ cls: item.cls, style, d: r.d });
        add(item.cls, r.count);
        break;
      }
    }
  }
  // The strongest peaks, up to the cap, less what the shells and paths already draw.
  peaks.sort((a, b) => b.sigma - a.sigma);
  out.peaks = peaks.slice(0, Math.max(0, MAX_PRIMITIVES - out.shells.length - out.bands.length - out.paths.length));
  for (const p of out.peaks) add(p.cls);
  return out;
}

/** The legend's counts: each class's on the first view where it draws in full. */
export function legendCounts(set: OverlaySet, draws: Record<string, ViewDraw | undefined>): Partial<Record<ClassId, number>> {
  const counts: Partial<Record<ClassId, number>> = {};
  for (const c of set.classes) {
    const stage = Object.entries(c.views).find(([st, style]) => style === "full" && draws[st])?.[0];
    const n = stage ? draws[stage]?.counts[c.id] : undefined;
    counts[c.id] = n ?? 0;
  }
  return counts;
}
