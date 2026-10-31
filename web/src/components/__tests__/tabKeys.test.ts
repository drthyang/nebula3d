// The tab list's keys (WAI-ARIA tabs, automatic activation): the arrows along
// the list move and wrap, Home and End go to the ends, other keys are left to
// the page.

import { describe, expect, it } from "vitest";

import { tabId, tabKeyTarget, tabPanelId } from "../tabKeys";

describe("tabKeyTarget", () => {
  it("moves right and left along a horizontal list, wrapping at the ends", () => {
    expect(tabKeyTarget("ArrowRight", 0, 3)).toBe(1);
    expect(tabKeyTarget("ArrowRight", 2, 3)).toBe(0);
    expect(tabKeyTarget("ArrowLeft", 1, 3)).toBe(0);
    expect(tabKeyTarget("ArrowLeft", 0, 3)).toBe(2);
  });

  it("goes to the first and the last tab on Home and End", () => {
    expect(tabKeyTarget("Home", 2, 3)).toBe(0);
    expect(tabKeyTarget("End", 0, 3)).toBe(2);
  });

  it("leaves ↑ and ↓ to the page on a horizontal list, and answers them on a vertical one", () => {
    expect(tabKeyTarget("ArrowDown", 0, 3)).toBeNull();
    expect(tabKeyTarget("ArrowUp", 0, 3)).toBeNull();
    expect(tabKeyTarget("ArrowDown", 0, 3, "vertical")).toBe(1);
    expect(tabKeyTarget("ArrowUp", 0, 3, "vertical")).toBe(2);
    expect(tabKeyTarget("ArrowRight", 0, 3, "vertical")).toBeNull();
  });

  it("ignores other keys", () => {
    for (const key of ["Enter", " ", "Tab", "a", "Escape"]) expect(tabKeyTarget(key, 1, 3)).toBeNull();
  });

  it("counts an index outside the list as the first tab, and handles an empty list", () => {
    expect(tabKeyTarget("ArrowRight", -1, 3)).toBe(1);
    expect(tabKeyTarget("ArrowLeft", 7, 3)).toBe(2);
    expect(tabKeyTarget("ArrowRight", 0, 0)).toBeNull();
    expect(tabKeyTarget("ArrowRight", 0, 1)).toBe(0);
  });
});

describe("tab and panel ids", () => {
  it("ties each tab to the list's one panel", () => {
    expect(tabId(":r1:", "hk")).toBe(":r1:-tab-hk");
    expect(tabPanelId(":r1:")).toBe(":r1:-panel");
    expect(tabId("a", "hk")).not.toBe(tabId("a", "hl"));
  });
});
