// Which stage outputs are stale. The backend decides it from each output's
// record of what it was made from (its input, the edge trim, the symmetry and
// its stage's settings: nebula3d.pipeline.resume_plan, POST
// /api/pipeline/stale), which the Configure page's stage track shows
// (trackStale). By the dates alone (staleOutputs, below, and the Execution
// page): older than an output upstream of them, so
// they were made before that stage last ran (the stage was re-run while this
// one was switched off, or not part of the run) and no longer follow from it;
// or made from an output that is itself stale (a stage re-run alone on a
// stale input), so staleness runs down the chain.
// The raw input is left out: copying a data folder gives the raw file a new
// date without changing what it holds.
//
// Each cleanup output is made from the nearest output upstream of it that
// exists (the symmetry average's, the first, only when that stage was on). The
// ΔPDF is made from the flattened volume with the background
// correction on and from the backfilled one with it off; its file records
// which (`source`, from a server that says): the outputs past that one are
// not its inputs, so a flattened volume left from before does not make a
// ΔPDF computed without the flatten stale.

import type { StageStatus } from "./types";

// The cleanup chain, upstream first; the ΔPDF is made from the last of them.
export const OUTPUT_ORDER = ["symmetrized", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"] as const;

/**
 * Each stale output, with the output upstream of it that makes it so: one
 * newer than it (the newest such), or else the output it was made from when
 * that one is stale (the map then holds that output too).
 */
export function staleOutputs(stages: readonly StageStatus[]): Map<string, string> {
  const find = (name: string) => stages.find((x) => x.name === name);
  const written = (name: string): number | null => {
    const s = find(name);
    return s?.exists && typeof s.mtime === "number" ? s.mtime : null;
  };
  const stale = new Map<string, string>();
  OUTPUT_ORDER.forEach((name, i) => {
    const t = written(name);
    if (t === null) return;
    // The outputs it is made from, upstream first.
    let inputs: readonly string[] = OUTPUT_ORDER.slice(0, i);
    const source = name === "delta_pdf" ? find(name)?.source : undefined;
    if (source === "raw") inputs = [];
    else if (source && inputs.includes(source)) inputs = inputs.slice(0, inputs.indexOf(source) + 1);
    let newest: { name: string; t: number } | null = null;
    for (const up of inputs) {
      const u = written(up);
      if (u !== null && u > t && (!newest || u > newest.t)) newest = { name: up, t: u };
    }
    if (newest) {
      stale.set(name, newest.name);
      return;
    }
    const from = [...inputs].reverse().find((up) => written(up) !== null);
    if (from && stale.has(from)) stale.set(name, from);
  });
  return stale;
}

/** Why an output on the Configure page's stage track is stale. */
export type TrackStale =
  // The backend's resume rule: a run with the page's settings makes it again,
  // and this is why (its record names another edge trim, Laue class, input or
  // setting, or an output before it is made again).
  | { kind: "settings"; why: string }
  // The dates alone (staleOutputs), while the backend has not answered: older
  // than the output `after`, or made from it while it is stale (`chained`).
  | { kind: "dates"; after: string; chained: boolean };

/**
 * The stage track's stale outputs. The backend's answer (`settings`, from
 * POST /api/pipeline/stale) decides once it has come: it follows each
 * output's record of what it was made from, which the dates cannot, and it is
 * the rule the run itself follows, so an output it lists is made again by a
 * run without Force and one it leaves out is reused. Until then, the dates.
 */
export function trackStale(
  stages: readonly StageStatus[],
  settings: Readonly<Record<string, string>> | undefined,
): Map<string, TrackStale> {
  const out = new Map<string, TrackStale>();
  if (settings) {
    for (const name of OUTPUT_ORDER) {
      const why = settings[name];
      if (why && stages.some((s) => s.name === name && s.exists)) out.set(name, { kind: "settings", why });
    }
    return out;
  }
  const dated = staleOutputs(stages);
  for (const [name, after] of dated) out.set(name, { kind: "dates", after, chained: dated.has(after) });
  return out;
}
