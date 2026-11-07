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
import { applyFact, autoLoop, endAuto, refusalNote, resumeAuto, skipFact, startAuto, startBlocked, stopAuto, undoAutoRun } from "../auto/controller";
import { REPORT_PROMPT } from "../auto/prompts";
import { useAutoStore, type AutoRun } from "../auto/store";
import { autoTranscript, isAppStep, isSeeded } from "../auto/transcript";
import { activityNow, type Activity } from "../auto/activity";
import { useTuneStore } from "../tune/tuner";
import { useChatStore } from "../chatStore";
import { CUT_OFF_NOTE } from "../agent";
import { UNSUPPORTED_MARK } from "../answerChecks";
import { VALIDATION_MAX_TOKENS } from "../evals/validationModels";
import { STREAM_MAX_TOKENS } from "../provider/anthropic";
import { CLAUDE_URL } from "./scriptedTransports";
import { call, clock, CTX, fixWith, freshAuto, holdRuns, model, outputs, phaseOf, pipeline, say, SCRIPTED, scriptedStream, TRUSTED, SCRIPTED_CLICK } from "./autoHarness";
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
    // The problems the final checks found: the app's list, computed from their verdicts, each with its tool.
    expect(run().problems).toEqual(["the counts end at 4.4 Å⁻¹, inside the box (qmax_coverage)"]);
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
    const fix = model.sent.find((r) => r.messages[3].content === "Change or tune the Bragg punch so its check above passes: one update_settings change, or tune_pipeline for this stage; the app then runs the pipeline from it and checks again. Say what you changed and why, or why no change would help.")!;
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
    const report = model.sent.find((r) => String(r.messages[3].content).startsWith(REPORT_PROMPT))!;
    expect(report.messages[1].content).toContain("the Bragg punch passed after its first fix");
    expect(report.messages[1].content).toMatch(/- in this auto run, auto mode ran the pipeline from the start; applied punchMinSig .* → 6; ran the pipeline from punch/);
    expect(appChanges()).toEqual([]);
  });

  it("places the app's own steps in the chat: each before the reply it led to, a seeded check in its reply, every step once", async () => {
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("The punch passed after a fix."));
    await start();
    const turns = useChatStore.getState().turns;
    const r = run();
    expect(r.turnAt).toHaveLength(r.turns.length);
    const { blocks, where } = autoTranscript(r, turns);
    const fixLabel = turns.find((t) => t.role === "user" && t.content.startsWith("Auto · fix"))!;
    const reportLabel = turns.find((t) => t.content === "Auto · the report")!;
    // The checks before the fix, above its line; those after it, above the report's; none after the report.
    expect(blocks.map((b) => b.before)).toEqual([fixLabel.id, reportLabel.id]);
    expect(blocks[0].steps.map((s) => s.name)).toEqual(expect.arrayContaining(["run_pipeline", "assess_stage"]));
    // The punch's check seeded into the fix is shown there, as its first step.
    const fixTurn = turns[turns.indexOf(fixLabel) + 1];
    const inFix = [...where.values()].filter((p) => p.turn === fixTurn.id).map((p) => p.stepId);
    expect(inFix).toEqual((fixTurn.steps ?? []).filter(isSeeded).map((s) => s.id));
    expect(inFix.length).toBeGreaterThan(0);
    // Every step of the app's has one place, and the blocks show none twice.
    const app = r.steps.filter(isAppStep);
    expect(app.every((s) => where.has(s.id))).toBe(true);
    const shown = blocks.flatMap((b) => b.steps.map((s) => s.id));
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.length + [...where.values()].filter((p) => p.turn !== null).length).toBe(app.length);
    // The Highlights follow the last step the app made, whole.
    expect(useAutoStore.getState().live).toMatchObject({ id: last(app).id, status: "done" });
  });

  it("stops a stage's fixes after two, and moves on with it needing attention", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", round === 1 ? { punchMinSig: 5 + model.sent.length % 3 } : null)(round) : say("The punch still needs attention."));
    await start();
    expect(status()).toMatchObject({ punch: "attention", backfill: "passed", report: "done" });
    expect(run().plan.find((r) => r.id === "punch")).toMatchObject({ tries: 2, detail: "still needs attention after two fixes" });
    expect(run().replies).toBe(3); // two fixes and the report
    expect(run().problems).toEqual(["the Bragg punch needs attention: missed at nodes (assess_stage punch)", "the counts end at 4.4 Å⁻¹, inside the box (qmax_coverage)"]);
    // The model is not asked for them: its prompt leaves them to the app's list.
    const report = model.sent.find((r) => phaseOf(r.messages).kind === "report")!;
    expect(String(report.messages[3].content)).toBe(REPORT_PROMPT);
    expect(REPORT_PROMPT).toContain("The app lists the problems they found: refer to that list.");
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
    // The activity log says the fix was put back, and why.
    expect(activityNow()!.rows.find((r) => r.title === "Fix the Bragg punch, first of two")!.line).toMatch(/^Changed Punch min σ .* → 4 \(it made the check worse: put back\)$/);
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
    expect(run().facts).toEqual([{ proposal: expect.any(String), title: "Laue class", shown: "none → 4/mmm", status: "applied", at: expect.any(Number) }]);
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
    // The report is the app's alone, opened from the panel (no reply to hang it on).
    expect(run()).toMatchObject({ appReport: "limit", reportTurn: null });
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

  it("Stop after the fix's change ran: the change is logged as auto mode's, its run owed, and Resume runs it first", async () => {
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    let stopOnce = true;
    model.respond = (phase, round) => {
      if (phase.kind === "fix" && round === 2 && stopOnce) {
        stopOnce = false;
        stopAuto();
      }
      return phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done.");
    };
    await start();
    expect(run().state).toBe("stopped");
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
    expect(decisions().map((d) => [d.kind, d.by, d.after])).toEqual([
      ["run", "auto", {}],
      ["setting", "auto", { punchMinSig: "6" }],
    ]);
    expect(run().pendingRun).toBe("punch");
    await resumeAuto();
    expect(run().state).toBe("done");
    expect(run().pendingRun).toBeNull();
    expect(pipeline.runs.map((r) => r.with.punchMinSig)).toEqual(["", "6"]);
    expect(status()).toMatchObject({ punch: "passed", report: "done" });
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

  it("Stop on a paused run ends it with the app's report: no model reply, no cost, the rows it left not checked", async () => {
    model.respond = (_phase, round) => {
      stopAuto();
      return fixWith("reduction-qc", null)(round);
    };
    await start();
    expect(run().state).toBe("stopped");
    const sent = model.sent.length;
    await endAuto();
    expect(run()).toMatchObject({ state: "done", appReport: "stopped", reportTurn: null, ended: "Stopped by you: the app's report, from what the run checked, with no model reply.", now: "Stopped by you." });
    expect(model.sent).toHaveLength(sent); // no reply for the report
    expect(status()).toMatchObject({ preflight: "done", run: "done", rings: "stopped", punch: "skipped", pdf: "skipped", report: "done" });
    expect(run().plan.find((r) => r.id === "punch")!.detail).toBe("not checked: stopped by you");
    expect(run().plan.find((r) => r.id === "report")!.detail).toBe("the app's alone: stopped by you, no model reply");
    // The problems the run's checks found so far, the app's list, as the report's.
    expect(run().problems).toEqual(expect.arrayContaining([expect.stringMatching(/\((qmax_coverage|ub_check|assess_stage \w+)\)$/)]));
    expect(run().clock.endedAt).not.toBeNull();
    // The activity log says so, and the record is a finished run's: Resume does nothing.
    expect(activityNow()!.rows.find((r) => r.key === "app-report")).toMatchObject({ title: "The app's report", line: "Stopped by you: written from what the run checked, with no model reply and no cost" });
    await resumeAuto();
    expect(run().state).toBe("done");
  });

  it("Stop while a fix reply runs: it is aborted and unwinds first, then the run ends with the app's report, at no cost", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    model.usage = { input: 1000, output: 100 };
    let ending: Promise<void> | null = null;
    model.respond = (phase, round) => {
      if (phase.kind === "fix" && round === 1 && !ending) ending = endAuto();
      return phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done.");
    };
    await startAuto({ ctx: CTX, settings: { ...SCRIPTED, baseUrl: CLAUDE_URL, model: "claude-opus-5-5", apiKey: "k" }, now: clock.now });
    await ending;
    const spent = run().costUsd;
    expect(run()).toMatchObject({ state: "done", appReport: "stopped", reportTurn: null });
    expect(status()).toMatchObject({ punch: "stopped", backfill: "skipped", report: "done" });
    // The fix's own requests only: none for the report, and nothing spent after the stop.
    expect(model.sent.every((r) => phaseOf(r.messages).kind === "fix")).toBe(true);
    await (autoLoop() ?? Promise.resolve());
    expect(run().costUsd).toBe(spent);
    expect(usePipelineStore.getState().punchMinSig).toBe("");
  });

  it("Stop after a fix's change, before its run: the report says the outputs are from before it", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    let stopOnce = true;
    model.respond = (phase, round) => {
      if (phase.kind === "fix" && round === 2 && stopOnce) {
        stopOnce = false;
        stopAuto();
      }
      return phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done.");
    };
    await start();
    expect(run().pendingRun).toBe("punch");
    await endAuto();
    expect(run().ended).toBe("Stopped by you: the app's report, from what the run checked, with no model reply. A change's run had not finished (punch on): the outputs are those from before it.");
    expect(decisions().map((d) => [d.kind, d.by, d.after])).toEqual([
      ["run", "auto", {}],
      ["setting", "auto", { punchMinSig: "6" }],
    ]);
  });

  it("Pause is still the stop Resume goes on from", async () => {
    model.respond = (_phase, round) => {
      stopAuto();
      return fixWith("reduction-qc", null)(round);
    };
    await start();
    expect(run()).toMatchObject({ state: "stopped", appReport: null });
  });
});

