// No mark without its evidence (THY-44, THY-18): what a marked region may rest
// on — a measuring tool's call that ran in this conversation, holds the field
// it names, and was not made stale by a run that recomputed the marked stage —
// and the refusal, saying which call to make, of anything else.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { checkEvidence, evidenceRefs, MAX_EVIDENCE } from "../markEvidence";

let n = 0;
const step = (name: string, result: unknown, extra: Partial<AgentStep> = {}): AgentStep => ({
  id: `${n++}:c`,
  name,
  args: {},
  status: "done",
  result: typeof result === "string" ? result : JSON.stringify(result),
  ...extra,
});
const PEAKS = step("dpdf_peaks", { features: [{ sign: "+", vectors_A: [[2.5, 0, 0]] }] });
const CUT = step("measure_reciprocal_cut", { cut: "H–K plane at L = 0.5", flatten: { after_floor_max_sigma: 1.2 } });
const run = (stages: Record<string, string>) => step("run_pipeline", { stages });

describe("evidenceRefs: the calls an argument cites", () => {
  it("reads a list, or one string of them, without braces, each once", () => {
    expect(evidenceRefs(["dpdf_peaks", " {{dpdf_peaks.features.0}} ", "dpdf_peaks", 3, ""])).toEqual(["dpdf_peaks", "dpdf_peaks.features.0"]);
    expect(evidenceRefs("line_profile, dpdf_peaks; radial_profile")).toEqual(["line_profile", "dpdf_peaks", "radial_profile"]);
    expect(evidenceRefs(undefined)).toEqual([]);
    expect(evidenceRefs({ tool: "x" })).toEqual([]);
  });
});

describe("checkEvidence", () => {
  it("refuses a mark that cites nothing", () => {
    const r = checkEvidence([], "pdf", [PEAKS]);
    expect(r).toEqual({ ok: false, reason: "a mark needs its evidence: name the tool calls whose results show the region, by the tool's name or as tool.field (dpdf_peaks.features.0)" });
  });

  it("takes a measuring tool's call from this reply, with its step's number", () => {
    expect(checkEvidence(["measure_reciprocal_cut", "dpdf_peaks.features.0.vectors_A"], "pdf", [CUT, PEAKS])).toEqual({
      ok: true,
      steps: [
        { ref: "measure_reciprocal_cut", tool: "measure_reciprocal_cut", step: 1 },
        { ref: "dpdf_peaks.features.0.vectors_A", tool: "dpdf_peaks", step: 2 },
      ],
    });
  });

  it("takes an earlier turn's call, as the answers' numbers may come from one", () => {
    expect(checkEvidence(["dpdf_peaks"], "pdf", [CUT], [PEAKS])).toEqual({ ok: true, steps: [{ ref: "dpdf_peaks", tool: "dpdf_peaks", step: null }] });
  });

  it("refuses a tool that has not run, one that failed, and one brought back from a session file", () => {
    const failed = step("dpdf_peaks", "Error: this dataset has no 3D-ΔPDF yet", { status: "error" });
    const restored = { ...PEAKS, restored: true as const };
    for (const steps of [[CUT], [failed], [restored]]) {
      const r = checkEvidence(["dpdf_peaks"], "pdf", steps);
      expect(r).toEqual({ ok: false, reason: "dpdf_peaks: dpdf_peaks has not run in this conversation; call it, and mark what its result shows" });
    }
  });

  it("refuses a name that is no tool, and a tool that measures nothing in the data", () => {
    const r = checkEvidence(["my_eyes"], "pdf", [PEAKS]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^my_eyes: no tool is named my_eyes; name the tool calls/);
    for (const tool of ["describe_dataset", "current_view", "configure_settings", "run_log", "run_verdict", "read_skill", "show_in_viewer", "run_pipeline"]) {
      const s = checkEvidence([tool], "raw", [step(tool, { ok: true })]);
      expect(s.ok, tool).toBe(false);
      if (!s.ok) expect(s.reason).toBe(`${tool}: ${tool} measures nothing in the data, so no mark rests on it; cite the measurement that shows the region`);
    }
  });

  it("refuses a field the tool's results do not have", () => {
    const r = checkEvidence(["dpdf_peaks.features.3"], "pdf", [PEAKS]);
    expect(r).toEqual({ ok: false, reason: "dpdf_peaks.features.3: no dpdf_peaks result in this conversation has features.3" });
  });

  it("refuses a measurement a later run made stale on the marked stage, and keeps one the run reused", () => {
    const stale = checkEvidence(["measure_reciprocal_cut"], "flatten", [CUT, run({ flatten: "computed", pdf: "computed" })]);
    expect(stale).toEqual({
      ok: false,
      reason: "measure_reciprocal_cut was measured before the last run recomputed the flatten stage: measure it again, then mark what the new result shows",
    });
    expect(checkEvidence(["measure_reciprocal_cut"], "flatten", [CUT, run({ flatten: "reused", pdf: "computed" })]).ok).toBe(true);
    // The raw volume is no stage's: no run makes a measurement of it stale.
    expect(checkEvidence(["measure_reciprocal_cut"], "raw", [CUT, run({ flatten: "computed" })]).ok).toBe(true);
    // Measured again after the run: it stands, as the newest call.
    const again = checkEvidence(["measure_reciprocal_cut"], "flatten", [CUT, run({ flatten: "computed" }), CUT]);
    expect(again).toEqual({ ok: true, steps: [{ ref: "measure_reciprocal_cut", tool: "measure_reciprocal_cut", step: 3 }] });
  });

  it("counts a run in this reply against an earlier turn's measurement", () => {
    const r = checkEvidence(["dpdf_peaks"], "pdf", [run({ pdf: "computed" })], [PEAKS]);
    expect(r.ok).toBe(false);
  });

  it("cites at most a handful of calls", () => {
    const refs = Array.from({ length: MAX_EVIDENCE + 1 }, (_, i) => `dpdf_peaks.features.${i}`);
    expect(checkEvidence(refs, "pdf", [PEAKS])).toEqual({ ok: false, reason: `cite at most ${MAX_EVIDENCE} calls; got ${MAX_EVIDENCE + 1}` });
  });
});
