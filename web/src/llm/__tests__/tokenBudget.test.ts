// How long NEBULA Pilot's worst realistic turn grows, in the tokens the context
// guard counts, against a 32k local context window, held to ceilings by
// component (docs/pilot-context-design.md §5.8).
//
// VERDICT (measured 2026-11-01 with THY-63 R3's core prompt and dataset
// summary, with scripts/measure_pilot_context.sh, which counts the same way):
// OVER 32k in both configurations before compaction.
// - The console (Claude, every tool, nothing shortened): the prompt alone is
//   about 37.0k tokens, before the 64,000 Claude reserves for its reply.
// - Arm B on a local model (the validation TASK's offer): about 36.4k + 6,144
//   = 42.6k before the loop's compaction, and 34.3k to 38.6k after it, by the
//   order the skills are read (34.3k in the method's order).
// - A model LM Studio loaded with 32k gets the turn in with the loop's own
//   compaction: the window guard shortens nothing more (before R3 it cut
//   both skills just read to stubs of a few hundred characters).
// A local live run needs a context of 56k (57,344) or more, the run policy's
// minimum (RUN_POLICY): it holds the whole turn before compaction, with room
// to reply, and leaves free the 3k a model-visible addition must leave (10.0k
// now). The estimate is conservative (every tool result, the skills' prose
// included, counts at the data rate), but at the prose rate for the skills
// the turn is still over 32k.
//
// The turn is driven through the real agent loop (runAgent, agent.ts) with a
// scripted model, and every request it sends is counted by the guard's own
// estimator (provider/tokens.ts: baseTokens and estimateTokens, at the
// starting rates, before any server's counts calibrate them). The turn:
// - the opening messages as buildChatMessages builds them for the validation
//   TASK, over the synthetic crystal of modelVisible.test.ts (syntheticCrystal.ts);
// - the tools sent: all of CHAT_TOOLS (the console, Claude), or what a local
//   model is offered for the TASK (localTools.ts), with any tool it calls;
// - the two largest skills, read whole with read_skill, and the largest
//   reference page either of them cites (read_skill cuts a page at 12,000
//   characters, REFERENCE_MAX_CHARS);
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
// compaction with the reply reserve (§5.8), cannot hold until the leaner design
// (R1-R5) lands: it is tracked, not enforced. Its test is marked `it.fails`:
// it passes while the target is missed (printing the gap), and fails the day
// the turn meets it, to be turned into a plain `it` then, so the target is
// enforced from that change on. The stretch goal (the same turn fits 32k
// without compaction) is tracked the same way.
//
// Hermetic and synthetic: no model is loaded, no backend or API is called, and
// no measured data is used (the dev control is a synthetic case, its list
// recorded beforehand).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { DpdfFeatures } from "../../api/types";
import { KEEP_FULL, runAgent, SOFT_BUDGET } from "../agent";
import { loadPipelineContext } from "../context/loadContext";
import type { PipelineContext } from "../context/pipelineContext";
import { armSetup, TASK } from "../evals/validation";
import { RUN_POLICY } from "../evals/validationModels";
import { toolsFor } from "../localTools";
import { buildChatMessages } from "../prompts/templates";
import type { ChatMessage, StreamDelta, ToolSpec } from "../provider/client";
import {
  baseTokens,
  DATA_CHARS_PER_TOKEN,
  estimateTokens,
  MIN_REPLY,
  PROSE_CHARS_PER_TOKEN,
  REPLY_RESERVE,
  resetTokenState,
} from "../provider/tokens";
import { GATES_MAX, isCompacted, SKILL_STUB_MAX } from "../readings/compact";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { allSkills, readSkill, REFERENCE_MAX_CHARS } from "../skills";
import { callTool, CHAT_TOOLS } from "../tools";
import devControlPeaks from "./__fixtures__/dpdf-peaks-dev-control.json";
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
// 2026-11-01 with THY-63 R3's core prompt and dataset summary (on main
// d8f44023, R2 merged), and the same in scripts/measure_pilot_context.sh. R3
// lowered the system prompt (4,453 -> 1,357: the core in place of the
// metrics' glossary and the tools' guidance) and the context (2,382 -> 288:
// the dataset's summary in place of one cut's metrics), and every prompt. The
// tools offered grew (5,554 -> 5,933; every definition 6,139 -> 6,518): the
// glossary's field meanings moved into measure_reciprocal_cut's catalogue and
// measure_dpdf_cut's contract, and dpdf_contrast's contract took the figure
// rule; the cut elsewhere is 13 times that.
// Arm B's worst local request, before the loop's compaction, by component:
const MEASURED: Record<Component, number> = { system: 1_357, tools: 5_933, context: 288, skills: 20_758, results: 8_091 };
// Every tool's definition, as the console sends them (Claude).
const MEASURED_ALL_TOOLS = 6_518;
// Each configuration's largest prompt.
const MEASURED_PROMPT = {
  console: 37_012,
  localBefore: 36_426,
  localSkillsFirst: 28_335,
  localMethod: 28_116,
  localSkillsLast: 32_455,
};

