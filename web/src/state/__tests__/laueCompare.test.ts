// The Laue-class comparison's table (state/laueCompare.ts), on comparisons the
// backend made (nebula3d.analysis.laue_compare, on the known-answer volumes of
// tests/test_laue_compare.py): a 6/m crystal, strong m-3m Bragg peaks over a
// 4/mmm diffuse (the flag), and counting noise alone (no preference).

import { describe, expect, it } from "vitest";

import type { LaueComparison } from "../../api/types";
import { DEFAULT_EDGE_TRIM, edgeTrimLayers, formToParams, usePipelineStore } from "../pipelineStore";
import braggOverDiffuse from "./__fixtures__/laue-compare-bragg-over-diffuse.json";
import hex6m from "./__fixtures__/laue-compare-hex-6m.json";
import noise from "./__fixtures__/laue-compare-noise.json";
import { diffuseLine, formatRint, labelOf, laueRows, refusalText, specOf, verdictLine } from "../laueCompare";

const HEX = hex6m as unknown as LaueComparison;
const FLAG = braggOverDiffuse as unknown as LaueComparison;
const NOISE = noise as unknown as LaueComparison;

describe("the comparison's rows", () => {
  it("keeps the backend's order, indents by the chain of subgroups, and marks the suggestion", () => {
    const rows = laueRows(HEX, "");
    expect(rows.map((r) => r.laue)).toEqual(["-1", "2/m (c unique)", "-3", "-3m1", "-31m", "6/m", "6/mmm"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 2, 2, 3]);
    expect(rows.find((r) => r.laue === "6/mmm")?.contains).toEqual(["-3m1", "-31m", "6/m"]);
    expect(rows.filter((r) => r.suggested).map((r) => r.laue)).toEqual(["6/m"]);
    expect(rows.every((r) => !r.current)).toBe(true);
  });

  it("words what the rule made of each reading", () => {
    const rows = laueRows(HEX, "");
    const sixM = rows.find((r) => r.laue === "6/m")!;
    expect(sixM.all.state).toBe("ok");
    expect(sixM.all.detail).toMatch(/^(0\.9\d|1\.0\d)× noise$/);
    const sixMmm = rows.find((r) => r.laue === "6/mmm")!;
    expect(sixMmm.all.state).toBe("rose");
    expect(sixMmm.all.detail).toMatch(/^rose 2\.\d\d× vs (-1|2\/m \(c unique\)|-3)$/);
    expect(sixMmm.all.title).toMatch(/orbits, .* voxels, .* pairs compared/);
    expect(sixMmm.orbits).toMatch(/^\d[\d,]*$/);
  });

  it("marks the class the form holds, by preset name or by its generators", () => {
    expect(laueRows(HEX, "6/m").filter((r) => r.current).map((r) => r.laue)).toEqual(["6/m"]);
    // The same group written as generators is the same class.
    expect(laueRows(HEX, "h+k,-h,l; -h,-k,-l").filter((r) => r.current).map((r) => r.laue)).toEqual(["6/m"]);
    expect(labelOf("not a class")).toBeNull();
    expect(specOf({ laue: "6/m", generators: "h+k,-h,l; -h,-k,-l" })).toBe("6/m");
    expect(specOf({ laue: "custom", generators: "h+k,-h,l" })).toBe("h+k,-h,l");
  });

  it("flags the diffuse cells of the classes only the full reading supports", () => {
    const rows = laueRows(FLAG, "");
    const m3m = rows.find((r) => r.laue === "m-3m")!;
    expect(FLAG.suggested_by).toEqual({ all: "m-3m", diffuse: "4/mmm" });
    expect(m3m.all.state).toBe("ok");
    expect(m3m.diffuse.state).toBe("flag");
    expect(rows.find((r) => r.laue === "4/mmm")!.diffuse.state).toBe("ok");
    expect(rows.find((r) => r.suggested)?.laue).toBe("4/mmm");
  });

  it("says why there is no suggestion when the noise cannot tell", () => {
    expect(NOISE.suggestion).toBeNull();
    expect(verdictLine(NOISE)).toMatch(/^No meaningful preference/);
    expect(laueRows(NOISE, "").some((r) => r.suggested)).toBe(false);
    expect(verdictLine(HEX)).toMatch(/^Suggested: 6\/m\. 6\/m is the class with the most operations/);
  });

  it("words the refused classes, the diffuse reading's mask and R_int", () => {
    const metric = HEX.refused.find((r) => r.laue === "mmm")!;
    expect(refusalText(metric)).toMatch(/^metric changes by up to \d+%: not symmetries of this lattice$/);
    expect(refusalText({ laue: "4/m", order: 8, reason: "grid", detail: "x", metric_change: null })).toBe("its operations do not map this grid onto itself");
    expect(diffuseLine(HEX)).toMatch(/^Diffuse: the Bragg nodes of the 1×1×1 cell masked within 0\.25 Å⁻¹, \d+\.\d% of the measured voxels\. Edge trim 1\.$/);
    expect(formatRint(0.0654)).toBe("0.065");
    expect(formatRint(0.00123)).toBe("0.0012");
    expect(formatRint(null)).toBe("–");
  });
});

describe("the raw edge trim on the form", () => {
  it("is 1 layer by default and sent only when it is not", () => {
    const base = usePipelineStore.getState();
    expect(base.edgeTrim).toBe("");
    expect(edgeTrimLayers(base)).toBe(DEFAULT_EDGE_TRIM);
    expect(formToParams(base).edge_trim).toBeUndefined();
    expect(formToParams({ ...base, edgeTrim: "0" }).edge_trim).toBe(0);
    expect(formToParams({ ...base, edgeTrim: "3" }).edge_trim).toBe(3);
    expect(formToParams({ ...base, edgeTrim: "1" }).edge_trim).toBeUndefined();
    // Anything the page does not offer is the default.
    expect(edgeTrimLayers({ edgeTrim: "7" })).toBe(1);
    expect(edgeTrimLayers({ edgeTrim: "x" })).toBe(1);
  });
});
