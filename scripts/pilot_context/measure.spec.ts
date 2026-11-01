// NEBULA Pilot's context, measured by component: what each part of a request
// costs, per arm (B: skills on; C: skills off) and per local tool offer, in
// the context guard's estimated tokens (web/src/llm/provider/tokens.ts, the
// starting rates, uncalibrated: the token-budget test's counting method).
//
// Measurement only, for docs/pilot-context-design.md: nothing here changes a
// prompt, a tool, a skill or a loop setting, and it is not part of CI (its
// config, vitest.config.mjs, sits outside web/'s include patterns). Run it
// with scripts/measure_pilot_context.sh; with PILOT_CONTEXT_OUT=<dir> it also
// writes <dir>/components.json, every component's text and estimate, which
// realtokens.mjs counts with a real tokenizer (a local Ollama model).
//
// Hermetic and synthetic, as the budget test is: the synthetic crystal behind
// a mocked API (web/src/llm/__tests__/syntheticCrystal.ts), the dev control's
// recorded dpdf_peaks list, a scripted model, and the model-visible snapshots
// (web/src/llm/__tests__/__snapshots__/model-visible/) for a sample of every
// tool's result and the send-backs. No model is loaded, no backend or API is
// called, and no measured data is used.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { DpdfFeatures } from "../../web/src/api/types";
import { runAgent } from "../../web/src/llm/agent";
import { loadPipelineContext } from "../../web/src/llm/context/loadContext";
import { contextToJson, type PipelineContext } from "../../web/src/llm/context/pipelineContext";
import { armSetup, TASK } from "../../web/src/llm/evals/validation";
import { toolsFor } from "../../web/src/llm/localTools";
import { SYSTEM, TOOLS } from "../../web/src/llm/prompts/system";
import { buildChatMessages, buildStageReviewMessages, CHAT_HISTORY_TURNS, type ReviewStage } from "../../web/src/llm/prompts/templates";
import type { ChatMessage, StreamDelta, ToolSpec } from "../../web/src/llm/provider/client";
import {
  baseTokens,
  DATA_CHARS_PER_TOKEN,
  estimateTokens,
  PROSE_CHARS_PER_TOKEN,
  REPLY_RESERVE,
  resetTokenState,
  TABLE_CHARS_PER_TOKEN,
  tableChars,
} from "../../web/src/llm/provider/tokens";
import { shorten } from "../../web/src/llm/readings";
import { DEFAULT_SETTINGS, type LlmSettings } from "../../web/src/llm/settings";
import { allSkills, readSkill, REFERENCE_MAX_CHARS, skillsPrompt } from "../../web/src/llm/skills";
import { CHAT_TOOLS, toolSpecs, toolsWithSkills } from "../../web/src/llm/tools";
import { WORDS } from "../../web/src/llm/verdicts";
import devControlPeaks from "../../web/src/llm/__tests__/__fixtures__/dpdf-peaks-dev-control.json";
import { DATASET, DATASETS, freshConsole, installBackend } from "../../web/src/llm/__tests__/syntheticCrystal";

const DEV_CONTROL_PEAKS = devControlPeaks as unknown as { response: DpdfFeatures };
const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..");
const SNAPSHOTS = join(REPO, "web/src/llm/__tests__/__snapshots__/model-visible");

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
vi.mock("../../web/src/api/client", () => api);

const model = vi.hoisted(() => ({ streamChat: vi.fn(), loadedContext: vi.fn() }));
vi.mock("../../web/src/llm/provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../web/src/llm/provider/client")>()),
  streamChat: model.streamChat,
  loadedContext: model.loadedContext,
}));

// ---------------------------------------------------------------- the counting

const WINDOW = 32_768;
const OLLAMA = DEFAULT_SETTINGS.baseUrl;
const LM_STUDIO = "http://localhost:1234/v1";
const KEY = "measure|uncalibrated"; // never calibrated: the starting rates

const prose = (text: string): number => text.length / PROSE_CHARS_PER_TOKEN;
const data = (text: string): number => text.length / DATA_CHARS_PER_TOKEN;
// A tool result as the guard counts it: the data rate, and its rows of bare values (a column table's, line_profile's points) at TABLE_CHARS_PER_TOKEN.
const result = (text: string): number => data(text) + tableChars(text) * (1 / TABLE_CHARS_PER_TOKEN - 1 / DATA_CHARS_PER_TOKEN);
const toolsTokens = (specs: ToolSpec[]): number => baseTokens([], specs);
const msgTokens = (m: ChatMessage): number => baseTokens([m]);
const n = (x: number): string => Math.round(x).toLocaleString("en-US");
const pct = (part: number, whole: number): string => `${((100 * part) / whole).toFixed(0)} %`;

