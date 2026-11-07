// Auto mode's controller (auto/controller.ts) through whole runs on the
// synthetic crystal, its model scripted and its runs stubbed (autoHarness.ts):
// a clean run, a run with a fixable stage, a run that pauses for a sample
// fact (Apply and Skip), a run that hits each limit, a fix that made its
// check worse and is put back, Stop and Resume, and a failure. The
// controller moves on by the checks' computed verdicts, never changes a
// setting itself, and logs every change as auto mode's.
// Synthetic only: no model is loaded, no backend or API is called.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePipelineStore } from "../../state/pipelineStore";
import { useDecisionStore } from "../apply/decisions";
import { sinceLine } from "../apply/since";
import { applyFact, autoLoop, endAuto, resumeAuto, skipFact, startAuto, stopAuto, undoAutoRun } from "../auto/controller";
import { useAutoStore, type AutoRun } from "../auto/store";
import { useChatStore } from "../chatStore";
import { CLAUDE_URL } from "./scriptedTransports";
import { clock, CTX, fixWith, freshAuto, holdRuns, model, outputs, pipeline, say, SCRIPTED, scriptedStream, TRUSTED, SCRIPTED_CLICK } from "./autoHarness";
import { installBackend } from "./syntheticCrystal";

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
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  compareLaueClasses: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
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

const run = (): AutoRun => useAutoStore.getState().run!;
const last = <T>(xs: readonly T[]): T => xs[xs.length - 1];
const status = () => Object.fromEntries(run().plan.map((r) => [r.id, r.status]));
const decisions = () => useDecisionStore.getState().decisions.filter((d) => run().decisions.includes(d.id));

// The crystal leaves a ring and a missed node: clean, both pass.
const cleanRings = (e: Record<string, unknown>) => ({ ...e, max_ring_left: 0, max_ring_dent: 0 });
const cleanPunch = (e: Record<string, unknown>) => ({ ...e, leftover_at_nodes: 0 });

async function start(limits = {}, settings = SCRIPTED): Promise<void> {
  await startAuto({ ctx: CTX, settings, limits, now: clock.now });
  await (autoLoop() ?? Promise.resolve());
}

/** Every update_settings and run the app made itself: none, ever. */
const appChanges = () => run().steps.filter((s) => s.id.startsWith("auto:") && (s.name === "update_settings" || s.name === "tune_pipeline"));

beforeEach(() => {
  installBackend(api);
  freshAuto();
  stream.fn.mockImplementation(scriptedStream);
  // The class the crystal's comparison suggests and the |Q| band its coverage
  // suggests are the ones set: no card for either.
  usePipelineStore.getState().patch({ symmetryLaue: "4/mmm", pdfQMin: "0.25", pdfQMax: "4.4" });
});

describe("a clean run", () => {
  it("goes through the plan by the computed verdicts, asks the model only for the report, and logs its run as auto mode's", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : stage === "punch" ? cleanPunch(e) : e);
    model.respond = (phase) => (phase.kind === "report" ? say("Every stage meets its goal by its checks above.") : say("?"));
    await start();
    expect(run().state).toBe("done");
    expect(status()).toEqual({ preflight: "done", run: "done", rings: "passed", punch: "passed", backfill: "passed", flatten: "passed", pdf: "passed", report: "done" });
    // One model reply: the report's, with no chat history and its checks seeded as a round of calls.
    expect(run().replies).toBe(1);
    expect(model.sent).toHaveLength(1);
    const req = model.sent[0].messages;
    expect(req.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant", ...req.slice(5).map(() => "tool")]);
    expect(req[4].tool_calls!.map((c) => c.function.name)).toEqual(["assess_stage", "texture_check", "qmax_coverage", "symmetry_check", "grain_check", "ub_check"]);
    expect(req[1].content).toContain("- auto run so far: preflight done; the run done; the ring removal passed; the Bragg punch passed");
    // The report's turn, in the transcript, after its label.
    const turns = useChatStore.getState().turns;
    expect(turns.map((t) => [t.role, t.content])).toEqual([
      ["user", "Auto · the report"],
      ["assistant", "Every stage meets its goal by its checks above."],
    ]);
    expect(run().reportTurn).toBe(turns[1].id);
    // The app ran the pipeline once, and changed nothing.
    expect(pipeline.runs).toHaveLength(1);
    expect(appChanges()).toEqual([]);
    expect(decisions().map((d) => [d.kind, d.by, d.action])).toEqual([["run", "auto", "apply"]]);
    // The next reply's "since the last reply" line says who ran it.
    expect(sinceLine(decisions(), useDecisionStore.getState().proposals)).toBe("- since the last reply, auto mode ran the pipeline from the start");
    expect(run().clock.endedAt).not.toBeNull();
  });
});

