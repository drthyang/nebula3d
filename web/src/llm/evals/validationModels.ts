// The models the validation runs (docs/evals.md, "Does the Pilot help?"), the
// run policy that holds every local live run (the scenario evals' too), and
// the spend tracker that caps a paid model. Wired only: nothing here starts a
// run, and a paid model needs the user to type its cap (paidRunGate).
//
// Every model is described the same way: where it is served, the context the
// run needs it loaded with, the splits it may run, and the runs per case.

import { COMPLETE_MAX_TOKENS } from "../provider/anthropic";
import { isOllamaUrl, loadedContext, ollamaModel } from "../provider/client";
import { isLocalUrl } from "../provider/presets";
import { runPolicyOf, type RunPolicy } from "../runPolicy";
import type { LlmSettings } from "../settings";
import { casesToRun, datasetStem, type Arm, type RunContextWindow, type Split, type ValidationCase } from "./validation";

export interface Price {
  input: number; // US dollars per million tokens; `input` counts the cached tokens too
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ValidationModel {
  key: string;
  label: string;
  provider: string; // as the app's provider presets name it
  baseUrl: string;
  model: string; // the id the server knows it by
  local: boolean;
  contextTokens: number; // the context to load it with
  minContextTokens: number | null; // the least the run accepts (RUN_POLICY); null: a cloud model, not checked
  splits: readonly Split[]; // the splits it may run
  runsPerCase: number;
  temperature: number | null; // null: the model takes no sampling parameters, and none is sent (validationPolicy)
  apiKeyEnv: string | null; // the environment variable holding its key, never written out
  price: Price | null; // null: local, no cost
  spendCapUsd: number | null; // null: no cap, because nothing is paid
  how: string; // what to do before it runs
}

const LM_STUDIO = "http://localhost:1234/v1";
const OLLAMA = "http://localhost:11434/v1";

/**
 * The run policy: settings that hold for every run of the validation, whatever
 * the model, and for every local run of the scenario evals.
 *
 * minLocalContextTokens: the least context window a local live run may have,
 * 56k. The Pilot's worst turn on a local model (arm B on the validation TASK,
 * two skills read whole, the ΔPDF's features a full list) is about 47.6k
 * tokens with the reply reserve before the loop's compaction, and 37.7k to
 * 42k after it (tokenBudget.test.ts); a model-visible addition must leave 3k
 * of the minimum free. A 32k window holds the turn only by shortening the
 * skills just read to stubs, so a run at 32k would grade arm B on stubs of
 * the skills it read. The validation's runner (validation.live.test.ts) and
 * the scenario evals (live.test.ts, which scripts/eval-local.sh runs) refuse
 * a window under it before the first run, and read it again before each run
 * (runContext). The sibling app RMC keeps its own rule, 48k.
 */
export const RUN_POLICY = {
  minLocalContextTokens: 57_344,
} as const;

/**
 * The output cap of every model request in a validation run: the agent loop's,
 * in either arm, and its tuning's (tune_pipeline, which asks the run's model).
 * One cap for every model and arm keeps the arms comparable, where the app's
 * own caps differ by transport (Claude 64,000 for a reply and 16,000 for a
 * tuning request, anthropic.ts; a local server none, runPolicy.ts). A reply
 * cut at it is recorded and flagged, never graded silently (the record's
 * `truncated`, validation.ts). The manager's decision, confirmed by the user,
 * 2026-10-24 (plan 1.1).
 */
export const VALIDATION_MAX_TOKENS = 16_000;

/**
 * The policy a validation run runs under (runPolicy.ts): its transport's as
 * the app ships it, arm B being the Pilot as it ships, with the run's round
 * limit and the validation's output cap on every request, the loop's and the
 * tuning's. The temperature is the model's (MODELS): null for Claude, whose
 * transport sends none. The run's record keeps it (run_policy).
 */
export const validationPolicy = (settings: Pick<LlmSettings, "baseUrl" | "temperature">, rounds: number): RunPolicy => ({
  ...runPolicyOf(settings),
  maxRounds: rounds,
  outputCap: { loop: VALIDATION_MAX_TOKENS, tuning: VALIDATION_MAX_TOKENS },
});

const MIN_CONTEXT = RUN_POLICY.minLocalContextTokens;
const LOAD_IN_LM_STUDIO =
  `Load it in LM Studio with a Context Length of ${MIN_CONTEXT} or more, and make that the model's default ` +
  `(LM Studio reloads an idle model with its defaults); the run checks the loaded context and refuses less.`;

/**
 * What NEBULA may spend on a paid model: $12. The user's $40 is the total
 * across three apps' Sonnet runs, so $12 for each keeps the total under it.
 */
export const SPEND_CAP_USD = 12;
export const SPEND_TOTAL_USD = 40;
const CAP_SHARE = `$${SPEND_CAP_USD} for NEBULA, within the $${SPEND_TOTAL_USD} total`;

export const MODELS: readonly ValidationModel[] = [
  {
    key: "lmstudio-qwen3.8-27b",
    label: "qwen/qwen3.8-27b (LM Studio, 56k)",
    provider: "LM Studio",
    baseUrl: LM_STUDIO,
    model: "qwen/qwen3.8-27b",
    local: true,
    contextTokens: MIN_CONTEXT,
    minContextTokens: MIN_CONTEXT,
    splits: ["dev", "test"],
    runsPerCase: 3,
    temperature: 0.2,
    apiKeyEnv: null,
    price: null,
    spendCapUsd: null,
    how: LOAD_IN_LM_STUDIO,
  },
  {
    key: "ollama-gemma4-26b",
    label: "gemma4:26b (Ollama)",
    provider: "Ollama",
    baseUrl: OLLAMA,
    model: "gemma4:26b",
    local: true,
    contextTokens: MIN_CONTEXT,
    minContextTokens: MIN_CONTEXT,
    splits: ["dev", "test"],
    runsPerCase: 3,
    temperature: 0.2,
    apiKeyEnv: null,
    price: null,
    spendCapUsd: null,
    how:
      `Pull it (ollama pull gemma4:26b). The run sizes num_ctx for each request through Ollama's own chat API, ` +
      `up to the longest context the model supports, which must be ${MIN_CONTEXT} or more (the run reads it ` +
      `from /api/show and refuses less); the machine needs the memory for a window that long.`,
  },
  {
    key: "lmstudio-muse-glimmer",
    label: "meta/muse-glimmer (LM Studio)",
    provider: "LM Studio",
    baseUrl: LM_STUDIO,
    model: "meta/muse-glimmer",
    local: true,
    contextTokens: MIN_CONTEXT,
    minContextTokens: MIN_CONTEXT,
    splits: ["dev", "test"],
    runsPerCase: 3,
    temperature: 0.2,
    apiKeyEnv: null,
    price: null,
    spendCapUsd: null,
    how: LOAD_IN_LM_STUDIO,
  },
  {
    key: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5 (Anthropic)",
    provider: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-5-5",
    local: false,
    contextTokens: 32768,
    minContextTokens: null,
    splits: ["test"],
    runsPerCase: 3,
    temperature: null,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    // Anthropic's published prices, fetched 2026-10-10 (docs/evals.md).
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    spendCapUsd: SPEND_CAP_USD,
    how: `Paid (${CAP_SHARE}). Set ANTHROPIC_API_KEY and NEBULA_VALIDATION_ALLOW_SPEND=${SPEND_CAP_USD}; the test split only, with NEBULA_VALIDATION_REPORT=1.`,
  },
];

export const modelNamed = (key: string): ValidationModel => {
  const m = MODELS.find((x) => x.key === key);
  if (!m) throw new Error(`no validation model ${JSON.stringify(key)}; the models are ${MODELS.map((x) => x.key).join(", ")}`);
  return m;
};

export interface RunContext extends RunContextWindow {
  refusal: string | null; // why the run must not start, or null
}

const tokens = (x: number): string => x.toLocaleString("en-US");

/**
 * The context window a run on *model* at *baseUrl* will get, against the run
 * policy's minimum (RUN_POLICY), read without loading anything:
 * - LM Studio: the context the model is loaded with (`/api/v0/models`). A
 *   model it has not loaded would be loaded with its defaults, which cannot be
 *   read, so it is refused too.
 * - Ollama: the longest context the model supports (`/api/show`). The window
 *   plan (provider/window.ts) sizes num_ctx for each request up to it, so it is
 *   the most a run's window can grow to.
 * A window that cannot be read is refused: the minimum would go unchecked. A
 * cloud model has no minimum and is not asked. *model* is one of MODELS, or
 * one a run names by its server and id alone (modelAt).
 */
export async function runContext(
  model: Pick<ValidationModel, "model" | "minContextTokens">,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<RunContext> {
  const min = model.minContextTokens;
  if (min == null) return { tokens: null, min_tokens: null, read_from: null, refusal: null };
  const policy = `the run policy's minimum of ${tokens(min)} for a local live run (RUN_POLICY in validationModels.ts: the Pilot's worst turn needs about 47.6k tokens, tokenBudget.test.ts)`;
  if (isOllamaUrl(baseUrl)) {
    const { maxContext } = await ollamaModel(baseUrl, model.model, signal);
    const seen = { tokens: maxContext, min_tokens: min, read_from: "ollama-supported" as const };
    if (maxContext == null) {
      return {
        ...seen,
        refusal:
          `Ollama at ${baseUrl} did not say how long a context ${model.model} supports (POST /api/show), so the window ` +
          `cannot be held to ${policy}. Start Ollama and pull the model (ollama pull ${model.model}), then run again.`,
      };
    }
    if (maxContext < min) {
      return {
        ...seen,
        refusal:
          `${model.model} supports a context of at most ${tokens(maxContext)} tokens (Ollama's /api/show), under ${policy}. ` +
          `The run sizes num_ctx itself, up to what the model supports, so no setting gives it more: pick a model that supports ${tokens(min)} or more.`,
      };
    }
    return { ...seen, refusal: null };
  }
  const context = await loadedContext(baseUrl, model.model, { signal });
  const seen = { tokens: context?.loaded ?? null, min_tokens: min, read_from: "lmstudio-loaded" as const };
  const load =
    `In LM Studio, load ${model.model} with a Context Length of ${tokens(min)} or more (its load settings, or ` +
    `lms load ${model.model} --context-length ${min} once it is unloaded), and make that the model's default Context Length: ` +
    "LM Studio reloads an idle model with its defaults.";
  const supports = context?.max != null && context.max < min ? ` It supports at most ${tokens(context.max)}: pick a model that supports more.` : "";
  if (!context) {
    return {
      ...seen,
      refusal:
        `Could not read the context ${model.model} is loaded with from LM Studio at ${baseUrl} (GET /api/v0/models), so the ` +
        `window cannot be held to ${policy}. Start LM Studio's server and load the model. ${load}`,
    };
  }
  if (context.loaded == null) {
    return {
      ...seen,
      refusal:
        `${model.model} is not loaded: LM Studio would load it with its default Context Length, which the run cannot read ` +
        `or hold to ${policy}. ${load}${supports}`,
    };
  }
  if (context.loaded < min) {
    return {
      ...seen,
      refusal: `${model.model} is loaded with a ${tokens(context.loaded)}-token context, under ${policy}. ${load}${supports}`,
    };
  }
  return { ...seen, refusal: null };
}

/**
 * A model a run names by its server and id alone, as the scenario evals do
 * (live.test.ts: NEBULA_EVAL_BASE_URL and NEBULA_EVAL_MODEL), for runContext.
 * On a local server it is a local live run, held to the run policy's minimum
 * like the validation's local models; a cloud model has none and is not asked.
 */
export const modelAt = (baseUrl: string, model: string): Pick<ValidationModel, "model" | "minContextTokens"> => ({
  model,
  minContextTokens: isLocalUrl(baseUrl) ? RUN_POLICY.minLocalContextTokens : null,
});

/** What a run cost, from its token counts: null when the server did not say, or the model has no price. */
export function costOf(
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null,
  price: Price | null,
): number | null {
  if (!usage || !price) return null;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const plain = usage.input - cacheRead - cacheWrite;
  return (plain * price.input + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite + usage.output * price.output) / 1e6;
}

/**
 * A paid model runs only when the user has typed its cap: the environment's
 * NEBULA_VALIDATION_ALLOW_SPEND must equal the model's cap in dollars. Returns
 * why it must not run, or null.
 */
export function paidRunGate(model: ValidationModel, allow: string | undefined): string | null {
  if (model.spendCapUsd === null) return null;
  if (allow === undefined || Number(allow) !== model.spendCapUsd) {
    return `${model.label} is paid: set NEBULA_VALIDATION_ALLOW_SPEND=${model.spendCapUsd} to approve spending at most $${model.spendCapUsd} on it (${CAP_SHARE})`;
  }
  return null;
}

export interface Job {
  case: ValidationCase;
  arm: Arm;
  run: number;
  stem: string;
}

/**
 * The runs of a model on a split, run-major: every case and arm once, then
 * again, so a spend cap that stops it early leaves whole repeats behind. The
 * test split needs *report*, and a model that may not run a split is refused.
 */
export function plan(
  model: ValidationModel,
  split: Split,
  { report = false, arms = ["B", "C"] as readonly Arm[], only = [] as readonly string[], runs = model.runsPerCase } = {},
): Job[] {
  if (!model.splits.includes(split)) {
    throw new Error(`${model.label} runs the ${model.splits.join(" and ")} split only, not ${split}`);
  }
  const cases = casesToRun(split, { report }).filter((c) => !only.length || only.includes(c.id));
  const jobs: Job[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const c of cases) for (const arm of arms) jobs.push({ case: c, arm, run, stem: datasetStem(c.id, arm, run) });
  }
  return jobs;
}

export interface SpendEntry {
  case: string;
  arm: string;
  run: number;
  usd: number;
  estimated: boolean; // the server gave no token counts: charged at the reserve
}

/**
 * The dearest first run, in tokens: what SpendTracker.FIRST_RUN_RESERVE_USD
 * prices.
 *
 * - The agent loop: its 12 rounds of tool calls and the answer, 13 requests,
 *   each of at most 40,000 tokens in, uncached, and 16,000 out over the run.
 * - One tuning (tune_pipeline) of all five stages at its most trials, five: a
 *   stage asks for alternatives, once more after a reply none of whose
 *   candidates can run, then for the pick, so 3 requests a stage and 15 in
 *   all. Each is at most 12,500 tokens in: the largest the replay measures is
 *   the ring stage's pick of five trials on the dev cases at the validation's
 *   grid, about 16,900 characters, 12,100 tokens at the token estimate's rate
 *   for number-dense JSON (1.4 characters a token, provider/tokens.ts) for
 *   every character (validationRun.replay.test.ts pins it). Each is at most
 *   16,000 tokens out, its max_tokens, thinking included.
 * - A 25% margin on the whole.
 */
export const FIRST_RUN_WORST = {
  loop: { requests: 13, inputPerRequest: 40_000, outputOverRun: 16_000 },
  tuning: { requests: 15, inputPerRequest: 12_500, outputPerRequest: COMPLETE_MAX_TOKENS },
  margin: 0.25,
} as const;

/** What FIRST_RUN_WORST costs at *price*, its margin included. */
export function firstRunWorstUsd(price: Price): number {
  const { loop, tuning, margin } = FIRST_RUN_WORST;
  const usd =
    (loop.requests * loop.inputPerRequest * price.input +
      loop.outputOverRun * price.output +
      tuning.requests * tuning.inputPerRequest * price.input +
      tuning.requests * tuning.outputPerRequest * price.output) /
    1e6;
  return usd * (1 + margin);
}

/**
 * Money spent on a paid model, against a cap. Before a run starts it must be
 * affordable at its worst: the first run is held to a ceiling set by the round
 * limit, the context and a tuning (FIRST_RUN_WORST), and later ones to 1.5
 * times the dearest so far. A run whose tokens the server did not report is
 * charged that reserve, so the total is never short. The ledger is a plain
 * list, kept between sessions.
 */
export class SpendTracker {
  /**
   * The dearest a first run can be, a run that tunes included (FIRST_RUN_WORST),
   * at Sonnet 5.5's price in MODELS ($2 per million tokens in, uncached; $10 out):
   *
   *   the agent loop:  13 requests × 40,000 in × $2/M  = $1.040
   *                    16,000 out over the run × $10/M = $0.160
   *   the tuning:      15 requests × 12,500 in × $2/M  = $0.375
   *                    15 requests × 16,000 out × $10/M = $2.400
   *   together                                         = $3.975
   *   with a 25% margin, × 1.25                        = $4.97, so $5.
   *
   * $5 is inside the $12 cap; later runs are held to 1.5 times the dearest so far.
   */
  static readonly FIRST_RUN_RESERVE_USD = 5;

