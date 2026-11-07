// The B-auto arm's run (runAutoCase, validationAuto.ts) as the live runner
// makes it, with a scripted model in place of the real one and the real
// pipeline and tools on a dev case through the CPython bridge (devData/). On
// dev-flatten: the preflight's Laue class and a supercell a fix proposes are
// both skipped, so no fact changes; the flatten's fix is the model's own
// change, run and checked by the app; the report's words are the run's
// conclusion, graded as arm B's. A second run reads nothing the first left.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePipelineStore } from "../../state/pipelineStore";
import { fixWith, model, say, scriptedStream } from "../__tests__/autoHarness";
import { useAutoStore } from "../auto/store";
import { useChatStore } from "../chatStore";
import { devCase } from "./devData";
import { caseNamed } from "./validation";
import { AUTO_TASK, runAutoCase } from "./validationAuto";

const stream = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: stream.fn,
}));

const SETTINGS = { baseUrl: "http://scripted.invalid/v1", model: "scripted", apiKey: "", temperature: 0 };
const MODEL = { key: "scripted", label: "a scripted model", provider: "scripted", model: "scripted", local: false };

beforeEach(() => {
  stream.fn.mockImplementation(scriptedStream);
  model.sent = [];
  model.usage = null;
});

describe("the B-auto arm on dev-flatten, through the real pipeline", () => {
  it("runs the case through auto mode, skips every fact, and records the run as arm B's with its auto part", async () => {
    const c = devCase("dev-flatten");
    const dataset = await c.dataset();
    model.respond = (phase, round) =>
      phase.kind === "fix" && phase.stage === "flatten"
        ? fixWith("reduction-qc", { flattenQ2: true }, "The floors rose with |Q|, so I turned on the Q² term, flattenQ2.")(round)
        : phase.kind === "fix"
          ? fixWith("bragg-node-audit", { punchSupercellH: 2 }, "A doubled cell along H may explain it.")(round)
          : say("A |Q|-dependent background was found and removed: the flatten needed its Q² term. No other problem was found.");
    const record = await runAutoCase({ job: { case: caseNamed("dev-flatten")!, arm: "B", run: 1 }, dataset, model: MODEL, settings: SETTINGS, rounds: 12, minutes: 5 });
    expect(record).toMatchObject({ mode: "auto", arm: "B", case: "dev-flatten", task: AUTO_TASK, error: null });
    expect(record.auto).toMatchObject({ state: "done", timed_out: false, fact_changes: [], holds: true });
    // The Laue class asked before the run, skipped: no fact changed.
    expect(record.auto.facts_skipped.length).toBeGreaterThanOrEqual(1);
    expect(usePipelineStore.getState().punchSupercellH).toBe("");
    expect(record.auto.plan.find((r) => r.row === "flatten")).toMatchObject({ status: "fixed", tries: 1 });
    // The conclusion is the report's words, and they are graded.
    expect(record.conclusion).toMatch(/^A \|Q\|-dependent background was found/);
    expect(record.grades.unsafe).toEqual([]);
    expect(record.decisions.some((d) => d.tool === "run_pipeline")).toBe(true);
    expect(record.auto.answers.map((a) => a.reply)).toEqual(expect.arrayContaining(["Auto · the report"]));
  }, 300_000);

  it("starts the next run fresh: no chat, no cards, no auto run, the defaults", async () => {
    const c = devCase("dev-control");
    const dataset = await c.dataset();
    usePipelineStore.getState().patch({ flattenQ2: true });
    model.respond = (phase, round) => (phase.kind === "fix" ? fixWith("reduction-qc", null, "No change would help.")(round) : say("No problem was found."));
    const record = await runAutoCase({ job: { case: caseNamed("dev-control")!, arm: "B", run: 1 }, dataset, model: MODEL, settings: SETTINGS, rounds: 12, minutes: 5 });
    expect(record.auto.state).toBe("done");
    expect(usePipelineStore.getState().flattenQ2).toBe(usePipelineStore.getInitialState().flattenQ2);
    expect(useChatStore.getState().turns.filter((t) => t.role === "user").every((t) => t.content.startsWith("Auto ·"))).toBe(true);
    expect(useAutoStore.getState().run?.dataset).toBe(dataset.id);
    expect(record.decisions.some((d) => d.tool === "update_settings")).toBe(false);
  }, 300_000);
});
