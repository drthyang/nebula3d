// The punch footprints the Configure page's preview draws over a slice, in
// the slice's display units (Å⁻¹: X = h·2π/a, as SliceCanvas and ViewFrame
// draw reciprocal slices), and their mapping to the view's pixels.
//
// The punch has a single method today (the anisotropic ellipsoid), in one of
// two frames: "spherical" (rρ, rθ, rφ about each node's Q̂, rebuilt per node,
// mirroring `BraggRemover._spherical_shape_matrix`) or "q" (fixed a*, b*, c*
// axes through the UB). The direct beam is an origin-centred ellipsoid along
// a*, b*, c*; the |Q| band is drawn as its true contour on the plane
// (components/reciprocal.ts).

import type { Lattice } from "../api/types";
import type { PunchPlane } from "../state/pipelineStore";
import { metricFromUb, qContour, qSection, reciprocalMetric, type Ellipse } from "./reciprocal";
import { displayToPixel, visibleBounds, type Viewport } from "./viewport";

export type HklAxis = "H" | "K" | "L";

export const PUNCH_PLANES: {
  id: PunchPlane;
  title: string;
  xl: string;
  yl: string;
  cutAxis: HklAxis;
  cutLabel: string;
}[] = [
  { id: "hk", title: "a*–b*", xl: "a*", yl: "b*", cutAxis: "L", cutLabel: "c*" },
  { id: "hl", title: "a*–c*", xl: "a*", yl: "c*", cutAxis: "K", cutLabel: "b*" },
  { id: "kl", title: "b*–c*", xl: "b*", yl: "c*", cutAxis: "H", cutLabel: "a*" },
];

export interface PunchGeom {
  // r0/r1/r2 are the Q-space footprint half-radii along a*, b*, c* in Å⁻¹.
  r0: number;
  r1: number;
  r2: number;
  // Punch ellipsoid frame: "spherical" (rρ,rθ,rφ, default) | "q" (a*,b*,c*).
  frame: string;
  // Spherical-frame radii (Å⁻¹): rρ radial, rθ polar, rφ azimuth.
  sphRadii: [number, number, number];
  margin: number;
  mode: string;
  // Supercell the volume is indexed on (H, K, L): Bragg nodes are the
  // parent lattice's, the multiples of these.
  supercell: [number, number, number];
  isQ: boolean;
  unit: string;
  ax: [string, string, string]; // axis labels, e.g. [H,K,L] or [a*,b*,c*]
  directBeamRadiiQ: [number, number, number];
  directBeamMargin: number;
}

export function planeHklAxes(p: PunchPlane): [HklAxis, HklAxis] {
  if (p === "hk") return ["H", "K"];
  if (p === "hl") return ["H", "L"];
  return ["K", "L"];
}

export type LatticeLike = Lattice; // a, b, c (Å) and, when known, α, β, γ (°)
export type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]];

export function axisLattice(axis: HklAxis, lattice?: LatticeLike): number | null | undefined {
  if (axis === "H") return lattice?.a;
  if (axis === "K") return lattice?.b;
  return lattice?.c;
}

export function axisIndex(axis: HklAxis): number {
  if (axis === "H") return 0;
  if (axis === "K") return 1;
  return 2;
}

export function axisRadiusQ(axis: HklAxis, geom: PunchGeom, lattice?: LatticeLike): number {
  const idx = axisIndex(axis);
  const r = idx === 0 ? geom.r0 : idx === 1 ? geom.r1 : geom.r2;
  if (geom.isQ) return r;
  const lat = axisLattice(axis, lattice);
  return lat ? r * (2 * Math.PI / lat) : r;
}

export function asMatrix3(raw?: number[][]): Matrix3 | null {
  if (!raw || raw.length !== 3 || raw.some((row) => row.length !== 3)) return null;
  if (raw.some((row) => row.some((v) => !Number.isFinite(v)))) return null;
  return raw as Matrix3;
}

