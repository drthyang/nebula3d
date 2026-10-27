// Arm C, the validation's Pilot with the skills' switch off (skills.ts), in a
// scripted session through the real agent loop (runAgent), against the
// synthetic crystal behind a mocked API (syntheticCrystal.ts) and a scripted
// model. The session calls every tool arm C is offered, changes and reruns a
// stage that arm B's skill gate holds, asks for a tuning run, repeats a call
// until it is asked to answer, answers in ways the answer checks send back,
// and does it again in a second turn. Everything the model reads in it is held
// to carry none of the method:
//
// - no request (system prompt, messages, tool definitions) and no tool result
//   holds a skill's name, or the word "skill";
// - none holds a sentence of a skill's text whole, of MIN_WORDS words or more;
// - none holds a span of inference written anywhere (inference.ts): the rule
//   the manager set, definitions kept and inference left out;
// - no send-back's own words name a tool of the registry, a stage (evidence.ts,
//   catalog.ts) or a skill: what one quotes is the answer's own words.
//
// Hermetic and synthetic: no model is loaded, no backend or API is called, and
// no measured data is used.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { JobEvent } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { runAgent, toolStepsIn, type AgentResult, type AgentStep } from "../agent";
import { answerIssues, issuesPrompt } from "../answerChecks";
import { loadPipelineContext } from "../context/loadContext";
import type { PipelineContext } from "../context/pipelineContext";
import { armSetup, TASK } from "../evals/validation";
import { writtenInferences } from "../inference";
import { TOOLS } from "../prompts/system";
import { buildChatMessages } from "../prompts/templates";
import type { ChatMessage, StreamDelta, ToolSpec } from "../provider/client";
import { fillReferences } from "../references";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { allSkills, readSkill } from "../skills";
import { callTool, CHAT_TOOLS, toolSpecs, toolsWithSkills, unreadSkillRefusal } from "../tools";
import { BUNCHING_REMEDY, offLatticeBunching } from "../metrics/bunching";
import { describeStageParams, regridRefusal, SAMPLE_PARAMS, sampleFactRefusal, TUNE_STAGES } from "../tune/catalog";
import { buildJudgeMessages, buildProposeMessages, STAGE_GOALS } from "../tune/prompts";
import { BUNCHED_AT_THIRDS, recordOf } from "./helpers";
import { namedInOwnWords, quotations, skillNamesIn, skillSentences, skillSentencesIn, type SkillSentence } from "./methodText";
import { DATASET, DATASETS, freshConsole, installBackend } from "./syntheticCrystal";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchProtectedLabels: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const tuner = vi.hoisted(() => ({ startTuning: vi.fn() }));
vi.mock("../tune/tuner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tune/tuner")>()),
  startTuning: tuner.startTuning,
}));

const model = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: model.streamChat,
}));

/**
 * The shortest skill sentence the check holds a text to. Below seven words a
 * skill's "sentence" is a heading ("Failure modes"), a step's label ("Know the
 * data.") or a checklist item that names a quantity or a check ("the flatten
 * floor, trend and span"), and the Pilot's own definitions name such things in
 * their own right: the ΔPDF's verdict criterion says "the window's weight on
 * unmeasured space" (six words), a skill's checklist item word for word. From
 * seven words up a skill's sentence states a step, a reading or a rule (the
 * shortest: "Never report it as a missed peak."); about 150 of them are that
 * long, and no text of arm C holds one whole. A test below pins the near miss,
 * so the line stays where the data put it.
 */
const MIN_WORDS = 7;

/**
 * The skill's sentences arm B's system prompt holds whole, which arm C's does
 * not: inference the Pilot's own guidance shares with a skill word for word,
 * left out of arm C with the rest of the inference (inference.ts).
 */
const SHARED_WITH_THE_SKILLS = ["reduction-qc: say so, and that the orientation needs the unsymmetrised file"];

/**
 * What arm B's text says with the skills on that the switch takes out: a
 * skill's step said in other words, which no sentence check finds, or the
 * method's next step in a send-back or a refusal. Each must be in arm B's text
 * and in none of arm C's.
 */
