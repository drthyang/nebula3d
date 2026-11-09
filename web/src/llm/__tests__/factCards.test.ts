// The cards the user alone may act on (apply/actions.ts, §1.3 of
// docs/pilot-auto-mode-design.md): a sample fact, the edge trim, the
// symmetry average, the |Q| band and the magnetic ion apply on the user's own
// click, logged as theirs ("you (click)") with the values before and after,
// and undo on their click; Edit opens the exact values, and the click
// applies the edited ones; a ring change the ring gate holds checks the
// rings in 3D first, and "Apply anyway" is the click's. Without a click,
// every one of them is held as before. Synthetic only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import {
  applyAnyway,
  applyCard,
  applyOnClick,
  byText,
  cardState,
  checkRings,
  clickState,
  currentRingCheck,
  decisionLine,
  HELD_NOTE,
  needsClick,
  proposeFromReply,
  reportDecisions,
  ringHeldNow,
  undoAll,
  undoDecision,
} from "../apply/actions";
import { addProposals, clearDecisions, readDecisions, restoreDecisions, useDecisionStore } from "../apply/decisions";
import { changeOf, editedChange, editFields } from "../apply/edit";
import { buildProposals, type Proposal } from "../apply/proposals";
import { useChatStore } from "../chatStore";
import { CHAT_TOOLS, type ToolContext } from "../tools";

const DATASET = { id: "demo", stem: "demo", stages: [] } as unknown as Dataset;
const ctx: ToolContext = { dataset: DATASET, datasets: [DATASET] };
const TRUSTED = { isTrusted: true }; // the browser's own click, as a handler's nativeEvent has it

const step = (name: string, args: Record<string, unknown>, result: unknown, id = name, status: AgentStep["status"] = "done"): AgentStep => ({
  id,
  name,
  args,
  status,
  summary: `${name} line`,
  result: typeof result === "string" ? result : JSON.stringify(result),
});
const propose = (steps: AgentStep[], answer = ""): Proposal[] => {
  const ps = buildProposals({ turn: 2, steps, answer, config: usePipelineStore.getState(), dataset: "demo", firstId: 1 + useDecisionStore.getState().proposals.length });
  addProposals(ps);
  return ps;
};
/** A card from a call update_settings refused with every change (it fails then). */
const refused = (changes: Record<string, unknown>): Proposal[] => propose([step("update_settings", { changes }, "Error: refused", "u1", "error")]);
const state = () => useDecisionStore.getState();
const store = () => usePipelineStore.getState();
const proposal = (id: string) => state().proposals.find((p) => p.id === id)!;

beforeEach(() => {
  usePipelineStore.setState({ ...usePipelineStore.getInitialState(), running: false, lastRun: null });
  useChatStore.setState({ turns: [], busy: false });
  clearDecisions();
});
afterEach(() => vi.restoreAllMocks());

