// An overlay set (overlays.ts) on one view: a stage's on the cleanup page, a
// tile of the Bragg page, a section of the 3D-ΔPDF page. What it draws there,
// in display units (the view's slice through its geometry: Å⁻¹ on the cleanup
// page, r.l.u. on the Bragg page, Å on the ΔPDF's), and how many of each class. Computed once per set, view, cut and slice, and
// cached: panning and zooming only re-project it (HighlightLayer), so no frame
// recomputes anything. The punch holes are traced from the slice's own NaN
// voxels, against the slice before the punch (a hole there was no coverage,
// not the punch), once per pair of slices.

import type { Lattice, Slice } from "../../api/types";
import { fittedEllipse } from "../../components/braggView";
import { qShellEllipseForPlane, type DisplayEllipse } from "../../components/punchGeometry";
import { extentBounds, sliceToDisplay, type SliceGeom } from "../../components/viewport";
import type { PunchPlane } from "../../state/pipelineStore";
import { inv3 } from "./linalg";
import type { ClassId, OverlaySet, Style } from "./overlays";

/** At most this many primitives a view draws: the strongest peaks first (design §3.4). */
export const MAX_PRIMITIVES = 400;

// The cleanup page's planes ("0kl" …) as the punch geometry names them ("kl" …), and their axes' indices.
const PLANE_ID: Record<string, PunchPlane> = { hk0: "hk", h0l: "hl", "0kl": "kl" };
// x, y, cut: the reciprocal planes (the cleanup page, the Bragg page's tiles) and the ΔPDF's sections.
const PLANE_AXES: Record<string, [number, number, number]> = {
  hk0: [0, 1, 2],
  h0l: [0, 2, 1],
  "0kl": [1, 2, 0],
  xy: [0, 1, 2],
  xz: [0, 2, 1],
  yz: [1, 2, 0],
};
// At most this many labels a view writes (the largest marks'), and lattice nodes it tries.
const MAX_LABELS = 8;
const MAX_NODES = 20000;

export interface ViewContext {
  stage: string; // the view's stage output ("braggpunched", …), or the page's (BRAGG, DPDF)
  plane: string; // "hk0" | "h0l" | "0kl"; on the ΔPDF "xy" | "xz" | "yz"
  cut: number; // along the plane's fixed axis (r.l.u.; Å on the ΔPDF)
  cutStep: number; // the grid's step along it
  sx: number; // display units per slice unit along the slice's x and y (2π/a on the cleanup page; 1 elsewhere)
  sy: number;
  angle?: number; // the angle between the slice's axes (deg, default 90)
  lattice?: Lattice; // for the |Q| shells (the reciprocal pages)
  ub?: number[][];
  slice?: Slice; // the view's slice: its extent, and the punch holes
  before?: Slice; // the slice before the punch, at the same cut
}

