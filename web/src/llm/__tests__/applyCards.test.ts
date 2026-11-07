// What the Apply cards do (apply/actions.ts) and the record they keep
// (apply/decisions.ts): Apply through update_settings and run_pipeline, the
// Run card that follows a change, Dismiss, Undo and "changed since", a card
// gone stale, the guards that refuse a card exactly as they refuse the model
// (the sample facts, the ring gate), the report's lines, and a saved record
// read back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { useAgentEdits } from "../../state/agentEdits";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { applyCard, cardState, decisionLine, dismissCard, HELD_NOTE, offerRun, reportDecisions, undoAll, undoDecision } from "../apply/actions";
import { addProposals, clearDecisions, readDecisions, useDecisionStore } from "../apply/decisions";
import { buildProposals, type Proposal } from "../apply/proposals";
import { useChatStore } from "../chatStore";
import { CHAT_TOOLS, type ToolContext } from "../tools";

const DATASET = { id: "demo", stem: "demo", stages: [] } as unknown as Dataset;
const ctx: ToolContext = { dataset: DATASET, datasets: [DATASET] };

const propose = (answer: string, steps: AgentStep[] = []): Proposal[] => {
  const ps = buildProposals({ turn: 2, steps, answer, config: usePipelineStore.getState(), dataset: "demo", firstId: 1 + useDecisionStore.getState().proposals.length });
  addProposals(ps);
  return ps;
};
const state = () => useDecisionStore.getState();
const proposal = (id: string) => state().proposals.find((p) => p.id === id)!;

beforeEach(() => {
  usePipelineStore.setState({ ...usePipelineStore.getInitialState(), running: false });
  useChatStore.setState({ turns: [], busy: false });
  useAgentEdits.setState({ last: null, shown: 0 });
  clearDecisions();
});
afterEach(() => vi.restoreAllMocks());

describe("Apply on a setting card", () => {
  it("sets it through update_settings, lights it on Configure, logs it, and offers a Run card", async () => {
    const [p] = propose("Try punchMinSig 6.");
    expect(cardState(p, "demo", ctx, false)).toEqual({ can: true });
    await applyCard(p, ctx);
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
    expect(useAgentEdits.getState().last?.fields).toEqual(["punchMinSig"]);
    expect(proposal(p.id).status).toBe("applied");
    const [d] = state().decisions;
    expect(d).toMatchObject({ proposal: p.id, action: "apply", by: "you", before: { punchMinSig: "" }, after: { punchMinSig: "6" }, runFrom: "punch" });
    const run = state().proposals.find((x) => x.kind === "run")!;
    expect(run).toMatchObject({ status: "open", runFrom: "punch", title: "Run from Bragg punch", shown: { to: "Punch min σ 5 → 6" }, turn: 2 });
  });

  it("with Edit, sets the edited value, still checked by the catalog", async () => {
    const [p] = propose("Try punchMinSig 6.");
    await applyCard(p, ctx, { punchMinSig: "99" });
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    expect(state().notes[p.id]).toMatch(/^Not applied: punchMinSig must be within/);
    await applyCard(p, ctx, { punchMinSig: "7" });
    expect(usePipelineStore.getState().punchMinSig).toBe("7");
    expect(state().decisions[0]).toMatchObject({ action: "edit-apply", shown: { from: "5", to: "7" } });
  });

  it("keeps one Run card per dataset, from the earliest stage a change calls for", () => {
    offerRun(2, "demo", "punch", "Punch min σ 5 → 6");
    offerRun(3, "demo", "rings", "ringPooledSectors 24 → 32");
    const runs = state().proposals.filter((p) => p.kind === "run");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runFrom: "rings", title: "Run from Ring removal", turn: 3, shown: { to: "Punch min σ 5 → 6; ringPooledSectors 24 → 32" } });
  });

  it("is off on a card gone stale: the settings moved, or another dataset is open", async () => {
    const [p] = propose("Try punchMinSig 6.");
    usePipelineStore.getState().patch({ punchMinSig: "7" });
    expect(cardState(p, "demo", ctx, false)).toEqual({ can: false, why: "Stale: the settings changed since." });
    await applyCard(p, ctx);
    expect(usePipelineStore.getState().punchMinSig).toBe("7");
    expect(state().decisions).toEqual([]);
    usePipelineStore.getState().patch({ punchMinSig: "" });
    expect(cardState(p, "other", ctx, false)).toEqual({ can: false, why: "Stale: another dataset is open." });
    expect(cardState(p, "demo", ctx, true)).toEqual({ can: false, why: "Wait for the reply to end." });
  });
});

