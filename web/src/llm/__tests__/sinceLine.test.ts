// The "since the last reply" line (apply/since.ts, docs/pilot-auto-mode-design.md
// §1.4): what the user's decisions on the Apply cards changed since the model
// last replied, with the values before and after and who made them, in the
// next request's context alone; its words for every kind of decision; nothing
// of a click grant; the first user message, never the latest; the mark that
// keeps it to one reply, over a reload and in a session file. Synthetic only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { applyCard, applyOnClick, dismissCard, undoDecision } from "../apply/actions";
import {
  addProposals,
  clearDecisions,
  decisionsForFile,
  logDecision,
  markTold,
  readDecisions,
  restoreDecisions,
  untoldDecisions,
  useDecisionStore,
  type Decision,
} from "../apply/decisions";
import { buildProposals, type Proposal } from "../apply/proposals";
import { SINCE_MAX, sinceItem, sinceLine } from "../apply/since";
import { useChatStore } from "../chatStore";
import { writtenInferences } from "../inference";
import { buildChatMessages } from "../prompts/templates";
import { lastQuestion } from "../localTools";
import type { ToolContext } from "../tools";

const agent = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock("../agent", async (importOriginal) => ({ ...(await importOriginal<typeof import("../agent")>()), runAgent: agent.runAgent }));

const DATASET = { id: "demo", stem: "demo", stages: [] } as unknown as Dataset;
const ctx: ToolContext = { dataset: DATASET, datasets: [DATASET] };
const TRUSTED = { isTrusted: true };

const step = (name: string, args: Record<string, unknown>, result: unknown, id = name, status: AgentStep["status"] = "done"): AgentStep => ({
  id,
  name,
  args,
  status,
  summary: `${name} line`,
  result: typeof result === "string" ? result : JSON.stringify(result),
});
const propose = (answer: string, steps: AgentStep[] = []): Proposal[] => {
  const ps = buildProposals({ turn: 2, steps, answer, config: usePipelineStore.getState(), dataset: "demo", firstId: 1 + useDecisionStore.getState().proposals.length });
  addProposals(ps);
  return ps;
};
const state = () => useDecisionStore.getState();
/** The line for the decisions not told yet, as the chat builds it. */
const line = (): string | null => sinceLine(untoldDecisions().decisions, state().proposals);

beforeEach(() => {
  usePipelineStore.setState({ ...usePipelineStore.getInitialState(), running: false, lastRun: null });
  useChatStore.setState({ turns: [], busy: false, live: null, error: null, usage: null });
  clearDecisions();
});
afterEach(() => vi.restoreAllMocks());