interface Component {
  group: string;
  name: string;
  arm: "B" | "C" | "both";
  rate: "prose" | "data" | "tools" | "message";
  chars: number;
  est: number;
  text: string;
}
const components: Component[] = [];
// Whole requests as the loop sent them, for realtokens.mjs to count end to end
// (the chat template and the tools' rendering included).
const requests: { label: string; est: number; messages: ChatMessage[]; tools?: ToolSpec[] }[] = [];
const add = (c: Omit<Component, "chars"> & { chars?: number }): Component => {
  const full = { ...c, chars: c.chars ?? c.text.length };
  components.push(full);
  return full;
};

const out: string[] = [];
const say = (...lines: string[]) => out.push(...lines);
const table = (head: string[], rows: (string | number)[][]): void => {
  say(`| ${head.join(" | ")} |`, `| ${head.map((h, i) => (i ? "---:" : "---")).join(" | ")} |`);
  for (const r of rows) say(`| ${r.map(String).join(" | ")} |`);
  say("");
};

let context: PipelineContext;

beforeAll(async () => {
  installBackend(api);
  api.fetchDpdfFeatures.mockImplementation(async (id: string) => ({ ...DEV_CONTROL_PEAKS.response, id }));
  freshConsole();
  context = (await loadPipelineContext(DATASET)).context;
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/show") return new Response(JSON.stringify({ model_info: { "scripted.context_length": 131_072 } }));
    if (path === "/api/ps") return new Response(JSON.stringify({ models: [] }));
    throw new Error(`no request expected to ${String(url)}`);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  console.log(out.join("\n"));
  const dir = process.env.PILOT_CONTEXT_OUT;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "components.json"), JSON.stringify({ measured: new Date().toISOString(), components, requests }, null, 1));
    writeFileSync(join(dir, "report.md"), out.join("\n"));
    console.log(`\nwrote ${join(dir, "components.json")} and report.md (${components.length} components)`);
  }
});

// ---------------------------------------------------------------- 1. the system prompt

/** A prompt split at its paragraphs (blank lines) or its "- " metric blocks, each labelled by its first words. */
const sectionsOf = (text: string): { label: string; text: string }[] =>
  text
    .split(/\n(?=\n|- [a-z_]+[:.])/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ label: t.replace(/\s+/g, " ").slice(0, 48), text: t }));

describe("1. the system prompt", () => {
  it("by section, arm B and arm C", () => {
    say("## 1. System prompt (estimator: prose, 3.5 characters a token)", "");
    const rows: (string | number)[][] = [];
    for (const [arm, on] of [["B", true], ["C", false]] as const) {
      const sys = SYSTEM.text(on);
      const tools = TOOLS.text(on);
      const skills = on ? skillsPrompt() : "";
      for (const s of sectionsOf(sys)) add({ group: "system.metrics", name: s.label, arm, rate: "prose", est: prose(s.text), text: s.text });
      for (const s of sectionsOf(tools)) add({ group: "system.tools", name: s.label, arm, rate: "prose", est: prose(s.text), text: s.text });
      if (skills) add({ group: "system.skills", name: "skills list", arm, rate: "prose", est: prose(skills), text: skills });
      rows.push([`arm ${arm}: metrics glossary + ground rules (SYSTEM)`, n(sys.length), n(prose(sys))]);
      rows.push([`arm ${arm}: tools guidance + checks + evidence rules (TOOLS)`, n(tools.length), n(prose(tools))]);
      if (skills) rows.push([`arm ${arm}: skills list`, n(skills.length), n(prose(skills))]);
      rows.push([`**arm ${arm}: system message**`, n(sys.length + tools.length + skills.length + 2), `**${n(prose(sys) + prose(tools) + prose(skills))}**`]);
    }
    table(["section", "chars", "est. tokens"], rows);

    // The sections of arm B, largest first.
    const b = components.filter((c) => c.arm === "B" && c.group.startsWith("system")).sort((x, y) => y.est - x.est);
    say("Arm B system sections, largest first:", "");
    table(
      ["group", "section (first words)", "chars", "est. tokens"],
      b.map((c) => [c.group, c.name.replace(/\|/g, "/"), n(c.chars), n(c.est)]),
    );
  });
});

// ---------------------------------------------------------------- 2. the tools

