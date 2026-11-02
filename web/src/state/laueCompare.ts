// The Laue-class comparison as the Configure page's table shows it (the
// symmetry average's section): one row per candidate class, in the order the
// backend gives them (fewest operations first), indented by the chain of
// candidate subgroups below each, with R_int on every measured voxel and on
// the diffuse, what the rule made of each reading, χ²/dof, the suggested row
// and the rows the diffuse reading flags; the block bootstrap behind the
// standard errors in a line; the common-subset diagnostic in its own rows.
// The numbers and the rule are the backend's (nebula3d.analysis.laue_compare,
// docs/algorithms/laue_compare.md); this only words them.

import type { LaueCandidate, LaueComparison, LaueReading, LaueVerdict, StageParamsIn } from "../api/types";
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

/** χ²/dof in one plain line, under the table; the details are behind "?". */
export const CHI2_LINE = "χ²/dof: the disagreement in units of the counting noise; 1 means the equivalents agree within it.";

export type Reading = "all" | "diffuse";

/** One reading's cell: R_int, a second line, and what the rule made of it. */
export interface CellView {
  value: string; // R_int, or – without one
  detail: string; // its ratio to the noise floor, or how far it rose: lead + tail
  lead: string; // the second line's figure ("1.00×", "rose 2.08×"): all a phone shows
  tail: string; // its words (" noise", " vs -1")
  state: "ok" | "rose" | "below" | "unjudged" | "flag";
  title: string; // the cell's numbers in full, for the tooltip
}

/** A cell from its parts: the detail is the lead and the tail together. */
const view = (value: string, lead: string, tail: string, state: CellView["state"], title: string): CellView => ({
  value,
  detail: lead + tail,
  lead,
  tail,
  state,
  title,
});

export interface LaueRow {
  laue: string;
  order: number;
  depth: number; // the chain of candidate subgroups below it, for the indent
  contains: string[]; // its maximal candidate subgroups
  spec: string; // what choosing it writes into the Laue class field
  all: CellView;
  diffuse: CellView;
  orbits: string; // orbits compared on every measured voxel
  orbitsShort: string; // the same, compact for a phone ("2.09M", "593k")
  orbitsTitle: string;
  chi2: { all: string; diffuse: string; title: string }; // χ²/dof of each reading
  suggested: boolean;
  current: boolean; // the class the form holds now
}

/** One class on the common subset: its ratio to the noise floor in each reading, and what the rule made of it there. */
export interface CommonRow {
  laue: string;
  depth: number;
  all: { value: string; state: CellView["state"]; title: string };
  diffuse: { value: string; state: CellView["state"]; title: string };
  suggested: boolean; // the rule's suggestion on the common subset
}

/** Whether a run setting is one the comparison reads: the edge trim, the punch cell, the punch footprint's frame, radii and margin, the direct beam's. */
const READS = (key: string): boolean =>
  key === "edge_trim" ||
  key.startsWith("punch_supercell_") ||
  key === "punch_frame" ||
  key.startsWith("punch_spherical_radius_") ||
  key.startsWith("punch_q_radius_") ||
  key === "punch_margin" ||
  key.startsWith("incident_beam_q_");

/**
 * The run's settings the comparison reads, and only those: another setting
 * the backend would refuse (a band, a modulation) then cannot stop it, and a
 * change to one it does not read leaves an earlier result standing.
 */
export const laueCompareParams = (params: StageParamsIn): StageParamsIn =>
  Object.fromEntries(Object.entries(params).filter(([k]) => READS(k))) as StageParamsIn;

/** R_int as the table writes it: three decimals, two figures below 0.01. */
export function formatRint(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "–";
  if (x !== 0 && Math.abs(x) < 0.01) return x.toPrecision(2);
  return x.toFixed(3);
}

/** A count with thousands separators. */
const count = (n: number): string => n.toLocaleString("en-US");

/** A count compact: millions to two decimals, thousands rounded, the rest whole. */
export const countShort = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : count(n);

/** A ratio or a rise: two decimals. */
const times = (x: number | null | undefined): string => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(2));

/** χ²/dof: two decimals below 10, one below 100, whole above. */
export function formatChi2(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "–";
  return x < 10 ? x.toFixed(2) : x < 100 ? x.toFixed(1) : Math.round(x).toString();
}

