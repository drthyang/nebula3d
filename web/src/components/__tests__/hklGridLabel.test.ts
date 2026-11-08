// The grid switch on the r.l.u. views draws dashed lines at integer h, k, l.
// That is not a unit cell, so the switch is named "HKL grid" there (the user's
// correction, repeated): the Configure preview, Reciprocal cleanup, the Bragg
// page and its peak tiles, and the Q–R page (three Q views of four). Only the
// real-space views (3D-ΔPDF, multi-volume) keep "Unit cell", where the lines
// are the cell's edges. The setting itself (dpdfStore's `gridlines`) is one,
// and its stored key is unchanged.

import { describe, expect, it } from "vitest";

import { GRID_SWITCH_LABELS, HKL_GRID_LABEL, UNIT_CELL_LABEL, UNIT_CELL_TITLES } from "../viewerText";

interface Fs {
  readFileSync(p: URL, e: "utf8"): string;
}
const SRC = new URL("../../", import.meta.url); // web/src/

/** The r.l.u. views' sources: none may show "Unit cell". */
const RLU_VIEWS = [
  "components/PunchPreview.tsx",
  "components/BraggPeakSlice.tsx",
  "pages/ReciprocalViewer.tsx",
  "pages/BraggProfileViewer.tsx",
  "pages/ConsistencyViewer.tsx",
];

async function read(rel: string): Promise<string> {
  const spec = "node:fs";
  const fs = (await import(/* @vite-ignore */ spec)) as unknown as Fs;
  return fs.readFileSync(new URL(rel, SRC), "utf8");
}

/** The source without its comments: what can reach the page. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the grid switch's name on the r.l.u. views", () => {
  it("is HKL grid wherever the lines are integer h, k, l", () => {
    expect(HKL_GRID_LABEL).toBe("HKL grid");
    expect(GRID_SWITCH_LABELS.hkl).toBe("HKL grid");
    expect(GRID_SWITCH_LABELS.both).toBe("HKL grid");
    expect(UNIT_CELL_TITLES.hkl).not.toMatch(/unit.cell/i);
  });

  it("keeps Unit cell only for the real-space cell edges", () => {
    expect(GRID_SWITCH_LABELS.cell).toBe(UNIT_CELL_LABEL);
    expect(UNIT_CELL_TITLES.cell).toMatch(/cell edges/);
  });

  for (const file of RLU_VIEWS) {
    it(`${file} shows no "Unit cell"`, async () => {
      const src = code(await read(file));
      expect(src).not.toMatch(/unit[ -]cells?\b/i);
      // Its grid switches are the r.l.u. kinds, with no other name forced on them.
      for (const m of src.matchAll(/<UnitCellsSwitch\b([^>]*)\/>/g)) {
        expect(m[1]).toMatch(/kind="(hkl|both)"/);
        expect(m[1]).not.toMatch(/label=(?!\{HKL_GRID_LABEL\})/);
      }
    });
  }
});