// The room held for the queued model-visible features, by component, in
// estimated tokens (docs/pilot-context-design.md §5.9). Each line is spent by
// the feature it names: its PR moves the line's tokens into MEASURED (or
// keeps them here while its tokens are in flight) and states its cost from
// scripts/measure_pilot_context.sh. Results and skills count at the data
// rate (1.4 characters a token), definitions at the prose rate (3.5).
const RESERVED: Record<string, { what: string; room: Partial<Record<Component, number>> }> = {
  "THY-59": {
    what: "Laue R_int statistics, measured on its branch: reduction-qc's new section, +2,139 characters (its result and description shrink by 22 and 21 characters, not credited)",
    room: { skills: 1_528 },
  },
  "THY-60": {
    what: "UB-aware punch, estimated: the turned-UB diagnosis and the tail sweep in the punch record, at most 400 characters of result and 100 of description",
    room: { results: 270, tools: 30 },
  },
  "THY-61": {
    what: "ring doublets, estimated: a doublet marker on shells_judged's entries, at most 200 characters",
    room: { results: 150 },
  },
  "THY-62": {
    what: "powder phases, estimated: a tool offered for the rings (a contract of at most 500 characters), its default result of at most 2,000 characters, and a gate line in a skill",
    room: { tools: 150, results: 1_400, skills: 50 },
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

/** The two largest skills as read_skill returns them, and the largest reference page either cites. */
function largestReads(): { skills: string[]; reference: { skill: string; name: string; chars: number } } {
  const bySize = [...allSkills()].sort((a, b) => readSkill(b.name).length - readSkill(a.name).length);
  const two = bySize.slice(0, 2);
  const pages = two.flatMap((s) => s.references.map((r) => ({ skill: s.name, name: r.name, chars: readSkill(s.name, r.name).length })));
  const reference = pages.sort((a, b) => b.chars - a.chars)[0];
  return { skills: two.map((s) => s.name), reference };
}

const LARGEST = largestReads();
const readOf = (name: string, reference?: string): Call => ({ name: "read_skill", args: reference ? { name, reference } : { name } });
const SKILL_WITH_PAGE = LARGEST.reference.skill;
const OTHER_SKILL = LARGEST.skills.find((s) => s !== SKILL_WITH_PAGE)!;
const SKILL_READS: Call[] = [readOf(OTHER_SKILL), readOf(SKILL_WITH_PAGE), readOf(SKILL_WITH_PAGE, LARGEST.reference.name)];

// The orders the reply may read them in, one call a round.
const ORDERS: Record<"skillsFirst" | "method" | "skillsLast", Call[]> = {
  skillsFirst: [...SKILL_READS, ...CHECKS, FEATURES],
  // Each skill before the checks of its topic: the other skill first, the one
  // whose page is read right before the ΔPDF's features.
  method: [SKILL_READS[0], ...CHECKS, SKILL_READS[1], SKILL_READS[2], FEATURES],
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
async function drive(baseUrl: string, calls: Call[], softBudget?: number) {
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
const isSkillBody = (c: Call): boolean => c.name === "read_skill" && c.args.reference === undefined;
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
      `Skills read whole: ${LARGEST.skills.join(", ")}; reference page: ${LARGEST.reference.skill} › ${LARGEST.reference.name} ` +
        `(${n(LARGEST.reference.chars)} characters, cut at ${n(REFERENCE_MAX_CHARS)})`,
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

// What a model-visible addition must leave free under the run policy's minimum
// context for a local live run: 3k.
const POLICY_HEADROOM = 3 * 1024;

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
    expect(b.offered).toBe(CHAT_TOOLS.length);
    columns.push({ head: ["console (Claude)", "all tools"], b, reserve: CLAUDE_REPLY });
    room.push({ what: "every tool's definition (the console)", measured: b.tools, ceiling: CEILING_ALL_TOOLS });
    expectWithin("every tool's definition, as the console sends them", b.tools, CEILING_ALL_TOOLS);
    expectWithin("the console's prompt", b.prompt, CEILING_PROMPT.console);
  }, TURN_TIMEOUT);

  it("arm B on a local model: the TASK's offer, before and after the loop's compaction", async () => {
    // The tools offered for the TASK; those called all the same join them.
    const offer = toolsFor(TASK, CHAT_TOOLS).map((t) => t.name);
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
    // Past the soft budget, so the loop compacts.
    expect(b.prompt).toBeGreaterThan(SOFT_BUDGET);
    // The worst local turn, with the reply reserve, fits the run policy's
    // minimum context for a local live run, and leaves the headroom there.
    const worst = b.prompt + REPLY_RESERVE;
    const min = RUN_POLICY.minLocalContextTokens;
    expect(worst, `the worst local turn, ${n(worst)} tokens, does not fit the run policy's minimum of ${n(min)}`).toBeLessThanOrEqual(min);
    expect(min - worst, `the worst local turn leaves ${n(min - worst)} of the ${n(POLICY_HEADROOM)} tokens of headroom under ${n(min)}`).toBeGreaterThanOrEqual(POLICY_HEADROOM);
    // The live-run rule holds everything, both skills read whole with a
    // `## Gates` section at its cap (GATES_MAX, readings/compact.ts) included:
    // each section adds at most GATES_MAX characters to its skill's text, and
    // the turn still leaves the headroom under the minimum (the manager's
    // decision on the user's delegation, 2026-10-24; review finding P5.3b).
    const gated = worst + estimateTokens((2 * GATES_MAX) / DATA_CHARS_PER_TOKEN, before.key);
    expect(min - gated, `with two gated skills at the cap the worst local turn, ${n(gated)} tokens, leaves ${n(min - gated)} under ${n(min)}`).toBeGreaterThanOrEqual(POLICY_HEADROOM);

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
      `The skills' ${n(skillChars)} characters of Markdown count at the data rate, as every tool result does: ` +
        `${n(b.skills)} tokens. At the prose rate (${PROSE_CHARS_PER_TOKEN} characters a token) about ${n(skillChars / PROSE_CHARS_PER_TOKEN)}, ` +
        `and the turn before compaction about ${n(b.prompt - b.skills + skillChars / PROSE_CHARS_PER_TOKEN + REPLY_RESERVE)} with the reserve.`,
      `Reply reserve: Claude ${n(CLAUDE_REPLY)} (anthropic.ts); a local run ${n(REPLY_RESERVE)} (REPLY_RESERVE: no cap is sent, the window plan keeps it free; ` +
        `a request is refused below MIN_REPLY ${n(MIN_REPLY)}).`,
      `The run policy's minimum for a local live run (RUN_POLICY): ${n(min)}; the worst local turn ${n(worst)} leaves ${n(min - worst)} ` +
        `(at least ${n(POLICY_HEADROOM)} must stay free); with both skills gated at the cap (${n(GATES_MAX)} characters each) it is ` +
        `${n(gated)}, leaving ${n(min - gated)}.`,
    );
  }, TURN_TIMEOUT);

  it("on LM Studio loaded with 32k: the loop's own compaction fits the window, and the guard shortens nothing more", async () => {
    model.loadedContext.mockResolvedValue({ loaded: WINDOW, max: 131_072 });
    const run = await drive(LM_STUDIO, ORDERS.method);
    // Every request is sent (none refused), each leaving at least MIN_REPLY.
    expect(run.result.note).toBeUndefined();
    expect(run.sent).toHaveLength(ORDERS.method.length + 1);
    for (const p of run.prompts) expect(p + MIN_REPLY).toBeLessThanOrEqual(WINDOW);
    // Since the core prompt and the dataset's summary (THY-63 R3) each request
    // is the one the loop's own compaction sends (past SOFT_BUDGET, all but the
    // newest KEEP_FULL shortened): the window guard, which shortens a request
    // without MIN_REPLY free down to its newest result, has nothing to do.
    // Before R3 it shortened both skills read to their stubs here.
    const { after } = await localTurn();
    expect(run.prompts).toEqual(after.method.prompts);
    // So on the last request the skill read before the checks arrives as its
    // stub, and the one read last, with its page, whole.
    const last = run.sent[run.sent.length - 1];
    const bodies = resultsOf(last, isSkillBody);
    expect(bodies).toHaveLength(2);
    expect(bodies.map(isCompacted)).toEqual([true, false]);
    const page = resultsOf(last, (c) => c.name === "read_skill" && c.args.reference !== undefined);
    const b = breakdown(run.sent[run.peak], run.key);
    // A skill with a `## Gates` section is shortened to its head and the
    // section, at most SKILL_STUB_MAX characters (readings/compact.ts). At
    // 32k one skill gated at the cap still fits: its stub's growth leaves the
    // largest request MIN_REPLY. Two gated at the cap need more than 32k: the
    // live runs' 56k holds them (the test above). The manager's decision on
    // the user's delegation, 2026-10-24 (review finding P5.3b), reversible by
    // the user.
    const growth = Math.max(...bodies.map((t) => Math.max(0, SKILL_STUB_MAX - t.length)));
    const oneGated = b.prompt + estimateTokens(growth / DATA_CHARS_PER_TOKEN, run.key) + MIN_REPLY;
    expect(oneGated, `one skill gated at the cap: ${n(oneGated)} tokens with MIN_REPLY, in a window of ${n(WINDOW)}`).toBeLessThanOrEqual(WINDOW);
    // No ceiling of its own: the window-fit checks above bound this prompt
    // more tightly than any ceiling would.
    columns.push({ head: ["LM Studio at 32k", "after compaction"], b, reserve: REPLY_RESERVE });
    notes.push(
      `LM Studio loaded with ${n(WINDOW)} (window.ts, agent.ts): every request fits with MIN_REPLY free after the loop's own compaction, so the guard shortens nothing more. ` +
        `Largest sent ${n(b.prompt)} (request ${run.peak + 1} of ${run.sent.length}), ${n(WINDOW - b.prompt)} left for the reply. ` +
        `On the last request the skill read first arrives as a ${n(Math.min(...bodies.map((t) => t.length)))}-character stub, the one read last whole; ` +
        `the reference page ${page.every(isCompacted) ? "shortened" : "whole"}. ` +
        `One skill gated at the cap (${n(SKILL_STUB_MAX)}-character stub) leaves ${n(WINDOW - oneGated)} to spare past MIN_REPLY.`,
    );
  }, TURN_TIMEOUT);
});

