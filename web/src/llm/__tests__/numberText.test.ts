// Numbers in the words the app shows (numberText.ts): float noise rounded,
// tiny ones in exponent form, measurements as written.

import { describe, expect, it } from "vitest";

import { numberText, tidyNumbers } from "../numberText";

describe("numberText", () => {
  it("rounds float noise and writes a tiny number in exponent form", () => {
    expect(numberText(0.000003141592653589793)).toBe("3.142e-6");
    expect(numberText(1.1920928955078125e-7)).toBe("1.192e-7");
    expect(numberText(0.9938291760644302)).toBe("0.9938");
    expect(numberText(-3.2500001192092896)).toBe("-3.25");
    expect(numberText(0.00000271)).toBe("2.71e-6");
    expect(numberText(0.0752)).toBe("0.0752");
    expect(numberText(812)).toBe("812");
    expect(numberText(0.99985)).toBe("0.99985");
    expect(numberText(0)).toBe("0");
  });
});

describe("tidyNumbers", () => {
  it("rounds the long decimals in a text and nothing else", () => {
    expect(tidyNumbers("0.000003141592653589793 of the window's weight")).toBe("3.142e-6 of the window's weight");
    expect(tidyNumbers("RMS 0.2417 → 0.0632 Å⁻¹ over 812 peaks; turned 0.043°")).toBe("RMS 0.2417 → 0.0632 Å⁻¹ over 812 peaks; turned 0.043°");
    expect(tidyNumbers("value=1.1920928955078125e-7, then −3.2500001192092896")).toBe("value=1.192e-7, then −3.25");
    expect(tidyNumbers("version 0.4.0, 127.0.0.1, 2026-11-08, 12345678")).toBe("version 0.4.0, 127.0.0.1, 2026-11-08, 12345678");
  });
});
