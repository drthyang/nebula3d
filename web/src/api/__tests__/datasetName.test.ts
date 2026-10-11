// Two datasets at one temperature get names that tell them apart.

import { describe, expect, it } from "vitest";

import { datasetName } from "../datasetName";
import type { Dataset } from "../types";

const ds = (id: string, temperature: string | null, stem: string): Dataset =>
  ({ id, temperature, stem, raw_name: `${stem}.nxs`, stages: [] }) as unknown as Dataset;

describe("datasetName", () => {
  const a = ds("a", "15K", "X_15K_mmm_cc");
  const b = ds("b", "15K", "X_15K_mmm_cc_sub_bkg");
  const c = ds("c", "60K", "X_60K_mmm_cc_sub_bkg");

  it("is the temperature when it is unique", () => {
    expect(datasetName(c, [a, b, c])).toBe("60K");
    expect(datasetName(a)).toBe("15K");
  });

  it("adds what sets the stem apart when two share a temperature", () => {
    expect(datasetName(b, [a, b, c])).toBe("15K · sub bkg");
    expect(datasetName(a, [a, b, c])).toBe("15K · cc");
  });
});