describe("the guards refuse a card exactly as they refuse the model", () => {
  it("a sample fact: the card is held, and even a card without the hold cannot set it", async () => {
    const [p] = propose("Try punchSupercellL = 2.");
    expect(p.held).toBe("fact");
    expect(cardState(p, "demo", ctx, false)).toEqual({ can: false, why: HELD_NOTE.fact });
    await applyCard(p, ctx);
    expect(usePipelineStore.getState().punchSupercellL).toBe("");
    // The guard itself: a forged card reaches update_settings, which refuses it.
    const forged: Proposal = { ...p, held: undefined };
    await applyCard(forged, ctx);
    expect(usePipelineStore.getState().punchSupercellL).toBe("");
    expect(state().notes[p.id]).toMatch(/^Not applied: punchSupercellL is a fact about the sample, which only the user sets/);
    expect(state().decisions).toEqual([]);
  });

  it("the edge trim and the modulation the same way", async () => {
    for (const [answer, key] of [["edgeTrim 2", "edgeTrim"]] as const) {
      const [p] = propose(answer);
      await applyCard({ ...p, held: undefined }, ctx);
      expect(usePipelineStore.getState()[key]).toBe("");
    }
    const run: AgentStep = {
      id: "r1",
      name: "run_pipeline",
      args: {},
      status: "done",
      result: JSON.stringify({ off_lattice_bunching: { facts: "", ask_user: "… Does the sample have a modulation with k = (0, 1/3, 0)?" } }),
    };
    const [m] = propose("", [run]);
    await applyCard({ ...m, held: undefined }, ctx);
    expect(usePipelineStore.getState().modulationK).toBe("");
  });

  it("a ring change: held without a 3D verdict of a ring left, as for the model", async () => {
    const [p] = propose("ringModel parametric would follow the texture.");
    expect(p.held).toBeUndefined(); // from the answer: no refusal to hold it, update_settings' gate decides
    await applyCard(p, ctx);
    expect(usePipelineStore.getState().ringModel).toBe("pooled");
    expect(state().notes[p.id]).toMatch(/waits for a 3D verdict that a powder ring is left/);
    // A held card says so before the click.
    expect(cardState({ ...p, held: "ring" }, "demo", ctx, false)).toEqual({ can: false, why: "Held: no 3D verdict of a ring left yet." });
  });
});