describe("the line's words, decision by decision", () => {
  it("Apply, Dismiss and Undo on setting cards: update_settings' names, before → after, the value a decline kept", async () => {
    const [a] = propose("Try punchMinSig 6.");
    const [b] = propose("Or punchSupercellH 2.");
    await applyCard(a, ctx);
    dismissCard(b);
    expect(line()).toBe("- since the last reply, you applied punchMinSig 5 → 6; declined punchSupercellH 1 → 2 (kept 1)");
    markTold(untoldDecisions().through);
    expect(line()).toBeNull();
    undoDecision(state().decisions[0]);
    expect(line()).toBe("- since the last reply, you undid punchMinSig 6 → 5");
  });

  it("Edit and apply: the value applied, and the one the reply proposed", async () => {
    const [p] = propose("Try punchMinSig 6.");
    await applyCard(p, ctx, { punchMinSig: "7" });
    expect(line()).toBe("- since the last reply, you applied punchMinSig 5 → 7 (edited from the proposed 6)");
  });

  it("a sample fact applied by the user's click reads as any change of theirs: nothing of the grant", async () => {
    const [p] = propose("", [step("update_settings", { changes: { punchSupercellL: 2 } }, "Error: refused", "u1", "error")]);
    await applyOnClick(p, ctx, TRUSTED);
    expect(state().decisions[0].byClick).toBe(true);
    const text = line()!;
    expect(text).toBe("- since the last reply, you applied punchSupercellL 1 → 2");
    expect(text).not.toMatch(/grant|click|consent|P\d|D\d/i);
  });

  it("a run, a declined run, a tuning trial, the |Q| band, and auto mode named where it takes over", () => {
    const trial: Proposal = {
      id: "P1",
      turn: 2,
      kind: "trial",
      title: "Trial #3",
      change: { punchMinSig: 6, punchSupercellH: 2 },
      fields: { punchMinSig: "6", punchSupercellH: "2" },
      from: { punchMinSig: "", punchSupercellH: "" },
      shown: { from: "", to: "punchMinSig=6, punchSupercellH=2" },
      runFrom: "punch",
      source: { via: "trial" },
      evidence: [],
      dataset: "demo",
      status: "open",
      trial: { stage: "punch", n: 3 },
    };
    const band: Proposal = { ...trial, id: "P2", kind: "fact", title: "|Q| band", change: { pdfQMin: 1, pdfQMax: 20 }, shown: { from: "full", to: "1–20 Å⁻¹" }, trial: undefined };
    const base = { by: "you" as const, at: 0, before: {}, after: {} };
    const ds: Decision[] = [
      { ...base, id: "D1", proposal: "P1", kind: "trial", title: "Trial #3", shown: trial.shown, action: "apply", before: { punchMinSig: "", punchSupercellH: "" }, after: { punchMinSig: "6", punchSupercellH: "2" } },
      { ...base, id: "D2", proposal: "P9", kind: "run", title: "Run from Bragg punch", shown: { from: "", to: "" }, action: "apply", runFrom: "punch" },
      { ...base, id: "D3", proposal: "P2", kind: "fact", title: "|Q| band", shown: band.shown, action: "dismiss" },
      { ...base, id: "D4", proposal: "P8", kind: "run", title: "Run from ΔPDF", shown: { from: "", to: "" }, action: "dismiss", runFrom: "pdf", by: "auto" },
      { ...base, id: "D5", proposal: "P1", kind: "trial", title: "Trial #3", shown: trial.shown, action: "dismiss", by: "auto" },
    ];
    expect(sinceLine(ds, [trial, band])).toBe(
      "- since the last reply, you applied punch trial #3: punchMinSig 5 → 6, punchSupercellH 1 → 2; ran the pipeline from punch; declined |Q| band full → 1–20 Å⁻¹ (kept full); " +
        "auto mode declined the run from pdf; declined punch trial #3 (punchMinSig=6, punchSupercellH=2)",
    );
  });

  it("lists the newest SINCE_MAX decisions and counts the rest", () => {
    const ds: Decision[] = Array.from({ length: SINCE_MAX + 2 }, (_, i) => ({
      id: `D${i + 1}`,
      proposal: "P1",
      kind: "run",
      title: "Run",
      shown: { from: "", to: "" },
      action: "apply",
      by: "you",
      at: i,
      before: {},
      after: {},
      runFrom: "punch",
    }));
    const text = sinceLine(ds, [])!;
    expect(text.split("; ")).toHaveLength(SINCE_MAX);
    expect(text).toMatch(/ \(and 2 earlier\)$/);
    expect(sinceLine([], [])).toBeNull();
  });

  it("is facts alone: no span of inference written anywhere, so arm C reads it as arm B does", async () => {
    const [a] = propose("Try punchMinSig 6.");
    const [b] = propose("Or punchSupercellH 2.");
    await applyCard(a, ctx);
    dismissCard(b);
    const text = line()!;
    const spans = writtenInferences()
      .map((e) => e.span.text.trim())
      .filter((t) => t.split(/\s+/).length >= 3);
    expect(spans.length).toBeGreaterThan(60);
    expect(spans.filter((t) => text.includes(t))).toEqual([]);
    expect(text).not.toMatch(/\bskill|\bshould\b|\bclean\b|\bbetter\b|\bworse\b/i);
  });

  it("names nothing it was not given: an item without its proposal falls back to the card's title", () => {
    const d: Decision = { id: "D1", proposal: "P7", kind: "setting", title: "Punch min σ", shown: { from: "5", to: "6" }, action: "apply", by: "you", at: 0, before: {}, after: {} };
    expect(sinceItem(d, undefined)).toBe("applied Punch min σ 5 → 6");
  });
});