export function qShapeMatrix(geom: PunchGeom, ubRaw?: number[][]): Matrix3 | null {
  const ub = asMatrix3(ubRaw);
  if (!ub) return null;
  const radii = [geom.r0, geom.r1, geom.r2];
  if (radii.some((r) => r <= 0 || !Number.isFinite(r))) return null;
  const unit: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let col = 0; col < 3; col++) {
    const norm = Math.hypot(ub[0][col], ub[1][col], ub[2][col]);
    if (norm <= 0 || !Number.isFinite(norm)) return null;
    for (let row = 0; row < 3; row++) unit[row][col] = ub[row][col] / norm;
  }

  const p: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      p[i][j] = unit[0][i] * ub[0][j] + unit[1][i] * ub[1][j] + unit[2][i] * ub[2][j];
    }
  }

  const a: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let j = 0; j < 3; j++) {
    for (let k = 0; k < 3; k++) {
      let value = 0;
      for (let i = 0; i < 3; i++) value += p[i][j] * (1 / (radii[i] * radii[i])) * p[i][k];
      a[j][k] = value;
    }
  }
  return a;
}

export function ellipseFromQuadratic(
  a00: number,
  a01: number,
  a11: number,
  fallback: { rx: number; ry: number; angle: number },
): { rx: number; ry: number; angle: number } {
  if (![a00, a01, a11].every(Number.isFinite)) return fallback;
  const trace = a00 + a11;
  const root = Math.hypot(a00 - a11, 2 * a01);
  const lambdaMin = (trace - root) / 2;
  const lambdaMax = (trace + root) / 2;
  if (lambdaMin <= 0 || lambdaMax <= 0) return fallback;

  let vx: number;
  let vy: number;
  if (Math.abs(a01) > 1e-12) {
    vx = a01;
    vy = lambdaMin - a00;
  } else if (a00 <= a11) {
    vx = 1;
    vy = 0;
  } else {
    vx = 0;
    vy = 1;
  }
  const norm = Math.hypot(vx, vy) || 1;
  const angle = Math.atan2(vy / norm, vx / norm) * 180 / Math.PI;
  return { rx: 1 / Math.sqrt(lambdaMin), ry: 1 / Math.sqrt(lambdaMax), angle };
}

export function qEllipseForPlane(
  plane: PunchPlane,
  geom: PunchGeom,
  lattice: LatticeLike,
  ubMatrix?: number[][],
): { rx: number; ry: number; angle: number } {
  const [axisX, axisY] = planeHklAxes(plane);
  const latX = axisLattice(axisX, lattice) ?? 1;
  const latY = axisLattice(axisY, lattice) ?? 1;
  const qScaleX = 2 * Math.PI / latX;
  const qScaleY = 2 * Math.PI / latY;
  const fallback = {
    rx: axisRadiusQ(axisX, geom, lattice),
    ry: axisRadiusQ(axisY, geom, lattice),
    angle: 0,
  };
  const shape = qShapeMatrix(geom, ubMatrix);
  if (!shape) return fallback;
  const ix = axisIndex(axisX);
  const iy = axisIndex(axisY);
  return ellipseFromQuadratic(
    shape[ix][ix] / (qScaleX * qScaleX),
    shape[ix][iy] / (qScaleX * qScaleY),
    shape[iy][iy] / (qScaleY * qScaleY),
    fallback,
  );
}

// --- spherical frame (rρ, rθ, rφ) -----------------------------------------
// The punch ellipsoid axes follow the *local* spherical frame at each peak, so
// the shape matrix is rebuilt per Bragg node from its Q direction (unlike the
// global a*/b*/c* q-frame).  Mirrors `BraggRemover._spherical_shape_matrix`.

export function nodeFullHkl(plane: PunchPlane, x: number, y: number, cut: number): [number, number, number] {
  if (plane === "hk") return [x, y, cut];
  if (plane === "hl") return [x, cut, y];
  return [cut, x, y]; // kl
}

const cross = (a: number[], b: number[]): number[] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (v: number[]) => Math.hypot(v[0], v[1], v[2]);

