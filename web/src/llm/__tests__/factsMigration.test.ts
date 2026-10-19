// FOR THE MIGRATION PR ONLY (refactor/tool-facts): delete once it has merged.
//
// Before each tool declared its facts, eleven modules kept their own lists of
// tool names. They are pinned here as they stood (as of PR #20), with the old
// functions copied verbatim, and held against what the facts give now: every
// derived list equals its old one, or differs by a named exception
// (REPLAYED_THOUGH_LOCAL). The old toolsFor is the oracle for the new one,
// over the validation's task and every scenario and held-out question.

import { describe, expect, it } from "vitest";

import { HELDOUT_SCENARIOS } from "../evals/heldout";
import { SCENARIOS } from "../evals/scenarios";
import { TASK } from "../evals/validation";
import { CORE_TOOLS as DERIVED_CORE_TOOLS, toolsFor } from "../localTools";
import { REPORT_TOOLS as DERIVED_REPORT_TOOLS } from "../report/collect";
import { unreadSkillRefusal } from "../skills";
import { CHAT_TOOLS, factsOf, toolsWhere, type AgentTool } from "../tools";
import type { HighlightKey } from "../tools/facts";
import { SAMPLE_PARAMS, TUNE_PARAMS, TUNE_STAGES, type TuneStage } from "../tune/catalog";

type Args = Record<string, unknown>;
const NAMES = CHAT_TOOLS.map((t) => t.name);
const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

// ---------------------------------------------------------------- the old lists

// agent.ts: calls after which the same reading may differ (the repeat guard).
const CHANGES_STATE = ["update_settings", "run_pipeline", "tune_pipeline", "show_in_viewer", "dpdf_contrast"];
// evidence.ts: the run that recomputes stages.
const RECOMPUTES = ["run_pipeline"];
// report/collect.ts.
const REPORT_TOOLS = ["assess_stage", "tune_pipeline", "run_pipeline", "texture_check", "qmax_coverage", "symmetry_check", "grain_check"];
// evals/harness.ts ACTIONS; ChatView's Watch/Log button and highlight.ts's live stage.
const STARTS_RUNS = ["run_pipeline", "tune_pipeline"];
// evals/scripted.ts replayTools' default, and thy18.test.ts: the tools a replay runs as they are.
const REPLAY_LOCAL = ["read_skill", "update_settings", "configure_settings"];

// components/ChatView.tsx.
const TOOL_LABELS: Record<string, string> = {
  read_skill: "Read a skill",
  describe_dataset: "Read the dataset",
  current_view: "Checked your view",
  measure_reciprocal_cut: "Measured a reciprocal cut",
  measure_dpdf_cut: "Measured a ΔPDF section",
  line_profile: "Took a line profile",
  bragg_peaks: "Looked up Bragg peaks",
  consistency_details: "Read the back-FFT check",
  compare_datasets: "Compared datasets",
  configure_settings: "Read the run settings",
  assess_stage: "Assessed a stage",
  radial_profile: "Took a radial profile",
  texture_check: "Checked for texture",
  qmax_coverage: "Checked Qmax against coverage",
  symmetry_check: "Checked the ΔPDF's symmetry",
  dpdf_contrast: "Set the ΔPDF's contrast",
  dpdf_peaks: "Listed the ΔPDF's strongest features",
  grain_check: "Checked for a second grain",
  ub_check: "Checked the UB",
  run_log: "Read the run log",
  update_settings: "Changed settings",
  run_pipeline: "Ran the pipeline",
  tune_pipeline: "Tuned the pipeline",
  show_in_viewer: "Opened the viewer",
};
const RUNNING_LABELS: Record<string, string> = {
  run_pipeline: "Running the pipeline",
  tune_pipeline: "Tuning the pipeline",
};

