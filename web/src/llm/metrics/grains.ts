// Is there a second grain, and what are the sharp off-lattice peaks?  The
// punch's search records every peak it found off the Bragg nodes.  Grouped into
// symmetry orbits (a symmetrised volume repeats each one over the point group),
// the strongest orbits are tested two ways:
//
// - against the Bragg nodes: an orbit within a quarter of the node spacing of
//   one (the reach the punch's wing rule uses) is that node's peak, displaced;
//   its offset over |Q| is a rotation angle.  Symmetrising data whose UB is a
//   little off turns each Bragg peak into copies around its node at a constant
//   angle — the copies the search then finds;
// - as a rotated copy of the Bragg lattice: a second grain is one rotation
//   under which most strong orbits sit on lattice nodes.  The same search on
//   the same |Q| at random directions is the control.
//
// grainCheck returns what it measured, unrounded; the grain's rule in the
// check-verdict module (verdicts/rules.ts) judges it and writes the verdict,
// and shownGrains rounds it as grain_check's result shows it.

type V3 = [number, number, number];
type M3 = [V3, V3, V3]; // rows

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.sqrt(dot(a, a));
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mv = (m: M3, v: V3): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const col = (m: M3, j: number): V3 => [m[0][j], m[1][j], m[2][j]];
const mm = (a: M3, b: M3): M3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => dot(a[i], col(b, j)))) as M3;
const transpose = (m: M3): M3 => [col(m, 0), col(m, 1), col(m, 2)];
const cols = (a: V3, b: V3, c: V3): M3 => transpose([a, b, c]);

function inv3(m: M3): M3 {
  const [a, b, c] = m;
  const det = dot(a, cross(b, c));
  const r0 = cross(b, c), r1 = cross(c, a), r2 = cross(a, b);
  return transpose([scale(r0, 1 / det), scale(r1, 1 / det), scale(r2, 1 / det)]);
}

const angleDeg = (a: V3, b: V3) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) * 180) / Math.PI;
const rotationAngle = (r: M3) => (Math.acos(Math.max(-1, Math.min(1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2))) * 180) / Math.PI;

// The rotation taking the frame of (a1, a2) onto that of (b1, b2).
function triad(a1: V3, a2: V3, b1: V3, b2: V3): M3 {
  const frame = (x: V3, y: V3): M3 => {
    const e1 = scale(x, 1 / norm(x));
    const z = cross(x, y);
    const e3 = scale(z, 1 / norm(z));
    return cols(e1, cross(e3, e1), e3);
  };
  return mm(frame(b1, b2), transpose(frame(a1, a2)));
}

// Below this misorientation a rotated copy of the lattice is a UB error.
export const SECOND_GRAIN_DEG = 2;

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Two decimals: how grain_check shows an angle (and its rule writes one). */
export const r2 = (x: number) => Math.round(x * 100) / 100;

export interface OffLatticePeak {
  hkl: V3;
  intensity: number; // above its local background
}

/** What the second-grain test measured, unrounded. */
export interface GrainFacts {
  off_lattice_orbits: number;
  judged: number; // the strongest orbits tested
  near_bragg_nodes: number; // of those, within a quarter of the node spacing of a Bragg node
  near_offset_angle_deg: { median: number; quartiles: [number, number] } | null;
  far: { hkl: V3; q: number; offset_q: number }[]; // the strongest of the rest (at most 8)
  rotated_copy: { indexed: number; misorientation_deg: number | null } | null;
  random_control: number; // orbits the same search indexes at random directions
  symmetrised: boolean; // the declared point group holds more than the identity
}

/** grain_check's result: the facts as it shows them, rounded, and its verdict. */
export interface GrainCheck extends Omit<GrainFacts, "symmetrised"> {
  verdict: string;
}

