// The 3D-ΔPDF page's Auto reads the features, not the ripple: the origin's
// self-correlation disk is left out (in true Å, oblique axes mapped), and on a
// section that is mostly ripple the 99.9th percentile lands on the features.

import { describe, expect, it } from "vitest";

import type { Slice } from "../../api/types";
import { autoLevels } from "../colorScale";
import { DPDF_AUTO_PERCENTILE, withoutOrigin } from "../dpdfLevels";

const section = (n: number, half: number, f: (x: number, y: number) => number, angle = 90): Slice => {
  const axis = Array.from({ length: n }, (_v, i) => -half + (2 * half * i) / (n - 1));
  const data = new Float32Array(n * n);
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) data[iy * n + ix] = f(axis[ix], axis[iy]);
  return {
    header: { nx: n, ny: n, x_axis: axis, y_axis: axis, x_label: "x", y_label: "y", cut_label: "z=0", robust_max: 0, axes_angle: angle },
    data,
  };
};

describe("withoutOrigin", () => {
  it("blanks the disk within 5 % of the half-width, in Cartesian Å", () => {
    const s = section(101, 50, () => 1);
    const out = withoutOrigin(s);
    const at = (x: number, y: number) => out[(y + 50) * 101 + (x + 50)];
    expect(at(0, 0)).toBeNaN();
    expect(at(2, 0)).toBeNaN(); // r = 2 < 2.5
    expect(at(3, 0)).toBe(1);
    // On a 120° grid, (2, 2) in oblique steps is 2 Å from the origin, not 2.8.
    const hex = withoutOrigin(section(101, 50, () => 1, 120));
    expect(hex[(2 + 50) * 101 + (2 + 50)]).toBeNaN();
    expect(s.data[50 * 101 + 50]).toBe(1); // the slice itself is left alone
  });
});

describe("the 3D-ΔPDF page's Auto", () => {
  it("lands on the features of a section that is mostly ripple", () => {
    // Ripple of amplitude 1 everywhere, a huge origin peak, and a few compact
    // features of 100 (about 0.2 % of the voxels).
    const s = section(201, 50, (x, y) => {
      const r = Math.hypot(x, y);
      if (r < 1) return 1e6;
      const feature = [[20, 0], [-20, 0], [0, 20], [0, -20]].some(([a, b]) => Math.hypot(x - a, y - b) < 1.2);
      return feature ? 100 : Math.sin(3 * x) * Math.cos(3 * y);
    });
    const old = autoLevels([s.data], { signed: true }).hi;
    const auto = autoLevels([withoutOrigin(s)], { signed: true, percentile: DPDF_AUTO_PERCENTILE }).hi;
    expect(old).toBeLessThan(1.01); // the 97th percentile sits on the ripple
    expect(auto).toBe(100); // the 99.9th on the features, the origin peak left out
  });
});
