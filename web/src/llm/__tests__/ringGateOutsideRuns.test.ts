// The ring gate and runs outside the conversation (THY-81). The gate takes
// the newest 3D ring verdict on the outputs as they now are, and read only
// the conversation's steps: a run the conversation made (run_pipeline) that
// recomputed the rings made an earlier verdict stale, but one from a Run
// card, the Configure or Execution page, or outside the console did not, so a
// ring change passed the gate on a verdict about outputs no longer there.
// Now a verdict keeps a mark of the ring output it judged
// (state/ringOutput.ts): any run that recomputes the ring stage, from any
// source, makes it stale, as the stage records make an output stale once its
// input is written again. A run that reuses the rings leaves it standing. A
// card's own ring check takes the same mark. The native path, with the
// server's run request and its progress stream faked; the stage's numbers
// stubbed. Synthetic only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, StageStatus } from "../../api/types";
import { useDatasetStore } from "../../state/datasetStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { ringOutputChanged, ringOutputMark } from "../../state/ringOutput";
import { toolStepsIn, type AgentStep } from "../agent";
import { checkRings, currentRingCheck, ringHeldNow } from "../apply/actions";
import { addProposals, clearDecisions, useDecisionStore } from "../apply/decisions";
import { buildProposals, type Proposal } from "../apply/proposals";
import { useChatStore } from "../chatStore";
import { callTool, CHAT_TOOLS, toolsWithSkills, type ToolContext } from "../tools";
import { ringEvidenceRefusal, ringVerdictAllowsChange } from "../tools/shared/ringGate";

// The ring stage's numbers as assess_stage reads them: a ring left at 2.17 Å⁻¹.
const RING_LEFT = { max_ring_left: 0.42, max_ring_dent: 0, mean_ring_energy_ratio: 0.95, max_over_subtraction_fraction: 0, worst_ring_left: { at: 2.17, residual_fraction: 0.42 } };
vi.mock("../tune/evaluate", async (original) => ({
  ...(await original<typeof import("../tune/evaluate")>()),
  evaluateStage: vi.fn(async () => ({ ...RING_LEFT })),
}));

const listed = (mtime: number | null): Dataset =>
  ({
    id: "demo",
    stem: "demo",
    stages: [{ name: "ringremoved", exists: mtime !== null, kind: "hkl", volume_id: "demo.ringremoved", mtime } satisfies StageStatus],
  }) as unknown as Dataset;
const offered = toolsWithSkills(CHAT_TOOLS, false);
/** The Pilot's context in a reply: skills off, the user's message naming nothing, the conversation's steps. */
const pilot = (dataset: Dataset, earlierSteps: AgentStep[], replySteps: AgentStep[] = []): ToolContext => ({
  dataset,
  datasets: [dataset],
  skills: false,
  skillsRead: new Set<string>(),
  userMessage: "Is the ring removal clean?",
  earlierSteps,
  replySteps,
});

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
let runs = 0;

