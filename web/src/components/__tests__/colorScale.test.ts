// Pins the colour-scale contract shared with the NeXus Viewer: the asinh / lin /
// log mapping, Auto (vmin 0, vmax p97, softening = median), and Brightness.

import { describe, expect, it } from "vitest";

import {
  autoLevels,
  barDomain,
  brightnessOf,
  fmtLevel,
  hiForBrightness,
  histogram,
  makeScaler,
} from "../colorScale";

describe("makeScaler", () => {
  it("maps lin linearly between the limits and clamps outside", () => {
    const t = makeScaler({ lo: 1, hi: 3 }, "lin", 1);
    expect(t(1)).toBe(0);
    expect(t(2)).toBeCloseTo(0.5);
    expect(t(3)).toBe(1);
    expect(t(-5)).toBe(0);
    expect(t(9)).toBe(1);
    expect(t(NaN)).toBeNaN();
  });

  it("maps asinh as (asinh(v/s) − asinh(lo/s)) / span", () => {
    const s = 0.1;
    const t = makeScaler({ lo: 0, hi: 4 }, "asinh", s);
    const expected = Math.asinh(0.4 / s) / Math.asinh(4 / s);
    expect(t(0.4)).toBeCloseTo(expected, 12);
    // asinh lifts low values above their linear position
    expect(t(0.4)).toBeGreaterThan(0.4 / 4);
  });

  it("maps log in decades and puts non-positive values at 0", () => {
    const t = makeScaler({ lo: 0.01, hi: 10 }, "log", 1);
    expect(t(0.1)).toBeCloseTo(1 / 3, 12);
    expect(t(1)).toBeCloseTo(2 / 3, 12);
    expect(t(0)).toBe(0);
    expect(t(-1)).toBe(0);
  });

  it("uses three decades below vmax when log has vmin ≤ 0", () => {
    const t = makeScaler({ lo: 0, hi: 10 }, "log", 1);
    expect(t(0.01)).toBeCloseTo(0, 12);
    expect(t(0.1)).toBeCloseTo(1 / 3, 12);
  });

  it("maps diverging data symmetrically about 0 over ±hi", () => {
    const t = makeScaler({ lo: -2, hi: 2 }, "asinh", 0.1, true);
    expect(t(0)).toBe(0.5);
    expect(t(2)).toBe(1);
    expect(t(-1)).toBeCloseTo(0.25);
    expect(t(-9)).toBe(0);
  });
});

describe("autoLevels", () => {
  const ramp = Float32Array.from({ length: 1000 }, (_, i) => i + 1); // 1..1000

  it("sets vmin 0, vmax at p97 and the softening at the median of positives", () => {
    const a = autoLevels([ramp]);
    expect(a.lo).toBe(0);
    expect(a.hi).toBe(971); // floor(0.97 · 1000) → the 971st value
    expect(a.soft).toBe(501);
  });

  it("ignores NaN and non-positive values for unsigned data", () => {
    const d = Float32Array.from([NaN, -5, 0, 1, 2, 3, 4]);
    const a = autoLevels([d]);
    expect(a.hi).toBe(4);
    expect(a.lo).toBe(0);
  });

  it("is symmetric for signed data, from |v|", () => {
    const d = Float32Array.from([-10, -1, 1, 2]);
    const a = autoLevels([d], { signed: true });
    expect(a.hi).toBe(10);
    expect(a.lo).toBe(-10);
  });

  it("puts vmin three decades below vmax for log", () => {
    const a = autoLevels([ramp], { scale: "log" });
    expect(a.lo).toBeCloseTo(a.hi / 1000);
  });

  it("pools several slices", () => {
    const a = autoLevels([Float32Array.from([1, 2]), Float32Array.from([100, 200])]);
    expect(a.hi).toBe(200);
  });
});

describe("brightness", () => {
  it("is vmax in stops about Auto; right is brighter", () => {
    expect(brightnessOf(4, 4)).toBe(0);
    expect(brightnessOf(4, 2)).toBeCloseTo(1);
    expect(brightnessOf(4, 8)).toBeCloseTo(-1);
    expect(hiForBrightness(4, 1)).toBeCloseTo(2);
    for (const b of [-3, -0.5, 0, 1.25, 3]) expect(brightnessOf(4, hiForBrightness(4, b))).toBeCloseTo(b, 12);
  });
});

describe("histogram / barDomain / fmtLevel", () => {
  it("bins log counts normalised to a peak of 1", () => {
    const h = histogram(Float32Array.from([0.1, 0.1, 0.1, 0.95]), [0, 1], 10);
    expect(h[1]).toBe(1);
    expect(h[9]).toBeCloseTo(Math.log1p(1) / Math.log1p(3));
    expect(h[5]).toBe(0);
  });

  it("holds Auto and the current limits", () => {
    expect(barDomain({ lo: 0, hi: 1 }, { lo: 0, hi: 3 }, false)[1]).toBeGreaterThanOrEqual(3);
    const [a, b] = barDomain({ lo: -1, hi: 1 }, { lo: -2, hi: 2 }, true);
    expect(a).toBe(-b);
    expect(b).toBeGreaterThan(2);
  });

  it("formats limits compactly", () => {
    expect(fmtLevel(0)).toBe("0");
    expect(fmtLevel(3.94159)).toBe("3.94");
    expect(fmtLevel(0.000123)).toBe("1.23e-4");
    expect(fmtLevel(25000)).toBe("2.50e+4");
  });
});
