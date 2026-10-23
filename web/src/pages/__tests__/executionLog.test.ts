// The Execution page's log lines: a line's colour from its status and marks,
// and a warning read as one even on a stage's done line (the stage's summary
// shows that line).

import { describe, expect, it } from "vitest";

import { logClass, runPhase, stageInfo, stageStates, warns, type Phase } from "../executionLog";

const NOTICE =
  "4 ring candidates (shells that may be powder rings or the crystal's own scattering) detected but not confirmed at this grid (needs ≥ 1 voxel across 0.16 Å⁻¹); not subtracted. Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract every candidate, the crystal's own shells included.";
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

describe("the run's phase and each stage's state", () => {
  const ev = (stage: string, status: string, message?: string) => ({ type: "progress", stage, status, message });
  const all = ["rings", "punch", "backfill", "flatten", "pdf", "pdf_check"];
  const states = (events: ReturnType<typeof ev>[], phase: Phase, runStages: string[] | null, outputs: string[] = []) =>
    stageStates({
      visible: all,
      info: stageInfo(events, events.map((_e, i) => 1000 * i)),
      phase,
      runStages,
      hasOutput: (s) => outputs.includes(s),
    });

  it("is running only while a run is in progress; a run that ended without saying how is not shown running", () => {
    expect(runPhase(true, null, 3)).toBe("running");
    expect(runPhase(false, "done", 3)).toBe("done");
    expect(runPhase(false, "cancelled", 3)).toBe("cancelled");
    expect(runPhase(false, null, 0)).toBe("idle");
    // The stream dropped and nothing settled it (or a run saved mid-way): never a spinner that never stops.
    expect(runPhase(false, null, 3)).toBe("error");
  });

  it("does not call the stages a finished run was not asked for queued, and counts only the run's own", () => {
    const events = ["rings", "punch", "backfill", "flatten"].map((s) => ev(s, "done"));
    const r = states(events, "done", ["rings", "punch", "backfill", "flatten"]);
    expect(r.inRun).toEqual(["rings", "punch", "backfill", "flatten"]);
    expect(r.doneCount).toBe(4);
    // Recomputed upstream while their old outputs remain: stale.
    const withOutputs = states(events, "done", ["rings", "punch", "backfill", "flatten"], ["pdf", "pdf_check"]);
    expect([withOutputs.states.pdf, withOutputs.states.pdf_check]).toEqual(["stale", "stale"]);
    expect(withOutputs.staleAfter.pdf).toBe("rings");
    // No output, or nothing before them recomputed (only reused): just not in this run.
    expect([r.states.pdf, r.states.pdf_check]).toEqual(["notrun", "notrun"]);
    const reused = states(["rings", "punch"].map((s) => ev(s, "skip")), "done", ["rings", "punch"], ["backfill"]);
    expect(reused.states.backfill).toBe("notrun");
  });

  it("marks the stage a run was stopped in as cancelled and one it failed in as failed, never active", () => {
    const events = [ev("rings", "done"), ev("punch", "progress")];
    expect(states(events, "cancelled", all).states.punch).toBe("cancelled");
    expect(states(events, "error", all).states.punch).toBe("failed");
    const running = states(events, "running", all);
    expect([running.states.punch, running.activeStage]).toEqual(["active", "punch"]);
    expect(running.states.backfill).toBe("pending");
    // A finished run whose stage never said "done" is not left spinning.
    expect(states(events, "done", all).states.punch).toBe("done");
  });

  it("counts every shown stage as the run's when it is not known what the run was asked for", () => {
    expect(states([ev("rings", "done")], "done", null).inRun).toEqual(all);
  });
});
