// The Pilot's region marks as one slice view draws them (markItems.ts): the
// marks that meet the view's slab, outlined or dashed as the page says; and
// which cleanup stage a volume file is, so the Q–R page outlines a mark on
// its Data view only when the round trip reads the stage it was found in.

import { describe, expect, it } from "vitest";

import { markItems, whereOfFile } from "../markItems";
import type { Mark } from "../../state/markStore";

const FRAME = { target: { x0: 0, x1: 1, y0: 0, y1: 1 }, fit: { cx: 0, cy: 0, half: 5 }, data: { x0: -5, x1: 5, y0: -5, y1: 5 }, minHalf: 0.1, maxHalf: 6 };
const mark = (id: string, fields: Partial<Mark>): Mark => ({
  id,
  datasetId: "synth-100K",
  where: "flatten",
  region: { shape: "box", center: [0.5, 0.5, 0], half: [0.1, 0.1, 0.1] },
  label: `label of ${id}`,
  evidence: [],
  created: "",
  view: { page: "cleanup", axis: "L", value: 0, frame: FRAME },
  ...fields,
});

// The H–K plane (cut along L), with a slab of half a 0.05 r.l.u. step.
const HK = { u: 0, v: 1, cut: 2 } as const;

describe("markItems", () => {
  const box = mark("M1", {});
  const points = mark("M2", { where: "raw", region: { shape: "points", points: [[1, 0, 0], [0, 1, 0.5]] } });
  const ellipsoid = mark("M3", { region: { shape: "ellipsoid", center: [-1, -1, 0.3], half: [0.2, 0.4, 0.2] } });

  it("draws each mark that meets the slab, in order, outlined where the page says", () => {
    const items = markItems([box, points, ellipsoid], HK, 0, 0.025, (m) => m.where === "flatten");
    expect(items.map((i) => [i.id, i.label, i.primary])).toEqual([
      ["M1", "label of M1", true],
      ["M2", "label of M2", false],
      // M3's centre is 0.3 r.l.u. off the cut, past its 0.2 semi-axis plus the slab: it misses this plane.
    ]);
    expect(items[0].section).toEqual({ kind: "rect", u: [0.4, 0.6], v: [0.4, 0.6] });
    // Only the point on L = 0 is drawn.
    expect(items[1].section).toEqual({ kind: "points", pts: [[1, 0]] });
  });

  it("cuts on the view's own axes: a z–x section draws z across and x up", () => {
    const pdf = mark("M4", { where: "pdf", region: { shape: "box", center: [2, 3, 4], half: [0.5, 0.5, 1] } });
    const [item] = markItems([pdf], { u: 2, v: 0, cut: 1 }, 3.2, 0.25, () => true);
    expect(item.section).toEqual({ kind: "rect", u: [3, 5], v: [1.5, 2.5] });
    expect(markItems([pdf], { u: 2, v: 0, cut: 1 }, 4, 0.25, () => true)).toEqual([]);
  });

  it("draws nothing without marks", () => {
    expect(markItems([], HK, 0, 0.025, () => true)).toEqual([]);
  });
});

describe("whereOfFile", () => {
  it("reads the stage from the chained file name the pipeline writes", () => {
    expect(whereOfFile("synth_100K_ringremoved_braggpunched_backfilled_flattened.h5")).toBe("flatten");
    expect(whereOfFile("synth_100K_ringremoved_braggpunched_backfilled.h5")).toBe("backfill");
    expect(whereOfFile("synth_100K_ringremoved_braggpunched.h5")).toBe("punch");
    expect(whereOfFile("synth_100K_ringremoved.h5")).toBe("rings");
  });

  it("names the raw file only when it is the dataset's raw file", () => {
    expect(whereOfFile("synth_100K.nxs", "synth_100K.nxs")).toBe("raw");
    expect(whereOfFile("synth_100K.nxs")).toBeNull();
    expect(whereOfFile("synth_100K.nxs", "other.nxs")).toBeNull();
  });

  it("is null for no file and for a file that is no stage's", () => {
    expect(whereOfFile(null)).toBeNull();
    expect(whereOfFile(undefined)).toBeNull();
    expect(whereOfFile("")).toBeNull();
    expect(whereOfFile("synth_100K_my_edit.h5")).toBeNull();
    // A stage name inside the stem, not at its end, is not that stage's output.
    expect(whereOfFile("synth_flattened_copy.h5")).toBeNull();
    expect(whereOfFile("synth_100K_delta_pdf.h5")).toBeNull();
  });
});
