// A run from a stage with the symmetry average off: the stages before it are
// remade when their records say they no longer follow, as THY-81 made them
// with the average on. A run from the Bragg punch asked for the stages from
// the punch alone, forced, so after a change to a ring setting the punch read
// the ring removal's output as it was on disk, stale: the Pilot's rerun_from,
// a Run card and the cards' Apply all started there. Now a run from a stage
// takes every enabled stage and recomputes those from its stage on
// (force_from); the backend's resume rule makes an earlier stage again when
// its record says it no longer follows from its input and settings, or it is
// missing, with every stage after it, and reuses it otherwise. A run from the
// first enabled stage has none before it, and is asked for as it always was.
// The native path, with the server's run request and its progress stream
// faked. Synthetic only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { useDatasetStore } from "../../state/datasetStore";
import { runFrom, usePipelineStore } from "../../state/pipelineStore";
import { ringOutputChanged, ringOutputMark } from "../../state/ringOutput";
import { applyCard, offerRun } from "../apply/actions";
import { addProposals, clearDecisions, useDecisionStore } from "../apply/decisions";
import { buildProposals, type Proposal } from "../apply/proposals";
import { useChatStore } from "../chatStore";
import { callTool, CHAT_TOOLS, toolsWithSkills, type ToolContext } from "../tools";

const DATASET = { id: "demo", stem: "demo", stages: [] } as unknown as Dataset;
const ctx: ToolContext = { dataset: DATASET, datasets: [DATASET] };
const offered = toolsWithSkills(CHAT_TOOLS, false);

// ---------------------------------------------------------------- the server, faked

class FakeSource {
  static all: FakeSource[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSource.all.push(this);
  }
  close() {}
  send(ev: object) {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }
}

/** Each run request's body, as the console sent it. */
let requests: Record<string, unknown>[] = [];
/** What each run's stream says, stage by stage: "computed" (start, done) or "reused" (skip). */
let plays: Record<string, "computed" | "reused">;

beforeEach(() => {
  FakeSource.all = [];
  requests = [];
  plays = {};
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url === "/api/pipeline/run") {
        requests.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
        return new Response(JSON.stringify({ id: `j${requests.length}`, input: "demo.nxs", status: "running", error: null, n_events: 0 }));
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
  usePipelineStore.setState(usePipelineStore.getInitialState(), true);
  useDatasetStore.getState().setDataset("demo");
  useChatStore.setState({ turns: [], busy: false });
  clearDecisions();
});
afterEach(() => vi.unstubAllGlobals());

/** Play the run the console asked for: each stage it asked for as `plays` says (computed unless named), then its end. */
async function serve(): Promise<void> {
  await vi.waitFor(() => expect(FakeSource.all).toHaveLength(requests.length));
  const source = FakeSource.all[requests.length - 1];
  for (const stage of requests[requests.length - 1].stages as string[]) {
    if (plays[stage] === "reused") source.send({ type: "progress", stage, status: "skip", message: `${stage} exists` });
    else {
      if (stage === "rings") source.send({ type: "progress", stage, status: "progress", message: "demo_ringremoved.h5 stale — recomputing" });
      source.send({ type: "progress", stage, status: "start", message: `${stage} start` });
      source.send({ type: "progress", stage, status: "done", message: `${stage} done` });
    }
  }
  source.send({ type: "done" });
}

/** run_pipeline as the model calls it, served. */
async function runPipeline(args: Record<string, unknown>) {
  const run = callTool(ctx, "run_pipeline", args, { tools: offered });
  await serve();
  return run;
}

// The stages switched on by default: the average off.
const ENABLED = ["rings", "punch", "backfill", "flatten", "pdf", "pdf_check"];
const FROM_PUNCH = ENABLED.slice(1);
const state = () => useDecisionStore.getState();
const runCard = (): Proposal | undefined => state().proposals.find((p) => p.kind === "run" && p.status === "open");

const propose = (answer: string): Proposal[] => {
  const ps = buildProposals({ turn: 2, steps: [], answer, config: usePipelineStore.getState(), dataset: "demo", firstId: 1 + state().proposals.length });
  addProposals(ps);
  return ps;
};

// ---------------------------------------------------------------- the rule

