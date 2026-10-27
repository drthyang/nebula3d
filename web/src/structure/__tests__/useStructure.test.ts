import { describe, expect, it } from "vitest";

import type { StructureDef } from "../../state/structureStore";
import type { Cell } from "../cif";
import { sliceMarkers } from "../pairs";
import { buildModel, cellVolume, MAX_PAIR_ATOMS, structureBlockedText, structureWarningText } from "../useStructure";

const CUBIC = (a: number): Cell => ({ a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 });
const rockSalt = (cell: Cell | null): StructureDef => ({
  name: "NaCl",
  cell,
  sites: [
    { label: "Na1", element: "Na", x: 0, y: 0, z: 0, occ: 1 },
    { label: "Cl1", element: "Cl", x: 0.5, y: 0.5, z: 0.5, occ: 1 },
  ],
  ops: "x,y,z\n-x,-y,z\n-x,y,-z\nz,x,y\ny,x,-z\n-x,-y,-z",
  centering: "F",
  notes: [],
});
const p1 = (n: number, a: number): StructureDef => ({
  name: "super",
  cell: CUBIC(a),
  sites: Array.from({ length: n }, (_, k) => ({ label: `O${k}`, element: "O", x: (k * 0.618) % 1, y: (k * 0.414) % 1, z: (k * 0.732) % 1, occ: 1 })),
  ops: "x, y, z",
  centering: "P",
  notes: [],
});

describe("buildModel", () => {
  it("expands rock salt from generators and its centring", () => {
    const m = buildModel(rockSalt(CUBIC(4.2)), 0, CUBIC(4.2));
    expect([m.nOps, m.atoms.length, m.mismatch, m.tooMany]).toEqual([192, 8, false, false]);
    expect(m.keys).toEqual(["Na–Na", "Na–Cl", "Cl–Cl"]);
    expect(m.diffs.reduce((n, d) => n + d.count, 0)).toBe(64);
    expect(structureBlockedText(m)).toBeNull();
  });

  it("still draws a CIF whose cell differs from the ΔPDF's, at the CIF's own lengths, and warns", () => {
    // rock salt on a 4.2 Å cell against a ΔPDF on a doubled 8.4 Å cell
    const m = buildModel(rockSalt(CUBIC(4.2)), 0, CUBIC(8.4));
    expect(m.mismatch).toBe(true);
    expect(m.atoms.length).toBe(8);
    expect(m.diffs.length).toBeGreaterThan(0);
    expect(m.drawLat).toEqual([4.2, 4.2, 4.2]); // real distances, not stretched onto the 8.4 Å cell
    expect(structureBlockedText(m)).toBeNull();
    expect(structureWarningText(m, "here")).toMatch(/differs from this ΔPDF's by 50\.0 % in length.*CIF's own lengths.*axes here/);
    expect(structureWarningText(m)).not.toMatch(/approximate/);
    // the nearest Na–Cl vector sits at a/2 = 2.1 Å along a, as in the CIF
    const marks = sliceMarkers(m.diffs, {
      lat: m.drawLat!, axes: [0, 1, 2], cut: 0, depth: 0.1, hRange: [-3, 3], vRange: [-3, 3],
    });
    expect(marks.some((k) => k.key === "Na–Cl" && Math.abs(k.h - 2.1) < 1e-9 && Math.abs(k.v) < 1e-9)).toBe(true);
  });

  it("places a matching CIF on the ΔPDF's own cell and does not warn", () => {
    const m = buildModel(rockSalt(CUBIC(4.2)), 0, CUBIC(4.25));
    expect([m.mismatch, m.drawLat]).toEqual([false, [4.25, 4.25, 4.25]]);
    expect(structureWarningText(m)).toBeNull();
  });

  it("says vectors off the axes are approximate when the angles differ too", () => {
    const hex = { a: 4.2, b: 4.2, c: 5, alpha: 90, beta: 90, gamma: 120 };
    const m = buildModel({ ...rockSalt(CUBIC(4.2)), cell: hex }, 0, CUBIC(4.2));
    expect(structureWarningText(m)).toMatch(/30\.0° in angle.*approximate/);
  });

  it("builds no pairs above MAX_PAIR_ATOMS atoms and says why", () => {
    const m = buildModel(p1(MAX_PAIR_ATOMS + 1, 25), 0, CUBIC(25));
    expect([m.atoms.length, m.tooMany, m.diffs.length]).toEqual([MAX_PAIR_ATOMS + 1, true, 0]);
    expect(structureBlockedText(m)).toMatch(new RegExp(`${MAX_PAIR_ATOMS + 1} atoms per cell`));
    // 500 atoms at 0.1 per Å³ (a ≈ 17.1 Å): drawn
    const a = Math.cbrt(MAX_PAIR_ATOMS / 0.1);
    const ok = buildModel(p1(MAX_PAIR_ATOMS, a), 0, CUBIC(a));
    expect([ok.tooMany, ok.tooDense, ok.diffs.length]).toEqual([false, false, MAX_PAIR_ATOMS ** 2]);
  });

  it("builds no pairs for more atoms per Å³ than a crystal holds", () => {
    const m = buildModel(p1(300, 4.2), 0, CUBIC(4.2));
    expect([m.atoms.length, m.tooMany, m.tooDense, m.diffs.length]).toEqual([300, false, true, 0]);
    expect(structureBlockedText(m)).toMatch(/denser than any crystal/);
    expect(cellVolume({ a: 2, b: 2, c: 3, alpha: 90, beta: 90, gamma: 120 })).toBeCloseTo(12 * Math.sin((2 * Math.PI) / 3), 9);
  });

  it("counts the atoms but builds no pairs before the ΔPDF's cell is known", () => {
    const m = buildModel(rockSalt(CUBIC(4.2)), 0, null);
    expect([m.atoms.length, m.diffs.length, m.mismatch]).toEqual([8, 0, false]);
    expect(m.keys).toEqual(["Na–Na", "Na–Cl", "Cl–Cl"]);
  });
});
