// The model configuration and the spend tracker, without a model or a key.

import { describe, expect, it } from "vitest";

import { costOf, MODELS, modelNamed, paidRunGate, plan, SPEND_CAP_USD, SpendTracker } from "./validationModels";
import { casesIn } from "./validation";

describe("the models", () => {
  it("are the four the validation names, each with a context, splits and three runs per case", () => {
    expect(MODELS.map((m) => m.model)).toEqual(["qwen/qwen3.8-27b", "gemma4:26b", "meta/muse-glimmer", "claude-sonnet-5-5"]);
    for (const m of MODELS) {
      expect(m.runsPerCase).toBe(3);
      expect(m.contextTokens).toBeGreaterThanOrEqual(32768);
      expect(m.how).toBeTruthy();
    }
    expect(modelNamed("lmstudio-qwen3.8-27b").provider).toBe("LM Studio");
    expect(modelNamed("lmstudio-muse-glimmer").provider).toBe("LM Studio");
    expect(modelNamed("ollama-gemma4-26b").baseUrl).toContain("11434");
    expect(() => modelNamed("nope")).toThrow(/no validation model/);
  });

  it("pay only where there is a price, and cap only what is paid", () => {
    for (const m of MODELS) {
      expect(m.price === null).toBe(m.local);
      expect(m.spendCapUsd === null).toBe(m.local);
      expect(m.apiKeyEnv === null).toBe(m.local);
    }
    const claude = modelNamed("claude-sonnet-5-5");
    expect(claude.spendCapUsd).toBe(12);
    expect(SPEND_CAP_USD).toBe(12);
    expect(claude.splits).toEqual(["test"]);
  });

  it("run the held-out split only to be reported, and a paid model nothing else", () => {
    const claude = modelNamed("claude-sonnet-5-5");
    expect(() => plan(claude, "dev", { report: true })).toThrow(/test split only/);
    expect(() => plan(claude, "test")).toThrow(/held out/);
    const local = modelNamed("ollama-gemma4-26b");
    expect(() => plan(local, "test")).toThrow(/held out/);
    expect(plan(local, "dev")).toHaveLength(casesIn("dev").length * 2 * 3);
  });

  it("plan run-major, so a cap that stops a run early leaves whole repeats", () => {
    const jobs = plan(modelNamed("claude-sonnet-5-5"), "test", { report: true });
    expect(jobs).toHaveLength(casesIn("test").length * 2 * 3);
    const perRepeat = casesIn("test").length * 2;
    expect(jobs.slice(0, perRepeat).every((j) => j.run === 1)).toBe(true);
    expect(jobs.slice(perRepeat, 2 * perRepeat).every((j) => j.run === 2)).toBe(true);
    expect(new Set(jobs.map((j) => j.stem)).size).toBe(jobs.length);
    expect(jobs.every((j) => j.case.split === "test")).toBe(true);
  });

  it("take a narrower plan: some cases, one arm, fewer runs", () => {
    const jobs = plan(modelNamed("lmstudio-qwen3.8-27b"), "dev", { arms: ["C"], only: ["dev-ub"], runs: 1 });
    expect(jobs.map((j) => [j.case.id, j.arm, j.run])).toEqual([["dev-ub", "C", 1]]);
  });
});

describe("what a paid model needs", () => {
  const claude = modelNamed("claude-sonnet-5-5");

  it("is the user typing its cap", () => {
    expect(paidRunGate(claude, undefined)).toMatch(/NEBULA_VALIDATION_ALLOW_SPEND=12/);
    expect(paidRunGate(claude, "5")).not.toBeNull();
    expect(paidRunGate(claude, "1")).not.toBeNull();
    expect(paidRunGate(claude, "12")).toBeNull();
    expect(paidRunGate(modelNamed("ollama-gemma4-26b"), undefined)).toBeNull();
  });
});

describe("cost", () => {
  const price = modelNamed("claude-sonnet-5-5").price!;

  it("counts cached input at its own price, as the eval table does", () => {
    // 1M input of which 900k cache reads and 50k cache writes, 100k output.
    const usd = costOf({ input: 1_000_000, output: 100_000, cacheRead: 900_000, cacheWrite: 50_000 }, price);
    expect(usd).toBeCloseTo((50_000 * 2 + 900_000 * 0.1 + 50_000 * 2.5 + 100_000 * 10) / 1e6, 10);
    expect(costOf({ input: 1000, output: 100 }, price)).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6, 10);
  });

  it("is unknown without the server's counts or a price", () => {
    expect(costOf(null, price)).toBeNull();
    expect(costOf({ input: 1, output: 1 }, null)).toBeNull();
  });
});

describe("the spend tracker", () => {
  it("holds the first run to a ceiling and later ones to 1.5 times the dearest", () => {
    const t = new SpendTracker(12);
    expect(t.reserve()).toBe(SpendTracker.FIRST_RUN_RESERVE_USD);
    expect(t.canStart()).toBe(true);
    t.record({ case: "a", arm: "B", run: 1, usd: 0.2 });
    t.record({ case: "b", arm: "B", run: 1, usd: 0.1 });
    expect(t.reserve()).toBeCloseTo(0.3, 10);
    expect(t.spent).toBeCloseTo(0.3, 10);
    expect(t.remaining).toBeCloseTo(11.7, 10);
  });

  it("stops before a run that could pass the cap, and says why", () => {
    const t = new SpendTracker(1);
    t.record({ case: "a", arm: "B", run: 1, usd: 0.4 });
    expect(t.canStart()).toBe(true); // 0.4 spent + 0.6 reserve = 1.0
    t.record({ case: "b", arm: "B", run: 1, usd: 0.1 });
    t.record({ case: "c", arm: "B", run: 1, usd: 0.3 });
    expect(t.spent).toBeCloseTo(0.8, 10);
    expect(t.canStart()).toBe(false); // 0.8 + 0.6 > 1
    expect(t.refusal()).toMatch(/spend cap is reached: \$0\.80 spent of \$1\.00/);
    expect(new SpendTracker(1).refusal()).toMatch(/cap is reached/); // 1.2 first-run ceiling over a $1 cap
  });

  it("never runs a $12 cap past $12 over a whole session of dear runs", () => {
    const t = new SpendTracker(SPEND_CAP_USD);
    let runs = 0;
    while (t.canStart() && runs < 1000) {
      t.record({ case: "x", arm: "B", run: 1, usd: 0.5 }); // every run costs the most it may
      runs += 1;
    }
    expect(t.spent).toBeLessThanOrEqual(SPEND_CAP_USD);
    expect(runs).toBeGreaterThan(10);
  });

  it("charges a run whose tokens were not reported at the reserve, so the total is never short", () => {
    const t = new SpendTracker(12);
    t.record({ case: "a", arm: "B", run: 1, usd: 0.2 });
    const e = t.record({ case: "b", arm: "B", run: 1, usd: null });
    expect(e.estimated).toBe(true);
    expect(e.usd).toBeCloseTo(0.3, 10);
    expect(t.reserve()).toBeCloseTo(0.3, 10); // an estimate does not raise the ceiling
  });

  it("keeps its ledger between sessions", () => {
    const t = new SpendTracker(12);
    t.record({ case: "a", arm: "C", run: 2, usd: 0.25 });
    const back = SpendTracker.fromJSON(JSON.parse(JSON.stringify(t)), 12);
    expect(back.spent).toBeCloseTo(0.25, 10);
    expect(back.entries).toEqual(t.entries);
    expect(SpendTracker.fromJSON(null, 12).spent).toBe(0);
    expect(() => new SpendTracker(0)).toThrow();
  });
});
