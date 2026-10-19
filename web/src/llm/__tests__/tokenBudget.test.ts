// How long NEBULA Pilot's worst realistic turn grows, in the tokens the context
// guard counts, against a 32k local context window.
//
// VERDICT (measured 2026-10-19): OVER 32k in both configurations.
// - The console (Claude, every tool, nothing shortened): the prompt alone is
//   about 39.7k tokens, before the 64,000 Claude reserves for its reply.
// - Arm B on a local model (the validation TASK's offer): about 39.5k + 6,144
//   = 45.6k before the loop's compaction, and 37.4k to 41.6k after it, by the
//   order the skills are read (38.1k in the method's order).
// - A model LM Studio loaded with 32k gets the turn in only because the window
//   guard then shortens the results down to the newest: the two skills just
//   read reach the model as stubs of a few hundred characters.
// A local live run needs a context of 48k (49,152) or more: it holds the
// whole turn before compaction, with room to reply. The estimate is
// conservative (every tool result, the skills' prose included, counts at the
// data rate), but at the prose rate for the skills the turn is still over 32k.
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
//   executor hands it over (runToolCall);
// - the reply reserve: the 64,000 tokens anthropic.ts asks of Claude
//   (STREAM_MAX_TOKENS, pinned by anthropic.test.ts), and REPLY_RESERVE for a
//   local run. The local transports send no output cap (no max_tokens, no
//   num_predict), so a local reply runs until the window is full: the window
//   plan keeps REPLY_RESERVE free for it (Ollama's num_ctx is sized to the
//   prompt + REPLY_RESERVE; LM Studio's request is refused only below
//   MIN_REPLY).
//
// A local model's request past SOFT_BUDGET has its older results shortened
// (compact.ts), all but the newest KEEP_FULL, so its size depends on what was
// read last: the skills read first, last, and in the method's order (each
// before the checks of its topic) are measured. A model loaded with a window
// too small for a request gets its results shortened down to the newest one
// (window.ts, agent.ts): measured on LM Studio loaded with 32k.
//
// Measurement only: no prompt, skill, tool description or loop setting is
// changed here. The pins hold the current sizes within ±5 %: a change that
// grows or shrinks the turn fails here, to be updated deliberately (PINNED, and
// the verdict above). The breakdown is printed with the test's output (where
// vitest detects an AI agent it hides a passing test's output: add
// --reporter=default).
//
// Hermetic and synthetic: no model is loaded, no backend or API is called, and
// no measured data is used.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { KEEP_FULL, runAgent, SOFT_BUDGET } from "../agent";
import { isCompacted } from "../compact";
import { loadPipelineContext } from "../context/loadContext";
import type { PipelineContext } from "../context/pipelineContext";
import { armSetup, TASK } from "../evals/validation";
import { toolsFor } from "../localTools";
import { buildChatMessages } from "../prompts/templates";
import type { ChatMessage, StreamDelta, ToolSpec } from "../provider/client";
import {
  baseTokens,
  estimateTokens,
  MIN_REPLY,
  PROSE_CHARS_PER_TOKEN,
  REPLY_RESERVE,
  resetTokenState,
} from "../provider/tokens";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { allSkills, readSkill, REFERENCE_MAX_CHARS } from "../skills";
import { CHAT_TOOLS } from "../tools";
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

// ---------------------------------------------------------------- the pins

const WINDOW = 32_768;
// anthropic.ts's STREAM_MAX_TOKENS: Claude's reply cap on every streamed turn.
const CLAUDE_REPLY = 64_000;
const BAND = 0.05;

// The current sizes (estimated prompt tokens, and with the reply reserve).
// Update deliberately, with the verdict in the header, when the turn changes.
const PINNED = {
  console: { prompt: 39_660, total: 103_660 },
  localBefore: { prompt: 39_458, total: 45_602 },
  localSkillsFirst: { prompt: 31_272, total: 37_416 },
  localMethod: { prompt: 31_946, total: 38_090 },
  localSkillsLast: { prompt: 35_422, total: 41_566 },
  lmStudio32k: { prompt: 26_621, total: 32_765 },
};

