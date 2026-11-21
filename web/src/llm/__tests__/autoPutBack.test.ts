// A fix put back without a second run (auto/controller.ts, putBack). Before a
// fix's run the backend sets aside the outputs it will overwrite; a fix that
// made its check worse gets them back in place of running the pipeline again,
// once the backend says a run would compute nothing and the stage's checks
// read exactly as before the fix. Anything less (refused, checks that differ,
// nothing set aside) and the pipeline runs as it did before; a fix kept, a
// stop, a failure and a new run delete what was set aside.
// The backend here is a stand-in (as autoHarness.ts stubs the runs): what is
// "set aside" is the settings the outputs were last run with, which the
// stand-in evaluations follow. Synthetic only: no model, backend or API.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { configOf } from "../../state/configMemory";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { useDecisionStore } from "../apply/decisions";
import { sinceLine } from "../apply/since";
import { autoLoop, endAuto, resumeAuto, startAuto, stopAuto } from "../auto/controller";
import { sameChecks } from "../auto/plan";
import { useAutoStore, type AutoRun } from "../auto/store";
import { isAppStep } from "../auto/transcript";
import { activityNow } from "../auto/activity";
import { clock, CTX, fixWith, freshAuto, holdRuns, model, outputs, phaseOf, pipeline, say, SCRIPTED, scriptedStream } from "./autoHarness";
import { braggSenseKeeping, installBackend } from "./syntheticCrystal";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchProtectedLabels: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingSurvey: vi.fn(),
  fetchBraggSense: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  compareLaueClasses: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
  setAsideOutputs: vi.fn(),
  restoreSetAside: vi.fn(),
  discardSetAside: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const stream = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: stream.fn,
}));

// The evaluations follow the settings the outputs were last run with (autoHarness.ts, outputs).
vi.mock("../tune/evaluate", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tune/evaluate")>();
  const { outputs: o } = await import("./autoOutputs");
  return {
    ...original,
    evaluateStage: async (...args: Parameters<typeof original.evaluateStage>) => o.tweak(args[0], await original.evaluateStage(...args), o.ranWith),
  };
});

// ---------------------------------------------------------------- the backend's stand-in

/** What the stand-in backend holds set aside (the settings the outputs were run with), and what it was asked. */
const backend = {
  held: null as null | { dataset: string; from: string; ranWith: typeof outputs.ranWith },
  calls: [] as string[],
  refuse: null as null | "set-aside" | "restore", // what it refuses
  restoreWrong: false, // it answers "restored" with the fix's outputs still in place
  onRestore: null as null | (() => void),
};

function installSetAside(): void {
  backend.held = null;
  backend.calls = [];
  backend.refuse = null;
  backend.restoreWrong = false;
  backend.onRestore = null;
  api.setAsideOutputs.mockImplementation(async (dataset: string, from: string) => {
    backend.calls.push(`set-aside ${from}`);
    backend.held = null; // one per dataset: a second replaces the first
    if (backend.refuse === "set-aside") return { set_aside: false, reason: "the disk has 1.0 GB free", files: [], bytes: 0 };
    backend.held = { dataset, from, ranWith: { ...outputs.ranWith } };
    return { set_aside: true, reason: null, files: ["x_braggpunched.h5"], bytes: 1 };
  });
  api.restoreSetAside.mockImplementation(async () => {
    backend.calls.push("restore");
    const held = backend.held;
    backend.held = null; // gone afterwards, whatever the answer
    backend.onRestore?.();
    if (!held || backend.refuse === "restore") return { restored: false, reason: "nothing was set aside", files: [] };
    if (backend.restoreWrong) return { restored: true, reason: null, files: [] };
    // Restored only when a run with the settings now in place would compute nothing: they are the ones set aside.
    const now = configOf(usePipelineStore.getState());
    if (JSON.stringify(now) !== JSON.stringify(held.ranWith)) return { restored: false, reason: "a run would still compute punch", files: [] };
    outputs.ranWith = held.ranWith;
    return { restored: true, reason: null, files: ["x_braggpunched.h5"] };
  });
  api.discardSetAside.mockImplementation(async () => {
    backend.calls.push("discard");
    const had = !!backend.held;
    backend.held = null;
    return { discarded: had };
  });
}

const run = (): AutoRun => useAutoStore.getState().run!;
const decisions = () => useDecisionStore.getState().decisions.filter((d) => run().decisions.includes(d.id));
const cleanRings = (e: Record<string, unknown>) => ({ ...e, max_ring_left: 0, max_ring_dent: 0 });
const cleanPunch = (e: Record<string, unknown>) => ({ ...e, leftover_at_nodes: 0 });
const runsWith = () => pipeline.runs.map((r) => r.with.punchMinSig);
const runCards = () => useDecisionStore.getState().proposals.filter((p) => p.kind === "run");
const punchChecks = () => run().steps.filter((s) => isAppStep(s) && s.name === "assess_stage" && s.args?.stage === "punch");