/** Group peaks into symmetry orbits, strongest first: one representative each. */
export function orbits(peaks: OffLatticePeak[], ops: M3[], tol = 0.15): OffLatticePeak[] {
  const sorted = [...peaks].sort((a, b) => b.intensity - a.intensity);
  const taken = new Array(sorted.length).fill(false);
  const reps: OffLatticePeak[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (taken[i]) continue;
    const images = ops.map((op) => mv(op, sorted[i].hkl));
    for (let j = i; j < sorted.length; j++) {
      if (!taken[j] && images.some((im) => norm(sub(sorted[j].hkl, im)) < tol)) taken[j] = true;
    }
    reps.push(sorted[i]);
  }
  return reps;
}

// A deterministic generator for the control (the same answer every run).
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32);
}

export function grainCheck({
  peaks,
  ub,
  ops,
  cell = [1, 1, 1],
  top = 40,
}: {
  peaks: OffLatticePeak[];
  ub: M3; // Q = UB · hkl (2π included)
  ops: M3[]; // the declared point group in hkl (identity first), or [identity]
  cell?: V3; // the Bragg lattice's node spacing in r.l.u. (the punch cell)
  top?: number;
}): GrainFacts {
  const group = ops.length ? ops : ([[[1, 0, 0], [0, 1, 0], [0, 0, 1]]] as M3[]);
  const reps = orbits(peaks, group);
  const judged = reps.slice(0, top);
  const B: M3 = mm(ub, [[cell[0], 0, 0], [0, cell[1], 0], [0, 0, cell[2]]] as M3); // the Bragg lattice
  const spacing = Math.min(norm(col(B, 0)), norm(col(B, 1)), norm(col(B, 2)));
  const reach = spacing / 4;

  // Against the Bragg nodes.
  const angles: number[] = [];
  const far: GrainFacts["far"] = [];
  for (const p of judged) {
    const node: V3 = [0, 1, 2].map((i) => cell[i] * Math.round(p.hkl[i] / cell[i])) as V3;
    const q = mv(ub, p.hkl);
    const qn = mv(ub, node);
    const offset = norm(sub(q, qn));
    if (offset <= reach && norm(qn) > 0) angles.push((offset / norm(qn)) * (180 / Math.PI));
    else if (far.length < 8) far.push({ hkl: p.hkl, q: norm(q), offset_q: offset });
  }
  angles.sort((a, b) => a - b);

  // As a rotated copy of the Bragg lattice.
  const qOrbit = judged.map((p) => group.map((op) => mv(ub, mv(op, p.hkl))));
  const best = rotationSearch(judged.map((p) => mv(ub, p.hkl)), qOrbit, B);
  const rand = lcg(7);
  const randomOrbit = judged.map((p) => {
    const len = norm(mv(ub, p.hkl));
    return group.map(() => {
      const v: V3 = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
      return scale(v, len / norm(v));
    });
  });
  const control = rotationSearch(randomOrbit.map((o) => o[0]), randomOrbit, B);

  const near = angles.length;
  return {
    off_lattice_orbits: reps.length,
    judged: judged.length,
    near_bragg_nodes: near,
    near_offset_angle_deg: near ? { median: quantile(angles, 0.5), quartiles: [quantile(angles, 0.25), quantile(angles, 0.75)] } : null,
    far,
    rotated_copy: best ? { indexed: best.indexed, misorientation_deg: best.misorientation } : null,
    random_control: control.indexed,
    symmetrised: group.length > 1,
  };
}

/** The facts as grain_check shows them: angles to two decimals, |Q| to three, in the result's order, with its verdict. */
export const shownGrains = (g: GrainFacts, verdict: string): GrainCheck => ({
  off_lattice_orbits: g.off_lattice_orbits,
  judged: g.judged,
  near_bragg_nodes: g.near_bragg_nodes,
  near_offset_angle_deg: g.near_offset_angle_deg && {
    median: r2(g.near_offset_angle_deg.median),
    quartiles: [r2(g.near_offset_angle_deg.quartiles[0]), r2(g.near_offset_angle_deg.quartiles[1])],
  },
  far: g.far.map((f) => ({ hkl: f.hkl.map(r2) as V3, q: r3(f.q), offset_q: r3(f.offset_q) })),
  rotated_copy: g.rotated_copy && {
    indexed: g.rotated_copy.indexed,
    misorientation_deg: g.rotated_copy.misorientation_deg != null ? r2(g.rotated_copy.misorientation_deg) : null,
  },
  random_control: g.random_control,
  verdict,
});

