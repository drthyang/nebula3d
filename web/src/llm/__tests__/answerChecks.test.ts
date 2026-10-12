// A NEBULA Pilot answer stands on its evidence: no verdict on a stage without
// the tool that measures it in the reply, every number from a source, and no
// claim the tools' computed verdicts contradict.  runAgent sends a failing
// answer back once and notes what still fails.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import type { AgentStep } from "../agent";
import { ANSWER_REVISIONS, runAgent } from "../agent";
import {
  answerIssues,
  clauses,
  contradictions,
  issuesNote,
  issuesPrompt,
  missingEvidence,
  untracedNumbers,
  verdictsIn,
  writtenNumbers,
} from "../answerChecks";
import type { ChatMessage, StreamDelta } from "../provider/client";
import { DEFAULT_SETTINGS } from "../settings";
import type { AgentTool } from "../tools";

const step = (name: string, args: Record<string, unknown> = {}, result: unknown = {}, status: AgentStep["status"] = "done"): AgentStep => ({
  id: name,
  name,
  args,
  status,
  result: JSON.stringify(result),
});

describe("verdicts and their evidence", () => {
  it("finds verdicts by topic, not plans, questions or conditions", () => {
    const v = verdictsIn(
      "The ring removal is clean. I will check the punch next. If rings remain, raise the sectors. Is the flatten flat? " +
        "The window stays inside the coverage; the ΔPDF keeps its six-fold symmetry.",
    );
    expect([...v.keys()].sort()).toEqual(["coverage", "rings", "symmetry"]);
  });

  it("reads a setting's general effect as no verdict on this run's symmetry", () => {
    expect(verdictsIn("A separable window breaks the six-fold symmetry the ellipsoid window keeps.").has("symmetry")).toBe(false);
  });

  it("needs the measuring tool, run without an error, in the reply", () => {
    const text = "The ring removal is clean, and the punch missed no peaks.";
    expect(missingEvidence(text, []).map((t) => t.id)).toEqual(["rings", "punch"]);
    expect(missingEvidence(text, [step("assess_stage", { stage: "all" })])).toEqual([]);
    expect(missingEvidence(text, [step("assess_stage", { stage: "rings" })]).map((t) => t.id)).toEqual(["punch"]);
    expect(missingEvidence(text, [step("assess_stage", { stage: "punch" }, {}, "error")]).map((t) => t.id)).toEqual(["rings", "punch"]);
    expect(missingEvidence("The UB is off by a fraction of a degree.", [step("grain_check")])).toEqual([]);
  });

  it("splits claims at ; and :, without a leading Yes or No", () => {
    expect(clauses("No: the window reaches past the coverage; it should not. Yes, it is fine.")).toEqual([
      "the window reaches past the coverage",
      "it should not.",
      "it is fine.",
    ]);
    expect(clauses("No ring is left.")).toEqual(["No ring is left."]); // a determiner, not an answer
  });

  it("reads the peaks' offset from their nodes as the UB's verdict, not the punch's", () => {
    const ub = "ub_check found a rotation of only 0.001°, and the Bragg peaks' RMS offset from their nodes stayed at 0.0004 Å⁻¹.";
    expect(verdictsIn(ub).has("punch")).toBe(false);
    expect(verdictsIn("The punch missed 16 lattice peaks at nodes.").has("punch")).toBe(true);
  });
});

