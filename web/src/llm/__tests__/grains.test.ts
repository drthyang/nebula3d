// The second-grain check on synthetic crystals: a grain rotated 23° indexes as
// one, Bragg peaks displaced by a UB that is 0.9° off read as a UB error, and
// peaks at random directions index as neither.

import { describe, expect, it } from "vitest";

import { grainCheck, orbits, type OffLatticePeak } from "../metrics/grains";

type V3 = [number, number, number];
type M3 = [V3, V3, V3];

// A hexagonal cell (a = 8, c = 10 Å; γ = 120°) in the UB convention Q = UB·hkl.
const astar = (4 * Math.PI) / (Math.sqrt(3) * 8);
const UB: M3 = [
  [astar, astar * 0.5, 0],
  [0, astar * Math.sin(Math.PI / 3), 0],
  [0, 0, (2 * Math.PI) / 10],
];
const I3: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const mv = (m: M3, v: V3): V3 => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as V3;
function rot(axis: V3, deg: number): M3 {
  const n = Math.hypot(...axis);
  const [x, y, z] = axis.map((a) => a / n);
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180), t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}
function inv(m: M3): M3 {
  const [a, b, c] = m;
  const cr = (u: V3, v: V3): V3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const r = [cr(b, c), cr(c, a), cr(a, b)].map((v) => v.map((x) => x / det));
  return [[r[0][0], r[1][0], r[2][0]], [r[0][1], r[1][1], r[2][1]], [r[0][2], r[1][2], r[2][2]]];
}
const ubInv = inv(UB);

// Peaks at the nodes of a lattice rotated by R, written in the main grain's hkl.
function rotatedNodes(R: M3, qmax: number): OffLatticePeak[] {
  const out: OffLatticePeak[] = [];
  for (let h = -4; h <= 4; h++)
    for (let k = -4; k <= 4; k++)
      for (let l = -4; l <= 4; l++) {
        if (!h && !k && !l) continue;
        const q = mv(R, mv(UB, [h, k, l]));
        if (Math.hypot(...q) > qmax) continue;
        out.push({ hkl: mv(ubInv, q), intensity: 1000 - Math.hypot(...q) * 50 + ((h * 7 + k * 3 + l) % 5) });
      }
  return out;
}

describe("grainCheck", () => {
  it("finds a second grain, and how far it is turned from the main one", () => {
    const g = grainCheck({ peaks: rotatedNodes(rot([1, 2, 3], 23), 4.5), ub: UB, ops: [I3] });
    expect(g.verdict).toMatch(/^a second grain: one rotation of the Bragg lattice indexes/);
    expect(g.rotated_copy!.indexed).toBeGreaterThan(g.judged / 2);
    expect(g.rotated_copy!.misorientation_deg).toBeCloseTo(23, 0);
  });

  it("reads Bragg peaks displaced by a UB 0.9° off as a UB error, not a grain", () => {
    const g = grainCheck({ peaks: rotatedNodes(rot([0, 1, 1], 0.9), 4.5), ub: UB, ops: [I3] });
    expect(g.verdict).toMatch(/^the off-lattice peaks are the crystal's own Bragg peaks with the UB off: one rotation of 0\.9° /);
    expect(g.near_bragg_nodes).toBe(g.judged);
    // Each node moves by the angle times the sine of its angle to the axis: a lower bound.
    expect(g.near_offset_angle_deg!.median).toBeGreaterThan(0.5);
    expect(g.near_offset_angle_deg!.median).toBeLessThanOrEqual(0.9);
  });

  it("finds no grain among peaks at random directions", () => {
    let s = 3;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
    const peaks: OffLatticePeak[] = Array.from({ length: 60 }, (_v, i) => ({ hkl: [rnd() * 8, rnd() * 8, rnd() * 6] as V3, intensity: 100 - i }));
    const g = grainCheck({ peaks, ub: UB, ops: [I3] });
    expect(g.verdict).toMatch(/^no second grain of this phase/);
    expect(g.rotated_copy!.indexed).toBeLessThan(g.judged / 2);
  });

  it("groups a symmetrised volume's copies into one orbit each", () => {
    const six: M3[] = [I3, [[0, -1, 0], [1, -1, 0], [0, 0, 1]]];
    const p: OffLatticePeak = { hkl: [2, 1, 1], intensity: 10 };
    const copy: OffLatticePeak = { hkl: mv(six[1], p.hkl), intensity: 9 };
    expect(orbits([p, copy, { hkl: [3, 3, 3], intensity: 5 }], six)).toHaveLength(2);
  });
});
