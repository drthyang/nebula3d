// How long NEBULA Pilot's worst realistic turn grows, in the tokens the context
// guard counts, against a 32k local context window, held to ceilings by
// component (docs/pilot-context-design.md §5.8).
//
// VERDICT (measured 2026-11-01 with THY-63 R3's core prompt, R4's skill
// cores, THY-59's and THY-60's skill text, and R5's count of read_skill's
// Markdown at 3.0 characters a token, with scripts/measure_pilot_context.sh,
// which counts the same way): UNDER 32k on a local model, with no compaction.
// - The console (Claude, every tool, nothing shortened): the prompt alone is
//   about 20.7k tokens, before the 64,000 Claude reserves for its reply.
// - Arm B on a local model (the validation TASK's offer): about 20.1k + 6,144
//   = 26,210, in every order the skills are read: under the soft budget, so
//   the loop compacts nothing. The stretch goal (inside 32k without
//   compaction) and the 20 % target (26,214, 4 to spare) are both met, and
//   held.
// - A model LM Studio loaded with 32k gets the whole turn, nothing shortened.
// A local live run needs a context of 32k (32,768) or more, the run policy's
// minimum (RUN_POLICY, 56k until 2026-11-02): it holds the whole turn with no
// compaction and the reply reserve, both skills' cores at their cap included,
// and leaves free the POLICY_SPARE (3k) a model-visible addition must leave
// (6.4k now; 4.4k with every ceiling filled). The estimate is conservative: tool results count at the data rate,
// 1.4 characters a token, and read_skill's Markdown at 3.0 (C6), both under
// what local tokenizers measured.
//
// The turn is driven through the real agent loop (runAgent, agent.ts) with a
// scripted model, and every request it sends is counted by the guard's own
// estimator (provider/tokens.ts: baseTokens and estimateTokens, at the
// starting rates, before any server's counts calibrate them). The turn:
// - the opening messages as buildChatMessages builds them for the validation
//   TASK, over the synthetic crystal of modelVisible.test.ts (syntheticCrystal.ts);
// - the tools sent: all of CHAT_TOOLS (the console, Claude), or what a local
//   model is offered for the TASK (localTools.ts), with any tool it calls;
// - the skills as read_skill returns them (THY-63 R4): the two largest
//   skills' cores (head, gates and steps), and of the pages either cites the
//   one with the largest section, its index of sections and that section
//   (each read at most REFERENCE_MAX_CHARS, 4,000 characters);
// - one result of each tool the system prompt's method asks for, as the
//   executor hands it over (runToolCall): the synthetic crystal's, but for
//   dpdf_peaks, whose list a real ΔPDF fills to the tool's default limit
//   where the crystal has a handful of features: the validation's dev
//   control's list at the tool's defaults, on its own grid, recorded from the
//   dev-data bridge (__fixtures__/dpdf-peaks-dev-control.json, written by
//   evals/devData/budgetFixture.replay.test.ts);
// - the reply reserve: the 64,000 tokens anthropic.ts asks of Claude
//   (STREAM_MAX_TOKENS, pinned by anthropic.test.ts), and REPLY_RESERVE for a
//   local run. The local transports send no output cap (no max_tokens, no
//   num_predict), so a local reply runs until the window is full: the window
//   plan keeps REPLY_RESERVE free for it (Ollama's num_ctx is sized to the
//   prompt + REPLY_RESERVE; LM Studio's request is refused only below
//   MIN_REPLY).
//
// A local model's request past SOFT_BUDGET has its older results shortened
// (shorten, readings/), all but the newest KEEP_FULL, so its size depends on
// what was read last: the skills read first, last, and in the method's order
// (each before the checks of its topic) are measured. A model loaded with a
// window too small for a request gets its results shortened down to the
// newest one (window.ts, agent.ts): measured on LM Studio loaded with 32k.
//
// Measurement only: no prompt, skill, tool description or loop setting is
// changed here. The sizes are held to CEILINGS, not pinned: a saving passes
// without an edit here, and a growth past a ceiling fails.
// - Each component of arm B's worst local request (before compaction) has a
//   ceiling: today's size (MEASURED) plus the room RESERVED, by name, for the
//   queued features THY-59 to THY-62 (docs/pilot-context-design.md §5.9).
// - Each configuration's largest prompt has a ceiling: today's (MEASURED_PROMPT)
//   plus every feature's room, so a change in what compaction keeps is caught too.
// A model-visible change that needs more than the room left must cut as much
// elsewhere, take a reserve line by its name (and say so in its PR), or get
// the user's yes to raise the ceiling (docs/development.md, "The Pilot's token
// budget"). The breakdown, the room left by component and the headroom target
// below are printed with the test's output (where vitest detects an AI agent
// it hides a passing test's output: add --reporter=default).
//
// The headroom target, 20 % under 32k for the worst local turn after
// compaction with the reply reserve (§5.8), and the stretch goal (the same
// turn fits 32k without compaction) were tracked with `it.fails` until the
// leaner design (R1-R5) met them; both are enforced now (the stretch goal
// since THY-63 R3 and R4, the target since R5).
//
// Hermetic and synthetic: no model is loaded, no backend or API is called, and
// no measured data is used (the dev control is a synthetic case, its list
// recorded beforehand).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { DpdfFeatures } from "../../api/types";
import { KEEP_FULL, runAgent, SOFT_BUDGET, type AgentStep } from "../agent";
import { finalChecks, FIX_TOOLS, REPORT_TOOLS } from "../auto/controller";
import { AUTO_LIMITS, STAGE_CHECKS, type Call as AutoCall } from "../auto/plan";
import { autoMessages, fixPrompt, REPORT_PROMPT } from "../auto/prompts";
import { loadPipelineContext } from "../context/loadContext";
import type { PipelineContext } from "../context/pipelineContext";
import { armSetup, TASK } from "../evals/validation";
import { RUN_POLICY } from "../evals/validationModels";
import { offeredOn, toolsFor } from "../localTools";
import { buildChatMessages } from "../prompts/templates";
import type { ChatMessage, StreamDelta, ToolSpec } from "../provider/client";
import {
  baseTokens,
  DATA_CHARS_PER_TOKEN,
  estimateTokens,
  MARKDOWN_CHARS_PER_TOKEN,
  MIN_REPLY,
  REPLY_RESERVE,
  resetTokenState,
} from "../provider/tokens";
import { isCompacted, SKILL_CORE_MAX } from "../readings/compact";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { allSkills, DETAILS, headingsOf, readsCore, readSkill, REFERENCE_MAX_CHARS } from "../skills";
import { callTool, CHAT_TOOLS, factsOf, toolSpecs, type AgentTool } from "../tools";
import { STAGE_SKILL } from "../skills";
import { TUNE_PARAMS, TUNE_STAGES } from "../tune/catalog";
import { longestDigest } from "./autoSamples";
import devControlPeaks from "./__fixtures__/dpdf-peaks-dev-control.json";
import { budgetSince } from "./sinceSamples";
import { DATASET, DATASETS, freshConsole, installBackend } from "./syntheticCrystal";

// The dev control's dpdf_peaks list at the tool's defaults, on its own grid,
// recorded from the dev-data bridge (evals/devData/budgetFixture.replay.test.ts).
const DEV_CONTROL_PEAKS = devControlPeaks as unknown as { case: string; n: number; min_sigma: number; limit: number; response: DpdfFeatures };

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
  fetchRingSurvey: vi.fn(),
  fetchBraggSense: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  compareLaueClasses: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
}));
vi.mock("../../api/client", () => api);

// The model is scripted, and LM Studio's report of the window it loaded a
// model with is set per test.
const model = vi.hoisted(() => ({ streamChat: vi.fn(), loadedContext: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: model.streamChat,
  loadedContext: model.loadedContext,
}));

// ---------------------------------------------------------------- the ceilings

const WINDOW = 32_768;
// anthropic.ts's STREAM_MAX_TOKENS: Claude's reply cap on every streamed turn.
const CLAUDE_REPLY = 64_000;

type Component = (typeof ROWS)[number];

