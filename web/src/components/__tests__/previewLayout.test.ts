// The Configure preview's layout switch: three planes side by side on a wide
// card, tabs on a narrow one, with a little hysteresis at the threshold.

import { describe, expect, it } from "vitest";

import { SIDE_BY_SIDE_HYSTERESIS, SIDE_BY_SIDE_MIN_WIDTH, sideBySide } from "../previewLayout";

describe("the preview's side-by-side layout", () => {
  it("starts at the threshold and stays tabbed under it", () => {
    expect(sideBySide(SIDE_BY_SIDE_MIN_WIDTH, false)).toBe(true);
    expect(sideBySide(SIDE_BY_SIDE_MIN_WIDTH - 1, false)).toBe(false);
  });

  it("gives each of the three views about 350 px or more at the threshold", () => {
    // The card's 16 px padding each side and two 10 px gaps come off first.
    expect((SIDE_BY_SIDE_MIN_WIDTH - 2 * 16 - 2 * 10) / 3).toBeGreaterThanOrEqual(349);
  });

  it("takes the card widths the layout tiers give at common window widths", () => {
    // Measured with the Pilot dock folded to its 44 px rail: the window less
    // the sidebar (224 px; 208 px under 1440; 240 px from 1800) and the gutters.
    const card = { 1280: 980, 1366: 1066, 1440: 1116, 1512: 1188, 1920: 1564 };
    expect(sideBySide(card[1920], false)).toBe(true);
    expect(sideBySide(card[1512], false)).toBe(true);
    expect(sideBySide(card[1440], false)).toBe(true);
    expect(sideBySide(card[1366], false)).toBe(false);
    expect(sideBySide(card[1280], false)).toBe(false);
  });

  it("folds back into tabs only a little under the threshold", () => {
    expect(sideBySide(SIDE_BY_SIDE_MIN_WIDTH - 10, true)).toBe(true);
    expect(sideBySide(SIDE_BY_SIDE_MIN_WIDTH - SIDE_BY_SIDE_HYSTERESIS, true)).toBe(true);
    expect(sideBySide(SIDE_BY_SIDE_MIN_WIDTH - SIDE_BY_SIDE_HYSTERESIS - 1, true)).toBe(false);
  });

  it("keeps the layout it has while the card is not laid out", () => {
    expect(sideBySide(0, true)).toBe(true);
    expect(sideBySide(0, false)).toBe(false);
    expect(sideBySide(Number.NaN, true)).toBe(true);
  });
});
