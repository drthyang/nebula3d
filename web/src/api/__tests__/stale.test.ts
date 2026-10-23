// An output older than one upstream of it was made before that stage last ran.

import { describe, expect, it } from "vitest";

import { staleOutputs } from "../stale";
import type { StageStatus } from "../types";

const at = (written: Record<string, number | null>): StageStatus[] =>
  ["raw", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"].map((name) => ({
    name,
    exists: written[name] != null,
    kind: name === "delta_pdf" ? "delta_pdf" : "hkl",
    volume_id: `d.${name}`,
    mtime: written[name] ?? null,
  }));

describe("staleOutputs", () => {
  it("finds nothing stale after a full run, each output written after the one before it", () => {
    expect(staleOutputs(at({ raw: 0, ringremoved: 10, braggpunched: 11, backfilled: 12, flattened: 13, delta_pdf: 14 })).size).toBe(0);
  });

  it("marks the outputs a re-run of an upstream stage left behind, naming the newest output upstream", () => {
    // The punch and backfill were re-run with the flatten and the ΔPDF switched off.
    const stale = staleOutputs(at({ raw: 0, ringremoved: 10, braggpunched: 20, backfilled: 21, flattened: 13, delta_pdf: 14 }));
    expect([...stale.entries()]).toEqual([["flattened", "backfilled"], ["delta_pdf", "backfilled"]]);
  });

  it("leaves the raw input out, and reads no dates as nothing stale", () => {
    expect(staleOutputs(at({ raw: 99, ringremoved: 10, braggpunched: 11 })).size).toBe(0);
    expect(staleOutputs(at({ raw: 0, ringremoved: 10, delta_pdf: null })).size).toBe(0);
    const undated = at({ raw: 0, ringremoved: 10, braggpunched: 11 }).map((s) => ({ ...s, mtime: undefined }));
    expect(staleOutputs(undated).size).toBe(0);
  });
});
