// Auto mode, adversarially (auto/controller.ts, docs/pilot-auto-mode-design.md
// §5): every guard is exactly as strict for an auto reply as for any other.
//  - A sample fact changes only on the user's own click, never by the run or
//    the model: not from the phase message, the seeded results or the
//    digest naming it, in either seed form, and not from a script's click.
//  - The ring gate holds an auto reply as it holds any: only the 3D verdict
//    of a ring left, on the outputs as they now are, lets a ring change go.
//  - THY-18 and the answer checks: a seeded step counts as called, a number
//    from nowhere is still sent back and kept marked, a tool credited
//    without running is still caught; the digest holds no measured number.
//  - Limits bound a reply's rounds and the run's replies, whatever the model does.
//  - A stop leaves a consistent record, which a reload brings back stopped.
//  - A fix made worse is put back by auto mode only when no click made it.
// Synthetic only: no model is loaded, no backend or API is called.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePipelineStore } from "../../state/pipelineStore";
import { undoDecision } from "../apply/actions";
import { useDecisionStore } from "../apply/decisions";
import { applyFact, autoLoop, skipFact, startAuto, stopAuto } from "../auto/controller";
import { digest } from "../auto/prompts";
import { interrupted, readAutoRun, useAutoStore, type AutoRun } from "../auto/store";
import { useChatStore } from "../chatStore";
import { CLAUDE_URL } from "./scriptedTransports";
import { call, clock, CTX, fixWith, freshAuto, model, outputs, say, SCRIPTED, scriptedStream, SCRIPTED_CLICK, TRUSTED } from "./autoHarness";
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

vi.mock("../tune/evaluate", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tune/evaluate")>();
  const { outputs: o } = await import("./autoOutputs");
  return {
    ...original,
    evaluateStage: async (...args: Parameters<typeof original.evaluateStage>) => o.tweak(args[0], await original.evaluateStage(...args), o.ranWith),
  };
});

const run = (): AutoRun => useAutoStore.getState().run!;
const status = () => Object.fromEntries(run().plan.map((r) => [r.id, r.status]));
const CLAUDE = { ...SCRIPTED, baseUrl: CLAUDE_URL, model: "claude-opus-5-5", apiKey: "k" };
const cleanRings = (e: Record<string, unknown>) => ({ ...e, max_ring_left: 0, max_ring_dent: 0 });
const cleanPunch = (e: Record<string, unknown>) => ({ ...e, leftover_at_nodes: 0 });

async function start(limits = {}, settings = SCRIPTED): Promise<void> {
  await startAuto({ ctx: CTX, settings, limits, now: clock.now });
  await (autoLoop() ?? Promise.resolve());
}

/** Each update_settings step of the run's replies, with its result. */
const settingCalls = () => run().steps.filter((s) => s.name === "update_settings");

beforeEach(() => {
  installBackend(api);
  freshAuto();
  stream.fn.mockImplementation(scriptedStream);
  usePipelineStore.getState().patch({ symmetryLaue: "4/mmm", pdfQMin: "0.25", pdfQMax: "4.4" });
});

describe("a sample fact changes on the user's own click alone", () => {
  // The punch's result names the facts in its own words: as the seeded check, in the round or in the message.
  const naming = (e: Record<string, unknown>) => ({ ...e, note: "punchSupercellH 2 or a modulation with k = (1/3, 0, 0) would keep these" });

  for (const [form, settings] of [
    ["a round of calls", SCRIPTED],
    ["the phase message (Claude)", CLAUDE],
  ] as const) {
    it(`refuses the model's change of a fact whose name the seeded checks carry, in ${form}, and the run waits for you`, async () => {
      outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : stage === "punch" ? naming(e) : e);
      model.respond = (phase, round) =>
        phase.kind === "fix" ? fixWith("bragg-node-audit", { punchSupercellH: 2, modulation: { k: "1/3, 0, 0", order: 1, form: "points" } })(round) : say("Done.");
      await start({}, settings);
      const fix = model.sent.find((r) => String(r.messages[3].content).includes("Change or tune the Bragg punch"))!;
      // The words reach the model, as the seed form puts them.
      expect(JSON.stringify(fix.messages)).toContain("punchSupercellH 2 or a modulation");
      expect(usePipelineStore.getState()).toMatchObject({ punchSupercellH: "", modulationK: "" });
      expect(settingCalls()[0]).toMatchObject({ status: "error" });
      expect(settingCalls()[0].result).toMatch(/fact about the sample/);
      expect(run()).toMatchObject({ state: "paused", pause: { kind: "fact", before: "punch" } });
    });
  }

  it("is never set by a script's click, a forged event or none; only the browser's own click applies it", async () => {
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchSupercellH: 2 })(round) : say("Done."));
    await start();
    expect(run().pause?.kind).toBe("fact");
    for (const event of [SCRIPTED_CLICK, null, undefined, {}, { isTrusted: "true" }, { isTrusted: 1 }]) {
      await applyFact(event as never);
      expect(usePipelineStore.getState().punchSupercellH).toBe("");
      expect(run().state).toBe("paused");
    }
    expect(useDecisionStore.getState().decisions.filter((d) => d.kind === "fact")).toEqual([]);
    await applyFact(TRUSTED, { punchSupercellH: "2" });
    await (autoLoop() ?? Promise.resolve());
    expect(usePipelineStore.getState().punchSupercellH).toBe("2");
  });

  it("stays declined after Skip: the digest names it for the next fix, and the model's change of it is refused again", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchSupercellH: 2 })(round) : say("Done."));
    await start();
    skipFact();
    await (autoLoop() ?? Promise.resolve());
    // The second fix read "you kept punchSupercellH (default), declined 2" in its context, and tried again.
    const second = model.sent.filter((r) => String(r.messages[3].content).includes("Change or tune the Bragg punch") && r.messages.length <= 6)[1];
    expect(second.messages[1].content).toMatch(/you kept punchSupercellH .*, declined 2/);
    expect(usePipelineStore.getState().punchSupercellH).toBe("");
    expect(settingCalls().every((s) => s.status === "error")).toBe(true);
    // Asked once: the same card is not asked twice.
    expect(run().facts.map((f) => f.status)).toEqual(["declined"]);
    expect(run().state).toBe("done");
  });

  it("hands every reply's tools a context with no grant and no user words", async () => {
    const seen: unknown[] = [];
    const update = (await import("../tools")).CHAT_TOOLS.find((t) => t.name === "update_settings")!;
    const run0 = update.run;
    update.run = async (args, ctx, io) => {
      seen.push({ grant: "grant" in ctx, user: ctx.userMessage, skills: ctx.skillsRead !== undefined });
      return run0(args, ctx, io);
    };
    try {
      model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", { punchMinSig: 6 })(round) : say("Done."));
      await start();
    } finally {
      update.run = run0;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => JSON.stringify(x) === JSON.stringify({ grant: false, user: "", skills: true }))).toBe(true);
  });
});