const QUESTIONS: [string, string][] = [
  ["validation TASK", TASK],
  ["general (\"What do you see?\")", "What do you see in this reduction?"],
  ["rings", "Are the powder rings gone?"],
  ["punch", "Is the punch clean, or are there satellites left?"],
  ["backfill", "Do the fills blend in?"],
  ["flatten", "Is there a pedestal left after the flatten?"],
  ["pdf", "What are the strongest correlations in the ΔPDF?"],
  ["lattice", "Is the UB right?"],
  ["symmetry", "Which Laue class should the symmetry average use?"],
  ["coverage", "Does Qmax stay inside the coverage?"],
  ["compare", "Compare this run with the other dataset."],
  ["act: run", "Run the pipeline."],
  ["act: tune", "Tune the flatten and rerun."],
];

describe("2. the tools", () => {
  it("each tool's definition, and the offer by question", () => {
    say("## 2. Tool definitions (estimator: JSON of the specs at the prose rate)", "");
    const rows: (string | number)[][] = [];
    for (const [arm, on] of [["B", true], ["C", false]] as const) {
      const tools = toolsWithSkills(CHAT_TOOLS, on);
      for (const t of tools) {
        const spec = toolSpecs([t]);
        const whole = JSON.stringify(spec);
        const params = JSON.stringify(t.parameters);
        add({ group: "tools.description", name: t.name, arm, rate: "prose", est: prose(t.description), text: t.description });
        add({ group: "tools.parameters", name: t.name, arm, rate: "prose", est: prose(params), text: params });
        if (arm === "B") rows.push([t.name, n(t.description.length), n(params.length), n(toolsTokens(spec)), `${n(prose(whole) - prose(t.description) - prose(params))}`]);
      }
      const all = toolSpecs(tools);
      const descr = tools.reduce((s, t) => s + t.description.length, 0);
      const params = tools.reduce((s, t) => s + JSON.stringify(t.parameters).length, 0);
      say(
        `Arm ${arm}: ${tools.length} tools, ${n(JSON.stringify(all).length)} characters, ${n(toolsTokens(all))} est. tokens ` +
          `(descriptions ${n(descr)} chars = ${pct(descr, JSON.stringify(all).length)}, parameter schemas ${n(params)} chars).`,
      );
    }
    say("");
    rows.sort((a, b) => Number(String(b[3]).replace(/,/g, "")) - Number(String(a[3]).replace(/,/g, "")));
    table(["tool (arm B)", "description chars", "parameters chars", "est. tokens (whole spec)", "of which JSON framing"], rows);

    // What a local model is offered, by question (localTools.ts), arm B.
    say("Local tool offer by question (toolScoping \"question\", localTools.ts), arm B:", "");
    const offerRows = QUESTIONS.map(([label, q]) => {
      const offered = toolsFor(q, CHAT_TOOLS);
      return [label, offered.length, n(toolsTokens(toolSpecs(offered))), CHAT_TOOLS.filter((t) => !offered.includes(t)).map((t) => t.name).join(", ") || "none"];
    });
    table(["question", "tools offered", "est. tokens", "not offered"], offerRows);

    // The stage reviews: their instruction picks the offer.
    const reviews: ReviewStage[] = ["rings", "punch", "backfill", "flatten", "dpdf"];
    const reviewRows = reviews.map((stage) => {
      const msgs = buildStageReviewMessages(context, stage, null, { tools: true });
      const q = String(msgs[msgs.length - 1].content);
      const offered = toolsFor(q, CHAT_TOOLS);
      return [`review: ${stage}`, offered.length, n(toolsTokens(toolSpecs(offered)))];
    });
    table(["stage review (one click)", "tools offered", "est. tokens"], reviewRows);
  });
});

// ---------------------------------------------------------------- 3. the opening context