export interface DrawnPeak {
  cls: ClassId;
  style: Style;
  X: number;
  Y: number;
  sigma: number; // orders them (the strongest first) and sizes a spot
  label?: string;
}
export interface DrawnEllipse {
  cls: ClassId;
  style: Style;
  e: DisplayEllipse;
  label?: string;
}
export interface DrawnArrow {
  cls: ClassId;
  style: Style;
  X: number; // from (display units)
  Y: number;
  dX: number; // to, less from, scaled up (ViewDraw.notes says by how much)
  dY: number;
  dZ: number; // the part along the cut's axis, scaled as much (+: out of the view)
}
export interface DrawnLine {
  cls: ClassId;
  style: Style;
  X0: number;
  Y0: number;
  X1: number;
  Y1: number;
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
  ellipses?: DrawnEllipse[];
  arrows?: DrawnArrow[];
  lines?: DrawnLine[];
  // A class's word on its chip (the arrows' scale), and what each class drew,
  // by name, so a page of several views counts each thing once.
  notes?: Partial<Record<ClassId, string>>;
  keys?: Partial<Record<ClassId, string[]>>;
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

const drawCache = new WeakMap<OverlaySet, Map<string, { slice?: Slice; before?: Slice; lattice?: Lattice; out: ViewDraw }>>();

/** The set on one view: what it draws there, and how many of each class. Cached per set, view, cut and slices. */
export function viewDraw(set: OverlaySet, v: ViewContext): ViewDraw {
  let bySet = drawCache.get(set);
  if (!bySet) drawCache.set(set, (bySet = new Map()));
  const key = `${v.stage}|${v.plane}|${v.cut}|${v.cutStep}|${v.sx}|${v.sy}|${v.angle ?? 90}`;
  const hit = bySet.get(key);
  if (hit && hit.slice === v.slice && hit.before === v.before && hit.lattice === v.lattice) return hit.out;
  const out = computeDraw(set, v);
  bySet.set(key, { slice: v.slice, before: v.before, lattice: v.lattice, out });
  return out;
}

// ---------------------------------------------------------------- v2 geometry

type V3 = [number, number, number];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mv = (m: number[][], v: readonly number[]): V3 => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as V3;

/** The ellipse a 2×2 linear map (columns: the slice's x and y in display units) makes of one in slice units (`angle` y-down, as fittedEllipse gives it). */
export function mapEllipse(cx: number, cy: number, rx: number, ry: number, angleDown: number, g: SliceGeom): DisplayEllipse {
  const phi = (-angleDown * Math.PI) / 180;
  // E: the ellipse's half-axes as columns, in slice units; then through the slice's geometry.
  const e1 = [rx * Math.cos(phi), rx * Math.sin(phi)];
  const e2 = [-ry * Math.sin(phi), ry * Math.cos(phi)];
  const L = (x: number, y: number) => sliceToDisplay(x, y, g);
  const [a, c] = L(e1[0], e1[1]);
  const [b, d] = L(e2[0], e2[1]);
  // M = [[a, b], [c, d]]: its singular values and left vectors are the image's half-axes.
  const p = a * a + b * b, q = c * c + d * d, r = a * c + b * d;
  const root = Math.sqrt(((p - q) / 2) ** 2 + r * r);
  const l1 = (p + q) / 2 + root, l2 = Math.max(0, (p + q) / 2 - root);
  const theta = 0.5 * Math.atan2(2 * r, p - q);
  const [X, Y] = L(cx, cy);
  return { cx: X, cy: Y, rx: Math.sqrt(l1), ry: Math.sqrt(l2), angle: (theta * 180) / Math.PI };
}

/** A 1-2-5 step at or under x (x > 0). */
const niceFloor = (x: number): number => {
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
};

// ---------------------------------------------------------------- the draw

function computeDraw(set: OverlaySet, v: ViewContext): ViewDraw {
  const styleOf = new Map(set.classes.map((c) => [c.id, c.views[v.stage]] as const));
  if (![...styleOf.values()].some(Boolean)) return EMPTY;
  const out: ViewDraw = { peaks: [], shells: [], bands: [], hatches: [], paths: [], counts: {} };
  const add = (cls: ClassId, n = 1) => (out.counts[cls] = (out.counts[cls] ?? 0) + n);
  const keys: Partial<Record<ClassId, string[]>> = {};
  const keyed = (cls: ClassId, k: string) => (keys[cls] ??= []).push(k);
  const plane = PLANE_ID[v.plane];
  const [ix, iy, ic] = PLANE_AXES[v.plane] ?? [0, 1, 2];
  const g: SliceGeom = { sx: v.sx, sy: v.sy, angle: v.angle ?? 90 };
  const xs = v.slice?.header.x_axis ?? [];
  const ys = v.slice?.header.y_axis ?? [];
  // The slice's extent in display units: what is drawn, and counted, is on it.
  const box = xs.length && ys.length ? extentBounds({ x_axis: xs, y_axis: ys }, g) : null;
  const inBox = (X: number, Y: number) => !box || (X >= box.x0 && X <= box.x1 && Y >= box.y0 && Y <= box.y1);
  // The slice's extent in its own units.
  const lim = xs.length && ys.length ? { x0: Math.min(xs[0], xs[xs.length - 1]), x1: Math.max(xs[0], xs[xs.length - 1]), y0: Math.min(ys[0], ys[ys.length - 1]), y1: Math.max(ys[0], ys[ys.length - 1]) } : null;
  const shell = (q: number): DisplayEllipse | null => (plane && v.lattice ? qShellEllipseForPlane(plane, q, v.lattice, v.ub, v.cut) : null);
  const tol = v.cutStep / 2 + 1e-9;
  // The peaks and spots, each with its name where it has one (for the legend's counts).
  const peaks: { p: DrawnPeak; key?: string }[] = [];
  const ellipses: DrawnEllipse[] = [];
  const arrows: DrawnArrow[] = [];
  const lines: DrawnLine[] = [];
  for (const item of set.items) {
    const style = styleOf.get(item.cls);
    if (!style) continue;
    switch (item.kind) {
      case "peak": {
        if (item.plane !== v.plane || Math.abs(item.cut - v.cut) > tol) break;
        const [X, Y] = sliceToDisplay(item.x, item.y, g);
        if (!inBox(X, Y)) break;
        peaks.push({ p: { cls: item.cls, style, X, Y, sigma: item.sigma } });
        break;
      }
      case "spot": {
        if (Math.abs(item.at[ic] - v.cut) > v.cutStep * (item.tolVoxels ?? 0.5) + 1e-9) break;
        const [X, Y] = sliceToDisplay(item.at[ix], item.at[iy], g);
        if (!inBox(X, Y)) break;
        peaks.push({ p: { cls: item.cls, style, X, Y, sigma: item.size, ...(item.label ? { label: item.label } : {}) }, key: item.at.join(",") });
        break;
      }
      case "footprint": {
        // On the cut while it passes within the fit's width along the cut's axis.
        if (Math.abs(item.at[ic] - v.cut) > Math.max(tol, Math.abs(item.widths[ic]))) break;
        const fit = fittedEllipse({ principal_directions_hkl: item.dirs ?? [], principal_width_hkl: item.principal ?? undefined, width_hkl: item.widths } as Parameters<typeof fittedEllipse>[0], ix, iy);
        const e = mapEllipse(item.at[ix], item.at[iy], fit.rx, fit.ry, fit.angle ?? 0, g);
        if (!inBox(e.cx, e.cy)) break;
        ellipses.push({ cls: item.cls, style, e, ...(item.label ? { label: item.label } : {}) });
        add(item.cls);
        keyed(item.cls, item.at.join(","));
        break;
      }
      case "turn": {
        if (!lim) break;
        const inv = inv3(item.ub);
        const [cx, cy, cc] = [item.cell[ix], item.cell[iy], item.cell[ic]];
        if (!inv || !(cx > 0 && cy > 0 && cc > 0)) break;
        // The nodes lie on this cut only where it is a node plane.
        const m = Math.round(v.cut / cc);
        if (Math.abs(m * cc - v.cut) > tol) break;
        const i0 = Math.ceil(lim.x0 / cx), i1 = Math.floor(lim.x1 / cx);
        const j0 = Math.ceil(lim.y0 / cy), j1 = Math.floor(lim.y1 / cy);
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_NODES) break;
        const raw: { X: number; Y: number; dx: number; dy: number; dz: number; key: string }[] = [];
        // The cut's axis in display units per its own unit: the in-plane axes' mean scale.
        const sz = (v.sx + v.sy) / 2;
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++) {
            const h = [0, 0, 0];
            h[ix] = i * cx;
            h[iy] = j * cy;
            h[ic] = m * cc;
            if (!h[0] && !h[1] && !h[2]) continue;
            // ω × Q, back to H K L through the volume's UB.
            const dh = mv(inv, cross(item.omega, mv(item.ub, h)));
            const [X, Y] = sliceToDisplay(h[ix], h[iy], g);
            const [dX, dY] = sliceToDisplay(dh[ix], dh[iy], { ...g });
            raw.push({ X, Y, dx: dX, dy: dY, dz: dh[ic] * sz, key: h.join(",") });
          }
        // Scaled by the whole shift, in the plane and across it: a turn about
        // an axis in the plane moves its nodes out of it, and is drawn so.
        const len = (a: (typeof raw)[number]) => Math.hypot(a.dx, a.dy, a.dz);
        const longest = Math.max(0, ...raw.map(len));
        if (!(longest > 0)) break;
        // Scaled so the longest is about a third of the node spacing, by a round factor.
        const spacing = Math.min(Math.hypot(...sliceToDisplay(cx, 0, g)), Math.hypot(...sliceToDisplay(0, cy, g)));
        const k = niceFloor((0.35 * spacing) / longest);
        raw.sort((a, b) => len(b) - len(a));
        for (const a of raw) {
          arrows.push({ cls: item.cls, style, X: a.X, Y: a.Y, dX: a.dx * k, dY: a.dy * k, dZ: a.dz * k });
          keyed(item.cls, a.key);
        }
        out.notes = { ...out.notes, [item.cls]: `×${k >= 1 ? Math.round(k) : Number(k.toPrecision(1))}` };
        break;
      }
      case "lattice": {
        if (!lim) break;
        // The nodes n whose H K L (map · n) lie within a voxel of the cut, on the slice.
        const span = Math.max(Math.abs(lim.x0), Math.abs(lim.x1), Math.abs(lim.y0), Math.abs(lim.y1), Math.abs(v.cut)) + 1;
        const cols = [0, 1, 2].map((j) => Math.hypot(item.map[0][j], item.map[1][j], item.map[2][j]));
        const n = Math.ceil(span / Math.max(1e-6, Math.min(...cols)));
        if ((2 * n + 1) ** 3 > 50 * MAX_NODES) break;
        for (let a = -n; a <= n; a++)
          for (let b = -n; b <= n; b++)
            for (let c = -n; c <= n; c++) {
              if (!a && !b && !c) continue;
              const h = mv(item.map, [a, b, c]);
              if (Math.abs(h[ic] - v.cut) > v.cutStep + 1e-9) continue;
              const [X, Y] = sliceToDisplay(h[ix], h[iy], g);
              if (!inBox(X, Y)) continue;
              peaks.push({ p: { cls: item.cls, style, X, Y, sigma: 0 }, key: `${a},${b},${c}` });
            }
        break;
      }
      case "line": {
        if (!lim) break;
        // On this plane when it runs along one of its axes, at its cut.
        if (Math.abs(item.through[ic] - v.cut) > tol || (item.along !== ix && item.along !== iy)) break;
        const alongX = item.along === ix;
        const at = alongX ? item.through[iy] : item.through[ix];
        if (alongX ? at < lim.y0 || at > lim.y1 : at < lim.x0 || at > lim.x1) break;
        const [X0, Y0] = alongX ? sliceToDisplay(lim.x0, at, g) : sliceToDisplay(at, lim.y0, g);
        const [X1, Y1] = alongX ? sliceToDisplay(lim.x1, at, g) : sliceToDisplay(at, lim.y1, g);
        lines.push({ cls: item.cls, style, X0, Y0, X1, Y1 });
        add(item.cls);
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
      default:
        exhaustive(item);
    }
  }
  // The strongest peaks, up to the cap, less what the rest already draws; the largest labelled.
  const room = Math.max(0, MAX_PRIMITIVES - out.shells.length - out.bands.length - out.paths.length - ellipses.length - lines.length);
  peaks.sort((a, b) => b.p.sigma - a.p.sigma);
  const kept = peaks.slice(0, room);
  let labels = 0;
  out.peaks = kept.map(({ p, key }) => {
    add(p.cls);
    if (key !== undefined) keyed(p.cls, key);
    if (!p.label) return p;
    labels += 1;
    if (labels <= MAX_LABELS) return p;
    const { label, ...rest } = p;
    void label;
    return rest;
  });
  if (ellipses.length) out.ellipses = ellipses.slice(0, MAX_LABELS * 50);
  if (arrows.length) {
    out.arrows = arrows.slice(0, Math.max(0, room - out.peaks.length));
    // The arrows count as drawn.
    add(arrows[0].cls, out.arrows.length);
    keys[arrows[0].cls] = keys[arrows[0].cls]?.slice(0, out.arrows.length);
  }
  if (lines.length) out.lines = lines;
  if (Object.keys(keys).length) out.keys = keys;
  return out;
}

