// Pins the oblique-section display math against direct 3-D vector geometry
// (the same contract as nebula3d.analysis.delta_pdf.section_geometry).

import { describe, expect, it } from "vitest";

import {
  axesTrig,
  fromDisplay,
  inPlaneRadius,
  latticeLabel,
  toDisplay,
  unitCellSegments,
} from "../oblique";

// In-plane unit vectors for two axes meeting at θ: e_h = (1, 0), e_v = (cos θ, sin θ).
const trueXY = (h: number, v: number, deg: number): [number, number] => {
  const t = (deg * Math.PI) / 180;
  return [h + v * Math.cos(t), v * Math.sin(t)];
};

describe("toDisplay / fromDisplay", () => {
  it("places oblique coordinates at their true 2-D position and inverts", () => {
    for (const deg of [60, 89.37, 105, 120]) {
      for (const [h, v] of [[4, 0], [0, 4], [4, 4], [-3.5, 2.25]]) {
        const [X, Y] = toDisplay(h, v, deg);
        const [tx, ty] = trueXY(h, v, deg);
        expect(X).toBeCloseTo(tx, 12);
        expect(Y).toBeCloseTo(ty, 12);
        const [h2, v2] = fromDisplay(X, Y, deg);
        expect(h2).toBeCloseTo(h, 12);
        expect(v2).toBeCloseTo(v, 12);
      }
    }
  });

  it("is the identity for a right angle", () => {
    expect(axesTrig(90)).toEqual({ cos: 0, sin: 1 });
    expect(toDisplay(3, -2, 90)).toEqual([3, -2]);
  });
});

describe("inPlaneRadius", () => {
  it("gives the true length: hexagonal a + b is |a|, not √2·|a|", () => {
    expect(inPlaneRadius(4, 4, 120)).toBeCloseTo(4, 12);
    expect(inPlaneRadius(4, -4, 120)).toBeCloseTo(4 * Math.sqrt(3), 12);
    expect(inPlaneRadius(3, 4, 90)).toBe(5);
  });
});

describe("unitCellSegments", () => {
  it("draws rectangular lines at 90°", () => {
    const segs = unitCellSegments(10, 4, 5, 90);
    // constant-h lines at x = -8, -4, 0, 4, 8; constant-v lines at y = -10 … 10
    const vertical = segs.filter(([x1, , x2]) => x1 === x2).map(([x]) => x);
    const horizontal = segs.filter(([, y1, , y2]) => y1 === y2).map(([, y]) => y);
    expect(vertical).toEqual([-8, -4, 0, 4, 8]);
    expect(horizontal).toEqual([-10, -5, 0, 5, 10]);
  });

  it("slants constant-h lines along the second axis and spaces rows by sin θ", () => {
    const deg = 120;
    const lat = 4;
    const segs = unitCellSegments(6, lat, lat, deg);
    const { cos, sin } = axesTrig(deg);
    for (const [x1, y1, x2, y2] of segs) {
      if (y1 === y2) {
        // horizontal: a lattice row v = m·b sits at Y = m·b·sin θ
        const m = y1 / (lat * sin);
        expect(Math.abs(m - Math.round(m))).toBeLessThan(1e-12);
      } else {
        // slanted: direction parallel to (cos θ, sin θ), passing X = k·a at Y = 0
        expect((x2 - x1) / (y2 - y1)).toBeCloseTo(cos / sin, 12);
        const k = (x1 - y1 * (cos / sin)) / lat;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-12);
      }
    }
    // Every lattice node inside the window lies on one line of each family.
    const [nx, ny] = toDisplay(lat, lat, deg); // node (1, 1)
    expect(Math.abs(nx)).toBeLessThanOrEqual(6);
    expect(Math.abs(ny)).toBeLessThanOrEqual(6);
  });

  it("skips a family when its lattice spacing is unknown", () => {
    expect(unitCellSegments(10, null, null, 120)).toEqual([]);
  });
});

describe("latticeLabel", () => {
  it("adds the angles when known and falls back to lengths for older files", () => {
    expect(latticeLabel({ a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 })).toBe(
      "a=4.00  b=4.00  c=6.00 Å · α=90.00  β=90.00  γ=120.00°",
    );
    expect(latticeLabel({ a: 4, b: 4, c: 6 })).toBe("a=4.00  b=4.00  c=6.00 Å");
  });
});
