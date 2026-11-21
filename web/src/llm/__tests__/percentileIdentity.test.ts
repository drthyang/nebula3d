// The percentile routine sorts a typed array once and reuses it
// (metrics/sliceStats.ts). Every value it returns must be the old routine's,
// bit for bit (Object.is: −0 is not +0, NaN is NaN), on any input. The old
// routine is kept here, word for word, as the reference.

import { describe, expect, it } from "vitest";

import { median, percentile, percentileOfSorted, robustStats, sortedCopy, type RobustStats } from "../metrics/sliceStats";

// --- the routine as it was (reference only) ---------------------------------
const oldPercentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, p * (sorted.length - 1)));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};
const oldMedian = (values: number[]): number => oldPercentile(values, 0.5);
const oldRobustStats = (data: Float32Array | number[]): RobustStats | null => {
  const values: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isFinite(v)) values.push(v);
  }
  if (!values.length) return null;
  const med = oldMedian(values);
  const mad = oldMedian(values.map((v) => Math.abs(v - med)));
  let negatives = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const v of values) {
    if (v < 0) negatives += 1;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  return {
    n: values.length,
    median: med,
    sigma: mad * 1.4826,
    mad,
    p01: oldPercentile(values, 0.01),
    p99: oldPercentile(values, 0.99),
    max,
    min,
    negativeFraction: negatives / values.length,
  };
};
// -----------------------------------------------------------------------------

// A seeded generator (mulberry32), so a failure is repeatable.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const PS = [0, 0.01, 0.05, 0.25, 1 / 3, 0.5, 0.75, 0.95, 0.99, 1, -0.5, 1.5, NaN, Infinity, -Infinity, 1e-9, 1 - 1e-12];

const bits = (v: number): string => (Object.is(v, -0) ? "-0" : String(v));

/** Every percentile and the whole sorted order, against the old routine. */
function same(values: number[], what: string): void {
  const before = [...values];
  const sorted = sortedCopy(values);
  const old = [...values].sort((a, b) => a - b);
  expect(sorted.length, what).toBe(old.length);
  for (let i = 0; i < old.length; i++) {
    if (!Object.is(sorted[i], old[i])) throw new Error(`${what}: sorted[${i}] is ${bits(sorted[i])}, was ${bits(old[i])}`);
  }
  for (const p of PS) {
    const a = percentile(values, p);
    const b = oldPercentile(values, p);
    if (!Object.is(a, b)) throw new Error(`${what}: percentile(${p}) is ${bits(a)}, was ${bits(b)}`);
    const c = percentileOfSorted(sorted, p);
    if (!Object.is(c, b)) throw new Error(`${what}: percentileOfSorted(${p}) is ${bits(c)}, was ${bits(b)}`);
  }
  if (!Object.is(median(values), oldMedian(values))) throw new Error(`${what}: median differs`);
  // The input is left as it came.
  expect(values.length).toBe(before.length);
  for (let i = 0; i < before.length; i++) if (!Object.is(values[i], before[i])) throw new Error(`${what}: the input changed at ${i}`);
}

const sameStats = (data: Float32Array | number[], what: string): void => {
  const a = robustStats(data);
  const b = oldRobustStats(data);
  if (a === null || b === null) {
    expect(a, what).toBe(b);
    return;
  }
  expect(Object.keys(a), what).toEqual(Object.keys(b));
  for (const k of Object.keys(b) as (keyof RobustStats)[]) {
    if (!Object.is(a[k], b[k])) throw new Error(`${what}: ${k} is ${bits(a[k])}, was ${bits(b[k])}`);
  }
};

// Values that sort awkwardly, drawn from to build the adversarial inputs.
const AWKWARD = [0, -0, NaN, Infinity, -Infinity, 1, -1, 1, 5e-324, -5e-324, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 0.1 + 0.2, 0.3, 2 ** 53, -(2 ** 53), 1e-300, 3.4028234663852886e38];