// Today's sizes, in estimated tokens (uncalibrated), rounded up: measured
// 2026-11-01 on main df9823a8 (R1 to R3 merged) with THY-63 R4's skill cores,
// and the same in scripts/measure_pilot_context.sh. R3 lowered the system
// prompt (4,453 -> 1,357: the core in place of the metrics' glossary and the
// tools' guidance) and the context (2,382 -> 288: the dataset's summary in
// place of one cut's metrics); the tools offered grew a little (5,554 ->
// 5,584; every definition 6,139 -> 6,169: the cut tools say they return
// fields, and dpdf_contrast's contract took the figure rule). R4 lowered the
// skills read on the worst turn (20,758 -> 9,929: two cores and one section
// of a page, for two whole skills and a page cut at 12,000 characters);
// read_skill's `section` parameter grew the tools by 4. THY-59's skill text
// (reduction-qc's Laue class: its description, two gates and a step's words
// in the core, its section in the details) spent its reserve line: system +6
// (the description), skills +131 (the core). R5 counts read_skill's Markdown
// at 3.0 characters a token, not the data rate's 1.4 (C6), and the core read
// names its references without their descriptions: skills 10,060 -> 4,703,
// and every prompt. THY-60 spent its reserve line (results 270, tools 30) on
// what it uses: skills +33 (bragg-node-audit's gate line and its details'
// new part named in the core), and results +230 held for `ub_turn` in
// assess_stage's punch result (321 characters: a significant turn's verdict
// with its rule and remedy, its numbers and the sweep's before → after),
// which only a turned volume carries, not the synthetic crystal, so the
// measured results and prompts are 230 under these; tools +0. The rest of the
// line (37) is released. THY-62 spent its reserve line (tools 150, results
// 1,400, skills 50) on what it uses, measured on its branch: no tool (the
// phase match rides on assess_stage's rings, as `stage_phases`) and no skill
// text on this turn (reduction-qc's part on it sits in its details); results
// +300 held for `stage_phases` (its line names at most four of each list:
// 420 characters at most, a measured volume's about 175), which only a ring
// record that names a phase carries, not the synthetic crystal, so the
// measured results and prompts are 300 more under these. The rest of the
// line (1,300) is released, after the tools take up the 2 (offered) and 2
// (every definition) est. tokens the 32k run policy's wording added (main
// 2bef34f7), and the skills the fraction of a token past 4,736 they had
// reached, which sat in this line's room.
// Arm B's worst local request, before the loop's compaction, by component:
const MEASURED: Record<Component, number> = { system: 1_363, tools: 5_590, context: 288, skills: 4_737, results: 8_621 };
// Every tool's definition, as the console sends them (Claude).
const MEASURED_ALL_TOOLS = 6_175;
// Each configuration's largest prompt.
const MEASURED_PROMPT = {
  console: 21_181,
  localBefore: 20_596,
  localSkillsFirst: 20_596,
  localMethod: 20_596,
  localSkillsLast: 20_596,
};

// The room held for the queued model-visible features, by component, in
// estimated tokens (docs/pilot-context-design.md §5.9). Each line is spent by
// the feature it names: its PR moves the line's tokens into MEASURED (or
// keeps them here while its tokens are in flight) and states its cost from
// scripts/measure_pilot_context.sh. Results and skills count at the data
// rate (1.4 characters a token), definitions at the prose rate (3.5).
const RESERVED: Record<string, { what: string; room: Partial<Record<Component, number>> }> = {
  "THY-61": {
    what: "ring doublets, measured on its branch: the ring stage's record on assess_stage's rings (stage_shells), +36, paid for by dropping ring_rule's two shares, which repeat the criterion's numbers, −40; net −4 on the synthetic crystal (a real record's line runs to about 140 characters); reduction-qc's codes line sits in its details, not read on this turn",
    room: { results: 150 },
  },
};

const reservedFor = (c: Component): number => Object.values(RESERVED).reduce((sum, r) => sum + (r.room[c] ?? 0), 0);
const RESERVED_ALL = Object.values(RESERVED).reduce((sum, r) => sum + Object.values(r.room).reduce((a, b) => a + (b ?? 0), 0), 0);

// The ceilings: today's size and the room reserved. The tools the TASK is not
// offered reach the console only, so every tool's definition has its own.
const CEILING: Record<Component, number> = {
  system: MEASURED.system + reservedFor("system"),
  tools: MEASURED.tools + reservedFor("tools"),
  context: MEASURED.context + reservedFor("context"),
  skills: MEASURED.skills + reservedFor("skills"),
  results: MEASURED.results + reservedFor("results"),
};
const CEILING_ALL_TOOLS = MEASURED_ALL_TOOLS + reservedFor("tools");
const CEILING_PROMPT = Object.fromEntries(Object.entries(MEASURED_PROMPT).map(([k, v]) => [k, v + RESERVED_ALL])) as Record<
  keyof typeof MEASURED_PROMPT,
  number
>;

// The headroom target (§5.8): the worst local turn after compaction, with the
// reply reserve, in the method order and the skills-last order, fits 80 % of
// 32k. Tracked, not enforced, until R1-R5 land (the header).
const HEADROOM_TARGET = Math.floor(0.8 * WINDOW);

// ---------------------------------------------------------------- the turn

const OLLAMA = DEFAULT_SETTINGS.baseUrl; // a local run's default server
const LM_STUDIO = "http://localhost:1234/v1";
const CLAUDE = "https://api.anthropic.com";

interface Call {
  name: string;
  args: Record<string, unknown>;
}

// One result of each tool the system prompt's method asks for (CORE,
// prompts/system.ts): every stage's verdict, texture_check, qmax_coverage,
// symmetry_check, ub_check and grain_check (its checks), radial_profile for
// the rings, and dpdf_peaks for the correlations the TASK asks for.
const CHECKS: Call[] = [
  { name: "assess_stage", args: { stage: "all" } },
  { name: "qmax_coverage", args: {} },
  { name: "symmetry_check", args: {} },
  { name: "texture_check", args: {} },
  { name: "ub_check", args: {} },
  { name: "grain_check", args: {} },
  { name: "radial_profile", args: {} },
];
const FEATURES: Call = { name: "dpdf_peaks", args: {} };

/**
 * The largest reads of the turn (THY-63 R4: a skill's core by default, the
 * rest on request, each at most REFERENCE_MAX_CHARS): the two largest skills'
 * cores and, of the references either cites, the page whose largest section is
 * largest: its index, then that section's first part. A skill's details, read
 * on request, are one more section of at most REFERENCE_MAX_CHARS: the turn
 * reads one section (docs/pilot-context-design.md C5: "two cores and one
 * section"), the largest a read returns, and the loop's MAX_ROUNDS holds the
 * turn's calls (12: these four reads, the seven checks and dpdf_peaks).
 */
function largestReads(): {
  skills: string[];
  details: { skill: string; chars: number } | null;
  reference: { skill: string; name: string; chars: number; section: string; sectionChars: number };
} {
  const bySize = [...allSkills()].sort((a, b) => readSkill(b.name).length - readSkill(a.name).length);
  const two = bySize.slice(0, 2);
  const details = two
    .filter((s) => s.details)
    .map((s) => ({ skill: s.name, chars: readSkill(s.name, undefined, DETAILS).length }))
    .sort((a, b) => b.chars - a.chars)[0];
  const sections = two.flatMap((s) =>
    s.references.flatMap((r) =>
      headingsOf(r.text).map((h) => ({
        skill: s.name,
        name: r.name,
        chars: readSkill(s.name, r.name).length,
        section: h.heading,
        sectionChars: readSkill(s.name, r.name, h.heading).length,
      })),
    ),
  );
  const reference = sections.sort((a, b) => b.sectionChars - a.sectionChars)[0];
  return { skills: two.map((s) => s.name), details: details ?? null, reference };
}

const LARGEST = largestReads();
const readOf = (name: string, reference?: string, section?: string): Call => ({
  name: "read_skill",
  args: { name, ...(reference ? { reference } : {}), ...(section ? { section } : {}) },
});
const SKILL_WITH_PAGE = LARGEST.reference.skill;
const OTHER_SKILL = LARGEST.skills.find((s) => s !== SKILL_WITH_PAGE)!;
const SKILL_READS: Call[] = [
  readOf(OTHER_SKILL),
  readOf(SKILL_WITH_PAGE),
  readOf(SKILL_WITH_PAGE, LARGEST.reference.name),
  readOf(SKILL_WITH_PAGE, LARGEST.reference.name, LARGEST.reference.section),
];

