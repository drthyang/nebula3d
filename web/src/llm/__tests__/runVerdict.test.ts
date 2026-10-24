// run_verdict (plan 4.6): the verdict on the run as {{achieved}} would give it
// now, so a model reads it before it writes. Through the real agent loop
// (runAgent) with a scripted model, on the synthetic crystal behind a mocked
// API (syntheticCrystal.ts): before any check it says what is not yet judged;
// after the checks its words are {{achieved}}'s, word for word. Its facts, its
// place in the repeat guard, the local offer, and its text with the skills off
// (the validation's arm C).
//
// Hermetic and synthetic: no model is loaded, no backend or API is called, and
// no measured data is used.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent, type AgentResult, type AgentStep } from "../agent";
import { TASK } from "../evals/validation";
import { writtenInferences } from "../inference";
import { toolsFor } from "../localTools";
import type { ChatMessage, StreamDelta } from "../provider/client";
import { fillReferences, resolveReference } from "../references";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { callTool, CHAT_TOOLS, factsOf, toolsWithSkills } from "../tools";
import { STAGE_NAMES, STAGES } from "../verdicts/rules";
import { skillNamesIn } from "./methodText";
import { DATASET, DATASETS, freshConsole, installBackend } from "./syntheticCrystal";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const model = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: model.streamChat,
}));

interface Verdict {
  verdict: string | null;
  achieved: string;
  stages: Record<string, string>;
  needs_attention: string[];
  not_judged: string[];
  not_measured: string[];
  data_problems: string[];
}

type Call = [name: string, args: Record<string, unknown>];

// The checks the system prompt's method asks for, every stage's and those on the result.
const CHECKS: Call[] = [
  ["assess_stage", { stage: "all" }],
  ["qmax_coverage", {}],
  ["symmetry_check", {}],
  ["texture_check", {}],
  ["ub_check", {}],
  ["grain_check", {}],
];