describe("a run with a fixable stage", () => {
  it("asks the model to fix the punch with its check seeded, runs from the change itself, checks again, and the stage is fixed", async () => {
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("The punch passed after a fix."));
    await start();
    expect(run().state).toBe("done");
    expect(status()).toMatchObject({ rings: "passed", punch: "fixed", backfill: "passed", report: "done" });
    expect(run().plan.find((r) => r.id === "punch")).toMatchObject({ tries: 1, detail: "passed after its first fix" });
    // The fix's request: the punch's check as the reply's first step, the user's words none.
    const fix = model.sent.find((r) => r.messages[3].content === "Change or tune the Bragg punch so its check above passes: one update_settings change, or tune_pipeline for this stage. Say what you changed and why, or why no change would help.")!;
    expect(fix.messages[4].tool_calls!.map((c) => [c.id, c.function.name, c.function.arguments])).toEqual([["seed_1", "assess_stage", '{"stage":"punch"}']]);
    expect(fix.messages[1].content).toContain("the Bragg punch needs attention: this is its first fix of two");
    // No run_pipeline is offered to a fix: the app runs from the change.
    expect(fix.tools?.map((t) => t.function.name)).not.toContain("run_pipeline");
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
    // The runs: everything missing or stale, then from the punch.
    expect(pipeline.runs.map((r) => r.with.punchMinSig)).toEqual(["", "6"]);
    expect(decisions().map((d) => [d.kind, d.by, d.title, d.shown.to])).toEqual([
      ["run", "auto", "Run of what is missing or stale", expect.any(String)],
      ["setting", "auto", "Punch min σ", "6"],
      ["run", "auto", "Run from Bragg punch", expect.any(String)],
    ]);
    // The report's digest carries the change, as auto mode's.
    const report = model.sent.find((r) => String(r.messages[3].content).startsWith("Report on this auto run"))!;
    expect(report.messages[1].content).toContain("the Bragg punch passed after its first fix");
    expect(report.messages[1].content).toMatch(/- in this auto run, auto mode ran the pipeline from the start; applied punchMinSig .* → 6; ran the pipeline from punch/);
    expect(appChanges()).toEqual([]);
  });

  it("stops a stage's fixes after two, and moves on with it needing attention", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", round === 1 ? { punchMinSig: 5 + model.sent.length % 3 } : null)(round) : say("The punch still needs attention."));
    await start();
    expect(status()).toMatchObject({ punch: "attention", backfill: "passed", report: "done" });
    expect(run().plan.find((r) => r.id === "punch")).toMatchObject({ tries: 2, detail: "still needs attention after two fixes" });
    expect(run().replies).toBe(3); // two fixes and the report
  });
});

