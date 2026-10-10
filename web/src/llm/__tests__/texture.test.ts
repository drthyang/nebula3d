// The punch + backfill texture check on synthetic slices: fills at the level of
// their surroundings add nothing; fills systematically brighter are flagged.

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
    expect(m.brighter_fraction).toBe(1);
    expect(m.systematic_fill_bias).toBe(true);
    expect(m.azimuthal_ratio!).toBeGreaterThan(1.25);
  });

  it("needs the punched and backfilled slices", () => {
    expect(textureMetrics(before, null, punched)).toBeNull();
  });
});