describe("3. the opening messages", () => {
  it("the context block, the acknowledgement, the task and the history", () => {
    say("## 3. Opening messages after the system prompt (estimator: prose 3.5, fenced JSON 1.4)", "");
    const rows: (string | number)[][] = [];
    for (const [arm, on] of [["B", true], ["C", false]] as const) {
      const msgs = buildChatMessages(context, [], TASK, null, { tools: true, skills: on });
      const [ctxMsg, ack, task] = msgs.slice(1);
      const ctxText = String(ctxMsg.content);
      add({ group: "opening.context", name: "context block (indent 1)", arm, rate: "message", est: msgTokens(ctxMsg), text: ctxText });
      add({ group: "opening.ack", name: "acknowledgement", arm, rate: "message", est: msgTokens(ack), text: String(ack.content) });
      add({ group: "opening.task", name: "validation TASK", arm, rate: "message", est: msgTokens(task), text: String(task.content) });
      const compactJson = JSON.stringify(JSON.parse(contextToJson(context, undefined, { skills: on })));
      const compactMsg: ChatMessage = { role: "user", content: `Diagnostic context for this reduction (metrics computed from the current cut):\n\`\`\`json\n${compactJson}\n\`\`\`` };
      add({ group: "whatif.context", name: "context block, compact JSON", arm, rate: "message", est: msgTokens(compactMsg), text: String(compactMsg.content) });
      rows.push([`arm ${arm}: context block as sent (JSON indent 1)`, n(ctxText.length), n(msgTokens(ctxMsg))]);
      rows.push([`arm ${arm}: the same, compact JSON (what-if)`, n(String(compactMsg.content).length), n(msgTokens(compactMsg))]);
      rows.push([`arm ${arm}: acknowledgement`, n(String(ack.content).length), n(msgTokens(ack))]);
      rows.push([`arm ${arm}: validation TASK`, n(String(task.content).length), n(msgTokens(task))]);
    }
    table(["message", "chars", "est. tokens"], rows);

    // The context's top-level groups, arm B, compact.
    const ctx = JSON.parse(contextToJson(context)) as Record<string, unknown>;
    const groupRows = Object.entries(ctx)
      .map(([k, v]) => [k, n(JSON.stringify(v).length), n(JSON.stringify(v, null, 1).length), n(data(JSON.stringify(v, null, 1)))] as (string | number)[])
      .sort((a, b) => Number(String(b[2]).replace(/,/g, "")) - Number(String(a[2]).replace(/,/g, "")));
    say("The context's groups (arm B):", "");
    table(["group", "compact chars", "indent-1 chars", "est. tokens as sent"], groupRows);

    // The chat history: the earlier turns go as their text, the newest CHAT_HISTORY_TURNS messages.
    const record = JSON.parse(readFileSync(join(REPO, "docs/evals/validation/ollama-gemma4-26b-dev.json"), "utf8")) as {
      runs: { case: string; conclusion: string | null }[];
    };
    const answers = record.runs.map((r) => (r.conclusion ?? "").length).filter((x) => x > 0);
    const avgAnswer = answers.reduce((a, b) => a + b, 0) / answers.length;
    const maxAnswer = Math.max(...answers);
    const question = 60; // a typical chat question's characters
    const turnPairs = CHAT_HISTORY_TURNS / 2;
    say(
      `Chat history (templates.ts: the newest ${CHAT_HISTORY_TURNS} messages, text only; tool results of earlier turns are not carried). ` +
        `Final answers on the gemma4 dev run: ${answers.length} answers, mean ${n(avgAnswer)} chars, max ${n(maxAnswer)}. ` +
        `${turnPairs} earlier exchanges at the mean: about ${n(turnPairs * (prose("x".repeat(question)) + prose("x".repeat(Math.round(avgAnswer))) + 10))} est. tokens; ` +
        `at the max: ${n(turnPairs * (prose("x".repeat(question)) + prose("x".repeat(maxAnswer)) + 10))}.`,
      "",
    );
  });
});

// ---------------------------------------------------------------- 4. the skills

describe("4. the skills", () => {
  it("each skill and reference page as read_skill returns it", () => {
    say("## 4. Skills (read_skill results count at the data rate, 1.4, as every tool result does)", "");
    const rows: (string | number)[][] = [];
    for (const s of allSkills()) {
      const body = readSkill(s.name);
      const stub = shorten(body);
      add({ group: "skill", name: s.name, arm: "B", rate: "data", est: data(body), text: body });
      rows.push([s.name, n(body.length), n(data(body)), n(prose(body)), n(stub.length)]);
      for (const r of s.references) {
        const page = readSkill(s.name, r.name);
        add({ group: "skill.reference", name: `${s.name} › ${r.name}`, arm: "B", rate: "data", est: data(page), text: page });
        rows.push([`  › ${r.name}`, n(page.length), n(data(page)), n(prose(page)), ""]);
      }
    }
    table(["skill / reference", "chars", "est. tokens (data rate, as counted)", "est. tokens (prose rate)", "shortened stub chars"], rows);
    say(`Reference pages are cut at ${n(REFERENCE_MAX_CHARS)} characters (read by section past that).`, "");
  });
});

// ---------------------------------------------------------------- 5. tool results (snapshots)

interface Sample {
  head: string;
  tool: string;
  sentChars: number | null;
  text: string;
}

