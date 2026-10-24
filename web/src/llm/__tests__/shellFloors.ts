// The whole volume's shell floors of a volume built in a test, as the server
// measures them (nebula3d.preprocessing.shell_floors, GET
// /api/volumes/{id}/shell-floors): the flatten's shells, q_step apart from
// the smallest |Q| measured on the flatten's input to the largest, each
// voxel in the shell np.digitize puts it in; each shell's floor the
// percentile (linear, as np.percentile) of its measured voxels, none under
// min_count; every grid voxel counted in `totals`, measured or not; the level
// the flatten input's median over the voxels measured in both. For the tests
// of what NEBULA Pilot reads from it, on volumes whose answers are known
// (constructed, or the synthetic crystal): no backend, no measured data.

import type { FlattenSettings, ShellFloors } from "../../api/types";

/** A volume on a grid: its axes (r.l.u.), |Q| (Å⁻¹) of a point, and its value at each voxel (NaN: unmeasured). */
export interface TestVolume {
  axes: [number[], number[], number[]];
  q: (h: number, k: number, l: number) => number;
  value: (h: number, k: number, l: number, idx: [number, number, number]) => number;
}

// np.percentile's default: linear between the order statistics either side of (n − 1)·p.
const percentileOf = (sorted: Float64Array, p: number): number => {
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/**
 * The shell floors of `after` (the flattened volume) and, given `before` (the
 * flatten's input, on the same grid), its shells and level, with `flatten`
 * as what the file records.
 */
export function shellFloorsOf(
  after: TestVolume,
  before: TestVolume | null,
  { id = "test.flattened", qStep = 0.05, percentile = 25, minCount = 20, flatten = null as FlattenSettings | null } = {},
): ShellFloors {
  const [ha, ka, la] = after.axes;
  const n = ha.length * ka.length * la.length;
  const q = new Float64Array(n);
  const a = new Float64Array(n);
  const b = before ? new Float64Array(n) : null;
  let v = 0;
  for (let i = 0; i < ha.length; i++) {
    for (let j = 0; j < ka.length; j++) {
      for (let k = 0; k < la.length; k++, v++) {
        q[v] = after.q(ha[i], ka[j], la[k]);
        a[v] = after.value(ha[i], ka[j], la[k], [i, j, k]);
        if (b && before) b[v] = before.value(ha[i], ka[j], la[k], [i, j, k]);
      }
    }
  }
  // The shells run over the flatten input's measured |Q|.
  const ref = b ?? a;
  let q0 = Infinity;
  let q1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(ref[i])) continue;
    q0 = Math.min(q0, q[i]);
    q1 = Math.max(q1, q[i]);
  }
  const edges: number[] = [];
  for (let i = 0; q0 + i * qStep < q1 + qStep; i++) edges.push(q0 + i * qStep);
  if (edges.length < 2) edges.splice(0, edges.length, q0, q0 + qStep);
  const nb = edges.length - 1;
  const ext = edges[nb] > q1 ? edges : [...edges, q1 + Math.max(1e-12, Math.abs(q1) * 1e-15)];
  const shellOf = (x: number): number => {
    // np.digitize(x, ext) − 1, outside the edges −1, the last edge's into the last shell.
    if (!(x >= ext[0]) || x >= ext[ext.length - 1]) return -1;
    let lo = 0;
    let hi = ext.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x >= ext[mid]) lo = mid;
      else hi = mid;
    }
    return Math.min(lo, nb - 1);
  };
  const totals = new Array<number>(nb).fill(0);
  const values: number[][] = Array.from({ length: nb }, () => []);
  const levels: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = shellOf(q[i]);
    if (s < 0) continue;
    totals[s] += 1;
    if (Number.isFinite(a[i])) values[s].push(a[i]);
  }
  if (b) for (let i = 0; i < n; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) levels.push(b[i]);
  const sorted = values.map((s) => Float64Array.from(s).sort());
  const levelSorted = Float64Array.from(levels.length ? levels : Array.from(a).filter(Number.isFinite)).sort();
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return {
    id,
    before_id: before ? id.replace(/\.flattened$/, ".backfilled") : null,
    q_step: qStep,
    percentile,
    min_count: minCount,
    q_edges: edges.map(round6),
    centres: edges.slice(0, -1).map((e, i) => round6((e + edges[i + 1]) / 2)),
    totals,
    counts: sorted.map((s) => s.length),
    floors: sorted.map((s) => (s.length >= minCount ? percentileOf(s, percentile) : null)),
    medians: sorted.map((s) => (s.length >= minCount ? percentileOf(s, 50) : null)),
    counts_before: null,
    floors_before: null,
    medians_before: null,
    level: levelSorted.length ? percentileOf(levelSorted, 50) : null,
    level_count: levelSorted.length,
    flatten,
  };
}