describe("a fix that made its check worse", () => {
  it("is put back exactly, logged as auto mode's undo, and the outputs are made again from before it", async () => {
    // A lower significance punches more: worse, more nodes missed (by this stand-in).
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "4" ? { ...e, leftover_at_nodes: 3 } : e);
    let fixes = 0;
    model.respond = (phase, round) => {
      if (phase.kind !== "fix") return say("The punch needs attention.");
      if (round === 0) fixes += 1;
      return fixWith("bragg-node-audit", fixes === 1 ? { punchMinSig: 4 } : null)(round);
    };
    await start();
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    const ds = decisions();
    const change = ds.find((d) => d.kind === "setting" && d.action === "apply")!;
    const undo = ds.find((d) => d.action === "undo")!;
    expect([change.by, change.after, change.undoneBy]).toEqual(["auto", { punchMinSig: "4" }, undo.id]);
    expect([undo.by, undo.undoes, undo.after]).toEqual(["auto", change.id, { punchMinSig: "" }]);
    // The run with the fix, and the run from before it again.
    expect(pipeline.runs.map((r) => r.with.punchMinSig)).toEqual(["", "4", ""]);
    expect(run().plan.find((r) => r.id === "punch")).toMatchObject({ status: "attention", tries: 2 });
    expect(sinceLine(ds, useDecisionStore.getState().proposals)).toContain("auto mode ran the pipeline from the start; applied punchMinSig");
    expect(sinceLine(ds, useDecisionStore.getState().proposals)).toContain("undid punchMinSig");
  });
});

/** The raw volume as one that declares no symmetry: the preflight compares the Laue classes on it. */
function unsymmetrisedRaw(): void {
  const meta = api.fetchMeta.getMockImplementation()!;
  api.fetchMeta.mockImplementation(async (id: string) => ({ ...(await meta(id)), ...(id.endsWith(".raw") ? { symmetry: null, symmetry_ops: null } : {}) }));
}

describe("a run that pauses for a sample fact", () => {
  beforeEach(() => {
    unsymmetrisedRaw();
    usePipelineStore.getState().patch({ symmetryLaue: "" });
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : stage === "punch" ? cleanPunch(e) : e);
    model.respond = () => say("Done.");
  });

  it("pauses before the run for the Laue class the preflight suggests, its clock stopped, and goes on once your click applies it", async () => {
    await start();
    expect(run().state).toBe("paused");
    expect(run().pause).toEqual({ kind: "fact", proposal: expect.any(String), before: "run" });
    expect(status()).toMatchObject({ preflight: "done", run: "needs you" });
    expect(pipeline.runs).toEqual([]);
    expect(run().clock.pausedAt).not.toBeNull();
    // A script's click applies nothing: the run waits.
    await applyFact(SCRIPTED_CLICK);
    expect(usePipelineStore.getState().symmetryLaue).toBe("");
    expect(run().state).toBe("paused");
    // The waiting does not count against the limit.
    clock.t += 40 * 60_000;
    await applyFact(TRUSTED);
    await (autoLoop() ?? Promise.resolve());
    expect(usePipelineStore.getState().symmetryLaue).toBe("4/mmm");
    expect(run().state).toBe("done");
    expect(run().limit).toBeNull();
    expect(run().facts).toEqual([{ proposal: expect.any(String), title: "Laue class", shown: "none → 4/mmm", status: "applied" }]);
    const fact = decisions().find((d) => d.kind === "fact")!;
    expect([fact.by, fact.byClick, fact.action]).toEqual(["you", true, "apply"]);
    expect(pipeline.runs[0].with.symmetryLaue).toBe("4/mmm");
  });

  it("goes on after Skip, the fact declined and listed in the report's digest", async () => {
    await start();
    skipFact();
    await (autoLoop() ?? Promise.resolve());
    expect(run().state).toBe("done");
    expect(usePipelineStore.getState().symmetryLaue).toBe("");
    expect(run().facts[0].status).toBe("declined");
    const report = last(model.sent).messages[1].content as string;
    expect(report).toContain("you kept symmetryLaue none, declined 4/mmm");
  });

  it("pauses before the punch for a supercell the fix proposes, and runs from the punch once you apply it", async () => {
    usePipelineStore.getState().patch({ symmetryLaue: "4/mmm" });
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchSupercellH === "2" ? cleanPunch(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchSupercellH: 2 })(round) : say("Done."));
    await start();
    // The model's change of a fact was refused (its words are none), so the run waits for you.
    expect(usePipelineStore.getState().punchSupercellH).toBe("");
    expect(run().state).toBe("paused");
    expect(run().pause).toMatchObject({ kind: "fact", before: "punch" });
    expect(status()).toMatchObject({ rings: "passed", punch: "needs you", backfill: "pending" });
    await applyFact(TRUSTED);
    await (autoLoop() ?? Promise.resolve());
    expect(usePipelineStore.getState().punchSupercellH).toBe("2");
    expect(status()).toMatchObject({ punch: "passed", report: "done" });
    // Run from the punch after your Apply, then checked afresh.
    expect(pipeline.runs.map((r) => r.with.punchSupercellH)).toEqual(["", "2"]);
    expect(run().steps.filter((x) => x.name === "run_pipeline").map((x) => x.args)).toEqual([{}, { from_stage: "punch" }]);
  });
});

