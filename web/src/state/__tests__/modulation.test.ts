// The sample's modulation as the Configure page holds it (state/modulation.ts):
// k as Modulation.parse splits it, the request a run sends, the line the
// Pilot reads, and a declaration read back from what the model proposes. What
// a declaration protects is the backend's; nothing here computes a position.
// The Python side's reading of the same k is pinned in
// sharedLimits.replay.test.ts.

import { describe, expect, it } from "vitest";

import { BLANK_MODULATION, DeclarationError, kVectors, migratedProtection, modulationFieldsOf, modulationRequest, modulationText } from "../modulation";

const fields = (patch: Partial<typeof BLANK_MODULATION>) => ({ ...BLANK_MODULATION, ...patch });

describe("k, as Modulation.parse splits it", () => {
  it.each([
    ["1/3, 0, 0", [["1/3", "0", "0"]]],
    ["(1/3,0,0)", [["1/3", "0", "0"]]],
    ["[0.2, 0, 1/2]", [["0.2", "0", "1/2"]]],
    ["1/3 0 0; ⟨0 1/3 0⟩", [["1/3", "0", "0"], ["0", "1/3", "0"]]],
    ["−1/3, 0, 0", [["−1/3", "0", "0"]]],
    ["1e-1, 0, 0", [["1e-1", "0", "0"]]],
  ])("reads %j as %j", (text, vectors) => {
    expect(kVectors(text)).toEqual(vectors);
  });

  it.each(["", "thirds", "1/3, 0", "1/3, 0, 0, 0", "1/0, 0, 0", "0, 0, 0", "0/3, 0, 0", "1/3, 0, 0; 0, 0, 0", "1/3, x, 0"])("refuses %j", (text) => {
    expect(kVectors(text)).toBeNull();
  });
});

describe("the request a run sends", () => {
  it("carries nothing for a blank k (the backend's default), none for none, and a declaration's fields as typed", () => {
    expect(modulationRequest(fields({ modulationOrder: "2", modulationForm: "planes" }))).toBeUndefined();
    expect(modulationRequest(fields({ modulationK: " OFF " }))).toBe("none");
    expect(modulationRequest(fields({ modulationK: "1/3, 0, 0" }))).toEqual({ k: "1/3, 0, 0" });
    expect(modulationRequest(fields({ modulationK: "1/3, 0, 0", modulationOrder: " 2 ", modulationForm: "Planes", modulationHalfWidth: "0.05" }))).toEqual({
      k: "1/3, 0, 0",
      order: "2",
      form: "planes",
      half_width: "0.05",
    });
  });
});

describe("the line the Pilot reads", () => {
  it("says default, none, or the declaration with each blank field as its default", () => {
    expect(modulationText(BLANK_MODULATION)).toBe("default");
    expect(modulationText(fields({ modulationK: "none", modulationForm: "planes" }))).toBe("none");
    expect(modulationText(fields({ modulationK: "1/3,0,0", modulationForm: "planes" }))).toBe("k = (1/3, 0, 0), order 1, planes, ± 0.08 r.l.u.");
    expect(modulationText(fields({ modulationK: "0.2 0 1/2; 0 0.2 1/2", modulationOrder: "2", modulationHalfWidth: "0.05" }))).toBe(
      "k = (0.2, 0, 1/2) and (0, 0.2, 1/2), order 2, points, ± 0.05 r.l.u.",
    );
  });
});

describe("what the model proposes", () => {
  it("reads default, none, k alone, an object and the line it reads back", () => {
    for (const v of [undefined, null, "", "default", " Default "]) expect(modulationFieldsOf(v)).toEqual(BLANK_MODULATION);
    expect(modulationFieldsOf("none")).toEqual(fields({ modulationK: "none" }));
    expect(modulationFieldsOf({ k: "none", form: "planes" })).toEqual(fields({ modulationK: "none" }));
    expect(modulationFieldsOf("(1/3, 0, 0)")).toEqual(fields({ modulationK: "1/3, 0, 0" }));
    expect(modulationFieldsOf([[0.2, 0, 0.5], ["0", "1/5", "1/2"]])).toEqual(fields({ modulationK: "0.2, 0, 0.5; 0, 1/5, 1/2" }));
    expect(modulationFieldsOf({ k: "1/3, 0, 0", order: "2", form: "PLANES", half_width: "0.05" })).toEqual({
      modulationK: "1/3, 0, 0",
      modulationOrder: "2",
      modulationForm: "planes",
      modulationHalfWidth: "0.05",
    });
    // The line modulationText writes reads back as the fields it was written from.
    const declared = fields({ modulationK: "0.2, 0, 1/2; 0, 0.2, 1/2", modulationOrder: "2", modulationForm: "planes", modulationHalfWidth: "0.05" });
    expect(modulationFieldsOf(modulationText(declared))).toEqual(declared);
    expect(modulationFieldsOf("k = (1/3, 0, 0), planes")).toEqual(fields({ modulationK: "1/3, 0, 0", modulationForm: "planes" }));
  });

  it.each([
    [{ k: "thirds" }, /k is one or more vectors of three components/],
    [{ k: [1, 2] }, /k is one or more vectors/],
    [{ k: "1/3, 0, 0", order: 0 }, /order is a whole number from 1 to 6/],
    [{ k: "1/3, 0, 0", order: 1.5 }, /order is a whole number/],
    [{ k: "1/3, 0, 0", form: "rods" }, /form is points or planes/],
    [{ k: "1/3, 0, 0", half_width: 0 }, /half_width is above 0 and below 0.5/],
    [{ k: "1/3, 0, 0", half_width: "wide" }, /half_width is above 0/],
    [{ order: 2 }, /modulation needs k/],
    [{ k: "1/3, 0, 0", normal: [1, 0, 0] }, /not normal/],
    [42, /give \{"k"/],
    ["k = 1/3", /k is one or more vectors/],
  ])("refuses %j, saying what is wrong", (value, why) => {
    expect(() => modulationFieldsOf(value)).toThrow(DeclarationError);
    expect(() => modulationFieldsOf(value)).toThrow(why);
  });
});

describe("a remembered half width alone, since nothing is declared by default (plan 4.15, P3)", () => {
  it("declares none and keeps the width; the run sends none", () => {
    const migrated = migratedProtection({ punchProtectHalfWidth: "0.05" });
    expect(migrated).toEqual(fields({ modulationK: "none", modulationHalfWidth: "0.05" }));
    expect(modulationRequest(migrated!)).toBe("none");
    expect(modulationText(migrated!)).toBe("none");
  });

  it("is the same where the fractions beside it could not be read", () => {
    expect(migratedProtection({ punchProtectH: "thirds", punchProtectHalfWidth: "0.05" })).toEqual(
      fields({ modulationK: "none", modulationHalfWidth: "0.05" }),
    );
  });
});