describe("where it goes: the first user message, never the latest", () => {
  const since = "- since the last reply, you applied punchMinSig 5 → 6";

  it("ends the context, with tools and without, and leaves the question as typed", () => {
    for (const tools of [true, false]) {
      const plain = buildChatMessages({} as never, [], "What now?", null, { tools });
      const told = buildChatMessages({} as never, [], "What now?", null, { tools, since });
      expect(told[1].content).toBe(`${plain[1].content as string}\n${since}`);
      expect(told.filter((_, i) => i !== 1)).toEqual(plain.filter((_, i) => i !== 1));
      // The sample-fact guard reads the latest user message: the user's words alone.
      expect(lastQuestion(told)).toBe("What now?");
    }
    expect(buildChatMessages({} as never, [], "q", null, { tools: true, since: null })).toEqual(buildChatMessages({} as never, [], "q", null, { tools: true }));
  });

  it("is the same with the skills on and off (arm B and arm C)", () => {
    const b = buildChatMessages({} as never, [], "q", null, { tools: true, since });
    const c = buildChatMessages({} as never, [], "q", null, { tools: true, skills: false, since });
    expect(c[1]).toEqual(b[1]);
  });
});

describe("one reply only: the mark of the decisions told", () => {
  it("a reply that came back marks them; one that ended with nothing lists them again", async () => {
    const [p] = propose("Try punchMinSig 6.");
    await applyCard(p, ctx);
    const session = await import("../session");
    const told = untoldDecisions().through;
    agent.runAgent.mockRejectedValueOnce(new Error("no server"));
    await session.askAssistant({ label: "q", messages: [], tools: [], ctx: null, told });
    expect(line()).not.toBeNull();
    agent.runAgent.mockResolvedValueOnce({ content: "Done.", reasoning: "", steps: [] });
    await session.askAssistant({ label: "q", messages: [], tools: [], ctx: null, told });
    expect(line()).toBeNull();
  });

  it("a decision made while a reply runs is listed in the next one", async () => {
    const [a] = propose("Try punchMinSig 6.");
    const [b] = propose("Or punchSupercellH 2.");
    await applyCard(a, ctx);
    const told = untoldDecisions().through;
    dismissCard(b); // during the reply
    markTold(told); // the reply came back
    expect(line()).toBe("- since the last reply, you declined punchSupercellH 1 → 2 (kept 1)");
    markTold(0); // never back
    expect(state().told).toBe(1);
  });

  it("goes with the record into a session file and back; a file from before it has told every decision", async () => {
    const [a] = propose("Try punchMinSig 6.");
    const [b] = propose("Or punchSupercellH 2.");
    await applyCard(a, ctx);
    markTold(untoldDecisions().through);
    dismissCard(b);
    const file = JSON.parse(JSON.stringify(decisionsForFile()));
    expect(file.told).toBe(1);
    clearDecisions();
    restoreDecisions(readDecisions(file));
    expect(line()).toBe("- since the last reply, you declined punchSupercellH 1 → 2 (kept 1)");
    const { told, ...old } = file;
    void told;
    restoreDecisions(readDecisions(old));
    expect(line()).toBeNull();
    expect(readDecisions({ ...file, told: "x" })).not.toHaveProperty("told");
    clearDecisions();
    expect(state().told).toBe(0);
  });

  it("a logged decision past the mark is untold, those up to it are not", () => {
    const base = { proposal: "P1", kind: "run" as const, title: "Run", shown: { from: "", to: "" }, action: "apply" as const, by: "you" as const, at: 0, before: {}, after: {}, runFrom: "punch" as const };
    logDecision(base);
    logDecision(base);
    markTold(1);
    expect(untoldDecisions()).toEqual({ decisions: [expect.objectContaining({ id: "D2" })], through: 2 });
  });
});