// localTools.ts, verbatim.
const CORE_TOOLS = [
  "read_skill",
  "describe_dataset",
  "current_view",
  "configure_settings",
  "assess_stage",
  "measure_reciprocal_cut",
  "line_profile",
  "run_log",
  "show_in_viewer",
];
const LOCAL_TOPICS: { about: RegExp; tools: string[] }[] = [
  { about: /\brings?\b|powder|alumin|\bAl\b/i, tools: ["radial_profile", "texture_check"] },
  { about: /punch|bragg|peaks?\b|reflections?|satellites?|\bnodes?\b|off.?lattice/i, tools: ["bragg_peaks", "grain_check", "ub_check"] },
  { about: /backfill|\bfill|seams?\b|\bholes?\b/i, tools: ["texture_check", "radial_profile"] },
  { about: /flatten|background|floors?\b|incoherent|b·q|q²|magnetic|form factor/i, tools: ["radial_profile"] },
  {
    about: /Δ\s?pdf|delta.?pdf|\bpdf\b|real.?space|window|apodi|\bband\b|q.?max|fft|transform|consistency|features?\b|correlations?\b/i,
    tools: ["measure_dpdf_cut", "dpdf_peaks", "dpdf_contrast", "qmax_coverage", "symmetry_check", "consistency_details"],
  },
  { about: /\bub\b|orient|lattice|\bcell\b|grains?\b|twin|tilt/i, tools: ["ub_check", "grain_check", "bragg_peaks"] },
  { about: /symmetr|6\/mmm|\bmmm\b|equivalen|hexagonal|six.?fold/i, tools: ["symmetry_check"] },
  { about: /coverage|measured|counts? (end|stop)|\|q\|/i, tools: ["qmax_coverage"] },
  { about: /compar|temperature|other datasets?|between datasets/i, tools: ["compare_datasets"] },
];
// The AskedAbout each of LOCAL_TOPICS became, in its order.
const LOCAL_TOPIC_NAMES = ["rings", "punch", "backfill", "flatten", "pdf", "lattice", "symmetry", "coverage", "compare"];
const DEFAULT_TOOLS = ["radial_profile", "qmax_coverage", "symmetry_check", "bragg_peaks"];
const ACT_TOOLS = ["update_settings", "run_pipeline", "tune_pipeline"];
const ASKS_TO_ACT =
  /(^|[.!?\n]\s*|\b(please|can you|could you|would you|go ahead and|then)\s+)(raise|lower|increase|decrease|set|change|use|switch|turn|enable|disable|apply|run|rerun|re-run|tune|try|update|make|redo)\b/i;
const CHOSEN = new Set([...LOCAL_TOPICS.flatMap((t) => t.tools), ...DEFAULT_TOOLS, ...ACT_TOOLS]);
function oldToolsFor(question: string, tools: AgentTool[]): AgentTool[] {
  const names = new Set(CORE_TOOLS);
  const topics = LOCAL_TOPICS.filter((t) => t.about.test(question));
  for (const name of (topics.length ? topics.flatMap((t) => t.tools) : DEFAULT_TOOLS)) names.add(name);
  if (ASKS_TO_ACT.test(question.trim())) ACT_TOOLS.forEach((name) => names.add(name));
  return tools.filter((t) => names.has(t.name) || !CHOSEN.has(t.name));
}

// answerChecks.ts TOPICS' settles, verbatim.
interface Step {
  name: string;
  args: Args;
}
const stageIs = (step: Step, ...stages: string[]): boolean =>
  step.name === "assess_stage" && (step.args.stage === undefined || ["all", ...stages].includes(String(step.args.stage)));
const OLD_SETTLES: Record<string, (s: Step) => boolean> = {
  rings: (s) => stageIs(s, "rings"),
  punch: (s) => stageIs(s, "punch"),
  backfill: (s) => s.name === "texture_check" || stageIs(s, "backfill"),
  flatten: (s) => stageIs(s, "flatten"),
  coverage: (s) => s.name === "qmax_coverage",
  symmetry: (s) => s.name === "symmetry_check",
  grain: (s) => s.name === "grain_check",
  pdf: (s) => stageIs(s, "pdf"),
  ub: (s) => s.name === "ub_check" || s.name === "grain_check",
  origin: (s) => s.name === "ub_check",
  features: (s) => s.name === "dpdf_peaks" || s.name === "measure_dpdf_cut" || (s.name === "line_profile" && s.args.stage === "delta_pdf"),
};

// highlight.ts stepKeys, verbatim.
const RECIP: HighlightKey[] = ["rings", "punch", "backfill", "flatten"];
const ALL_STAGES: HighlightKey[] = [...RECIP, "pdf"];
const STAGE_KEY: Record<string, HighlightKey> = {
  raw: "raw",
  rings: "rings",
  ringremoved: "rings",
  punch: "punch",
  braggpunched: "punch",
  backfill: "backfill",
  backfilled: "backfill",
  flatten: "flatten",
  flattened: "flatten",
  pdf: "pdf",
  delta_pdf: "pdf",
  pdf_check: "check",
};
const stageKey = (name: string): HighlightKey | undefined => STAGE_KEY[name];
const keysOf = (names: unknown): HighlightKey[] =>
  Array.isArray(names) ? names.map((n) => stageKey(String(n))).filter((k): k is HighlightKey => Boolean(k)) : [];
