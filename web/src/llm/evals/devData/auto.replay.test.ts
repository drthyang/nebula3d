// Auto mode (auto/controller.ts) through whole runs on a dev case built where
// the tests run (devData: the pipeline in Python through the CPython bridge,
// every run a real one), its model scripted (autoHarness.ts). On dev-flatten,
// whose planted Q² background leaves a pedestal:
//  - the flatten's fix turns on the Q² term, the app runs from the flatten
//    and checks again, and the stage passes; the fix's answer quotes its
//    seeded check by reference ({{tool.field}}, THY-18), filled from it;
//  - a fix that proposes a supercell is refused (its words are none), its
//    card asked before the stage it holds back, applied by your click, and
//    the run resumes with a run from the punch, every row from there checked
//    afresh.
// The preflight's Laue class (the volume declares none) is asked before the
// run, applied in the first and skipped in the second.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePipelineStore } from "../../../state/pipelineStore";
import { clearDecisions, useDecisionStore } from "../../apply/decisions";
import { applyFact, autoLoop, skipFact, startAuto } from "../../auto/controller";
import { useAutoStore, type AutoRun } from "../../auto/store";
import { useChatStore } from "../../chatStore";
import { fixWith, model, say, SCRIPTED, scriptedStream, TRUSTED } from "../../__tests__/autoHarness";
import { devCase } from "./index";

const stream = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../provider/client")>()),
  streamChat: stream.fn,
}));

const run = (): AutoRun => useAutoStore.getState().run!;
const status = () => Object.fromEntries(run().plan.map((r) => [r.id, r.status]));
const settled = async () => {
  await new Promise((r) => setTimeout(r, 20));
  await (autoLoop() ?? Promise.resolve());
};

beforeEach(() => {
  stream.fn.mockImplementation(scriptedStream);
  useChatStore.getState().clear();
  useChatStore.setState({ busy: false, live: null, clock: null });
  clearDecisions();
  useAutoStore.setState({ run: null });
  model.sent = [];
  model.usage = null;
});

describe("auto mode on dev-flatten, through the real pipeline", () => {
  it("fixes the flatten's pedestal with the Q² term, run and checked by the app", async () => {
    const c = devCase("dev-flatten");
    const dataset = await c.dataset();
    model.respond = (phase, round) =>
      phase.kind === "fix" && phase.stage === "flatten"
        ? fixWith("reduction-qc", { flattenQ2: true }, "The floors rise with |Q| (trend {{assess_stage.flatten.floor_trend}}): I turned on the Q² term, flattenQ2.")(round)
        : phase.kind === "fix"
          ? fixWith("reduction-qc", null, "No change would help.")(round)
          : say("The flatten passed after its fix.");
    await startAuto({ ctx: { dataset, datasets: [dataset] }, settings: SCRIPTED });
    await settled();
    // The Laue class the preflight suggests, before the run: your click.
    expect(run().pause).toMatchObject({ kind: "fact", before: "run" });
    await applyFact(TRUSTED);
    await settled();
    expect(run().state).toBe("done");
    expect(status()).toMatchObject({ flatten: "fixed", report: "done" });
    expect(usePipelineStore.getState().flattenQ2).toBe(true);
    // The fix's answer, its reference filled from the seeded check.
    const fix = useChatStore.getState().turns.find((t) => t.role === "assistant" && t.content.startsWith("The floors rise"))!;
    expect(fix.content).toMatch(/^The floors rise with \|Q\| \(trend -?\d/);
    expect(fix.note).toBeUndefined();
    expect(fix.steps![0]).toMatchObject({ id: "0:seed_1", name: "assess_stage", args: { stage: "flatten" } });
    // The app's runs: what was missing or stale, then from the flatten; each logged as auto mode's.
    expect(run().steps.filter((s) => s.name === "run_pipeline").map((s) => [s.args, s.status])).toEqual([
      [{}, "done"],
      [{ from_stage: "flatten" }, "done"],
    ]);
    const ds = useDecisionStore.getState().decisions.filter((d) => run().decisions.includes(d.id));
    expect(ds.map((d) => [d.kind, d.by, d.byClick ?? false])).toEqual([
      ["fact", "you", true],
      ["run", "auto", false],
      ["setting", "auto", false],
      ["run", "auto", false],
    ]);
  }, 300_000);

  it("asks the supercell a fix proposed before the stage it holds back, and resumes from the punch once your click applies it", async () => {
    const c = devCase("dev-flatten");
    const dataset = await c.dataset();
    model.respond = (phase, round) =>
      phase.kind === "fix" && phase.stage === "flatten"
        ? fixWith("bragg-node-audit", { punchSupercellH: 2 }, "A doubled cell along H may explain it.")(round)
        : phase.kind === "fix"
          ? fixWith("reduction-qc", null, "No change would help.")(round)
          : say("Done.");
    await startAuto({ ctx: { dataset, datasets: [dataset] }, settings: SCRIPTED });
    await settled();
    expect(run().pause).toMatchObject({ kind: "fact", before: "run" });
    skipFact();
    await settled();
    // The model's change of a fact was refused; its card waits before the flatten's next step.
    expect(usePipelineStore.getState().punchSupercellH).toBe("");
    expect(run()).toMatchObject({ state: "paused", pause: { kind: "fact", before: "flatten" } });
    expect(run().facts.map((f) => [f.title, f.status])).toEqual([
      ["Laue class", "declined"],
      ["Supercell H", "open"],
    ]);
    const runsBefore = run().steps.filter((s) => s.name === "run_pipeline").length;
    await applyFact(TRUSTED);
    await settled();
    expect(usePipelineStore.getState().punchSupercellH).toBe("2");
    expect(run().state).toBe("done");
    // The run from the punch after your Apply, and every stage from it checked afresh.
    const runs = run().steps.filter((s) => s.name === "run_pipeline");
    expect(runs.slice(runsBefore).map((s) => [s.args, s.status])[0]).toEqual([{ from_stage: "punch" }, "done"]);
    expect(["punch", "backfill", "flatten", "pdf"].every((id) => !["pending", "needs you"].includes(status()[id]))).toBe(true);
    expect(run().facts.map((f) => f.status)).toEqual(["declined", "applied"]);
    // The app changed no setting itself.
    expect(run().steps.filter((s) => s.id.startsWith("auto:") && s.name === "update_settings")).toEqual([]);
  }, 300_000);
});