function cell(r: LaueReading | null, v: LaueVerdict | null, flagged: boolean): CellView {
  if (!r || r.r_int == null) return view("–", "", "", "unjudged", "No orbit with two measured members");
  const numbers =
    `R_int ${formatRint(r.r_int)}` +
    (r.noise != null ? `; the noise floor ${formatRint(r.noise)}, what counting noise alone gives on these orbits` : "") +
    (r.ratio != null ? `; ${times(r.ratio)}× it (± ${times(r.ratio_se)}, block bootstrap)` : "") +
    (r.chi2 != null ? `; χ²/dof ${formatChi2(r.chi2)}` : "") +
    `; ${count(r.orbits)} orbits, ${count(r.voxels)} voxels, ${count(r.pairs)} pairs compared`;
  if (!v || !v.judged || r.ratio == null) return view(formatRint(r.r_int), "", "", "unjudged", numbers);
  if (v.rises) {
    return view(
      formatRint(r.r_int),
      `rose ${times(v.rise)}×`,
      ` vs ${v.against}`,
      flagged ? "flag" : "rose",
      `${numbers}. Its ratio to the noise floor rose ${times(v.rise)}× against ${v.against}'s: more than the rule allows.`,
    );
  }
  if (!v.supported) {
    return view(
      formatRint(r.r_int),
      "a subgroup rose",
      "",
      flagged ? "flag" : "below",
      `${numbers}. One of its subgroups rose against its own, so this class, which contains it, is not supported either.`,
    );
  }
  return view(formatRint(r.r_int), `${times(r.ratio)}×`, " noise", "ok", numbers);
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
      orbitsShort: c.all ? countShort(c.all.orbits) : "–",
      orbitsTitle: c.all
        ? `${count(c.all.orbits)} orbits with two measured members or more (${count(c.all.pairs)} pairs) on every measured voxel` +
          (c.diffuse ? `; ${count(c.diffuse.orbits)} on the diffuse` : "")
        : "",
      chi2: {
        all: formatChi2(c.all?.chi2),
        diffuse: formatChi2(c.diffuse?.chi2),
        title:
          `χ²/dof ${formatChi2(c.all?.chi2)} on every measured voxel, ${formatChi2(c.diffuse?.chi2)} on the diffuse` +
          (c.all?.dof ? ` (${count(c.all.dof)} and ${count(c.diffuse?.dof ?? 0)} degrees of freedom)` : "") +
          ": 1 is agreement within the counting noise",
      },
      suggested: cmp.suggestion === c.laue,
      current: currentCustom != null ? c.laue.startsWith("custom") && spec === currentCustom : current === c.laue,
    };
  });
}

/** One reading of a class on the common subset. */
function commonCell(r: LaueReading | null | undefined, v: LaueVerdict | null | undefined): CommonRow["all"] {
  if (!r || r.ratio == null || !v || !v.judged) return { value: "–", state: "unjudged", title: "Not judged on the common subset" };
  const numbers = `${times(r.ratio)}× the noise floor (± ${times(r.ratio_se)}) on ${count(r.orbits)} orbits`;
  if (v.rises) return { value: `${times(r.ratio)}×`, state: "rose", title: `${numbers}; rose ${times(v.rise)}× against ${v.against}` };
  if (!v.supported) return { value: `${times(r.ratio)}×`, state: "below", title: `${numbers}; a subgroup rose` };
  return { value: `${times(r.ratio)}×`, state: "ok", title: numbers };
}

/** The common-subset diagnostic's rows: every class on the voxels the lowest class can judge. */
export function commonRows(cmp: LaueComparison): CommonRow[] {
  return cmp.candidates.map((c) => ({
    laue: c.laue,
    depth: c.depth,
    all: commonCell(c.common?.all, c.verdict.common_all),
    diffuse: commonCell(c.common?.diffuse, c.verdict.common_diffuse),
    suggested: cmp.common?.suggestion === c.laue,
  }));
}

/** The common subset in one plain line: whose voxels, how many, and what the rule suggests there. */
export function commonLine(cmp: LaueComparison): string | null {
  const c = cmp.common;
  if (!c || !c.lowest) return null;
  const share = c.share == null ? "" : ` (${Math.round(100 * c.share)}% of the measured)`;
  if (c.share != null && c.share >= 0.9995) return `Common subset: ${c.lowest} judges every measured voxel, so it reads the same as the table.`;
  const verdict = c.suggestion ? `suggests ${c.suggestion}` : "no suggestion";
  return `Common subset, the voxels ${c.lowest} can judge${share}: ${verdict}.`;
}

/** The block bootstrap behind the standard errors, in one plain line. */
export function bootstrapLine(cmp: LaueComparison): string | null {
  const b = cmp.bootstrap;
  if (!b || !b.blocks) return null;
  const eff = b.effective_blocks != null ? ` (≈ ${Math.round(b.effective_blocks)} effective)` : "";
  return `Errors: ${count(b.blocks)} blocks of ${b.block_voxels}³ voxels${eff}, resampled ${b.replicates} times.`;
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
