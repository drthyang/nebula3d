// The NEBULA Pilot eval harness.  A scenario is one question about one
// dataset, asked the way the chat panel asks it: the app's own agent loop
// (runAgent), the messages it builds (buildChatMessages over the pipeline
// context it loads) and its tools.  The run is then graded by deterministic
// checks on what the model called and what it answered.  The same harness
// drives a scripted model against recorded tool results in CI (evals.test.ts)
// and real models against a running backend (live.test.ts).

import type { Dataset } from "../../api/types";
import { usePipelineStore, type PipelineConfig } from "../../state/pipelineStore";
import { runAgent, type AgentStep } from "../agent";
import { loadPipelineContext } from "../context/loadContext";
import type { PipelineContext } from "../context/pipelineContext";
import { buildChatMessages } from "../prompts/templates";
import type { LlmSettings } from "../settings";
import { CHAT_TOOLS, type AgentTool } from "../tools";

export interface EvalRun {
  scenario: string;
  steps: AgentStep[];
  content: string;
  note?: string;
  error?: string;
  latencyMs: number;
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number; requests: number } | null; // null: the server did not say
}

export interface Grade {
  check: string;
  pass: boolean;
  detail: string;
}

export interface Check {
  name: string;
  grade: (run: EvalRun) => { pass: boolean; detail: string };
}

export interface Scenario {
  id: string;
  title: string;
  origin: string; // the research finding the expected answer comes from
  dataset: string; // the end of the dataset's id
  config: Partial<PipelineConfig>; // the Configure settings the dataset was run with
  question: string;
  checks: Check[];
}

export interface ScenarioResult {
  scenario: string;
  passed: boolean;
  grades: Grade[];
  run: EvalRun;
}

export function pickDataset(datasets: Dataset[], suffix: string): Dataset {
  const hits = datasets.filter((d) => d.id.endsWith(suffix));
  if (hits.length !== 1) throw new Error(`${hits.length} datasets end with ${JSON.stringify(suffix)}`);
  return hits[0];
}

export function grade(scenario: Scenario, run: EvalRun): ScenarioResult {
  const grades = scenario.checks.map((c) => ({ check: c.name, ...c.grade(run) }));
  return { scenario: scenario.id, passed: !run.error && grades.every((g) => g.pass), grades, run };
}

export async function runScenario(
  scenario: Scenario,
  {
    datasets,
    settings,
    tools = CHAT_TOOLS,
    context,
    signal = new AbortController().signal,
  }: {
    datasets: Dataset[];
    settings: Pick<LlmSettings, "baseUrl" | "model" | "apiKey" | "temperature">;
    tools?: AgentTool[];
    context?: PipelineContext; // a recorded context (CI); else loaded from the backend
    signal?: AbortSignal;
  },
): Promise<ScenarioResult> {
  const dataset = pickDataset(datasets, scenario.dataset);
  usePipelineStore.getState().patch(scenario.config);
  const ctx = context ?? (await loadPipelineContext(dataset)).context;
  const messages = buildChatMessages(ctx, [], scenario.question, null, { tools: true });
  const started = performance.now();
  let run: EvalRun;
  try {
    const result = await runAgent({
      messages,
      tools,
      ctx: { dataset, datasets },
      settings: { ...settings, attachImages: false, useTools: true, followViews: false },
      signal,
      usage: true,
    });
    run = {
      scenario: scenario.id,
      steps: result.steps,
      content: result.content,
      note: result.note,
      latencyMs: performance.now() - started,
      usage: result.usage ?? null,
    };
  } catch (e) {
    run = {
      scenario: scenario.id,
      steps: [],
      content: "",
      error: (e as Error).message,
      latencyMs: performance.now() - started,
      usage: null,
    };
  }
  return grade(scenario, run);
}

/** A readable transcript of a run, for the failure report. */
export function transcript(run: EvalRun): string {
  const steps = run.steps.map((s) => `  → ${s.name}(${JSON.stringify(s.args)}) ${s.status}: ${s.summary ?? ""}`);
  return [...steps, run.error ? `  ERROR ${run.error}` : "", run.note ? `  NOTE ${run.note}` : "", run.content]
    .filter(Boolean)
    .join("\n");
}
