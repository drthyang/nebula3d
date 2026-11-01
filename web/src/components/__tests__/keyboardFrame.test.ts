import { describe, expect, it } from "vitest";

import { isEditable, KEYBOARD_MIN, keyboardFrame } from "../keyboardFrame";

const reading = (over: Partial<Parameters<typeof keyboardFrame>[0]> = {}) => ({
  layoutHeight: 844,
  height: 844,
  offsetTop: 0,
  scale: 1,
  editing: true,
  ...over,
});

describe("keyboardFrame", () => {
  it("is null with no keyboard up", () => {
    expect(keyboardFrame(reading())).toBeNull();
  });

  it("fits the shell to the visual viewport above the keyboard, panned as the browser panned it", () => {
    // an iPhone 390 × 844 with the keyboard and its accessory bar up
    expect(keyboardFrame(reading({ height: 462.4, offsetTop: 120.6 }))).toEqual({ height: 462, top: 121 });
  });

  it("ignores a collapsing toolbar, which is a much smaller shortfall", () => {
    expect(keyboardFrame(reading({ height: 844 - (KEYBOARD_MIN - 1) }))).toBeNull();
    expect(keyboardFrame(reading({ height: 844 - KEYBOARD_MIN }))).not.toBeNull();
  });

  it("ignores a pinch zoom, which shrinks the visual viewport too", () => {
    expect(keyboardFrame(reading({ height: 422, scale: 2 }))).toBeNull();
  });

  it("is null when no text field has focus (the keyboard is closing)", () => {
    expect(keyboardFrame(reading({ height: 462, editing: false }))).toBeNull();
  });

  it("never pans above the top", () => {
    expect(keyboardFrame(reading({ height: 500, offsetTop: -3 }))?.top).toBe(0);
  });
});

describe("isEditable", () => {
  // the unit tests run without a DOM: just what isEditable reads
  const el = (tagName: string, attrs: Record<string, string> = {}, more: object = {}) =>
    ({ tagName, readOnly: "readonly" in attrs, getAttribute: (n: string) => attrs[n] ?? null, ...more }) as unknown as Element;

  it("counts text fields, number fields and text areas", () => {
    expect(isEditable(el("TEXTAREA"))).toBe(true);
    expect(isEditable(el("INPUT"))).toBe(true);
    expect(isEditable(el("INPUT", { type: "number" }))).toBe(true);
    expect(isEditable(el("INPUT", { type: "Text" }))).toBe(true);
    expect(isEditable(el("DIV", {}, { isContentEditable: true }))).toBe(true);
  });

  it("leaves out controls that bring up no keyboard", () => {
    expect(isEditable(el("INPUT", { type: "range" }))).toBe(false);
    expect(isEditable(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isEditable(el("BUTTON"))).toBe(false);
    expect(isEditable(el("TEXTAREA", { readonly: "" }))).toBe(false);
    expect(isEditable(el("DIV"))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
