// What NEBULA Pilot's model sees, written to readable file snapshots
// (__snapshots__/model-visible/): the opening messages the app builds, every
// tool's definition, the other text the model reads (stage goals, verdict
// criteria, the skills' listing, the stage-review and tuning prompts), a sample
// of each tool's result as the executor hands it over, and the text the answer
// checks and the agent loop send back. A diff in a snapshot is a change to what
// the model sees, and is reviewed as one. Update them from web/ with
// `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff
// (-u last: placed before the file, it takes the path as its value and runs
// the whole suite).
//
// Hermetic and synthetic: a made-up cubic crystal (a = 4 Å) behind a mocked
// API (syntheticCrystal.ts), stubbed pipeline and tuning runs, a scripted model
// and a frozen clock. No model is loaded, no backend or API is called, and no
// measured data is used.
//
// Tool results sampled: all 24 tools in CHAT_TOOLS. None skipped. Covered in part:
// - read_skill: one skill's body; not a reference (those are docs/algorithms
//   pages, read as written).
// - run_pipeline, tune_pipeline: the runs are stubs; what is sampled is the
//   tool's own account of a fake run (the stages it ran, the trials it kept).
//
// Arm C (the validation's arm with the skills' switch off, skills.ts) has
// files of its own, *-arm-c.md: what it is offered, and where its text differs
// from arm B's (the tools, a sample of results and goals, the tuning prompt).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { JobEvent } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { runAgent, type AgentStep } from "../agent";
import { answerIssues, issuesPrompt } from "../answerChecks";
import { loadPipelineContext } from "../context/loadContext";
import type { PipelineContext } from "../context/pipelineContext";
import { armSetup, TASK } from "../evals/validation";
import { toolsFor } from "../localTools";
import { SYSTEM, TOOLS } from "../prompts/system";
import { buildChatMessages, buildStageReviewMessages, systemPrompt, type ReviewStage } from "../prompts/templates";
import type { ChatMessage, StreamDelta, ToolCall } from "../provider/client";
import { shorten } from "../readings";
import { fillReferences, NAMED_REFERENCES } from "../references";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { allSkills, skillsPrompt } from "../skills";
import { CHAT_TOOLS, MAX_RESULT_CHARS, runToolCall, toolSpecs, toolsWithSkills, type AgentTool, type ToolContext, type ToolRun } from "../tools";
import { contractDisagreements, TEXT_RESULTS } from "../tools/contracts";
import { currentStageSettings } from "../tune/catalog";
import { buildJudgeMessages, buildProposeMessages, STAGE_GOALS, STAGE_GOALS_WITHOUT_SKILLS, TUNE_SYSTEM } from "../tune/prompts";
import { useTuneStore } from "../tune/tuner";
import { judge, WORDS } from "../verdicts";

// The verdicts' words (verdicts/rules.ts), under the names the snapshot gives them.
const CRITERIA = WORDS.criterion;
const VERDICT_LABEL = WORDS.label;
// What the symmetry's rule says of a volume that declares no symmetry.
const NOT_DECLARED = (asymmetry: number): string => judge("symmetry", { ops: [{ op: "six-fold (60°)", rms_difference: asymmetry }], declared: null }).words ?? "";
import { writtenInferences } from "../inference";
import { namedInOwnWords, quotations } from "./methodText";
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

const SNAPSHOTS = "./__snapshots__/model-visible";
const UPDATE = "Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.";

// A frozen clock that only the stubbed runs move.
let clock = 0;

