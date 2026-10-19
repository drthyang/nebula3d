// In-plane symmetry of a real-space section through the origin.  The section is
// compared with its image under each operation of the cell's in-plane point
// group: the RMS of the difference over the voxel pairs that are both finite,
// as a share of the section's RMS.  A volume symmetrised over a Laue group and
// processed alike at every equivalent voxel gives a ΔPDF with that symmetry to
// rounding; a share well above that is a stage that broke it (index-space
// neighbourhoods an operation does not map onto themselves), or a symmetry the
// data do not have.  Which operations the sample has is the user's to say: the
// numbers are reported for each.
//
// The section's grid is the FFT's oblique one (x ∥ a, y ∥ b at the cell's
// angle), so an operation is a map of index offsets from the origin voxel:
// on a hexagonal cell the 60° rotation sends u·a + v·b to (u − v)·a + u·b.
//
// sectionSymmetry is the ΔPDF evaluation's (tune/evaluate.ts, its
// max_symmetry_break). symmetry_check tests every operation of the declared
// point group, those that move c included, on the sections each maps onto
// sections: operationSymmetry, below.

import type { GridSlice } from "./sliceStats";
import { roundSig } from "./sliceStats";

// A symmetry the data were symmetrised with holds to rounding when every
// stage treats equivalent voxels alike; past this share it was broken.
export const SYMMETRY_HOLDS = 1e-3;

export interface SectionSymmetry {
  op: string;
  rms_difference: number; // RMS(v − v∘op) / RMS(v) over the pairs
  pairs: number;
}

type OffsetMap = (dx: number, dy: number) => [number, number];

const HEXAGONAL: Record<string, OffsetMap> = {
  "six-fold (60°)": (dx, dy) => [dx - dy, dx],
  "three-fold (120°)": (dx, dy) => [-dy, dx - dy],
  "two-fold (180°)": (dx, dy) => [-dx, -dy],
  "mirror (a ↔ b)": (dx, dy) => [dy, dx],
};

const orthogonal = (square: boolean): Record<string, OffsetMap> => ({
  "mirror ⊥ a": (dx, dy) => [-dx, dy],
  "mirror ⊥ b": (dx, dy) => [dx, -dy],
  "two-fold (180°)": (dx, dy) => [-dx, -dy],
  ...(square ? { "four-fold (90°)": (dx: number, dy: number): [number, number] => [-dy, dx] } : {}),
});

// The index of the axis value nearest 0, if the axis is symmetric about it.
const originIndex = (axis: number[]): number | null => {
  let c = 0;
  for (let i = 1; i < axis.length; i++) if (Math.abs(axis[i]) < Math.abs(axis[c])) c = i;
  const step = axis.length > 1 ? Math.abs(axis[1] - axis[0]) : 1;
  if (Math.abs(axis[c]) > 0.01 * step) return null;
  return c;
};

/** The section's agreement with its images, or null when its grid is not
 * centred on the origin or its cell has no in-plane symmetry to test. */
export const sectionSymmetry = (
  grid: GridSlice,
  cell: { a: number; b: number },
): { kind: "hexagonal" | "orthogonal"; ops: SectionSymmetry[] } | null => {
  const { nx, ny, x_axis, y_axis } = grid.header;
  const angle = grid.header.axes_angle ?? 90;
  const equal = Math.abs(cell.a / cell.b - 1) < 0.01;
  const kind = Math.abs(angle - 120) < 1 && equal ? "hexagonal" : Math.abs(angle - 90) < 1 ? "orthogonal" : null;
  const cx = originIndex(x_axis);
  const cy = originIndex(y_axis);
  if (!kind || cx == null || cy == null) return null;
  const maps = kind === "hexagonal" ? HEXAGONAL : orthogonal(equal);
  const data = grid.data;
  const ops: SectionSymmetry[] = [];
  for (const [op, map] of Object.entries(maps)) {
    let diff2 = 0;
    let val2 = 0;
    let pairs = 0;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const v = data[iy * nx + ix];
        if (!Number.isFinite(v)) continue;
        const [dx, dy] = map(ix - cx, iy - cy);
        const jx = cx + dx;
        const jy = cy + dy;
        if (jx < 0 || jx >= nx || jy < 0 || jy >= ny) continue;
        const w = data[jy * nx + jx];
        if (!Number.isFinite(w)) continue;
        diff2 += (v - w) ** 2;
        val2 += v * v;
        pairs += 1;
      }
    }
    if (pairs && val2 > 0) ops.push({ op, rms_difference: roundSig(Math.sqrt(diff2 / val2), 2), pairs });
  }
  return { kind, ops };
};

