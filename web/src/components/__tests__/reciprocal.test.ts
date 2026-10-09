import { describe, expect, it } from "vitest";

import { boxQMax, metricFromUb, qContour, qNorm, qSection, reciprocalMetric, type Ellipse } from "../reciprocal";

// Ground truth built independently of reciprocal.ts: Cartesian direct vectors
// from the cell, a* = 2π (b × c) / V, …, and |Q| = |h a* + k b* + l c*|.
type V3 = [number, number, number];
const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const rad = (d: number) => (d * Math.PI) / 180;

function recipVectors(a: number, b: number, c: number, al: number, be: number, ga: number): [V3, V3, V3] {
  const av: V3 = [a, 0, 0];
  const bv: V3 = [b * Math.cos(rad(ga)), b * Math.sin(rad(ga)), 0];
  const cx = c * Math.cos(rad(be));
  const cy = (c * (Math.cos(rad(al)) - Math.cos(rad(be)) * Math.cos(rad(ga)))) / Math.sin(rad(ga));
  const cv: V3 = [cx, cy, Math.sqrt(c * c - cx * cx - cy * cy)];
  const vol = dot(av, cross(bv, cv));
  const k = (2 * Math.PI) / vol;
  const s = (v: V3): V3 => [v[0] * k, v[1] * k, v[2] * k];
  return [s(cross(bv, cv)), s(cross(cv, av)), s(cross(av, bv))];
}

function trueQ(rv: [V3, V3, V3], hkl: V3): number {
  const q: V3 = [0, 1, 2].map((i) => hkl[0] * rv[0][i] + hkl[1] * rv[1][i] + hkl[2] * rv[2][i]) as V3;
  return Math.sqrt(dot(q, q));
}

/** Points on an ellipse, mapped back to hkl on the plane (ix, iy free; the third = cut). */
function contourHkl(e: Ellipse, ix: number, iy: number, cut: number, sx: number, sy: number, n = 12): V3[] {
  const th = rad(e.angle);
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    const X = e.cx + e.rx * Math.cos(t) * Math.cos(th) - e.ry * Math.sin(t) * Math.sin(th);
    const Y = e.cy + e.rx * Math.cos(t) * Math.sin(th) + e.ry * Math.sin(t) * Math.cos(th);
    const hkl: V3 = [0, 0, 0];
    hkl[ix] = X / sx;
    hkl[iy] = Y / sy;
    hkl[3 - ix - iy] = cut;
    return hkl;
  });
}

describe("reciprocalMetric", () => {
  it("matches a*·a* from explicit vectors for a triclinic cell", () => {
    const cell = { a: 5.1, b: 6.3, c: 7.2, alpha: 82, beta: 97, gamma: 109 };
    const G = reciprocalMetric(cell)!;
    const rv = recipVectors(5.1, 6.3, 7.2, 82, 97, 109);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(G[i][j]).toBeCloseTo(dot(rv[i], rv[j]), 10);
  });

  it("is diag((2π/a)², …) for an orthogonal cell, missing angles taken as 90°", () => {
    const G = reciprocalMetric({ a: 2, b: 4, c: 5 })!;
    expect(G[0][0]).toBeCloseTo((2 * Math.PI / 2) ** 2, 12);
    expect(G[0][1]).toBeCloseTo(0, 12);
  });

  it("agrees with UBᵀ·UB", () => {
    const rv = recipVectors(4, 4, 6, 90, 90, 120);
    const ub = [0, 1, 2].map((r) => [rv[0][r], rv[1][r], rv[2][r]]); // columns a*, b*, c*
    const G1 = metricFromUb(ub)!;
    const G2 = reciprocalMetric({ a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 })!;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(G1[i][j]).toBeCloseTo(G2[i][j], 10);
  });
});