// Tracked, not enforced (the header): each `it.fails` passes while its target
// is missed, and fails once the turn meets it. Then turn it into a plain `it`,
// in the change that met it, so the target holds from that change on.
describe("the headroom target (docs/pilot-context-design.md §5.8), tracked until R1-R5 land", () => {
  it.fails(
    `target: the worst local turn after compaction, with the reply reserve, fits ${n(HEADROOM_TARGET)} (20 % under ${n(WINDOW)}), in the method and skills-last orders`,
    async () => {
      const { after } = await localTurn();
      const worst = Math.max(after.method.prompts[after.method.peak], after.skillsLast.prompts[after.skillsLast.peak]) + REPLY_RESERVE;
      target.push(
        `Headroom target (tracked, §5.8): the worst local turn after compaction, ${n(worst)} with the reply reserve, against ${n(HEADROOM_TARGET)} ` +
          `(20 % under ${n(WINDOW)}): ${worst > HEADROOM_TARGET ? `over by ${n(worst - HEADROOM_TARGET)}` : "met"}.`,
      );
      expect(worst).toBeLessThanOrEqual(HEADROOM_TARGET);
    },
    TURN_TIMEOUT,
  );

  it.fails(
    `stretch: the worst local turn without compaction, with the reply reserve, fits ${n(WINDOW)}`,
    async () => {
      const { before } = await localTurn();
      const worst = before.prompts[before.peak] + REPLY_RESERVE;
      target.push(
        `Stretch goal (tracked, §5.8): the worst local turn without compaction, ${n(worst)} with the reply reserve, against ${n(WINDOW)}: ` +
          `${worst > WINDOW ? `over by ${n(worst - WINDOW)}` : "met"}.`,
      );
      expect(worst).toBeLessThanOrEqual(WINDOW);
    },
    TURN_TIMEOUT,
  );
});