beforeAll(() => {
  installBackend(api);
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterAll(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- rendering

/** A fence longer than any run of backticks in the text, so the text stays as written. */
function fence(text: string, lang = "text"): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
}

const contentText = (m: ChatMessage): string => (typeof m.content === "string" ? m.content : pretty(m.content));

function renderMessages(messages: ChatMessage[], from = 0): string {
  return messages
    .slice(from)
    .map((m, i) => {
      const id = m.tool_call_id ? ` (answers ${m.tool_call_id})` : "";
      const calls = m.tool_calls?.length ? `\n\nTool calls:\n\n${fence(pretty(m.tool_calls), "json")}` : "";
      return `### ${from + i}. ${m.role}${id}\n\n${fence(contentText(m))}${calls}`;
    })
    .join("\n\n");
}

/** JSON indented two spaces, with a list of plain values kept on one line. */
function pretty(value: unknown, pad = ""): string {
  const inner = `${pad}  `;
  if (Array.isArray(value)) {
    if (value.every((x) => x === null || typeof x !== "object")) return `[${value.map((x) => JSON.stringify(x)).join(", ")}]`;
    return `[\n${value.map((x) => inner + pretty(x, inner)).join(",\n")}\n${pad}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}

/** A result as the model reads it: JSON shown indented (it reads it on one line), anything else as is. */
function showResult(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    // Indenting changes only the whitespace: the one-line form is JSON.stringify's.
    if (JSON.stringify(parsed) === text) return fence(pretty(parsed), "json");
  } catch {
    // not JSON: shown as it is
  }
  return fence(text);
}

const doc = (title: string, intro: string, body: string): string => `# ${title}\n\n${intro}\n\n${UPDATE}\n\n${body}\n`;

// ---------------------------------------------------------------- the opening context

let context: PipelineContext;

beforeAll(async () => {
  freshConsole();
  context = (await loadPipelineContext(DATASET)).context;
});

const QUESTION = "How clean is this reduction?";

// ---------------------------------------------------------------- 1. the opening messages

describe("1. the system prompt and the first user message, as the app builds them", () => {
  const tools = (ts: readonly AgentTool[]) => `Tools offered (${ts.length}): ${ts.map((t) => t.name).join(", ")}.`;

  it("arm B: tools on, skills on (the Pilot as shipped)", async () => {
    const b = armSetup("B", context);
    expect(b.messages).toEqual(buildChatMessages(context, [], TASK, null, { tools: true }));
    await expect(
      doc(
        "Opening messages: tools on, skills on (validation arm B)",
        "`buildChatMessages(context, [], TASK, null, { tools: true })` over the synthetic context, as `armSetup(\"B\")` passes it on; TASK is the validation task (evals/validation.ts). A chat question takes TASK's place in the last message.\n\n" +
          tools(toolsWithSkills(CHAT_TOOLS, b.skills)),
        renderMessages(b.messages),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/1-chat-arm-b.md`);
  });

  it("arm C: tools on, skills off (the skills' switch off)", async () => {
    const b = armSetup("B", context);
    const c = armSetup("C", context);
    // Built with the switch off from the same sections, never cut from B's: without the skills' section, and the
    // others without their inference (inference.ts).
    expect(c.messages[0].content).toBe(systemPrompt({ tools: true, skills: false }));
    expect(c.messages[0].content).toBe(`${SYSTEM.definitions}\n${TOOLS.definitions}`);
    expect(b.messages[0].content).toBe(`${SYSTEM.whole}\n${TOOLS.whole}\n${skillsPrompt()}`);
    // The context: B's, but the search's note, its definition only. The rest is B's.
    const json = (m: ChatMessage) => JSON.parse(/```json\n([\s\S]*)\n```/.exec(String(m.content))![1]) as { bragg_punch: { peak_profile: { search_note: string } } };
    const [bc, cc] = [json(b.messages[1]), json(c.messages[1])];
    expect(cc.bragg_punch.peak_profile.search_note).toBe("peaks the search punched off the Bragg nodes");
    expect(bc.bragg_punch.peak_profile.search_note).toMatch(/; grain_check says whether/);
    expect({ ...cc, bragg_punch: { ...cc.bragg_punch, peak_profile: bc.bragg_punch.peak_profile } }).toEqual(bc);
    expect(c.messages.slice(2)).toEqual(b.messages.slice(2));
    await expect(
      doc(
        "Opening messages: tools on, skills off (validation arm C)",
        "`buildChatMessages(context, [], TASK, null, { tools: true, skills: false })`, as `armSetup(\"C\")` builds them (evals/validation.ts): the skills' switch off (skills.ts), so the system prompt is built without its skills' section, its other sections and the context's prose without their inference (inference.ts; 6-inference.md lists each span left out), and read_skill is not offered. The rest is arm B's.\n\n" +
          tools(toolsWithSkills(CHAT_TOOLS, c.skills)),
        renderMessages(c.messages),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/1-chat-arm-c.md`);
  });

  it("tools off: the fixed-cut metrics only", async () => {
    const messages = buildChatMessages(context, [], QUESTION, null, { tools: false });
    await expect(
      doc(
        "Opening messages: tools off",
        "`buildChatMessages(context, [], question, null, { tools: false })`: what a model reads with Tools off, or one that cannot call tools. No tools are offered.\n\n" +
          "There is no separate system prompt for a local model: it reads the same messages, with fewer tools offered (2-local-tools.md).",
        renderMessages(messages),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/1-chat-tools-off.md`);
  });
});

// ---------------------------------------------------------------- 2. the tools

describe("2. the tools, as sent to the model", () => {
  it("every tool in CHAT_TOOLS, in registry order", async () => {
    const specs = toolSpecs(CHAT_TOOLS);
    const body = specs
      .map(
        (s, i) =>
          `## ${i + 1}. ${s.function.name}\n\n${fence(s.function.description)}\n\nParameters:\n\n${fence(pretty(s.function.parameters), "json")}`,
      )
      .join("\n\n");
    await expect(
      doc(
        "Tool definitions",
        `\`toolSpecs(CHAT_TOOLS)\`: each tool's name, description and parameters' JSON schema, as sent with every request (${specs.length} tools, ${JSON.stringify(specs).length} characters as JSON).`,
        body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/2-tools.md`);
  });

  it("arm C: the tools with the skills off", async () => {
    const b = toolSpecs(CHAT_TOOLS);
    const c = toolSpecs(toolsWithSkills(CHAT_TOOLS, false));
    const of = (name: string) => b.find((s) => s.function.name === name)!;
    // Every tool C is offered is B's, read_skill aside, with B's name and parameters.
    expect(c.map((s) => s.function.name)).toEqual(b.map((s) => s.function.name).filter((n) => n !== "read_skill"));
    for (const s of c) expect(s.function.parameters, s.function.name).toEqual(of(s.function.name).function.parameters);
    const same = c.filter((s) => s.function.description === of(s.function.name).function.description);
    const own = c.filter((s) => !same.includes(s));
    const body = [
      "## Not offered\n\nread_skill: it works only with the skills on (its facts' `needsSkills`).",
      `## As in arm B (2-tools.md)\n\n${same.length} tools, their definitions as 2-tools.md has them: ${same.map((s) => s.function.name).join(", ")}.`,
      ...own.map((s) => `## ${s.function.name}: its description with the skills off\n\n${fence(s.function.description)}\n\nIts parameters are as in 2-tools.md.`),
    ].join("\n\n");
    await expect(
      doc(
        "Tool definitions with the skills off (validation arm C)",
        `\`toolSpecs(toolsWithSkills(CHAT_TOOLS, false))\`: what arm C's model is offered with every request (${c.length} tools, ${JSON.stringify(c).length} characters as JSON). A tool whose description holds inference (inference.ts; 6-inference.md lists each span) has its definitions only (\`descriptionWithoutSkills\`, from the same tagged text), shown in full; every other definition is arm B's.`,
        body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/2-tools-arm-c.md`);
  });

  it("the tools a local model is offered, by question", async () => {
    const questions = [
      ["a generic question", QUESTION],
      ["a ΔPDF question", "What are the strongest pair correlations in the 3D-ΔPDF?"],
      ["a flatten question", "Is there a background left after the flatten?"],
      ["an action request", "Raise the punch significance to 6 and rerun the pipeline."],
    ];
    const body = questions
      .map(([what, q]) => {
        const offered = toolsFor(q, CHAT_TOOLS);
        return `## ${what}\n\n> ${q}\n\n${offered.length} tools: ${offered.map((t) => t.name).join(", ")}.`;
      })
      .join("\n\n");
    await expect(
      doc(
        "Tools offered to a local model",
        "`toolsFor(question, CHAT_TOOLS)` (localTools.ts): a model on a local server is offered these with its first request; a tool it calls by name all the same runs and stays offered. Their definitions are in 2-tools.md.",
        body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/2-local-tools.md`);
  });
});

// ---------------------------------------------------------------- 3. the other text

describe("3. the other text the model reads", () => {
  it("the stage-review prompts", async () => {
    const stages: ReviewStage[] = ["rings", "punch", "backfill", "flatten", "dpdf"];
    const chat = { on: buildChatMessages(context, [], QUESTION, null, { tools: true }), off: buildChatMessages(context, [], QUESTION, null, { tools: false }) };
    const reviews = stages.map((stage) => ({
      stage,
      on: buildStageReviewMessages(context, stage, null, { tools: true }),
      off: buildStageReviewMessages(context, stage, null, { tools: false }),
    }));
    // The system prompt and the context are the chat's (1-chat-*.md).
    for (const r of reviews) {
      expect(r.on.slice(0, 2)).toEqual(chat.on.slice(0, 2));
      expect(r.off.slice(0, 2)).toEqual(chat.off.slice(0, 2));
    }
    const body = [
      `## The assistant's acknowledgement\n\nTools on:\n\n${fence(contentText(reviews[0].on[2]))}\n\nTools off:\n\n${fence(contentText(reviews[0].off[2]))}`,
      ...reviews.map((r) => {
        expect(r.on[2]).toEqual(reviews[0].on[2]);
        expect(r.off[2]).toEqual(reviews[0].off[2]);
        return `## ${r.stage}\n\nTools on:\n\n${fence(contentText(r.on[3]))}\n\nTools off:\n\n${fence(contentText(r.off[3]))}`;
      }),
    ].join("\n\n");
    await expect(
      doc(
        "Stage-review prompts",
        "`buildStageReviewMessages(context, stage, null, { tools })`: the one-click reviews. Their system prompt and context message are the chat's (1-chat-arm-b.md, 1-chat-tools-off.md); the acknowledgement and the instruction follow.",
        body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/3-stage-reviews.md`);
  });

  it("the skills' listing", async () => {
    const readSkill = CHAT_TOOLS.find((t) => t.name === "read_skill")!;
    const names = (readSkill.parameters as { properties: { name: { enum: string[] } } }).properties.name.enum;
    expect(names).toEqual(allSkills().map((s) => s.name));
    await expect(
      doc(
        "The skills' listing",
        "`skillsPrompt()` (skills.ts): appended to the system prompt with tools on (arm B; arm C goes without it). read_skill's `name` takes the same names.",
        `${fence(skillsPrompt())}\n\nread_skill's names: ${names.join(", ")}.`,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/3-skills.md`);
  });

  it("the stage goals, the verdicts' criteria and labels, and the named references", async () => {
    const section = (title: string, entries: Record<string, string>) =>
      `## ${title}\n\n${Object.entries(entries).map(([k, v]) => `### ${k}\n\n${fence(v)}`).join("\n\n")}`;
    const body = [
      section("STAGE_GOALS (tune/prompts.ts): each stage's goal, in assess_stage's single-stage result and the tuning prompts", STAGE_GOALS),
      section("CRITERIA (report/report.ts): the rule behind each verdict, in assess_stage's result as criterion", CRITERIA),
      section("VERDICT_LABEL (report/report.ts): how a verdict reads in the tools' results", VERDICT_LABEL),
      section("NAMED_REFERENCES (references.ts): the references the app fills besides a tool's fields", NAMED_REFERENCES),
      section("NOT_DECLARED (report/report.ts): the symmetry verdict on a volume that declares none, for an asymmetry of 0.02", {
        "NOT_DECLARED(0.02)": NOT_DECLARED(0.02),
      }),
    ].join("\n\n");
    await expect(
      doc("Stage goals and verdict text", "The fixed text the tools' results and the tuning prompts carry.", body),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/3-goals-and-verdicts.md`);
  });

  it("the tuning prompts", async () => {
    const config = usePipelineStore.getInitialState();
    const evaluation = { leftover_at_nodes: 1, leftover_off_lattice_sharp: 0, leftover_off_lattice_broad: 2, mean_punched_fraction: 0.031 };
    const trials = [{ trial: 1, settings: currentStageSettings("punch", config), metrics: evaluation }];
    const propose = buildProposeMessages({
      stage: "punch",
      current: currentStageSettings("punch", config),
      earlier: { rings: currentStageSettings("rings", config) },
      trials,
      count: 2,
    });
    const judge = buildJudgeMessages({
      stage: "punch",
      trials: [
        ...trials,
        { trial: 2, settings: { ...currentStageSettings("punch", config), punchMinSig: 4 }, metrics: { ...evaluation, leftover_at_nodes: 0, mean_punched_fraction: 0.033 } },
      ],
    });
    expect(propose[0].content).toBe(TUNE_SYSTEM);
    await expect(
      doc(
        "Tuning prompts",
        "What tune_pipeline asks the model, stage by stage (tune/prompts.ts), shown for the punch with the default settings and synthetic trials: what to try, then which trial was best.",
        `## What to try\n\n${renderMessages(propose)}\n\n## Which trial was best\n\n${renderMessages(judge)}`,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/3-tuning-prompts.md`);
  });
});

// ---------------------------------------------------------------- 4. the tools' results

interface Sample {
  name: string;
  args: Record<string, unknown> | string; // a string is sent as the arguments' text
  note?: string;
  ctx?: Partial<ToolContext>;
  before?: () => void;
}

const RUN_EVENTS: JobEvent[] = [
  { type: "progress", stage: "rings", status: "skip", message: "ring-removed output exists" },
  { type: "progress", stage: "punch", status: "start", message: "Bragg punch" },
  { type: "progress", stage: "punch", status: "done", fraction: 1, message: "13 peaks punched, 1 below the significance gate" },
  { type: "progress", stage: "backfill", status: "done", fraction: 1, message: "13 holes filled" },
  { type: "progress", stage: "flatten", status: "done", fraction: 1, message: "floor fitted on 32 shells" },
  { type: "progress", stage: "pdf", status: "done", fraction: 1, message: "3D-ΔPDF written" },
  { type: "progress", stage: "pdf_check", status: "done", fraction: 1, message: "back-FFT r = 0.99714" },
];

const SAMPLES: Sample[] = [
  { name: "read_skill", args: { name: "bragg-node-audit" } },
  { name: "describe_dataset", args: {} },
  { name: "current_view", args: {} },
  { name: "measure_reciprocal_cut", args: { plane: "h0l", value: 1 } },
  { name: "measure_dpdf_cut", args: { plane: "xz", value: 0 } },
  { name: "assess_stage", args: {} },
  { name: "assess_stage", args: { stage: "flatten" } },
  { name: "texture_check", args: {} },
  { name: "qmax_coverage", args: {} },
  { name: "symmetry_check", args: {} },
  { name: "dpdf_contrast", args: {} },
  { name: "dpdf_peaks", args: {} },
  { name: "grain_check", args: {} },
  { name: "ub_check", args: {} },
  { name: "radial_profile", args: {} },
  { name: "line_profile", args: { stage: "flattened", along: "H", at: { K: 0.5, L: 0 } } },
  { name: "bragg_peaks", args: {} },
  { name: "consistency_details", args: {} },
  {
    name: "run_log",
    args: {},
    before: () => usePipelineStore.setState({ events: RUN_EVENTS, terminal: "done", running: false }),
  },
  { name: "compare_datasets", args: { kind: "reciprocal", plane: "hk0", value: 0 } },
  { name: "configure_settings", args: {} },
  {
    name: "update_settings",
    args: { changes: { punchMinSig: 6 } },
    note: "with the punch's skill (bragg-node-audit) read in the conversation",
    ctx: { skillsRead: new Set(["bragg-node-audit"]) },
  },
  {
    name: "run_pipeline",
    args: { from_stage: "punch" },
    note: "a stubbed run of 42.3 s",
    before: () =>
      usePipelineStore.setState({
        runStages: vi.fn(async () => {
          usePipelineStore.setState({ running: true, events: [] });
          for (const ev of RUN_EVENTS) usePipelineStore.setState((s) => ({ events: [...s.events, ev] }));
          clock += 42_300;
          usePipelineStore.setState({ running: false, terminal: "done" });
          return "done";
        }),
      }),
  },
  {
    name: "tune_pipeline",
    args: { stages: ["punch"], trials_per_stage: 2 },
    note: "a stubbed tuning run of 5.2 min, the punch's skill read",
    ctx: { skillsRead: new Set(["bragg-node-audit"]) },
    before: () =>
      tuner.startTuning.mockImplementation(async () => {
        clock += 312_000;
        const evaluation = { leftover_at_nodes: 1, leftover_off_lattice_sharp: 0, leftover_off_lattice_broad: 2, mean_punched_fraction: 0.031 };
        useTuneStore.setState({
          active: false,
          finishedNote: "Done. The punch's settings changed; run the pipeline from the punch to write them.",
          stages: [
            {
              stage: "punch",
              tuned: true,
              status: "done",
              best: 2,
              why: "Trial 2 punched the missed node (1 → 0 at nodes) for 0.002 more punched fraction.",
              trials: [
                { n: 1, changes: {}, settings: {}, status: "done", evaluation },
                { n: 2, changes: { punchMinSig: 4 }, settings: {}, status: "done", evaluation: { ...evaluation, leftover_at_nodes: 0, mean_punched_fraction: 0.033 } },
              ],
            },
          ],
        });
      }),
  },
  { name: "show_in_viewer", args: { view: "dpdf", plane: "xy", value: 4 } },
];

// What the executor sends back for a call it cannot run.
const ERRORS: Sample[] = [
  { name: "delete_dataset", args: {}, note: "a tool that does not exist" },
  { name: "measure_reciprocal_cut", args: "{plane: hk0", note: "arguments that are not JSON" },
  { name: "measure_reciprocal_cut", args: { plane: "hk0", value: 7 }, note: "a cut outside the data" },
  { name: "update_settings", args: { changes: { punchMinSig: 6 } }, note: "a change before its stage's skill was read", ctx: { skillsRead: new Set() } },
  { name: "tune_pipeline", args: { stages: ["flatten"] }, note: "tuning before its stage's skill was read", ctx: { skillsRead: new Set() } },
  {
    name: "update_settings",
    args: { changes: { flattenQ2: true } },
    note: "a change in a later turn, its stage's skill read in an earlier one and not in this reply",
    ctx: { skillsRead: new Set(), skillsReadEarlier: new Set(["reduction-qc"]) },
  },
];

async function runSample(s: Sample) {
  freshConsole();
  s.before?.();
  const call: ToolCall = {
    id: "call_1",
    type: "function",
    function: { name: s.name, arguments: typeof s.args === "string" ? s.args : JSON.stringify(s.args) },
  };
  return runToolCall(call, CHAT_TOOLS, { dataset: DATASET, datasets: DATASETS, ...s.ctx });
}

const sampleTitle = (s: Sample): string =>
  `${s.name} ${typeof s.args === "string" ? s.args : JSON.stringify(s.args)}${s.note ? ` (${s.note})` : ""}`;

describe("4. a sample of each tool's result, as the model reads it", () => {
  it("covers every tool", () => {
    expect([...new Set(SAMPLES.map((s) => s.name))].sort()).toEqual(CHAT_TOOLS.map((t) => t.name).sort());
  });

  it("each tool's result text after runToolCall", async () => {
    const parts: string[] = [];
    const compacted: string[] = [];
    for (const s of SAMPLES) {
      const run = await runSample(s);
      expect(run.ok, `${sampleTitle(s)}: ${run.text}`).toBe(true);
      const size = run.full
        ? `${run.text.length} characters sent: trimmed by fitResult from ${run.full.length} to the limit of ${CHAT_TOOLS.find((t) => t.name === s.name)?.maxResultChars ?? MAX_RESULT_CHARS}`
        : `${run.text.length} characters sent`;
      parts.push(`## ${sampleTitle(s)}\n\n${size}.\n\n${showResult(run.text)}`);
      if (s.name === "assess_stage" && !compacted.length) {
        compacted.push(`## ${sampleTitle(s)}\n\n${showResult(shorten(run.text))}`);
      }
    }
    const errors: string[] = [];
    for (const s of ERRORS) {
      const run = await runSample(s);
      expect(run.ok).toBe(false);
      errors.push(`## ${sampleTitle(s)}\n\n${fence(run.text)}`);
    }
    await expect(
      doc(
        "Tool results",
        "Each tool called through `runToolCall` (tools/index.ts) against the synthetic crystal, and the text the model reads back: `ToolRun.text`, after `fitResult` trims a long result to valid JSON. JSON is shown indented; the model reads it on one line, as `JSON.stringify` writes it.",
        `${parts.join("\n\n")}\n\n# Calls the executor refuses\n\n${errors.join("\n\n")}\n\n` +
          "# An older result, shortened\n\nA local model's request past its soft budget has its older results shortened (`compactResult`, compact.ts); the first assess_stage sample above reads so:\n\n" +
          compacted.join("\n\n"),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/4-tool-results.md`);
  });

  it("arm C: a sample of results and goals with the skills off", async () => {
    const tools = toolsWithSkills(CHAT_TOOLS, false);
    const runC = async (s: Sample) => {
      freshConsole();
      s.before?.();
      const call: ToolCall = { id: "call_1", type: "function", function: { name: s.name, arguments: JSON.stringify(s.args) } };
      return runToolCall(call, tools, { dataset: DATASET, datasets: DATASETS, skills: false, skillsRead: new Set(), ...s.ctx });
    };
    const shown = async (s: Sample, why: string) => {
      const run = await runC(s);
      return { run, text: `## ${sampleTitle(s)}\n\n${why}\n\n${showResult(run.text)}` };
    };

    // Every sampled call but read_skill runs in arm C; those whose results carry
    // inference (a goal, a criterion, a verdict's or a reading's words) read
    // otherwise, and are shown whole; the rest read as in arm B.
    const differ: string[] = [];
    for (const s of SAMPLES.filter((x) => x.name !== "read_skill")) {
      const b = await runSample(s);
      const c = await runC(s);
      expect(c.ok, `${sampleTitle(s)}: ${c.text}`).toBe(true);
      if (c.text !== b.text) differ.push(`## ${sampleTitle(s)}\n\n${showResult(c.text)}`);
    }
    expect(differ.map((d) => d.split("\n")[0])).toEqual([
      "## assess_stage {}",
      '## assess_stage {"stage":"flatten"}',
      "## dpdf_peaks {}",
      "## grain_check {}",
    ]);

    // The stages' goals: arm C's, each its definitions only.
    const stages = Object.keys(STAGE_GOALS) as (keyof typeof STAGE_GOALS)[];
    const goals = stages.map((st) =>
      STAGE_GOALS_WITHOUT_SKILLS[st] !== STAGE_GOALS[st] ? `### ${st}\n\n${fence(STAGE_GOALS_WITHOUT_SKILLS[st])}` : `### ${st}\n\nAs in arm B (3-goals-and-verdicts.md).`,
    );

    // A stage's result carries its goal as arm C reads it.
    const flatten = await runC({ name: "assess_stage", args: { stage: "flatten" } });
    expect((JSON.parse(flatten.text) as { flatten: { goal: string } }).flatten.goal).toBe(STAGE_GOALS_WITHOUT_SKILLS.flatten);

    // The calls arm B's skill gate refuses until a skill is read: arm C has no gate, so they run.
    const change = await shown(
      { name: "update_settings", args: { changes: { flattenQ2: true } } },
      "No skill read: arm B's gate refuses it until reduction-qc is read (4-tool-results.md); arm C has none.",
    );
    expect(change.run.ok, change.run.text).toBe(true);
    tuner.startTuning.mockClear();
    const tuning = SAMPLES.find((s) => s.name === "tune_pipeline")!;
    const tune = await shown(
      { ...tuning, ctx: {}, note: "a stubbed tuning run of 5.2 min, no skill read" },
      "No skill read: it runs, and passes the switch on to the tuning prompts.",
    );
    expect(tune.run.ok, tune.run.text).toBe(true);
    expect(tuner.startTuning).toHaveBeenCalledWith(expect.objectContaining({ skills: false }));

    // read_skill, called by name all the same: no tool of this conversation.
    const read = await runC({ name: "read_skill", args: { name: "reduction-qc" } });
    expect(read.ok).toBe(false);

    // The tuning prompt for the flatten, as arm C's tune_pipeline asks it.
    const config = usePipelineStore.getInitialState();
    const propose = buildProposeMessages({
      stage: "flatten",
      current: currentStageSettings("flatten", config),
      earlier: {},
      trials: [{ trial: 1, settings: currentStageSettings("flatten", config), metrics: { max_floor_trend: 0.97, max_floor_span_fraction: 1.2, pedestal_left: true } }],
      count: 2,
      skills: false,
    });
    expect(propose[1].content).toContain(STAGE_GOALS_WITHOUT_SKILLS.flatten);

    await expect(
      doc(
        "Tool results and goals with the skills off (validation arm C)",
        "Arm C's text where it differs from arm B's: the stages' goals, the results that carry inference (a goal, a criterion, a verdict's or a reading's words: inference.ts, 6-inference.md), the calls arm B's skill gate refuses, read_skill called by name, and the tuning prompt for the flatten. Each tool is called through `runToolCall` with the skills' switch off (`skills: false` in its context) and the tools `toolsWithSkills(CHAT_TOOLS, false)` gives; every other sampled result reads as in 4-tool-results.md.",
        [
          `## The stages' goals with the skills off\n\n\`STAGE_GOALS_WITHOUT_SKILLS\` (tune/prompts.ts; \`WORDS.goalWithoutSkills\`, verdicts/rules.ts): in assess_stage's single-stage result and the tuning prompts.\n\n${goals.join("\n\n")}`,
          `# The results that read otherwise\n\n${differ.join("\n\n")}`,
          `# The calls arm B's gate refuses, and read_skill`,
          change.text,
          tune.text,
          `## read_skill {"name":"reduction-qc"} (called by name: it is not offered)\n\n${fence(read.text)}`,
          `## The tuning prompt for the flatten, what to try\n\n\`buildProposeMessages({ stage: "flatten", …, skills: false })\` with a synthetic trial: the goal and the settings' help with the skills off. The system message is TUNE_SYSTEM (3-tuning-prompts.md).\n\n${fence(contentText(propose[1]))}`,
        ].join("\n\n"),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/4-tool-results-arm-c.md`);
  });

  it("each sampled result keeps its tool's contract (tools/contracts.ts), in arm B and in arm C", async () => {
    const toolsC = toolsWithSkills(CHAT_TOOLS, false);
    // The whole result the model reads (the step's `full` where it reads it fitted), as JSON reads it.
    const whole = (name: string, run: ToolRun): unknown => {
      const text = run.full ?? run.text;
      return TEXT_RESULTS.has(name) ? text : JSON.parse(text);
    };
    const problems: string[] = [];
    for (const s of SAMPLES) {
      const b = await runSample(s);
      expect(b.ok, `${sampleTitle(s)}: ${b.text}`).toBe(true);
      problems.push(...contractDisagreements(s.name, whole(s.name, b)).map((d) => `arm B, ${sampleTitle(s)}: ${d}`));
      if (s.name === "read_skill") continue; // not offered in arm C
      freshConsole();
      s.before?.();
      const call: ToolCall = { id: "call_1", type: "function", function: { name: s.name, arguments: JSON.stringify(s.args) } };
      const c = await runToolCall(call, toolsC, { dataset: DATASET, datasets: DATASETS, skills: false, skillsRead: new Set(), ...s.ctx });
      expect(c.ok, `${sampleTitle(s)}: ${c.text}`).toBe(true);
      problems.push(...contractDisagreements(s.name, whole(s.name, c)).map((d) => `arm C, ${sampleTitle(s)}: ${d}`));
    }
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------- 6. what arm C does not read

describe("6. the inference, which arm C does not read", () => {
  it("every span, where it is written, by class, in the text it sits in", async () => {
    const entries = writtenInferences();
    const sources = [...new Set(entries.map((e) => e.source))].sort();
    const kinds = (spans: readonly { kind: string }[]) =>
      ["reading", "evidence", "remedy"].map((k) => [k, spans.filter((s) => s.kind === k).length] as const).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ");
    const body = sources.map((source) => {
      const here = entries.filter((e) => e.source === source);
      const texts = [...new Set(here.flatMap((e) => (e.in ? [e.in] : [])))];
      const loose = here.filter((e) => !e.in);
      const parts = [`## ${source}\n\n${here.length} span${here.length === 1 ? "" : "s"}: ${kinds(here.map((e) => e.span))}.`];
      for (const t of texts) {
        const marked = t.spans
          .map((s) => (typeof s === "string" ? s : "kind" in s ? `⟦${s.kind}: ${s.text}⟧` : `⟨connective: “${s.whole}” → “${s.definitions}”⟩`))
          .join("");
        const joints = t.connectives.length ? ", and each connective that reads otherwise in arm C ⟨connective: “as written” → “in arm C”⟩" : "";
        parts.push(`The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧${joints}:\n\n${fence(marked)}`);
      }
      if (loose.length) {
        parts.push(`Spans of a text built for each call (its numbers vary), each as written:\n\n${loose.map((e) => `- ${e.span.kind}: “${e.span.text}”`).join("\n")}`);
      }
      return parts.join("\n\n");
    });
    const total = kinds(entries.map((e) => e.span));
    await expect(
      doc(
        "The inference arm C does not read",
        "Every span of the text the model reads that is inference (inference.ts), where it is written: which reading or check to use for a conclusion (reading), what a value or a pattern is evidence of (evidence), or what a finding calls for, a change, a check to run next or what to report (remedy). With the skills on (the console, arm B) the text is read whole; with them off (arm C) these spans are left out, and the rest, the definitions, is read as written. A sentence that mixes the two is split at the span; where the definitions left would not read whole, a small connective beside the span gives them the words they need in arm C only. " +
          `${entries.length} spans in ${sources.length} texts or sets: ${total}.`,
        body.join("\n\n"),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/6-inference.md`);
  });
});

// ---------------------------------------------------------------- 5. what is sent back

const step = (name: string, args: Record<string, unknown>, result: unknown): AgentStep => ({
  id: `${name}:${JSON.stringify(args)}`,
  name,
  args,
  status: "done",
  result: JSON.stringify(result),
});

// A rings assessment that needs attention, a flatten run, and a ΔPDF window check.
const RINGS = step("assess_stage", { stage: "rings" }, {
  rings: {
    verdict: VERDICT_LABEL.attention,
    criterion: CRITERIA.rings,
    headline: "ring ratio 0.62 · over-sub ≤ 0.004 · ring dent ≤ 0 · left ≤ 0.12 (hk0, 3.2 Å⁻¹)",
    mean_ring_energy_ratio: 0.62,
    max_over_subtraction_fraction: 0.004,
    max_ring_dent: 0,
    max_ring_left: 0.12,
    worst_ring_left: { plane: "hk0", at: 3.2, residual_fraction: 0.12 },
  },
});
const RERUN = step("run_pipeline", { from_stage: "rings" }, { ended: "done", seconds: 42.3, stages: { rings: "computed", punch: "computed" } });
const COVERED = step("qmax_coverage", {}, { verdict: "clean: the ΔPDF's ellipsoid window puts 2.4e-4 of its weight on unmeasured reciprocal space", window_weight_on_unmeasured: 2.4e-4 });

const REPLIES: { what: string; reply: string; steps: AgentStep[] }[] = [
  {
    what: "an answer that stands on its evidence",
    reply: "The ring removal needs attention: a ring is left at 3.2 Å⁻¹, {{assess_stage.rings.max_ring_left}} of the diffuse there.",
    steps: [RINGS],
  },
  {
    what: "a number from nowhere",
    reply: "The ring removal needs attention: a ring is left at 3.4 Å⁻¹, 0.27 of the diffuse there.",
    steps: [RINGS],
  },
  {
    what: "a reference that names nothing",
    reply: "The ring removal needs attention: a ring is left at 3.2 Å⁻¹, {{assess_stage.rings.max_ring_residual}} of the diffuse there.",
    steps: [RINGS],
  },
  {
    what: "a verdict without its tool",
    reply: "The flatten left no pedestal, and the window stays inside the coverage.",
    steps: [COVERED],
  },
  {
    what: "a verdict from before the last run",
    reply: "The ring removal needs attention: a ring is left at 3.2 Å⁻¹.",
    steps: [RINGS, RERUN],
  },
  {
    what: "a verdict the tool contradicts, and a success the checks do not give",
    reply: "The ring removal is clean, so the 3D-ΔPDF is ready for analysis.",
    steps: [RINGS],
  },
];

// A success the checks did not all measure: shown for arm C, whose wording of it names no stage to measure.
const UNMEASURED = { what: "a success the checks did not all measure", reply: "The reduction is ready for analysis.", steps: [COVERED] };

/** Each canned reply, the send-back its checks give with the skills on or off, as a snapshot section. */
function answerChecksBody(replies: typeof REPLIES, skills: boolean): string {
  return replies
    .map(({ what, reply, steps }) => {
      const sources = steps.map((s) => s.result ?? "").join("\n");
      const issues = answerIssues(reply, steps, sources);
      const tools = steps.map((s) => `${s.name} ${JSON.stringify(s.args)}`).join(", ");
      const sent = issues ? fence(issuesPrompt(issues, { skills })) : "Nothing: the answer goes to the user, its references filled in.";
      return `## ${what}\n\nTools run in the reply: ${tools}.\n\nThe answer:\n\n${fence(reply)}\n\nSent back to the model:\n\n${sent}`;
    })
    .join("\n\n");
}

/** Whether a quotation in a send-back is the answer's own words: a clause of it as the user reads it (clipped), or a reference it wrote. */
const quotesTheAnswer = (q: string, reply: string, steps: AgentStep[]): boolean =>
  fillReferences(reply, steps).text.includes(q.replace(/…$/, "")) || reply.includes(q);

// The scripted reply of 5-agent-loop.md: describe_dataset three times with the
// same arguments, asked to answer, an answer the checks send back, a revision.
const GRID = "The grid is 97 × 97 × 97 voxels and the cell edge is 7.3 Å."; // a number from nowhere

async function loopReply({ skills, answer }: { skills: boolean; answer: string }) {
  freshConsole();
  const seen: { messages: ChatMessage[]; tools: string[]; toolChoice?: string }[] = [];
  const call = (id: string): StreamDelta => ({ toolCalls: [{ id, type: "function", function: { name: "describe_dataset", arguments: "{}" } }] });
  const script: StreamDelta[][] = [
    [call("call_1")],
    [call("call_2")], // the same call again: pointed at the first result
    [call("call_3")], // and again: two rounds with nothing new, asked to answer
    [{ content: answer }],
    [{ content: "The grid is 97 × 97 × 97 voxels and the cell edge is {{describe_dataset.cell.a}} Å." }],
  ];
  model.streamChat.mockImplementation((args: { messages: ChatMessage[]; tools?: { function: { name: string } }[]; toolChoice?: string }) => {
    seen.push({ messages: [...args.messages], tools: (args.tools ?? []).map((t) => t.function.name), toolChoice: args.toolChoice });
    const reply = script.shift() ?? [];
    return (async function* () {
      for (const d of reply) yield d;
    })();
  });
  const messages = buildChatMessages(context, [], "What grid and cell does this dataset have?", null, { tools: true, skills });
  // A cloud URL: no window plan to fetch, every tool offered.
  const settings: LlmSettings = { ...DEFAULT_SETTINGS, baseUrl: "https://scripted.invalid/v1", model: "scripted", useTools: true, followViews: false };
  const result = await runAgent({
    messages,
    tools: CHAT_TOOLS,
    ctx: { dataset: DATASET, datasets: DATASETS, skills, skillsRead: new Set(), earlierResults: [] },
    settings,
    signal: new AbortController().signal,
  });
  expect(seen).toHaveLength(5);
  expect(result.content).toBe("The grid is 97 × 97 × 97 voxels and the cell edge is 4 Å.");
  const requests = seen
    .map((r, i) => `${i + 1}. ${r.messages.length} messages, ${r.tools.length} tools offered${r.toolChoice ? `, tool_choice ${r.toolChoice}` : ""}`)
    .join("\n");
  const added = seen[seen.length - 1].messages.slice(messages.length);
  return { requests, added, body: `## The requests\n\n${requests}\n\n## The conversation after the opening messages, as the last request sent it\n\n${renderMessages(seen[seen.length - 1].messages, messages.length)}` };
}

describe("5. the text sent back to the model", () => {
  it("the answer checks' prompt, for canned replies", async () => {
    expect(answerIssues(REPLIES[0].reply, REPLIES[0].steps, REPLIES[0].steps[0].result!)).toBeNull();
    await expect(
      doc(
        "Answer checks",
        "`answerIssues` and `issuesPrompt` (answerChecks.ts) on canned replies: what the agent loop sends back, once, before a failing answer reaches the user. Each reply's number sources here are its tools' results.",
        answerChecksBody(REPLIES, true),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/5-answer-checks.md`);
  });

  it("arm C: the answer checks' prompt with the skills off", async () => {
    const replies = [...REPLIES, UNMEASURED];
    for (const { what, reply, steps } of replies) {
      const issues = answerIssues(reply, steps, steps.map((s) => s.result ?? "").join("\n"));
      if (!issues) continue;
      const sent = issuesPrompt(issues, { skills: false });
      // Its own words name no tool, stage or skill; what it quotes is the answer's.
      expect(namedInOwnWords(sent), `${what}: ${sent}`).toEqual([]);
      for (const q of quotations(sent)) expect(quotesTheAnswer(q, reply, steps), `${what}: “${q}”`).toBe(true);
      // Every kind of finding arm B's send-back has goes back.
      const kinds: [boolean, RegExp][] = [
        [issues.missing.length > 0, /this verdict needs its evidence from a check run in this reply/],
        [issues.stale.length > 0, /before the last run recomputed what it measured/],
        [issues.overall !== null, /the run a success, but the verdict computed from the checks does not give it/],
        [issues.unknownReferences.length > 0, /These references name no value/],
        [issues.contradicted.length > 0, /this contradicts the verdict a check computed/],
        [issues.untraced.length > 0, /These numbers appear in no tool result/],
      ];
      for (const [found, line] of kinds) expect(line.test(sent), `${what}: ${line}`).toBe(found);
    }
    await expect(
      doc(
        "Answer checks with the skills off (validation arm C)",
        "`issuesPrompt(issues, { skills: false })` (answerChecks.ts) on 5-answer-checks.md's canned replies, and one more: what the agent loop sends back when the skills' switch is off. The checks are arm B's and find the same; the wording names no skill, no stage and no tool to run next. Each finding quotes the answer's own words (“…”) and says what they lack.",
        answerChecksBody(replies, false),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/5-answer-checks-arm-c.md`);
  });

  it("the agent loop's own messages, in a scripted reply", async () => {
    const b = await loopReply({ skills: true, answer: GRID });
    await expect(
      doc(
        "The agent loop's messages",
        "A scripted reply through `runAgent` (agent.ts): the model calls describe_dataset three times with the same arguments, is asked to answer, answers with a number from nowhere, is sent the answer checks' prompt, and answers again. Shown: each request, then the messages the loop added after the opening four (1-chat-arm-b.md).",
        b.body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/5-agent-loop.md`);
  });

  it("arm C: the agent loop's own messages with the skills off", async () => {
    const answer = `${GRID} The flatten left no pedestal.`; // and a verdict no check in the reply settles
    const b = await loopReply({ skills: true, answer });
    const c = await loopReply({ skills: false, answer });
    // The repeated call's pointer and the answer-now note are arm B's; only the send-back is worded apart.
    const sentBack = (added: ChatMessage[]) => added.findIndex((m) => m.role === "user" && String(m.content).startsWith("Before this answer"));
    const at = sentBack(c.added);
    expect(at).toBe(sentBack(b.added));
    expect(c.added.filter((_m, i) => i !== at)).toEqual(b.added.filter((_m, i) => i !== at));
    expect(String(b.added[at].content)).toMatch(/call assess_stage with stage flatten/);
    const sent = String(c.added[at].content);
    expect(namedInOwnWords(sent)).toEqual([]);
    expect(quotations(sent)).toEqual(["The flatten left no pedestal."]);
    // Nothing else the loop says names one either: the answer-now note, the repeated call's pointer.
    for (const m of c.added.filter((x) => x.role === "user" || String(x.content).includes("already_called"))) {
      expect(namedInOwnWords(String(m.content)), String(m.content)).toEqual([]);
    }
    await expect(
      doc(
        "The agent loop's messages with the skills off (validation arm C)",
        "The scripted reply of 5-agent-loop.md through `runAgent` with the skills' switch off (`skills: false` in its context), its first answer one sentence longer: a verdict on the flatten that no check in the reply settles, so the send-back shows arm C's wording. The repeated call's pointer and the answer-now note are arm B's. Shown: each request, then the messages the loop added after the opening four (1-chat-arm-c.md).",
        c.body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/5-agent-loop-arm-c.md`);
  });
});