function oldStepKeys(step: Step): HighlightKey[] {
  const a = step.args ?? {};
  switch (step.name) {
    case "assess_stage": {
      const s = typeof a.stage === "string" ? a.stage : "all";
      if (s === "all") return ALL_STAGES;
      const k = stageKey(s);
      return k === "pdf" ? ["pdf", "check"] : k ? [k] : [];
    }
    case "measure_reciprocal_cut":
      return RECIP;
    case "measure_dpdf_cut":
      return ["pdf"];
    case "line_profile":
      return keysOf([a.stage]);
    case "radial_profile":
      return a.stages === undefined ? ["raw", ...RECIP] : keysOf(a.stages);
    case "texture_check":
      return ["punch", "backfill"];
    case "qmax_coverage":
      return ["raw", "pdf"];
    case "bragg_peaks":
      return ["bragg"];
    case "consistency_details":
      return ["check"];
    case "run_log":
      return ["log"];
    case "update_settings": {
      const changes = a.changes && typeof a.changes === "object" ? Object.keys(a.changes) : [];
      return keysOf(changes.map((key) => TUNE_PARAMS.find((p) => p.key === key)?.stage));
    }
    case "run_pipeline":
      return a.from_stage === undefined ? ALL_STAGES : keysOf([a.from_stage]);
    case "tune_pipeline":
      return a.stages === undefined ? ALL_STAGES : keysOf(a.stages);
    default:
      return [];
  }
}

// skills.ts stagesActedOn, verbatim.
const SETTING_STAGE = new Map([...TUNE_PARAMS, ...SAMPLE_PARAMS].map((p) => [p.key as string, p.stage]));
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
function oldStagesActedOn(tool: string, args: Record<string, unknown>): TuneStage[] {
  if (tool === "update_settings") {
    const changes = args.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
    return unique(Object.keys(changes).flatMap((k) => (SETTING_STAGE.has(k) ? [SETTING_STAGE.get(k)!] : [])));
  }
  if (tool === "tune_pipeline") {
    const stages = Array.isArray(args.stages) && args.stages.length ? args.stages : TUNE_STAGES;
    return unique(stages.filter((s): s is TuneStage => (TUNE_STAGES as readonly unknown[]).includes(s)));
  }
  return [];
}

// unreadSkillRefusal's words with no skill read, captured from the old code.
const OLD_REFUSALS: [string, Args, string][] = [
  ["update_settings", { changes: { punchMinSig: 6, backfillMethod: "laplace" } }, 'read the method first: call read_skill with name "bragg-node-audit". It is how the user works on the Bragg punch, backfill stages, and this change waits until it has been read in this conversation.'],
  ["update_settings", { changes: { punchMinSig: 6, pdfApod: "hann", nope: 1 } }, 'read the method first: call read_skill with name "bragg-node-audit" and "delta-pdf-interpretation". It is how the user works on the Bragg punch, 3D-ΔPDF stages, and this change waits until it has been read in this conversation.'],
  ["tune_pipeline", {}, 'read the method first: call read_skill with name "reduction-qc" and "bragg-node-audit" and "delta-pdf-interpretation". It is how the user works on the ring removal, Bragg punch, backfill, flatten, 3D-ΔPDF stages, and this tuning waits until it has been read in this conversation.'],
  ["tune_pipeline", { stages: ["rings", "flatten"] }, 'read the method first: call read_skill with name "reduction-qc". It is how the user works on the ring removal, flatten stages, and this tuning waits until it has been read in this conversation.'],
  ["tune_pipeline", { stages: ["raw", "pdf"] }, 'read the method first: call read_skill with name "delta-pdf-interpretation". It is how the user works on the 3D-ΔPDF stage, and this tuning waits until it has been read in this conversation.'],
];

// ---------------------------------------------------------------- the grid

const ARGS: Args[] = [
  {},
  { stage: "all" },
  ...["rings", "punch", "backfill", "flatten", "pdf", "raw", "delta_pdf", "braggpunched", "flattened", "nope", 5, null].map((stage) => ({ stage })),
  { stages: ["rings", "flatten"] },
  { stages: ["raw", "pdf"] },
  { stages: "x" },
  { stages: [] },
  { from_stage: "punch" },
  { from_stage: "nope" },
  { changes: { punchMinSig: 6, backfillMethod: "laplace" } },
  { changes: { punchMinSig: 6, pdfApod: "hann", nope: 1 } },
  { changes: { pdfApod: "hann", punchSupercellH: "1/3" } }, // a sample fact: gated, lights no card
  { changes: "x" },
  { changes: [] },
  { changes: {} },
];
const GRID = [...NAMES, "custom"].flatMap((name) => ARGS.map((args) => ({ name, args })));
const custom: AgentTool = { name: "custom", description: "d", parameters: {}, run: async () => ({ result: {}, summary: "" }) };

