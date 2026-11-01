// The viewer pages' shared control text (THY-39): one plain line per tooltip,
// short enough to read at a glance; the details live behind the "?".

import { describe, expect, it } from "vitest";

import * as text from "../viewerText";

const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

describe("viewer tooltips", () => {
  const all = Object.values(text).flatMap(strings);

  it("are one line each, without nested parentheses", () => {
    expect(all.length).toBeGreaterThan(15);
    for (const s of all) {
      expect(s).not.toMatch(/\n/);
      expect(s).not.toMatch(/\([^)]*\(/);
    }
  });

  it("stay short", () => {
    for (const s of all) expect(s.length, s).toBeLessThanOrEqual(90);
  });

  it("no longer mention the gestures THY-38 removed", () => {
    for (const s of all) expect(s).not.toMatch(/Shift\+double-click|Alt-click|zoom in 2×|Move mode/);
  });

  it("no longer mention the Navigate mode, which is gone", () => {
    for (const s of all) expect(s).not.toMatch(/Navigate/);
    expect(text.BOX_ZOOM_TITLE).toMatch(/^Box zoom: /);
  });
});

describe("the grid switch's names", () => {
  it("is HKL grid on the Configure preview, with the integer-h, k, l tooltip", () => {
    // The user's names: "HKL grid" on Configure, "Unit cell" elsewhere (WorkspaceHeader's default).
    expect(text.HKL_GRID_LABEL).toBe("HKL grid");
    expect(text.UNIT_CELL_TITLES.hkl).toBe("Dashed lines at integer h, k, l");
  });
});

describe("the folded display row's summary", () => {
  const lv = (hi: number) => ({ levels: { hi } });
  it("names the scale of sequential data, lin when none is set", () => {
    expect(text.displaySummaryText({ scale: "asinh", lv: lv(3) })).toBe("asinh");
    expect(text.displaySummaryText({ lv: lv(3) })).toBe("lin");
  });
  it("gives the ± limit of signed data", () => {
    expect(text.displaySummaryText({ symmetric: true, lv: lv(2320) })).toBe("±2.32e+3");
    expect(text.displaySummaryText({ symmetric: true, lv: lv(-55.1) })).toBe("±55.1");
  });
});