/** The results a model-visible snapshot shows: each "## tool args" section's "N characters sent." and its block, compact as sent. */
function samples(file: string): Sample[] {
  const t = readFileSync(join(SNAPSHOTS, file), "utf8");
  const sections = t.split(/^## /m).slice(1);
  return sections.flatMap((sec) => {
    const head = sec.split("\n", 1)[0];
    const block = /```(json|text)?\n([\s\S]*?)\n```/.exec(sec);
    if (!block) return [];
    const sent = /(\d[\d,]*) characters sent/.exec(sec);
    let text = block[2];
    if (block[1] === "json") {
      try {
        text = JSON.stringify(JSON.parse(text));
      } catch {
        /* as shown */
      }
    }
    return [{ head, tool: head.split(" ")[0], sentChars: sent ? Number(sent[1].replace(/,/g, "")) : null, text }];
  });
}

/** A result's characters by top-level key, and in long strings (prose: over 60 characters). */
function anatomy(text: string): { keys: [string, number][]; proseChars: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { keys: [], proseChars: text.length };
  }
  let proseChars = 0;
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (v.length > 60) proseChars += v.length;
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(parsed);
  const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.entries(parsed).map(([k, v]) => [k, JSON.stringify(v).length] as [string, number]) : [];
  return { keys: keys.sort((a, b) => b[1] - a[1]), proseChars };
}

/** A JSON result's characters under every key named `key`, at any depth. */
function charsUnder(text: string, key: string): number {
  let total = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, c] of Object.entries(v)) {
        if (k === key) total += JSON.stringify(c).length + k.length + 4;
        else walk(c);
      }
  };
  try {
    walk(JSON.parse(text));
  } catch {
    return 0;
  }
  return total;
}