// The orders the reply may read them in, one call a round.
const ORDERS: Record<"skillsFirst" | "method" | "skillsLast", Call[]> = {
  skillsFirst: [...SKILL_READS, ...CHECKS, FEATURES],
  // Each skill before the checks of its topic: the other skill first, then the
  // one whose page is read, with its page, right before the ΔPDF's features.
  method: [SKILL_READS[0], ...CHECKS, ...SKILL_READS.slice(1), FEATURES],
  skillsLast: [...CHECKS, FEATURES, ...SKILL_READS],
};

let context: PipelineContext;
let opening: ChatMessage[];

beforeAll(async () => {
  installBackend(api);
  // The ΔPDF's strongest features: the dev control's list, as long as the
  // tool's default makes it, where the synthetic crystal has a handful.
  api.fetchDpdfFeatures.mockImplementation(async (id: string) => ({ ...DEV_CONTROL_PEAKS.response, id }));
  freshConsole();
  context = (await loadPipelineContext(DATASET)).context;
  opening = buildChatMessages(context, [], TASK, null, { tools: true });
  // Ollama, asked what the model supports and what it runs with: 128k, and
  // nothing loaded, so the window plan sizes num_ctx to each request.
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/show") return new Response(JSON.stringify({ model_info: { "scripted.context_length": 131_072 } }));
    if (path === "/api/ps") return new Response(JSON.stringify({ models: [] }));
    throw new Error(`no request expected to ${String(url)}`);
  });
});

interface Sent {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  numCtx?: number;
}

