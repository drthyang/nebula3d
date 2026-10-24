// The NEBULA Pilot eval harness.  A scenario is one question about one
// dataset, asked the way the chat panel asks it: the app's own agent loop
// (runAgent), the messages it builds (buildChatMessages over the pipeline
// context it loads) and its tools.  The run is then graded by deterministic
// checks on what the model called and what it answered.  The same harness
// drives a scripted model against recorded tool results in CI (evals.test.ts)
// and real models against a running backend (live.test.ts).

import type { Dataset } from "../../api/types";
import { configOf } from "../../state/configMemory";
import { usePipelineStore, type PipelineConfig } from "../../state/pipelineStore";
import { runAgent, type AgentStep } from "../agent";
import { loadPipelineContext } from "../context/loadContext";
import type { PipelineContext } from "../context/pipelineContext";
import { buildChatMessages } from "../prompts/templates";
import type { Failure } from "../recovery";
import type { LlmSettings } from "../settings";
import type { ComputedVerdict } from "../verdicts";
import { CHAT_TOOLS, factsOf, toolsWhere, type AgentTool } from "../tools";
import type { Dispute } from "./graderReading";

/** Token counts over a run's requests (provider/client.ts: TokenUsage), and how many requests they cover. */
export interface TokenCount {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  requests: number;
}

export interface EvalRun {
  scenario: string;
  steps: AgentStep[];
  content: string;
  note?: string;
  error?: string;
  // The model server failed the reply after its retries (recovery.ts): an
  // infrastructure failure, reported apart from a wrong answer.
  failure?: Failure | null;
  latencyMs: number;
  // The tokens of every request the run made, null when the server did not
  // say for one. A validation run's tuning (tune_pipeline) asks the run's
  // model, and its requests are counted in the totals, and apart in `tuning`
  // (validationRun.ts), which is there only when the run tuned.
  usage: (TokenCount & { tuning?: TokenCount }) | null;
  verdict?: ComputedVerdict | null; // computed from the reply's checks (verdicts/)
}

export interface Grade {
  check: string;
  pass: boolean;
  detail: string;
  // The graders' two readings of the answer disagree on this check: the shared
  // reader passes it, the witness fails it (graderReading.ts). Absent where they agree.
  dispute?: Dispute;
}

export interface Check {
  name: string;
  grade: (run: EvalRun) => { pass: boolean; detail: string; dispute?: Dispute };
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

/** Tools that write files on the backend, a run's outputs or a new dataset (their facts' `writesFiles`): an eval never runs them. */
export const ACTIONS = new Set(toolsWhere((f) => f.writesFiles));

/**
 * *tools* with the actions stubbed: a call is recorded (and graded) but fails
 * without reaching the backend, so a model that acts on a question cannot
 * change the datasets the next scenario reads.
 */
export const readOnly = (tools: AgentTool[]): AgentTool[] =>
  tools.map((t) =>
    ACTIONS.has(t.name)
      ? {
          ...t,
          run: async () => {
            const never = factsOf(t.name).startsRuns ? "start a pipeline run" : "write a new dataset";
            throw new Error(`not run: the evals never ${never} (the call is recorded)`);
          },
        }
      : t,
  );

export function pickDataset(datasets: Dataset[], suffix: string): Dataset {
  const hits = datasets.filter((d) => d.id.endsWith(suffix));
  if (hits.length !== 1) throw new Error(`${hits.length} datasets end with ${JSON.stringify(suffix)}`);
  return hits[0];
}

export function grade(scenario: Scenario, run: EvalRun): ScenarioResult {
  const grades = scenario.checks.map((c) => ({ check: c.name, ...c.grade(run) }));
  return { scenario: scenario.id, passed: !run.error && grades.every((g) => g.pass), grades, run };
}

/** A run as a scenario record keeps it (live.test.ts writes it into docs/evals/results/). */
export interface RecordedRun {
  scenario: string;
  latency_ms: number;
  usage: EvalRun["usage"];
  steps: Omit<AgentStep, "id">[];
  answer: string;
  note: string | null;
  error: string | null;
  failure?: EvalRun["failure"];
}

/** A recorded run as the run it records, to grade it again (NEBULA_EVAL_REGRADE) or read its answer. */
export const runOfRecord = (r: RecordedRun): EvalRun => ({
  scenario: r.scenario,
  steps: r.steps.map((s, i) => ({ id: String(i), ...s })),
  content: r.answer,
  note: r.note ?? undefined,
  error: r.error ?? undefined,
  failure: r.failure ?? null,
  latencyMs: r.latency_ms,
  usage: r.usage,
});

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
  // Every scenario starts from the defaults plus its dataset's settings: a
  // setting an earlier run changed (update_settings) does not carry over.
  usePipelineStore.getState().patch(configOf(usePipelineStore.getInitialState()));
  usePipelineStore.getState().patch(scenario.config);
  const ctx = context ?? (await loadPipelineContext(dataset)).context;
  const messages = buildChatMessages(ctx, [], scenario.question, null, { tools: true });
  const started = performance.now();
  let run: EvalRun;
  try {
    const result = await runAgent({
      messages,
      tools: readOnly(tools),
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
      failure: result.failure ?? null,
      latencyMs: performance.now() - started,
      usage: result.usage ?? null,
      verdict: result.verdict ?? null,
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