describe("a sample fact's card", () => {
  it("is held without a click, as before: the app's own path never sets it", () => {
    const [p] = refused({ punchSupercellL: 2 });
    expect(needsClick(p)).toBe(true);
    expect(cardState(p, "demo", ctx, false)).toEqual({ can: false, why: HELD_NOTE.fact });
    expect(clickState(p, "demo", false)).toEqual({ can: true });
    expect(clickState(p, "other", false)).toEqual({ can: false, why: "Stale: another dataset is open." });
  });

  it("Apply, the user's click: set, logged as theirs with before and after, and a Run card", async () => {
    const [p] = refused({ punchSupercellL: 2 });
    await applyOnClick(p, ctx, TRUSTED);
    expect(store().punchSupercellL).toBe("2");
    expect(proposal(p.id).status).toBe("applied");
    const [d] = state().decisions;
    expect(d).toMatchObject({ proposal: p.id, action: "apply", by: "you", byClick: true, before: { punchSupercellL: "" }, after: { punchSupercellL: "2" }, runFrom: "punch" });
    expect(byText(d)).toBe("you (click)");
    expect(decisionLine(d)).toBe("Applied Supercell L 1 → 2");
    expect(reportDecisions("demo")).toEqual([expect.objectContaining({ by: "you (click)", decision: "Applied Supercell L 1 → 2" })]);
    expect(state().proposals.find((x) => x.kind === "run")).toMatchObject({ status: "open", runFrom: "punch", shown: { to: "Supercell L 1 → 2" } });
  });

  it("Undo, on the user's click: put back, logged, and the Run card it led to goes", async () => {
    const [p] = refused({ punchSupercellL: 2 });
    await applyOnClick(p, ctx, TRUSTED);
    const [d] = state().decisions;
    expect(undoDecision(d, TRUSTED)).toBe(true);
    expect(store().punchSupercellL).toBe("");
    expect(state().decisions[1]).toMatchObject({ action: "undo", undoes: d.id, byClick: true, before: { punchSupercellL: "2" }, after: { punchSupercellL: "" } });
    expect(proposal(p.id).status).toBe("undone");
    expect(state().proposals.find((x) => x.kind === "run")!.status).toBe("dismissed");
  });

  it("Undo all puts back a click's change on the click alone, and the others as before", async () => {
    const [fact] = refused({ punchSupercellL: 2 });
    const [setting] = propose([], "Try punchMinSig 6.");
    await applyOnClick(fact, ctx, TRUSTED);
    await applyCard(setting, ctx);
    undoAll();
    expect(store()).toMatchObject({ punchSupercellL: "2", punchMinSig: "" });
    expect(state().notes[state().decisions[0].id]).toBe("Undo needs your own click.");
    undoAll(TRUSTED);
    expect(store().punchSupercellL).toBe("");
  });

  it("Edit opens the exact value, and the click applies the edited one, checked", async () => {
    const [p] = refused({ punchSupercellL: 2 });
    const fields = editFields(p);
    expect(fields).toEqual([{ key: "punchSupercellL", label: "punchSupercellL", value: "2" }]);
    await applyOnClick(p, ctx, TRUSTED, editedChange(p, ["9"]));
    expect(store().punchSupercellL).toBe("");
    expect(state().notes[p.id]).toMatch(/^Not applied: punchSupercellL/);
    await applyOnClick(p, ctx, TRUSTED, editedChange(p, ["3"]));
    expect(store().punchSupercellL).toBe("3");
    expect(state().decisions[0]).toMatchObject({ action: "edit-apply", byClick: true, shown: { from: "1", to: "3" }, after: { punchSupercellL: "3" } });
  });
});

describe("the modulation's card", () => {
  const run = step("run_pipeline", {}, {
    ended: "done",
    off_lattice_bunching: { facts: "", ask_user: "7 of the 31 sharp peaks off the lattice sit at K = n ± 1/3. Does the sample have a modulation with k = (0, 1/3, 0)?" },
  });

  it("Edit opens its four parts; the click declares them, the four fields set as one", async () => {
    const [p] = propose([run]);
    expect(editFields(p).map((f) => [f.label, f.value, f.options ?? null])).toEqual([
      ["k", "0, 1/3, 0", null],
      ["order", "1", null],
      ["form", "points", ["points", "planes"]],
      ["half_width", "0.08", null],
    ]);
    const edited = editedChange(p, ["0, 1/3, 0", "2", "planes", "0.05"]);
    expect(edited).toEqual({ modulation: { k: "0, 1/3, 0", order: 2, form: "planes", half_width: 0.05 } });
    await applyOnClick(p, ctx, TRUSTED, edited);
    expect(store()).toMatchObject({ modulationK: "0, 1/3, 0", modulationOrder: "2", modulationForm: "planes", modulationHalfWidth: "0.05" });
    expect(state().decisions[0]).toMatchObject({ byClick: true, before: { modulationK: "", modulationOrder: "", modulationForm: "", modulationHalfWidth: "" } });
    expect(state().decisions[0].shown.to).toBe("k = (0, 1/3, 0), order 2, planes, ± 0.05 r.l.u.");
    // Undo puts back all four.
    undoDecision(state().decisions[0], TRUSTED);
    expect(store()).toMatchObject({ modulationK: "", modulationOrder: "", modulationForm: "", modulationHalfWidth: "" });
  });

  it("applies as it stands after a reload, whose saved copy holds its declaration as text", async () => {
    const [p] = propose([run]);
    restoreDecisions(readDecisions(JSON.parse(JSON.stringify({ proposals: state().proposals, decisions: [] }))));
    const back = proposal(p.id);
    expect(typeof back.change.modulation).toBe("string");
    expect(changeOf(back)).toEqual({ modulation: { k: "0, 1/3, 0", form: "points", order: 1 } });
    await applyOnClick(back, ctx, TRUSTED);
    expect(store()).toMatchObject({ modulationK: "0, 1/3, 0", modulationOrder: "1", modulationForm: "points" });
  });
});

