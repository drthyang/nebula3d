// Interatomic (pair) vectors for the 3D-ΔPDF structure overlay.
//
// A 3D-ΔPDF is a map of interatomic vectors, not of atoms: its peaks sit at
// u = r_j − r_i + R for atom pairs (i, j) and lattice vectors R.  Its axes are
// those vectors along the data's a, b, c in Å (x_H = u_a·a, …), so a vector
// with fractional components (u_a, u_b, u_c) is drawn at (u_a·a, u_b·b, u_c·c)
// on the ΔPDF's own oblique grid — using the ΔPDF's cell, not the CIF's, so a
// slightly different cell (another temperature) does not shift the markers.
//
// The pair differences r_j − r_i are found once per structure, modulo the
// lattice; a slice then places every lattice translation of them that lies
// within `depth` of the cut plane and inside the slice.

import type { Cell, Site } from "./cif";
import { applyOp, wrap01, type SymOp, type Vec3 } from "./symops";

export interface Atom {
  label: string; // the asymmetric-unit site it was generated from
  element: string;
  frac: Vec3; // in [0, 1)
}

/** Atoms in one cell: every site under every operation, duplicates removed. */
export function expandSites(sites: Site[], ops: SymOp[], tol = 1e-3): Atom[] {
  const atoms: Atom[] = [];
  for (const s of sites) {
    const mine: Vec3[] = [];
    for (const op of ops) {
      const p = applyOp(op, [s.x, s.y, s.z]).map(wrap01) as Vec3;
      const dup = mine.some((q) =>
        q.every((v, k) => {
          const d = v - p[k];
          return Math.abs(d - Math.round(d)) < tol;
        }),
      );
      if (dup) continue;
      mine.push(p);
      atoms.push({ label: s.label, element: s.element, frac: p });
    }
  }
  return atoms;
}

/** Axis permutations: data axis i is the CIF's axis perm[i]. */
export const PERMUTATIONS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/** "abc", "acb", …: which CIF axes become the data's a, b, c. */
export function permLabel(perm: readonly number[]): string {
  return perm.map((k) => "abc"[k]).join("");
}

export function permuteAtoms(atoms: Atom[], perm: readonly number[]): Atom[] {
  if (perm[0] === 0 && perm[1] === 1 && perm[2] === 2) return atoms;
  return atoms.map((a) => ({ ...a, frac: [a.frac[perm[0]], a.frac[perm[1]], a.frac[perm[2]]] }));
}

export interface CellFit {
  length: number; // largest relative length difference
  angle: number; // largest angle difference, degrees
}

const lengths = (c: Cell): Vec3 => [c.a, c.b, c.c];
const angles = (c: Cell): Vec3 => [c.alpha, c.beta, c.gamma];

/**
 * How far the CIF cell, with its axes permuted, is from the data's.  The angle
 * opposite data axis i (α for a, …) is the CIF angle opposite axis perm[i].
 */
export function cellFit(cif: Cell, data: Cell, perm: readonly number[]): CellFit {
  const lc = lengths(cif), ld = lengths(data), ac = angles(cif), ad = angles(data);
  let length = 0, angle = 0;
  for (let i = 0; i < 3; i++) {
    length = Math.max(length, Math.abs(lc[perm[i]] - ld[i]) / ld[i]);
    angle = Math.max(angle, Math.abs(ac[perm[i]] - ad[i]));
  }
  return { length, angle };
}

/** Cells agree when lengths are within 3 % and angles within 1°. */
export const CELL_TOLERANCE: CellFit = { length: 0.03, angle: 1 };

export function cellMatches(f: CellFit): boolean {
  return f.length <= CELL_TOLERANCE.length && f.angle <= CELL_TOLERANCE.angle;
}