// ---------------------------------------------------------------- every operation, in three dimensions
//
// A volume symmetrised over a point group (each operation M acting on
// (h, k, l)) has ΔI(M·h) = ΔI(h), so its ΔPDF has P(Mᵀ·u) = P(u) on the
// fractional coordinates u = (x/a, y/b, z/c): the ΔPDF keeps each operation,
// acting on real space as its transpose. The transform keeps the data's even
// part as well, so P(−u) = P(u) whatever was declared, and an operation and
// its product with the inversion test the same thing: the mirror ⊥ c and the
// two-fold ∥ c break together, by as much, and on the x–y section through
// the origin the two-fold holds by the inversion alone (which is why the
// in-plane check passed a ΔPDF whose mirror ⊥ c was broken).
//
// An operation is tested on the sections it maps onto sections: of the x–y
// sections at ±z (an operation that keeps z maps each onto itself, one that
// sends z to −z maps the one at z onto the one at −z) and the x–z and y–z
// sections through the origin, those whose image is one of them. A voxel the
// operation leaves where it is tests nothing and is left out: on the x–y
// section at z = 0 a mirror ⊥ c leaves every one. An operation that maps none
// of the sections onto one is tested on points: the voxels of each section it
// maps onto another, where its image of the one crosses the other. It maps
// voxels onto voxels only where the grid's steps, in the cell's fractional
// units, are equal along the axes it mixes; elsewhere it is not tested, and
// why is said.

/** An integer 3×3 matrix, rows first, acting on column vectors. */
export type Mat3 = readonly (readonly number[])[];

/** A ΔPDF section's plane: x–y (z fixed), x–z (y fixed) or y–z (x fixed). */
export type Plane = "xy" | "xz" | "yz";

/** A section of the ΔPDF on its grid: its plane, how far its fixed axis is from the origin voxel (in voxels), how tested_on names it ("xy", "xz y=1.2"), and its slice. */
export interface Section {
  plane: Plane;
  at: number;
  label: string;
  slice: GridSlice;
}

/** One operation's test. */
export interface OperationSymmetry {
  op: string;
  rms_difference: number; // the worst section's RMS(v − v∘op) / RMS(v) over its pairs
  pairs: number; // over every section it was tested on
  tested_on: string; // those sections, or the points
  moves_c: boolean; // it moves the c axis (a mirror ⊥ c, a two-fold ⊥ c, a cubic three-fold, the inversion)
}

/** An operation the sections could not test, and why. */
export interface NotTested {
  op: string;
  why: string;
}

/**
 * The largest shift, in voxels at the grid's edge, that an operation may make
 * of a voxel and still be compared voxel to voxel: the grid's steps along the
 * axes it mixes must be this close to equal. A refined cell's lengths, rounded,
 * stay far inside it; a grid with one point more or fewer along one of the
 * axes shifts the edge by half a voxel.
 */
export const GRID_MATCH = 0.05;

const IDENTITY: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const det3 = (m: Mat3): number =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const mul3 = (a: Mat3, b: Mat3): number[][] => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j] + 0));
const keyOf = (m: Mat3): string => m.map((row) => row.join(",")).join(";");
const cross = (a: readonly number[], b: readonly number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const times = (m: Mat3, v: readonly number[]): number[] => m.map((row) => dot(row, v));

/** A matrix's transpose: how an operation on (h, k, l) acts on the ΔPDF's fractional coordinates. */
export const transpose = (m: Mat3): number[][] => [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i]));

/**
 * The group the operations generate, the identity first; null when one is not
 * an integer 3×3 matrix of determinant ±1, or they generate more than 48
 * elements (no crystallographic point group).
 */