// HKL shape matrix A (δhklᵀAδhkl ≤ 1) for the spherical punch at one node.
export function sphShapeMatrixHkl(
  radii: [number, number, number],
  hkl: [number, number, number],
  ub: Matrix3,
): Matrix3 | null {
  if (radii.some((r) => !(r > 0))) return null;
  const col = (j: number) => [ub[0][j], ub[1][j], ub[2][j]];
  const q = [
    ub[0][0] * hkl[0] + ub[0][1] * hkl[1] + ub[0][2] * hkl[2],
    ub[1][0] * hkl[0] + ub[1][1] * hkl[1] + ub[1][2] * hkl[2],
    ub[2][0] * hkl[0] + ub[2][1] * hkl[1] + ub[2][2] * hkl[2],
  ];
  const nq = norm3(q);
  if (!(nq > 0)) return null;
  const rho = q.map((v) => v / nq);
  const zc = col(2);
  const zn = norm3(zc);
  const zhat = zn > 0 ? zc.map((v) => v / zn) : [0, 0, 1];
  let phi = cross(zhat, rho);
  if (norm3(phi) < 1e-8) {
    const a = col(0);
    const an = norm3(a) || 1;
    phi = cross(a.map((v) => v / an), rho);
  }
  const pn = norm3(phi) || 1;
  const phiHat = phi.map((v) => v / pn);
  const theta = cross(phiHat, rho);
  // A_Q = R diag(1/r²) Rᵀ, R columns ρ̂, θ̂, φ̂
  const R = [rho, theta, phiHat]; // R[axis] = column vector
  const inv = radii.map((r) => 1 / (r * r));
  const aQ: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      aQ[i][j] = inv[0] * R[0][i] * R[0][j] + inv[1] * R[1][i] * R[1][j] + inv[2] * R[2][i] * R[2][j];
  // A_hkl = UBᵀ A_Q UB
  const tmp: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      tmp[i][j] = aQ[i][0] * ub[0][j] + aQ[i][1] * ub[1][j] + aQ[i][2] * ub[2][j];
  const aHkl: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      aHkl[i][j] = ub[0][i] * tmp[0][j] + ub[1][i] * tmp[1][j] + ub[2][i] * tmp[2][j];
  return aHkl;
}

// Per-node punch ellipse: spherical → rebuilt from the node's Q; otherwise the
// shared global q-frame ellipse.
export function ellipseForNode(
  plane: PunchPlane,
  geom: PunchGeom,
  globalEllipse: { rx: number; ry: number; angle: number },
  lattice: LatticeLike,
  ubRaw: number[][] | undefined,
  x: number,
  y: number,
  cut: number,
): { rx: number; ry: number; angle: number } {
  if (geom.frame !== "spherical") return globalEllipse;
  const ub = asMatrix3(ubRaw);
  if (!ub) return globalEllipse;
  const m = Math.max(0, geom.margin);
  const radii: [number, number, number] = [
    geom.sphRadii[0] + m,
    geom.sphRadii[1] + m,
    geom.sphRadii[2] + m,
  ];
  const a = sphShapeMatrixHkl(radii, nodeFullHkl(plane, x, y, cut), ub);
  if (!a) return globalEllipse;
  const [axisX, axisY] = planeHklAxes(plane);
  const ix = axisIndex(axisX);
  const iy = axisIndex(axisY);
  const qScaleX = (2 * Math.PI) / (axisLattice(axisX, lattice) ?? 1);
  const qScaleY = (2 * Math.PI) / (axisLattice(axisY, lattice) ?? 1);
  return ellipseFromQuadratic(
    a[ix][ix] / (qScaleX * qScaleX),
    a[ix][iy] / (qScaleX * qScaleY),
    a[iy][iy] / (qScaleY * qScaleY),
    globalEllipse,
  );
}

// |Q| = R boundary on a plane, in the same physical-Å⁻¹ overlay coordinates as
// the Bragg footprint (X = h·2π/a, …).  Under the reciprocal metric (from the
// UB, else the cell) the locus is an ellipse: tilted for oblique lattices,
// centred on the plane's point nearest the origin for an off-origin cut — off
// the origin where the cut axis is not normal to the plane — and a circle about
// the origin for orthogonal cells.  See components/reciprocal.ts.
export function qShellEllipseForPlane(
  plane: PunchPlane,
  radiusQ: number,
  lattice: LatticeLike,
  ubMatrix?: number[][],
  cut = 0,
): Ellipse | null {
  if (!(radiusQ > 0)) return null;
  const [axisX, axisY] = planeHklAxes(plane);
  const qScaleX = (2 * Math.PI) / (axisLattice(axisX, lattice) ?? 1);
  const qScaleY = (2 * Math.PI) / (axisLattice(axisY, lattice) ?? 1);
  const G = metricFromUb(ubMatrix) ?? reciprocalMetric(lattice);
  if (!G) return null;
  const sec = qSection(G, axisIndex(axisX), axisIndex(axisY), cut, qScaleX, qScaleY);
  return sec ? qContour(sec, radiusQ) : null;
}