describe("contradicting the tools' computed verdicts", () => {
  // A punch evaluation whose numbers fail the punch's rule (peaks missed at nodes).
  const punchMissed = step("assess_stage", { stage: "punch" }, { punch: { leftover_at_nodes: 12, leftover_off_lattice_sharp: 0, mean_punched_fraction: 0.08 } });

  it("catches a stage called clean that the rule says needs attention, computing the verdict when the result lacks it", () => {
    expect(contradictions("The punch removed every Bragg peak; nothing is left at the nodes.", [punchMissed]).map((t) => t.id)).toEqual(["punch"]);
    expect(contradictions("The punch missed 12 peaks at nodes.", [punchMissed])).toEqual([]);
    const judged = step("assess_stage", { stage: "rings" }, { rings: { verdict: "needs attention" } });
    expect(contradictions("Ring removal: clean.", [judged]).map((t) => t.id)).toEqual(["rings"]);
    expect(contradictions("No ring is left.", [judged]).map((t) => t.id)).toEqual(["rings"]);
  });

  it("holds a 3D-ΔPDF called sound to the stage's verdict, and reads a feature as no verdict", () => {
    const pdf = step("assess_stage", { stage: "pdf" }, { pdf: { verdict: "needs attention" } });
    expect(contradictions("The 3D-ΔPDF meets its goal.", [pdf]).map((t) => t.id)).toEqual(["pdf"]);
    expect(verdictsIn("The 3D-ΔPDF shows a positive peak at 2.9 Å.").has("pdf")).toBe(false);
    expect(verdictsIn("The ΔPDF keeps its six-fold symmetry.").has("pdf")).toBe(false);
    expect(missingEvidence("The 3D-ΔPDF passes.", []).map((t) => t.id)).toEqual(["pdf"]);
  });

  it("holds the other tools to their own verdicts", () => {
    const noGrain = step("grain_check", {}, { verdict: "no second grain of this phase: …" });
    expect(contradictions("The off-lattice peaks show a second grain.", [noGrain]).map((t) => t.id)).toEqual(["grain"]);
    expect(contradictions("There is no second grain.", [noGrain])).toEqual([]);
    const tooFar = step("qmax_coverage", {}, { verdict: "too far: the window reaches the box corners" });
    expect(contradictions("The window stays inside the coverage.", [tooFar]).map((t) => t.id)).toEqual(["coverage"]);
    const notKept = step("symmetry_check", {}, { verdict: "not kept: the six-fold fails" });
    expect(contradictions("The ΔPDF keeps its six-fold symmetry.", [notKept]).map((t) => t.id)).toEqual(["symmetry"]);
  });

  it("knows a UB turned by the fit, or on a symmetrised volume, is not fine", () => {
    const turned = step("ub_check", {}, { symmetrised: false, orientation_change_deg: 0.6 });
    expect(contradictions("The UB is right; the peaks sit on their nodes.", [turned]).map((t) => t.id)).toEqual(["ub"]);
    const symmetrised = step("ub_check", {}, { symmetrised: true, orientation_change_deg: 0 });
    expect(contradictions("The UB is fine: the fit changed nothing.", [symmetrised]).map((t) => t.id)).toEqual(["ub"]);
    const right = step("ub_check", {}, { symmetrised: false, orientation_change_deg: 0.01 });
    expect(contradictions("The UB is right.", [right])).toEqual([]);
  });
});

describe("numbers by reference", () => {
  it("reads numbers as written, not the digits inside names, exponents or list markers", () => {
    const n = writtenNumbers("1. On hk0 the 3D-ΔPDF at 6/mmm: a ring at 7.2 Å⁻¹, 4.1 × 10⁻⁶ of the weight, 12 %, 10⁻³, x_H on a 201x201x201 grid.");
    expect(n.map((x) => x.text)).toEqual(["7.2", "4.1e-6", "12 %", "1e-3"]);
    expect(n[0].tolerance).toBeCloseTo(0.05);
    expect(n[1].value).toBeCloseTo(4.1e-6);
  });

  it("finds each number in the sources within its written precision, as a share or a percentage", () => {
    const sources = '{"at": 7.234, "weight": 4.1e-6, "share": 0.124, "dent": -0.187}';
    expect(untracedNumbers("A ring at 7.2 Å⁻¹ with 4.1e-6 on unmeasured space, 12 % punched, a dent of 0.19.", sources)).toEqual([]);
    expect(untracedNumbers("A ring at 7.5 Å⁻¹, and 23 sharp leftovers.", sources)).toEqual(["7.5", "23"]);
  });

  it("puts the issues to the model, then in a note", () => {
    const issues = answerIssues("The ring removal is clean, at a ratio of 0.731.", [], '{"x": 1}')!;
    expect(issues.missing.map((t) => t.id)).toEqual(["rings"]);
    expect(issues.untraced).toEqual(["0.731"]);
    expect(issuesPrompt(issues)).toMatch(/call assess_stage with stage rings[\s\S]*0\.731/);
    expect(issuesNote(issues)).toBe(
      "Not measured in this reply: the ring removal (assess_stage with stage rings). Not found in any tool result or the context: 0.731.",
    );
    expect(answerIssues("", [], "")).toBeNull();
    expect(answerIssues("Here is what the stages show.", [], "")).toBeNull();
  });
});

// The loop: each streamChat call plays the next scripted reply.
const client = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: client.streamChat,
}));

function script(replies: StreamDelta[][]) {
  const seen: ChatMessage[][] = [];
  client.streamChat.mockImplementation((args: { messages: ChatMessage[] }) => {
    seen.push([...args.messages]);
    const reply = replies.shift() ?? [];
    return (async function* () {
      for (const d of reply) yield d;
    })();
  });
  return seen;
}

const assess: AgentTool = {
  name: "assess_stage",
  description: "judges a stage",
  parameters: { type: "object", properties: { stage: { type: "string" } } },
  run: async () => ({ result: { rings: { verdict: "needs attention", worst_ring_left: { at: 7.2 } } }, summary: "rings judged" }),
};
const ctx = { dataset: { id: "d" } as Dataset, datasets: [] };
const settings = { ...DEFAULT_SETTINGS, model: `m-${Math.random()}` };
const question: ChatMessage[] = [{ role: "user", content: "Is the ring removal clean?" }];
const call = { id: "c1", type: "function" as const, function: { name: "assess_stage", arguments: '{"stage":"rings"}' } };