// ---------------------------------------------------------------- the turn

const OLLAMA = DEFAULT_SETTINGS.baseUrl; // a local run's default server
const LM_STUDIO = "http://localhost:1234/v1";
const CLAUDE = "https://api.anthropic.com";

interface Call {
  name: string;
  args: Record<string, unknown>;
}

// One result of each tool the system prompt's method asks for (TOOLS_PROMPT,
// prompts/system.ts): every stage's verdict, texture_check and qmax_coverage
// (its four checks), symmetry_check, ub_check, grain_check, radial_profile
// for the rings, and dpdf_peaks for the correlations the TASK asks for.
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
    ctx: { dataset: DATASET, datasets: DATASETS, skills: b.skills, skillsRead: b.skillsRead, earlierResults: [] },
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

function expectPinned(what: string, measured: number, pinned: number): void {
  const [lo, hi] = [Math.floor(pinned * (1 - BAND)), Math.ceil(pinned * (1 + BAND))];
  const why =
    `${what}: ${n(measured)} tokens, outside ${n(pinned)} ± 5 % (${n(lo)} to ${n(hi)}). The worst turn changed size: ` +
    "if that is intended, update PINNED in tokenBudget.test.ts and the verdict in its header, deliberately.";
  expect(measured, why).toBeGreaterThanOrEqual(lo);
  expect(measured, why).toBeLessThanOrEqual(hi);
}

// What the tests measured, printed as one table when they are done.
const columns: { head: [string, string]; b: Breakdown; reserve: number }[] = [];
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
    ].join("\n"),
  );
});

// ---------------------------------------------------------------- the measures

// Each case drives whole replies through the agent loop (a dozen requests, each
// counted by the guard's estimator): about a second locally, but near vitest's
// default 5 s on a slow CI runner. A runner's speed is not what this test pins.
const TURN_TIMEOUT = 30_000;

