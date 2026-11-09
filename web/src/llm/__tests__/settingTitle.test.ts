// The app's own lines name settings as the console does (apply/settingTitle.ts):
// the run's transcript and Auto panel showed punchFootprint, ringPooledWindow,
// flattenQ2 and flattenFitQMax where the Changes list said "Punch footprint".

import { describe, expect, it } from "vitest";

import { settingTitle } from "../apply/settingTitle";
import { cardSetting } from "../apply/proposals";

describe("a setting's name in the app's words", () => {
  it("is the card's title for a method setting: its stage's word and its Configure label", () => {
    expect(settingTitle("punchFootprint")).toBe("Punch footprint");
    expect(settingTitle("ringPooledWindow")).toBe("Ring stack window (°)");
    expect(settingTitle("flattenQ2")).toBe("Background + b·Q² term");
    expect(settingTitle("flattenFitQMax")).toBe("Background fit to |Q| (Å⁻¹)");
    for (const key of ["punchFootprint", "ringPooledWindow", "flattenQ2", "flattenFitQMax", "punchProfileNSigma"]) {
      expect(settingTitle(key)).toBe(cardSetting(key)!.title);
    }
  });

  it("is the Configure label for another setting, and the key only where the console has no label", () => {
    expect(settingTitle("edgeTrim")).toBe("Edge trim");
    expect(settingTitle("noSuchSetting")).toBe("noSuchSetting");
  });
});