const exhaustive = (x: never): never => x;

/** A page's views: each its stage and what it draws (a page may show one stage in several views). */
export type PageDraws = Record<string, ViewDraw | undefined> | { stage: string; draw: ViewDraw | undefined }[];

/**
 * The legend's counts: each class's over the views where it draws in full,
 * each thing once (by name, where it has one), else on the first such view;
 * and its word (the arrows' scale), the first such view's.
 */
export function legendCounts(set: OverlaySet, draws: PageDraws): Partial<Record<ClassId, number>> {
  return legend(set, draws).counts;
}

export function legend(set: OverlaySet, draws: PageDraws): { counts: Partial<Record<ClassId, number>>; notes: Partial<Record<ClassId, string>> } {
  const list = Array.isArray(draws) ? draws : Object.entries(draws).map(([stage, draw]) => ({ stage, draw }));
  const counts: Partial<Record<ClassId, number>> = {};
  const notes: Partial<Record<ClassId, string>> = {};
  for (const c of set.classes) {
    const full = list.filter((x) => x.draw && c.views[x.stage] === "full").map((x) => x.draw!);
    const named = full.filter((d) => d.keys?.[c.id]);
    counts[c.id] = named.length ? new Set(named.flatMap((d) => d.keys![c.id]!)).size : (full[0]?.counts[c.id] ?? 0);
    const note = full.find((d) => d.notes?.[c.id])?.notes?.[c.id];
    if (note) notes[c.id] = note;
  }
  return { counts, notes };
}