describe("runFrom with the symmetry average off", () => {
  it("takes every enabled stage, recomputed from the stage on, the stages before it by their records", () => {
    const s = usePipelineStore.getState();
    expect(s.symmetryAverageEnabled).toBe(false);
    expect(runFrom(s, "punch")).toEqual({ stages: ENABLED, force: false, forceFrom: "punch" });
    expect(runFrom(s, "pdf")).toEqual({ stages: ENABLED, force: false, forceFrom: "pdf" });
  });

  it("from the first enabled stage, none before it: the run as it was asked for before", () => {
    const s = usePipelineStore.getState();
    expect(runFrom(s, "rings")).toEqual({ stages: ENABLED, force: true });
    const ringsOff = { ...s, ringsEnabled: false };
    expect(runFrom(ringsOff, "punch")).toEqual({ stages: FROM_PUNCH, force: true });
    // A stage switched off before `from` is no part of the run.
    expect(runFrom(ringsOff, "flatten")).toEqual({ stages: FROM_PUNCH, force: false, forceFrom: "flatten" });
  });

  it("the Run button's run is unchanged: every enabled stage, by the records unless Force is on", () => {
    const s = usePipelineStore.getState();
    expect(runFrom(s, null)).toEqual({ stages: ENABLED, force: false });
    expect(runFrom({ ...s, force: true }, null)).toEqual({ stages: ENABLED, force: true });
  });
});

// ---------------------------------------------------------------- the Pilot's run

describe("run_pipeline from the punch, with the symmetry average off", () => {
  it("asks for the ring removal too: every stage from the punch recomputed, the rings by their record", async () => {
    const r = await runPipeline({ from_stage: "punch" });
    expect(r.ok, r.text).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ stages: ENABLED, force: false, force_from: "punch" });
    expect(usePipelineStore.getState().lastRun).toMatchObject({ stages: ENABLED, force: false, forceFrom: "punch" });
  });

  it("names the ring removal in its result where the run made it again, stale, and not where it reused it", async () => {
    const made = JSON.parse((await runPipeline({ from_stage: "punch" })).text) as { stages: Record<string, string>; log_tail: string[] };
    expect(made.stages).toEqual({ rings: "computed", punch: "computed", backfill: "computed", flatten: "computed", pdf: "computed", pdf_check: "computed" });
    plays = { rings: "reused" };
    const reused = JSON.parse((await runPipeline({ from_stage: "punch" })).text) as { stages: Record<string, string>; log_tail: string[] };
    expect(reused.stages).toEqual({ punch: "computed", backfill: "computed", flatten: "computed", pdf: "computed", pdf_check: "computed" });
    expect(reused.log_tail.join(" ")).not.toMatch(/rings exists/);
  });

  it("from a later stage, every stage before it is reused while it follows, and named only where made again", async () => {
    plays = { rings: "reused", punch: "reused", backfill: "computed" };
    const r = JSON.parse((await runPipeline({ from_stage: "flatten" })).text) as { stages: Record<string, string> };
    expect(requests[0]).toMatchObject({ stages: ENABLED, force: false, force_from: "flatten" });
    expect(r.stages).toEqual({ backfill: "computed", flatten: "computed", pdf: "computed", pdf_check: "computed" });
  });

  it("from the ring removal, the first enabled stage, the run is as it was: its stages, forced", async () => {
    await runPipeline({ from_stage: "rings" });
    expect(requests[0]).toMatchObject({ stages: ENABLED, force: true });
    expect(requests[0]).not.toHaveProperty("force_from");
  });
});

// ---------------------------------------------------------------- the ring verdicts

describe("a ring verdict, after a run from the punch with the average off", () => {
  it("goes stale when the run made the ring removal again, and stands when it reused it", async () => {
    const judged = ringOutputMark(DATASET);
    plays = { rings: "reused" };
    await runPipeline({ from_stage: "punch" });
    expect(ringOutputChanged(judged)).toBe(false);
    plays = {};
    await runPipeline({ from_stage: "punch" });
    expect(ringOutputChanged(judged)).toBe(true);
  });
});

// ---------------------------------------------------------------- the cards

describe("an Apply card's Run, with the symmetry average off", () => {
  it("a Run card from the punch asks for the ring removal too, by its record", async () => {
    offerRun(2, "demo", "punch", "Punch min σ 5 → 6");
    const run = runCard()!;
    expect(run).toMatchObject({ runFrom: "punch", title: "Run from Bragg punch" });
    plays = { rings: "reused" };
    const ran = applyCard(run, ctx);
    await serve();
    await ran;
    expect(requests[0]).toMatchObject({ stages: ENABLED, force: false, force_from: "punch" });
    expect(state().decisions[state().decisions.length - 1]).toMatchObject({ kind: "run", action: "apply", runFrom: "punch" });
  });

  it("after a punch setting applied, the card's Run starts at the punch and asks for the ring removal by its record", async () => {
    const [sig] = propose("Try punchMinSig 6.");
    await applyCard(sig, ctx);
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
    const run = runCard()!;
    expect(run).toMatchObject({ runFrom: "punch", title: "Run from Bragg punch" });
    const ran = applyCard(run, ctx);
    await serve();
    await ran;
    expect(requests[0]).toMatchObject({ stages: ENABLED, force: false, force_from: "punch" });
  });
});