describe("5. tool results", () => {
  it("a sample of each tool's result, as sent (model-visible snapshots)", () => {
    say("## 5. Tool results (the snapshots' samples on the synthetic crystal; estimator: data rate, 1.4, rows of bare values 1.2)", "");
    for (const [arm, file] of [["B", "4-tool-results.md"], ["C", "4-tool-results-arm-c.md"]] as const) {
      const rows: (string | number)[][] = [];
      for (const s of samples(file)) {
        if (s.head.includes("does not exist") || s.head.includes("not JSON") || s.head.includes("outside the da")) continue;
        const a = anatomy(s.text);
        const short = shorten(s.text);
        if (arm === "B") add({ group: "result", name: s.head.slice(0, 90), arm, rate: "data", est: result(s.text), text: s.text });
        rows.push([
          s.head.slice(0, 60).replace(/\|/g, "/"),
          n(s.text.length),
          n(result(s.text)),
          a.proseChars ? `${n(a.proseChars)} (${pct(a.proseChars, s.text.length)})` : "0",
          n(short.length),
          a.keys.slice(0, 3).map(([k, c]) => `${k} ${n(c)}`).join("; "),
        ]);
      }
      say(`Arm ${arm} (${file}):`, "");
      table(["call", "chars", "est. tokens", "prose chars (strings > 60)", "shortened chars", "largest keys"], rows);
    }
    // The dev control's dpdf_peaks list, at the tool's defaults (the budget test's worst-case list).
    const peaks = JSON.stringify(DEV_CONTROL_PEAKS.response);
    say(`dpdf_peaks on the dev control (recorded server response, before the tool shapes it): ${n(peaks.length)} chars.`, "");

    // What-if: the verdict criteria sent with every assessment.
    const assessAll = samples("4-tool-results.md").find((s) => s.head.startsWith("assess_stage {}"));
    if (assessAll) {
      const crit = charsUnder(assessAll.text, "criterion");
      add({ group: "whatif.result", name: "assess_stage all: criterion fields", arm: "B", rate: "data", est: data("x".repeat(crit)), text: "", chars: crit });
      say(`assess_stage {stage: all}: ${n(assessAll.text.length)} chars, of which the five \`criterion\` texts ${n(crit)} (${pct(crit, assessAll.text.length)}): ${n(data("x".repeat(crit)))} est. tokens.`, "");
    }
  });

  it("the send-backs (answer checks) and the loop's notes", () => {
    say("## 6. Answer-check send-backs (5-answer-checks.md; a send-back also keeps the rejected draft in the conversation)", "");
    const rows: (string | number)[][] = [];
    for (const [arm, file] of [["B", "5-answer-checks.md"], ["C", "5-answer-checks-arm-c.md"]] as const) {
      const t = readFileSync(join(SNAPSHOTS, file), "utf8");
      for (const sec of t.split(/^## /m).slice(1)) {
        const head = sec.split("\n", 1)[0];
        const back = /Sent back to the model:\s*\n\s*```text\n([\s\S]*?)\n```/.exec(sec);
        if (!back) continue;
        add({ group: "sendback", name: head, arm, rate: "prose", est: prose(back[1]), text: back[1] });
        rows.push([`${arm}: ${head.slice(0, 70)}`, n(back[1].length), n(prose(back[1]))]);
      }
    }
    table(["send-back", "chars", "est. tokens"], rows);
  });
});

// ---------------------------------------------------------------- 7. a reply's requests

interface Call {
  name: string;
  args: Record<string, unknown>;
}
interface Sent {
  messages: ChatMessage[];
  tools?: ToolSpec[];
}

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
const read = (name: string, reference?: string): Call => ({ name: "read_skill", args: reference ? { name, reference } : { name } });

// The budget test's method order (its worst realistic turn), and a typical
// order from the gemma4 dev run (one skill, the checks it called most).
const ORDERS: Record<string, Call[]> = {
  "budget worst (method order)": [read("reduction-qc"), ...CHECKS, read("delta-pdf-interpretation"), read("delta-pdf-interpretation", "delta_pdf"), FEATURES],
  "typical (gemma4 dev, no run)": [
    read("reduction-qc"),
    { name: "describe_dataset", args: {} },
    { name: "assess_stage", args: { stage: "all" } },
    { name: "ub_check", args: {} },
    { name: "qmax_coverage", args: {} },
    { name: "measure_reciprocal_cut", args: { plane: "hk0", value: 0.5 } },
    { name: "measure_reciprocal_cut", args: { plane: "h0l", value: 0 } },
    FEATURES,
  ],
};

async function drive(baseUrl: string, calls: Call[], softBudget?: number) {
  resetTokenState();
  freshConsole();
  const sent: Sent[] = [];
  const script: StreamDelta[][] = [
    ...calls.map((c, i): StreamDelta[] => [{ toolCalls: [{ id: `call_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] }]),
    [{ content: "The answer." }],
  ];
  model.streamChat.mockImplementation((args: Sent) => {
    sent.push({ messages: [...args.messages], tools: args.tools });
    const reply = script.shift() ?? [];
    return (async function* () {
      for (const d of reply) yield d;
    })();
  });
  const b = armSetup("B", context);
  const settings: LlmSettings = { ...DEFAULT_SETTINGS, baseUrl, model: "scripted", followViews: false };
  await runAgent({
    messages: b.messages,
    tools: CHAT_TOOLS,
    ctx: { dataset: DATASET, datasets: DATASETS, skills: b.skills, skillsRead: b.skillsRead, earlierSteps: [] },
    settings,
    signal: new AbortController().signal,
    checkAnswers: false,
    ...(softBudget !== undefined ? { softBudget } : {}),
  });
  return sent;
}

/** One request by part: system, tools, opening (context, ack, task), skills, results. */
function parts(s: Sent, opening: number) {
  const called = new Map<string, string>();
  for (const m of s.messages) for (const c of m.tool_calls ?? []) called.set(c.id, c.function.name);
  const p = { system: 0, tools: s.tools ? toolsTokens(s.tools) : 0, opening: 0, skills: 0, results: 0 };
  s.messages.forEach((m, i) => {
    const t = msgTokens(m);
    const tool = m.role === "tool" ? called.get(m.tool_call_id ?? "") : m.tool_calls?.[0]?.function.name;
    if (i === 0) p.system += t;
    else if (i < opening) p.opening += t;
    else if (tool === "read_skill") p.skills += t;
    else p.results += t;
  });
  return { ...p, total: estimateTokens(baseTokens(s.messages, s.tools), KEY) };
}

describe("7. a reply's requests, as they grow", () => {
  it("request by request, with and without the loop's compaction", async () => {
    say("## 7. A reply's requests as they grow (arm B, local, uncalibrated estimator)", "");
    const opening = armSetup("B", context).messages.length;
    for (const [label, calls] of Object.entries(ORDERS)) {
      for (const [mode, budget] of [["no compaction", Infinity], ["with compaction (SOFT_BUDGET 24k, KEEP_FULL 3)", undefined]] as const) {
        const sent = await drive(OLLAMA, calls, budget);
        const rows = sent.map((s, i) => {
          const p = parts(s, opening);
          const what = i === 0 ? "(opening)" : calls[i - 1] ? `${calls[i - 1].name}${calls[i - 1].args.reference ? " ref" : ""}` : "answer";
          return [i + 1, what, s.tools?.length ?? 0, n(p.system), n(p.tools), n(p.opening), n(p.skills), n(p.results), n(p.total), n(p.total + REPLY_RESERVE)];
        });
        if (label.startsWith("budget")) {
          const last = sent[sent.length - 1];
          if (budget === Infinity) requests.push({ label: "opening request (arm B, TASK offer)", est: parts(sent[0], opening).total, messages: sent[0].messages, tools: sent[0].tools });
          requests.push({ label: `budget worst, last request, ${mode}`, est: parts(last, opening).total, messages: last.messages, tools: last.tools });
        }
        say(`${label}, ${mode}:`, "");
        table(["req", "after call", "tools", "system", "tools", "opening", "skills", "results", "prompt", "+ reply reserve"], rows);
        const peak = Math.max(...sent.map((s) => parts(s, opening).total));
        const avg = sent.reduce((a, s) => a + parts(s, opening).total, 0) / sent.length;
        say(`Peak ${n(peak)} (+${n(REPLY_RESERVE)} = ${n(peak + REPLY_RESERVE)} against ${n(WINDOW)}); mean request ${n(avg)}; ${sent.length} requests.`, "");
      }
    }
    // LM Studio loaded with 32k: the guard shortens down to the newest.
    model.loadedContext.mockResolvedValue({ loaded: WINDOW, max: 131_072 });
    const sent = await drive(LM_STUDIO, ORDERS["budget worst (method order)"]);
    const peak = Math.max(...sent.map((s) => parts(s, opening).total));
    say(`LM Studio loaded with 32k, budget worst order: peak ${n(peak)}, ${n(WINDOW - peak)} left for the reply.`, "");
    expect(sent.length).toBeGreaterThan(1);

    // The largest prompts tokenBudget.test.ts holds to its ceilings, and its
    // tracked headroom target (docs/development.md, "The Pilot's token budget").
    const method = ORDERS["budget worst (method order)"];
    const reads = method.filter((c) => c.name === "read_skill");
    const checks = method.filter((c) => c.name !== "read_skill");
    const largest = async (baseUrl: string, calls: Call[], budget?: number) =>
      Math.max(...(await drive(baseUrl, calls, budget)).map((s) => parts(s, opening).total));
    const measures: [string, number, number][] = [
      ["console (Claude, every tool), method order", await largest("https://api.anthropic.com", method), 64_000],
      ["arm B local, before compaction", await largest(OLLAMA, method, Infinity), REPLY_RESERVE],
      ["arm B local, skills read first, after compaction", await largest(OLLAMA, [...reads, ...checks]), REPLY_RESERVE],
      ["arm B local, method order, after compaction", await largest(OLLAMA, method), REPLY_RESERVE],
      ["arm B local, skills read last, after compaction", await largest(OLLAMA, [...checks, ...reads]), REPLY_RESERVE],
    ];
    say("The budget test's largest prompts (tokenBudget.test.ts holds each to a ceiling):", "");
    table(
      ["turn", "largest prompt", "+ reply reserve"],
      measures.map(([what, p, reserve]) => [what, n(p), n(p + reserve)]),
    );
    const target = Math.floor(0.8 * WINDOW);
    const worstAfter = Math.max(measures[3][1], measures[4][1]) + REPLY_RESERVE;
    say(
      `Headroom target (tracked): the worst local turn after compaction, ${n(worstAfter)} with the reply reserve, ` +
        `against ${n(target)} (20 % under ${n(WINDOW)}): ${worstAfter > target ? `over by ${n(worstAfter - target)}` : "met"}.`,
      "",
    );
  });
});

// ---------------------------------------------------------------- 8. one rule, many homes

// Rules the Pilot must hold, each found by its words, and where the model
// reads it in arm B: the system message, the tools' descriptions, the skills'
// bodies, and the verdict criteria every assess_stage result carries.
const RULES: [string, RegExp][] = [
  ["symmetrised volume: UB fit is partial; orientation needs the unsymmetrised file", /unsymmetri[sz]ed/gi],
  ["an offset that changes with |Q| is not a UB error", /not a UB error/gi],
  ["a powder ring rises in nearly every direction (3-D test)", /nearly every direction/gi],
  ["pedestal: trend and span both 0.8 or more", /(both|and a span both) 0\.8|0\.8 or more/gi],
  ["window weight on unmeasured space (≤ 1e-3)", /unmeasured space/gi],
  ["a declared symmetry holds to ~1e-3", /holds? to (about |~)?1e-3/gi],
  ["back-FFT r ≈ 1 only shows the transform ran", /ran correctly|is the identity|as proof/gi],
  ["the Laue class / symmetry average is the user's to set", /(class|symmetry average)[^.]{0,40}user's|user's to set/gi],
  ["verdicts come from the tools; never self-grade", /never grade|checks', not yours|never decide it/gi],
  ["mark_region for a finding the user should see", /mark_region/gi],
  ["Qmin/Qmax from where the raw counts begin and end", /counts (begin|end)|raw counts' (\|Q\| )?edges/gi],
  ["measure another / off-zero cut before a verdict", /off-zero|another (plane|cut)/gi],
  ["Q² term for an inelastic pedestal", /b·Q²|flattenQ2|Q² term/gi],
  ["band and magnetic ion stay with the user", /magnetic ion/gi],
  ["a stage's skill is read before its settings change", /(refused|only after)[^.]{0,60}(read|skill)/gi],
  ["dpdf_contrast before describing a ΔPDF figure", /dpdf_contrast/gi],
];

describe("8. one rule, many homes", () => {
  it("each rule's mentions, by where the model reads it (arm B)", () => {
    say("## 8. One rule, many homes (arm B: mentions of each rule's words)", "");
    const homes: [string, string][] = [
      ["system", [SYSTEM.text(true), TOOLS.text(true), skillsPrompt()].join("\n")],
      ["tool descriptions", CHAT_TOOLS.map((t) => t.description).join("\n")],
      ["skills", allSkills().map((s) => readSkill(s.name)).join("\n")],
      ["result criteria", Object.values(WORDS.criterion).join("\n")],
    ];
    const rows = RULES.map(([rule, re]) => {
      const counts = homes.map(([, text]) => (text.match(re) ?? []).length);
      return [rule, ...counts, counts.filter((c) => c > 0).length];
    });
    table(["rule", ...homes.map(([h]) => h), "homes"], rows);
  });
});

// ---------------------------------------------------------------- 9. what-ifs on real results

// Mechanical reshapes of results the tools return today, measured on the
// synthetic crystal (and the dev control's dpdf_peaks list): the same
// numbers, fewer characters. Measurement only: no tool is changed.
type Obj = Record<string, unknown>;

describe("9. what-ifs on the tools' results", () => {
  it("the same numbers, reshaped", async () => {
    say("## 9. What-ifs: the same numbers, reshaped (synthetic crystal; dev control's dpdf_peaks)", "");
    const { callTool } = await import("../../web/src/llm/tools");
    const run = async (name: string, args: Obj = {}) => {
      freshConsole();
      const r = await callTool({ dataset: DATASET, datasets: DATASETS }, name, args);
      return r.text;
    };
    const rows: (string | number)[][] = [];
    const row = (what: string, before: string, after: string) => {
      rows.push([what, n(before.length), n(after.length), n(result(before) - result(after)), pct(before.length - after.length, before.length)]);
      add({ group: "whatif.reshape", name: what, arm: "B", rate: "data", est: result(after), text: after });
    };

    // Done in THY-63 R1 (signed sizes, column tables, the terse criterion on
    // later calls) and R2 (dpdf_peaks' reading in its description,
    // configure_settings without its defaults); what is left needs a skill
    // changed (R4).
    const qmax = await run("qmax_coverage");
    const q = JSON.parse(qmax) as Obj;
    row("qmax_coverage: band_check and reach_from folded into the verdict (band_check is named in reduction-qc: R4)", qmax, JSON.stringify({ ...q, band_check: undefined, reach_from: undefined }));

    const settings = await run("configure_settings");
    add({ group: "whatif.reshape", name: "configure_settings as is", arm: "B", rate: "data", est: data(settings), text: settings });
    table(["reshape", "chars before", "chars after", "est. tokens saved", "share"], rows);
    say(`configure_settings returns ${n(settings.length)} chars (${n(data(settings))} est. tokens) on the synthetic crystal: the settings off their defaults.`, "");

    // Tool descriptions capped: the most a cap could save (arm B, all 28).
    for (const cap of [600, 400, 300]) {
      const over = CHAT_TOOLS.reduce((s, t) => s + Math.max(0, t.description.length - cap), 0);
      say(`Tool descriptions capped at ${cap} characters: at most ${n(over)} chars (${n(prose("x".repeat(over)))} est. tokens) saved over all 28 tools.`);
    }
    say("");
  });
});