describe("the Run card", () => {
  it("runs from its stage through run_pipeline, on a context naming nothing, and logs it", async () => {
    const tool = CHAT_TOOLS.find((t) => t.name === "run_pipeline")!;
    const spy = vi.spyOn(tool, "run").mockResolvedValue({ result: { ended: "done" }, summary: "done" });
    offerRun(2, "demo", "punch", "Punch min σ 5 → 6");
    const run = state().proposals[0];
    await applyCard(run, ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual({ from_stage: "punch" });
    expect(spy.mock.calls[0][1]).toMatchObject({ userMessage: "", replySteps: [] });
    expect(proposal(run.id).status).toBe("applied");
    expect(state().decisions[0]).toMatchObject({ kind: "run", action: "apply", runFrom: "punch" });
    expect(decisionLine(state().decisions[0])).toBe("Ran from Bragg punch");
  });

  it("says why a run did not finish", async () => {
    const tool = CHAT_TOOLS.find((t) => t.name === "run_pipeline")!;
    vi.spyOn(tool, "run").mockRejectedValue(new Error("the run failed: Bragg punch · out of memory"));
    offerRun(2, "demo", "punch", "x");
    const run = state().proposals[0];
    await applyCard(run, ctx);
    expect(proposal(run.id).status).toBe("open");
    expect(state().notes[run.id]).toBe("The run did not finish: the run failed: Bragg punch · out of memory.");
  });
});

describe("Dismiss and Undo", () => {
  it("Dismiss logs the card and changes nothing", () => {
    const [p] = propose("Try punchMinSig 6.");
    dismissCard(p);
    expect(proposal(p.id).status).toBe("dismissed");
    expect(state().decisions[0]).toMatchObject({ action: "dismiss", before: {}, after: {} });
    expect(usePipelineStore.getState().punchMinSig).toBe("");
  });

  it("Undo puts back the values from before; with no run since, the Run card it led to goes", async () => {
    const [p] = propose("Try punchMinSig 6.");
    await applyCard(p, ctx);
    const [d] = state().decisions;
    expect(undoDecision(d)).toBe(true);
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    const undone = state().decisions.find((x) => x.id === d.id)!;
    expect(undone.undoneBy).toBe(state().decisions[1].id);
    expect(state().decisions[1]).toMatchObject({ action: "undo", undoes: d.id, before: { punchMinSig: "6" }, after: { punchMinSig: "" } });
    expect(proposal(p.id).status).toBe("undone");
    expect(state().proposals.find((x) => x.kind === "run")!.status).toBe("dismissed");
    expect(undoDecision(undone)).toBe(false); // once
  });

  it("Undo after a run: the outputs predate the values put back, so a Run card", async () => {
    vi.spyOn(CHAT_TOOLS.find((t) => t.name === "run_pipeline")!, "run").mockResolvedValue({ result: {}, summary: "" });
    const [p] = propose("Try punchMinSig 6.");
    await applyCard(p, ctx);
    await applyCard(state().proposals.find((x) => x.kind === "run")!, ctx);
    undoDecision(state().decisions[0]);
    const open = state().proposals.filter((x) => x.kind === "run" && x.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0].shown.to).toBe("undid Punch min σ 5 → 6");
  });

  it("Undo after the field changed since: says so, and changes nothing", async () => {
    const [p] = propose("Try punchMinSig 6.");
    await applyCard(p, ctx);
    usePipelineStore.getState().patch({ punchMinSig: "8" });
    const [d] = state().decisions;
    expect(undoDecision(d)).toBe(false);
    expect(usePipelineStore.getState().punchMinSig).toBe("8");
    expect(state().notes[d.id]).toBe("Changed since: undo on Configure.");
  });

  it("Undo all puts back every change still standing, newest first", async () => {
    const [a, b] = propose("Try punchMinSig 6 and punchSearchFloor 30.");
    await applyCard(a, ctx);
    await applyCard(b, ctx);
    undoAll();
    expect(usePipelineStore.getState().punchMinSig).toBe("");
    expect(usePipelineStore.getState().punchSearchFloor).toBe("");
    expect(state().decisions.filter((d) => d.action === "undo")).toHaveLength(2);
  });
});

describe("the record", () => {
  it("is listed in the report, oldest first, in plain lines", async () => {
    const [p, q] = propose("Try punchMinSig 6 and punchSearchFloor 30.");
    await applyCard(p, ctx);
    dismissCard(q);
    undoDecision(state().decisions[0]);
    expect(reportDecisions("demo").map((d) => [d.by, d.decision])).toEqual([
      ["you", "Applied Punch min σ 5 → 6"],
      ["you", "Dismissed Punch search floor ×σ " + q.shown.from + " → 30"],
      ["you", "Put back Punch min σ 6 → 5"],
    ]);
    expect(reportDecisions("other")).toEqual([]);
  });

  it("reads back from a saved copy only what has its shape", async () => {
    const [p] = propose("Try punchMinSig 6.");
    await applyCard(p, ctx);
    const saved = JSON.parse(JSON.stringify({ proposals: state().proposals, decisions: state().decisions }));
    expect(readDecisions(saved)).toEqual(saved);
    const junk = {
      proposals: [...saved.proposals, { id: "P99", kind: "grant" }, saved.proposals[0], "x"],
      decisions: [{ ...saved.decisions[0], before: { punchMinSig: { evil: 1 } } }],
    };
    expect(readDecisions(junk)).toEqual({ proposals: saved.proposals, decisions: [] });
    expect(readDecisions(null)).toEqual({ proposals: [], decisions: [] });
  });
});
