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
});