export function pointGroup(ops: readonly Mat3[]): Mat3[] | null {
  const integer = (m: Mat3) => m.length === 3 && m.every((row) => row.length === 3 && row.every((x) => Number.isInteger(x)));
  if (ops.some((m) => !integer(m) || Math.abs(det3(m)) !== 1)) return null;
  const seen = new Map<string, Mat3>([[keyOf(IDENTITY), IDENTITY]]);
  let frontier: Mat3[] = [IDENTITY];
  while (frontier.length) {
    const next: Mat3[] = [];
    for (const a of frontier) {
      for (const b of ops) {
        const c = mul3(a, b);
        const key = keyOf(c);
        if (!seen.has(key)) {
          seen.set(key, c);
          next.push(c);
        }
      }
    }
    if (seen.size > 48) return null;
    frontier = next;
  }
  return [...seen.values()];
}

/** The cell's in-plane operations on its fractional coordinates, as symmetry_check tested them before it tested every declared one: what it tests where none is declared. */
export function inPlaneOperations(kind: "hexagonal" | "orthogonal", square: boolean): Mat3[] {
  const keepingZ = (m: number[][]): Mat3 => [...m.map((row) => [...row, 0]), [0, 0, 1]];
  const inPlane =
    kind === "hexagonal"
      ? [
          [[1, -1], [1, 0]], // the six-fold (60°): u·a + v·b → (u − v)·a + u·b
          [[0, -1], [1, -1]], // the three-fold (120°)
          [[-1, 0], [0, -1]], // the two-fold
          [[0, 1], [1, 0]], // the a ↔ b mirror
        ]
      : [
          [[-1, 0], [0, 1]], // the mirror ⊥ a
          [[1, 0], [0, -1]], // the mirror ⊥ b
          [[-1, 0], [0, -1]], // the two-fold
          ...(square ? [[[0, -1], [1, 0]]] : []), // the four-fold (90°)
        ];
  return inPlane.map(keepingZ);
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** A lattice direction as the smallest integers [uvw], its first non-zero index positive. */
function direction(v: readonly number[]): number[] {
  const g = v.reduce((s, x) => gcd(s, x), 0) || 1;
  const sign = Math.sign(v.find((x) => x !== 0) ?? 1);
  return v.map((x) => (sign * x) / g + 0);
}

/** A direction as its axis (a, b, c) where it is one, else [uvw]. */
function directionName(d: readonly number[]): string {
  const nonzero = d.filter((x) => x !== 0);
  if (nonzero.length === 1 && nonzero[0] === 1) return "abc"[d.indexOf(1)];
  return `[${d.join("")}]`;
}

/** The axis of a proper rotation other than the identity: the direction R − I sends to nothing. */
function axisOf(r: Mat3): number[] {
  const rows = r.map((row, i) => row.map((x, j) => x - (i === j ? 1 : 0)));
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const c = cross(rows[i], rows[j]);
      if (c.some((x) => x !== 0)) return direction(c);
    }
  }
  return [0, 0, 1];
}

const FOLD: Record<number, string> = { 2: "two", 3: "three", 4: "four", 6: "six" };
// A proper rotation's order from its trace, 1 + 2 cos θ.
const ORDER: Record<number, number> = { [-1]: 2, 0: 3, 1: 4, 2: 6 };

/**
 * An operation's name, from its matrix on the fractional coordinates: a
 * rotation by its axis and angle ("four-fold ∥ c (90°)", the angle's sign
 * right-handed about the axis, on a right-handed cell), a mirror by the axis
 * it is perpendicular to ("mirror ⊥ [1-10]"), a rotoinversion as -n
 * ("-3 ∥ [111] (120°)"), and the inversion.
 */
export function operationName(m: Mat3): string {
  const proper = det3(m) > 0;
  const r = proper ? m : m.map((row) => row.map((x) => -x));
  const t = r[0][0] + r[1][1] + r[2][2];
  if (t === 3) return proper ? "identity" : "inversion";
  const n = ORDER[t];
  const axis = axisOf(r);
  const where = directionName(axis);
  if (n === 2) return proper ? `two-fold ∥ ${where}` : `mirror ⊥ ${where}`;
  // The sense: a vector off the axis, turned by R, goes round the axis one way or the other.
  const off = IDENTITY.find((e) => cross(axis, e).some((x) => x !== 0))!;
  const angle = (360 / n) * Math.sign(dot(axis, cross(off, times(r, off))));
  return proper ? `${FOLD[n]}-fold ∥ ${where} (${angle}°)` : `-${n} ∥ ${where} (${angle}°)`;
}

