// Where region marks' chips go in a view (markChips.ts): beside their outline,
// inside the view, clear of the view's controls and of each other, cut short
// where a row has no room.

import { describe, expect, it } from "vitest";

import { CHIP, CONTROLS, placeChips, rightEdge, type Chip } from "../markChips";

const W = 300, H = 300;
const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const inside = (c: Chip) => c.x >= CHIP.pad && c.x + c.w <= W && c.y >= CHIP.pad && c.y + CHIP.h <= H;
const clearOfControls = (c: Chip) => c.x + c.w <= rightEdge(c.y, W);
const apart = (a: Chip, b: Chip) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + CHIP.h <= b.y || b.y + CHIP.h <= a.y;

describe("placeChips", () => {
  it("puts a chip just above its outline, at its left edge", () => {
    const [c] = placeChips([{ id: "M1", text: "M1 · a ring left over", box: box(60, 120, 140, 180) }], W, H);
    expect(c).toEqual({ id: "M1", x: 60, y: 120 - CHIP.h - 3, w: "M1 · a ring left over".length * CHIP.ch + 10, text: "M1 · a ring left over" });
  });

  it("goes below an outline at the top of the view, and gives none to a mark out of view", () => {
    const chips = placeChips(
      [
        { id: "M1", text: "M1", box: box(40, 2, 80, 30) },
        { id: "M2", text: "M2", box: box(400, 40, 420, 60) },
        { id: "M3", text: "M3", box: null },
      ],
      W,
      H,
    );
    expect(chips.map((c) => c.id)).toEqual(["M1"]);
    expect(chips[0].y).toBe(33);
  });

  it("keeps clear of the field-of-view chip and the zoom buttons, cutting a long text short", () => {
    const text = "M3 · points at a+b, −a−b, 2a+b and more beyond";
    const [c] = placeChips([{ id: "M3", text, box: box(60, 8, 280, 22) }], W, H);
    expect(clearOfControls(c)).toBe(true);
    expect(inside(c)).toBe(true);
    expect(c.text.endsWith("…")).toBe(true);
    expect(c.text.startsWith("M3 · points")).toBe(true);
    expect(c.y).toBeLessThan(CONTROLS.buttonsH);
  });

  it("stacks chips that would overlap", () => {
    const chips = placeChips(
      [
        { id: "M1", text: "M1 · a box at a", box: box(100, 150, 130, 170) },
        { id: "M2", text: "M2 · an ellipsoid at b", box: box(110, 152, 150, 175) },
        { id: "M3", text: "M3 · points", box: box(90, 149, 160, 172) },
      ],
      W,
      H,
    );
    expect(chips).toHaveLength(3);
    for (const c of chips) expect(inside(c) && clearOfControls(c), c.id).toBe(true);
    for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) expect(apart(chips[i], chips[j]), `${chips[i].id} ${chips[j].id}`).toBe(true);
  });
});
