// Space-group operations as coordinate triplets, the CIF's
// _space_group_symop_operation_xyz: "-x+1/2, y, z+1/2" maps the fractional
// position r to R·r + t.  The operations a user pastes need not be the whole
// group: they are closed under composition (translations taken modulo the
// lattice), together with the centring translations, so generators, the coset
// representatives of International Tables or a CIF's full list all give the
// same group.

export type Vec3 = [number, number, number];

export interface SymOp {
  rot: number[]; // 3×3 integer matrix, row-major
  trans: Vec3; // fractional, in [0, 1)
}

export type Centering = "P" | "A" | "B" | "C" | "I" | "F" | "R";

export const CENTERINGS: readonly Centering[] = ["P", "A", "B", "C", "I", "F", "R"];

/** Lattice centring translations (R: obverse setting on hexagonal axes). */
const CENTERING_SHIFTS: Record<Centering, Vec3[]> = {
  P: [],
  A: [[0, 0.5, 0.5]],
  B: [[0.5, 0, 0.5]],
  C: [[0.5, 0.5, 0]],
  I: [[0.5, 0.5, 0.5]],
  F: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
  R: [[2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]],
};

/** The order of the largest space group (Fm-3m and friends). */
const MAX_ORDER = 192;

/** Wrap a fractional coordinate into [0, 1), sending values within 1e-9 of 1 to 0. */
export function wrap01(v: number): number {
  const w = v - Math.floor(v);
  return w > 1 - 1e-9 ? 0 : w;
}

/** One component, e.g. "-x+1/2", "x-y", "1/2+z", "0.25-y": (coefficients, constant). */
function parseComponent(src: string, op: string): { coef: Vec3; c: number } {
  const s = src.replace(/\s+/g, "").toLowerCase();
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!s || !terms || terms.join("") !== s) throw new Error(`symmetry operation "${op}": cannot read "${src}"`);
  const coef: Vec3 = [0, 0, 0];
  let c = 0;
  for (const term of terms) {
    const sign = term.startsWith("-") ? -1 : 1;
    const body = term.replace(/^[+-]/, "");
    const m = /^(\d+(?:\.\d*)?|\.\d+)?(?:\/(\d+))?\*?([xyz])?$/.exec(body);
    if (!m || (!m[1] && !m[3]) || (m[2] && !m[1])) {
      throw new Error(`symmetry operation "${op}": cannot read "${src}"`);
    }
    const num = m[1] ? Number(m[1]) / (m[2] ? Number(m[2]) : 1) : 1;
    if (m[3]) coef["xyz".indexOf(m[3])] += sign * num;
    else c += sign * num;
  }
  if (coef.some((v) => !Number.isInteger(v))) {
    throw new Error(`symmetry operation "${op}": coefficients of x, y, z must be whole numbers`);
  }
  return { coef, c };
}

function det3(m: number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Parse one triplet "x', y', z'" (each in terms of x, y, z). */
export function parseSymop(text: string): SymOp {
  const op = text.trim();
  const parts = op.split(",");
  if (parts.length !== 3) throw new Error(`symmetry operation "${op}": need three components`);
  const rows = parts.map((p) => parseComponent(p, op));
  const rot = rows.flatMap((r) => r.coef);
  if (Math.abs(Math.abs(det3(rot)) - 1) > 1e-9) {
    throw new Error(`symmetry operation "${op}" is not a lattice symmetry (|det| ≠ 1)`);
  }
  return { rot, trans: rows.map((r) => wrap01(r.c)) as Vec3 };
}

/**
 * Split pasted text into operation strings: one per line or separated by ";".
 * Strips quotes and a leading index such as "1 ", "(1) " or "1: ".
 */
export function splitSymops(text: string): string[] {
  return text
    .split(/[\n;]/)
    .map((t) =>
      t
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .replace(/^\(\d+\)\s*/, "")
        .replace(/^\d+[:.]?\s+/, "")
        .trim(),
    )
    .filter((t) => t.length > 0);
}

export function applyOp(op: SymOp, r: Vec3): Vec3 {
  const m = op.rot;
  return [
    m[0] * r[0] + m[1] * r[1] + m[2] * r[2] + op.trans[0],
    m[3] * r[0] + m[4] * r[1] + m[5] * r[2] + op.trans[1],
    m[6] * r[0] + m[7] * r[1] + m[8] * r[2] + op.trans[2],
  ];
}

/** a∘b: first b, then a. */
export function compose(a: SymOp, b: SymOp): SymOp {
  const rot: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      rot.push(a.rot[3 * i] * b.rot[j] + a.rot[3 * i + 1] * b.rot[3 + j] + a.rot[3 * i + 2] * b.rot[6 + j]);
    }
  }
  const t = applyOp(a, b.trans);
  return { rot, trans: t.map(wrap01) as Vec3 };
}

function opKey(op: SymOp): string {
  const t = op.trans.map((v) => wrap01(Math.round(v * 1e4) / 1e4).toFixed(4));
  return `${op.rot.join(",")}|${t.join(",")}`;
}

const IDENTITY: SymOp = { rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], trans: [0, 0, 0] };

/**
 * The group the operations and centring translations generate (translations
 * modulo the lattice), identity first.  Throws if it grows past any space
 * group's order — a typo, or an operation that is not crystallographic.
 */
export function closeGroup(ops: SymOp[], centering: Centering = "P"): SymOp[] {
  const gens = [
    ...ops,
    ...CENTERING_SHIFTS[centering].map((t): SymOp => ({ rot: IDENTITY.rot, trans: t })),
  ];
  const group = new Map<string, SymOp>([[opKey(IDENTITY), IDENTITY]]);
  const queue: SymOp[] = [IDENTITY];
  while (queue.length) {
    const g = queue.shift()!;
    for (const h of gens) {
      const p = compose(h, g);
      const k = opKey(p);
      if (group.has(k)) continue;
      group.set(k, p);
      queue.push(p);
      if (group.size > MAX_ORDER) {
        throw new Error(
          `the operations generate more than ${MAX_ORDER} operations, more than any space group — check them for a typo`,
        );
      }
    }
  }
  return [...group.values()];
}

/** Parse pasted operations and close them into a group. */
export function symmetryGroup(text: string, centering: Centering = "P"): SymOp[] {
  return closeGroup(splitSymops(text).map(parseSymop), centering);
}
