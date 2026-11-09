// What the Auto panel shows of a run (auto/panel.ts) and where the chat shows
// the run's own steps (auto/transcript.ts), on made-up records: each row's
// tone and words, the progress, the clock with the paused time kept apart,
// and the blocks of the app's steps among the turns, a cleared conversation
// and a record saved before the steps' places were kept. UI only.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { clockText, currentRow, pausedText, progressOf, rowMeta, rowSub, rowTone } from "../auto/panel";
import { freshPlan, type PlanRow } from "../auto/plan";
import { newRun, type AutoRun } from "../auto/store";
import { nowLine, tuningAdoptedNothing } from "../auto/activity";
import { autoTranscript, stepElementId } from "../auto/transcript";
import type { ChatTurn } from "../chatStore";
import { pauseClock, resumeClock, startClock, stopClock } from "../clock";

const row = (id: PlanRow["id"], status: PlanRow["status"], tries = 0): PlanRow => ({ ...freshPlan().find((r) => r.id === id)!, status, tries });

const runWith = (patch: Partial<AutoRun>): AutoRun => ({
  ...newRun({ id: "A1", dataset: "d", clock: startClock(0, 30 * 60_000), limits: { minutes: 30, fixesPerStage: 2, replies: 12, costUsd: 2, fixRounds: 6, reportRounds: 4 }, snapshot: {}, costUsd: null }),
  ...patch,
});

const step = (id: string, name = "assess_stage", result = id): AgentStep => ({ id, name, args: {}, status: "done", result });

describe("a plan row", () => {
  it("has a tone by its status: done, under way, waiting for you, needing attention, muted, to do", () => {
    expect(["passed", "fixed", "done"].map((s) => rowTone(s as PlanRow["status"]))).toEqual(["done", "done", "done"]);
    expect([rowTone("running"), rowTone("fixing"), rowTone("needs you"), rowTone("stopped")]).toEqual(["now", "now", "wait", "wait"]);
    expect([rowTone("attention"), rowTone("failed"), rowTone("not judged"), rowTone("skipped"), rowTone("pending")]).toEqual(["bad", "bad", "muted", "muted", "todo"]);
  });

  it("says its state in a word, and which fix a stage is on", () => {
    expect([rowMeta(row("rings", "running")), rowMeta(row("run", "running")), rowMeta(row("report", "running")), rowMeta(row("punch", "pending"))]).toEqual(["checking", "running", "writing", ""]);
    expect(rowMeta(row("punch", "not judged"))).toBe("not judged");
    expect(rowSub(row("punch", "fixing", 1), 2)).toBe("fix 1 of 2");
    expect(rowSub(row("punch", "fixed", 1), 2)).toBe("1 fix");
    expect(rowSub(row("punch", "attention", 2), 2)).toBe("2 fixes");
    expect(rowSub(row("preflight", "pending"), 2)).toBe("coverage, rings, UB, Laue");
    expect(rowSub(row("preflight", "done"), 2)).toBeNull();
  });
});

describe("the run's progress and clock", () => {
  it("counts the finished rows and half of the one under way", () => {
    const plan = freshPlan().map((r, i) => (i < 3 ? { ...r, status: "passed" as const } : i === 3 ? { ...r, status: "fixing" as const } : r));
    expect(progressOf({ plan, at: plan[3].id, state: "running" })).toBeCloseTo(3.5 / 8);
    expect(progressOf({ plan: freshPlan().map((r) => ({ ...r, status: "done" as const })), at: null, state: "done" })).toBe(1);
  });

  it("is on the row it is in, or the last it finished", () => {
    const plan = freshPlan().map((r, i) => (i < 2 ? { ...r, status: "done" as const } : r));
    expect(currentRow(runWith({ plan, at: "rings" }))?.id).toBe("rings");
    expect(currentRow(runWith({ plan, at: null }))?.id).toBe("run");
  });

  it("reads the working time alone, never against the limit, and the time waiting for you apart with the whole time", () => {
    let c = startClock(1_000, 30 * 60_000);
    expect(clockText(c, 1_000 + 372_000)).toBe("6:12");
    expect(pausedText(c, 1_000 + 372_000)).toBeNull();
    c = pauseClock(c, 1_000 + 372_000);
    // Paused 88 s: the working time stands, the paused time and the whole time grow.
    expect(clockText(c, 1_000 + 460_000)).toBe("6:12");
    expect(pausedText(c, 1_000 + 460_000)).toBe("paused 1:28 · total 7:40");
    c = resumeClock(c, 1_000 + 460_000);
    c = stopClock(c, 1_000 + 520_000);
    expect(clockText(c, 9e9)).toBe("7:12");
    expect(pausedText(c, 9e9)).toBe("paused 1:28 · total 8:40");
  });
});