async function start(limits = {}): Promise<void> {
  await startAuto({ ctx: CTX, settings: SCRIPTED, limits, now: clock.now });
  await (autoLoop() ?? Promise.resolve());
}

/** The punch needs attention; its first fix (punchMinSig 4) misses more nodes, so it is worse; no second change. */
function worseFix(): void {
  outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "4" ? { ...e, leftover_at_nodes: 3 } : e);
  let fixes = 0;
  model.respond = (phase, round) => {
    if (phase.kind !== "fix") return say("The punch needs attention.");
    if (round === 0) fixes += 1;
    return fixWith("bragg-node-audit", fixes === 1 ? { punchMinSig: 4 } : null)(round);
  };
}

beforeEach(() => {
  installBackend(api);
  installSetAside();
  api.fetchBraggSense.mockImplementation(async (id: string) => braggSenseKeeping(id));
  freshAuto();
  stream.fn.mockImplementation(scriptedStream);
  usePipelineStore.getState().patch({ symmetryLaue: "4/mmm", pdfQMin: "0.25", pdfQMax: "4.4" });
});

// ---------------------------------------------------------------- put back by restoring

describe("a fix that made its check worse, its outputs set aside", () => {
  it("is put back by restoring them: no second run, the checks as before the fix, no run owed", async () => {
    worseFix();
    await start();
    expect(run().state).toBe("done");
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    // The first run and the fix's run: the outputs of before the fix were not made again.
    expect(runsWith()).toEqual(["", "4"]);
    expect(outputs.ranWith.punchMinSig).toBe("");
    // Set aside from the fix's stage before its run, restored after the undo, nothing left; the second fix changed nothing and set nothing aside.
    expect(backend.calls).toEqual(["discard", "set-aside punch", "restore"]);
    expect(backend.held).toBeNull();
    expect(run().pendingRun).toBeNull();
    // The punch's checks: before the fix, after it, and after the restore, which reads as the first did.
    const [before, after, back] = punchChecks();
    expect(punchChecks()).toHaveLength(3);
    expect(back.result).toBe(before.result);
    expect(after.result).not.toBe(before.result);
    const row = run().plan.find((r) => r.id === "punch")!;
    expect(row).toMatchObject({ status: "attention", tries: 2, outcome: "attention" });
    expect(row.evidence!.map((e) => e.text)).toEqual(row.before!.map((e) => e.text));
    expect(row.detail).toBe("still needs attention after two fixes (one adopted no change) (one put back: it made it worse)");
  });

  it("logs the undo as auto mode's and no run after it: the digest and the activity log have no run for the put-back", async () => {
    worseFix();
    await start();
    expect(decisions().map((d) => [d.kind, d.action, d.by])).toEqual([
      ["run", "apply", "auto"],
      ["setting", "apply", "auto"],
      ["run", "apply", "auto"],
      ["setting", "undo", "auto"],
    ]);
    expect(sinceLine(decisions(), useDecisionStore.getState().proposals, "in this auto run")).toBe(
      "- in this auto run, auto mode ran the pipeline from the start; applied punchMinSig 5 → 4; ran the pipeline from punch; undid punchMinSig 4 → 5",
    );
    // What the next reply read of it (the second fix's context): the same line, no word added.
    const texts = model.sent.filter((r) => phaseOf(r.messages).kind === "fix").map((r) => r.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n"));
    const second = texts.find((t) => t.includes("undid punchMinSig"))!;
    expect(second).toMatch(/ran the pipeline from punch; undid punchMinSig 4 → 5\n/);
    expect(second).not.toMatch(/undid punchMinSig 4 → 5; ran the pipeline/);
    const rows = activityNow()!.rows;
    expect(rows.filter((r) => r.title === "Ran the pipeline")).toHaveLength(2);
    expect(rows.find((r) => r.title === "Fix the Bragg punch, first of two")!.line).toMatch(/^Changed Punch min σ .* → 4 \(it made the check worse: put back\)$/);
  });

  it("leaves no Run card open: the one the undo offered has no run left to make", async () => {
    worseFix();
    await start();
    expect(runCards().filter((p) => p.status === "open")).toEqual([]);
    const offered = runCards().find((p) => /^undid Punch min σ/.test(p.shown.to))!;
    expect(offered.status).toBe("dismissed");
    // No decision stands on it: it was neither run nor declined by anyone.
    expect(useDecisionStore.getState().decisions.filter((d) => d.proposal === offered.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------- falling back to a run

describe("a put-back that cannot be trusted falls back to a run, as before", () => {
  const asBefore = () => {
    expect(run().state).toBe("done");
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    expect(runsWith()).toEqual(["", "4", ""]);
    expect(outputs.ranWith.punchMinSig).toBe("");
    expect(backend.held).toBeNull();
    expect(run().pendingRun).toBeNull();
    expect(decisions().map((d) => [d.kind, d.action])).toEqual([
      ["run", "apply"],
      ["setting", "apply"],
      ["run", "apply"],
      ["setting", "undo"],
      ["run", "apply"],
    ]);
    // The run the undo offered was made by auto mode.
    expect(runCards().filter((p) => p.status === "open")).toEqual([]);
    expect(run().plan.find((r) => r.id === "punch")).toMatchObject({ status: "attention", tries: 2 });
  };

  it("nothing set aside (space short): the pipeline runs again, and no restore is asked", async () => {
    worseFix();
    backend.refuse = "set-aside";
    await start();
    asBefore();
    expect(backend.calls.filter((c) => c === "restore")).toEqual([]);
    expect(punchChecks()).toHaveLength(3);
  });

  it("the restore refused: the pipeline runs again", async () => {
    worseFix();
    backend.refuse = "restore";
    await start();
    asBefore();
    expect(backend.calls).toContain("restore");
    expect(punchChecks()).toHaveLength(3);
  });

  it("the restore failed (the request threw): the pipeline runs again", async () => {
    worseFix();
    api.restoreSetAside.mockImplementation(async () => {
      backend.held = null;
      throw new Error("500 Internal Server Error");
    });
    await start();
    asBefore();
  });

  it("the checks after the restore differ from those before the fix: the pipeline runs again", async () => {
    worseFix();
    backend.restoreWrong = true; // "restored", but the outputs are still the fix's
    await start();
    asBefore();
    // Checked after the restore (not as before the fix), then after the run.
    expect(punchChecks()).toHaveLength(4);
  });

  it("a backend without the calls (an older server): the pipeline runs again", async () => {
    worseFix();
    for (const f of [api.setAsideOutputs, api.restoreSetAside, api.discardSetAside]) f.mockRejectedValue(new Error("404 Not Found"));
    await start();
    asBefore();
  });
});

// ---------------------------------------------------------------- kept, stopped, failed, ended

describe("what was set aside is deleted on every other way out", () => {
  it("a fix kept: discarded, never restored", async () => {
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done."));
    await start();
    expect(run().plan.find((r) => r.id === "punch")!.status).toBe("fixed");
    expect(runsWith()).toEqual(["", "6"]);
    expect(backend.calls).toEqual(["discard", "set-aside punch", "discard"]);
    expect(backend.held).toBeNull();
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
  });

  it("a fix that changed nothing sets nothing aside", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", null)(round) : say("Done."));
    await start();
    expect(backend.calls).toEqual(["discard"]); // the start's
  });

  it("Stop in the fix's run: discarded, the run owed, and Resume runs it", async () => {
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    model.respond = (phase, round) => {
      if (phase.kind === "fix" && round === 2) holdRuns();
      return phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done.");
    };
    const started = startAuto({ ctx: CTX, settings: SCRIPTED, now: clock.now });
    await vi.waitFor(() => expect(usePipelineStore.getState().running && pipeline.hold).toBeTruthy());
    expect(backend.held).toMatchObject({ from: "punch" });
    stopAuto();
    await started;
    expect(run().state).toBe("stopped");
    expect(run().pendingRun).toBe("punch");
    expect(backend.held).toBeNull();
    expect(backend.calls.slice(-2)).toEqual(["set-aside punch", "discard"]);
    pipeline.hold = null;
    await resumeAuto();
    expect(run().state).toBe("done");
    expect(run().pendingRun).toBeNull();
    expect(backend.held).toBeNull();
  });

  it("Stop while the outputs are being put back: the run stays owed, and Resume makes it", async () => {
    worseFix();
    backend.onRestore = () => {
      backend.onRestore = null;
      stopAuto();
    };
    await start();
    expect(run().state).toBe("stopped");
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    expect(run().pendingRun).toBe("punch");
    expect(backend.held).toBeNull();
    expect(runsWith()).toEqual(["", "4"]);
    await resumeAuto();
    await (autoLoop() ?? Promise.resolve());
    expect(run().state).toBe("done");
    expect(run().pendingRun).toBeNull();
    // The run owed was made, from the punch, with the settings put back.
    expect(runsWith()).toEqual(["", "4", ""]);
    expect(decisions()[decisions().length - 1]).toMatchObject({ kind: "run", by: "auto", runFrom: "punch" });
  });

  it("Stop for good in the fix's run: discarded, and the report says the run was owed", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    model.respond = (phase, round) => {
      if (phase.kind === "fix" && round === 2) holdRuns();
      return phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done.");
    };
    void startAuto({ ctx: CTX, settings: SCRIPTED, now: clock.now });
    await vi.waitFor(() => expect(usePipelineStore.getState().running && pipeline.hold).toBeTruthy());
    await endAuto();
    await vi.waitFor(() => expect(backend.calls[backend.calls.length - 1]).toBe("discard"));
    expect(run()).toMatchObject({ state: "done", appReport: "stopped", pendingRun: "punch" });
    expect(run().ended).toContain("A change's run had not finished (punch on)");
    expect(backend.held).toBeNull();
  });

  it("the fix's run failed: discarded, the run paused; Retry runs it", async () => {
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    model.respond = (phase, round) => {
      if (phase.kind === "fix" && round === 2) pipeline.fail = true;
      return phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done.");
    };
    await start();
    expect(run()).toMatchObject({ state: "paused", pause: { kind: "failure", what: "run" }, pendingRun: "punch" });
    expect(backend.held).toBeNull();
    expect(backend.calls.slice(-2)).toEqual(["set-aside punch", "discard"]);
    await resumeAuto();
    expect(run().state).toBe("done");
    expect(backend.held).toBeNull();
  });

  it("the run after the put-back's restore was refused fails: paused with the run owed, nothing set aside", async () => {
    worseFix();
    backend.refuse = "restore";
    backend.onRestore = () => {
      pipeline.fail = true;
    };
    await start();
    expect(run()).toMatchObject({ state: "paused", pause: { kind: "failure", what: "run" }, pendingRun: "punch" });
    expect(backend.held).toBeNull();
    await resumeAuto();
    expect(run().state).toBe("done");
    expect(outputs.ranWith.punchMinSig).toBe("");
  });

  it("a limit that ends the fixes leaves nothing set aside", async () => {
    worseFix();
    await start({ replies: 2 }); // one fix, and one reply kept for the report
    expect(run().limit).toBe("replies");
    expect(runsWith()).toEqual(["", "4"]);
    expect(backend.held).toBeNull();
    expect(run().pendingRun).toBeNull();
  });

  it("a new run deletes what an earlier one (or an earlier page) left", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : stage === "punch" ? cleanPunch(e) : e);
    backend.held = { dataset: CTX.dataset.id, from: "rings", ranWith: {} };
    await start();
    expect(backend.calls).toEqual(["discard"]);
    expect(backend.held).toBeNull();
    expect(api.discardSetAside).toHaveBeenCalledWith(CTX.dataset.id);
  });
});

// ---------------------------------------------------------------- the checks compared

describe("sameChecks: the stage's checks read exactly as before", () => {
  const check = (leftover: number, extra: Partial<AgentStep> = {}): AgentStep => ({
    id: `s${leftover}`,
    name: "assess_stage",
    args: { stage: "punch" },
    status: "done",
    result: JSON.stringify({ punch: { leftover_at_nodes: leftover, verdict: leftover ? "needs attention: missed at nodes" : "pass" } }),
    ...extra,
  });

  it("is true for the same checks with the same results, whatever their ids", () => {
    expect(sameChecks("punch", [check(2)], [{ ...check(2), id: "later" }])).toBe(true);
  });

  it("is false when a number differs, a check failed, one is missing, or there are none", () => {
    expect(sameChecks("punch", [check(2)], [check(3)])).toBe(false);
    expect(sameChecks("punch", [check(2)], [check(2, { status: "error" })])).toBe(false);
    expect(sameChecks("punch", [check(2)], [])).toBe(false);
    expect(sameChecks("punch", [], [])).toBe(false);
    expect(sameChecks("punch", [check(2)], [check(2, { args: { stage: "rings" } })])).toBe(false);
  });

  it("takes no account of the ring verdict's mark of its output, which counts the console's runs", () => {
    const rings = (runs: number, left: number): AgentStep => ({
      id: `r${runs}`,
      name: "assess_stage",
      args: { stage: "rings" },
      status: "done",
      result: JSON.stringify({ rings: { max_ring_left: left, max_ring_dent: 0 } }),
      outcomes: [{ check: "rings", kind: "attention", reasons: ["ring left"], dataProblems: [], words: "needs attention", ringOutput: { dataset: "d", written: 10, runs } }],
    });
    expect(sameChecks("rings", [rings(1, 0.3)], [rings(2, 0.3)])).toBe(true);
    expect(sameChecks("rings", [rings(1, 0.3)], [rings(2, 0.4)])).toBe(false);
  });

  it("compares the whole result where the model read it fitted", () => {
    const whole = (n: number) => check(2, { full: JSON.stringify({ punch: { leftover_at_nodes: 2, leftover_bragg_tails: n } }) });
    expect(sameChecks("punch", [whole(1)], [whole(1)])).toBe(true);
    expect(sameChecks("punch", [whole(1)], [whole(2)])).toBe(false);
  });
});
