import { describe, expect, it } from "vitest";

import { DEFAULT_WALL_MINUTES, expectedMinutes, nextRun, planRefusal, PRESETS, presetNamed, SECONDS_PER_RUN } from "./validationLimits";
import { casesToRun } from "./validation";
import { MODELS, plan } from "./validationModels";

describe("the validation's time limits", () => {
  it("the quick preset fits the 30-minute cap on the dev split", () => {
    const p = PRESETS.quick;
    const model = MODELS.find((m) => m.key === p.model)!;
    const jobs = plan(model, "dev", { arms: p.arms, runs: p.runs });
    expect(jobs.length).toBe(casesToRun("dev").length);
    expect(expectedMinutes(p.model, jobs.length)!).toBeLessThan(DEFAULT_WALL_MINUTES);
    expect(planRefusal(p.model, jobs.length, p.wallMinutes)).toBeNull();
    // Even if every run took its whole limit, the cap stops it (nextRun).
    expect(p.runMinutes).toBeLessThan(p.wallMinutes);
  });

  it("refuses a plan expected to pass the cap, before it starts, saying how to shrink it", () => {
    const model = MODELS.find((m) => m.key === "ollama-gemma4-26b")!;
    const full = plan(model, "dev", { arms: ["B", "C"], runs: 3 });
    const why = planRefusal(model.key, full.length, DEFAULT_WALL_MINUTES);
    expect(why).toMatch(/expected to take about 72 minutes/);
    expect(why).toMatch(/NEBULA_VALIDATION_PRESET=quick/);
  });

  it("does not estimate a model with no measured time", () => {
    expect(SECONDS_PER_RUN["claude-sonnet-5-5"]).toBeUndefined();
    expect(planRefusal("claude-sonnet-5-5", 48, 30)).toBeNull();
  });

  it("cuts a run's limit to what the cap leaves, and stops once less than a minute is left", () => {
    const t0 = 0;
    expect(nextRun({ startedMs: t0, nowMs: 0, wallMinutes: 30, runMinutes: 10, done: 0, total: 8 })).toEqual({ minutes: 10, stop: null });
    expect(nextRun({ startedMs: t0, nowMs: 25.5 * 60_000, wallMinutes: 30, runMinutes: 10, done: 6, total: 8 })).toEqual({ minutes: 4.5, stop: null });
    const stop = nextRun({ startedMs: t0, nowMs: 29.5 * 60_000, wallMinutes: 30, runMinutes: 10, done: 7, total: 8 });
    expect(stop.minutes).toBe(0);
    expect(stop.stop).toMatch(/wall-clock cap of 30 minutes .* after 7 of 8 runs; the record keeps the 7/);
  });

  it("names the presets when one is mistyped", () => {
    expect(presetNamed(undefined)).toBeNull();
    expect(() => presetNamed("quik")).toThrow(/the presets are quick/);
  });
});
