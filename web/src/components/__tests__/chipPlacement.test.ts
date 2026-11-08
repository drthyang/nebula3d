// Where a highlight's chip may sit on a view (chipPlacement.ts): off the edges,
// and off the view's controls as measured, at any width.

import { describe, expect, it } from "vitest";

import { chipClear, sameBoxes, type Box } from "../chipPlacement";

describe("chipClear", () => {
  const view = (avoid: Box[] | null) => ({ w: 340, h: 340, avoid });
  // The phone's zoom buttons: larger and lower than the desktop's corner.
  const zoom: Box = { x0: 276, y0: 96, x1: 334, y1: 214 };
  const fov: Box = { x0: 240, y0: 4, x1: 336, y1: 36 };

  it("keeps a chip off the measured zoom buttons and readout, all of its width", () => {
    expect(chipClear(290, 150, 50, view([zoom, fov]))).toBe(false); // on the buttons
    expect(chipClear(250, 150, 60, view([zoom, fov]))).toBe(false); // its right edge on them
    expect(chipClear(230, 150, 60, view([zoom, fov]))).toBe(true); // clear of them
    expect(chipClear(250, 222, 60, view([zoom, fov]))).toBe(true); // below them
    expect(chipClear(260, 40, 40, view([zoom, fov]))).toBe(false); // under the readout
  });

  it("keeps the edges whatever the controls, and falls back to the corner without a frame", () => {
    for (const avoid of [[], null]) {
      expect(chipClear(20, 150, 40, view(avoid))).toBe(false);
      expect(chipClear(150, 320, 40, view(avoid))).toBe(false);
      expect(chipClear(150, 150, 40, view(avoid))).toBe(true);
    }
    expect(chipClear(290, 60, 40, view(null))).toBe(false);
    expect(chipClear(290, 150, 40, view(null))).toBe(true); // the old rule let it sit on the phone's buttons
  });

  it("tells a layout that moved from one that did not", () => {
    expect(sameBoxes([zoom], [{ ...zoom, x0: zoom.x0 + 0.2 }])).toBe(true);
    expect(sameBoxes([zoom], [{ ...zoom, y1: zoom.y1 + 3 }])).toBe(false);
    expect(sameBoxes(null, [])).toBe(false);
  });
});
