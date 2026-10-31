// The Configure page's reading of the symmetry average's Laue class
// (state/laue.ts): the NeXus Viewer's presets, closure order, labels, metric
// check and grid check, as the backend's nebula3d.symmetry reads them. The
// presets and the closed groups in the viewer's order, and its metric change,
// come from the fixture the Python tests pin against the viewer's own code
// (tests/fixtures/viewer_symmetry_average.json, scripts/viewer_symmetry_fixture.py).

import { describe, expect, it } from "vitest";

import viewer from "../../../../tests/fixtures/viewer_symmetry_average.json";
import { closeGroup, formatOp, gridProblem, groupLabel, LAUE_PRESETS, laueGroup, METRIC_TOLERANCE, metricChange, parseOps, ubUnknown } from "../laue";

const fixture = viewer as unknown as {
  presets: { names: string[]; ops: Record<string, string[]> };
  metric: number[];
};

// Busing–Levy B (physics convention, 2π), as nebula3d.utils.ub_from_lattice builds it.
function ubFromCell(a: number, b: number, c: number, alpha: number, beta: number, gamma: number): number[][] {
  const r = Math.PI / 180;
  const [ca, cb, cg] = [alpha, beta, gamma].map((x) => Math.cos(x * r));
  const sg = Math.sin(gamma * r);
  const vol = a * b * c * Math.sqrt(1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg);
  // Reciprocal lengths and angles.
  const as = (b * c * Math.sin(alpha * r)) / vol;
  const bs = (a * c * Math.sin(beta * r)) / vol;
  const cs = (a * b * sg) / vol;
  const cbs = (ca * cg - cb) / (Math.sin(alpha * r) * sg);
  const cgs = (ca * cb - cg) / (Math.sin(alpha * r) * Math.sin(beta * r));
  const sbs = Math.sqrt(1 - cbs * cbs), sgs = Math.sqrt(1 - cgs * cgs);
  // B[1][2] takes the direct cos α: then BᵀB is the reciprocal metric.
  const B = [
    [as, bs * cgs, cs * cbs],
    [0, bs * sgs, -cs * sbs * ca],
    [0, 0, 1 / c],
  ];
  return B.map((row) => row.map((x) => 2 * Math.PI * x));
}

// The test's cells and classes, in the order of tests/test_symmetry_average.py METRIC_CELLS.
const METRIC_CELLS: [number[], string][] = [
  [[4.2, 4.2, 6.8, 90, 90, 120], "6/mmm"],
  [[4.2, 4.23, 6.8, 90, 90, 120.3], "6/mmm"],
  [[4.2, 4.2, 6.8, 90, 90, 120], "mmm"],
  [[5, 5, 5, 90, 90, 90], "m-3m"],
  [[5, 5.04, 4.97, 90, 90.4, 90], "m-3m"],
  [[5, 6, 7, 90, 101, 90], "2/m (b unique)"],
];

describe("the Laue classes", () => {
  it("are the viewer's presets, closed in its order", () => {
    expect(LAUE_PRESETS.map(([n]) => n)).toEqual(fixture.presets.names);
    for (const [name] of LAUE_PRESETS) {
      const group = laueGroup(name);
      expect(group.label).toBe(name);
      expect(group.ops.map(formatOp)).toEqual(fixture.presets.ops[name]);
    }
  });

  it("read generators as the viewer does, real-space ones too", () => {
    expect(laueGroup("h+k,-h,l; -k,-h,-l; -h,-k,-l").label).toBe("6/mmm");
    expect(laueGroup("x-y,x,z; -x,-y,-z").label).toBe("6/m");
    expect(laueGroup(" 6/MMM ").label).toBe("6/mmm");
    expect(laueGroup("-k,h,l").label).toBe("custom");
    expect(groupLabel(closeGroup(parseOps("k,-h,l; -h,-k,-l")))).toBe("4/m");
  });

  it("refuse what the viewer would not read", () => {
    expect(() => laueGroup("")).toThrow(/Choose a Laue class/);
    expect(() => laueGroup("6/mm")).toThrow(/not a Laue class here/);
    expect(() => laueGroup("h,k")).toThrow(/three comma-separated components/);
    expect(() => laueGroup("h+1,k,l")).toThrow(/Cannot read/);
    expect(() => laueGroup("2h,k,l")).toThrow(/determinant 2/);
    expect(() => laueGroup("h+k,-h,l; k,l,h")).toThrow(/more than 48 operations/);
  });
});

describe("the metric check", () => {
  it("is the viewer's", () => {
    METRIC_CELLS.forEach(([cell, laue], i) => {
      const [a, b, c, al, be, ga] = cell;
      const got = metricChange(laueGroup(laue).ops, ubFromCell(a, b, c, al, be, ga));
      expect(Math.abs(got - fixture.metric[i])).toBeLessThan(1e-9 * Math.max(1, fixture.metric[i]) + 1e-12);
    });
    expect(METRIC_TOLERANCE).toBe(0.02);
  });

  it("knows the identity UB for none", () => {
    expect(ubUnknown([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBe(true);
    expect(ubUnknown(ubFromCell(5, 5, 5, 90, 90, 90))).toBe(false);
    expect(ubUnknown(undefined)).toBe(true);
  });
});

describe("the grid check", () => {
  const cube = { shape: [41, 41, 41], ranges: [[-4, 4], [-4, 4], [-4, 4]] };
  it("passes a grid the operations map onto itself", () => {
    expect(gridProblem(laueGroup("m-3m").ops, cube)).toBeNull();
    expect(gridProblem(laueGroup("6/mmm").ops, { shape: [41, 41, 21], ranges: [[-4, 4], [-4, 4], [-2, 2]] })).toBeNull();
    // asymmetric but with a bin at 0
    expect(gridProblem(laueGroup("mmm").ops, { shape: [36, 41, 41], ranges: [[-3, 4], [-4, 4], [-4, 4]] })).toBeNull();
  });
  it("names the operation that does not, and what it needs", () => {
    expect(gridProblem(laueGroup("m-3m").ops, { shape: [41, 41, 21], ranges: [[-4, 4], [-4, 4], [-4, 4]] })).toMatch(/mixes axes whose steps differ/);
    // A grid symmetric about 0 with an edge there maps onto itself under sign
    // flips; one off by a quarter step does not.
    expect(gridProblem(laueGroup("mmm").ops, { shape: [40, 41, 41], ranges: [[-3.9, 3.9], [-4, 4], [-4, 4]] })).toBeNull();
    expect(gridProblem(laueGroup("mmm").ops, { shape: [40, 41, 41], ranges: [[-3.95, 3.85], [-4, 4], [-4, 4]] })).toMatch(/needs a bin centred at 0 along H/);
  });
});