beforeEach(() => {
  FakeSource.all = [];
  runs = 0;
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/pipeline/run") {
        runs += 1;
        return new Response(JSON.stringify({ id: `j${runs}`, input: "demo.nxs", status: "running", error: null, n_events: 0 }));
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

/** The Execution page's Run again (the Run button's run): its stream, the ring stage computed or reused, then its end. */
async function executionPageRun(rings: "computed" | "reused"): Promise<void> {
  void usePipelineStore.getState().run();
  await vi.waitFor(() => expect(FakeSource.all).toHaveLength(runs || 1));
  const source = FakeSource.all[FakeSource.all.length - 1];
  if (rings === "computed") {
    source.send({ type: "progress", stage: "rings", status: "start", message: "rings start" });
    source.send({ type: "progress", stage: "rings", status: "done", message: "rings done" });
  } else {
    source.send({ type: "progress", stage: "rings", status: "skip", message: "demo_ringremoved.h5 exists" });
  }
  source.send({ type: "progress", stage: "punch", status: "done", message: "punch done" });
  source.send({ type: "done" });
  await vi.waitFor(() => expect(usePipelineStore.getState().running).toBe(false));
}

/** A ring verdict of the conversation: assess_stage's rings, as the app runs it, finding a ring left. */
async function ringVerdict(dataset: Dataset): Promise<AgentStep> {
  const run = await callTool(pilot(dataset, []), "assess_stage", { stage: "rings" }, { tools: offered });
  expect(run.ok, run.text).toBe(true);
  return { id: "0:assess", name: "assess_stage", args: { stage: "rings" }, status: "done", summary: run.summary, result: run.text, outcomes: run.outcomes };
}

const changeRingModel = (ctx: ToolContext) => callTool(ctx, "update_settings", { changes: { ringModel: "parametric" } }, { tools: offered });

// ---------------------------------------------------------------- the conversation's verdict

describe("a ring verdict in the conversation, then a run outside it", () => {
  it("a run from the Execution page that recomputes the rings makes it stale: the ring change is refused", async () => {
    const verdict = await ringVerdict(listed(100));
    expect(verdict.outcomes?.find((o) => o.check === "rings")).toMatchObject({ kind: "attention", ringOutput: { dataset: "demo", written: 100 } });
    // While it stands, the change goes.
    expect(ringVerdictAllowsChange(pilot(listed(100), [verdict]))).toBe(true);
    await executionPageRun("computed");
    // The listing not read again yet: the console's own run says it.
    expect(ringVerdictAllowsChange(pilot(listed(100), [verdict]))).toBe(false);
    const refused = await changeRingModel(pilot(listed(100), [verdict]));
    expect(refused.ok).toBe(false);
    expect(refused.text).toBe(`Error: ${ringEvidenceRefusal("ringModel")}`);
    expect(usePipelineStore.getState().ringModel).toBe("pooled");
    // A new verdict on the outputs as they now are opens it again.
    const again = await ringVerdict(listed(200));
    expect((await changeRingModel(pilot(listed(200), [verdict, again]))).ok).toBe(true);
    expect(usePipelineStore.getState().ringModel).toBe("parametric");
  });

  it("a verdict of an earlier reply, as the transcript keeps it (its outcomes dropped): stale the same way", async () => {
    const verdict = await ringVerdict(listed(100));
    useChatStore.getState().addTurn({ role: "assistant", content: "A ring is left.", steps: [verdict] });
    const earlier = toolStepsIn(useChatStore.getState().turns);
    expect(earlier[0].outcomes).toBeUndefined();
    expect(earlier[0].ringOutput).toMatchObject({ dataset: "demo", written: 100 });
    expect(ringVerdictAllowsChange(pilot(listed(100), earlier))).toBe(true);
    await executionPageRun("computed");
    const refused = await changeRingModel(pilot(listed(100), toolStepsIn(useChatStore.getState().turns)));
    expect(refused.text).toBe(`Error: ${ringEvidenceRefusal("ringModel")}`);
    expect(ringVerdictAllowsChange(pilot(listed(300), earlier))).toBe(false);
  });

  it("a run outside the console that wrote the ring output again: the listing's date says it", async () => {
    const verdict = await ringVerdict(listed(100));
    expect((await changeRingModel(pilot(listed(250), [verdict]))).ok).toBe(false);
    expect(ringVerdictAllowsChange(pilot(listed(null), [verdict]))).toBe(false); // the output is gone
    expect(ringVerdictAllowsChange({ ...pilot(listed(100), [verdict]), dataset: { ...listed(100), id: "other" } })).toBe(false);
  });

  it("a tuning of the rings is held the same way", async () => {
    const verdict = await ringVerdict(listed(100));
    await executionPageRun("computed");
    const t = await callTool(pilot(listed(100), [verdict]), "tune_pipeline", { stages: ["rings"] }, { tools: offered });
    expect(t.ok).toBe(false);
    expect(t.text).toBe(`Error: ${ringEvidenceRefusal("A tuning of the powder-ring subtraction")}`);
  });

  it("a run that reused the rings leaves it standing, as one in the conversation does", async () => {
    const verdict = await ringVerdict(listed(100));
    await executionPageRun("reused");
    expect(ringVerdictAllowsChange(pilot(listed(100), [verdict]))).toBe(true);
    expect((await changeRingModel(pilot(listed(100), [verdict]))).ok).toBe(true);
  });

  it("a run going now: the outputs are being made again", async () => {
    const verdict = await ringVerdict(listed(100));
    void usePipelineStore.getState().run();
    await vi.waitFor(() => expect(FakeSource.all).toHaveLength(1));
    expect(ringVerdictAllowsChange(pilot(listed(100), [verdict]))).toBe(false);
    FakeSource.all[0].send({ type: "done" });
  });

  it("a tuning trial writes into its own folder: it leaves the dataset's ring output alone", async () => {
    const mark = ringOutputMark(listed(100));
    void usePipelineStore.getState().runStages(["rings"], { datasetId: "demo", tuning: { run_id: "t1", trial: "rings-2" } });
    await vi.waitFor(() => expect(FakeSource.all).toHaveLength(1));
    FakeSource.all[0].send({ type: "progress", stage: "rings", status: "done", message: "rings done" });
    FakeSource.all[0].send({ type: "done" });
    await vi.waitFor(() => expect(usePipelineStore.getState().running).toBe(false));
    expect(ringOutputChanged(mark, listed(100))).toBe(false);
  });
});

// ---------------------------------------------------------------- a card's own check

describe("a card's ring check, then a run outside the conversation", () => {
  const ringCard = (): Proposal => {
    const ps = buildProposals({
      turn: 2,
      steps: [{ id: "u1", name: "update_settings", args: { changes: { ringModel: "parametric" } }, status: "error", summary: "", result: "Error: ringModel waits for a 3D verdict that a powder ring is left or dented" }],
      answer: "",
      config: usePipelineStore.getState(),
      dataset: "demo",
      firstId: 1,
    });
    addProposals(ps);
    return ps[0];
  };
  const card = (dataset: Dataset): ToolContext => ({ dataset, datasets: [dataset] });

  it("takes the same mark: written again outside the console, the check is stale and the card held again", async () => {
    const p = ringCard();
    await checkRings(p, card(listed(100)));
    expect(useDecisionStore.getState().ringChecks[p.id].ringOutput).toEqual({ dataset: "demo", written: 100, runs: expect.any(Number) });
    expect(currentRingCheck(p, listed(100))).toBeDefined();
    expect(ringHeldNow(p, card(listed(100)))).toBe(false);
    expect(currentRingCheck(p, listed(300))).toBeUndefined();
    expect(ringHeldNow(p, card(listed(300)))).toBe(true);
  });

  it("a run from the Execution page that recomputes the rings: stale, the card held again", async () => {
    const p = ringCard();
    await checkRings(p, card(listed(100)));
    expect(ringHeldNow(p, card(listed(100)))).toBe(false);
    await executionPageRun("computed");
    expect(currentRingCheck(p, listed(100))).toBeUndefined();
    expect(ringHeldNow(p, card(listed(100)))).toBe(true);
  });
});
