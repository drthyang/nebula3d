// The Laue-class comparison as the Configure page's table shows it (the
// symmetry average's section): one row per candidate class, in the order the
// backend gives them (fewest operations first), indented by the chain of
// candidate subgroups below each, with R_int on every measured voxel and on
// the diffuse, what the rule made of each reading, the suggested row and the
// rows the diffuse reading flags. The numbers and the rule are the backend's
// (nebula3d.analysis.laue_compare, docs/algorithms/laue_compare.md); this only
// words them.

import type { LaueCandidate, LaueComparison, LaueReading, LaueVerdict } from "../api/types";
import { laueGroup, presetNamed } from "./laue";

/**
 * The rule's tolerance and its standard errors, as the backend's
 * (nebula3d.analysis.laue_compare DELTA and Z; sharedLimits.replay.test.ts
 * holds the two equal): the help says them.
 */
export const LAUE_RULE_DELTA = 0.1;
export const LAUE_RULE_Z = 2;

/** R_int in one plain line, under the button; the details are behind "?". */
export const RINT_LINE = "R_int: how much symmetry-equivalent voxels disagree. A class that raises it above its subgroups' has operations the sample lacks.";

export type Reading = "all" | "diffuse";

/** One reading's cell: R_int, a second line, and what the rule made of it. */
export interface CellView {
  value: string; // R_int, or – without one
  detail: string; // its ratio to the noise floor, or how far it rose
  state: "ok" | "rose" | "below" | "unjudged" | "flag";
  title: string; // the cell's numbers in full, for the tooltip
}

export interface LaueRow {
  laue: string;
  order: number;
  depth: number; // the chain of candidate subgroups below it, for the indent
  contains: string[]; // its maximal candidate subgroups
  spec: string; // what choosing it writes into the Laue class field
  all: CellView;
  diffuse: CellView;
  orbits: string; // orbits compared on every measured voxel
  orbitsTitle: string;
  suggested: boolean;
  current: boolean; // the class the form holds now
}

/** R_int as the table writes it: three decimals, two figures below 0.01. */
export function formatRint(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "–";
  if (x !== 0 && Math.abs(x) < 0.01) return x.toPrecision(2);
  return x.toFixed(3);
}

/** A count with thousands separators. */
const count = (n: number): string => n.toLocaleString("en-US");

/** A ratio or a rise: two decimals. */
const times = (x: number | null | undefined): string => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(2));

function cell(r: LaueReading | null, v: LaueVerdict | null, flagged: boolean): CellView {
  if (!r || r.r_int == null) return { value: "–", detail: "", state: "unjudged", title: "No orbit with two measured members" };
  const numbers =
    `R_int ${formatRint(r.r_int)}` +
    (r.noise != null ? `; the noise floor ${formatRint(r.noise)}, what counting noise alone gives on these orbits` : "") +
    (r.ratio != null ? `; ${times(r.ratio)}× it (± ${times(r.ratio_se)})` : "") +
    `; ${count(r.orbits)} orbits, ${count(r.voxels)} voxels, ${count(r.pairs)} pairs compared`;
  if (!v || !v.judged || r.ratio == null) return { value: formatRint(r.r_int), detail: "", state: "unjudged", title: numbers };
  if (v.rises) {
    return {
      value: formatRint(r.r_int),
      detail: `rose ${times(v.rise)}× vs ${v.against}`,
      state: flagged ? "flag" : "rose",
      title: `${numbers}. Its ratio to the noise floor rose ${times(v.rise)}× against ${v.against}'s: more than the rule allows.`,
    };
  }
  if (!v.supported) {
    return {
      value: formatRint(r.r_int),
      detail: "a subgroup rose",
      state: flagged ? "flag" : "below",
      title: `${numbers}. One of its subgroups rose against its own, so this class, which contains it, is not supported either.`,
    };
  }
  return { value: formatRint(r.r_int), detail: `${times(r.ratio)}× noise`, state: "ok", title: numbers };
}

/** The class a Laue class field's text names, by the label the backend gives it ("6/mmm", "custom"), or null. */
export function labelOf(spec: string): string | null {
  if (!spec.trim()) return null;
  try {
    return laueGroup(spec).label;
  } catch {
    return null;
  }
}

/** What choosing a candidate writes into the Laue class field: its preset's name, else its generators. */
export const specOf = (c: Pick<LaueCandidate, "laue" | "generators">): string => (presetNamed(c.laue) ? c.laue : c.generators);

/** The table's rows. `currentSpec` is the Laue class field's text now. */
export function laueRows(cmp: LaueComparison, currentSpec: string): LaueRow[] {
  const current = labelOf(currentSpec);
  const currentCustom = current === "custom" ? currentSpec.trim() : null;
  return cmp.candidates.map((c) => {
    const flagged = cmp.disagreement != null && Boolean(c.verdict.all?.supported) && !c.verdict.diffuse?.supported;
    const spec = specOf(c);
    return {
      laue: c.laue,
      order: c.order,
      depth: c.depth,
      contains: c.maximal_subgroups,
      spec,
      all: cell(c.all, c.verdict.all, false),
      diffuse: cell(c.diffuse, c.verdict.diffuse, flagged),
      orbits: c.all ? count(c.all.orbits) : "–",
      orbitsTitle: c.all
        ? `${count(c.all.orbits)} orbits with two measured members or more (${count(c.all.pairs)} pairs) on every measured voxel` +
          (c.diffuse ? `; ${count(c.diffuse.orbits)} on the diffuse` : "")
        : "",
      suggested: cmp.suggestion === c.laue,
      current: currentCustom != null ? c.laue.startsWith("custom") && spec === currentCustom : current === c.laue,
    };
  });
}

/** The comparison's verdict in one line: the suggestion, or why there is none. */
export function verdictLine(cmp: LaueComparison): string {
  if (cmp.suggestion) return `Suggested: ${cmp.suggestion}. ${cmp.reason}`;
  return cmp.reason;
}

/** Where the diffuse reading's voxels come from, in one line. */
export function diffuseLine(cmp: LaueComparison): string {
  const b = cmp.bragg;
  const share = b.share == null ? "" : `, ${(100 * b.share).toFixed(1)}% of the measured voxels`;
  return `Diffuse: the Bragg nodes of the ${b.cell.join("×")} cell masked within ${b.radius_q.toFixed(2)} Å⁻¹${share}. Edge trim ${cmp.edge_trim}.`;
}

/** A refused class's reason, short. */
export function refusalText(r: LaueComparison["refused"][number]): string {
  return r.reason === "metric" && r.metric_change != null
    ? `metric changes by up to ${(100 * r.metric_change).toFixed(0)}%: not symmetries of this lattice`
    : r.reason === "grid"
      ? "its operations do not map this grid onto itself"
      : r.detail;
}
