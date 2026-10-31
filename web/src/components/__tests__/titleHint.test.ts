import { describe, expect, it } from "vitest";

import { MOVE_TOLERANCE, showsTitleOnFocus, stillHolding, titledAncestor, titleText, type TitledNode } from "../titleHint";

// the unit tests run without a DOM: a chain of nodes with what the lookup reads
const node = (tagName: string, attrs: Record<string, string> = {}, parentElement: TitledNode | null = null): TitledNode => ({
  tagName,
  parentElement,
  getAttribute: (n) => attrs[n] ?? null,
});

describe("titledAncestor", () => {
  const body = node("BODY", { title: "never the page's" });
  const label = node("LABEL", { title: "Dashed lines at integer h, k, l" }, node("DIV", {}, body));
  const track = node("SPAN", {}, label);

  it("finds the pressed element's title, or its nearest ancestor's", () => {
    expect(titledAncestor(label)).toBe(label);
    expect(titledAncestor(track)).toBe(label);
  });

  it("stops short of the page's root, and skips an emptied title", () => {
    expect(titledAncestor(node("SPAN", {}, body))).toBeNull();
    const blank = node("BUTTON", { title: "  " }, node("DIV", { title: "the card" }, body));
    expect(titleText(titledAncestor(blank)!)).toBe("the card");
    expect(titledAncestor(null)).toBeNull();
  });

  it("tidies the text's whitespace", () => {
    expect(titleText(node("DIV", { title: "Server: 1 GiB\n  of 64 GiB" }))).toBe("Server: 1 GiB of 64 GiB");
  });
});

describe("showsTitleOnFocus", () => {
  it("shows a field's title when it takes focus", () => {
    expect(showsTitleOnFocus(node("INPUT", { type: "number" }))).toBe(true);
    expect(showsTitleOnFocus(node("INPUT"))).toBe(true);
    expect(showsTitleOnFocus(node("SELECT"))).toBe(true);
    expect(showsTitleOnFocus(node("TEXTAREA"))).toBe(true);
  });

  it("not a switch's, a slider's or a button's: those act on a tap", () => {
    expect(showsTitleOnFocus(node("INPUT", { type: "checkbox" }))).toBe(false);
    expect(showsTitleOnFocus(node("INPUT", { type: "range" }))).toBe(false);
    expect(showsTitleOnFocus(node("BUTTON"))).toBe(false);
    expect(showsTitleOnFocus(null)).toBe(false);
  });
});

describe("stillHolding", () => {
  it("holds within the tolerance, and scrolls beyond it", () => {
    expect(stillHolding({ x: 0, y: 0 }, { x: 6, y: 8 })).toBe(true);
    expect(stillHolding({ x: 0, y: 0 }, { x: 0, y: MOVE_TOLERANCE + 1 })).toBe(false);
  });
});
