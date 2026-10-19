// The Execution page's log lines: a line's colour from its status and marks,
// and a warning read as one even on a stage's done line (the stage's summary
// shows that line).

import { describe, expect, it } from "vitest";

import { logClass, warns } from "../executionLog";

const NOTICE =
  "4 rings detected but not confirmed at this grid (needs ≥ 1 voxel across 0.16 Å⁻¹); not subtracted. Use a finer grid, or set pooled_confirm_rings=False to subtract every detected ring.";
const RINGS_DONE = `pooled ring removal no_confirmed_rings: 0 shells confirmed as rings, 0 not (the crystal's own scattering, kept) (of 81/81 planes fitted), removed 0% of |I|. ⚠ ${NOTICE}`;

describe("the Execution page's log lines", () => {
  it("reads the ring removal's done line that ends on its notice as a warning, not a success (G1)", () => {
    expect(warns(RINGS_DONE)).toBe(true);
    expect(logClass({ type: "progress", stage: "rings", status: "done", message: RINGS_DONE })).toBe("warn");
    // Its done line without one reads as before.
    expect(warns("pooled ring removal fitted: 7 shells confirmed as rings")).toBe(false);
    expect(logClass({ type: "progress", stage: "rings", status: "done", message: "pooled ring removal fitted: 7 shells confirmed as rings" })).toBe("success");
  });

  it("colours every other line as before", () => {
    expect(logClass({ type: "progress", stage: "punch", status: "progress", message: "⚠ σ is √|I|" })).toBe("warn");
    expect(logClass({ type: "progress", stage: "punch", status: "error", message: "⚠ the punch failed" })).toBe("error");
    expect(logClass({ type: "progress", stage: "punch", status: "progress", message: "✗ no peaks" })).toBe("error");
    expect(logClass({ type: "progress", stage: "punch", status: "skip", message: "exists" })).toBe("success");
    expect(logClass({ type: "progress", stage: "rings", status: "start", message: "ring removal [pooled]" })).toBe("blue");
    expect(logClass({ type: "progress", stage: "rings", status: "progress", message: "■ stopped" })).toBe("warn");
    expect(logClass({ type: "cancelled" })).toBe("dim");
    expect(logClass({ type: "progress", stage: "rings", status: "progress", message: "sector profiles 30/81" })).toBe("info");
    expect(warns(undefined)).toBe(false);
  });
});
