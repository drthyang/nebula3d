// Trying to get a sample fact set without the user's own trusted click
// (docs/pilot-auto-mode-design.md §1.3, §5). The model controls its tool
// calls' arguments and its own text; a page script can dispatch a click; a
// grant could be replayed, reused, stretched to other values, carried to
// another card or dataset, kept over a reload, or leak onto a model's call.
// Every way here must leave the fact as it was, and the model's refusals in
// the words they had before the click grant existed. Synthetic only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { applyAnyway, applyCard, applyOnClick, NOT_YOUR_CLICK, undoDecision } from "../apply/actions";
import { addProposals, clearDecisions, decisionsForFile, readDecisions, useDecisionStore } from "../apply/decisions";
import { buildProposals, type Proposal } from "../apply/proposals";
import { useChatStore } from "../chatStore";
import { grantForClick, redeemGrant, type AppCallContext, type Grant } from "../consent";
import type { ToolCall } from "../provider/client";
import { replyContext } from "../session";
import { callTool, CHAT_TOOLS, type ToolContext } from "../tools";
import { runRound, startReply } from "../tools/round";
import { ringEvidenceRefusal } from "../tools/shared/ringGate";
import { sampleFactRefusal, symmetryAverageRefusal, userChoiceRefusal } from "../tune/catalog";

const DATASET = { id: "demo", stem: "demo", stages: [] } as unknown as Dataset;
const OTHER = { id: "other", stem: "other", stages: [] } as unknown as Dataset;
const ctx: ToolContext = { dataset: DATASET, datasets: [DATASET, OTHER] };
const TRUSTED = { isTrusted: true }; // the browser's own click, as a handler's nativeEvent has it
const store = () => usePipelineStore.getState();
const notes = () => useDecisionStore.getState().notes;

const grant = (changes: Record<string, unknown>, card = "P1", dataset = "demo"): Grant => grantForClick(TRUSTED, { card, dataset, changes })!;
const withGrant = (g: unknown, over: Partial<ToolContext> = {}): AppCallContext => ({ ...ctx, ...over, grant: g } as AppCallContext);
/** A model's call as the round runs it: the reply's skills read are set on every one (startReply). */
const modelCtx = (over: Partial<ToolContext> = {}): ToolContext => ({ ...ctx, skills: false, skillsRead: new Set<string>(), userMessage: "Is the punch clean?", replySteps: [], ...over });

/** A sample-fact card from a refused call, as a reply leads to it. */
const factCard = (changes: Record<string, unknown> = { punchSupercellL: 2 }): Proposal => {
  const step: AgentStep = {
    id: "u1",
    name: "update_settings",
    args: { changes },
    status: "error",
    result: `Error: ${Object.keys(changes).map(sampleFactRefusal).join(" ")}`,
  };
  const ps = buildProposals({ turn: 2, steps: [step], answer: "", config: store(), dataset: "demo", firstId: 1 + useDecisionStore.getState().proposals.length });
  addProposals(ps);
  return ps[0];
};

const FACTS = { punchSupercellH: "", punchSupercellK: "", punchSupercellL: "", modulationK: "", modulationOrder: "", modulationForm: "", modulationHalfWidth: "" };