/** The reply through runAgent, the model calling `calls` one a round and then answering: every request it sent. */
async function drive(baseUrl: string, calls: Call[], softBudget?: number, messages?: ChatMessage[]) {
  resetTokenState();
  freshConsole();
  const sent: Sent[] = [];
  const script: StreamDelta[][] = [
    ...calls.map((c, i): StreamDelta[] => [
      { toolCalls: [{ id: `call_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] },
    ]),
    [{ content: "The answer." }],
  ];
  model.streamChat.mockImplementation((args: Sent) => {
    sent.push({ messages: [...args.messages], tools: args.tools, numCtx: args.numCtx });
    const reply = script.shift() ?? [];
    return (async function* () {
      for (const d of reply) yield d;
    })();
  });
  const b = armSetup("B", context);
  expect(b.messages).toEqual(opening);
  if (messages) b.messages = messages;
  const settings: LlmSettings = { ...DEFAULT_SETTINGS, baseUrl, model: "scripted", followViews: false };
  const result = await runAgent({
    messages: b.messages,
    tools: CHAT_TOOLS,
    ctx: { dataset: DATASET, datasets: DATASETS, skills: b.skills, skillsRead: b.skillsRead, earlierSteps: [] },
    settings,
    signal: new AbortController().signal,
    // The answer is the reply's, not the prompt's. An answer its checks send
    // back adds a round on top of this turn (the draft and the note): not
    // measured here.
    checkAnswers: false,
    ...(softBudget !== undefined ? { softBudget } : {}),
  });
  const key = `${baseUrl}|${settings.model}`;
  const prompts = sent.map((s) => estimateTokens(baseTokens(s.messages, s.tools), key));
  const peak = prompts.indexOf(Math.max(...prompts));
  return { sent, result, key, prompts, peak };
}

// ---------------------------------------------------------------- the breakdown

const ROWS = ["system", "tools", "context", "skills", "results"] as const;
const ROW_LABEL: Record<(typeof ROWS)[number], string> = {
  system: "system",
  tools: "tools (offered)",
  context: "context + task",
  skills: "skills + page",
  results: "results",
};

/** The calls a conversation made, by id. */
function callsIn(messages: ChatMessage[]): Map<string, Call> {
  const calls = new Map<string, Call>();
  for (const m of messages) {
    for (const c of m.tool_calls ?? []) calls.set(c.id, { name: c.function.name, args: JSON.parse(c.function.arguments) as Record<string, unknown> });
  }
  return calls;
}

/** The results of the calls `pick` chooses, as the request carried them. */
const resultsOf = (s: Sent, pick: (c: Call) => boolean): string[] => {
  const called = callsIn(s.messages);
  return s.messages.flatMap((m) => {
    const c = m.role === "tool" ? called.get(m.tool_call_id ?? "") : undefined;
    return c && pick(c) && typeof m.content === "string" ? [m.content] : [];
  });
};
const isSkillBody = (c: Call): boolean => c.name === "read_skill" && readsCore(c.args);
type Breakdown = Record<(typeof ROWS)[number], number> & { prompt: number; offered: number; numCtx?: number };

/**
 * One request in the estimator's tokens, by part: the system prompt; the tools'
 * definitions; the opening messages after it (the context, the acknowledgement
 * and the task); the read_skill calls and their results; the other calls and
 * their results. `prompt` is the estimator's count of the whole request.
 */
function breakdown(s: Sent, key: string): Breakdown {
  const called = callsIn(s.messages);
  const parts = { system: 0, tools: baseTokens([], s.tools), context: 0, skills: 0, results: 0 };
  s.messages.forEach((m, i) => {
    const tokens = baseTokens([m]);
    const tool = m.role === "tool" ? called.get(m.tool_call_id ?? "")?.name : m.tool_calls?.[0]?.function.name;
    if (i === 0) parts.system += tokens;
    else if (i < opening.length) parts.context += tokens;
    else if (tool === "read_skill") parts.skills += tokens;
    else if (tool) parts.results += tokens;
    else throw new Error(`message ${i} (${m.role}) is in no part`);
  });
  const base = baseTokens(s.messages, s.tools);
  // The parts are the estimator's whole count.
  expect(Math.abs(ROWS.reduce((n, r) => n + parts[r], 0) - base)).toBeLessThan(1e-6);
  return { ...parts, prompt: estimateTokens(base, key), offered: s.tools?.length ?? 0, numCtx: s.numCtx };
}

const n = (x: number): string => Math.round(x).toLocaleString("en-US");

function expectWithin(what: string, measured: number, ceiling: number): void {
  const why =
    `${what}: ${n(measured)} tokens, over its ceiling of ${n(ceiling)} by ${n(measured - ceiling)}. Cut as much elsewhere, ` +
    "take a reserve line by its name (RESERVED in tokenBudget.test.ts, and say so in the PR), or get the user's yes to raise the ceiling " +
    '(docs/development.md, "The Pilot\'s token budget").';
  expect(measured, why).toBeLessThanOrEqual(ceiling);
}

// What the tests measured, printed as one table when they are done.
const columns: { head: [string, string]; b: Breakdown; reserve: number }[] = [];
// Each component's size against its ceiling, and the headroom target's gap.
const room: { what: string; measured: number; ceiling: number }[] = [];
const target: string[] = [];
const notes: string[] = [];

afterAll(() => {
  vi.unstubAllGlobals();
  if (!columns.length) return;
  const cell = (s: string) => s.padStart(22);
  const line = (label: string, cells: string[]) => `${label.padEnd(16)}${cells.map(cell).join("")}`;
  const total = (c: (typeof columns)[number]) => c.b.prompt + c.reserve;
  const table = [
    line("", columns.map((c) => c.head[0])),
    line("", columns.map((c) => c.head[1])),
    ...ROWS.map((r) => line(ROW_LABEL[r], columns.map((c) => (r === "tools" ? `(${c.b.offered}) ${n(c.b.tools)}` : n(c.b[r]))))),
    line("prompt", columns.map((c) => n(c.b.prompt))),
    line("reply reserve", columns.map((c) => n(c.reserve))),
    line("total", columns.map((c) => n(total(c)))),
    line(`vs ${n(WINDOW)}`, columns.map((c) => (total(c) > WINDOW ? `over by ${n(total(c) - WINDOW)}` : `fits, ${n(WINDOW - total(c))} left`))),
  ];
  console.log(
    [
      "NEBULA Pilot's worst turn, in the context guard's estimated tokens (provider/tokens.ts, uncalibrated)",
      `Skills read (their cores): ${LARGEST.skills.join(", ")}; ` +
        `reference page: ${LARGEST.reference.skill} › ${LARGEST.reference.name}, its index (${n(LARGEST.reference.chars)} characters) ` +
        `and its section "${LARGEST.reference.section}" (${n(LARGEST.reference.sectionChars)} characters; a read is at most ${n(REFERENCE_MAX_CHARS)} and a header)` +
        `${LARGEST.details ? `; the larger details, not read here, are ${n(LARGEST.details.chars)} characters (${LARGEST.details.skill}, first part)` : ""}`,
      `Results: ${[...CHECKS, FEATURES].map((c) => c.name).join(", ")}`,
      "",
      ...table,
      "",
      ...notes,
      ...(room.length
        ? [
            "",
            "Ceilings (estimated tokens): today's size, the ceiling, the room left, and the room reserved in it for the queued features:",
            ...room.map(
              (r) => `  ${r.what.padEnd(40)}${n(r.measured).padStart(8)} of ${n(r.ceiling).padStart(7)}, ${n(r.ceiling - r.measured).padStart(6)} left`,
            ),
            ...Object.entries(RESERVED).map(
              ([id, r]) =>
                `  reserved for ${id}: ${Object.entries(r.room)
                  .map(([c, t]) => `${c} ${n(t ?? 0)}`)
                  .join(", ")} (${r.what})`,
            ),
          ]
        : []),
      ...(target.length ? ["", ...target] : []),
    ].join("\n"),
  );
});

// ---------------------------------------------------------------- the measures

// Each case drives whole replies through the agent loop (a dozen requests, each
// counted by the guard's estimator): about a second locally, but near vitest's
// default 5 s on a slow CI runner. A runner's speed is not what this test pins.
const TURN_TIMEOUT = 30_000;

// The run policy's minimum context for a local live run (RUN_POLICY) is the
// 32k window this budget is held to.
const POLICY_MIN = RUN_POLICY.minLocalContextTokens;
// What the worst local turn, with the reply reserve and no compaction, must
// leave free in that window, both skills' cores at their cap included: 3k.
// A model-visible addition that would take it lower needs the user's yes.
const POLICY_SPARE = 3 * 1024;

/** Arm B's turn on a local model, driven once for the tests that read it: before the loop's compaction, and after it in each order. */
let localTurnRuns: Promise<{ before: Awaited<ReturnType<typeof drive>>; after: Record<keyof typeof ORDERS, Awaited<ReturnType<typeof drive>>> }> | undefined;
function localTurn() {
  localTurnRuns ??= (async () => ({
    // Before: the same loop with its soft budget out of reach.
    before: await drive(OLLAMA, ORDERS.method, Infinity),
    // After: the loop as it runs, the skills read in each order.
    after: {
      skillsFirst: await drive(OLLAMA, ORDERS.skillsFirst),
      method: await drive(OLLAMA, ORDERS.method),
      skillsLast: await drive(OLLAMA, ORDERS.skillsLast),
    },
  }))();
  return localTurnRuns;
}

describe("the turn's dpdf_peaks result", () => {
  it("is the dev control's list at the tool's default call", async () => {
    const r = await callTool({ dataset: DATASET, datasets: DATASETS }, "dpdf_peaks", {});
    expect(r.ok, r.text).toBe(true);
    // Recorded for the call the tool makes with its defaults: a new default
    // needs it recorded again (evals/devData/budgetFixture.replay.test.ts).
    expect(api.fetchDpdfFeatures).toHaveBeenLastCalledWith(expect.any(String), DEV_CONTROL_PEAKS.min_sigma, DEV_CONTROL_PEAKS.limit);
    expect([DEV_CONTROL_PEAKS.case, DEV_CONTROL_PEAKS.n]).toEqual(["dev-control", 161]);
    const out = JSON.parse(r.text) as { grouped_by: string; features: unknown[] };
    expect(out.grouped_by).toBe(DEV_CONTROL_PEAKS.response.grouped_by);
    expect(out.features).toHaveLength(DEV_CONTROL_PEAKS.limit);
    notes.push(`dpdf_peaks' result: the ${DEV_CONTROL_PEAKS.case}'s list at n=${DEV_CONTROL_PEAKS.n}, ${out.features.length} entries, ${n(r.text.length)} characters sent.`);
  });
});

describe("NEBULA Pilot's worst turn against a 32k window", () => {
  it("the console: every tool, nothing shortened (Claude)", async () => {
    const run = await drive(CLAUDE, ORDERS.method);
    // Nothing is shortened: the last request, with every result, is the largest.
    expect(run.sent).toHaveLength(ORDERS.method.length + 1);
    expect(run.peak).toBe(run.sent.length - 1);
    const b = breakdown(run.sent[run.peak], run.key);
    // Every tool but the pre-run ones (offeredOn: ring_survey, bragg_sense), which a reply
    // on a dataset after its run is not offered.
    expect(b.offered).toBe(offeredOn(CHAT_TOOLS, DATASET).length);
    expect(CHAT_TOOLS.length - b.offered).toBe(PRE_RUN_TOOLS.length);
    columns.push({ head: ["console (Claude)", "all tools"], b, reserve: CLAUDE_REPLY });
    room.push({ what: "every tool's definition (the console)", measured: b.tools, ceiling: CEILING_ALL_TOOLS });
    expectWithin("every tool's definition, as the console sends them", b.tools, CEILING_ALL_TOOLS);
    expectWithin("the console's prompt", b.prompt, CEILING_PROMPT.console);
  }, TURN_TIMEOUT);

  it("arm B on a local model: the TASK's offer, before and after the loop's compaction", async () => {
    // The tools offered for the TASK; those called all the same join them.
    const offer = toolsFor(TASK, offeredOn(CHAT_TOOLS, DATASET)).map((t) => t.name);
    const called = [...new Set(ORDERS.method.map((c) => c.name))];
    const sentTools = CHAT_TOOLS.filter((t) => offer.includes(t.name) || called.includes(t.name)).length;

    const { before, after } = await localTurn();
    expect(before.peak).toBe(before.sent.length - 1);
    const b = breakdown(before.sent[before.peak], before.key);
    expect(b.offered).toBe(sentTools);
    columns.push({ head: ["arm B, local", "before compaction"], b, reserve: REPLY_RESERVE });
    // Each component under its ceiling, and the whole request under the sum.
    for (const r of ROWS) {
      room.push({ what: ROW_LABEL[r], measured: b[r], ceiling: CEILING[r] });
      expectWithin(`arm B local, before compaction: ${ROW_LABEL[r]}`, b[r], CEILING[r]);
    }
    expectWithin("arm B local, before compaction: prompt", b.prompt, CEILING_PROMPT.localBefore);
    // Since C6 (THY-63 R5) the worst turn stays under the soft budget, so the
    // loop's compaction does not trigger on it: a safety net for longer
    // replies (readings.test.ts and agent.test.ts exercise it). Noted, not
    // held: the ceilings hold the size.
    // The worst local turn, with the reply reserve and no compaction, fits the
    // run policy's minimum context for a local live run, the 32k window, and
    // leaves POLICY_SPARE free there.
    expect(POLICY_MIN, "the run policy's minimum is the window this budget is held to").toBe(WINDOW);
    const worst = b.prompt + REPLY_RESERVE;
    const min = POLICY_MIN;
    expect(worst, `the worst local turn, ${n(worst)} tokens, does not fit the run policy's minimum of ${n(min)}`).toBeLessThanOrEqual(min);
    expect(min - worst, `the worst local turn leaves ${n(min - worst)} of the ${n(POLICY_SPARE)} tokens to spare under ${n(min)}`).toBeGreaterThanOrEqual(POLICY_SPARE);
    // The live-run rule holds everything, both skills' cores grown to their
    // cap (SKILL_CORE_MAX, readings/compact.ts; skillLint.test.ts holds every
    // core under it) included: the turn still leaves the spare under the
    // minimum.
    const coreGrowth = LARGEST.skills.reduce((sum, name) => sum + Math.max(0, SKILL_CORE_MAX - allSkills().find((s) => s.name === name)!.core.length), 0);
    const growthTokens = estimateTokens(coreGrowth / MARKDOWN_CHARS_PER_TOKEN, before.key);
    const gated = worst + growthTokens;
    expect(min - gated, `with both cores at the cap the worst local turn, ${n(gated)} tokens, leaves ${n(min - gated)} under ${n(min)}`).toBeGreaterThanOrEqual(POLICY_SPARE);
    // And with every ceiling filled (the room reserved for the queued features
    // spent): a feature that keeps under its ceiling keeps the spare too.
    const ceiled = CEILING_PROMPT.localBefore + REPLY_RESERVE + growthTokens;
    expect(min - ceiled, `at its ceiling, with both cores at the cap, the worst local turn, ${n(ceiled)} tokens, leaves ${n(min - ceiled)} under ${n(min)}`).toBeGreaterThanOrEqual(
      POLICY_SPARE,
    );

    // After: the loop as it runs, the skills read in each order. The largest
    // request of the reply is what the window must hold.
    const peaks = Object.fromEntries(Object.entries(after).map(([o, run]) => [o, breakdown(run.sent[run.peak], run.key)])) as Record<
      keyof typeof ORDERS,
      Breakdown
    >;
    columns.push({ head: ["arm B, local", "after (method order)"], b: peaks.method, reserve: REPLY_RESERVE });
    expectWithin("arm B local, skills read first: largest prompt", peaks.skillsFirst.prompt, CEILING_PROMPT.localSkillsFirst);
    expectWithin("arm B local, method order: largest prompt", peaks.method.prompt, CEILING_PROMPT.localMethod);
    expectWithin("arm B local, skills read last: largest prompt", peaks.skillsLast.prompt, CEILING_PROMPT.localSkillsLast);

    // What compaction saved on the last request, and where the largest one fell.
    const order = (o: keyof typeof ORDERS) => {
      const run = after[o];
      const last = run.prompts[run.prompts.length - 1];
      return (
        `${o}: largest ${n(run.prompts[run.peak])} (request ${run.peak + 1} of ${run.sent.length}) + ${n(REPLY_RESERVE)} = ` +
        `${n(run.prompts[run.peak] + REPLY_RESERVE)}; last ${n(last)}, ${n(b.prompt - last)} saved; Ollama num_ctx ${n(peaks[o].numCtx ?? 0)}`
      );
    };
    const skillChars = resultsOf(before.sent[before.peak], (c) => c.name === "read_skill").reduce((sum, t) => sum + t.length, 0);
    notes.push(
      `Offered for the TASK (localTools.ts): ${offer.length} of ${CHAT_TOOLS.length} tools; not offered: ${CHAT_TOOLS.filter((t) => !offer.includes(t.name)).map((t) => t.name).join(", ") || "none"}.`,
      `Compaction (agent.ts: past SOFT_BUDGET ${n(SOFT_BUDGET)}, all results but the newest ${KEEP_FULL} shortened), by the order the skills are read:`,
      ...(["skillsFirst", "method", "skillsLast"] as const).map((o) => `  ${order(o)}`),
      `The skills' ${n(skillChars)} characters of Markdown count at ${MARKDOWN_CHARS_PER_TOKEN.toFixed(1)} characters a token (C6, MARKDOWN_CHARS_PER_TOKEN): ` +
        `${n(b.skills)} tokens; at the data rate they counted before R5, about ${n(skillChars / DATA_CHARS_PER_TOKEN)}. ` +
        `The worst turn's largest request, ${n(b.prompt)}, is ${b.prompt > SOFT_BUDGET ? "past" : "under"} the soft budget (${n(SOFT_BUDGET)}): ` +
        `${b.prompt > SOFT_BUDGET ? "the loop compacts" : "no compaction"}.`,
      `Reply reserve: Claude ${n(CLAUDE_REPLY)} (anthropic.ts); a local run ${n(REPLY_RESERVE)} (REPLY_RESERVE: no cap is sent, the window plan keeps it free; ` +
        `a request is refused below MIN_REPLY ${n(MIN_REPLY)}).`,
      `The run policy's minimum for a local live run (RUN_POLICY): ${n(min)}; the worst local turn with the reply reserve, no compaction, ${n(worst)}, leaves ${n(min - worst)} ` +
        `(at least ${n(POLICY_SPARE)} must stay free); with both skills' cores at the cap (${n(SKILL_CORE_MAX)} characters each) it is ` +
        `${n(gated)}, leaving ${n(min - gated)}; at its ceiling as well, ${n(ceiled)}, leaving ${n(min - ceiled)}.`,
    );
  }, TURN_TIMEOUT);

  it("on LM Studio loaded with 32k: the whole turn fits the window, and nothing is shortened", async () => {
    model.loadedContext.mockResolvedValue({ loaded: WINDOW, max: 131_072 });
    const run = await drive(LM_STUDIO, ORDERS.method);
    // Every request is sent (none refused), each leaving at least MIN_REPLY.
    expect(run.result.note).toBeUndefined();
    expect(run.sent).toHaveLength(ORDERS.method.length + 1);
    for (const p of run.prompts) expect(p + MIN_REPLY).toBeLessThanOrEqual(WINDOW);
    // Since C6 (THY-63 R5) each request is the one the loop sends without a
    // window guard: under the soft budget, nothing is compacted, and the
    // window guard, which shortens a request without MIN_REPLY free down to
    // its newest result, has nothing to do.
    const { after } = await localTurn();
    expect(run.prompts).toEqual(after.method.prompts);
    const last = run.sent[run.sent.length - 1];
    const bodies = resultsOf(last, isSkillBody);
    expect(bodies).toHaveLength(2);
    expect(bodies.map(isCompacted)).toEqual([false, false]);
    const b = breakdown(run.sent[run.peak], run.key);
    // Both skills' cores grown to their cap (SKILL_CORE_MAX, readings/compact.ts)
    // still leave the largest request MIN_REPLY. (Before the skill cores, two
    // skills gated at the cap needed more than 32k: review finding P5.3b,
    // 2026-10-24.)
    const growth = LARGEST.skills.reduce((sum, name) => sum + Math.max(0, SKILL_CORE_MAX - allSkills().find((s) => s.name === name)!.core.length), 0);
    const bothAtCap = b.prompt + estimateTokens(growth / MARKDOWN_CHARS_PER_TOKEN, run.key) + MIN_REPLY;
    expect(bothAtCap, `both skills' cores at the cap: ${n(bothAtCap)} tokens with MIN_REPLY, in a window of ${n(WINDOW)}`).toBeLessThanOrEqual(WINDOW);
    // No ceiling of its own: the window-fit checks above bound this prompt
    // more tightly than any ceiling would.
    columns.push({ head: ["LM Studio at 32k", "nothing shortened"], b, reserve: REPLY_RESERVE });
    notes.push(
      `LM Studio loaded with ${n(WINDOW)} (window.ts, agent.ts): every request fits with MIN_REPLY free, and nothing is shortened. ` +
        `Largest sent ${n(b.prompt)} (request ${run.peak + 1} of ${run.sent.length}), ${n(WINDOW - b.prompt)} left for the reply. ` +
        `Both skills' cores at the cap (${n(SKILL_CORE_MAX)} characters each) leave ${n(WINDOW - bothAtCap)} to spare past MIN_REPLY.`,
    );
  }, TURN_TIMEOUT);
});

// The pre-run tools (THY-43: ring_survey), offered only on a dataset before
// its run (their facts' preRun, localTools.ts offeredOn): a reply on
// a dataset after its run, the worst turn and every turn the ceilings above
// hold among them, never carries them, so they sit outside those ceilings.
// A reply that starts before the run carries the survey's definition on
// every request, and its result once it is called (and, called by name after
// a run, the same): both are held to a ceiling of their own here, the result
// at its longest (survey_lines with every list at its four named and a
// count, the phase's line at the 420 characters THY-62 allows it). Measured
// 2026-11-08 on the branch feat/pre-run-ring-survey: the definition 132
// est. tokens, the result at its longest 530, the synthetic crystal's 132;
// and reduction-qc's part for before a run (skills.ts BEFORE_A_RUN), which
// read_skill gives with the core on a dataset before its run only, 246.
// The worst turn with both on it is printed against the 20 % target, not
// held: that turn is a reply after a run, which is never offered the survey.
// A reply that starts before the run and runs it (the validation TASK on a
// fresh dataset) does carry them: 132 a request, the result once, and the
// skill's part where it reads reduction-qc before the run.
const PRE_RUN_TOOLS = CHAT_TOOLS.filter((t) => factsOf(t.name).preRun).map((t) => t.name);
const PRE_RUN_CEILING = { definition: 132, result: 530, skill: 246 };
// The survey's lines at their longest (nebula3d.preprocessing.ring_survey.survey_lines).
const LONGEST_SURVEY_LINES = {
  al: "a=4.0406 Å; lines 111 2.69, 200 3.11, 220 4.39, 311 5.17, +12 more",
  phases:
    "possibly Te or Bi: 4 of 7 rings matched, scale -0.4 %; lines 012 1.92, 104 2.27, 110 2.36, 202 3.38, +3 more; hidden 104 under Al111, 110 under Al111, 202 under a crystal shell, 116 under Al220, +1 more; missing 015 2.96, 107 3.73; unmatched 3.60, 4.85, 5.62, 8.91, +2 more; needs 2.5× the Al's volume; also Sn (possible), Cu (possible)",
  unrecognized: "3.60 (snr 85, removed), 4.85 (snr 31, removed), 5.62 (snr 12, faint, kept), 8.91 (snr 9, faint, kept), +2 more",
  unconfirmed: "9.99 (snr 12, flank), 7.31 (snr 8, grid), 6.02 (snr 7, cells), 2.11 (snr 6, flank), +1 more",
  removal: "would remove 19 (Al 14, phase 3, unrecognized 2); keep 7 (3 not rings)",
};

describe("before a run: the pre-run survey (THY-43), held off the worst turn", () => {
  it("is offered on a dataset before its ring stage runs only, and its definition and result keep to their own ceiling", async () => {
    expect(PRE_RUN_TOOLS).toEqual(["ring_survey", "bragg_sense"]);
    const before = { ...DATASET, stages: DATASET.stages.map((st) => (st.name === "raw" ? st : { ...st, exists: false })) };
    expect(offeredOn(CHAT_TOOLS, before).map((t) => t.name)).toEqual(CHAT_TOOLS.map((t) => t.name));
    expect(offeredOn(CHAT_TOOLS, DATASET).map((t) => t.name)).toEqual(CHAT_TOOLS.filter((t) => !PRE_RUN_TOOLS.includes(t.name)).map((t) => t.name));
    const survey = CHAT_TOOLS.find((t) => t.name === "ring_survey")!;
    const definition = baseTokens([], toolSpecs([survey]));
    const asResult = (text: string) => baseTokens([{ role: "tool", tool_call_id: "s", content: text }]) - baseTokens([{ role: "tool", tool_call_id: "s", content: "" }]);
    const r = await callTool({ dataset: before, datasets: DATASETS }, "ring_survey", {});
    expect(r.ok, r.text).toBe(true);
    const crystal = asResult(r.text);
    const longest = asResult(JSON.stringify(LONGEST_SURVEY_LINES));
    // The skill's part for before a run (BEFORE_A_RUN), read with reduction-qc's core on a dataset before its run.
    const skill = (readSkill("reduction-qc", undefined, undefined, { beforeRun: true }).length - readSkill("reduction-qc").length) / MARKDOWN_CHARS_PER_TOKEN;
    room.push({ what: "reduction-qc's part for before a run", measured: skill, ceiling: PRE_RUN_CEILING.skill });
    expectWithin("reduction-qc's part for before a run", skill, PRE_RUN_CEILING.skill);
    room.push({ what: "the pre-run survey's definition", measured: definition, ceiling: PRE_RUN_CEILING.definition });
    room.push({ what: "the pre-run survey's result, at its longest", measured: longest, ceiling: PRE_RUN_CEILING.result });
    expectWithin("the pre-run survey's definition (ring_survey)", definition, PRE_RUN_CEILING.definition);
    expectWithin("the pre-run survey's result at its longest", longest, PRE_RUN_CEILING.result);
    expect(crystal).toBeLessThan(longest);
    const { before: worst } = await localTurn();
    const withSurvey = worst.prompts[worst.peak] + definition + skill + longest + REPLY_RESERVE;
    target.push(
      `Before a run (THY-43): the survey's definition ${n(definition)} est. tokens on every request of a reply that starts before a run, reduction-qc's part for before a run ${n(skill)} with its core, its result ${n(crystal)} ` +
        `on the synthetic crystal, ${n(longest)} at its longest. Were a reply after a run ever to carry both, the worst local turn would be ${n(withSurvey)} with the reply reserve, ` +
        `against the 20 % target's ${n(HEADROOM_TARGET)}: ${withSurvey > HEADROOM_TARGET ? `over by ${n(withSurvey - HEADROOM_TARGET)}` : "met"}; it never is (offeredOn, readSkill's beforeRun).`,
    );
  }, TURN_TIMEOUT);
});

// The pre-run Bragg sensing (THY-43: bragg_sense), held off the worst turn the
// same way: offered before a run only, its definition on every request of a
// reply that starts before one, its result once, and bragg-node-audit's part
// for before a run with that skill's core. Its own ceilings, measured
// 2026-11-08 on feat/bragg-sensing: the definition 140 est. tokens, the result
// at its longest 653 (every line at its longest: a symmetry to declare, the
// |Q| line, the recommendation), the synthetic crystal's 549, the skill's part
// 123. A reply that starts before the run (the validation TASK on a fresh
// dataset) carries both pre-run tools' definitions and both skills' parts.
const SENSE_CEILING = { definition: 140, result: 653, skill: 123 };
// The sensing's lines at their longest (nebula3d.analysis.bragg_sense.sense_lines).
const LONGEST_SENSE_LINES = {
  shape: "1999 strong nodes on 6 sections: 100.0 % tilted and elongated, 100.0 % with several lobes; the fit's cap binds on 100.0 %",
  left: "median share each footprint leaves: own 100.0 %, ellipsoid 100.0 % (1.59× own's area), ellipsoid_unc 100.0 % (1.59× own's area)",
  footprint: "punchFootprint own (keep): the ellipsoid unconstrained leaves 100.0 points more than own; tilted + lobed 200.0 %; 1.59× own's area",
  constraints: "punchFitUnconstrained true: the cap binds on 100.0 %; unconstrained leaves 100.0 points less, 1.24× the constrained area",
  q: "own leaves 100.0 % in the lowest |Q| quarter, 100.0 % in the highest (core FWHM 0.1234 → 0.1234 Å⁻¹): a reach growing with |Q|, which no setting follows",
  symmetry: "declares none, yet every axis mirror holds to 1.0e-03 of the spread: symmetrised already; declaring mmm is the user's",
  recommend: { punchFootprint: "ellipsoid", punchFitUnconstrained: true },
};

describe("before a run: the pre-run Bragg sensing (THY-43), held off the worst turn", () => {
  it("is offered before a run only, and its definition, result and skill part keep to their own ceiling", async () => {
    const before = { ...DATASET, stages: DATASET.stages.map((st) => (st.name === "raw" ? st : { ...st, exists: false })) };
    expect(offeredOn(CHAT_TOOLS, DATASET).map((t) => t.name)).not.toContain("bragg_sense");
    expect(offeredOn(CHAT_TOOLS, before).map((t) => t.name)).toContain("bragg_sense");
    const sense = CHAT_TOOLS.find((t) => t.name === "bragg_sense")!;
    const definition = baseTokens([], toolSpecs([sense]));
    const asResult = (text: string) => baseTokens([{ role: "tool", tool_call_id: "s", content: text }]) - baseTokens([{ role: "tool", tool_call_id: "s", content: "" }]);
    const r = await callTool({ dataset: before, datasets: DATASETS }, "bragg_sense", {});
    expect(r.ok, r.text).toBe(true);
    const crystal = asResult(r.text);
    const longest = asResult(JSON.stringify(LONGEST_SENSE_LINES));
    // bragg-node-audit's part for before a run (BEFORE_A_RUN), read with its core on a dataset before its run.
    const skill = (readSkill("bragg-node-audit", undefined, undefined, { beforeRun: true }).length - readSkill("bragg-node-audit").length) / MARKDOWN_CHARS_PER_TOKEN;
    room.push({ what: "bragg-node-audit's part for before a run", measured: skill, ceiling: SENSE_CEILING.skill });
    room.push({ what: "the pre-run sensing's definition", measured: definition, ceiling: SENSE_CEILING.definition });
    room.push({ what: "the pre-run sensing's result, at its longest", measured: longest, ceiling: SENSE_CEILING.result });
    expectWithin("bragg-node-audit's part for before a run", skill, SENSE_CEILING.skill);
    expectWithin("the pre-run sensing's definition (bragg_sense)", definition, SENSE_CEILING.definition);
    expectWithin("the pre-run sensing's result at its longest", longest, SENSE_CEILING.result);
    expect(crystal).toBeLessThan(longest);
  }, TURN_TIMEOUT);
});

// THE PRE-RUN EXCEPTION (THY-43, accepted by the user 2026-11-08). A reply
// that starts on a dataset before its run is offered both pre-run tools
// (ring_survey, bragg_sense: their definitions on every request), reads both
// skills' parts for before a run with their cores, and may hold both tools'
// results. No reply after a run carries any of it, so the 20 % target, held
// above on the worst turn after a run, does not hold this one: here it is
// TRACKED against the target (printed, over or under), and ENFORCED under the
// run policy's 32k window with POLICY_SPARE free, as the worst turn is (both
// skills' cores at their cap included). Built as an upper bound: the worst
// local turn after a run, before compaction, with all of it added on top,
// each result at its longest. Measured 2026-11-08: 28,014 with the reply
// reserve, 1,800 over the target, 4,754 under 32k (4,595 with both cores at
// their cap, 1,523 past the spare).
describe("before a run: the pre-run tools together (THY-43), a tracked exception", () => {
  it("is tracked against the 20 % target and fits 32k with POLICY_SPARE free, both cores at the cap included", async () => {
    expect(PRE_RUN_TOOLS).toEqual(["ring_survey", "bragg_sense"]);
    const asResult = (text: string) => baseTokens([{ role: "tool", tool_call_id: "s", content: text }]) - baseTokens([{ role: "tool", tool_call_id: "s", content: "" }]);
    const definitions = baseTokens([], toolSpecs(CHAT_TOOLS.filter((t) => PRE_RUN_TOOLS.includes(t.name))));
    const part = (name: string) => (readSkill(name, undefined, undefined, { beforeRun: true }).length - readSkill(name).length) / MARKDOWN_CHARS_PER_TOKEN;
    const skills = part("reduction-qc") + part("bragg-node-audit");
    const results = asResult(JSON.stringify(LONGEST_SURVEY_LINES)) + asResult(JSON.stringify(LONGEST_SENSE_LINES));
    const { before: worst } = await localTurn();
    const turn = worst.prompts[worst.peak] + definitions + skills + results + REPLY_RESERVE;
    const coreGrowth = LARGEST.skills.reduce((sum, name) => sum + Math.max(0, SKILL_CORE_MAX - allSkills().find((sk) => sk.name === name)!.core.length), 0);
    const gated = turn + estimateTokens(coreGrowth / MARKDOWN_CHARS_PER_TOKEN, worst.key);
    target.push(
      `Before a run (THY-43, a tracked exception): both pre-run tools' definitions ${n(definitions)}, both skills' parts for before a run ${n(skills)}, both results at their longest ${n(results)}: ` +
        `the turn is ${n(turn)} with the reply reserve, against the 20 % target's ${n(HEADROOM_TARGET)}: ${turn > HEADROOM_TARGET ? `over by ${n(turn - HEADROOM_TARGET)} (tracked, not held)` : "met"}; ` +
        `against 32k with ${n(POLICY_SPARE)} free (held): ${n(POLICY_MIN - turn)} left, ${n(POLICY_MIN - gated)} with both cores at the cap.`,
    );
    expect(POLICY_MIN - turn, `the pre-run turn, ${n(turn)} tokens, leaves ${n(POLICY_MIN - turn)} under ${n(POLICY_MIN)}`).toBeGreaterThanOrEqual(POLICY_SPARE);
    expect(POLICY_MIN - gated, `the pre-run turn with both cores at the cap, ${n(gated)} tokens, leaves ${n(POLICY_MIN - gated)} under ${n(POLICY_MIN)}`).toBeGreaterThanOrEqual(POLICY_SPARE);
  }, TURN_TIMEOUT);
});

// The "since the last reply" line (apply/since.ts, docs/pilot-auto-mode-design.md
// §4): the request after a decision on an Apply card ends its context with
// one line, so the worst turn never carries it (the validation's TASK opens a
// conversation, before any card). Measured on the worst turn all the same,
// with the budget's three decisions (sinceSamples.ts), as the bound of a
// full-method reply that follows a decision. The line has a ceiling of its
// own (measured 2026-11-07: 165 characters and its newline, 47.4 est.
// tokens, rounded up), and the turn with it the 32k window with POLICY_SPARE
// free. The 20 % target is the worst turn's, which never carries the line:
// this case's size against it is printed, not held (the turn is 41 over it,
// the line needing 48 of the 7 to spare).
const SINCE = budgetSince();
const SINCE_CEILING = 48;
const withSince = (): ChatMessage[] => buildChatMessages(context, [], TASK, null, { tools: true, since: SINCE });

describe("after a decision: the worst turn with the \"since the last reply\" line (three decisions)", () => {
  it("adds the line's own tokens alone, to the context, and the turn still fits 32k with the spare", async () => {
    const { before, after } = await localTurn();
    const run = await drive(OLLAMA, ORDERS.method, Infinity, withSince());
    const b = breakdown(before.sent[before.peak], before.key);
    const s = breakdown(run.sent[run.peak], run.key);
    // The line, and the newline before it, at the prose rate: the context grows by that, nothing else does.
    const line = baseTokens([{ role: "user", content: `\n${SINCE}` }]) - baseTokens([{ role: "user", content: "" }]);
    expect(s.context - b.context).toBeCloseTo(line, 6);
    room.push({ what: "the \"since\" line (three decisions)", measured: line, ceiling: SINCE_CEILING });
    expectWithin("the \"since the last reply\" line, the budget's three decisions", line, SINCE_CEILING);
    for (const r of ROWS) if (r !== "context") expect(s[r], r).toBe(b[r]);
    const worst = s.prompt + REPLY_RESERVE;
    expect(worst, `the worst turn with the line, ${n(worst)}, does not fit ${n(WINDOW)}`).toBeLessThanOrEqual(WINDOW);
    expect(POLICY_MIN - worst, `the worst turn with the line leaves ${n(POLICY_MIN - worst)} under ${n(POLICY_MIN)}`).toBeGreaterThanOrEqual(POLICY_SPARE);
    // After the loop's compaction, as the headroom target measures it.
    const runs = { method: await drive(OLLAMA, ORDERS.method, undefined, withSince()), skillsLast: await drive(OLLAMA, ORDERS.skillsLast, undefined, withSince()) };
    const compacted = Math.max(...Object.values(runs).map((r) => r.prompts[r.peak])) + REPLY_RESERVE;
    const plain = Math.max(after.method.prompts[after.method.peak], after.skillsLast.prompts[after.skillsLast.peak]) + REPLY_RESERVE;
    target.push(
      `After a decision (the "since the last reply" line, ${SINCE.length} characters, three decisions: ${n(s.context - b.context)} est. tokens, ` +
        `about ${n((s.context - b.context) / 3)} a decision): the worst turn with it, ${n(compacted)} with the reply reserve after compaction ` +
        `(${n(plain)} without the line) against the 20 % target's ${n(HEADROOM_TARGET)}: ${compacted > HEADROOM_TARGET ? `over by ${n(compacted - HEADROOM_TARGET)}` : `met, ${n(HEADROOM_TARGET - compacted)} to spare`}; ` +
        `without compaction ${n(worst)} against ${n(WINDOW)}, ${n(WINDOW - worst)} left.`,
    );
  }, TURN_TIMEOUT);
});

// Both targets were tracked with `it.fails` until met, then turned into plain
// tests so they hold from then on: the stretch goal since THY-63 R3 and R4,
// the 20 % target since R5 (the core read names its references only).
describe("the headroom target (docs/pilot-context-design.md §5.8), enforced since R5", () => {
  it(
    `target: the worst local turn after compaction, with the reply reserve, fits ${n(HEADROOM_TARGET)} (20 % under ${n(WINDOW)}), in the method and skills-last orders`,
    async () => {
      const { after } = await localTurn();
      const worst = Math.max(after.method.prompts[after.method.peak], after.skillsLast.prompts[after.skillsLast.peak]) + REPLY_RESERVE;
      target.push(
        `Headroom target (enforced since R5, §5.8): the worst local turn after compaction, ${n(worst)} with the reply reserve, against ${n(HEADROOM_TARGET)} ` +
          `(20 % under ${n(WINDOW)}): ${worst > HEADROOM_TARGET ? `over by ${n(worst - HEADROOM_TARGET)}` : "met"}.`,
      );
      expect(worst).toBeLessThanOrEqual(HEADROOM_TARGET);
    },
    TURN_TIMEOUT,
  );

  // Met since THY-63 R3 and R4 together (31,534 of 32,768): enforced from then on.
  it(
    `stretch: the worst local turn without compaction, with the reply reserve, fits ${n(WINDOW)}`,
    async () => {
      const { before } = await localTurn();
      const worst = before.prompts[before.peak] + REPLY_RESERVE;
      target.push(
        `Stretch goal (enforced since R3 and R4, §5.8): the worst local turn without compaction, ${n(worst)} with the reply reserve, against ${n(WINDOW)}: ` +
          `${worst > WINDOW ? `over by ${n(worst - WINDOW)}` : "met"}.`,
      );
      expect(worst).toBeLessThanOrEqual(WINDOW);
    },
    TURN_TIMEOUT,
  );
});

// Auto mode's replies (auto/controller.ts, docs/pilot-auto-mode-design.md §4):
// each in place of the question, with no chat history, so neither is ever
// the worst turn above, and both are held to the 20 % target with the reply
// reserve. Driven through the same loop on a local model (Ollama), the
// phase's checks seeded as a round of calls (agent.ts, seed), and counted by
// the same estimator:
// - "auto: worst fix": the fix of each stage at its longest digest (its
//   second try, every row before it worded at its longest, the most
//   decisions the since line lists), its checks seeded, the model reading
//   its stage's skill core (read_skill) and making one update_settings
//   change, then answering; the largest of the five stages;
// - "auto: report": every final check seeded (finalChecks), the longest
//   digest, and the model calling dpdf_peaks (the dev control's list, the
//   largest result a reading tool returns) before it answers.
// Measured 2026-11-07 (THY-65 PR 6), the ceilings below: the worst fix, the
// ΔPDF's (its three checks seeded), 10,733 + 6,144 = 16,877, 9,337 under the
// target (the design's estimate: about 16k; 16 of it the fix prompt's "the
// app then runs the pipeline from it and checks again", which the local
// smoke showed a fix needs); the report 13,048 + 6,144 = 19,192, 7,022
// under it (estimated about 21.5k). Each phase prompt's growth is held by its
// own ceiling; the target holds either reply whatever the ceilings allow.
const AUTO_FIX_CEILING = 10_733;
const AUTO_REPORT_CEILING = 13_048;

describe("auto mode's replies (THY-65 PR 6), held to the 20 % target", () => {
  /** The app's own call, as the controller keeps it: a step with its result as the executor made it. */
  const appStep = async (c: AutoCall, i: number): Promise<AgentStep> => {
    const r = await callTool({ dataset: DATASET, datasets: DATASETS, userMessage: "" }, c.name, c.args);
    return { id: `auto:${i}`, name: c.name, args: r.args, status: r.ok ? "done" : "error", summary: r.summary, result: r.text, ...(r.full ? { full: r.full } : {}), ...(r.outcomes ? { outcomes: r.outcomes } : {}) };
  };

  /** An auto reply through runAgent on Ollama: its seed, then the model's `calls`, one a round, then the answer. */
  async function autoReply(messages: ChatMessage[], seed: AgentStep[], calls: Call[], tools: AgentTool[], rounds: number) {
    resetTokenState();
    const sent: Sent[] = [];
    const script: StreamDelta[][] = [
      ...calls.map((c, i): StreamDelta[] => [{ toolCalls: [{ id: `call_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] }]),
      [{ content: "The answer." }],
    ];
    model.streamChat.mockImplementation((args: Sent) => {
      sent.push({ messages: [...args.messages], tools: args.tools, numCtx: args.numCtx });
      const reply = script.shift() ?? [];
      return (async function* () {
        for (const d of reply) yield d;
      })();
    });
    const settings: LlmSettings = { ...DEFAULT_SETTINGS, baseUrl: OLLAMA, model: "scripted", followViews: false };
    await runAgent({
      messages,
      tools,
      ctx: { dataset: DATASET, datasets: DATASETS, skillsRead: new Set(), earlierSteps: [] },
      settings,
      signal: new AbortController().signal,
      checkAnswers: false,
      userMessage: "",
      maxRounds: rounds,
      seed: { steps: seed, form: "round" },
    });
    const key = `${OLLAMA}|${settings.model}`;
    const prompts = sent.map((s) => estimateTokens(baseTokens(s.messages, s.tools), key));
    const peak = prompts.indexOf(Math.max(...prompts));
    return { sent, key, prompts, peak, breakdown: breakdown(sent[peak], key) };
  }

  it("auto: worst fix: the largest of the five stages' fix replies fits the target with the reply reserve", async () => {
    freshConsole();
    const sizes: { stage: string; b: Breakdown }[] = [];
    for (const stage of TUNE_STAGES) {
      freshConsole();
      const seed = await Promise.all(STAGE_CHECKS[stage].map(appStep));
      const messages = autoMessages(context, longestDigest(stage), fixPrompt(stage), AUTO_LIMITS.fixRounds);
      // A change of the stage's first method setting, as the catalogue allows it.
      const param = TUNE_PARAMS.find((p) => p.stage === stage)!;
      const value = param.kind === "enum" ? param.options![param.options!.length - 1].name : param.kind === "boolean" ? true : (param.max ?? param.min ?? 1);
      const calls: Call[] = [
        { name: "read_skill", args: { name: STAGE_SKILL[stage] } },
        { name: "update_settings", args: { changes: { [param.key]: value } } },
      ];
      const run = await autoReply(messages, seed, calls, FIX_TOOLS, AUTO_LIMITS.fixRounds);
      sizes.push({ stage, b: run.breakdown });
    }
    const worst = sizes.reduce((a, b) => (b.b.prompt > a.b.prompt ? b : a));
    const total = worst.b.prompt + REPLY_RESERVE;
    columns.push({ head: ["auto: worst fix", `(${worst.stage})`], b: worst.b, reserve: REPLY_RESERVE });
    room.push({ what: "auto: worst fix, its largest prompt", measured: worst.b.prompt, ceiling: AUTO_FIX_CEILING });
    target.push(
      `Auto, worst fix (${worst.stage}; ${sizes.map((s) => `${s.stage} ${n(s.b.prompt)}`).join(", ")}): ${n(worst.b.prompt)} + ${n(REPLY_RESERVE)} = ${n(total)} ` +
        `against the 20 % target's ${n(HEADROOM_TARGET)}: ${total > HEADROOM_TARGET ? `over by ${n(total - HEADROOM_TARGET)}` : `met, ${n(HEADROOM_TARGET - total)} to spare`}.`,
    );
    expectWithin("auto: worst fix, its largest prompt", worst.b.prompt, AUTO_FIX_CEILING);
    expect(total, `the worst fix, ${n(total)} with the reply reserve, against the 20 % target ${n(HEADROOM_TARGET)}`).toBeLessThanOrEqual(HEADROOM_TARGET);
  }, TURN_TIMEOUT);

  it("auto: report: every final check seeded and the ΔPDF's features read fit the target with the reply reserve", async () => {
    freshConsole();
    const seed = await Promise.all(finalChecks(DATASET).map(appStep));
    const messages = autoMessages(context, longestDigest(null), REPORT_PROMPT, AUTO_LIMITS.reportRounds);
    const run = await autoReply(messages, seed, [FEATURES], REPORT_TOOLS, AUTO_LIMITS.reportRounds);
    const total = run.breakdown.prompt + REPLY_RESERVE;
    columns.push({ head: ["auto: report", "checks seeded"], b: run.breakdown, reserve: REPLY_RESERVE });
    room.push({ what: "auto: report, its largest prompt", measured: run.breakdown.prompt, ceiling: AUTO_REPORT_CEILING });
    target.push(
      `Auto, report (${seed.map((s) => s.name).join(", ")} seeded, dpdf_peaks called): ${n(run.breakdown.prompt)} + ${n(REPLY_RESERVE)} = ${n(total)} ` +
        `against the 20 % target's ${n(HEADROOM_TARGET)}: ${total > HEADROOM_TARGET ? `over by ${n(total - HEADROOM_TARGET)}` : `met, ${n(HEADROOM_TARGET - total)} to spare`}.`,
    );
    expectWithin("auto: report, its largest prompt", run.breakdown.prompt, AUTO_REPORT_CEILING);
    expect(total, `the report, ${n(total)} with the reply reserve, against the 20 % target ${n(HEADROOM_TARGET)}`).toBeLessThanOrEqual(HEADROOM_TARGET);
  }, TURN_TIMEOUT);
});
