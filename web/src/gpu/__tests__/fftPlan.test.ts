// CI-safe pins of every piece of GPU-FFT index math against numpy fixtures
// (regenerate with scripts/gen_fft_fixtures.py).

import { describe, expect, it } from "vitest";

import {
  buildLinePlan,
  centredLineReference,
  dispatchGrid,
  factorize,
  fftshiftGather,
  fiveSmooth,
  ifftshiftGather,
  padLo,
  stockhamLineReference,
} from "../fftPlan";
import fixtures from "./fixtures.json";

interface Fixtures {
  five_smooth: Record<string, number>;
  shift_maps: { n: number; ifftshift_gather: number[]; fftshift_gather: number[] }[];
  fft_1d: { n: number; x: number[]; fwd_re: number[]; fwd_im: number[];
            inv_re: number[]; inv_im: number[] }[];
  fft_3d: { shape: number[]; x: number[]; fwd_re: number[]; fwd_im: number[] }[];
}
const fx = fixtures as unknown as Fixtures;

describe("fiveSmooth / factorize", () => {
  it("matches scipy-independent numpy ground truth", () => {
    for (const [n, want] of Object.entries(fx.five_smooth)) {
      expect(fiveSmooth(Number(n))).toBe(want);
    }
  });

  it("factorises exactly", () => {
    for (const n of [2, 3, 4, 5, 6, 60, 405, 512, 375]) {
      const prod = factorize(n).reduce((a, b) => a * b, 1);
      expect(prod).toBe(n);
    }
    expect(() => factorize(7)).toThrow();
  });
});

describe("shift gather maps", () => {
  it("pins numpy ifftshift/fftshift for even and odd n", () => {
    for (const m of fx.shift_maps) {
      expect(Array.from(ifftshiftGather(m.n))).toEqual(m.ifftshift_gather);
      expect(Array.from(fftshiftGather(m.n))).toEqual(m.fftshift_gather);
    }
  });
});

describe("Stockham reference vs numpy centred FFT", () => {
  it("forward matches for every 5-smooth length", () => {
    for (const c of fx.fft_1d) {
      const { re, im } = centredLineReference(Float64Array.from(c.x), -1);
      for (let i = 0; i < c.n; i += 1) {
        expect(re[i]).toBeCloseTo(c.fwd_re[i], 8);
        expect(im[i]).toBeCloseTo(c.fwd_im[i], 8);
      }
    }
  });

  it("inverse matches for every 5-smooth length", () => {
    for (const c of fx.fft_1d) {
      const { re, im } = centredLineReference(Float64Array.from(c.x), 1);
      for (let i = 0; i < c.n; i += 1) {
        expect(re[i]).toBeCloseTo(c.inv_re[i], 8);
        expect(im[i]).toBeCloseTo(c.inv_im[i], 8);
      }
    }
  });

  it("3-D separability: per-axis line passes reproduce numpy fftn", () => {
    for (const c of fx.fft_3d) {
      const [n0, n1, n2] = c.shape;
      const size = n0 * n1 * n2;
      // interleaved complex volume, ifftshifted per axis via gather maps
      const sh0 = ifftshiftGather(n0);
      const sh1 = ifftshiftGather(n1);
      const sh2 = ifftshiftGather(n2);
      let buf = new Float64Array(2 * size);
      for (let i = 0; i < n0; i += 1) {
        for (let j = 0; j < n1; j += 1) {
          for (let k = 0; k < n2; k += 1) {
            const dst = (i * n1 + j) * n2 + k;
            const src = (sh0[i] * n1 + sh1[j]) * n2 + sh2[k];
            buf[2 * dst] = c.x[src];
          }
        }
      }
      // FFT along each axis with line gathers (mirrors the GPU pass structure)
      const axes: [number, number, number][] = [
        [n2, 1, n0 * n1], // axis 2: stride 1
        [n1, n2, n0 * n2], // axis 1: stride n2
        [n0, n1 * n2, n1 * n2], // axis 0: stride n1*n2
      ];
      for (const [len, stride, lines] of axes) {
        const next = new Float64Array(2 * size);
        for (let line = 0; line < lines; line += 1) {
          // base offset: enumerate all index tuples with the transform axis at 0
          let base: number;
          if (stride === 1) {
            base = line * len; // axis 2
          } else if (stride === n2) {
            const u = Math.floor(line / n2);
            const v = line % n2;
            base = u * n1 * n2 + v; // axis 1
          } else {
            base = line; // axis 0: lines index (j,k) directly
          }
          const tmp = new Float64Array(2 * len);
          for (let t = 0; t < len; t += 1) {
            tmp[2 * t] = buf[2 * (base + t * stride)];
            tmp[2 * t + 1] = buf[2 * (base + t * stride) + 1];
          }
          const y = stockhamLineReference(tmp, len, -1);
          for (let t = 0; t < len; t += 1) {
            next[2 * (base + t * stride)] = y[2 * t];
            next[2 * (base + t * stride) + 1] = y[2 * t + 1];
          }
        }
        buf = next;
      }
      // fftshift per axis and compare
      const f0 = fftshiftGather(n0);
      const f1 = fftshiftGather(n1);
      const f2 = fftshiftGather(n2);
      for (let i = 0; i < n0; i += 1) {
        for (let j = 0; j < n1; j += 1) {
          for (let k = 0; k < n2; k += 1) {
            const dst = (i * n1 + j) * n2 + k;
            const src = (f0[i] * n1 + f1[j]) * n2 + f2[k];
            expect(buf[2 * src]).toBeCloseTo(c.fwd_re[dst], 7);
            expect(buf[2 * src + 1]).toBeCloseTo(c.fwd_im[dst], 7);
          }
        }
      }
    }
  });
});

describe("plan geometry", () => {
  it("twiddle tables have the expected layout", () => {
    const plan = buildLinePlan(60, -1);
    const total = plan.stages.reduce(
      (a, st) => a + st.ns * (st.radix - 1), 0);
    expect(plan.twiddles.length).toBe(2 * total);
    // first stage has ns=1 → its (j=0, s) twiddles are all exactly 1+0i
    const st0 = plan.stages[0];
    for (let s = 1; s < st0.radix; s += 1) {
      expect(plan.twiddles[2 * (s - 1)]).toBe(1);
      expect(Math.abs(plan.twiddles[2 * (s - 1) + 1])).toBe(0);
    }
  });

  it("padLo centres the origin like np.pad symmetric placement", () => {
    expect(padLo(301, 320)).toBe(320 / 2 - Math.floor(301 / 2));
    expect(padLo(8, 8)).toBe(0);
  });

  it("dispatchGrid respects the per-dimension cap", () => {
    expect(dispatchGrid(100)).toEqual({ x: 100, y: 1 });
    const g = dispatchGrid(81920);
    expect(g.x * g.y).toBeGreaterThanOrEqual(81920);
    expect(g.x).toBeLessThanOrEqual(32768);
  });
});