describe("NEBULA Pilot's worst turn against a 32k window", () => {
  it("the console: every tool, nothing shortened (Claude)", async () => {
    const run = await drive(CLAUDE, ORDERS.method);
    // Nothing is shortened: the last request, with every result, is the largest.
    expect(run.sent).toHaveLength(ORDERS.method.length + 1);
    expect(run.peak).toBe(run.sent.length - 1);
    const b = breakdown(run.sent[run.peak], run.key);
    expect(b.offered).toBe(CHAT_TOOLS.length);
    columns.push({ head: ["console (Claude)", "all tools"], b, reserve: CLAUDE_REPLY });
    expectPinned("the console's prompt", b.prompt, PINNED.console.prompt);
    expectPinned("the console's total", b.prompt + CLAUDE_REPLY, PINNED.console.total);
  }, TURN_TIMEOUT);

  it("arm B on a local model: the TASK's offer, before and after the loop's compaction", async () => {
    // The tools offered for the TASK; those called all the same join them.
    const offer = toolsFor(TASK, CHAT_TOOLS).map((t) => t.name);
    const called = [...new Set(ORDERS.method.map((c) => c.name))];
    const sentTools = CHAT_TOOLS.filter((t) => offer.includes(t.name) || called.includes(t.name)).length;

    // Before: the same loop with its soft budget out of reach.
    const before = await drive(OLLAMA, ORDERS.method, Infinity);
    expect(before.peak).toBe(before.sent.length - 1);
    const b = breakdown(before.sent[before.peak], before.key);
    expect(b.offered).toBe(sentTools);
    columns.push({ head: ["arm B, local", "before compaction"], b, reserve: REPLY_RESERVE });
    expectPinned("arm B local, before compaction: prompt", b.prompt, PINNED.localBefore.prompt);
    expectPinned("arm B local, before compaction: total", b.prompt + REPLY_RESERVE, PINNED.localBefore.total);
    // Past the soft budget, so the loop compacts.
    expect(b.prompt).toBeGreaterThan(SOFT_BUDGET);

    // After: the loop as it runs, the skills read in each order. The largest
    // request of the reply is what the window must hold.
    const after: Record<keyof typeof ORDERS, Awaited<ReturnType<typeof drive>>> = {
      skillsFirst: await drive(OLLAMA, ORDERS.skillsFirst),
      method: await drive(OLLAMA, ORDERS.method),
      skillsLast: await drive(OLLAMA, ORDERS.skillsLast),
    };
    const peaks = Object.fromEntries(Object.entries(after).map(([o, run]) => [o, breakdown(run.sent[run.peak], run.key)])) as Record<
      keyof typeof ORDERS,
      Breakdown
    >;
    columns.push({ head: ["arm B, local", "after (method order)"], b: peaks.method, reserve: REPLY_RESERVE });
    expectPinned("arm B local, skills read first: largest prompt", peaks.skillsFirst.prompt, PINNED.localSkillsFirst.prompt);
    expectPinned("arm B local, skills read first: total", peaks.skillsFirst.prompt + REPLY_RESERVE, PINNED.localSkillsFirst.total);
    expectPinned("arm B local, method order: largest prompt", peaks.method.prompt, PINNED.localMethod.prompt);
    expectPinned("arm B local, method order: total", peaks.method.prompt + REPLY_RESERVE, PINNED.localMethod.total);
    expectPinned("arm B local, skills read last: largest prompt", peaks.skillsLast.prompt, PINNED.localSkillsLast.prompt);
    expectPinned("arm B local, skills read last: total", peaks.skillsLast.prompt + REPLY_RESERVE, PINNED.localSkillsLast.total);

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
    );
  }, TURN_TIMEOUT);

  it("on LM Studio loaded with 32k: the guard shortens the results down to the newest, the skills read among them", async () => {
    model.loadedContext.mockResolvedValue({ loaded: WINDOW, max: 131_072 });
    const run = await drive(LM_STUDIO, ORDERS.method);
    // Every request is sent (none refused), each leaving at least MIN_REPLY.
    expect(run.result.note).toBeUndefined();
    expect(run.sent).toHaveLength(ORDERS.method.length + 1);
    for (const p of run.prompts) expect(p + MIN_REPLY).toBeLessThanOrEqual(WINDOW);
    // The skills read in this reply reach its last request shortened.
    const last = run.sent[run.sent.length - 1];
    const bodies = resultsOf(last, isSkillBody);
    expect(bodies).toHaveLength(2);
    expect(bodies.every(isCompacted)).toBe(true);
    const page = resultsOf(last, (c) => c.name === "read_skill" && c.args.reference !== undefined);
    const b = breakdown(run.sent[run.peak], run.key);
    columns.push({ head: ["LM Studio at 32k", "after the guard"], b, reserve: REPLY_RESERVE });
    expectPinned("LM Studio at 32k: largest prompt sent", b.prompt, PINNED.lmStudio32k.prompt);
    expectPinned("LM Studio at 32k: total", b.prompt + REPLY_RESERVE, PINNED.lmStudio32k.total);
    notes.push(
      `LM Studio loaded with ${n(WINDOW)} (window.ts, agent.ts): a request without MIN_REPLY free is shortened down to its newest result. ` +
        `Largest sent ${n(b.prompt)} (request ${run.peak + 1} of ${run.sent.length}), ${n(WINDOW - b.prompt)} left for the reply. ` +
        `On the last request both skills read arrive as ${n(Math.max(...bodies.map((t) => t.length)))}-character stubs; ` +
        `the reference page ${page.every(isCompacted) ? "too" : "stays whole"}.`,
    );
  }, TURN_TIMEOUT);
});
