// The symmetry off the x–y plane (plan 4.3): symmetry_check tests every
// operation of the declared point group, those that move c included, on the
// sections each maps onto sections. Known answers on constructed ΔPDFs
// (constructedDpdf.ts: orbit sums of Gaussian peaks, centrosymmetric, no
// measured data), through the tool against a mocked API, with the check as it
// was (sectionSymmetry: the x–y section through the origin, the cell's in-plane
// operations) beside it where it would have passed a break.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DeltaPdfMeta, VolumeMeta } from "../../api/types";
import {
  GRID_MATCH,
  inPlaneOperations,
  movesC,
  operationName,
  operationSymmetry,
  pointGroup,
  sectionSymmetry,
  SYMMETRY_HOLDS,
  transpose,
  type Mat3,
  type OperationSymmetry,
  type Section,
} from "../metrics/symmetry";
import { callTool, type ToolContext } from "../tools";
import { CUBIC, cut, DECLARED, directGroup, GRID, HEXAGONAL, HKL, orbit, type Cell, type Feature, type Grid } from "./constructedDpdf";

const api = vi.hoisted(() => ({
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const dataset: Dataset = {
  id: "kat",
  temperature: null,
  raw_name: "kat.nxs",
  stem: "kat",
  stages: [
    { name: "raw", exists: true, kind: "hkl", volume_id: "kat.raw" },
    { name: "delta_pdf", exists: true, kind: "delta_pdf", volume_id: "kat.delta_pdf" },
  ],
};
const ctx: ToolContext = { dataset, datasets: [dataset] };

/** The API as a constructed ΔPDF answers it: its meta, its sections, and the raw file's declaration. */
function serve(cell: Cell, features: Feature[], declared: { symmetry: string | null; ops?: Mat3[] }, grid: Grid = GRID): void {
  const range = (axis: number): [number, number] => [-grid.half[axis] * (axis === 2 ? cell.c : cell.a), grid.half[axis] * (axis === 2 ? cell.c : cell.a)];
  const meta: DeltaPdfMeta = {
    id: "kat.delta_pdf",
    shape: [...grid.n] as [number, number, number],
    x_range: range(0),
    y_range: range(1),
    z_range: range(2),
    lattice: { a: cell.a, b: cell.a, c: cell.c, alpha: 90, beta: 90, gamma: cell.gamma },
    q_max: 6,
    planes: ["xy", "xz", "yz"],
  };
  const raw: VolumeMeta = {
    id: "kat.raw",
    stage: "raw",
    kind: "hkl",
    shape: [41, 41, 41],
    h_range: [-4, 4],
    k_range: [-4, 4],
    l_range: [-4, 4],
    lattice: meta.lattice,
    planes: ["hk0", "h0l", "0kl"],
    symmetry: declared.symmetry,
    symmetry_ops: declared.ops ? declared.ops.map((m) => m.map((row) => [...row])) : null,
  };
  api.fetchDpdfMeta.mockResolvedValue(meta);
  api.fetchMeta.mockResolvedValue(raw);
  api.fetchDpdfSlice.mockImplementation(async (_id: string, plane: "xy" | "xz" | "yz", value: number) => cut(cell, features, plane, value, grid));
}

interface Checked {
  sections: string;
  operations: string;
  ops: OperationSymmetry[];
  not_tested?: { op: string; why: string }[];
  holds: string[];
  symmetry_declared: boolean | null;
  verdict: string;
}

async function check(args: Record<string, unknown> = {}) {
  const r = await callTool(ctx, "symmetry_check", args);
  expect(r.ok, r.text).toBe(true);
  // The whole result: a long one reaches the model fitted (readings/fit.ts), its longest lists cut.
  return { out: JSON.parse(r.full ?? r.text) as Checked, fitted: r.full !== undefined, outcome: r.outcomes?.[0] };
}

const byName = (ops: OperationSymmetry[]) => Object.fromEntries(ops.map((o) => [o.op, o]));
const held = (o: OperationSymmetry) => o.rms_difference <= SYMMETRY_HOLDS;

// An operation's product with the inversion, and the entry the two make: the rotation first.
const inverted = (m: Mat3): Mat3 => m.map((row) => row.map((x) => -x + 0));
const pairOf = (rotation: Mat3): string => `${operationName(rotation)} / ${operationName(inverted(rotation))}`;
const MIRROR_C = "two-fold ∥ c / mirror ⊥ c";
/** A group's entries, as symmetry_check reports them: each rotation with its product with the inversion, and the inversion. */
const entriesOf = (generators: Mat3[]): string[] => [
  ...directGroup(generators)
    .slice(1)
    .filter((m) => det(m) > 0)
    .map(pairOf),
  "inversion",
];
const det = (m: Mat3): number =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

/**
 * Each pair of the group's entries tested a member at a time: the rotation
 * alone and its product with the inversion alone give the pair's number (to
 * rounding), on the ΔPDF's sections as the tool reads them.
 */
function expectMembersAgree(sections: Section[], generators: Mat3[]): void {
  const group = directGroup(generators);
  const pairs = byName(operationSymmetry(sections, group, [1, 1, 1])!.ops);
  for (const rotation of group.slice(1).filter((m) => det(m) > 0)) {
    const [alone, other] = [rotation, inverted(rotation)].map((m) => operationSymmetry(sections, [m], [1, 1, 1])!.ops[0]?.rms_difference ?? null);
    const pair = pairs[pairOf(rotation)]?.rms_difference ?? null;
    const msg = `${pairOf(rotation)}: ${alone}, ${other}, the pair ${pair}`;
    expect(alone === null, msg).toBe(other === null);
    expect(pair === null, msg).toBe(alone === null);
    if (alone === null || other === null || pair === null) continue;
    // Equal to rounding: both at rounding's level, or within the last of their two figures.
    const agree = (x: number, y: number) => Math.max(x, y) < 1e-6 || Math.abs(x - y) <= 0.02 * Math.max(x, y);
    expect(agree(alone, other), msg).toBe(true);
    expect(agree(alone, pair), msg).toBe(true);
  }
}

/** The check as it was: the x–y section through the origin against the cell's in-plane operations. */
const oldCheck = (cell: Cell, features: Feature[]) => sectionSymmetry(cut(cell, features, "xy", 0), { a: cell.a, b: cell.a })!;

// Two correlations in general positions and one on an axis, summed over the group's orbit.
const cubicBase = (): Feature[] =>
  orbit(
    [
      { at: [0.3, 0.1, 0.45], amp: 1, width: 0.3 },
      { at: [0.5, 0, 0], amp: -0.6, width: 0.35 },
    ],
    directGroup(DECLARED["m-3m"]),
  );
const hexagonalBase = (): Feature[] =>
  orbit(
    [
      { at: [0.3, 0.1, 0.25], amp: 1, width: 0.35 },
      { at: [0.5, 0, 0], amp: -0.5, width: 0.4 },
    ],
    directGroup(DECLARED["6/mmm"]),
  );
// A correlation off the x–y plane with no partner at −z: a pair ±r on the x–z section, which no mirror ⊥ c keeps.
const offPlane = (at: number[]): Feature => ({ at, amp: 0.8, width: 0.3 });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("the declared group's operations", () => {
  it("closes the declared operations into their group, and names each one by its axis", () => {
    expect(pointGroup(DECLARED["m-3m"])).toHaveLength(48);
    expect(pointGroup(DECLARED["6/mmm"])).toHaveLength(24);
    expect(pointGroup(DECLARED["4/mmm"])).toHaveLength(16);
    expect(pointGroup([[[2, 0, 0], [0, 1, 0], [0, 0, 1]]])).toBeNull(); // not a lattice symmetry
    const names = (generators: Mat3[]) => directGroup(generators).slice(1).map(operationName);
    // The hexagonal six-fold (h, k, l) → (h + k, −h, l) turns a to a + b: 60° about c.
    expect(operationName(transpose(HKL.sixC))).toBe("six-fold ∥ c (60°)");
    expect(operationName(transpose(HKL.mirrorAB))).toBe("mirror ⊥ [1-10]");
    expect(operationName(transpose(HKL.mirrorC))).toBe("mirror ⊥ c");
    expect(operationName(HKL.inversion)).toBe("inversion");
    // (u, v, w) → (w, u, v) turns a to b about [111]: +120°; the transpose of
    // (h, k, l) → (l, h, k), which acts on real space, turns the other way.
    expect(operationName(HKL.threeCubic)).toBe("three-fold ∥ [111] (120°)");
    expect(operationName(transpose(HKL.threeCubic))).toBe("three-fold ∥ [111] (-120°)");
    const cubic = names(DECLARED["m-3m"]);
    expect(new Set(cubic).size).toBe(47); // every one named apart
    expect(cubic).toEqual(expect.arrayContaining(["four-fold ∥ c (90°)", "four-fold ∥ c (-90°)", "two-fold ∥ [110]", "-4 ∥ a (90°)", "-3 ∥ [111] (120°)", "mirror ⊥ [101]"]));
    expect(new Set(names(DECLARED["6/mmm"])).size).toBe(23);
    expect(names(DECLARED["6/mmm"])).toEqual(expect.arrayContaining(["six-fold ∥ c (-60°)", "two-fold ∥ a", "two-fold ∥ [120]", "-6 ∥ c (60°)", "-3 ∥ c (120°)"]));
  });

  it("marks the operations that move c", () => {
    const ops = directGroup(DECLARED["m-3m"]).slice(1);
    // Of m-3m, the ones that keep c are 4mm's: the four-folds and the two-fold ∥ c, the mirrors that contain c.
    expect(ops.filter((m) => !movesC(m)).map(operationName).sort()).toEqual(
      ["four-fold ∥ c (90°)", "four-fold ∥ c (-90°)", "two-fold ∥ c", "mirror ⊥ a", "mirror ⊥ b", "mirror ⊥ [110]", "mirror ⊥ [1-10]"].sort(),
    );
    expect(inPlaneOperations("hexagonal", true).map(movesC)).toEqual([false, false, false, false]);
  });
});

describe("known answers", () => {
  it("a ΔPDF symmetric under m-3m: each of its 23 rotations with its product with the inversion, and the inversion, holds", async () => {
    serve(CUBIC, cubicBase(), { symmetry: "m-3m", ops: DECLARED["m-3m"] });
    const { out, fitted, outcome } = await check();
    expect(out.operations).toBe("declared (m-3m): 47 besides the identity");
    expect(out.sections).toBe("xy at z = 0 Å, xz at y = 0, yz at x = 0");
    expect(out.ops.map((o) => o.op).sort()).toEqual(entriesOf(DECLARED["m-3m"]).sort());
    expect(out.ops).toHaveLength(24);
    expect(out.not_tested).toBeUndefined();
    for (const o of out.ops) {
      expect(o.rms_difference, o.op).toBeLessThan(1e-6);
      expect(o.pairs, o.op).toBeGreaterThan(1000);
      expect(o.tested_on, o.op).not.toMatch(/^points/);
    }
    // No moves_c: every pair holds a member that moves c (the inversion's
    // product of an operation that keeps c sends c to −c), so tested_on says
    // where each was tested instead.
    expect(out.ops.some((o) => "moves_c" in o)).toBe(false);
    const by = byName(out.ops);
    // Each entry on the sections it maps onto one another. On the x–y section
    // through the origin the two-fold ∥ c sends every voxel to its inverse: it is tested off it.
    expect(by[MIRROR_C].tested_on).toBe("xz; yz");
    expect(by["three-fold ∥ [111] (120°) / -3 ∥ [111] (120°)"].tested_on).toBe("xy↔xz; xy↔yz; xz↔yz");
    expect(by["four-fold ∥ c (90°) / -4 ∥ c (90°)"].tested_on).toBe("xy; xz↔yz");
    // The two-fold ∥ a sends every voxel of the y–z section to its inverse.
    expect(by["two-fold ∥ a / mirror ⊥ a"].tested_on).toBe("xy; xz");
    expect(outcome).toMatchObject({ check: "symmetry", kind: "pass", reasons: [] });
    expect(out.verdict).toBe("kept: every operation tested holds to 0.001 or better");
    // The model reads the whole of it.
    expect(fitted).toBe(false);
    expectMembersAgree(sectionsOf(CUBIC, cubicBase()), DECLARED["m-3m"]);
  });

  it("the same with its mirror ⊥ c broken: the mirror fails, where the check as it was passed every in-plane operation", async () => {
    const features = [...cubicBase(), offPlane([0.35, 0, 0.4])];
    // As it was: the x–y section through the origin, which the correlation does not reach.
    const before = oldCheck(CUBIC, features);
    expect(before.ops.map((o) => o.op)).toEqual(["mirror ⊥ a", "mirror ⊥ b", "two-fold (180°)", "four-fold (90°)"]);
    for (const o of before.ops) expect(o.rms_difference, o.op).toBeLessThan(1e-5);

    serve(CUBIC, features, { symmetry: "m-3m", ops: DECLARED["m-3m"] });
    const { out, outcome } = await check();
    const by = byName(out.ops);
    expect(by[MIRROR_C]).toMatchObject({ tested_on: "xz; yz" });
    expect(by[MIRROR_C].rms_difference).toBeGreaterThan(0.05);
    // The ΔPDF is centrosymmetric, so the mirror ⊥ c is the two-fold ∥ c times
    // the inversion: the two break together, by as much (each member alone
    // gives the pair's number). On the x–y section through the origin, where
    // the check looked, every operation that keeps c holds.
    expectMembersAgree(sectionsOf(CUBIC, features), DECLARED["m-3m"]);
    const [xy] = sectionsOf(CUBIC, features);
    const inPlane = directGroup(DECLARED["m-3m"]).filter((m) => !movesC(m));
    for (const o of operationSymmetry([xy], inPlane, [1, 1, 1])!.ops) expect(o.rms_difference, o.op).toBeLessThan(1e-5);
    expect(outcome).toMatchObject({ kind: "attention", reasons: ["symmetry broken"] });
    expect(out.verdict).toMatch(/^not kept: .*two-fold ∥ c \/ mirror ⊥ c \(/);
  });

  it("a hexagonal 6/mmm ΔPDF: every entry holds with the mirror ⊥ c intact; broken, the mirror fails where the check as it was passed", async () => {
    serve(HEXAGONAL, hexagonalBase(), { symmetry: "6/mmm", ops: DECLARED["6/mmm"] });
    const intact = await check();
    expect(intact.out.operations).toBe("declared (6/mmm): 23 besides the identity");
    expect(intact.out.ops.map((o) => o.op).sort()).toEqual(entriesOf(DECLARED["6/mmm"]).sort());
    expect(intact.out.ops).toHaveLength(12);
    for (const o of intact.out.ops) expect(o.rms_difference, o.op).toBeLessThan(1e-6);
    expect(byName(intact.out.ops)[MIRROR_C]).toMatchObject({ tested_on: "xz; yz" });
    expect(intact.outcome).toMatchObject({ kind: "pass" });
    expectMembersAgree(sectionsOf(HEXAGONAL, hexagonalBase()), DECLARED["6/mmm"]);

    const features = [...hexagonalBase(), offPlane([0.4, 0, 0.35])];
    for (const o of oldCheck(HEXAGONAL, features).ops) expect(o.rms_difference, o.op).toBeLessThan(1e-5);
    serve(HEXAGONAL, features, { symmetry: "6/mmm", ops: DECLARED["6/mmm"] });
    const broken = await check();
    const by = byName(broken.out.ops);
    expect(by[MIRROR_C].rms_difference).toBeGreaterThan(0.05);
    expect(by["six-fold ∥ c (60°) / -6 ∥ c (60°)"].tested_on).toBe("xy; xz↔yz");
    expect(broken.outcome).toMatchObject({ kind: "attention", reasons: ["symmetry broken"] });
    expectMembersAgree(sectionsOf(HEXAGONAL, features), DECLARED["6/mmm"]);
  });

  it("a cubic three-fold broken while every in-plane operation holds: the three-folds fail", async () => {
    // 4/mmm's orbit of a correlation at (½, 0, ¼): it keeps every operation of 4/mmm, those that keep c and the mirror ⊥ c among them, but no three-fold.
    const features = [...cubicBase(), ...orbit([{ at: [0.5, 0, 0.25], amp: 0.7, width: 0.3 }], directGroup(DECLARED["4/mmm"]))];
    for (const o of oldCheck(CUBIC, features).ops) expect(o.rms_difference, o.op).toBeLessThan(1e-6);
    serve(CUBIC, features, { symmetry: "m-3m", ops: DECLARED["m-3m"] });
    const { out, outcome } = await check();
    // 4/mmm's entries hold, and only they.
    expect(out.ops.filter(held).map((o) => o.op).sort()).toEqual(entriesOf(DECLARED["4/mmm"]).sort());
    expect(held(byName(out.ops)[MIRROR_C])).toBe(true);
    const threeFolds = out.ops.filter((o) => o.op.startsWith("three-fold"));
    expect(threeFolds).toHaveLength(4 * 2);
    for (const o of threeFolds) expect(o.rms_difference, o.op).toBeGreaterThan(0.05);
    expect(outcome).toMatchObject({ kind: "attention", reasons: ["symmetry broken"] });
    expectMembersAgree(sectionsOf(CUBIC, features), DECLARED["m-3m"]);
  });
});

describe("where an operation is tested", () => {
  it("with z, compares the x–y section at z with the one at −z for an operation that sends z to −z", async () => {
    const features = [...cubicBase(), { at: [0.3, 0.2, 0.4], amp: 0.8, width: 0.3 }];
    serve(CUBIC, features, { symmetry: "m-3m", ops: DECLARED["m-3m"] });
    const { out } = await check({ z: 1.6 });
    expect(api.fetchDpdfSlice).toHaveBeenCalledWith("kat.delta_pdf", "xy", 1.6);
    expect(api.fetchDpdfSlice).toHaveBeenCalledWith("kat.delta_pdf", "xy", expect.closeTo(-1.6, 9));
    expect(out.sections).toBe("xy at z = 1.6 and -1.6 Å, xz at y = 0, yz at x = 0");
    const by = byName(out.ops);
    // Tested as the two-fold ∥ c, which keeps each x–y section; the mirror ⊥ c
    // alone compares the one at z with the one at −z, and gives the same number.
    expect(by[MIRROR_C].tested_on).toBe("xy z=1.6; xy z=-1.6; xz; yz");
    // The correlation at (0.3, 0.2, 0.4) lies on the section at z = 1.6 Å only: there the pair fails.
    expect(by[MIRROR_C].rms_difference).toBeGreaterThan(0.05);
    expect(by["four-fold ∥ c (90°) / -4 ∥ c (90°)"].tested_on).toBe("xy z=1.6; xy z=-1.6; xz↔yz");
    const mirror = operationSymmetry(sectionsAt(CUBIC, features, [["xy", 8], ["xy", -8], ["xz", 0], ["yz", 0]]), [transpose(HKL.mirrorC)], [1, 1, 1])!;
    expect(mirror.ops[0]).toMatchObject({ op: "mirror ⊥ c", tested_on: "xy z=1.6↔xy z=-1.6; xz; yz" });
    expectMembersAgree(sectionsAt(CUBIC, features, [["xy", 8], ["xy", -8], ["xz", 0], ["yz", 0]]), DECLARED["m-3m"]);
  });

  it("an operation that maps none of the sections onto one is tested on the voxels it maps from one onto another", () => {
    // The x–y section at z = 8 voxels and the x–z section through the origin:
    // the three-fold (u, v, w) → (v, w, u) maps neither onto a section held,
    // only lines of each onto the one or the other: the row u = 8 of the first
    // onto itself (40 voxels, (8, 8, 8) left where it is), the column u = 8 of
    // the second onto the first's line u = 0 (41), and its x axis onto its own
    // z axis (39 more: the origin stays, and (8, 0, 8) lies on both sections).
    const three = transpose(HKL.threeCubic);
    const symmetric = sectionsAt(CUBIC, cubicBase(), [["xy", 8], ["xz", 0]]);
    const ok = operationSymmetry(symmetric, [three], [1, 1, 1])!;
    expect(ok.ops[0]).toMatchObject({ op: "three-fold ∥ [111] (-120°)", tested_on: "points on xy z=1.6, xz", pairs: 119 });
    expect(ok.ops[0].rms_difference).toBeLessThan(1e-6);
    // A correlation on one of those lines, at (0, 0.3, 0.4): its image is not one, and the points see the break.
    const broken = sectionsAt(CUBIC, [...cubicBase(), { at: [0, 0.3, 0.4], amp: 0.8, width: 0.3 }], [["xy", 8], ["xz", 0]]);
    expect(operationSymmetry(broken, [three], [1, 1, 1])!.ops[0].rms_difference).toBeGreaterThan(0.05);
  });

  it("does not test an operation that mixes axes whose grid steps differ, and says so in the verdict", async () => {
    // 41 points along a and b, 31 along c, over ±1 cell: the steps along c are 4/3 of those along a and b.
    const grid: Grid = { n: [41, 41, 31], half: [1, 1, 1] };
    serve(CUBIC, cubicBase(), { symmetry: "m-3m", ops: DECLARED["m-3m"] }, grid);
    const { out, outcome } = await check();
    const mixesC = (m: Mat3) => m[2][0] !== 0 || m[2][1] !== 0 || m[0][2] !== 0 || m[1][2] !== 0;
    const rotations = directGroup(DECLARED["m-3m"])
      .slice(1)
      .filter((m) => det(m) > 0);
    expect(out.not_tested!.map((o) => o.op).sort()).toEqual(rotations.filter(mixesC).map(pairOf).sort());
    expect(out.not_tested).toHaveLength(16);
    expect(out.not_tested![0].why).toMatch(/^the grid's steps along [abc] and [abc] differ: it does not map voxels onto voxels$/);
    expect(out.ops.map((o) => o.op).sort()).toEqual([...rotations.filter((m) => !mixesC(m)).map(pairOf), "inversion"].sort());
    for (const o of out.ops) expect(o.rms_difference, o.op).toBeLessThan(1e-6);
    expect(outcome).toMatchObject({ kind: "pass" });
    expect(out.verdict).toBe(`kept: every operation tested holds to 0.001 or better; ${out.not_tested!.length} could not be tested (not_tested says why)`);
    expect(GRID_MATCH).toBe(0.05);
  });

  it("judges nothing where it could test nothing, and says why: no evidence never passes", async () => {
    const notJudged = async (why: string) => {
      const r = await callTool(ctx, "symmetry_check", {});
      const out = JSON.parse(r.text) as { verdict: string; not_tested?: unknown[] };
      expect(out.verdict).toBe(`not judged: ${why}`);
      expect(r.outcomes).toMatchObject([{ check: "symmetry", kind: "info", reasons: ["nothing to judge"], words: out.verdict }]);
      return out;
    };
    // Every operation untested: the three-fold alone, on a grid whose steps differ along every axis it mixes.
    serve(CUBIC, cubicBase(), { symmetry: "3", ops: [HKL.threeCubic] }, { n: [41, 37, 31], half: [1, 1, 1] });
    const untested = await notJudged("none of the 2 entries could be tested on the sections (not_tested says why)");
    expect(untested.not_tested).toHaveLength(2);
    // Sections with no voxel at the origin: 40 points over ±1 cell.
    serve(CUBIC, cubicBase(), { symmetry: "m-3m", ops: DECLARED["m-3m"] }, { n: [40, 40, 40], half: [1, 1, 1] });
    await notJudged("the sections are not centred on the origin");
    // No operations declared, and a cell with no in-plane operations to fall back on.
    serve({ a: 4, c: 6, gamma: 105 }, cubicBase(), { symmetry: "2/m" });
    await notJudged("no operations are declared, and the cell is neither hexagonal nor orthogonal");
  });

  it("with no operations declared, tests the cell's in-plane ones, off the x–y plane too, and judges them only where a symmetry is named", async () => {
    serve(HEXAGONAL, hexagonalBase(), { symmetry: "6/mmm" });
    const named = await check();
    expect(named.out.operations).toBe("the cell's in-plane ones (hexagonal): no operations declared");
    // None has its product with the inversion among them: each is its own entry.
    expect(named.out.ops.map((o) => [o.op, o.tested_on])).toEqual([
      ["six-fold ∥ c (60°)", "xy; xz↔yz"],
      ["three-fold ∥ c (120°)", "xy; xz↔yz"],
      ["two-fold ∥ c", "xz; yz"],
      ["mirror ⊥ [1-10]", "xy; xz↔yz"],
    ]);
    expect(named.outcome).toMatchObject({ kind: "pass" });

    serve(HEXAGONAL, [...hexagonalBase(), offPlane([0.4, 0, 0.35])], { symmetry: null });
    const none = await check();
    expect(none.out.symmetry_declared).toBe(false);
    expect(none.outcome).toMatchObject({ kind: "info", reasons: ["not declared"] });
    expect(none.out.verdict).toMatch(/^not judged: the file declares no symmetry, so the sections' asymmetry \(0\.\d+\)/);
  });
});

/** The sections the tool reads at z = 0, as Section objects (offsets from the origin voxel). */
function sectionsOf(cell: Cell, features: Feature[]): Section[] {
  return sectionsAt(cell, features, [["xy", 0], ["xz", 0], ["yz", 0]]);
}

/** Sections at voxel offsets along their fixed axes, on the default grid, named as the tool names them. */
function sectionsAt(cell: Cell, features: Feature[], which: [Section["plane"], number][]): Section[] {
  const step = (axis: number) => ((2 * GRID.half[axis]) / (GRID.n[axis] - 1)) * (axis === 2 ? cell.c : cell.a);
  const fixedAxis = { xy: 2, xz: 1, yz: 0 } as const;
  return which.map(([plane, at]) => {
    const value = at * step(fixedAxis[plane]);
    const label = at === 0 ? plane : `${plane} ${"xyz"[fixedAxis[plane]]}=${Math.round(value * 1000) / 1000}`;
    return { plane, at, label, slice: cut(cell, features, plane, value) };
  });
}