  constructor(
    readonly capUsd: number,
    readonly entries: SpendEntry[] = [],
  ) {
    if (!(capUsd > 0)) throw new Error("the cap must be positive");
  }

  get spent(): number {
    return this.entries.reduce((sum, e) => sum + e.usd, 0);
  }

  get remaining(): number {
    return Math.max(0, this.capUsd - this.spent);
  }

  /** What the next run may cost at worst. */
  reserve(): number {
    const seen = this.entries.filter((e) => !e.estimated).map((e) => e.usd);
    return seen.length ? Math.max(1.5 * Math.max(...seen), 0.05) : SpendTracker.FIRST_RUN_RESERVE_USD;
  }

  canStart(): boolean {
    return this.spent + this.reserve() <= this.capUsd;
  }

  /** Why no run may start, or null. */
  refusal(): string | null {
    return this.canStart()
      ? null
      : `the spend cap is reached: $${this.spent.toFixed(2)} spent of $${this.capUsd.toFixed(2)}, and the next run may cost up to $${this.reserve().toFixed(2)}`;
  }

  record(entry: { case: string; arm: string; run: number; usd: number | null }): SpendEntry {
    const estimated = entry.usd === null;
    const e: SpendEntry = { case: entry.case, arm: entry.arm, run: entry.run, usd: entry.usd ?? this.reserve(), estimated };
    this.entries.push(e);
    return e;
  }

  toJSON(): { cap_usd: number; spent_usd: number; entries: SpendEntry[] } {
    return { cap_usd: this.capUsd, spent_usd: Math.round(this.spent * 1e6) / 1e6, entries: this.entries };
  }

  static fromJSON(x: unknown, capUsd: number): SpendTracker {
    const entries = (x as { entries?: SpendEntry[] } | null)?.entries;
    return new SpendTracker(capUsd, Array.isArray(entries) ? entries.map((e) => ({ ...e })) : []);
  }
}