const TAKEN_OUT = [
  "after the trust checks", // dpdf_peaks: delta-pdf-interpretation's order
  "(delta-pdf-interpretation)", // dpdf_peaks: the skill's name
  "a rising one wants flattenQ2", // the flatten's goal: reduction-qc's step 6
  "Use it when the shell floors climb", // flattenQ2's help: the same step
  "Raise it toward the data's coverage", // flattenFitQMax's help: the same step
  "a UB error gives the same relative offset", // ub_check: reduction-qc's step 2
  "read the method first: call read_skill", // the skill gate's refusal
  "read the method again: call read_skill", // its refusal in a later turn, for a skill read in an earlier one
  "call assess_stage with stage", // a send-back's next step
  "(e.g. {{assess_stage.flatten.verdict}})", // a send-back's example of a reference
];

// The session drives some forty tool calls over the synthetic crystal through
// the agent loop: about a second locally, more on a slow CI runner. A runner's
// speed is not what this test checks.
const SESSION_TIMEOUT = 60_000;

const label = (s: SkillSentence): string => `${s.skill}: ${s.sentence}`;

beforeAll(() => {
  installBackend(api);
});
afterAll(() => {
  vi.restoreAllMocks();
});

interface Sent {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: string;
}

type Call = [name: string, args: Record<string, unknown>];

// The rerun the session asks for: the flatten and the ΔPDF recomputed, the rest reused.
const RUN_EVENTS: JobEvent[] = [
  { type: "progress", stage: "rings", status: "skip", message: "ring-removed output exists" },
  { type: "progress", stage: "punch", status: "skip", message: "punched output exists" },
  { type: "progress", stage: "backfill", status: "skip", message: "backfilled output exists" },
  { type: "progress", stage: "flatten", status: "done", fraction: 1, message: "floor fitted on 32 shells, with b·Q²" },
  { type: "progress", stage: "pdf", status: "done", fraction: 1, message: "3D-ΔPDF written" },
  { type: "progress", stage: "pdf_check", status: "done", fraction: 1, message: "back-FFT r = 0.99714" },
];

// The first turn's rounds of tool calls: every tool arm C is offered; a change
// and a rerun of the flatten, which arm B's gate holds until its skill is read,
// with the flatten measured only before the rerun; a tuning run; and the same
// call three times after the last change, so the loop points at the first and
// then asks for the answer.
const ROUNDS: Call[][] = [
  [["describe_dataset", {}], ["current_view", {}], ["configure_settings", {}], ["assess_stage", {}]],
  [["assess_stage", { stage: "flatten" }]],
  [["update_settings", { changes: { flattenQ2: true } }]],
  [["run_pipeline", { from_stage: "flatten" }]],
  [["assess_stage", { stage: "rings" }], ["assess_stage", { stage: "punch" }], ["assess_stage", { stage: "backfill" }], ["assess_stage", { stage: "pdf" }]],
  [
    ["measure_reciprocal_cut", { plane: "h0l", value: 1 }],
    ["measure_dpdf_cut", { plane: "xz", value: 0 }],
    ["radial_profile", {}],
    ["line_profile", { stage: "flattened", along: "H", at: { K: 0.5, L: 0 } }],
  ],
  [["texture_check", {}], ["qmax_coverage", {}], ["symmetry_check", {}], ["consistency_details", {}]],
  // The regrid the TASK does not ask for: refused, nothing written (its gate, the same in both arms).
  [["grain_check", {}], ["ub_check", {}], ["regrid_refined_ub", {}], ["bragg_peaks", {}]],
  [["dpdf_contrast", {}], ["dpdf_peaks", {}]],
  [["compare_datasets", { kind: "reciprocal", plane: "hk0", value: 0 }], ["run_log", {}], ["run_verdict", {}]],
  [["tune_pipeline", { stages: ["flatten"], trials_per_stage: 2 }]],
  [["show_in_viewer", { view: "dpdf", plane: "xy", value: 4 }]],
  // A mark resting on dpdf_peaks, measured after the rerun.
  [["mark_region", { where: "pdf", shape: "ellipsoid", center: [4, 0, 0], half_size: [0.8, 0.8, 0.8], label: "the strongest + pair", evidence: ["dpdf_peaks"] }]],
  [["describe_dataset", {}]],
  [["describe_dataset", {}]], // the same call: pointed at the one before
  [["describe_dataset", {}]], // and again: two rounds with nothing new, asked to answer
];