beforeEach(() => {
  client.streamChat.mockReset();
});

describe("runAgent holds the final answer to its evidence", () => {
  it("sends a verdict without its tool back once, and keeps the answer the tool supports", async () => {
    const seen = script([
      [{ content: "Yes, the ring removal is clean." }],
      [{ toolCalls: [call] }],
      [{ content: "Not clean: a ring is left at 7.2 Å⁻¹, so the stage needs attention." }],
    ]);
    const r = await runAgent({ messages: question, tools: [assess], ctx, settings, signal: new AbortController().signal });
    expect(ANSWER_REVISIONS).toBe(1);
    expect(r.content).toBe("Not clean: a ring is left at 7.2 Å⁻¹, so the stage needs attention.");
    expect(r.note).toBeUndefined();
    const sentBack = seen[1][seen[1].length - 1];
    expect(sentBack.role).toBe("user");
    expect(String(sentBack.content)).toMatch(/verdict on the ring removal without its evidence in this reply: call assess_stage with stage rings/);
  });

  it("notes what still fails after the one revision, and keeps a draft the revision left empty", async () => {
    script([[{ content: "Yes, the ring removal is clean." }], [{ content: "" }]]);
    const r = await runAgent({ messages: question, tools: [assess], ctx, settings, signal: new AbortController().signal });
    expect(r.content).toBe("Yes, the ring removal is clean.");
    expect(r.note).toBe("Not measured in this reply: the ring removal (assess_stage with stage rings).");
  });

  it("checks nothing when told not to, or without tools", async () => {
    script([[{ content: "Yes, the ring removal is clean." }]]);
    const off = await runAgent({ messages: question, tools: [assess], ctx, settings, signal: new AbortController().signal, checkAnswers: false });
    expect(off.note).toBeUndefined();
    script([[{ content: "Yes, the ring removal is clean." }]]);
    const plain = await runAgent({ messages: question, tools: [], ctx, settings, signal: new AbortController().signal });
    expect(plain.note).toBeUndefined();
  });
});

describe("the checks judge what the tools found, and nothing the assistant said", () => {
  it("still catches a contradiction when the model read the result trimmed", async () => {
    // Past MAX_RESULT_CHARS: once cut mid-way, the result parsed as nothing, and
    // "no ring is left" passed against a ring check that needs attention.
    const residuals = Array.from({ length: 90 }, (_, i) => ({ at: 1 + i / 10, residual_fraction: 0.1, noise_fraction: 0.05, significant: true, ring: false }));
    const long: AgentTool = {
      ...assess,
      run: async () => ({ result: { rings: { verdict: "needs attention", per_plane: { hk0: { ring_residuals: residuals } }, goal: "g".repeat(1500) } }, summary: "rings judged" }),
    };
    script([[{ toolCalls: [call] }], [{ content: "No ring is left." }], [{ content: "" }]]);
    const r = await runAgent({ messages: question, tools: [long], ctx, settings, signal: new AbortController().signal });
    expect(r.note).toMatch(/Contradicts the tools' verdict on the ring removal/);
  });

  it("does not take an earlier answer's number as a source, but an earlier tool result's", async () => {
    const earlier: ChatMessage[] = [
      { role: "user", content: "Where is the leftover ring?" },
      { role: "assistant", content: "It is at 9.99 Å⁻¹." },
      { role: "user", content: "And now?" },
    ];
    script([[{ toolCalls: [call] }], [{ content: "A ring is left at 9.99 Å⁻¹." }], [{ content: "" }]]);
    const r = await runAgent({ messages: earlier, tools: [assess], ctx, settings, signal: new AbortController().signal });
    expect(r.note).toMatch(/Not found in any tool result or the context: 9\.99/);
    script([[{ toolCalls: [call] }], [{ content: "A ring is left at 9.99 Å⁻¹." }]]);
    const traced = await runAgent({
      messages: earlier,
      tools: [assess],
      ctx: { ...ctx, earlierResults: ['{"rings":{"worst_ring_left":{"at":9.99}}}'] },
      settings,
      signal: new AbortController().signal,
    });
    expect(traced.note).toBeUndefined();
  });
});

describe("offsets no UB explains", () => {
  it("does not let the UB take the blame when the fit finds it right", () => {
    const shifted = step("ub_check", {}, { symmetrised: false, orientation_change_deg: 0.001, unexplained: true });
    expect(contradictions("The UB is off by half a degree; refine it.", [shifted]).map((t) => t.id)).toEqual(["ub"]);
    expect(contradictions("The peaks sit off their nodes, but the UB is right: the origin moved.", [shifted])).toEqual([]);
  });
});