describe("the settings only the user sets", () => {
  it("the Laue class the comparison suggests, declared through the symmetry average: what Apply does said plainly, and a run from the average", async () => {
    const [p] = propose([step("compare_laue_classes", {}, { suggestion: "m-3m", classes: [], flag: null })]);
    expect(p).toMatchObject({
      title: "Declare m-3m (symmetry average)",
      held: "symmetry",
      fields: { symmetryAverageEnabled: true, symmetryLaue: "m-3m" },
      shown: { from: "none declared", to: "m-3m" },
      runFrom: "symmetry_average",
    });
    expect(p.what).toBe("Apply averages the volume over m-3m and runs again from the start; the outputs then declare m-3m, which the stages and the symmetry check read.");
    await applyOnClick(p, ctx, TRUSTED);
    expect(store()).toMatchObject({ symmetryLaue: "m-3m", symmetryAverageEnabled: true });
    // Declared already: no card.
    expect(propose([step("compare_laue_classes", {}, { suggestion: "m-3m", classes: [], flag: null }, "c2")])).toEqual([]);
  });

  it("the |Q| band the coverage suggests: its two edges as the slider writes them, a Run card from the ΔPDF; Edit checks the pair", async () => {
    const [p] = propose([step("qmax_coverage", {}, { suggested_band: [0.5, 7.2], band_check: "no |Q| band is set: the transform takes every voxel" })]);
    expect(p).toMatchObject({ held: "user-only", fields: { pdfQMin: "0.50", pdfQMax: "7.20" }, shown: { from: "full", to: "0.5–7.2 Å⁻¹" }, runFrom: "pdf" });
    expect(editFields(p).map((f) => [f.key, f.value])).toEqual([
      ["pdfQMin", "0.5"],
      ["pdfQMax", "7.2"],
    ]);
    await applyOnClick(p, ctx, TRUSTED, editedChange(p, ["8", "2"]));
    expect(state().notes[p.id]).toMatch(/^Not applied: the \|Q\| band needs pdfQMin below pdfQMax/);
    await applyOnClick(p, ctx, TRUSTED, editedChange(p, ["0.6", "6.5"]));
    expect(store()).toMatchObject({ pdfQMin: "0.60", pdfQMax: "6.50" });
    expect(state().decisions[0]).toMatchObject({ action: "edit-apply", byClick: true, shown: { from: "full", to: "0.6–6.5 Å⁻¹" } });
    expect(state().proposals.find((x) => x.kind === "run")).toMatchObject({ runFrom: "pdf" });
  });

  it("one Laue class card for the Bragg sensing's and the comparison's: a later reply's twin joins it, and applying covers a card its change holds", async () => {
    const compare = step("compare_laue_classes", {}, { suggestion: "m-3m", classes: [], flag: null }, "c1");
    proposeFromReply(2, [compare], "", "demo");
    const [card] = state().proposals;
    expect(card.title).toBe("Declare m-3m (symmetry average)");
    // The same class from another tool in a later reply: no second card, its evidence joins the first.
    const again = { ...step("compare_laue_classes", {}, { suggestion: "m-3m", classes: [], flag: null }, "c2") };
    proposeFromReply(3, [again], "", "demo");
    expect(state().proposals.filter((p) => p.status === "open")).toHaveLength(1);
    expect(state().proposals[0].evidence.map((e) => e.step)).toEqual(["c1", "c2"]);
    // A card whose change the Apply makes hold (the class alone): covered, no Apply left to wait on.
    addProposals([{ ...card, id: "P90", title: "Laue class", change: { symmetryLaue: "m-3m" }, fields: { symmetryLaue: "m-3m" }, from: { symmetryLaue: "" }, evidence: [] }]);
    await applyOnClick(card, ctx, TRUSTED);
    expect(state().proposals.find((p) => p.id === card.id)!.status).toBe("applied");
    expect(state().proposals.find((p) => p.id === "P90")!.status).toBe("covered");
    // The report lists the one Apply, no "kept" line for the covered card.
    expect(reportDecisions("demo").map((d) => d.decision)).toEqual(["Applied Declare m-3m (symmetry average) none declared → m-3m"]);
  });

  it("the magnetic ion, the edge trim and the average's switch: each from a refused call, each set on the click", async () => {
    const [ion] = refused({ flattenIon: "Tb3+" });
    expect(ion).toMatchObject({ held: "user-only", fields: { flattenIon: "Tb3+" }, runFrom: "flatten" });
    expect(editFields(ion)[0].options).toContain("Tb3+");
    await applyOnClick(ion, ctx, TRUSTED);
    expect(store().flattenIon).toBe("Tb3+");
    const [trim, on] = refused({ edgeTrim: 2, symmetryAverageEnabled: true });
    expect([trim.held, on.held]).toEqual(["choice", "symmetry"]);
    expect(editFields(on)[0]).toMatchObject({ value: "true", options: ["true", "false"] });
    await applyOnClick(trim, ctx, TRUSTED);
    await applyOnClick(on, ctx, TRUSTED, editedChange(on, ["true"]));
    expect(store()).toMatchObject({ edgeTrim: "2", symmetryAverageEnabled: true });
    // No card for a value its write refuses.
    expect(refused({ flattenIon: "Xx9+" })).toEqual([]);
  });
});