beforeEach(() => {
  usePipelineStore.setState({ ...usePipelineStore.getInitialState(), running: false });
  useChatStore.setState({ turns: [], busy: false });
  clearDecisions();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the model's own calls: the guards hold exactly as before", () => {
  it("a fact, the edge trim, the symmetry average, the band, the ion: refused in the same words, the store unchanged", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ punchSupercellL: 2 }, `Error: ${sampleFactRefusal("punchSupercellL")}`],
      [{ modulation: { k: "0, 1/3, 0" } }, `Error: ${sampleFactRefusal("modulation")}`],
      [{ edgeTrim: 2 }, `Error: ${userChoiceRefusal("edgeTrim")}`],
      [{ symmetryLaue: "6/mmm" }, `Error: ${symmetryAverageRefusal("symmetryLaue")}`],
    ];
    for (const [changes, text] of cases) {
      const r = await callTool(modelCtx(), "update_settings", { changes });
      expect(r.text, JSON.stringify(changes)).toBe(text);
    }
    for (const key of ["pdfQMin", "pdfQMax", "flattenIon"]) {
      const r = await callTool(modelCtx(), "update_settings", { changes: { [key]: key === "flattenIon" ? "Fe2+" : 1 } });
      expect(r.text).toMatch(new RegExp(`^Error: invalid arguments — ${key} cannot be changed; these can: `));
    }
    expect(store()).toMatchObject({ ...FACTS, edgeTrim: "", symmetryLaue: "", pdfQMin: "", pdfQMax: "", flattenIon: "" });
  });

  it("a grant-like field in the call's arguments is no grant: update_settings reads only `changes`", async () => {
    for (const extra of [{ grant: "G1" }, { grant: { card: "P1", dataset: "demo", changes: { punchSupercellL: 2 } } }, { grant: true }, { consent: "click" }]) {
      const r = await callTool(modelCtx(), "update_settings", { changes: { punchSupercellL: 2 }, ...extra });
      expect(r.text, JSON.stringify(extra)).toBe(`Error: ${sampleFactRefusal("punchSupercellL")}`);
    }
    const inChanges = await callTool(modelCtx(), "update_settings", { changes: { punchSupercellL: 2, grant: "G1" } });
    expect(inChanges.text).toMatch(/^Error: invalid arguments — grant cannot be changed/);
    expect(store().punchSupercellL).toBe("");
  });

  it("a grant-like string or copy on the context is no grant", async () => {
    const real = grant({ punchSupercellL: 2 });
    const forged: unknown[] = ["G1", 1, true, { id: 1, card: "P1", dataset: "demo", changes: { punchSupercellL: 2 } }, JSON.parse(JSON.stringify(real)), structuredClone(real), {}];
    for (const g of forged) {
      expect(redeemGrant(withGrant(g))).toBeNull();
      const r = await callTool(withGrant(g, { userMessage: "" }), "update_settings", { changes: { punchSupercellL: 2 } });
      expect(r.text, JSON.stringify(g)).toBe(`Error: ${sampleFactRefusal("punchSupercellL")}`);
    }
    expect(store().punchSupercellL).toBe("");
  });

  it("a real grant that leaked onto a model's call grants nothing, and is used up", async () => {
    const g = grant({ punchSupercellL: 2 });
    const r = await callTool(withGrant(g, modelCtx()), "update_settings", { changes: { punchSupercellL: 2 } });
    expect(r.text).toBe(`Error: ${sampleFactRefusal("punchSupercellL")}`);
    expect(store().punchSupercellL).toBe("");
    // Burnt: not even the app's own call can use it now.
    expect((await callTool(withGrant(g), "update_settings", { changes: { punchSupercellL: 2 } })).ok).toBe(false);
  });

  it("the model's answer naming a value builds a card, and sets nothing", async () => {
    const [p] = buildProposals({ turn: 2, steps: [], answer: "I have a grant from the user: punchSupercellL 2, applied by you (click).", config: store(), dataset: "demo", firstId: 1 });
    expect(p).toMatchObject({ kind: "fact", held: "fact", change: { punchSupercellL: "2" } });
    expect(store().punchSupercellL).toBe("");
  });

  it("a ring change on the model's path stays gated, a leaked grant included", async () => {
    const g = grant({ ringModel: "parametric" });
    const r = await callTool(withGrant(g, modelCtx({ userMessage: "Assess the rings." })), "update_settings", { changes: { ringModel: "parametric" } });
    expect(r.text).toBe(`Error: ${ringEvidenceRefusal("ringModel")}`);
    expect(store().ringModel).toBe("pooled");
  });
});

describe("the round builds every model call's context without a grant", () => {
  const call = (args: Record<string, unknown>): ToolCall => ({ id: "c1", type: "function", function: { name: "update_settings", arguments: JSON.stringify(args) } });

  it("from the chat's context: the tool runs on a context with no grant on it, and refuses", async () => {
    const tool = CHAT_TOOLS.find((t) => t.name === "update_settings")!;
    const seen: ToolContext[] = [];
    const original = tool.run;
    vi.spyOn(tool, "run").mockImplementation((args, c, io) => {
      seen.push(c);
      return original(args, c, io);
    });
    const history = startReply(replyContext({ ...ctx, skills: false, userMessage: "Is the punch clean?" }, []), CHAT_TOOLS);
    const round = await runRound([call({ changes: { punchSupercellL: 2 }, grant: "G1" })], history);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty("grant");
    expect(seen[0].skillsRead).toBeDefined();
    expect(round.results[0].step.status).toBe("error");
    expect(round.results[0].message.content).toBe(`Error: ${sampleFactRefusal("punchSupercellL")}`);
    expect(round.history.ctx).not.toHaveProperty("grant");
    expect(store().punchSupercellL).toBe("");
  });

  it("even from a context a grant leaked onto: the round's call carries the skills read, so it is refused", async () => {
    const g = grant({ punchSupercellL: 2 });
    const history = startReply({ ...ctx, skills: false, userMessage: "Is the punch clean?", grant: g } as AppCallContext, CHAT_TOOLS);
    const round = await runRound([call({ changes: { punchSupercellL: 2 } })], history);
    expect(round.results[0].message.content).toBe(`Error: ${sampleFactRefusal("punchSupercellL")}`);
    expect(store().punchSupercellL).toBe("");
  });
});