/** One reply through runAgent, its model scripted to call `rounds` one round each and then answer `answer`. */
async function reply(rounds: Call[][], answer: string, skills = true): Promise<AgentResult> {
  const script: StreamDelta[][] = [
    ...rounds.map((calls, r): StreamDelta[] => [
      { toolCalls: calls.map(([name, args], i) => ({ id: `r${r}c${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) },
    ]),
    [{ content: answer }],
  ];
  model.streamChat.mockImplementation(() => {
    const next = script.shift() ?? [];
    return (async function* () {
      for (const d of next) yield d;
    })();
  });
  const messages: ChatMessage[] = [
    { role: "system", content: "You are a scripted test." },
    { role: "user", content: TASK },
  ];
  // A cloud URL: every tool is offered, and nothing is shortened.
  const settings: LlmSettings = { ...DEFAULT_SETTINGS, baseUrl: "https://scripted.invalid/v1", model: "scripted", useTools: true, followViews: false };
  return runAgent({
    messages,
    tools: CHAT_TOOLS,
    ctx: { dataset: DATASET, datasets: DATASETS, skills, skillsRead: new Set(), earlierSteps: [] },
    settings,
    signal: new AbortController().signal,
    checkAnswers: false,
    maxRounds: rounds.length + 2,
  });
}

/** The run_verdict calls that ran (not those the repeat guard pointed at an earlier one), with their place in the reply. */
const verdictsIn = (steps: readonly AgentStep[]) =>
  steps.flatMap((s, i) =>
    s.name === "run_verdict" && s.status === "done" && !s.result!.includes("already_called") ? [{ index: i, step: s, result: JSON.parse(s.result!) as Verdict }] : [],
  );

beforeAll(() => {
  installBackend(api);
});
beforeEach(() => {
  freshConsole();
});

describe("run_verdict on the synthetic crystal, through the agent loop", () => {
  it("says before any check what is not yet judged; after the checks its words are {{achieved}}'s, word for word", async () => {
    const result = await reply([[["run_verdict", {}]], ...CHECKS.map((c) => [c]), [["run_verdict", {}]]], "{{achieved}}");
    expect(result.steps.filter((s) => s.status !== "done").map((s) => `${s.name}: ${s.result}`)).toEqual([]);
    const [before, after] = verdictsIn(result.steps);

    // Before any check: no verdict for {{achieved}} to give, every stage not measured, nothing judged.
    expect(resolveReference("achieved", result.steps.slice(0, before.index))).toBeNull();
    expect(before.result).toEqual({
      verdict: null,
      achieved: "not judged",
      stages: {},
      needs_attention: [],
      not_judged: [],
      not_measured: STAGES.map((s) => STAGE_NAMES[s]),
      data_problems: [],
    });

    // After the checks: {{achieved}}'s words over the steps before it, and the
    // answer's {{achieved}}, filled from the whole reply, is the same.
    expect(after.result.verdict).not.toBeNull();
    expect(after.result.verdict).toBe(resolveReference("achieved", result.steps.slice(0, after.index)));
    expect(after.result.verdict).toBe(result.content);
    expect(after.result.verdict).toBe(result.verdict?.text);
    expect(after.result.verdict!.startsWith(after.result.achieved)).toBe(true);
    // Each stage the checks measured, in the checks' words; what needs attention is what the verdict names.
    expect(Object.keys(after.result.stages)).toEqual(STAGES.filter((s) => result.verdict!.stages[s] !== undefined));
    expect(after.result.needs_attention).toEqual(result.verdict!.attention);
    expect(after.result.not_measured).toEqual(result.verdict!.notMeasured);
    expect(after.result.not_judged).toEqual(result.verdict!.notJudged ?? []);
    expect(after.result.data_problems).toEqual(result.verdict!.dataProblems);
    // The transcript's line is the verdict's words.
    expect(after.step.summary).toBe(after.result.verdict);
  }, 30_000);

  it("is a repeat only while no other call has run since: a check in between reads it again", async () => {
    const result = await reply([[["run_verdict", {}]], [["run_verdict", {}]], [["assess_stage", { stage: "all" }]], [["run_verdict", {}]]], "Done.");
    const named = result.steps.filter((s) => s.name === "run_verdict");
    expect(named.map((s) => s.result?.includes("already_called") ?? false)).toEqual([false, true, false]);
    const [first, last] = verdictsIn(result.steps).map((v) => v.result);
    expect(first.verdict).toBeNull();
    expect(last.verdict).toBe(fillReferences("{{achieved}}", result.steps).text);
  }, 30_000);

  it("reads nothing when the app calls it outside a reply: no check has run", async () => {
    const run = await callTool({ dataset: DATASET, datasets: DATASETS }, "run_verdict");
    expect(run.ok, run.text).toBe(true);
    expect((JSON.parse(run.text) as Verdict).verdict).toBeNull();
    expect(run.summary).toBe("not judged: no check in this reply yet");
  });
});

describe("run_verdict's facts", () => {
  it("reads, on no backend, settles no topic, makes no reply reportable, and reads the reply's own steps", () => {
    const f = factsOf("run_verdict");
    expect(f).toMatchObject({
      acts: null,
      actsOnPipeline: false,
      reachesBackend: false,
      invalidates: [],
      offeredFor: "always",
      reportable: false,
      gate: null,
      needsSkills: false,
      readsReply: true,
    });
    for (const args of [{}, { stage: "all" }, { stage: "flatten" }]) {
      expect(f.settles(args)).toEqual([]);
      expect(f.highlights(args)).toEqual([]);
    }
    // The only tool that reads the reply's own steps.
    expect(CHAT_TOOLS.filter((t) => factsOf(t.name).readsReply).map((t) => t.name)).toEqual(["run_verdict"]);
  });

  it("is offered to a local model for the validation TASK and for a generic question, as for every question", () => {
    for (const q of [TASK, "How clean is this reduction?", "How does it look?", "Is the powder-ring removal clean on this run?"]) {
      expect(toolsFor(q, CHAT_TOOLS).map((t) => t.name), q).toContain("run_verdict");
    }
  });
});

describe("run_verdict with the skills off (arm C)", () => {
  it("is offered, its description the same definitions: no inference, no skill named", () => {
    const b = CHAT_TOOLS.find((t) => t.name === "run_verdict")!;
    const c = toolsWithSkills(CHAT_TOOLS, false).find((t) => t.name === "run_verdict")!;
    expect(c).toBeDefined();
    expect(b.descriptionWithoutSkills).toBeUndefined();
    expect(c.description).toBe(b.description);
    expect(writtenInferences().filter((e) => e.source.includes("run_verdict"))).toEqual([]);
    expect(skillNamesIn(c.description)).toEqual([]);
    expect(c.description).not.toMatch(/\bskills?\b/i);
    // Short: it is sent with every request.
    expect(c.description.length).toBeLessThan(400);
  });

  it("reads in arm C as in arm B: the same words, {{achieved}}'s", async () => {
    const rounds: Call[][] = [...CHECKS.map((c) => [c]), [["run_verdict", {}]]];
    const b = await reply(rounds, "{{achieved}}", true);
    freshConsole();
    const c = await reply(rounds, "{{achieved}}", false);
    const [vb] = verdictsIn(b.steps);
    const [vc] = verdictsIn(c.steps);
    expect(vc.result).toEqual(vb.result);
    expect(vc.result.verdict).toBe(c.content);
  }, 30_000);
});
