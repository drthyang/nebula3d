// The models the validation runs (docs/evals.md, "Does the Pilot help?"), and
// the spend tracker that caps a paid one. Wired only: nothing here starts a
// run, and a paid model needs the user to type its cap (paidRunGate).
//
// Every model is described the same way: where it is served, the context the
// run needs it loaded with, the splits it may run, and the runs per case.

import { casesToRun, datasetStem, type Arm, type Split, type ValidationCase } from "./validation";

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
  contextTokens: number; // what the Pilot's tools need loaded (the first request alone is about 8k)
  splits: readonly Split[]; // the splits it may run
  runsPerCase: number;
  temperature: number | null; // null: the model takes no sampling parameters
  apiKeyEnv: string | null; // the environment variable holding its key, never written out
  price: Price | null; // null: local, no cost
  spendCapUsd: number | null; // null: no cap, because nothing is paid
  how: string; // what to do before it runs
}

const LM_STUDIO = "http://localhost:1234/v1";
const OLLAMA = "http://localhost:11434/v1";
const NEEDS_CONTEXT = "Tools need 32k tokens of context.";

export const SPEND_CAP_USD = 12;

export const MODELS: readonly ValidationModel[] = [
  {
    key: "lmstudio-qwen3.8-27b",
    label: "qwen/qwen3.8-27b (LM Studio, 32k)",
    provider: "LM Studio",
    baseUrl: LM_STUDIO,
    model: "qwen/qwen3.8-27b",
    local: true,
    contextTokens: 32768,
    splits: ["dev", "test"],
    runsPerCase: 3,
    temperature: 0.2,
    apiKeyEnv: null,
    price: null,
    spendCapUsd: null,
    how: `Load it in LM Studio with a 32768-token Context Length (the run checks it). ${NEEDS_CONTEXT}`,
  },
  {
    key: "ollama-gemma4-26b",
    label: "gemma4:26b (Ollama)",
    provider: "Ollama",
    baseUrl: OLLAMA,
    model: "gemma4:26b",
    local: true,
    contextTokens: 32768,
    splits: ["dev", "test"],
    runsPerCase: 3,
    temperature: 0.2,
    apiKeyEnv: null,
    price: null,
    spendCapUsd: null,
    how: `Start Ollama with OLLAMA_CONTEXT_LENGTH=32768 (the OpenAI-style endpoint cannot set it, and the run cannot read it). ${NEEDS_CONTEXT}`,
  },
  {
    key: "lmstudio-muse-glimmer",
    label: "meta/muse-glimmer (LM Studio)",
    provider: "LM Studio",
    baseUrl: LM_STUDIO,
    model: "meta/muse-glimmer",
    local: true,
    contextTokens: 32768,
    splits: ["dev", "test"],
    runsPerCase: 3,
    temperature: 0.2,
    apiKeyEnv: null,
    price: null,
    spendCapUsd: null,
    how: `Load it in LM Studio with a 32768-token Context Length (the run checks it). ${NEEDS_CONTEXT}`,
  },
  {
    key: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5 (Anthropic)",
    provider: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-5-5",
    local: false,
    contextTokens: 32768,
    splits: ["test"],
    runsPerCase: 3,
    temperature: null,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    // Anthropic's published prices, fetched 2026-10-10 (docs/evals.md).
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    spendCapUsd: SPEND_CAP_USD,
    how: "Paid. Set ANTHROPIC_API_KEY and NEBULA_VALIDATION_ALLOW_SPEND=12; the test split only, with NEBULA_VALIDATION_REPORT=1.",
  },
];

export const modelNamed = (key: string): ValidationModel => {
  const m = MODELS.find((x) => x.key === key);
  if (!m) throw new Error(`no validation model ${JSON.stringify(key)}; the models are ${MODELS.map((x) => x.key).join(", ")}`);
  return m;
};

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
    return `${model.label} is paid: set NEBULA_VALIDATION_ALLOW_SPEND=${model.spendCapUsd} to approve spending at most $${model.spendCapUsd} on it`;
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
 * Money spent on a paid model, against a cap. Before a run starts it must be
 * affordable at its worst: the first run is held to a ceiling set by the round
 * limit and the context, and later ones to 1.5 times the dearest so far. A run
 * whose tokens the server did not report is charged that reserve, so the total
 * is never short. The ledger is a plain list, kept between sessions.
 */
export class SpendTracker {
  /** The dearest a first run can be: 13 requests of 40k tokens uncached at $2 per million, plus output. */
  static readonly FIRST_RUN_RESERVE_USD = 1.2;

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