describe("the ring gate holds an auto reply as any other", () => {
  it("refuses a ring change in the punch's fix while the 3D verdict found no ring left, and logs the card as held, never pausing for it", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    model.respond = (phase, round) =>
      phase.kind === "fix" ? (round === 0 ? call("read_skill", { name: "bragg-node-audit" }) : round === 1 ? call("read_skill", { name: "reduction-qc" }) : round === 2 ? call("update_settings", { changes: { ringModel: "parametric" } }) : say("No change.")) : say("Done.");
    await start();
    expect(usePipelineStore.getState().ringModel).toBe("pooled");
    expect(settingCalls()[0].result).toMatch(/waits for a 3D verdict that a powder ring is left/);
    expect(run().held.map((h) => h.title)).toEqual(["Ring model"]); // once, though both fixes asked
    expect(run().state).toBe("done");
    expect(run().pause).toBeNull();
  });

  for (const [form, settings] of [
    ["a round of calls", SCRIPTED],
    ["the phase message (Claude)", CLAUDE],
  ] as const) {
    it(`lets the rings' fix change the ring model on its seeded 3D verdict of a ring left, in ${form}, and not once a run made that verdict stale`, async () => {
      outputs.tweak = (stage, e, ranWith) => (stage === "rings" && ranWith.ringModel === "parametric" ? cleanRings(e) : stage === "punch" ? cleanPunch(e) : e);
      model.respond = (phase, round) =>
        phase.kind === "fix" && phase.stage === "rings" ? fixWith("reduction-qc", { ringModel: "parametric" })(round) : say("Done.");
      await start({}, settings);
      expect(usePipelineStore.getState().ringModel).toBe("parametric");
      expect(status()).toMatchObject({ rings: "fixed" });
      // The verdict the fix rested on is stale after the run from the rings: a later change waits for a new one.
      const { ringVerdictAllowsChange } = await import("../tools/shared/ringGate");
      const steps = run().steps;
      expect(ringVerdictAllowsChange({ earlierSteps: steps, replySteps: [], dataset: CTX.dataset })).toBe(false);
    });
  }
});