/** Whether an operation moves the c axis. */
export const movesC = (m: Mat3): boolean => m[0][2] !== 0 || m[1][2] !== 0 || m[2][2] !== 1;

// The axes a plane's slice spans (its x, then its y) and the one it fixes.
const PLANE_AXES: Record<Plane, readonly [number, number, number]> = { xy: [0, 1, 2], xz: [0, 2, 1], yz: [1, 2, 0] };

interface Prepared {
  section: Section;
  p: number; // the axis along the slice's x
  q: number; // the axis along its y
  k: number; // the axis it fixes
  ox: number; // the origin voxel's index along the slice's x
  oy: number; // ... and along its y
  nx: number;
  ny: number;
}

/** The section's value at the voxel offset (d0, d1, d2) from the origin, or undefined where it does not hold that voxel. */
function valueAt(s: Prepared, d0: number, d1: number, d2: number): number | undefined {
  const along = (axis: number) => (axis === 0 ? d0 : axis === 1 ? d1 : d2);
  if (along(s.k) !== s.section.at) return undefined;
  const ix = s.ox + along(s.p);
  const iy = s.oy + along(s.q);
  if (ix < 0 || ix >= s.nx || iy < 0 || iy >= s.ny) return undefined;
  return s.section.slice.data[iy * s.nx + ix];
}

/** Whether m maps the whole of section s into section t's plane. */
const mapsOnto = (m: Mat3, s: Prepared, t: Prepared): boolean => {
  const row = m[t.k];
  return row[s.p] === 0 && row[s.q] === 0 && row[s.k] * s.section.at === t.section.at;
};

interface Tally {
  label: string;
  diff2: number;
  val2: number;
  pairs: number;
}

// A voxel offset as one number (offsets well inside ±2¹⁵).
const voxelKey = (d0: number, d1: number, d2: number): number => ((d0 + 32768) * 65536 + (d1 + 32768)) * 65536 + (d2 + 32768);

/**
 * Compare each voxel of `from` with its image under m wherever one of
 * `targets` holds the image. A voxel m leaves where it is tests nothing and is
 * skipped, as is one already in `seen`.
 */