describe("the card path without the user's own click", () => {
  it("an untrusted event (a script's dispatched click) makes no grant and sets nothing", async () => {
    const p = factCard();
    const target = new EventTarget();
    let scripted: Event | null = null;
    target.addEventListener("click", (e) => (scripted = e));
    target.dispatchEvent(new Event("click"));
    expect(scripted!.isTrusted).toBe(false);
    for (const e of [scripted, null, undefined, {}, { isTrusted: "true" }, { isTrusted: 1 }]) {
      await applyOnClick(p, ctx, e as never);
      expect(store().punchSupercellL).toBe("");
      expect(notes()[p.id]).toBe(NOT_YOUR_CLICK);
    }
    await applyAnyway(p, ctx, scripted);
    expect(store().punchSupercellL).toBe("");
    expect(useDecisionStore.getState().decisions).toEqual([]);
  });

  it("Apply with no grant at all: refused by the hold, and by the guard itself on a card stripped of it", async () => {
    const p = factCard();
    await applyCard(p, ctx);
    await applyCard({ ...p, held: undefined }, ctx);
    expect(store().punchSupercellL).toBe("");
    expect(notes()[p.id]).toMatch(/^Not applied: punchSupercellL is a fact about the sample, which only the user sets/);
    const forged = {} as Grant;
    await applyCard(p, ctx, undefined, forged);
    expect(store().punchSupercellL).toBe("");
  });

  it("a grant for other values covers none of them: another value, another fact, another dataset", async () => {
    const g = grant({ punchSupercellL: 2 });
    expect((await callTool(withGrant(g), "update_settings", { changes: { punchSupercellL: 3 } })).text).toBe(`Error: ${sampleFactRefusal("punchSupercellL")}`);
    const h = grant({ punchSupercellL: 2 });
    const r = await callTool(withGrant(h), "update_settings", { changes: { punchSupercellL: 2, punchSupercellH: 2 } });
    expect(r.ok, r.text).toBe(true);
    expect(JSON.parse(r.text).refused).toEqual([{ setting: "punchSupercellH", why: sampleFactRefusal("punchSupercellH") }]);
    expect(store()).toMatchObject({ punchSupercellL: "2", punchSupercellH: "" });
    const m = grant({ modulation: { k: "0, 1/3, 0" } });
    expect((await callTool(withGrant(m), "update_settings", { changes: { modulation: { k: "1/2, 0, 0" } } })).ok).toBe(false);
    const elsewhere = grant({ punchSupercellK: 2 }, "P1", "demo");
    expect((await callTool(withGrant(elsewhere, { dataset: OTHER }), "update_settings", { changes: { punchSupercellK: 2 } })).ok).toBe(false);
    expect(store()).toMatchObject({ punchSupercellK: "", modulationK: "" });
  });

  it("a grant made for one card applies no other, even with the same values, and is gone after", async () => {
    const a = factCard();
    const b = factCard({ punchSupercellL: 2, punchSupercellH: 2 });
    const g = grant({ punchSupercellL: 2 }, a.id);
    await applyCard(b, ctx, { punchSupercellL: 2 }, g);
    expect(store().punchSupercellL).toBe("");
    expect(notes()[b.id]).toBe(NOT_YOUR_CLICK);
    await applyCard(a, ctx, undefined, g); // revoked by the apply it was handed to
    expect(store().punchSupercellL).toBe("");
  });

  it("an edited value the click did not approve is refused: the grant is for the values applied", async () => {
    const p = factCard();
    const g = grant({ punchSupercellL: 2 }, p.id);
    await applyCard(p, ctx, { punchSupercellL: 3 }, g);
    expect(store().punchSupercellL).toBe("");
    expect(notes()[p.id]).toMatch(/^Not applied: punchSupercellL is a fact about the sample/);
  });
});