describe("the percentile routine returns the old routine's values, bit for bit", () => {
  it("on empty, one and two values", () => {
    same([], "empty");
    for (const a of AWKWARD) {
      same([a], `[${bits(a)}]`);
      for (const b of AWKWARD) same([a, b], `[${bits(a)}, ${bits(b)}]`);
    }
  });

  it("on −0 and +0 mixed, in every order of up to six, and in long runs", () => {
    for (let n = 1; n <= 6; n++) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const zeros = Array.from({ length: n }, (_v, i) => (mask & (1 << i) ? -0 : 0));
        same(zeros, `zeros ${zeros.map(bits).join(" ")}`);
        // The same, among other values, past the typed sort's threshold.
        same([3, -2, ...zeros, 7, -7, 0.5, ...zeros, -0.5, 1, 2, 4, 8, 16, 32, 64, -64, -32], `zeros among values, n=${n} mask=${mask}`);
      }
    }
    const next = rng(11);
    for (const n of [16, 17, 100, 1001, 50_000]) {
      same(Array.from({ length: n }, () => (next() < 0.5 ? -0 : 0)), `${n} zeros of both signs`);
      same(Array.from({ length: n }, () => (next() < 0.3 ? -0 : next() < 0.5 ? 0 : next() - 0.5)), `${n} values, many zeros`);
      same(new Array<number>(n).fill(-0), `${n} × −0`);
      same(new Array<number>(n).fill(0), `${n} × +0`);
    }
  });

  it("on all-equal values and heavy duplicates", () => {
    for (const v of AWKWARD) for (const n of [3, 15, 16, 17, 64, 1000]) same(new Array<number>(n).fill(v), `${n} × ${bits(v)}`);
    const next = rng(5);
    for (const n of [15, 16, 17, 333, 20_000]) same(Array.from({ length: n }, () => Math.floor(next() * 4) - 2), `${n} values of four`);
  });

  it("on ±Infinity among finite values", () => {
    const next = rng(7);
    for (const n of [2, 3, 15, 16, 17, 200, 5000]) {
      same(Array.from({ length: n }, () => { const u = next(); return u < 0.1 ? Infinity : u < 0.2 ? -Infinity : (next() - 0.5) * 1e6; }), `${n} values with infinities`);
      same(Array.from({ length: n }, (_v, i) => (i % 2 ? Infinity : -Infinity)), `${n} infinities`);
    }
  });

  it("on NaN anywhere (the engine's own order, kept)", () => {
    const next = rng(13);
    for (const n of [2, 3, 4, 15, 16, 17, 40, 300, 5000]) {
      for (let rep = 0; rep < 8; rep++) {
        const values = Array.from({ length: n }, () => { const u = next(); return u < 0.15 ? NaN : u < 0.2 ? -0 : u < 0.25 ? Infinity : (next() - 0.5) * 100; });
        same(values, `${n} values with NaN, #${rep}`);
      }
      const one = Array.from({ length: n }, () => next());
      one[Math.floor(next() * n)] = NaN;
      same(one, `${n} values, one NaN`);
      same(new Array<number>(n).fill(NaN), `${n} × NaN`);
    }
  });

  it("on every mix of the awkward values, short and long", () => {
    const next = rng(17);
    for (let rep = 0; rep < 400; rep++) {
      const n = rep < 200 ? 1 + Math.floor(next() * 40) : 16 + Math.floor(next() * 400);
      same(Array.from({ length: n }, () => AWKWARD[Math.floor(next() * AWKWARD.length)]), `awkward mix #${rep}`);
    }
  });

  it("on what is not a number (holes, undefined), sorted as before", () => {
    const holes = [3, 1, 2, 9, 8, 7, 6, 5, 4, 0, 11, 12, 13, 14, 15, 16, 17, 18];
    delete holes[4];
    same(holes, "a hole");
    same([5, undefined as unknown as number, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], "an undefined");
  });

  it("on random values of every size, sorted, reversed and float32", () => {
    const next = rng(1);
    for (const n of [1, 2, 3, 7, 15, 16, 17, 31, 32, 33, 100, 1000, 4097, 100_000]) {
      const values = Array.from({ length: n }, () => (next() - 0.5) * 10 ** Math.floor(next() * 12 - 6));
      same(values, `${n} random`);
      same([...values].sort((a, b) => a - b), `${n} sorted`);
      same([...values].sort((a, b) => b - a), `${n} reversed`);
      same(values.map(Math.fround), `${n} float32`);
      same(values.map(Math.round), `${n} integers`);
    }
  });

  it("on a huge array", () => {
    const next = rng(3);
    const n = 2_000_000;
    const values = new Array<number>(n);
    for (let i = 0; i < n; i++) values[i] = Math.fround((next() - 0.3) * 1000);
    values[12345] = -0;
    values[999_999] = 0;
    values[1_500_000] = -0;
    same(values, "2 million values");
  }, 120_000);

  it("on slices as the stages write them (float32, NaN where masked, peaks, a pedestal, punched holes)", () => {
    const next = rng(23);
    for (const [nx, ny] of [[161, 161], [401, 301], [64, 48]] as const) {
      const data = new Float32Array(nx * ny);
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const x = (ix - nx / 2) / nx;
          const y = (iy - ny / 2) / ny;
          const r = Math.hypot(x, y);
          let v = 5 * Math.exp(-8 * r) + (next() - 0.5) + (Math.abs(r - 0.3) < 0.01 ? 4 : 0);
          if (ix % 20 === 0 && iy % 20 === 0) v += 5000 * next();
          if (r > 0.48) v = NaN;
          else if (next() < 0.02) v = NaN;
          else if (next() < 0.01) v = 0;
          else if (next() < 0.005) v = -0;
          data[iy * nx + ix] = v;
        }
      }
      sameStats(data, `${nx}×${ny} slice`);
      sameStats(Array.from(data), `${nx}×${ny} slice as numbers`);
      const finite = Array.from(data).filter(Number.isFinite);
      same(finite, `${nx}×${ny} finite voxels`);
      same(finite.filter((v) => v > 0), `${nx}×${ny} positive voxels`);
      // A slice after a subtraction: differences of float32, signed zeros among them.
      const diff = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) diff[i] = data[i] - Math.fround(data[i] * (i % 7 === 0 ? 1 : 0.9));
      sameStats(diff, `${nx}×${ny} difference`);
    }
    sameStats(new Float32Array(0), "no voxels");
    sameStats(new Float32Array(300).fill(NaN), "all masked");
    sameStats(new Float32Array([NaN, -0, NaN]), "one −0");
    sameStats(new Float32Array(500).fill(2.5), "flat");
    sameStats([Infinity, 1, 2, -Infinity, NaN, 3], "infinities and NaN are left out");
  });
});
