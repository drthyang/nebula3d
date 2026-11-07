// How long a live validation plan may run (validation.live.test.ts), so that a
// plan too big for its time fails at once, with a message, instead of running
// for hours. The user's rule (2026-11-02): an eval that runs past 30 minutes
// means something is wrong.
//
// - The wall-clock cap (NEBULA_VALIDATION_WALL, minutes, default 30) bounds the
//   whole plan. Before it starts, a plan whose expected time (its runs × the
//   model's measured seconds a run) passes the cap is refused. While it runs,
//   no run starts once the cap is reached, and each run's own limit is cut to
//   the time the cap leaves; the record keeps the runs that finished.
// - The per-run limit (NEBULA_VALIDATION_TIMEOUT, minutes, default 10) bounds
//   one run.
// - The quick preset (NEBULA_VALIDATION_PRESET=quick): gemma4:26b, arm B, one
//   run per dev case, 5 minutes a run, inside the 30-minute cap.
// - The quick-auto preset (NEBULA_VALIDATION_PRESET=quick-auto): the B-auto
//   arm, the quick preset's plan with each run through auto mode's controller
//   (validationAuto.ts), under the same cap and per-run limit.

import type { Arm } from "./validation";

export const DEFAULT_WALL_MINUTES = 30;
export const DEFAULT_RUN_MINUTES = 10;

/**
 * Seconds a validation run takes, as measured on this machine (docs/evals.md,
 * "How long a plan takes"): the plan's estimate. gemma4:26b, 2026-11-01, 168
 * runs on the dev split: median 61 to 91 s by arm and commit, mean 87 to 160 s
 * (the means carry a few stalled requests of 5 to 6 minutes on the shared Mac);
 * 90 s is taken. muse-glimmer, 4 runs: 213 to 318 s; 260 s is taken.
 * qwen3.8-27b, 4 runs on 2026-10-24: 43 to 52 minutes. A model with no
 * measurement gets null, and its plan is not estimated.
 */
export const SECONDS_PER_RUN: Readonly<Record<string, number>> = {
  "ollama-gemma4-26b": 90,
  "lmstudio-muse-glimmer": 260,
  "lmstudio-qwen3.8-27b": 2700,
};

export interface Preset {
  model: string;
  arms: Arm[];
  runs: number;
  runMinutes: number;
  wallMinutes: number;
  mode?: "auto"; // each run through auto mode (validationAuto.ts), on arm B's datasets
}

/** The presets NEBULA_VALIDATION_PRESET names. */
export const PRESETS: Readonly<Record<string, Preset>> = {
  // 8 dev cases × 1 run × 90 s ≈ 12 minutes, inside the 30-minute cap.
  quick: { model: "ollama-gemma4-26b", arms: ["B"], runs: 1, runMinutes: 5, wallMinutes: DEFAULT_WALL_MINUTES },
  // B-auto: the same plan and limits, each run through auto mode; measured on 2026-11-07 (docs/evals.md).
  "quick-auto": { model: "ollama-gemma4-26b", arms: ["B"], runs: 1, runMinutes: 5, wallMinutes: DEFAULT_WALL_MINUTES, mode: "auto" },
};

export function presetNamed(name: string | undefined): Preset | null {
  if (!name) return null;
  const p = PRESETS[name];
  if (!p) throw new Error(`no preset ${name}: the presets are ${Object.keys(PRESETS).join(", ")}`);
  return p;
}

/** A plan's expected minutes, or null where the model has no measured time. */
export function expectedMinutes(modelKey: string, jobs: number): number | null {
  const s = SECONDS_PER_RUN[modelKey];
  return s == null ? null : (jobs * s) / 60;
}

/** Why a plan may not start (its expected time passes the cap), or null. */
export function planRefusal(modelKey: string, jobs: number, wallMinutes: number): string | null {
  const m = expectedMinutes(modelKey, jobs);
  if (m == null || m <= wallMinutes) return null;
  return (
    `the plan of ${jobs} runs on ${modelKey} is expected to take about ${Math.round(m)} minutes ` +
    `(${SECONDS_PER_RUN[modelKey]} s a run, measured), past the wall-clock cap of ${wallMinutes} minutes ` +
    `(NEBULA_VALIDATION_WALL). Run fewer (NEBULA_VALIDATION_ONLY, _ARMS, _RUNS, or NEBULA_VALIDATION_PRESET=quick), ` +
    `or raise the cap on purpose.`
  );
}

/**
 * The limit for the next run, in minutes: the per-run limit, cut to what the
 * cap leaves; or a stop, with its message, once less than a minute is left.
 */
export function nextRun(
  { startedMs, nowMs, wallMinutes, runMinutes, done, total }: { startedMs: number; nowMs: number; wallMinutes: number; runMinutes: number; done: number; total: number },
): { minutes: number; stop: null } | { minutes: 0; stop: string } {
  const left = wallMinutes - (nowMs - startedMs) / 60_000;
  if (left < 1) {
    return {
      minutes: 0,
      stop:
        `stopped at the wall-clock cap of ${wallMinutes} minutes (NEBULA_VALIDATION_WALL) after ${done} of ${total} runs; ` +
        `the record keeps the ${done} that finished. A plan that runs this long means something is wrong, or the plan is too big: ` +
        `read the record's latency_ms per run before raising the cap.`,
    };
  }
  return { minutes: Math.min(runMinutes, Math.floor(left * 10) / 10), stop: null };
}