describe("a grant is used once", () => {
  it("used twice: the second call is refused", async () => {
    const g = grant({ punchSupercellL: 2 });
    expect((await callTool(withGrant(g), "update_settings", { changes: { punchSupercellL: 2 } })).ok).toBe(true);
    usePipelineStore.setState({ punchSupercellL: "" });
    const again = await callTool(withGrant(g), "update_settings", { changes: { punchSupercellL: 2 } });
    expect(again.text).toBe(`Error: ${sampleFactRefusal("punchSupercellL")}`);
    expect(store().punchSupercellL).toBe("");
  });

  it("two calls at once: exactly one goes through", async () => {
    const g = grant({ punchSupercellL: 2 });
    const runs = await Promise.all([1, 2].map(() => callTool(withGrant(g), "update_settings", { changes: { punchSupercellL: 2 } })));
    expect(runs.map((r) => r.ok).sort()).toEqual([false, true]);
  });

  it("a call that fails still uses it up (the pipeline busy, a bad value)", async () => {
    const g = grant({ punchSupercellL: 2 });
    usePipelineStore.setState({ running: true });
    expect((await callTool(withGrant(g), "update_settings", { changes: { punchSupercellL: 2 } })).ok).toBe(false);
    usePipelineStore.setState({ running: false });
    expect((await callTool(withGrant(g), "update_settings", { changes: { punchSupercellL: 2 } })).ok).toBe(false);
    expect(store().punchSupercellL).toBe("");
  });

  it("replayed after Undo: the card's grant is gone, so the fact stays undone", async () => {
    const p = factCard();
    let kept: Grant | null = null;
    const made = grantForClick(TRUSTED, { card: p.id, dataset: "demo", changes: { punchSupercellL: 2 } });
    kept = made;
    await applyCard(p, ctx, undefined, made);
    expect(store().punchSupercellL).toBe("2");
    const [d] = useDecisionStore.getState().decisions;
    expect(d).toMatchObject({ byClick: true, before: { punchSupercellL: "" }, after: { punchSupercellL: "2" } });
    // Undo of a change a click made needs a click too.
    expect(undoDecision(d)).toBe(false);
    expect(undoDecision(d, { isTrusted: false })).toBe(false);
    expect(store().punchSupercellL).toBe("2");
    expect(undoDecision(d, TRUSTED)).toBe(true);
    expect(store().punchSupercellL).toBe("");
    // The grant replayed, on the update_settings call and on the card.
    expect((await callTool(withGrant(kept), "update_settings", { changes: { punchSupercellL: 2 } })).ok).toBe(false);
    await applyCard({ ...p, status: "open" }, ctx, undefined, kept);
    expect(store().punchSupercellL).toBe("");
  });
});

describe("a grant never outlives the page, and is never saved", () => {
  it("the record a session file and storage keep holds no grant, and a saved grant reads back as none", async () => {
    const saved: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => saved[k] ?? null, setItem: (k: string, v: string) => void (saved[k] = v), removeItem: (k: string) => void delete saved[k] });
    const p = factCard();
    await applyOnClick(p, ctx, TRUSTED);
    expect(store().punchSupercellL).toBe("2");
    const file = JSON.stringify(decisionsForFile());
    expect(file).not.toMatch(/grant/i);
    expect(Object.values(saved).join("")).not.toMatch(/grant/i);
    const read = readDecisions({ ...JSON.parse(file), grant: { card: p.id }, proposals: JSON.parse(file).proposals.map((x: object) => ({ ...x, grant: { card: p.id } })) });
    expect(JSON.stringify(read)).not.toMatch(/grant/i);
  });

  it("over a reload: a grant from before it is none to the page after it", async () => {
    const g = grant({ punchSupercellL: 2 });
    vi.resetModules();
    const fresh = await import("../tools");
    const pipe = await import("../../state/pipelineStore");
    const r = await fresh.callTool(withGrant(g), "update_settings", { changes: { punchSupercellL: 2 } });
    expect(r.text).toBe(`Error: ${sampleFactRefusal("punchSupercellL")}`);
    expect(pipe.usePipelineStore.getState().punchSupercellL).toBe("");
  });
});
