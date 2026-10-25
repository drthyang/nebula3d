// An output older than one upstream of it was made before that stage last ran;
// one made from a stale output is stale too; the ΔPDF's inputs are the ones up
// to the output its file says it was made from.

import { describe, expect, it } from "vitest";

import { staleOutputs } from "../stale";
import type { StageStatus } from "../types";

const at = (written: Record<string, number | null>, source?: string): StageStatus[] =>
  ["raw", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"].map((name) => ({
    name,
    exists: written[name] != null,
    kind: name === "delta_pdf" ? "delta_pdf" : "hkl",
    volume_id: `d.${name}`,
    mtime: written[name] ?? null,
    ...(name === "delta_pdf" && source !== undefined ? { source } : {}),
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

  it("passes staleness down: an output rebuilt later from a stale one is stale, naming that one", () => {
    // The ring removal was re-run alone (punch now stale), then the backfill alone, from the stale punch.
    const stale = staleOutputs(at({ raw: 0, ringremoved: 20, braggpunched: 11, backfilled: 30, flattened: 31, delta_pdf: 32 }, "flattened"));
    expect([...stale.entries()]).toEqual([["braggpunched", "ringremoved"], ["backfilled", "braggpunched"], ["flattened", "backfilled"], ["delta_pdf", "flattened"]]);
  });

  it("follows the ΔPDF's link to the flattened volume only when it was made from it", () => {
    // The ΔPDF was made with the flatten off, from the backfilled volume; a flattened one is newer.
    const off = { raw: 0, ringremoved: 10, braggpunched: 11, backfilled: 12, flattened: 20, delta_pdf: 14 };
    expect(staleOutputs(at(off, "backfilled")).has("delta_pdf")).toBe(false);
    // ...and a stale backfilled does make it stale.
    expect(staleOutputs(at({ ...off, braggpunched: 13, backfilled: 12, flattened: null }, "backfilled")).get("delta_pdf")).toBe("backfilled");
    // Made from the flattened volume, a stale flattened makes it stale even when it is newer than every output.
    const on = { raw: 0, ringremoved: 10, braggpunched: 11, backfilled: 15, flattened: 13, delta_pdf: 16 };
    expect(staleOutputs(at(on, "flattened")).get("delta_pdf")).toBe("flattened");
    // From the raw input (every cleanup stage off): none of the outputs is its input.
    expect(staleOutputs(at({ raw: 0, ringremoved: 30, delta_pdf: 14 }, "raw")).has("delta_pdf")).toBe(false);
  });

  it("reads a listing that does not say what the ΔPDF was made from as before", () => {
    const stale = staleOutputs(at({ raw: 0, ringremoved: 10, braggpunched: 20, backfilled: 21, flattened: 13, delta_pdf: 14 }));
    expect([...stale.entries()]).toEqual([["flattened", "backfilled"], ["delta_pdf", "backfilled"]]);
    expect(staleOutputs(at({ raw: 0, ringremoved: 10, braggpunched: 11, backfilled: 12, flattened: 13, delta_pdf: 14 }, null as unknown as string)).size).toBe(0);
  });
});
