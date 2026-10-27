// The Pilot's region marks as one slice view draws them (RegionMarks.tsx):
// each mark's section by the view's cut, a one-voxel slab along its cut axis
// (regionMark.ts sectionOf), and whether it is outlined with its label or
// drawn thin and dashed with its id alone. The Q–R page draws them this way
// on its Q views and its ΔPDF view.

import { sectionOf, type PlaneAxes } from "./regionMark";
import type { MarkItem } from "./RegionMarks";
import { CLEANUP_WHERE, WHERE_OUTPUT, type Mark, type MarkWhere } from "../state/markStore";

/**
 * The marks a view of `plane` cut at `cut` draws: each one that meets the
 * slab |w − cut| ≤ `slab` along the cut axis, in the marks' order, outlined
 * where `primary` says so.
 */
export function markItems(marks: readonly Mark[], plane: PlaneAxes, cut: number, slab: number, primary: (mark: Mark) => boolean): MarkItem[] {
  return marks.flatMap((mark) => {
    const section = sectionOf(mark.region, plane, cut, slab);
    return section ? [{ id: mark.id, label: mark.label, section, primary: primary(mark) }] : [];
  });
}

/**
 * The `where` a reciprocal volume file holds, by its name: the dataset's raw
 * file, else the cleanup stage whose output its name ends with
 * ("…_backfilled_flattened.h5" is the flattened stage's); null for any other
 * file (one a ΔPDF record names that is no stage of the dataset's).
 */
export function whereOfFile(file: string | null | undefined, rawName?: string | null): MarkWhere | null {
  if (!file) return null;
  if (rawName && file === rawName) return "raw";
  const stem = file.replace(/\.[^./]+$/, "");
  return CLEANUP_WHERE.find((w) => w !== "raw" && stem.endsWith(`_${WHERE_OUTPUT[w]}`)) ?? null;
}
