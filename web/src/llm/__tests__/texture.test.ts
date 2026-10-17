// The punch + backfill texture check on synthetic slices: fills at the level of
// their surroundings add nothing; fills systematically brighter are flagged; a
// diffuse that peaks at the nodes, filled as a smooth interpolation does, is
// not (docs/pilot-review.md, finding 4).

import { describe, expect, it } from "vitest";

import { textureMetrics } from "../metrics/texture";
import { makeSlice } from "./helpers";

// Deterministic noise in [-1, 1).
const noise = (ix: number, iy: number) => (((ix * 7919 + iy * 104729) % 1000) / 500) - 1;
const N = 61;
// Holes: 3×3 squares on a lattice of nodes every 10 voxels, away from the edge.
const isHole = (ix: number, iy: number) =>
  ix > 3 && iy > 3 && ix < N - 4 && iy < N - 4 && Math.abs(((ix + 5) % 10) - 5) <= 1 && Math.abs(((iy + 5) % 10) - 5) <= 1;
const diffuse = (ix: number, iy: number) => 100 + 4 * noise(ix, iy);

const before = makeSlice(N, N, (_x, _y, ix, iy) => diffuse(ix, iy) + (isHole(ix, iy) ? 500 : 0));
const punched = makeSlice(N, N, (_x, _y, ix, iy) => (isHole(ix, iy) ? NaN : diffuse(ix, iy)));

describe("textureMetrics", () => {
  it("finds no texture when the fills match their surroundings", () => {
    const filled = makeSlice(N, N, (_x, _y, ix, iy) => diffuse(ix, iy));
    const m = textureMetrics(before, punched, filled)!;
    expect(m.n_holes).toBe(25);
    expect(Math.abs(m.median_fill_bias_sigma!)).toBeLessThan(0.5);
    expect(m.systematic_fill_bias).toBe(false);
    expect(m.azimuthal_ratio!).toBeGreaterThan(0.8);
    expect(m.azimuthal_ratio!).toBeLessThan(1.25);
  });

  it("flags fills that sit brighter than their rims at every node", () => {
    const filled = makeSlice(N, N, (_x, _y, ix, iy) => diffuse(ix, iy) + (isHole(ix, iy) ? 30 : 0));
    const m = textureMetrics(before, punched, filled)!;
    expect(m.median_fill_bias_sigma!).toBeGreaterThan(3);
    expect(m.median_fill_bias_level!).toBeCloseTo(0.3, 1);
    expect(m.above_fraction).toBe(1);
    expect(m.systematic_fill_bias).toBe(true);
    expect(m.azimuthal_ratio!).toBeGreaterThan(1.25);
  });

  // A diffuse peaked at every node (thermal diffuse scattering), rising toward
  // it by 0.15 of the level per voxel, as the rims of the dev control do.
  const cheb = (ix: number, iy: number) => Math.max(Math.abs(((ix + 5) % 10) - 5), Math.abs(((iy + 5) % 10) - 5));
  const peaked = (ix: number, iy: number) => 100 + 15 * Math.max(0, 6 - cheb(ix, iy)) + 2 * noise(ix, iy);
  const punchedPeaked = makeSlice(N, N, (_x, _y, ix, iy) => (isHole(ix, iy) ? NaN : peaked(ix, iy)));
  // Fills anywhere from the diffuse at the hole's edge carried in (what a
  // harmonic fill gives) to its rise continued to the node (the truth here).
  const fillPeaked = (fill: (ix: number, iy: number) => number) =>
    makeSlice(N, N, (_x, _y, ix, iy) => (isHole(ix, iy) ? fill(ix, iy) : peaked(ix, iy)));
  const atEdge = (offset: number) => fillPeaked((ix, iy) => 100 + 15 * 4 + noise(ix, iy) + offset);
  const risen = fillPeaked((ix, iy) => 100 + 15 * (6 - cheb(ix, iy)) + noise(ix, iy));

  it("does not flag a smooth fill of a diffuse that peaks at the nodes, which sits above its rim's median", () => {
    for (const filled of [atEdge(0), risen]) {
      const m = textureMetrics(punchedPeaked, punchedPeaked, filled)!;
      expect(m.n_holes).toBe(25);
      expect(Math.abs(m.median_fill_bias_level!)).toBeLessThan(0.02); // inside the range the rim allows
      expect(m.systematic_fill_bias).toBe(false);
    }
  });

  it("flags such fills darker than the diffuse at their edge, or brighter than its rise allows", () => {
    const dark = textureMetrics(punchedPeaked, punchedPeaked, atEdge(-40))!;
    expect(dark.median_fill_bias_level!).toBeLessThan(-0.2);
    expect(dark.below_fraction).toBe(1);
    expect(dark.systematic_fill_bias).toBe(true);
    const bright = textureMetrics(punchedPeaked, punchedPeaked, fillPeaked((ix, iy) => 100 + 15 * (6 - cheb(ix, iy)) + 40))!;
    expect(bright.median_fill_bias_level!).toBeGreaterThan(0.2);
    expect(bright.above_fraction).toBe(1);
    expect(bright.systematic_fill_bias).toBe(true);
  });

  it("does not count a bias that is many σ on good statistics but a small share of the diffuse level", () => {
    // Noise of 0.1 on a level of 100: fills 5 above (5 % of the level) are 50σ off.
    const quiet = (ix: number, iy: number) => 100 + 0.1 * noise(ix, iy);
    const p = makeSlice(N, N, (_x, _y, ix, iy) => (isHole(ix, iy) ? NaN : quiet(ix, iy)));
    const f = makeSlice(N, N, (_x, _y, ix, iy) => quiet(ix, iy) + (isHole(ix, iy) ? 5 : 0));
    const m = textureMetrics(p, p, f)!;
    expect(m.median_fill_bias_sigma!).toBeGreaterThan(10);
    expect(m.median_fill_bias_level!).toBeCloseTo(0.05, 2);
    expect(m.systematic_fill_bias).toBe(false);
  });

  it("needs the punched and backfilled slices", () => {
    expect(textureMetrics(before, null, punched)).toBeNull();
  });
});
