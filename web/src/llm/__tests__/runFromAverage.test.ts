// A run from a stage with the symmetry average on (THY-81): the average's
// output comes before every stage a run starts from, and a change to what it
// reads (the raw input's edge trim, the Laue class) leaves it stale. A run
// from the ring removal took the stages from the ring removal alone, so the
// ring removal read that stale average: the Pilot's rerun_from, a Run card
// and the cards' Apply all started there. Now a run from a stage, with the
// average on, takes every enabled stage and recomputes those from its stage
// on; the backend's resume rule makes the average again when its record says
// it no longer follows, and reuses it otherwise. A card's Run after a change
// to what the average reads starts from the average itself. With the average
// off, nothing changes. The native path, with the server's run request and
// its progress stream faked. Synthetic only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { useDatasetStore } from "../../state/datasetStore";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { applyCard, applyOnClick, offerRun } from "../apply/actions";
import { addProposals, clearDecisions, useDecisionStore } from "../apply/decisions";
import { buildProposals, type Proposal } from "../apply/proposals";
import { useChatStore } from "../chatStore";
import { callTool, CHAT_TOOLS, toolsWithSkills, type ToolContext } from "../tools";

const DATASET = { id: "demo", stem: "demo", stages: [] } as unknown as Dataset;
const ctx: ToolContext = { dataset: DATASET, datasets: [DATASET] };
const TRUSTED = { isTrusted: true };
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

const averaging = () => usePipelineStore.setState({ symmetryAverageEnabled: true, symmetryLaue: "m-3m" });
const ALL = ["symmetry_average", "rings", "punch", "backfill", "flatten", "pdf", "pdf_check"];
const FROM_RINGS = ALL.slice(1);
const state = () => useDecisionStore.getState();
const runCard = (): Proposal | undefined => state().proposals.find((p) => p.kind === "run" && p.status === "open");

const step = (name: string, args: Record<string, unknown>, result: unknown, id = name, status: AgentStep["status"] = "done"): AgentStep => ({
  id,
  name,
  args,
  status,
  summary: `${name} line`,
  result: typeof result === "string" ? result : JSON.stringify(result),
});
const propose = (steps: AgentStep[]): Proposal[] => {
  const ps = buildProposals({ turn: 2, steps, answer: "", config: usePipelineStore.getState(), dataset: "demo", firstId: 1 + state().proposals.length });
  addProposals(ps);
  return ps;
};

// ---------------------------------------------------------------- the Pilot's run

describe("run_pipeline from a stage, with the symmetry average on", () => {
  it("asks for the average too: every stage recomputed from the ring removal on, the average by its record", async () => {
    averaging();
    const r = await runPipeline({ from_stage: "rings" });
    expect(r.ok, r.text).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ stages: ALL, force: false, force_from: "rings" });
  });

  it("names the average in its result where the run made it again, and not where it reused it", async () => {
    averaging();
    const made = JSON.parse((await runPipeline({ from_stage: "rings" })).text) as { stages: Record<string, string> };
    expect(made.stages).toEqual({ symmetry_average: "computed", rings: "computed", punch: "computed", backfill: "computed", flatten: "computed", pdf: "computed", pdf_check: "computed" });
    plays = { symmetry_average: "reused" };
    const reused = JSON.parse((await runPipeline({ from_stage: "rings" })).text) as { stages: Record<string, string>; log_tail: string[] };
    expect(reused.stages).toEqual({ rings: "computed", punch: "computed", backfill: "computed", flatten: "computed", pdf: "computed", pdf_check: "computed" });
    expect(reused.log_tail.join(" ")).not.toMatch(/symmetry_average exists/);
  });

  it("from a later stage, the stages before it are reused while they follow, and named only where made again", async () => {
    averaging();
    plays = { symmetry_average: "reused", rings: "reused" };
    const r = JSON.parse((await runPipeline({ from_stage: "punch" })).text) as { stages: Record<string, string> };
    expect(requests[0]).toMatchObject({ stages: ALL, force: false, force_from: "punch" });
    expect(Object.keys(r.stages)).toEqual(["punch", "backfill", "flatten", "pdf", "pdf_check"]);
  });

  it("with the average off, the run from a stage is as it was: its stages alone, forced", async () => {
    await runPipeline({ from_stage: "rings" });
    expect(requests[0]).toMatchObject({ stages: FROM_RINGS, force: true });
    expect(requests[0]).not.toHaveProperty("force_from");
    await runPipeline({});
    expect(requests[1]).toMatchObject({ stages: FROM_RINGS, force: false });
    expect(requests[1]).not.toHaveProperty("force_from");
  });

  it("the Run button's run is unchanged with the average on: every stage, by the records", async () => {
    averaging();
    await runPipeline({});
    expect(requests[0]).toMatchObject({ stages: ALL, force: false });
    expect(requests[0]).not.toHaveProperty("force_from");
  });
});