function compare(m: Mat3, from: Prepared, targets: readonly Prepared[], tally: Tally, seen: Set<number> | null): void {
  const { data } = from.section.slice;
  const d = [0, 0, 0];
  d[from.k] = from.section.at;
  for (let iy = 0; iy < from.ny; iy++) {
    d[from.q] = iy - from.oy;
    for (let ix = 0; ix < from.nx; ix++) {
      const v = data[iy * from.nx + ix];
      if (!Number.isFinite(v)) continue;
      d[from.p] = ix - from.ox;
      const e0 = m[0][0] * d[0] + m[0][1] * d[1] + m[0][2] * d[2];
      const e1 = m[1][0] * d[0] + m[1][1] * d[1] + m[1][2] * d[2];
      const e2 = m[2][0] * d[0] + m[2][1] * d[1] + m[2][2] * d[2];
      if (e0 === d[0] && e1 === d[1] && e2 === d[2]) continue;
      let w: number | undefined;
      for (const t of targets) {
        w = valueAt(t, e0, e1, e2);
        if (w !== undefined) break;
      }
      if (w === undefined || !Number.isFinite(w)) continue;
      if (seen) {
        const key = voxelKey(d[0], d[1], d[2]);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      tally.diff2 += (v - w) ** 2;
      tally.val2 += v * v;
      tally.pairs += 1;
    }
  }
}

const CELL_AXES = ["a", "b", "c"];

/** Where m's steps do not match: the axis along which a voxel at the grid's edge is shifted most, the axis it mixes in most, and the shift (voxels). */
function gridMismatch(m: Mat3, steps: readonly number[], half: readonly number[]): { along: number; from: number; shift: number } {
  let worst = { along: 0, from: 0, shift: 0 };
  for (let i = 0; i < 3; i++) {
    let shift = 0;
    let from = i;
    let most = 0;
    for (let j = 0; j < 3; j++) {
      if (j === i || m[i][j] === 0) continue;
      const part = Math.abs(m[i][j] * (steps[j] / steps[i] - 1)) * half[j];
      shift += part;
      if (part >= most) [most, from] = [part, j];
    }
    if (shift > worst.shift) worst = { along: i, from, shift };
  }
  return worst;
}

/**
 * Each operation's agreement on the sections (the identity is not tested):
 * its share, the worst section's, and where it was tested; or why it was not.
 * `steps` are the grid's steps along x, y and z in the cell's fractional
 * units. Null when a section's grid is not centred on the origin.
 */
export function operationSymmetry(
  sections: readonly Section[],
  ops: readonly Mat3[],
  steps: readonly [number, number, number],
): { ops: OperationSymmetry[]; not_tested: NotTested[] } | null {
  const prepared: Prepared[] = [];
  const half = [0, 0, 0];
  for (const section of sections) {
    const [p, q, k] = PLANE_AXES[section.plane];
    const { nx, ny, x_axis, y_axis } = section.slice.header;
    const ox = originIndex(x_axis);
    const oy = originIndex(y_axis);
    if (ox == null || oy == null) return null;
    prepared.push({ section, p, q, k, ox, oy, nx, ny });
    half[p] = Math.max(half[p], ox, nx - 1 - ox);
    half[q] = Math.max(half[q], oy, ny - 1 - oy);
  }
  const tested: { result: OperationSymmetry; order: number }[] = [];
  const notTested: NotTested[] = [];
  for (const m of ops) {
    if (keyOf(m) === keyOf(IDENTITY)) continue;
    const op = operationName(m);
    const mismatch = gridMismatch(m, steps, half);
    if (mismatch.shift > GRID_MATCH) {
      notTested.push({ op, why: `the grid's steps along ${CELL_AXES[mismatch.along]} and ${CELL_AXES[mismatch.from]} differ: it does not map voxels onto voxels` });
      continue;
    }
    // Whole sections first: each section, or pair of sections, it maps onto one another.
    const units: Tally[] = [];
    for (let i = 0; i < prepared.length; i++) {
      for (let j = i; j < prepared.length; j++) {
        const [s, t] = [prepared[i], prepared[j]];
        const forth = mapsOnto(m, s, t);
        const back = i !== j && mapsOnto(m, t, s);
        if (!forth && !back) continue;
        const tally: Tally = { label: i === j ? s.section.label : `${s.section.label}↔${t.section.label}`, diff2: 0, val2: 0, pairs: 0 };
        const seen = forth && back ? new Set<number>() : null;
        if (forth) compare(m, s, [t], tally, seen);
        if (back) compare(m, t, [s], tally, seen);
        if (tally.pairs && tally.val2 > 0) units.push(tally);
      }
    }
    // None: the voxels of each section it maps onto another.
    if (!units.length) {
      const tally: Tally = { label: `points on ${prepared.map((s) => s.section.label).join(", ")}`, diff2: 0, val2: 0, pairs: 0 };
      const seen = new Set<number>();
      for (const s of prepared) compare(m, s, prepared, tally, seen);
      if (tally.pairs && tally.val2 > 0) units.push(tally);
    }
    if (!units.length) {
      notTested.push({ op, why: "it maps no voxel of the sections onto another" });
      continue;
    }
    tested.push({
      result: {
        op,
        rms_difference: roundSig(Math.max(...units.map((u) => Math.sqrt(u.diff2 / u.val2))), 2),
        pairs: units.reduce((s, u) => s + u.pairs, 0),
        tested_on: units.map((u) => u.label).join("; "),
        moves_c: movesC(m),
      },
      order: displayOrder(m, op),
    });
  }
  // The operations that keep c first, then by kind, then by axis, a positive angle before a negative one.
  const byName = (name: string) => name.replace("(-", "(~");
  tested.sort((x, y) => x.order - y.order || (byName(x.result.op) < byName(y.result.op) ? -1 : byName(x.result.op) > byName(y.result.op) ? 1 : 0));
  return { ops: tested.map((t) => t.result), not_tested: notTested };
}

const KINDS = ["six-fold", "four-fold", "three-fold", "two-fold", "mirror", "inversion", "-6", "-4", "-3"];
const displayOrder = (m: Mat3, name: string): number => {
  const kind = KINDS.findIndex((k) => name.startsWith(k));
  return (movesC(m) ? KINDS.length + 1 : 0) + (kind < 0 ? KINDS.length : kind);
};
