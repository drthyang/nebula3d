// Two datasets at one temperature get names that tell them apart.

import { describe, expect, it } from "vitest";

import { datasetName, menuDatasets } from "../datasetName";
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

describe("the dataset menu", () => {
  const own = ds("x-22k", "22K", "X_22K");
  const other = ds("x-60k", "60K", "X_60K");
  const runA = ds("x-22k~tune~20261109T092641-5c9a", "22K", "X_22K");
  const runB = ds("x-22k~tune~20261109T093715-37c0", "22K", "X_22K");
  const all = [own, runA, runB, other];

  it("offers the folder's own datasets, not each tuning run's view of one", () => {
    expect(menuDatasets(all, own.id).map((d) => d.id)).toEqual([own.id, other.id]);
    expect(menuDatasets(all, null).map((d) => d.id)).toEqual([own.id, other.id]);
  });

  it("keeps the tuning view that is open (its card opened it)", () => {
    expect(menuDatasets(all, runB.id).map((d) => d.id)).toEqual([own.id, runB.id, other.id]);
  });
});
