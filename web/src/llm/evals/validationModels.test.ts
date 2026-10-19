// The model configuration, the run policy's context check and the spend
// tracker, without a model or a key: the model servers' answers are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { costOf, MODELS, modelNamed, paidRunGate, plan, RUN_POLICY, runContext, SPEND_CAP_USD, SpendTracker } from "./validationModels";
import { casesIn } from "./validation";

// What LM Studio says a model is loaded with, and what Ollama says it supports;
// nothing else of the client is replaced.
const server = vi.hoisted(() => ({ loadedContext: vi.fn(), ollamaModel: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  loadedContext: server.loadedContext,
  ollamaModel: server.ollamaModel,
}));

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

describe("the run policy's minimum context", () => {
  const qwen = modelNamed("lmstudio-qwen3.8-27b");
  const gemma = modelNamed("ollama-gemma4-26b");
  const claude = modelNamed("claude-sonnet-5-5");

  beforeEach(() => {
    server.loadedContext.mockReset();
    server.ollamaModel.mockReset();
  });

  it("is 48k for every local model, none for the cloud", () => {
    expect(RUN_POLICY.minLocalContextTokens).toBe(49_152);
    for (const m of MODELS) {
      expect(m.minContextTokens).toBe(m.local ? RUN_POLICY.minLocalContextTokens : null);
      if (m.local) {
        expect(m.contextTokens).toBeGreaterThanOrEqual(RUN_POLICY.minLocalContextTokens);
        expect(m.how).toMatch(/49152/);
      }
    }
  });

  it("refuses LM Studio loaded with 32k, before the run, and says how to load it with more", async () => {
    server.loadedContext.mockResolvedValue({ loaded: 32_768, max: 131_072 });
    const c = await runContext(qwen, qwen.baseUrl);
    expect(server.loadedContext).toHaveBeenCalledWith(qwen.baseUrl, "qwen/qwen3.8-27b", expect.anything());
    expect(c).toMatchObject({ tokens: 32_768, min_tokens: 49_152, read_from: "lmstudio-loaded" });
    expect(c.refusal).toMatch(/^qwen\/qwen3\.8-27b is loaded with a 32,768-token context, under the run policy's minimum of 49,152/);
    expect(c.refusal).toMatch(/Context Length of 49,152 or more/);
    expect(c.refusal).toMatch(/lms load qwen\/qwen3\.8-27b --context-length 49152/);
    expect(c.refusal).toMatch(/default Context Length/);
    expect(c.refusal).not.toMatch(/supports at most/);
    expect(server.ollamaModel).not.toHaveBeenCalled();
  });

  it("passes LM Studio loaded with 48k or more, and keeps the window", async () => {
    server.loadedContext.mockResolvedValue({ loaded: 49_152, max: 131_072 });
    expect(await runContext(qwen, qwen.baseUrl)).toEqual({ tokens: 49_152, min_tokens: 49_152, read_from: "lmstudio-loaded", refusal: null });
    server.loadedContext.mockResolvedValue({ loaded: 65_536, max: null });
    expect((await runContext(modelNamed("lmstudio-muse-glimmer"), qwen.baseUrl)).refusal).toBeNull();
  });

  it("refuses LM Studio when the window cannot be read: not loaded, or not listed", async () => {
    // Not loaded: LM Studio would load it with its defaults, which the run cannot read.
    server.loadedContext.mockResolvedValue({ loaded: null, max: 262_144 });
    const idle = await runContext(qwen, qwen.baseUrl);
    expect(idle).toMatchObject({ tokens: null, min_tokens: 49_152 });
    expect(idle.refusal).toMatch(/^qwen\/qwen3\.8-27b is not loaded: .*minimum of 49,152.*--context-length 49152/);
    server.loadedContext.mockResolvedValue(null);
    const unread = await runContext(qwen, qwen.baseUrl);
    expect(unread.tokens).toBeNull();
    expect(unread.refusal).toMatch(/^Could not read the context qwen\/qwen3\.8-27b is loaded with from LM Studio at http:\/\/localhost:1234\/v1/);
    expect(unread.refusal).toMatch(/minimum of 49,152/);
  });

  it("says when an LM Studio model cannot hold the minimum at all", async () => {
    server.loadedContext.mockResolvedValue({ loaded: 32_768, max: 40_960 });
    expect((await runContext(qwen, qwen.baseUrl)).refusal).toMatch(/It supports at most 40,960: pick a model that supports more\.$/);
  });

  it("holds Ollama to the longest context the model supports, which the window plan grows num_ctx to", async () => {
    server.ollamaModel.mockResolvedValue({ maxContext: 262_144 });
    const ok = await runContext(gemma, gemma.baseUrl);
    expect(server.ollamaModel).toHaveBeenCalledWith(gemma.baseUrl, "gemma4:26b", undefined);
    expect(ok).toEqual({ tokens: 262_144, min_tokens: 49_152, read_from: "ollama-supported", refusal: null });
    expect(server.loadedContext).not.toHaveBeenCalled();

    server.ollamaModel.mockResolvedValue({ maxContext: 32_768 });
    const short = await runContext(gemma, gemma.baseUrl);
    expect(short).toMatchObject({ tokens: 32_768, min_tokens: 49_152 });
    expect(short.refusal).toMatch(/^gemma4:26b supports a context of at most 32,768 tokens .* under the run policy's minimum of 49,152/);
    expect(short.refusal).toMatch(/pick a model that supports 49,152 or more/);

    server.ollamaModel.mockResolvedValue({ maxContext: null });
    expect((await runContext(gemma, gemma.baseUrl)).refusal).toMatch(/did not say how long a context gemma4:26b supports.*ollama pull gemma4:26b/);
  });

  it("goes by the server a run is pointed at, not the model's usual one", async () => {
    // NEBULA_VALIDATION_BASE_URL: an LM Studio model served by Ollama's port is read from Ollama.
    server.ollamaModel.mockResolvedValue({ maxContext: 131_072 });
    expect(await runContext(qwen, "http://localhost:11434/v1")).toMatchObject({ read_from: "ollama-supported", refusal: null });
    expect(server.loadedContext).not.toHaveBeenCalled();
  });

  it("does not ask a cloud model", async () => {
    expect(await runContext(claude, claude.baseUrl)).toEqual({ tokens: null, min_tokens: null, read_from: null, refusal: null });
    expect(server.loadedContext).not.toHaveBeenCalled();
    expect(server.ollamaModel).not.toHaveBeenCalled();
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