describe("the output cap (the validation's, where the transport ships none)", () => {
  beforeEach(() => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : stage === "punch" ? cleanPunch(e) : e);
  });

  it("asks every reply of a run on an uncapped transport for 16,000 tokens at most, as arm B's validation does", async () => {
    model.respond = () => say("Every stage meets its goal by its checks above.");
    await start();
    expect(model.sent.length).toBeGreaterThan(0);
    expect(model.sent.every((r) => r.maxTokens === VALIDATION_MAX_TOKENS)).toBe(true);
    expect(VALIDATION_MAX_TOKENS).toBe(16_000);
  });

  it("leaves Claude's own cap as the app ships it", async () => {
    model.respond = () => say("Every stage meets its goal by its checks above.");
    await start({}, { ...SCRIPTED, baseUrl: CLAUDE_URL, model: "claude-opus-5-5", apiKey: "k" });
    expect(model.sent.map((r) => r.maxTokens)).toEqual([STREAM_MAX_TOKENS]);
  });

  it("a report reply cut off at the cap: its text kept with the cut-off note, the cut told, and the run ends with its report", async () => {
    const cuts: { request: number; reason: string }[] = [];
    model.respond = () => [{ content: "Every stage meets its goal, and" }, { truncated: true, stopReason: "length" }];
    await startAuto({ ctx: CTX, settings: SCRIPTED, now: clock.now, truncations: { loop: (c) => cuts.push(c), tuning: () => {} } });
    await (autoLoop() ?? Promise.resolve());
    expect(run()).toMatchObject({ state: "done", ended: "Done, with its report." });
    expect(status()).toMatchObject({ report: "done" });
    expect(run().plan.find((r) => r.id === "report")!.detail).toBe("written");
    const turn = useChatStore.getState().turns.find((t) => t.id === run().reportTurn)!;
    expect(turn.content).toBe("Every stage meets its goal, and");
    expect(turn.note).toBe(CUT_OFF_NOTE);
    expect(cuts).toEqual([{ request: 1, reason: "length" }]);
  });

  it("a report whose revision is cut off at the cap: the answer it revised kept with its ⚠ marks, and the run ends with its report", async () => {
    let n = 0;
    model.respond = () => {
      n += 1;
      // An answer against the UB's verdict, with a number no check returned, is sent back; its revision runs out of room.
      return n === 1 ? say("The UB is turned by 12.5° and the HKL origin is shifted by 0.37 r.l.u.") : [{ content: "The ring" }, { truncated: true, stopReason: "length" }];
    };
    await start();
    expect(run()).toMatchObject({ state: "done", ended: "Done, with its report." });
    const turn = useChatStore.getState().turns.find((t) => t.id === run().reportTurn)!;
    expect(turn.content).toBe(`${UNSUPPORTED_MARK} The UB is turned by 12.5° and the HKL origin is shifted by 0.37 r.l.u.`);
    expect(turn.note).toMatch(/^This answer failed its checks, and its revision did not replace it\. The lines marked ⚠ hold what no tool result in this reply supports: .*The reply was cut off: /);
  });
});

