// The punch + backfill texture check on synthetic slices: fills at the level of
// their surroundings add nothing; fills systematically brighter are flagged; a
// diffuse that peaks at the nodes, filled as a smooth interpolation does, is
// not (docs/pilot-review.md, finding 4). And on a grid too coarse to leave a
// hole's rim on its own side of the midpoint to the next node, a cut is not
// judged, and says why.

import { describe, expect, it } from "vitest";

import { GRID_TOO_COARSE } from "../metrics/coarse";
import { holeReach, nodeSpacing, RIM, roomForRims, textureMetrics } from "../metrics/texture";
import { makeSlice } from "./helpers";

// Deterministic noise in [-1, 1).
const noise = (ix: number, iy: number) => (((ix * 7919 + iy * 104729) % 1000) / 500) - 1;
const N = 61;
// The cut spans ±3 r.l.u., 0.1 r.l.u. a voxel: the nodes, at integer h and k, are 10 voxels apart.
const HALF = 3;
const slice = (f: (x: number, y: number, ix: number, iy: number) => number, half = HALF) => makeSlice(N, N, f, { half });
// Holes: 3×3 squares on the nodes, away from the edge.
const isHole = (ix: number, iy: number) =>
  ix > 3 && iy > 3 && ix < N - 4 && iy < N - 4 && Math.abs(((ix + 5) % 10) - 5) <= 1 && Math.abs(((iy + 5) % 10) - 5) <= 1;
const diffuse = (ix: number, iy: number) => 100 + 4 * noise(ix, iy);

const before = slice((_x, _y, ix, iy) => diffuse(ix, iy) + (isHole(ix, iy) ? 500 : 0));
const punched = slice((_x, _y, ix, iy) => (isHole(ix, iy) ? NaN : diffuse(ix, iy)));

describe("textureMetrics", () => {
  it("finds no texture when the fills match their surroundings", () => {
    const filled = slice((_x, _y, ix, iy) => diffuse(ix, iy));
    const m = textureMetrics(before, punched, filled)!;
    expect(m.n_holes).toBe(25);
    expect(m.not_judged).toBeUndefined();
    expect(Math.abs(m.median_fill_bias_sigma!)).toBeLessThan(0.5);
    expect(m.systematic_fill_bias).toBe(false);
    expect(m.azimuthal_ratio!).toBeGreaterThan(0.8);
    expect(m.azimuthal_ratio!).toBeLessThan(1.25);
  });

  it("flags fills that sit brighter than their rims at every node", () => {
    const filled = slice((_x, _y, ix, iy) => diffuse(ix, iy) + (isHole(ix, iy) ? 30 : 0));
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
  const punchedPeaked = slice((_x, _y, ix, iy) => (isHole(ix, iy) ? NaN : peaked(ix, iy)));
  // Fills anywhere from the diffuse at the hole's edge carried in (what a
  // harmonic fill gives) to its rise continued to the node (the truth here).
  const fillPeaked = (fill: (ix: number, iy: number) => number) =>
    slice((_x, _y, ix, iy) => (isHole(ix, iy) ? fill(ix, iy) : peaked(ix, iy)));
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
    const p = slice((_x, _y, ix, iy) => (isHole(ix, iy) ? NaN : quiet(ix, iy)));
    const f = slice((_x, _y, ix, iy) => quiet(ix, iy) + (isHole(ix, iy) ? 5 : 0));
    const m = textureMetrics(p, p, f)!;
    expect(m.median_fill_bias_sigma!).toBeGreaterThan(10);
    expect(m.median_fill_bias_level!).toBeCloseTo(0.05, 2);
    expect(m.systematic_fill_bias).toBe(false);
  });

  it("needs the punched and backfilled slices", () => {
    expect(textureMetrics(before, null, punched)).toBeNull();
  });
});

describe("room for the rims", () => {
  // The same 3×3 holes reach one voxel from their centres: with their rims of
  // RIM voxels they need the nodes 2·(1 + RIM) = 10 voxels apart, as they are.
  it("reads the nodes off the cut's grid, and each hole's reach off its box", () => {
    expect(nodeSpacing(punched)).toBeCloseTo(10, 9);
    expect(nodeSpacing(slice(() => 0, 6))).toBeCloseTo(5, 9); // 0.2 r.l.u. a voxel
    // A 2×2 square and one more voxel to its side: centre (x, y) = (5.8, 5.6), its box x 5–7, y 5–6.
    const hole = [5 * N + 5, 5 * N + 6, 6 * N + 5, 6 * N + 6, 6 * N + 7];
    expect(holeReach(hole, N)).toBeCloseTo(1.2, 9);
    expect(holeReach([3 * N + 3], N)).toBe(0);
  });

  it("judges a cut whose median hole keeps its rim on its own side of the midpoint, and only that", () => {
    const at = (spacing: number) => slice(() => 0, (N - 1) / 2 / spacing); // the nodes `spacing` voxels apart
    // Every limit from the rule's own constant, RIM: room for the rim at 2·(r + RIM), none a voxel short.
    for (const r of [0, 1, 2.5]) {
      expect(roomForRims(at(2 * (r + RIM)), [r, r, r])).toBeNull();
      expect(roomForRims(at(2 * (r + RIM) - 1), [r, r, r])).toMatch(new RegExp(`^${GRID_TOO_COARSE}: `));
    }
    // The median hole decides: the larger holes of a minority do not.
    expect(roomForRims(at(10), [1, 1, 1, 4, 4])).toBeNull();
    expect(roomForRims(at(10), [1, 1, 4, 4, 4])).toBe(`${GRID_TOO_COARSE}: the nodes are 10 voxels apart, under 16: a hole reaches 4 voxels and its rim ${RIM} more`);
    expect(roomForRims(at(10), [])).toBeNull(); // no hole: nothing to judge, not too coarse
  });

  it("does not judge a cut whose nodes are too close for its holes' rims, and says why", () => {
    // The same holes and fills, on a grid twice as coarse: 0.2 r.l.u. a voxel puts the nodes 5 voxels apart.
    const coarse = (f: (x: number, y: number, ix: number, iy: number) => number) => slice(f, 6);
    const bright = textureMetrics(
      coarse((_x, _y, ix, iy) => diffuse(ix, iy) + (isHole(ix, iy) ? 500 : 0)),
      coarse((_x, _y, ix, iy) => (isHole(ix, iy) ? NaN : diffuse(ix, iy))),
      coarse((_x, _y, ix, iy) => diffuse(ix, iy) + (isHole(ix, iy) ? 30 : 0)),
    )!;
    expect(bright).toMatchObject({
      n_holes: 25,
      not_judged: `${GRID_TOO_COARSE}: the nodes are 5 voxels apart, under 10: a hole reaches 1 voxel and its rim ${RIM} more`,
      median_fill_bias_sigma: null,
      median_fill_bias_level: null,
      above_fraction: null,
      below_fraction: null,
      systematic_fill_bias: null, // not "false": no verdict either way
    });
    // The azimuthal texture is no hole's measure: it is still read.
    expect(bright.azimuthal_ratio!).toBeGreaterThan(1.25);
  });
});