describe("THY-18 and the answer checks, unchanged in auto mode", () => {
  it("count a seeded check as called: an answer quoting its numbers stands", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("bragg-node-audit", null, "The punch missed 1 node: assess_stage counts leftover_at_nodes 1. No setting would help.")(round) : say("Done."));
    await start();
    const turn = useChatStore.getState().turns.find((t) => t.role === "assistant" && t.content.startsWith("The punch missed"))!;
    expect(turn.note).toBeUndefined();
  });

  it("send back a number from nowhere and a tool credited without running, and note what still fails", async () => {
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : e);
    model.respond = (phase, round) =>
      phase.kind === "fix" ? fixWith("bragg-node-audit", null, "dpdf_peaks found 7 strong features at 3.73 Å; the punch is fine.")(round) : say("Done.");
    await start();
    const fixes = useChatStore.getState().turns.filter((t) => t.role === "assistant" && t.content.includes("dpdf_peaks"));
    expect(fixes.length).toBeGreaterThan(0);
    // A revision that says the same is noted, as in any reply: the tool credited, the verdict contradicted.
    for (const t of fixes) expect(t.note).toMatch(/Credits numbers to tools that did not run in this reply: dpdf_peaks/);
    // The answer went back once, as any reply's does.
    expect(model.sent.some((r) => r.messages.some((m) => m.role === "user" && String(m.content).includes("Then write the whole answer again.")))).toBe(true);
  });

  it("the digest holds no measured number: only the settings' values its decisions name", () => {
    const plan = [
      { id: "preflight", title: "", status: "done", tries: 0 },
      { id: "run", title: "", status: "done", tries: 0 },
      { id: "rings", title: "", status: "attention", tries: 2 },
      { id: "punch", title: "", status: "fixing", tries: 1 },
    ] as AutoRun["plan"];
    const text = digest({ plan, fixesPerStage: 2, limit: "time", decisions: [], proposals: [] });
    expect(text).toBe(
      "- auto run so far: preflight done; the run done; the ring removal still needs attention after two fixes; the Bragg punch needs attention: this is its first fix of two\n- the fixes ended at the time limit",
    );
    expect(text).not.toMatch(/\d/);
  });
});

describe("limits hold whatever the model does", () => {
  it("a fix reply that never stops calling is cut at its round limit, and the run's replies at theirs", async () => {
    let n = 0;
    model.respond = (phase) => (phase.kind === "fix" ? call("line_profile", { plane: "hk0", value: 0, from: [0, 0], to: [1, 1 + (n++ % 50) / 100] }) : say("Done."));
    await start({ replies: 4, fixRounds: 3 });
    // Per fix reply: three rounds of calls and the last request, which offers none.
    const perReply = new Map<string, number>();
    for (const r of model.sent) {
      const key = `${String(r.messages[3].content).slice(0, 40)}|${r.messages[1].content}`;
      perReply.set(key, (perReply.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perReply.values())).toBeLessThanOrEqual(4);
    expect(run().replies).toBe(4);
    expect(run().limit).toBe("replies");
  });
});

describe("a stop leaves a consistent record", () => {
  it("in the preflight: no decision, no run, the row stopped, the steps that ended kept", async () => {
    let stops = 0;
    api.fetchUbCheck.mockImplementation(async () => {
      if (!stops++) stopAuto();
      return { id: "x" };
    });
    await start();
    expect(run().state).toBe("stopped");
    expect(status()).toMatchObject({ preflight: "stopped", run: "pending" });
    expect(run().decisions).toEqual([]);
    expect(run().steps.map((s) => s.name)).toEqual(["qmax_coverage"]);
  });

  it("comes back from a reload stopped, its clock paused, Resume restarting its row; from a file, its steps never evidence", async () => {
    model.respond = (phase, round) => {
      if (phase.kind === "fix" && round === 1) clock.t += 1;
      return phase.kind === "fix" ? fixWith("bragg-node-audit", null)(round) : say("Done.");
    };
    await start();
    const live = {
      ...run(),
      state: "running" as const,
      at: "punch" as const,
      clock: { ...run().clock, pausedAt: null, endedAt: null },
      plan: run().plan.map((r) => (r.id === "punch" ? { ...r, status: "fixing" as const } : r)),
    };
    const saved = JSON.parse(JSON.stringify(live));
    const back = interrupted(readAutoRun(saved, { fromFile: false })!, clock.t + 5);
    expect(back.state).toBe("stopped");
    expect(back.plan.find((r) => r.id === "punch")!.status).toBe("stopped");
    expect(back.clock.pausedAt).toBe(clock.t + 5);
    const file = readAutoRun(saved, { fromFile: true })!;
    expect(file.steps.length).toBeGreaterThan(0);
    expect(file.steps.every((s) => s.restored)).toBe(true);
    // A malformed record is none.
    expect(readAutoRun({ ...saved, clock: null }, { fromFile: true })).toBeNull();
    expect(readAutoRun({ ...saved, state: "running?" }, { fromFile: true })).toBeNull();
  });
});

describe("putting back a fix", () => {
  it("auto mode never undoes a change a click made", async () => {
    usePipelineStore.getState().patch({ symmetryLaue: "" });
    const meta = api.fetchMeta.getMockImplementation()!;
    api.fetchMeta.mockImplementation(async (id: string) => ({ ...(await meta(id)), ...(id.endsWith(".raw") ? { symmetry: null, symmetry_ops: null } : {}) }));
    outputs.tweak = (stage, e) => (stage === "rings" ? cleanRings(e) : stage === "punch" ? cleanPunch(e) : e);
    await start();
    await applyFact(TRUSTED);
    await (autoLoop() ?? Promise.resolve());
    const fact = useDecisionStore.getState().decisions.find((d) => d.byClick)!;
    expect(undoDecision(fact, undefined, "auto")).toBe(false);
    expect(undoDecision(fact, TRUSTED, "auto")).toBe(false);
    expect(usePipelineStore.getState().symmetryLaue).toBe("4/mmm");
  });
});