// The first answer: a number from nowhere, a verdict on the flatten measured
// only before the rerun, a ring removal called clean that the checks found
// wanting, the run called a success they do not give, a reference to no field.
const FIRST = [
  "The grid is 97 × 97 × 97 voxels, 93,000 of them with counts.",
  "The flatten left no pedestal.",
  "The ring removal is clean, so the 3D-ΔPDF is ready for analysis.",
  "The leftover ring is {{assess_stage.rings.max_ring_residual}} of the diffuse.",
].join(" ");
const REVISED = "The grid is 97 × 97 × 97 voxels and the cell edge is {{describe_dataset.cell.a}} Å.";

// The second turn: verdicts with no check in that reply, and the run called a
// success; with a number from the first turn's flatten measured before its
// rerun (beforeAll adds it, from the result).
const FOLLOW_UP = "Is there a second grain, and does the ΔPDF keep its symmetry?";
const SECOND = "There is no second grain, and the ΔPDF keeps its six-fold symmetry. The run is ready for analysis.";
const SECOND_REVISED = "Those need checks in this reply; I will run them next.";

/** A round's reply from the scripted model: these calls. */
const scripted = (calls: Call[], round: number): StreamDelta[] => [
  { toolCalls: calls.map(([name, args], i) => ({ id: `r${round}c${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) },
];

let context: PipelineContext;

/** One reply through runAgent with the skills off, as arm C runs it, its model scripted: every request it sent, and what it returned. */
async function reply(messages: ChatMessage[], script: StreamDelta[][], earlierSteps: AgentStep[]): Promise<{ sent: Sent[]; result: AgentResult }> {
  const sent: Sent[] = [];
  model.streamChat.mockImplementation((args: Sent) => {
    sent.push({ messages: [...args.messages], tools: args.tools, toolChoice: args.toolChoice });
    const next = script.shift() ?? [];
    return (async function* () {
      for (const d of next) yield d;
    })();
  });
  const setup = armSetup("C", context);
  // A cloud URL: every tool arm C has is offered with every request, and nothing is shortened.
  const settings: LlmSettings = { ...DEFAULT_SETTINGS, baseUrl: "https://scripted.invalid/v1", model: "scripted", useTools: true, followViews: false };
  const result = await runAgent({
    messages,
    tools: CHAT_TOOLS,
    ctx: { dataset: DATASET, datasets: DATASETS, skills: setup.skills, skillsRead: setup.skillsRead, earlierSteps },
    settings,
    signal: new AbortController().signal,
    maxRounds: ROUNDS.length + 2,
  });
  return { sent, result };
}

/** Every text a request carries: its messages' text and tool calls, and each tool definition offered. */
function textsOf(s: Sent): string[] {
  const texts: string[] = [];
  for (const m of s.messages) {
    if (typeof m.content === "string") texts.push(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) if (p.type === "text") texts.push(p.text);
    for (const c of m.tool_calls ?? []) texts.push(`${c.function.name} ${c.function.arguments}`);
  }
  for (const t of s.tools ?? []) texts.push(t.function.name, t.function.description, JSON.stringify(t.function.parameters));
  return texts;
}

describe("arm C's session, with the skills off", () => {
  let first: { sent: Sent[]; result: AgentResult };
  let second: { sent: Sent[]; result: AgentResult };
  // What the loop said to the model as the user: the send-backs and the note to answer now, with the answer each was about.
  const sentBack: { text: string; answer: string; steps: AgentResult["steps"] }[] = [];
  const requests = () => [...first.sent, ...second.sent];
  const results = () => [...first.result.steps, ...second.result.steps].map((s) => s.result ?? "");

  beforeAll(async () => {
    freshConsole();
    context = (await loadPipelineContext(DATASET)).context;
    usePipelineStore.setState({
      runStages: vi.fn(async () => {
        usePipelineStore.setState({ running: true, events: [] });
        for (const ev of RUN_EVENTS) usePipelineStore.setState((s) => ({ events: [...s.events, ev] }));
        usePipelineStore.setState({ running: false, terminal: "done" });
        return "done";
      }),
    });
    tuner.startTuning.mockImplementation(async () => undefined);

    const opening = armSetup("C", context).messages;
    first = await reply(opening, [...ROUNDS.map(scripted), [{ content: FIRST }], [{ content: REVISED }]], []);

    const history = [
      { role: "user" as const, content: TASK },
      { role: "assistant" as const, content: first.result.content },
    ];
    const earlier = toolStepsIn([first.result]);
    // And a number from the first turn's flatten measured before its rerun: stale in this one.
    const before = first.result.steps.find((s) => s.name === "assess_stage" && s.args.stage === "flatten")!;
    const plane = (JSON.parse(before.result!) as { flatten: { per_plane: { h0l: { after_negative_fraction: number } } } }).flatten.per_plane.h0l;
    const secondAnswer = `${SECOND} On h0l, ${plane.after_negative_fraction} of the voxels were negative.`;
    const followUp = buildChatMessages(context, history, FOLLOW_UP, null, { tools: true, skills: false });
    second = await reply(followUp, [[{ content: secondAnswer }], [{ content: SECOND_REVISED }]], earlier);

    for (const [run, opened, answer] of [
      [first, opening.length, FIRST],
      [second, followUp.length, secondAnswer],
    ] as const) {
      for (const m of run.sent[run.sent.length - 1].messages.slice(opened)) {
        if (m.role === "user") sentBack.push({ text: String(m.content), answer, steps: run.result.steps });
      }
    }
  }, SESSION_TIMEOUT);

  it("ran the session it was scripted to: every tool arm C has, none refused but the regrid the task does not ask for, every kind of send-back, and the note to answer", () => {
    const offered = toolsWithSkills(CHAT_TOOLS, false).map((t) => t.name);
    expect(new Set(first.result.steps.map((s) => s.name))).toEqual(new Set(offered));
    expect(first.result.steps.filter((s) => s.status !== "done").map((s) => `${s.name}: ${s.result}`)).toEqual([`regrid_refined_ub: Error: ${regridRefusal()}`]);
    expect(first.result.steps.filter((s) => s.result?.includes("already_called"))).toHaveLength(2);
    expect(first.result.content).toBe("The grid is 97 × 97 × 97 voxels and the cell edge is 4 Å.");
    expect(second.result.content).toBe(SECOND_REVISED);
    // The change and the tuning arm B's gate would hold went through, and the tuning was handed the switch.
    expect(usePipelineStore.getState().flattenQ2).toBe(true);
    expect(tuner.startTuning).toHaveBeenCalledWith(expect.objectContaining({ stages: ["flatten"], skills: false }));
    // Every kind of send-back, and the note to answer now.
    const all = sentBack.map((s) => s.text).join("\n");
    for (const line of [
      /this verdict needs its evidence from a check run in this reply/,
      /before the last run recomputed what it measured/,
      /the run a success, but the verdict computed from the checks does not give it: the run did not meet its goal/,
      /the run a success, but the verdict computed from the checks does not give it: the checks it rests on did not all run/,
      /These references name no value/,
      /this contradicts the verdict a check computed/,
      /These numbers appear in no tool result/,
      /These numbers were measured before the last run recomputed the outputs they describe/,
      /^The tool calls are bringing nothing new\. Answer now/m,
    ]) {
      expect(all).toMatch(line);
    }
    // Every request offered arm C's tools: never read_skill.
    for (const s of requests()) expect((s.tools ?? []).map((t) => t.function.name)).toEqual(offered);
  });

  it("names no skill in any request or tool result, and never says skill", () => {
    for (const text of [...requests().flatMap(textsOf), ...results()]) {
      expect(skillNamesIn(text), text.slice(0, 200)).toEqual([]);
      expect(text, text.slice(0, 200)).not.toMatch(/\bskills?\b/i);
    }
  });

  it(`holds no sentence of a skill's text of ${MIN_WORDS} words or more in any request or tool result`, () => {
    for (const text of [...requests().flatMap(textsOf), ...results()]) {
      expect(skillSentencesIn(text, MIN_WORDS).map(label), text.slice(0, 200)).toEqual([]);
    }
    // What arm B's system prompt shares with a skill word for word is inference, and arm C's does not hold it.
    expect(skillSentencesIn(TOOLS.whole, MIN_WORDS).map(label)).toEqual(SHARED_WITH_THE_SKILLS);
    expect(skillSentencesIn(TOOLS.definitions, MIN_WORDS)).toEqual([]);
  });

  it("holds none of the inference written anywhere: no span arm B reads that arm C leaves out", () => {
    const spans = writtenInferences()
      .map((e) => e.span.text.trim())
      .filter((t) => t.split(/\s+/).length >= 3);
    expect(spans.length).toBeGreaterThan(60);
    const c = [...requests().flatMap(textsOf), ...results()].join("\n");
    expect(spans.filter((t) => c.includes(t))).toEqual([]);
    // And arm B's opening does hold them: the system prompt's spans.
    const b = String(armSetup("B", context).messages[0].content);
    expect(writtenInferences().filter((e) => e.source.startsWith("prompts/system.ts")).every((e) => b.includes(e.span.text))).toBe(true);
  });

  it("checks most of the skills' text, finds a skill's sentence where there is one, and puts the line where the data do", () => {
    const sentences = skillSentences();
    const checked = sentences.filter((s) => s.words >= MIN_WORDS);
    expect(checked.length).toBeGreaterThanOrEqual(150);
    // A skill's text is found where it is: in arm B's system prompt (the skills' section) and in what read_skill returns.
    const b = String(armSetup("B", context).messages[0].content);
    expect(skillSentencesIn(b, MIN_WORDS).length).toBeGreaterThan(SHARED_WITH_THE_SKILLS.length);
    for (const s of allSkills()) expect(skillSentencesIn(readSkill(s.name), MIN_WORDS).filter((x) => x.skill === s.name).length, s.name).toBeGreaterThan(20);
    // Just below the line, the short sentences arm C's own text holds whole: what the Pilot names in its own right.
    const near = requests()
      .flatMap(textsOf)
      .concat(results())
      .flatMap((t) => skillSentencesIn(t, MIN_WORDS - 2))
      .filter((s) => s.words < MIN_WORDS);
    expect([...new Set(near.map(label))].sort()).toEqual(["reduction-qc: the window's weight on unmeasured space"]);
  });

  it("sends back nothing whose own words name a tool, a stage or a skill; what it quotes is the answer's", () => {
    expect(sentBack.length).toBe(3); // the note to answer now, and a send-back in each turn
    for (const { text, answer, steps } of sentBack) {
      expect(namedInOwnWords(text), text).toEqual([]);
      const filled = fillReferences(answer, steps).text;
      for (const q of quotations(text)) expect(filled.includes(q.replace(/…$/, "")) || answer.includes(q), `“${q}” in ${text}`).toBe(true);
    }
  });

  it("carries none of the restatements the switch takes out of arm B's text, which the sentence check cannot see", () => {
    // Arm B's text, where each restatement of a skill sits with the skills on.
    const issues = answerIssues(FIRST, first.result.steps, results().join("\n"))!;
    const b = [
      JSON.stringify(toolSpecs(CHAT_TOOLS)),
      ...Object.values(STAGE_GOALS),
      describeStageParams("flatten"),
      unreadSkillRefusal("update_settings", { changes: { flattenQ2: true } }, new Set()) ?? "",
      unreadSkillRefusal("update_settings", { changes: { flattenQ2: true } }, new Set(), new Set(["reduction-qc"])) ?? "",
      issuesPrompt(issues),
      issuesPrompt(answerIssues("The reduction is ready for analysis.", [], "")!),
    ].join("\n");
    const c = [...requests().flatMap(textsOf), ...results()].join("\n");
    for (const phrase of TAKEN_OUT) {
      expect(b, phrase).toContain(phrase);
      expect(c, phrase).not.toContain(phrase);
    }
  });

  it("gives the tuning model a trial's ring removal notice without its remedy, and arm B's whole (G1)", () => {
    const definition =
      "4 ring candidates (shells that may be powder rings or the crystal's own scattering) detected but not confirmed at this grid (needs ≥ 1 voxel across 0.16 Å⁻¹); not subtracted.";
    const remedy = "Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract every candidate, the crystal's own shells included.";
    const trials = [{ trial: 1, settings: {}, metrics: { notice: `${definition} ${remedy}`, max_ring_left: null } }];
    const asked = (skills: boolean) =>
      [...buildProposeMessages({ stage: "rings", current: {}, earlier: {}, trials, count: 2, skills }), ...buildJudgeMessages({ stage: "rings", trials, skills })]
        .map((m) => String(m.content))
        .join("\n");
    expect(asked(false)).toContain(`"notice":"${definition}"`);
    expect(asked(false)).not.toContain(remedy);
    expect(asked(true)).toContain(`"notice":"${definition} ${remedy}"`);
  });

  it("asks the tuning model with no skill's name or sentence either, for every stage", () => {
    for (const stage of TUNE_STAGES) {
      const trials = [{ trial: 1, settings: {}, metrics: {} }];
      const prompts = [
        ...buildProposeMessages({ stage, current: {}, earlier: {}, trials, count: 2, skills: false }),
        ...buildJudgeMessages({ stage, trials, skills: false }),
      ];
      for (const m of prompts) {
        const text = String(m.content);
        expect(skillNamesIn(text), stage).toEqual([]);
        expect(skillSentencesIn(text, MIN_WORDS).map(label), stage).toEqual([]);
      }
    }
  });
});

// update_settings refuses a change to a fact about the sample that the user's
// latest message does not name (tune/catalog.ts). Its refusal is the tool's
// own behaviour, the same in both arms: it says what the setting is and what
// to do, and names no skill, no tool, no stage, and no inference.
describe("arm C's refusal of a change to a fact about the sample", () => {
  const offered = toolsWithSkills(CHAT_TOOLS, false);
  const armC = { dataset: DATASET, datasets: DATASETS, skills: false, skillsRead: new Set<string>(), userMessage: TASK };
  const spans = writtenInferences()
    .map((e) => e.span.text.trim())
    .filter((t) => t.split(/\s+/).length >= 3);
  /** What of the method a text holds: a skill's name or sentence, the word skill, a tool's or a stage's name, an inference span. */
  const method = (text: string): string[] => [
    ...skillNamesIn(text),
    ...skillSentencesIn(text, MIN_WORDS).map(label),
    ...namedInOwnWords(text),
    ...spans.filter((t) => text.includes(t)),
  ];

  it("names no skill, tool or stage, and holds no inference, for every fact, alone or beside another change", async () => {
    usePipelineStore.setState({ running: false });
    for (const p of SAMPLE_PARAMS) {
      const value = p.key === "modulation" ? { k: "1/3, 0, 0", form: "planes" } : 1;
      const alone = await callTool(armC, "update_settings", { changes: { [p.key]: value } }, { tools: offered });
      expect(alone.ok).toBe(false);
      expect(alone.text).toBe(`Error: ${sampleFactRefusal(p.key)}`);
      expect(method(alone.text), alone.text).toEqual([]);
      // Beside a change it makes: the refusal is the same words, in its result.
      const beside = await callTool(armC, "update_settings", { changes: { punchMinSig: 7, [p.key]: value } }, { tools: offered });
      expect(beside.ok, beside.text).toBe(true);
      const { refused } = JSON.parse(beside.text) as { refused: { setting: string; why: string }[] };
      expect(refused).toEqual([{ setting: p.key, why: sampleFactRefusal(p.key) }]);
      expect(method(refused[0].why), refused[0].why).toEqual([]);
    }
    expect(spans.length).toBeGreaterThan(60);
  });

  it("reads as arm B's: the refusal is the tool's own, not a skill's", async () => {
    const changes = { changes: { punchSupercellH: 2 } };
    const c = await callTool(armC, "update_settings", changes, { tools: offered });
    const b = await callTool({ ...armC, skills: true, skillsRead: new Set(["bragg-node-audit"]) }, "update_settings", changes);
    expect(b.text).toBe(c.text);
  });
});

// regrid_refined_ub writes a new dataset only when the user's latest message
// asks for a regrid (tune/catalog.ts: namesRegrid). Its description is
// definitions only, so arm C reads it as arm B does, and its refusal is the
// tool's own: it names no skill, tool or stage, and holds no inference.
describe("arm C's regrid", () => {
  const offered = toolsWithSkills(CHAT_TOOLS, false);
  const armC = { dataset: DATASET, datasets: DATASETS, skills: false, skillsRead: new Set<string>(), userMessage: TASK };
  const spans = writtenInferences()
    .map((e) => e.span.text.trim())
    .filter((t) => t.split(/\s+/).length >= 3);

  it("is described in definitions only: arm C reads arm B's description", () => {
    const b = CHAT_TOOLS.find((t) => t.name === "regrid_refined_ub")!;
    const c = offered.find((t) => t.name === "regrid_refined_ub")!;
    expect(b.descriptionWithoutSkills).toBeUndefined();
    expect(c.description).toBe(b.description);
    expect(skillNamesIn(c.description)).toEqual([]);
    expect(c.description).not.toMatch(/\bskills?\b/i);
    expect(skillSentencesIn(c.description, MIN_WORDS).map(label)).toEqual([]);
    expect(spans.filter((t) => c.description.includes(t))).toEqual([]);
  });

  it("is refused for the validation's task, in words that name no skill, tool or stage and hold no inference, as in arm B", async () => {
    usePipelineStore.setState({ running: false });
    const c = await callTool(armC, "regrid_refined_ub", {}, { tools: offered });
    expect(c.ok).toBe(false);
    expect(c.text).toBe(`Error: ${regridRefusal()}`);
    expect([...skillNamesIn(c.text), ...namedInOwnWords(c.text), ...spans.filter((t) => c.text.includes(t))]).toEqual([]);
    expect(c.text).not.toMatch(/\bskills?\b/i);
    const b = await callTool({ ...armC, skills: true, skillsRead: new Set(allSkills().map((s) => s.name)) }, "regrid_refined_ub", {});
    expect(b.text).toBe(c.text);
  });
});

// The question for the user (plan 4.15): a run whose punch record says its
// sharp peaks off the lattice bunch at one commensurate fraction. Arm C reads
// the question as arm B does and its facts without their remedy; an answer
// that neither asks it nor leaves it to the user goes back once, worded
// without the method, and the revision that asks stands.
describe("arm C's question for the user", () => {
  it("reads the question whole and the facts without their remedy, and sends back an answer that assumes it, naming no tool, stage or skill", async () => {
    freshConsole();
    context ??= (await loadPipelineContext(DATASET)).context;
    const real = api.fetchBraggProfile.getMockImplementation()!;
    api.fetchBraggProfile.mockImplementation(async (id: string) => {
      const profile = await real(id);
      return { ...profile, modulation: { ...profile.modulation, bunching: BUNCHED_AT_THIRDS } };
    });
    try {
      const whole = offLatticeBunching(recordOf({ bunching: BUNCHED_AT_THIRDS }))!;
      const assumed = "The sample has a modulation with k = (1/3, 0, 0).";
      const asking = whole.ask_user;
      const opening = armSetup("C", context).messages;
      const { sent, result } = await reply(opening, [scripted([["assess_stage", { stage: "punch" }]], 0), [{ content: assumed }], [{ content: asking }]], []);
      expect(result.content).toBe(asking);
      expect(result.note).toBeUndefined();
      // What arm C read: the question whole, the facts without their remedy.
      const read = JSON.parse(result.steps[0].result!) as { punch: { off_lattice_bunching: { facts: string; ask_user: string } } };
      expect(read.punch.off_lattice_bunching).toEqual({ facts: whole.facts.replace(BUNCHING_REMEDY.text, ""), ask_user: whole.ask_user });
      expect(whole.facts).toContain(BUNCHING_REMEDY.text);
      // No span of inference, no skill, in any request.
      const spans = writtenInferences()
        .map((e) => e.span.text.trim())
        .filter((t) => t.split(/\s+/).length >= 3);
      const texts = sent.flatMap(textsOf);
      expect(spans.filter((t) => texts.some((x) => x.includes(t)))).toEqual([]);
      for (const text of texts) expect(skillNamesIn(text), text.slice(0, 200)).toEqual([]);
      // The send-back: what it lacks and what it says as fact, its own words naming no tool, stage or skill.
      const back = sent[sent.length - 1].messages.slice(opening.length).filter((m) => m.role === "user").map((m) => String(m.content));
      expect(back).toHaveLength(1);
      expect(back[0]).toMatch(/has a question for the user that the answer does not ask/);
      expect(back[0]).toMatch(/as fact what a result in this reply asks the user/);
      expect(namedInOwnWords(back[0])).toEqual([]);
      for (const q of quotations(back[0])) expect(assumed.includes(q), q).toBe(true);
    } finally {
      api.fetchBraggProfile.mockImplementation(real);
    }
  }, SESSION_TIMEOUT);
});
