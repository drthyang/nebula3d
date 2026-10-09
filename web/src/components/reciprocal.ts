// |Q| on reciprocal-space slices of any cell.
//
// The console draws an HKL slice on orthogonal r.l.u. axes, X = h·sx and
// Y = k·sy (sx = 2π/a), whatever the cell.  For an orthogonal cell |Q| = R is
// then a circle about the origin.  For any other cell it is not: with the
// reciprocal metric G*ᵢⱼ = a*ᵢ·a*ⱼ (Å⁻², physics convention, 2π included)
//
//   |Q|² = pᵀ·G₂·p + 2·cut·gᵀ·p + cut²·G*cc,   p = (h, k) in the plane,
//
// so |Q| = R is an ellipse, tilted where a* and b* are not perpendicular
// (γ* ≠ 90°) and centred off the origin where the cut axis is not normal to
// the plane (a monoclinic H–K plane at l ≠ 0).  Its centre is the plane's
// point nearest the origin, at distance d = |cut|·2π/L (L the real lattice
// length along the cut axis), and |Q|² − d² is the quadratic form about it.
// The backend's |Q| (HKLVolume.q_magnitude) uses the same metric via the UB.

import type { Lattice } from "../api/types";

export type Matrix = number[][];

const DEG = Math.PI / 180;

function det3(m: Matrix): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function inv3(m: Matrix): Matrix | null {
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-300) return null;
  const c = (i: number, j: number) => {
    const r = [0, 1, 2].filter((k) => k !== i);
    const s = [0, 1, 2].filter((k) => k !== j);
    return m[r[0]][s[0]] * m[r[1]][s[1]] - m[r[0]][s[1]] * m[r[1]][s[0]];
  };
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (((i + j) % 2 ? -1 : 1) * c(j, i)) / d));
}

/** G* from the direct cell (Å, degrees; a missing angle is 90°), or null without lengths. */
export function reciprocalMetric(lat: Partial<Lattice> | null | undefined): Matrix | null {
  if (!lat?.a || !lat.b || !lat.c) return null;
  const { a, b, c } = lat;
  const cos = (x: number | null | undefined) => (x == null || x === 90 ? 0 : Math.cos(x * DEG));
  const ca = cos(lat.alpha), cb = cos(lat.beta), cg = cos(lat.gamma);
  const g: Matrix = [
    [a * a, a * b * cg, a * c * cb],
    [a * b * cg, b * b, b * c * ca],
    [a * c * cb, b * c * ca, c * c],
  ];
  const gi = inv3(g);
  return gi && gi.map((row) => row.map((v) => 4 * Math.PI * Math.PI * v));
}

/** G* = UBᵀ·UB from a UB matrix (physics convention: its columns are a*, b*, c*). */
export function metricFromUb(ub: number[][] | null | undefined): Matrix | null {
  if (!ub || ub.length !== 3 || ub.some((r) => r.length !== 3 || r.some((v) => !Number.isFinite(v)))) return null;
  const g = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ub[0][i] * ub[0][j] + ub[1][i] * ub[1][j] + ub[2][i] * ub[2][j]));
  return Math.abs(det3(g)) > 1e-300 ? g : null;
}

/** |Q| (Å⁻¹) of (h, k, l). */
export function qNorm(G: Matrix, hkl: [number, number, number]): number {
  let s = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += hkl[i] * G[i][j] * hkl[j];
  return Math.sqrt(Math.max(0, s));
}

/** The largest |Q| in the box |h| ≤ H, |k| ≤ K, |l| ≤ L (a convex form peaks at a corner). */
export function boxQMax(G: Matrix, [H, K, L]: [number, number, number]): number {
  let m = 0;
  for (const sh of [-1, 1]) for (const sk of [-1, 1]) for (const sl of [-1, 1]) {
    m = Math.max(m, qNorm(G, [sh * H, sk * K, sl * L]));
  }
  return m;
}

/** One HKL slice as a section of reciprocal space, in display units (Å⁻¹). */
export interface QSection {
  center: [number, number]; // (X, Y) of the plane's point nearest the origin
  perp: number; // the plane's distance from the origin (Å⁻¹)
  form: [number, number, number]; // (A, B, C): |Q|² − perp² = A·X′² + 2B·X′Y′ + C·Y′², X′ = X − cx
}

/**
 * The plane spanned by axes `ix` (horizontal) and `iy` (vertical) at `cut`
 * r.l.u. along the third axis, drawn at X = x·sx, Y = y·sy.
 */
export function qSection(G: Matrix, ix: number, iy: number, cut: number, sx: number, sy: number): QSection | null {
  const ic = 3 - ix - iy;
  const [gxx, gxy, gyy] = [G[ix][ix], G[ix][iy], G[iy][iy]];
  const det = gxx * gyy - gxy * gxy;
  if (!(det > 0) || !(sx > 0) || !(sy > 0)) return null;
  const gx = G[ix][ic], gy = G[iy][ic];
  // p₀ = −cut·G₂⁻¹·g, and d² = cut²·(G*cc − gᵀ·G₂⁻¹·g).
  const px = (-cut * (gyy * gx - gxy * gy)) / det;
  const py = (-cut * (gxx * gy - gxy * gx)) / det;
  const d2 = cut * cut * (G[ic][ic] - (gyy * gx * gx - 2 * gxy * gx * gy + gxx * gy * gy) / det);
  return {
    center: [px * sx, py * sy],
    perp: Math.sqrt(Math.max(0, d2)),
    form: [gxx / (sx * sx), gxy / (sx * sy), gyy / (sy * sy)],
  };
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number; // degrees, counter-clockwise from +X to the rx axis
}

/** |Q| = R on the section, or null where the plane does not reach R. */
export function qContour(sec: QSection, R: number): Ellipse | null {
  const r2 = R * R - sec.perp * sec.perp;
  if (!(r2 > 0)) return null;
  const [A, B, C] = sec.form;
  const tr = A + C;
  const root = Math.hypot(A - C, 2 * B);
  const l1 = (tr - root) / 2; // smaller eigenvalue → the longer axis
  const l2 = (tr + root) / 2;
  if (!(l1 > 0)) return null;
  // Eigenvector of l1: (B, l1 − A), or an axis when B = 0.
  const [vx, vy] = Math.abs(B) > 1e-12 * tr ? [B, l1 - A] : A <= C ? [1, 0] : [0, 1];
  return {
    cx: sec.center[0],
    cy: sec.center[1],
    rx: Math.sqrt(r2 / l1),
    ry: Math.sqrt(r2 / l2),
    angle: Math.atan2(vy, vx) / DEG,
  };
}
