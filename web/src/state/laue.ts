// The Laue class of the symmetry average (pipeline stage 0), as the Configure
// page reads it before a run: the NeXus Viewer's presets and generator syntax,
// its group closure (in its order), its metric check against the UB, and the
// grid check, so the page says what the run will do, or why it will refuse,
// while the user picks. A port of the viewer's js/symmetry.js (parseOp,
// parseOps, closeGroup, formatOp, metricChange, indexMaps' grid test); the
// backend (nebula3d.symmetry: laue_group, metric_change, GridSymmetry) is the
// one that runs, and the two read the same classes the same way.

/** A point operation on reflections: h′ = R·h, row-major, three rows. */
export type Op = readonly (readonly number[])[];

/** The viewer's Laue classes (its PRESETS, verbatim): a name and generators. */
export const LAUE_PRESETS: readonly (readonly [string, string])[] = [
  ["1", "None"],
  ["-1", "-h,-k,-l"],
  ["2/m (b unique)", "-h,k,-l; -h,-k,-l"],
  ["2/m (c unique)", "-h,-k,l; -h,-k,-l"],
  ["mmm", "-h,-k,l; -h,k,-l; -h,-k,-l"],
  ["4/m", "k,-h,l; -h,-k,-l"],
  ["4/mmm", "k,-h,l; h,-k,-l; -h,-k,-l"],
  ["-3", "k,-h-k,l; -h,-k,-l"],
  ["-3m1", "k,-h-k,l; h,-h-k,-l; -h,-k,-l"],
  ["-31m", "k,-h-k,l; -k,-h,-l; -h,-k,-l"],
  ["6/m", "h+k,-h,l; -h,-k,-l"],
  ["6/mmm", "h+k,-h,l; -k,-h,-l; -h,-k,-l"],
  ["m-3", "k,l,h; -h,-k,l; -h,k,-l; -h,-k,-l"],
  ["m-3m", "k,l,h; k,-h,l; -h,-k,-l"],
];

/** The largest relative metric change that still counts as a symmetry of the cell: 2 %. */
export const METRIC_TOLERANCE = 0.02;

const MAX_ORDER = 48;
const IDENTITY: Op = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const det3 = (m: Op): number =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const mul = (a: Op, b: Op): number[][] => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j] + 0));
const keyOf = (m: Op): string => m.map((row) => row.join(",")).join(";");
const transpose = (m: Op): number[][] => [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i]));

/** One operation, as the viewer's parseOp reads it ("h+k,-h,l", or real space "x-y,x,z" as R = Wᵀ). */
export function parseOp(text: string): number[][] {
  const src = text.replace(/\s+/g, "").toLowerCase();
  const parts = src.split(",");
  if (parts.length !== 3 || parts.some((p) => !p)) throw new Error(`"${text}" needs three comma-separated components.`);
  const real = /[xyz]/.test(src);
  if (real && /[hkl]/.test(src)) throw new Error(`"${text}" mixes h,k,l with x,y,z.`);
  const vars = real ? "xyz" : "hkl";
  const m: number[][] = [];
  for (const part of parts) {
    const row = [0, 0, 0];
    const term = /([+-]?)(\d*)\*?([a-z])/gy;
    let used = 0;
    let match: RegExpExecArray | null;
    while ((match = term.exec(part))) {
      const [, sign, num, v] = match;
      const i = vars.indexOf(v);
      if (i < 0) throw new Error(`Unknown symbol "${v}" in "${text}".`);
      row[i] += (sign === "-" ? -1 : 1) * (num === "" ? 1 : Number(num));
      used = term.lastIndex;
    }
    if (used !== part.length) {
      throw new Error(`Cannot read "${part}" in "${text}". Use integer combinations such as h-k or -2l; translations are not allowed.`);
    }
    m.push(row);
  }
  const r = real ? transpose(m) : m;
  const d = det3(r);
  if (Math.abs(d) !== 1) throw new Error(`"${text}" has determinant ${d}; a point operation must have determinant ±1.`);
  return r;
}

/** The operations in `text`, separated by ";" or new lines; "None" and blanks name none (the viewer's parseOps). */
export const parseOps = (text: string): number[][][] =>
  text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "none")
    .map(parseOp);

/** The smallest group containing `generators`, in the viewer's closeGroup order (identity first). */
export function closeGroup(generators: readonly Op[]): Op[] {
  const ops: Op[] = [IDENTITY];
  const keys = new Set([keyOf(IDENTITY)]);
  const add = (m: Op): boolean => {
    const key = keyOf(m);
    if (keys.has(key)) return false;
    if (ops.length >= MAX_ORDER) {
      throw new Error(`These operations generate more than ${MAX_ORDER} operations, so they are not a crystallographic point group.`);
    }
    keys.add(key);
    ops.push(m);
    return true;
  };
  generators.forEach(add);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of [...ops]) for (const b of [...ops]) grew = add(mul(a, b)) || grew;
  }
  return ops;
}