// ---------------------------------------------------------------- the cards

describe("an Apply card's Run, with the symmetry average on", () => {
  it("after the edge trim, the card's Run starts at the symmetry average and recomputes it", async () => {
    averaging();
    const [trim] = propose([step("update_settings", { changes: { edgeTrim: 2 } }, "Error: refused", "u1", "error")]);
    expect(trim.runFrom).toBe("symmetry_average");
    await applyOnClick(trim, ctx, TRUSTED);
    expect(usePipelineStore.getState().edgeTrim).toBe("2");
    const run = runCard()!;
    expect(run).toMatchObject({ runFrom: "symmetry_average", title: "Run from Symmetry average" });
    const applied = applyCard(run, ctx);
    await serve();
    await applied;
    expect(requests[0]).toMatchObject({ stages: ALL, force: false, force_from: "symmetry_average" });
    expect(state().decisions[state().decisions.length - 1]).toMatchObject({ kind: "run", action: "apply", runFrom: "symmetry_average" });
  });

  it("after a Laue class, a Run card from the symmetry average, which declaring the class switches on", async () => {
    const laue = () => propose([step("compare_laue_classes", {}, { suggestion: "m-3m", classes: [], flag: null })])[0];
    expect(usePipelineStore.getState().symmetryAverageEnabled).toBe(false);
    await applyOnClick(laue(), ctx, TRUSTED);
    expect(usePipelineStore.getState()).toMatchObject({ symmetryAverageEnabled: true, symmetryLaue: "m-3m" });
    expect(runCard()).toMatchObject({ runFrom: "symmetry_average", title: "Run from Symmetry average" });
  });

  it("an open Run card from a later stage gives way to the symmetry average", async () => {
    averaging();
    offerRun(2, "demo", "punch", "Punch min σ 5 → 6");
    const [trim] = propose([step("update_settings", { changes: { edgeTrim: 0 } }, "Error: refused", "u2", "error")]);
    await applyOnClick(trim, ctx, TRUSTED);
    expect(state().proposals.filter((p) => p.kind === "run" && p.status === "open")).toHaveLength(1);
    expect(runCard()).toMatchObject({ runFrom: "symmetry_average", title: "Run from Symmetry average", shown: { to: "Punch min σ 5 → 6; Edge trim 1 → 0" } });
  });

  it("the Pilot changing the edge trim the user named: its rerun_from stays the ring removal, its Run card starts at the average", async () => {
    averaging();
    const pilot = { ...ctx, skills: false, skillsRead: new Set<string>(), userMessage: "Set the edge trim to 2.", replySteps: [] };
    const r = await callTool(pilot, "update_settings", { changes: { edgeTrim: 2 } }, { tools: offered });
    expect(r.ok, r.text).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ changed: [{ setting: "edgeTrim", from: 1, to: 2 }], rerun_from: "rings" });
    const [card] = propose([step("update_settings", { changes: { edgeTrim: 2 } }, JSON.parse(r.text))]);
    expect(card).toMatchObject({ kind: "run", runFrom: "symmetry_average", title: "Run from Symmetry average" });
  });

  it("with the average off, the edge trim's Run card starts at the ring removal, as before", async () => {
    const [trim] = propose([step("update_settings", { changes: { edgeTrim: 2 } }, "Error: refused", "u1", "error")]);
    expect(trim.runFrom).toBe("rings");
    await applyOnClick(trim, ctx, TRUSTED);
    const run = runCard()!;
    expect(run).toMatchObject({ runFrom: "rings", title: "Run from Ring removal" });
    const applied = applyCard(run, ctx);
    await serve();
    await applied;
    expect(requests[0]).toMatchObject({ stages: FROM_RINGS, force: true });
  });

  it("switching the average off: a Run card from the ring removal, which then reads the raw input", async () => {
    averaging();
    const [off] = propose([step("update_settings", { changes: { symmetryAverageEnabled: false } }, "Error: refused", "u1", "error")]);
    await applyOnClick(off, ctx, TRUSTED);
    expect(usePipelineStore.getState().symmetryAverageEnabled).toBe(false);
    expect(runCard()).toMatchObject({ runFrom: "rings" });
  });
});
