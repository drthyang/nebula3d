// Which stage outputs are stale: older than an output upstream of them, so
// they were made before that stage last ran (the stage was re-run while this
// one was switched off, or not part of the run) and no longer follow from it.
// The raw input is left out: copying a data folder gives the raw file a new
// date without changing what it holds.

import type { StageStatus } from "./types";

// The cleanup chain, upstream first; the ΔPDF is made from the last of them.
export const OUTPUT_ORDER = ["ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"] as const;

/** Each stale output, with the newer output upstream of it that makes it so. */
export function staleOutputs(stages: readonly StageStatus[]): Map<string, string> {
  const written = (name: string): number | null => {
    const s = stages.find((x) => x.name === name);
    return s?.exists && typeof s.mtime === "number" ? s.mtime : null;
  };
  const stale = new Map<string, string>();
  OUTPUT_ORDER.forEach((name, i) => {
    const t = written(name);
    if (t === null) return;
    let newest: { name: string; t: number } | null = null;
    for (const up of OUTPUT_ORDER.slice(0, i)) {
      const u = written(up);
      if (u !== null && u > t && (!newest || u > newest.t)) newest = { name: up, t: u };
    }
    if (newest) stale.set(name, newest.name);
  });
  return stale;
}