describe("a ring change the ring gate holds", () => {
  const verdict = (left: number) => ({
    result: {
      rings: { verdict: left ? "needs attention" : "meets its goal", max_ring_left: left, max_ring_dent: 0, mean_ring_energy_ratio: 0.9, max_over_subtraction_fraction: 0, ...(left ? { worst_ring_left: { at: 2.17, residual_fraction: left } } : {}) },
    },
    summary: left ? "rings: needs attention" : "rings: meets its goal",
  });
  const assess = () => vi.spyOn(CHAT_TOOLS.find((t) => t.name === "assess_stage")!, "run");
  const ringCard = (): Proposal => propose([step("update_settings", { changes: { ringModel: "parametric" } }, "Error: ringModel waits for a 3D verdict that a powder ring is left or dented", "u1", "error")])[0];

  it("is held for the 3D verdict, as before; the check finding a ring left opens it for the card, and Apply needs no grant", async () => {
    const p = ringCard();
    expect(p.held).toBe("ring");
    expect(ringHeldNow(p, ctx)).toBe(true);
    expect(cardState(p, "demo", ctx, false)).toEqual({ can: false, why: "Held: no 3D verdict of a ring left yet." });
    const spy = assess().mockResolvedValue(verdict(0.42));
    await checkRings(p, ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual({ stage: "rings" });
    expect(spy.mock.calls[0][1]).toMatchObject({ userMessage: "", replySteps: [] });
    expect(currentRingCheck(p)?.step.summary).toBe("rings: needs attention");
    expect(ringHeldNow(p, ctx)).toBe(false);
    expect(cardState(p, "demo", ctx, false)).toEqual({ can: true });
    await applyCard(p, ctx);
    expect(store().ringModel).toBe("parametric");
    expect(state().decisions[0].byClick).toBeUndefined();
  });

  it("the check finding no ring left keeps it held; Apply anyway is the user's click, logged as theirs", async () => {
    const p = ringCard();
    assess().mockResolvedValue(verdict(0));
    await checkRings(p, ctx);
    expect(currentRingCheck(p)).toBeDefined();
    expect(ringHeldNow(p, ctx)).toBe(true);
    await applyCard(p, ctx);
    expect(store().ringModel).toBe("pooled");
    await applyAnyway(p, ctx, TRUSTED);
    expect(store().ringModel).toBe("parametric");
    expect(state().decisions[0]).toMatchObject({ byClick: true, before: { ringModel: "pooled" }, after: { ringModel: "parametric" } });
  });

  it("a run since the check makes it stale, and the card held again; the conversation never reads it", async () => {
    const p = ringCard();
    assess().mockResolvedValue(verdict(0.42));
    await checkRings(p, ctx);
    expect(ringHeldNow(p, ctx)).toBe(false);
    usePipelineStore.setState({ lastRun: { datasetId: "demo", stages: ["rings"], force: true, flattenEnabled: true, params: {} } as never });
    expect(currentRingCheck(p)).toBeUndefined();
    expect(ringHeldNow(p, ctx)).toBe(true);
    expect(useChatStore.getState().turns).toEqual([]);
  });

  it("a check that cannot run says so, and keeps nothing", async () => {
    const p = ringCard();
    assess().mockRejectedValue(new Error("no ring_removed output yet"));
    await checkRings(p, ctx);
    expect(state().notes[p.id]).toBe("The ring check did not run: no ring_removed output yet.");
    expect(currentRingCheck(p)).toBeUndefined();
  });
});
