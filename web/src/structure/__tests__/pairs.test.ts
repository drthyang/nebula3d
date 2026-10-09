import { describe, expect, it } from "vitest";

import type { Site } from "../cif";
import {
  bestPermutation,
  cellFit,
  cellMatches,
  expandSites,
  pairDifferences,
  permuteAtoms,
  PERMUTATIONS,
  sliceMarkers,
  vectorLength,
  type SliceSpec,
} from "../pairs";
import { symmetryGroup } from "../symops";

// Rock salt: Na at the fcc sites, Cl half a cell along x from each.
const A = 5.64;
const FM3M = symmetryGroup("-x,-y,z; -x,y,-z; z,x,y; y,x,-z; -x,-y,-z", "F");
const NACL: Site[] = [
  { label: "Na1", element: "Na", x: 0, y: 0, z: 0, occ: 1 },
  { label: "Cl1", element: "Cl", x: 0.5, y: 0.5, z: 0.5, occ: 1 },
];
const atoms = expandSites(NACL, FM3M);
const diffs = pairDifferences(atoms);

const xyAt = (cut: number, extra: Partial<SliceSpec> = {}): SliceSpec => ({
  lat: [A, A, A],
  axes: [0, 1, 2],
  cut,
  depth: 0.01,
  hRange: [-A, A],
  vRange: [-A, A],
  ...extra,
});

const at = (ms: ReturnType<typeof sliceMarkers>, h: number, v: number, key: string) =>
  ms.find((m) => Math.abs(m.h - h) < 1e-6 && Math.abs(m.v - v) < 1e-6 && m.key === key);

describe("expandSites", () => {
  it("puts four Na and four Cl in the cell", () => {
    expect(atoms.filter((a) => a.element === "Na")).toHaveLength(4);
    expect(atoms.filter((a) => a.element === "Cl")).toHaveLength(4);
    for (const a of atoms) for (const v of a.frac) expect(v >= 0 && v < 1).toBe(true);
  });
});

describe("pairDifferences", () => {
  it("accounts for every ordered pair of atoms in the cell", () => {
    expect(diffs.reduce((n, d) => n + d.count, 0)).toBe(64);
  });

  it("keys pairs by element, in site order", () => {
    expect(new Set(diffs.map((d) => d.key))).toEqual(new Set(["Na–Na", "Na–Cl", "Cl–Cl"]));
  });
});

describe("sliceMarkers", () => {
  const ms = sliceMarkers(diffs, xyAt(0));

  it("places the nearest Na–Cl vector at a/2 with both directions counted", () => {
    const m = at(ms, A / 2, 0, "Na–Cl");
    expect(m?.mult).toBe(8); // 4 Na→Cl + 4 Cl→Na
    expect(m?.u).toEqual([A / 2, 0, 0]);
  });

  it("places the fcc Na–Na and Cl–Cl vectors as separate markers", () => {
    expect(at(ms, A / 2, A / 2, "Na–Na")?.mult).toBe(4);
    expect(at(ms, A / 2, A / 2, "Cl–Cl")?.mult).toBe(4);
    expect(at(ms, A / 2, A / 2, "Na–Cl")).toBeUndefined();
  });

  it("skips the zero vector but keeps lattice vectors", () => {
    expect(ms.some((m) => m.h === 0 && m.v === 0)).toBe(false);
    expect(at(ms, A, 0, "Na–Na")?.mult).toBe(4);
  });

  it("keeps vectors only within the slab around the cut", () => {
    expect(sliceMarkers(diffs, xyAt(0.3))).toHaveLength(0);
    const half = sliceMarkers(diffs, xyAt(A / 2));
    expect(at(half, 0, 0, "Na–Cl")?.u).toEqual([0, 0, A / 2]);
    expect(at(half, A / 2, A / 2, "Na–Cl")?.mult).toBe(8); // (½, ½, ½)
    const wide = sliceMarkers(diffs, xyAt(0.3, { depth: 0.5 }));
    expect(at(wide, A / 2, 0, "Na–Cl")?.off).toBeCloseTo(-0.3, 12);
  });

  it("filters by origin site and hidden pairs", () => {
    const fromNa = sliceMarkers(diffs, xyAt(0, { origin: "Na1" }));
    expect(at(fromNa, A / 2, 0, "Na–Cl")?.pairs).toEqual([{ from: "Na1", to: "Cl1", count: 4 }]);
    expect(fromNa.some((m) => m.key === "Cl–Cl")).toBe(false);
    const noNaCl = sliceMarkers(diffs, xyAt(0, { hidden: new Set(["Na–Cl"]) }));
    expect(noNaCl.some((m) => m.key === "Na–Cl")).toBe(false);
  });

  it("cuts along any axis", () => {
    const yz = sliceMarkers(diffs, xyAt(A / 2, { axes: [1, 2, 0] }));
    const m = at(yz, 0, 0, "Na–Cl");
    expect(m?.u).toEqual([A / 2, 0, 0]);
  });
});

describe("vectorLength", () => {
  it("uses the cell angles", () => {
    expect(vectorLength([3, 4, 0], [90, 90, 90])).toBeCloseTo(5, 12);
    // a + b in a hexagonal cell (γ = 120°) is as long as a.
    expect(vectorLength([4, 4, 0], [90, 90, 120])).toBeCloseTo(4, 12);
  });
});

describe("cell matching", () => {
  const data = { a: 4, b: 7, c: 11, alpha: 90, beta: 100, gamma: 90 };

  it("matches the same cell with the identity", () => {
    expect(bestPermutation({ ...data, a: 4.05 }, data)).toBe(0);
  });

  it("finds the axis order of a CIF in another setting", () => {
    // The CIF's axes are the data's (c, a, b): data a = CIF b, b = CIF c, c = CIF a.
    const cif = { a: 11, b: 4, c: 7, alpha: 90, beta: 90, gamma: 100 };
    const i = bestPermutation(cif, data);
    expect(i).not.toBeNull();
    expect(PERMUTATIONS[i!]).toEqual([1, 2, 0]);
    expect(cellMatches(cellFit(cif, data, PERMUTATIONS[0]))).toBe(false);
  });

  it("finds none for a different cell", () => {
    expect(bestPermutation({ a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 }, data)).toBeNull();
  });

  it("permutes fractional coordinates", () => {
    const p = permuteAtoms([{ label: "X", element: "X", frac: [0.1, 0.2, 0.3] }], [1, 2, 0]);
    expect(p[0].frac).toEqual([0.2, 0.3, 0.1]);
  });
});