describe("the old lists against the facts", () => {
  it("1. the repeat guard: a tool that acts clears it, as CHANGES_STATE did", () => {
    expect(sorted(toolsWhere((f) => f.acts !== null))).toEqual(sorted(CHANGES_STATE));
  });

  it("2. the local offer: CORE_TOOLS, ACT_TOOLS, and each tool's questions turned around", () => {
    expect(sorted(toolsWhere((f) => f.offeredFor === "always" && !f.actsOnPipeline))).toEqual(sorted(CORE_TOOLS));
    expect(sorted(DERIVED_CORE_TOOLS)).toEqual(sorted(CORE_TOOLS));
    expect(sorted(toolsWhere((f) => f.actsOnPipeline))).toEqual(sorted(ACT_TOOLS));
    for (const name of NAMES) {
      const asked = LOCAL_TOPICS.flatMap((t, i) => (t.tools.includes(name) ? [LOCAL_TOPIC_NAMES[i]] : []));
      if (DEFAULT_TOOLS.includes(name)) asked.push("general");
      const offered = factsOf(name).offeredFor;
      expect(offered === "always" ? [] : sorted(offered), name).toEqual(sorted(asked));
    }
  });

  it("2. the local offer: toolsFor gives what the old one gave, on every eval question and the validation's task", () => {
    const questions = [
      TASK,
      ...SCENARIOS.map((s) => s.question),
      ...HELDOUT_SCENARIOS.map((s) => s.question),
      "How does this reduction look?",
      "Should I switch to the separable window?",
      "The rings look fine. Can you rerun the pipeline?",
      "Please tune the flatten.",
      "Which correlations does the data show?",
      "Compare the two temperatures' backgrounds.",
    ];
    expect(questions.length).toBeGreaterThan(18);
    const stubbed = CHAT_TOOLS.map((t) => ({ ...t, run: async () => ({ result: {}, summary: "" }) }));
    const lists: AgentTool[][] = [CHAT_TOOLS, stubbed, CHAT_TOOLS.filter((t) => t.name !== "read_skill"), [...CHAT_TOOLS, custom]];
    for (const q of questions) {
      for (const tools of lists) {
        expect(toolsFor(q, tools).map((t) => t.name), q).toEqual(oldToolsFor(q, tools).map((t) => t.name));
      }
    }
  });

  it("3. the answer checks: each tool settles the topics the old predicates gave it", () => {
    for (const step of GRID) {
      const old = Object.keys(OLD_SETTLES).filter((topic) => OLD_SETTLES[topic](step));
      expect(sorted(factsOf(step.name).settles(step.args)), `${step.name} ${JSON.stringify(step.args)}`).toEqual(sorted(old));
    }
  });

  it("5. the report: the same seven tools", () => {
    expect(sorted(toolsWhere((f) => f.reportable))).toEqual(sorted(REPORT_TOOLS));
    expect(sorted(DERIVED_REPORT_TOOLS)).toEqual(sorted(REPORT_TOOLS));
  });

  it("6. the transcript's labels, running and done, with the name as the fallback", () => {
    for (const name of [...NAMES, "custom"]) {
      expect(factsOf(name).label, name).toBe(TOOL_LABELS[name] ?? name);
      expect(factsOf(name).runningLabel, name).toBe(RUNNING_LABELS[name] ?? TOOL_LABELS[name] ?? name);
    }
  });

  it("7. the highlights: each step lights the cards stepKeys gave", () => {
    for (const step of GRID) expect(factsOf(step.name).highlights(step.args), `${step.name} ${JSON.stringify(step.args)}`).toEqual(oldStepKeys(step));
  });

  it("8. the runs: the tools that start them", () => {
    expect(toolsWhere((f) => f.startsRuns)).toEqual(STARTS_RUNS);
  });

  it("9. the replays: the tools that reach no backend, save run_log, which stays replayed", () => {
    const local = toolsWhere((f) => !f.reachesBackend);
    expect(sorted(local)).toEqual(sorted([...REPLAY_LOCAL, "run_log"]));
  });

  it("11. the skill gate: the stages each call changes or tunes, and its refusal's words", () => {
    for (const step of GRID) {
      expect(factsOf(step.name).gate?.stages(step.args) ?? [], `${step.name} ${JSON.stringify(step.args)}`).toEqual(oldStagesActedOn(step.name, step.args));
    }
    for (const [name, args, words] of OLD_REFUSALS) expect(unreadSkillRefusal(name, args, new Set())).toBe(words);
  });

  it("evidence.ts: only the pipeline run recomputes outputs", () => {
    expect(toolsWhere((f) => f.invalidates.includes("outputs"))).toEqual(RECOMPUTES);
  });
});
