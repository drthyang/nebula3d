// The gesture card's content (gestures.ts): ⌘ on Apple platforms, Ctrl
// elsewhere; the touch gestures on a touch-only device; and only what
// ViewFrame.tsx handles.

import { describe, expect, it } from "vitest";

import { gestureCard, isMacLike, isTouchOnly, wayText, type GestureCard } from "../gestures";

const row = (c: GestureCard, id: string) => c.rows.find((r) => r.id === id)!;
const ways = (c: GestureCard, id: string) => row(c, id).ways.map(wayText);

describe("platform", () => {
  it("is Apple on macOS, iPhone and iPadOS (which reports MacIntel)", () => {
    for (const p of ["MacIntel", "iPhone", "iPad", "macOS"]) expect(isMacLike(p)).toBe(true);
    expect(isMacLike("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)")).toBe(true);
    for (const p of ["Win32", "Linux x86_64", "Linux armv8l"]) expect(isMacLike(p)).toBe(false);
  });

  it("puts ⌘ on Apple platforms and Ctrl elsewhere", () => {
    expect(ways(gestureCard({ mac: true, touch: false }), "zoom")[0]).toBe("Command + scroll");
    expect(ways(gestureCard({ mac: false, touch: false }), "zoom")[0]).toBe("Ctrl + scroll");
    const capOf = (mac: boolean) => row(gestureCard({ mac, touch: false }), "zoom").ways[0][0];
    expect(capOf(true)).toMatchObject({ t: "key", k: "⌘" });
    expect(capOf(false)).toMatchObject({ t: "key", k: "Ctrl" });
  });
});

describe("touch", () => {
  it("is a coarse pointer with no hover (a phone or tablet), not a touch laptop", () => {
    const m = (set: string[]) => (q: string) => set.includes(q);
    expect(isTouchOnly(m(["(pointer: coarse)", "(hover: none)"]))).toBe(true);
    expect(isTouchOnly(m(["(pointer: coarse)"]))).toBe(false); // a stylus or hybrid that hovers
    expect(isTouchOnly(m(["(hover: none)"]))).toBe(false);
    expect(isTouchOnly(m([]))).toBe(false);
  });

  it("shows the touch gestures, and no keys, on a touch-only device", () => {
    const c = gestureCard({ mac: true, touch: true });
    expect(ways(c, "zoom")[0]).toBe("pinch");
    expect(ways(c, "move")).toEqual(["two-finger drag"]);
    expect(ways(c, "reset")[0]).toBe("double-tap");
    expect(c.rows.flatMap((r) => r.ways.flat()).some((t) => t.t === "key")).toBe(false);
  });

  it("says a tap reads values, as no hover can on a touch screen", () => {
    expect(gestureCard({ mac: true, touch: true }).note).toMatch(/tap reads/);
    expect(gestureCard({ mac: true, touch: true }).note).toMatch(/press and hold/i); // the touch path to every title
  });
});

describe("only what the views do", () => {
  const desk = gestureCard({ mac: false, touch: false });

  it("moves with Shift + drag (not click), a middle-drag or the arrows — no two-finger drag, which a trackpad scrolls with", () => {
    expect(ways(desk, "move")).toEqual(["Shift + drag", "middle-drag", "Left Up Down Right"]);
    expect(ways(desk, "move").join(" ")).not.toMatch(/click|two-finger/);
  });

  it("resets by double-click, 0 or Reset zoom; Box zoom takes one drag and Esc cancels", () => {
    expect(ways(desk, "reset")).toEqual(["double-click", "0", "↺ Reset zoom"]);
    expect(ways(desk, "box")).toEqual(["Box zoom then drag a box", "Esc cancels"]);
  });

  it("has one row per action, in the order zoom, move, reset, Box zoom", () => {
    for (const touch of [false, true]) expect(gestureCard({ mac: false, touch }).rows.map((r) => r.id)).toEqual(["zoom", "move", "reset", "box"]);
  });
});