describe("the run's own steps in the chat", () => {
  const turns: ChatTurn[] = [
    { id: 1, role: "user", content: "an earlier question" },
    { id: 2, role: "assistant", content: "an earlier answer" },
    { id: 3, role: "user", content: "Auto · fix the Bragg punch, first of two" },
    { id: 4, role: "assistant", content: "fixed", steps: [{ ...step("x", "assess_stage", "a3"), id: "0:seed_1" }, step("4:1", "update_settings")] },
  ];
  const steps = [step("auto:A1:1", "qmax_coverage"), step("auto:A1:2", "run_pipeline"), step("auto:A1:3", "assess_stage", "a3"), step("4:1", "update_settings"), step("auto:A1:4", "run_pipeline"), step("auto:A1:5")];

  it("stands before the reply each led to, after the last reply what came after, and a check seeded into a reply in it", () => {
    const { blocks, where } = autoTranscript(runWith({ steps, turns: [4], turnAt: [3] }), turns);
    expect(blocks.map((b) => [b.before, b.after, b.steps.map((s) => s.id)])).toEqual([
      [3, null, ["auto:A1:1", "auto:A1:2"]],
      [null, 4, ["auto:A1:4", "auto:A1:5"]],
    ]);
    expect(where.get("auto:A1:3")).toEqual({ turn: 4, stepId: "0:seed_1" });
    expect(stepElementId(where.get("auto:A1:3")!)).toBe("ai-step-4-0:seed_1");
    expect(stepElementId(where.get("auto:A1:1")!)).toBe("ai-step-auto-auto:A1:1");
  });

  it("goes to the end when its reply is not in the chat (cleared), or the record kept no places", () => {
    const cleared = autoTranscript(runWith({ steps, turns: [4], turnAt: [3] }), turns.slice(0, 2));
    expect(cleared.blocks.map((b) => [b.before, b.after, b.steps.length])).toEqual([[null, null, 5]]);
    const old = autoTranscript(runWith({ steps, turns: [4], turnAt: [] }), turns);
    expect(old.blocks.map((b) => [b.before, b.after, b.steps.length])).toEqual([[null, null, 5]]);
  });

  it("shows nothing for a run with no steps of its own", () => {
    expect(autoTranscript(runWith({}), turns).blocks).toEqual([]);
  });
});

describe("the done run's Report ↗", () => {
  it("opens its report reply's document through the chat's own Report handler, not only the chat at it", async () => {
    const { openRunReport } = await import("../components/goToTurn");
    const opened: number[] = [];
    openRunReport(7, (turn) => opened.push(turn));
    expect(opened).toEqual([7]);
  });
});

describe("a fix whose tuning kept the current settings", () => {
  const tuned = (changes: Record<string, unknown>): AgentStep => ({
    id: "t1",
    name: "tune_pipeline",
    args: { stages: ["rings"] },
    status: "done",
    result: JSON.stringify({ minutes: 4.1, stages: [{ stage: "rings", status: "done", tuned: true, chosen_trial: changes.ringPooledSectors ? 2 : 1, of: 3, changes }] }),
    summary: "4.1 min · settings changed on 0 of 1 stages",
  });

  it("says in the Now line that the tuning adopted no change, while the fix's reply goes on", () => {
    const r = runWith({ state: "running", at: "rings", plan: freshPlan().map((x) => (x.id === "rings" ? { ...x, status: "fixing" as const, tries: 1 } : x)) });
    const input = (steps: AgentStep[]) => ({ run: r, live: null, turns: [], replying: true, replySteps: steps, decisions: [], proposals: [], tune: { active: false, stages: [] } });
    expect(nowLine(input([tuned({})]))).toBe("Fixing the ring removal, try 1 of 2: the tuning adopted no change");
    expect(nowLine(input([tuned({ ringPooledSectors: 48 })]))).toBe("Fixing the ring removal, try 1 of 2");
    expect(nowLine(input([]))).toBe("Fixing the ring removal, try 1 of 2");
    expect([tuningAdoptedNothing(tuned({})), tuningAdoptedNothing(tuned({ ringPooledSectors: 48 }))]).toEqual([true, false]);
  });
});