/** The permutation that best matches the data's cell, if any matches. */
export function bestPermutation(cif: Cell, data: Cell): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  PERMUTATIONS.forEach((p, i) => {
    const f = cellFit(cif, data, p);
    const score = f.length + f.angle / 100;
    if (cellMatches(f) && score < bestScore - 1e-12) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** One pair difference r_to − r_from (mod the lattice) and how many pairs per cell give it. */
export interface PairDiff {
  d: Vec3; // fractional, in [0, 1)
  from: string; // site labels
  to: string;
  key: string; // unordered element pair, e.g. "Na–Cl"
  count: number;
}

/** Elements in the order their sites first appear. */
export function elementOrder(atoms: Atom[]): string[] {
  const out: string[] = [];
  for (const a of atoms) if (!out.includes(a.element)) out.push(a.element);
  return out;
}

/** The unordered pair key of two elements, ordered as in `order`. */
export function pairKey(e1: string, e2: string, order: string[]): string {
  return order.indexOf(e1) <= order.indexOf(e2) ? `${e1}–${e2}` : `${e2}–${e1}`;
}

/** All pair differences of the cell's atoms, grouped by (from, to, difference). */
export function pairDifferences(atoms: Atom[]): PairDiff[] {
  const order = elementOrder(atoms);
  const groups = new Map<string, PairDiff>();
  for (const ai of atoms) {
    for (const aj of atoms) {
      const d = aj.frac.map((v, k) => wrap01(Math.round((v - ai.frac[k]) * 1e5) / 1e5)) as Vec3;
      const g = `${ai.label}|${aj.label}|${d.map((v) => v.toFixed(5)).join(",")}`;
      const hit = groups.get(g);
      if (hit) hit.count++;
      else groups.set(g, { d, from: ai.label, to: aj.label, key: pairKey(ai.element, aj.element, order), count: 1 });
    }
  }
  return [...groups.values()];
}

/** A marker on one ΔPDF slice: one vector of one element pair. */
export interface Marker {
  h: number; // in-plane coordinates on the slice's oblique grid (Å)
  v: number;
  off: number; // distance from the cut plane along the cut axis (Å)
  u: Vec3; // the vector along a, b, c (Å)
  key: string; // element pair
  mult: number; // pairs per cell at this vector
  pairs: { from: string; to: string; count: number }[];
}

export interface SliceSpec {
  lat: Vec3; // the ΔPDF's a, b, c (Å)
  axes: [number, number, number]; // horizontal, vertical, cut axis (0 = a, 1 = b, 2 = c)
  cut: number; // the cut plane along the cut axis (Å)
  depth: number; // half-thickness of the slab around the cut (Å)
  hRange: [number, number]; // slice extent along the in-plane axes (Å)
  vRange: [number, number];
  origin?: string | null; // only pairs starting on this site
  hidden?: ReadonlySet<string>; // element pairs not drawn
}

/** Every pair vector within the slab around one cut, merged per (vector, element pair). */
export function sliceMarkers(diffs: PairDiff[], s: SliceSpec): Marker[] {
  const [ih, iv, ic] = s.axes;
  const Lh = s.lat[ih], Lv = s.lat[iv], Lc = s.lat[ic];
  if (!(Lh > 0 && Lv > 0 && Lc > 0)) return [];
  const eps = 1e-9;
  const out = new Map<string, Marker>();
  for (const p of diffs) {
    if (s.origin && p.from !== s.origin) continue;
    if (s.hidden?.has(p.key)) continue;
    const dc = p.d[ic], dh = p.d[ih], dv = p.d[iv];
    for (let nc = Math.ceil((s.cut - s.depth) / Lc - dc - eps); nc <= Math.floor((s.cut + s.depth) / Lc - dc + eps); nc++) {
      const c = (dc + nc) * Lc;
      for (let nh = Math.ceil(s.hRange[0] / Lh - dh - eps); nh <= Math.floor(s.hRange[1] / Lh - dh + eps); nh++) {
        const h = (dh + nh) * Lh;
        for (let nv = Math.ceil(s.vRange[0] / Lv - dv - eps); nv <= Math.floor(s.vRange[1] / Lv - dv + eps); nv++) {
          const v = (dv + nv) * Lv;
          if (Math.abs(h) < 1e-6 && Math.abs(v) < 1e-6 && Math.abs(c) < 1e-6) continue; // u = 0
          const k = `${p.key}|${h.toFixed(3)}|${v.toFixed(3)}|${c.toFixed(3)}`;
          let m = out.get(k);
          if (!m) {
            const u: Vec3 = [0, 0, 0];
            u[ih] = h;
            u[iv] = v;
            u[ic] = c;
            m = { h, v, off: c - s.cut, u, key: p.key, mult: 0, pairs: [] };
            out.set(k, m);
          }
          m.mult += p.count;
          const pr = m.pairs.find((q) => q.from === p.from && q.to === p.to);
          if (pr) pr.count += p.count;
          else m.pairs.push({ from: p.from, to: p.to, count: p.count });
        }
      }
    }
  }
  return [...out.values()];
}

/** True length (Å) of a vector given along a, b, c in Å, for cell angles in degrees. */
export function vectorLength(u: Vec3, angles: Vec3): number {
  const [ca, cb, cg] = angles.map((x) => (Math.abs(x - 90) < 1e-9 ? 0 : Math.cos((x * Math.PI) / 180)));
  const q = u[0] ** 2 + u[1] ** 2 + u[2] ** 2 + 2 * (u[0] * u[1] * cg + u[0] * u[2] * cb + u[1] * u[2] * ca);
  return Math.sqrt(Math.max(0, q));
}