describe("qSection / qContour", () => {
  it("keeps the orthogonal case a circle about the origin", () => {
    const G = reciprocalMetric({ a: 3, b: 4, c: 5 })!;
    const sx = (2 * Math.PI) / 3, sy = (2 * Math.PI) / 4;
    const sec = qSection(G, 0, 1, 0.5, sx, sy)!;
    expect(sec.center[0]).toBeCloseTo(0, 12);
    expect(sec.center[1]).toBeCloseTo(0, 12);
    expect(sec.perp).toBeCloseTo((0.5 * 2 * Math.PI) / 5, 12);
    const e = qContour(sec, 2)!;
    expect(e.rx).toBeCloseTo(e.ry, 12);
    expect(e.rx).toBeCloseTo(Math.sqrt(4 - sec.perp ** 2), 12);
  });

  it("gives a tilted ellipse on a hexagonal H–K plane, on the true |Q| = R", () => {
    const cell = { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 };
    const G = reciprocalMetric(cell)!;
    const rv = recipVectors(4, 4, 6, 90, 90, 120);
    const sx = (2 * Math.PI) / 4, sy = sx;
    const e = qContour(qSection(G, 0, 1, 0, sx, sy)!, 3)!;
    expect(e.rx / e.ry).toBeGreaterThan(1.5); // √3 for γ* = 60°: not a circle
    expect(Math.abs(Math.abs(e.angle) - 45)).toBeLessThan(1e-9); // along h = ±k
    for (const hkl of contourHkl(e, 0, 1, 0, sx, sy)) expect(trueQ(rv, hkl)).toBeCloseTo(3, 9);
  });

  it("moves the centre off the origin on a monoclinic H–K plane at l ≠ 0", () => {
    const G = reciprocalMetric({ a: 5, b: 6, c: 7, alpha: 90, beta: 105, gamma: 90 })!;
    const rv = recipVectors(5, 6, 7, 90, 105, 90);
    const sx = (2 * Math.PI) / 5, sy = (2 * Math.PI) / 6;
    const sec = qSection(G, 0, 1, 1.5, sx, sy)!;
    expect(Math.abs(sec.center[0])).toBeGreaterThan(0.1);
    // The centre is the plane's point nearest the origin, d = |l|·2π/c away.
    expect(trueQ(rv, [sec.center[0] / sx, sec.center[1] / sy, 1.5])).toBeCloseTo(sec.perp, 9);
    expect(sec.perp).toBeCloseTo((1.5 * 2 * Math.PI) / 7, 9);
    const e = qContour(sec, 2.5)!;
    for (const hkl of contourHkl(e, 0, 1, 1.5, sx, sy)) expect(trueQ(rv, hkl)).toBeCloseTo(2.5, 9);
  });

  it("works for every plane orientation of a triclinic cell", () => {
    const cell = { a: 5.1, b: 6.3, c: 7.2, alpha: 82, beta: 97, gamma: 109 };
    const G = reciprocalMetric(cell)!;
    const rv = recipVectors(5.1, 6.3, 7.2, 82, 97, 109);
    for (const [ix, iy] of [[0, 1], [0, 2], [1, 2], [2, 0]]) {
      const sx = 2 * Math.PI / [5.1, 6.3, 7.2][ix], sy = 2 * Math.PI / [5.1, 6.3, 7.2][iy];
      const e = qContour(qSection(G, ix, iy, -0.7, sx, sy)!, 3)!;
      for (const hkl of contourHkl(e, ix, iy, -0.7, sx, sy)) expect(trueQ(rv, hkl)).toBeCloseTo(3, 9);
    }
  });

  it("returns no contour where the plane does not reach R", () => {
    const G = reciprocalMetric({ a: 3, b: 3, c: 3 })!;
    expect(qContour(qSection(G, 0, 1, 2, 2.09, 2.09)!, 1)).toBeNull();
  });
});

describe("boxQMax", () => {
  it("takes the farthest corner under the true metric", () => {
    const G = reciprocalMetric({ a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 })!;
    const rv = recipVectors(4, 4, 6, 90, 90, 120);
    const brute = Math.max(...[-1, 1].flatMap((s) => [-1, 1].flatMap((t) => [-1, 1].map((u) => trueQ(rv, [3 * s, 3 * t, 2 * u])))));
    expect(boxQMax(G, [3, 3, 2])).toBeCloseTo(brute, 9);
    expect(qNorm(G, [1, 0, 0])).toBeCloseTo((2 * Math.PI) / (4 * Math.sin(rad(120))), 9);
  });
});