/** "h+k,-h,l": an operation as the viewer writes it (formatOp). */
export function formatOp(m: Op): string {
  return m
    .map((row) => {
      let s = "";
      for (let j = 0; j < 3; j++) {
        const c = row[j];
        if (!c) continue;
        const mag = Math.abs(c) === 1 ? "" : String(Math.abs(c));
        s += (c < 0 ? "-" : s ? "+" : "") + mag + "hkl"[j];
      }
      return s || "0";
    })
    .join(",");
}

const groupKey = (ops: readonly Op[]): string => ops.map(keyOf).sort().join("|");

/** The preset whose group `ops` is, else "custom" (the viewer's name for it). */
export function groupLabel(ops: readonly Op[]): string {
  const key = groupKey(ops);
  return LAUE_PRESETS.find(([, gens]) => groupKey(closeGroup(parseOps(gens))) === key)?.[0] ?? "custom";
}

/** A Laue class to average over: its name, its generators and the closed group. */
export interface LaueGroup {
  label: string;
  generators: string;
  ops: Op[];
}

/** The preset named `name` (any case), or undefined. */
export const presetNamed = (name: string): readonly [string, string] | undefined =>
  LAUE_PRESETS.find(([n]) => n.toLowerCase() === name.trim().toLowerCase());

/** A group as the Laue class setting holds it: its preset's name, else its operations. */
export const laueSpecOf = (label: string, ops: readonly Op[]): string => (presetNamed(label) ? label : ops.map(formatOp).join("; "));

/**
 * The Laue class `spec` names, as the backend reads it (nebula3d.symmetry.laue_group):
 * a preset by name, or generators. Throws with the viewer's message for text
 * it would not read, and for a name that is no preset.
 */
export function laueGroup(spec: string): LaueGroup {
  const text = spec.trim();
  if (!text) throw new Error("Choose a Laue class: a preset such as 6/mmm, or generators such as h+k,-h,l; -k,-h,-l; -h,-k,-l.");
  const preset = presetNamed(text);
  if (!preset && !text.includes(",") && text.toLowerCase() !== "none") {
    throw new Error(`"${text}" is not a Laue class here: choose a preset, or give generators such as h+k,-h,l; -h,-k,-l.`);
  }
  const generators = preset ? preset[1] : text;
  const ops = closeGroup(parseOps(generators));
  return { label: groupLabel(ops), generators, ops };
}

/**
 * The largest change of the reciprocal metric G* = UBᵀ·UB under `ops`,
 * relative to its largest element (the viewer's metricChange): 0 for true
 * symmetries of the cell; above METRIC_TOLERANCE they are none.
 */
export function metricChange(ops: readonly Op[], ub: readonly (readonly number[])[]): number {
  const g = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ub[0][i] * ub[0][j] + ub[1][i] * ub[1][j] + ub[2][i] * ub[2][j]));
  const scale = Math.max(...g.flat().map(Math.abs));
  let worst = 0;
  for (const r of ops) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let v = 0;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) v += r[a][i] * g[a][b] * r[b][j];
        worst = Math.max(worst, Math.abs(v - g[i][j]) / scale);
      }
    }
  }
  return worst;
}

/** NEBULA3D's "unknown" UB: the identity. */
export const ubUnknown = (ub: readonly (readonly number[])[] | null | undefined): boolean =>
  !ub || ub.every((row, i) => row.every((x, j) => x === (i === j ? 1 : 0)));

/** A grid as the volume meta gives it: shape and the first and last bin centre of each axis. */
export interface Grid {
  shape: readonly number[];
  ranges: readonly (readonly number[])[]; // [[h0, h1], [k0, k1], [l0, l1]]
}

/**
 * Why the operations do not map the grid onto itself (as the backend's
 * GridSymmetry.for_volume tests it: each operation an exact integer map on
 * voxel indices, to 10⁻³), or null when they do.
 */
export function gridProblem(ops: readonly Op[], grid: Grid): string | null {
  const step = grid.ranges.map(([a, b], d) => (grid.shape[d] > 1 ? (b - a) / (grid.shape[d] - 1) : 1));
  const start = grid.ranges.map(([a]) => a);
  const near = (x: number) => Math.abs(x - Math.round(x)) <= 1e-3;
  for (const m of ops) {
    for (let d = 0; d < 3; d++) {
      let offset = -start[d];
      for (let e = 0; e < 3; e++) {
        if (!near((m[d][e] * step[e]) / step[d])) {
          return `${formatOp(m)} mixes axes whose steps differ (${"HKL"[d]} ${step[d].toPrecision(4)}, ${"HKL"[e]} ${step[e].toPrecision(4)} r.l.u.)`;
        }
        offset += m[d][e] * start[e];
      }
      if (!near(offset / step[d])) return `${formatOp(m)} needs a bin centred at 0 along ${"HKL"[d]}`;
    }
  }
  return null;
}