describe("limits", () => {
  beforeEach(() => {
    outputs.tweak = (stage, e) => (stage === "rings" ? e : stage === "punch" ? e : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith(phase.stage === "rings" ? "reduction-qc" : "bragg-node-audit", null, "No change would help.")(round) : say("The run ended early."));
  });

  it("the time limit: the fixes end, the stages after are not checked, and the report names it", async () => {
    model.respond = (phase, round) => {
      clock.t += 11 * 60_000; // each request takes eleven minutes
      return phase.kind === "fix" ? fixWith("reduction-qc", null, "No change would help.")(round) : say("The run ended early.");
    };
    await start({ minutes: 10 });
    expect(run().limit).toBe("time");
    expect(status()).toMatchObject({ rings: "attention", punch: "skipped", backfill: "skipped", pdf: "skipped", report: "done" });
    expect(run().plan.find((r) => r.id === "rings")!.detail).toBe("still needs attention: the time limit ended its fixes");
    expect(last(model.sent).messages[1].content).toContain("- the fixes ended at the time limit");
    expect(run().ended).toBe("Ended at the time limit, with its report.");
  });

  it("the replies limit: one reply is kept for the report", async () => {
    await start({ replies: 3 });
    expect(run().limit).toBe("replies");
    expect(run().replies).toBe(3);
    expect(status()).toMatchObject({ rings: "attention", punch: "attention", report: "done" });
    expect(run().plan.find((r) => r.id === "rings")!.tries).toBe(2);
    expect(run().plan.find((r) => r.id === "punch")!.tries).toBe(0);
  });

  it("the spend limit on Claude: the reply that reaches it is stopped, and the report is the app's alone", async () => {
    model.usage = { input: 200_000, output: 1_000 }; // $0.82 a request on Claude Opus 5.5
    await start({ costUsd: 0.5 }, { ...SCRIPTED, baseUrl: CLAUDE_URL, model: "claude-opus-5-5", apiKey: "k" });
    expect(run().limit).toBe("cost");
    expect(run().costUsd).toBeCloseTo(0.82, 2);
    expect(model.sent).toHaveLength(1);
    expect(status()).toMatchObject({ rings: "attention", punch: "skipped", report: "done" });
    expect(run().plan.find((r) => r.id === "report")!.detail).toBe("written without the model: the spend limit");
  });

  it("2 fixes a stage, 12 replies, 30 minutes and $2 by default", async () => {
    await start();
    expect(run().limits).toEqual({ minutes: 30, fixesPerStage: 2, replies: 12, costUsd: 2, fixRounds: 6, reportRounds: 4 });
    expect(run().clock.limitMs).toBe(30 * 60_000);
    expect(run().costUsd).toBeNull(); // an unpriced model: no spend limit applies
  });
});