export function axisRange(
  meta: {
    h_range: [number, number];
    k_range: [number, number];
    l_range: [number, number];
    shape: number[];
  } | null | undefined,
  axis: HklAxis,
): { min: number; max: number; step: number } {
  if (!meta) return { min: -1, max: 1, step: 0.01 };
  const idx = axis === "H" ? 0 : axis === "K" ? 1 : 2;
  const [min, max] = axis === "H" ? meta.h_range : axis === "K" ? meta.k_range : meta.l_range;
  const n = meta.shape[idx] ?? 1;
  return { min, max, step: n > 1 ? Math.abs(max - min) / (n - 1) : 0.01 };
}

// ---------------------------------------------------------------------------
// In the view's pixels
// ---------------------------------------------------------------------------

/** An ellipse in display units: centre, half-axes, and its tilt in degrees counter-clockwise (y up). */
export interface DisplayEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
}

/**
 * The ellipse as a `w`×`h`-px view of `v` draws it: centre through the
 * viewport (y down), half-axes at its one scale, and the tilt mirrored, since
 * the pixel y axis points down (an SVG rotate(angle') with angle' = −angle).
 */
export function ellipseToPixels(e: DisplayEllipse, v: Viewport, w: number, h: number): DisplayEllipse {
  const [cx, cy] = displayToPixel(v, e.cx, e.cy, w, h);
  const s = (Math.min(w, h) || 1) / (2 * v.half);
  const angle = e.angle ? -e.angle : 0;
  return { cx, cy, rx: e.rx * s, ry: e.ry * s, angle };
}

/**
 * The Bragg nodes (integer x, y in r.l.u., multiples of the punch cell along
 * each axis) a view shows, with a margin of `pad` r.l.u. past its edges, on
 * the slice's extent only. Null when there would be more than `max` (the view
 * is zoomed out so far that each footprint is a few pixels).
 */
export function visibleNodes({
  viewport,
  w,
  h,
  qScaleX,
  qScaleY,
  extentX,
  extentY,
  cell = [1, 1],
  pad = 1,
  max = 5000,
}: {
  viewport: Viewport;
  w: number;
  h: number;
  qScaleX: number; // Å⁻¹ per r.l.u. along x
  qScaleY: number;
  extentX: [number, number]; // the slice's x range (r.l.u.)
  extentY: [number, number];
  cell?: [number, number];
  pad?: number;
  max?: number;
}): { x: number; y: number }[] | null {
  const b = visibleBounds(viewport, w, h);
  const x0 = Math.max(Math.min(...extentX), b.x0 / qScaleX - pad);
  const x1 = Math.min(Math.max(...extentX), b.x1 / qScaleX + pad);
  const y0 = Math.max(Math.min(...extentY), b.y0 / qScaleY - pad);
  const y1 = Math.min(Math.max(...extentY), b.y1 / qScaleY + pad);
  const [cx, cy] = [Math.max(1, Math.round(cell[0])), Math.max(1, Math.round(cell[1]))];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = Math.ceil(x0 / cx) * cx; x <= x1; x += cx) xs.push(x);
  for (let y = Math.ceil(y0 / cy) * cy; y <= y1; y += cy) ys.push(y);
  if (xs.length * ys.length > max) return null;
  const out: { x: number; y: number }[] = [];
  for (const x of xs) for (const y of ys) out.push({ x: x === 0 ? 0 : x, y: y === 0 ? 0 : y });
  return out;
}

/** Where a plane's cut sits for Auto: the origin, or the nearest end of the range when it misses it. */
export function originCut(range: { min: number; max: number }): number {
  return Math.max(range.min, Math.min(range.max, 0));
}
