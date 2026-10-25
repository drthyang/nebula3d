import { describe, expect, it } from "vitest";

import type { StructureDef } from "../../state/structureStore";
import type { Cell } from "../cif";
import { buildModel, cellVolume, MAX_PAIR_ATOMS, structureBlockedText } from "../useStructure";

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

  it("builds no pairs when the cell does not match the ΔPDF's", () => {
    const m = buildModel(p1(1080, 25.2), 0, CUBIC(4.2));
    expect(m.mismatch).toBe(true);
    expect(m.atoms).toEqual([]);
    expect(m.diffs).toEqual([]);
    expect(m.keys).toEqual(["O–O"]);
    expect(structureBlockedText(m, "here")).toMatch(/does not match.*check the axes here/);
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