// The rotation of the lattice B that indexes most orbits: from pairs of the
// strongest orbits matched to pairs of lattice vectors of the same lengths and
// angle.  An orbit is indexed when any of its images is within tol of a node.
function rotationSearch(qs: V3[], qOrbit: V3[][], B: M3, tolQ = 0.03, tolA = 1, tol = 0.05) {
  const qmax = Math.max(0, ...qs.map(norm)) + 0.2;
  const lens = [0, 1, 2].map((j) => norm(col(B, j)));
  const nMax = Math.ceil(qmax / Math.min(...lens)) + 1;
  const G: V3[] = [];
  for (let h = -nMax; h <= nMax; h++)
    for (let k = -nMax; k <= nMax; k++)
      for (let l = -nMax; l <= nMax; l++) {
        if (!h && !k && !l) continue;
        const g = mv(B, [h, k, l]);
        if (norm(g) <= qmax) G.push(g);
      }
  const Gn = G.map(norm);
  const score = (R: M3) => {
    const RB = mm(R, B);
    const inv = inv3(RB);
    let hits = 0;
    for (const images of qOrbit) {
      if (images.some((q) => {
        const h = mv(inv, q);
        const d = mv(RB, sub(h, h.map(Math.round) as V3));
        return norm(d) < tol;
      })) hits += 1;
    }
    return hits;
  };
  let best: { indexed: number; R: M3 } | null = null;
  const pick = Math.min(6, qs.length);
  for (let i = 0; i < pick; i++) {
    for (let j = i + 1; j < pick; j++) {
      const a = angleDeg(qs[i], qs[j]);
      if (a < 5 || a > 175) continue;
      const ci = G.map((_g, x) => x).filter((x) => Math.abs(Gn[x] - norm(qs[i])) < tolQ);
      const cj = G.map((_g, x) => x).filter((x) => Math.abs(Gn[x] - norm(qs[j])) < tolQ);
      for (const x of ci) {
        for (const y of cj) {
          if (Math.abs(angleDeg(G[x], G[y]) - a) > tolA) continue;
          const R = triad(G[x], G[y], qs[i], qs[j]);
          const hits = score(R);
          if (!best || hits > best.indexed) best = { indexed: hits, R };
        }
      }
    }
  }
  if (!best) return { indexed: 0, misorientation: null as number | null };
  // The smallest angle from the main grain among the rotations that map the
  // lattice onto itself (its own point group, whatever the data declare).
  const bInv = inv3(B);
  const mis = Math.min(...latticeRotations(B).map((op) => rotationAngle(mm(mm(mm(B, op), bInv), best!.R))));
  return { indexed: best.indexed, misorientation: mis };
}

// The proper rotations of a lattice, as integer matrices in its own basis: the
// matrices with entries in {−1, 0, 1} that keep its metric.
function latticeRotations(B: M3): M3[] {
  const g = mm(transpose(B), B); // the metric
  const scaleG = Math.max(...g.flat().map(Math.abs));
  const out: M3[] = [];
  const v = [-1, 0, 1];
  for (const a of v) for (const b of v) for (const c of v)
    for (const d of v) for (const e of v) for (const f of v)
      for (const h of v) for (const i of v) for (const j of v) {
        const m: M3 = [[a, b, c], [d, e, f], [h, i, j]];
        const det = dot(m[0], cross(m[1], m[2]));
        if (det !== 1) continue;
        const gm = mm(transpose(m), mm(g, m));
        let same = true;
        for (let r = 0; r < 3 && same; r++) for (let s2 = 0; s2 < 3 && same; s2++) same = Math.abs(gm[r][s2] - g[r][s2]) < 1e-6 * scaleG;
        if (same) out.push(m);
      }
  return out.length ? out : [[[1, 0, 0], [0, 1, 0], [0, 0, 1]]];
}