describe("a start refused while the demo's run goes on (Pyodide, after a reload)", () => {
  it("is refused while the run goes on, says so only while it does, and starts once it has ended", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : stage === "punch" ? cleanPunch(e) : e);
    model.respond = () => say("Done.");
    // A reload empties the in-browser engine: the demo is loaded and run again, and the chip clicked during that run.
    usePipelineStore.setState({ running: true });
    await expect(startAuto({ ctx: CTX, settings: SCRIPTED, now: clock.now })).rejects.toThrow("wait for the run under way to end");
    expect(refusalNote(true, startBlocked())).toBe("Not started: wait for the run under way to end.");
    expect(useAutoStore.getState().run).toBeNull();
    // The demo's run ends: the note no longer stands (it once stayed until the next click), and a start goes through.
    usePipelineStore.setState({ running: false, terminal: "done" });
    expect(startBlocked()).toBeNull();
    expect(refusalNote(true, startBlocked())).toBeNull();
    await start();
    expect(run().state).toBe("done");
    // Each other reason is said while it holds, and none once nothing blocks.
    useChatStore.setState({ busy: true });
    expect(refusalNote(true, startBlocked())).toBe("Not started: wait for the reply to end.");
    useChatStore.setState({ busy: false });
    useTuneStore.setState({ active: true });
    expect(refusalNote(true, startBlocked())).toBe("Not started: wait for the run under way to end.");
    useTuneStore.setState({ active: false });
    expect(refusalNote(false, startBlocked())).toBeNull();
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

describe("a tuning run in a fix", () => {
  it("asks the run's model, and its requests count in the run's spend", async () => {
    const tune = (await import("../tools")).CHAT_TOOLS.find((t) => t.name === "tune_pipeline")!;
    const run0 = tune.run;
    const seen: unknown[] = [];
    tune.run = async (_args, ctx) => {
      seen.push(ctx.model?.settings);
      ctx.model?.usage({ input: 100_000, output: 1_000 });
      return { result: { tuned: [] }, summary: "tuned nothing" };
    };
    try {
      outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
      model.respond = (phase, round) =>
        phase.kind === "fix" ? (round === 0 ? fixWith("bragg-node-audit", null)(0) : round === 1 ? call("tune_pipeline", { stages: ["punch"] }) : say("Tuned.")) : say("Done.");
      await start({}, { ...SCRIPTED, baseUrl: CLAUDE_URL, model: "claude-sonnet-5-5", apiKey: "k" });
    } finally {
      tune.run = run0;
    }
    expect(seen[0]).toMatchObject({ baseUrl: CLAUDE_URL, model: "claude-sonnet-5-5" });
    // Two tunings of 100k tokens in at $2/M and 1k out at $10/M, $0.42, on top of the replies' own (estimated: the script reports none).
    expect(run().costUsd!).toBeGreaterThan(0.42);
    expect(run().usage.input).toBeGreaterThan(200_000);
    expect(run().usage.requests - run().usage.estimated).toBe(2);
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

// The Now line and the activity log (auto/activity.ts), as a run's record and
// the stores change under the controller: built from its steps, outcomes,
// decisions and the tuning's trials, nothing asked of the model.
describe("the Now line and the activity log", () => {
  /** Every Now line the run showed, in order, and every state of the activity on the way. */
  function watch() {
    const nows: string[] = [];
    const all: Activity[] = [];
    const look = () => {
      const a = activityNow();
      if (!a) return;
      all.push(a);
      if (nows[nows.length - 1] !== a.now) nows.push(a.now);
    };
    const stops = [useAutoStore.subscribe(look), useChatStore.subscribe(look), useTuneStore.subscribe(look)];
    return { nows, all, stop: () => stops.forEach((f) => f()) };
  }
  /** `want` appear in `nows`, in this order. */
  const inOrder = (nows: string[], want: string[]) => {
    let i = 0;
    for (const n of nows) if (n === want[i]) i += 1;
    expect(want.slice(i), `missing, in order, from: ${nows.join(" | ")}`).toEqual([]);
  };

  it("a fix: says what it checks, which fix it is on, the run and the check after it, then the report; logs the change", async () => {
    outputs.tweak = (stage, e, ranWith) => (stage === "rings" ? cleanRings(e) : stage === "punch" && ranWith.punchMinSig === "6" ? cleanPunch(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("The punch passed after a fix."));
    const w = watch();
    await start();
    w.stop();
    inOrder(w.nows, [
      "Running the pipeline…",
      "Checking the ring removal (stage 1 of 5)…",
      "Checking the Bragg punch (stage 2 of 5)…",
      "Fixing the Bragg punch, try 1 of 2",
      "Running the pipeline from the Bragg punch after fix 1…",
      "Checking the Bragg punch again after fix 1…",
      "Checking the backfill (stage 3 of 5)…",
      "Writing the report",
      "Done, with its report.",
    ]);
    // While the fix replied, its row was the one under way.
    const replying = w.all.filter((a) => a.now === "Fixing the Bragg punch, try 1 of 2").map((a) => a.rows.slice(-1)[0]!);
    expect(replying).toContainEqual(expect.objectContaining({ status: "running", title: "Fix the Bragg punch, first of two" }));
    // Its line follows the reply's own steps as they run.
    expect(replying.map((r) => r.line)).toEqual(expect.arrayContaining(["The model is replying…", "Read a skill…", "Changed settings…"]));
    const rows = activityNow()!.rows;
    expect(rows.every((r) => r.status === "done")).toBe(true);
    const fix = rows.find((r) => r.title === "Fix the Bragg punch, first of two")!;
    expect(fix.line).toMatch(/^Changed Punch min σ .* → 6$/);
    expect(fix.detail.some((d) => d.startsWith("Read a skill"))).toBe(true);
    expect(rows.filter((r) => r.title === "Checked the Bragg punch").length).toBe(2);
    expect(rows.slice(-1)[0]).toMatchObject({ title: "Wrote the report", line: "Written" });
    // A row of the app's own step links to it: its place in the chat and its highlights.
    expect(rows.find((r) => r.title === "Checked the ring removal")!.step).toMatch(/^auto:/);
  });

  it("a tuning in progress: names the trial under way", async () => {
    const tune = (await import("../tools")).CHAT_TOOLS.find((t) => t.name === "tune_pipeline")!;
    const run0 = tune.run;
    let during: Activity | null = null;
    tune.run = async () => {
      const trial = (n: number, status: "done" | "running" | "pending") => ({ n, changes: {}, settings: {}, status });
      useTuneStore.setState({ active: true, stages: [{ stage: "punch", tuned: true, status: "running", trials: [trial(1, "done"), trial(2, "running"), trial(3, "pending")] }] });
      during = activityNow();
      useTuneStore.setState({ active: false, stages: [] });
      return { result: { tuned: [] }, summary: "tuned nothing" };
    };
    try {
      outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
      model.respond = (phase, round) =>
        phase.kind === "fix" ? (round === 0 ? fixWith("bragg-node-audit", null)(0) : round === 1 ? call("tune_pipeline", { stages: ["punch"] }) : say("Tuned.")) : say("Done.");
      await start({ fixesPerStage: 1 });
    } finally {
      tune.run = run0;
    }
    expect(during!.now).toBe("Tuning the Bragg punch, trial 2 of 3");
    expect(during!.rows.slice(-1)[0]).toMatchObject({ status: "running", line: "Tuning the Bragg punch, trial 2 of 3" });
    expect(activityNow()!.rows.find((r) => r.title === "Fix the Bragg punch, first of one")!.line).toBe("Tuned the stage");
  });

  it("a fact: waits for your answer, the row needs you; Skip logs it skipped and the run goes on", async () => {
    unsymmetrisedRaw();
    usePipelineStore.getState().patch({ symmetryLaue: "" });
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : stage === "punch" ? cleanPunch(e) : e);
    model.respond = () => say("Done.");
    await start();
    let a = activityNow()!;
    expect(a.now).toBe("Waiting for your answer: Laue class");
    expect(a.rows.slice(-1)[0]).toMatchObject({ status: "needs you", title: "Asked you: Laue class none → 4/mmm", line: expect.stringMatching(/^Waiting for your answer/) });
    skipFact();
    await new Promise((r) => setTimeout(r, 0));
    await (autoLoop() ?? Promise.resolve());
    a = activityNow()!;
    expect(a.now).toBe("Done, with its report.");
    expect(a.rows.find((r) => r.title.startsWith("Asked you: Laue class"))).toMatchObject({ status: "skipped", line: expect.stringMatching(/^Skipped by you/) });
    // Asked after the preflight's checks, before the run.
    const i = a.rows.findIndex((r) => r.title.startsWith("Asked you"));
    expect(a.rows.slice(0, i).some((r) => r.title === "Checked Qmax against coverage")).toBe(true);
    expect(a.rows.slice(i).some((r) => r.title === "Ran the pipeline")).toBe(true);
  });

  it("a stop: paused by you in the row it stopped, and Resume goes on", async () => {
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
    const a = activityNow()!;
    expect(a.now).toBe("Paused by you in the Bragg punch. Resume restarts it.");
    expect(a.rows.slice(-1)[0]).toMatchObject({ status: "stopped", title: "Paused by you", line: "In the Bragg punch; Resume restarts it" });
    clock.t += 5_000; // paused five seconds
    await resumeAuto();
    expect(activityNow()!.rows.some((r) => r.status === "stopped")).toBe(false);
    // The pause is kept apart from the time worked.
    expect(run().clock.pausedMs).toBeGreaterThanOrEqual(5_000);
  });

  it("a limit: logs it and the stages it left unchecked", async () => {
    outputs.tweak = (_stage, e) => e;
    model.respond = (phase, round) => {
      clock.t += 11 * 60_000;
      return phase.kind === "fix" ? fixWith("reduction-qc", null, "No change would help.")(round) : say("The run ended early.");
    };
    await start({ minutes: 10 });
    const rows = activityNow()!.rows;
    expect(rows.find((r) => r.key === "limit")).toMatchObject({ status: "skipped", line: "The fixes ended at the time limit; the run went to its report" });
    expect(rows.filter((r) => r.title.startsWith("Not checked:")).map((r) => r.title)).toEqual(["Not checked: Bragg punch", "Not checked: Backfill", "Not checked: Background correction", "Not checked: 3D-ΔPDF"]);
  });
});