describe("Stop and Resume", () => {
  it("Stop in a fix reply aborts it, keeps a consistent record, and Resume restarts that row", async () => {
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    let stopOnce = true;
    model.respond = (phase, round) => {
      if (phase.kind === "fix" && round === 1 && stopOnce) {
        stopOnce = false;
        stopAuto();
      }
      return phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done.");
    };
    await start();
    expect(run().state).toBe("stopped");
    expect(status()).toMatchObject({ punch: "stopped", backfill: "pending" });
    // Nothing changed in the stopped reply, and nothing is logged for it.
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    expect(decisions().map((d) => d.kind)).toEqual(["run"]);
    expect(last(useChatStore.getState().turns)).toMatchObject({ role: "assistant", note: "Stopped." });
    expect(run().clock.pausedAt).not.toBeNull();
    await resumeAuto();
    expect(run().state).toBe("done");
    expect(status()).toMatchObject({ punch: "fixed", report: "done" });
  });

  it("Stop in a pipeline run cancels it; Resume runs a change whose run had not finished first", async () => {
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    model.respond = (phase, round) => {
      if (phase.kind === "fix" && round === 2) holdRuns(); // the run after the fix waits
      return phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done.");
    };
    const started = startAuto({ ctx: CTX, settings: SCRIPTED, now: clock.now });
    await vi.waitFor(() => expect(usePipelineStore.getState().running && pipeline.hold).toBeTruthy());
    stopAuto();
    await started;
    expect(run().state).toBe("stopped");
    expect(run().pendingRun).toBe("punch");
    expect(last(pipeline.runs).ended).toBe("cancelled");
    pipeline.hold = null;
    await resumeAuto();
    expect(run().state).toBe("done");
    expect(pipeline.runs.map((r) => [r.with.punchMinSig, r.ended])).toEqual([
      ["", "done"],
      ["6", "cancelled"],
      ["6", "done"],
    ]);
    expect(status()).toMatchObject({ punch: "passed" });
  });

  it("End closes a stopped run without its report", async () => {
    model.respond = (_phase, round) => {
      stopAuto();
      return fixWith("reduction-qc", null)(round);
    };
    await start();
    endAuto();
    expect(run()).toMatchObject({ state: "done", ended: "Ended by you before its report." });
    expect(run().clock.endedAt).not.toBeNull();
  });
});

describe("failures", () => {
  it("a failed pipeline run pauses the run; Retry runs it again", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : stage === "punch" ? cleanPunch(e) : e);
    pipeline.fail = true;
    await start();
    expect(run()).toMatchObject({ state: "paused", pause: { kind: "failure", what: "run" } });
    expect(status()).toMatchObject({ run: "failed" });
    await resumeAuto();
    expect(run().state).toBe("done");
  });

  it("a model server that fails after its retries pauses the run; Retry asks again", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    let fail = true;
    stream.fn.mockImplementation((args: Parameters<typeof scriptedStream>[0]) => {
      if (fail) {
        fail = false;
        throw Object.assign(new Error("HTTP 401: invalid key"), { status: 401 });
      }
      return scriptedStream(args);
    });
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", null)(round) : say("Done."));
    await start();
    expect(run()).toMatchObject({ state: "paused", pause: { kind: "failure", what: "model", message: expect.stringContaining("401") } });
    expect(status()).toMatchObject({ punch: "failed" });
    await resumeAuto();
    expect(run().state).toBe("done");
  });
});

describe("Undo of auto changes", () => {
  it("puts back the run's own changes, newest first, and offers a run; a change your click made waits for your click", async () => {
    unsymmetrisedRaw();
    usePipelineStore.getState().patch({ symmetryLaue: "" });
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done."));
    await start();
    await applyFact(TRUSTED);
    await (autoLoop() ?? Promise.resolve());
    expect(usePipelineStore.getState()).toMatchObject({ punchMinSig: "6", symmetryLaue: "4/mmm" });
    expect(undoAutoRun()).toBe(1);
    expect(usePipelineStore.getState()).toMatchObject({ punchMinSig: "", symmetryLaue: "4/mmm" });
    expect(undoAutoRun(TRUSTED)).toBe(1);
    expect(usePipelineStore.getState().symmetryLaue).toBe("");
    // A Run card follows the undo.
    expect(useDecisionStore.getState().proposals.some((p) => p.kind === "run" && p.status === "open")).toBe(true);
  });
});

describe("the calls it makes itself", () => {
  it("are reading checks and runs only, never a change of a setting", async () => {
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done."));
    await start();
    const own = run().steps.filter((s) => s.id.startsWith("auto:")).map((s) => s.name);
    expect(new Set(own)).toEqual(new Set(["qmax_coverage", "ub_check", "grain_check", "run_pipeline", "assess_stage", "texture_check", "symmetry_check"]));
  });
});
