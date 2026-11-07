// The model configuration, the run policy's context check and the spend
// tracker, without a model or a key: the model servers' answers are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_TOOL_ROUNDS } from "../agent";
import { TOOLS_CONTEXT } from "../provider/client";
import { RUN_POLICIES, runPolicyOf, transportOf } from "../runPolicy";
import { TUNE_STAGES } from "../tune/catalog";
import {
  costOf,
  covers,
  FIRST_RUN_WORST,
  firstRunWorstUsd,
  modelAt,
  MODELS,
  modelNamed,
  paidRunGate,
  plan,
  RUN_POLICY,
  runContext,
  CLAUDE_LEDGER,
  ledgerOf,
  SPEND_CAP_USD,
  spendStopRefusal,
  SPEND_TOTAL_USD,
  SpendTracker,
  TUNE_REQUESTS_PER_STAGE,
  tuningWorstUsd,
  VALIDATION_MAX_TOKENS,
  validationPolicy,
} from "./validationModels";
import { casesIn } from "./validation";
import { priceOf } from "../auto/cost";

// What LM Studio says a model is loaded with, and what Ollama says it supports;
// nothing else of the client is replaced.
const server = vi.hoisted(() => ({ loadedContext: vi.fn(), ollamaModel: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  loadedContext: server.loadedContext,
  ollamaModel: server.ollamaModel,
}));

describe("the models", () => {
  it("are the five the validation names, each with a context, splits and three runs per case", () => {
    expect(MODELS.map((m) => m.model)).toEqual(["qwen/qwen3.8-27b", "gemma4:26b", "meta/muse-glimmer", "claude-haiku-5-5", "claude-sonnet-5-5"]);
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
    // The user's $40 for THY-52's re-baseline, on one ledger the Claude models share.
    expect(SPEND_CAP_USD).toBe(40);
    expect(SPEND_TOTAL_USD).toBe(40);
    const claude = MODELS.filter((m) => !m.local);
    expect(claude.map((m) => m.key)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    for (const m of claude) {
      expect(m.spendCapUsd).toBe(SPEND_CAP_USD);
      expect(ledgerOf(m)).toBe(CLAUDE_LEDGER);
      expect(m.how).toContain("$40 in all, on one ledger the Claude models share");
    }
    for (const m of MODELS.filter((x) => x.local)) expect(ledgerOf(m)).toBe(m.key);
    expect(modelNamed("claude-haiku-5-5").splits).toEqual(["dev"]);
    expect(modelNamed("claude-sonnet-5-5").splits).toEqual(["dev", "test"]);
  });

  it("price Claude at the published list (the claude-api reference, as auto/cost.ts does)", () => {
    for (const key of ["claude-haiku-5-5", "claude-sonnet-5-5"]) {
      const m = modelNamed(key);
      expect(m.price, key).toEqual(priceOf({ baseUrl: m.baseUrl, model: m.model }));
    }
    expect(modelNamed("claude-sonnet-5-5").price).toEqual({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 });
    expect(modelNamed("claude-haiku-5-5").price).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 });
  });

  it("run the held-out split only to be reported, and a paid model nothing else", () => {
    const claude = modelNamed("claude-sonnet-5-5");
    expect(plan(claude, "dev")).toHaveLength(casesIn("dev").length * 2 * 3);
    expect(() => plan(claude, "test")).toThrow(/held out/);
    const haiku = modelNamed("claude-haiku-5-5");
    expect(plan(haiku, "dev")).toHaveLength(casesIn("dev").length * 2 * 3);
    expect(() => plan(haiku, "test", { report: true })).toThrow(/dev split only/);
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

  it("is 32k for every local model, none for the cloud, and the app suggests the same", () => {
    expect(RUN_POLICY.minLocalContextTokens).toBe(32_768);
    for (const m of MODELS) {
      expect(m.minContextTokens).toBe(m.local ? RUN_POLICY.minLocalContextTokens : null);
      if (m.local) {
        expect(m.contextTokens).toBeGreaterThanOrEqual(RUN_POLICY.minLocalContextTokens);
        expect(m.how).toMatch(/32768/);
      }
    }
    // The console's own guidance (contextWarning, the window's refusal) names the same window.
    expect(TOOLS_CONTEXT).toBe(RUN_POLICY.minLocalContextTokens);
  });

  it("refuses LM Studio loaded with 24k, before the run, and says how to load it with more", async () => {
    server.loadedContext.mockResolvedValue({ loaded: 24_576, max: 131_072 });
    const c = await runContext(qwen, qwen.baseUrl);
    expect(server.loadedContext).toHaveBeenCalledWith(qwen.baseUrl, "qwen/qwen3.8-27b", expect.anything());
    expect(c).toMatchObject({ tokens: 24_576, min_tokens: 32_768, read_from: "lmstudio-loaded" });
    expect(c.refusal).toMatch(/^qwen\/qwen3\.8-27b is loaded with a 24,576-token context, under the run policy's minimum of 32,768/);
    expect(c.refusal).toMatch(/Context Length of 32,768 or more/);
    expect(c.refusal).toMatch(/lms load qwen\/qwen3\.8-27b --context-length 32768/);
    expect(c.refusal).toMatch(/default Context Length/);
    expect(c.refusal).not.toMatch(/supports at most/);
    expect(server.ollamaModel).not.toHaveBeenCalled();
  });

  it("passes LM Studio loaded with 32k or more, and keeps the window", async () => {
    server.loadedContext.mockResolvedValue({ loaded: 32_768, max: 131_072 });
    expect(await runContext(qwen, qwen.baseUrl)).toEqual({ tokens: 32_768, min_tokens: 32_768, read_from: "lmstudio-loaded", refusal: null });
    // The minimum was 56k until THY-63 R5 brought the worst turn, with the reply reserve, under 32k: one token short is refused.
    server.loadedContext.mockResolvedValue({ loaded: 32_767, max: 131_072 });
    expect((await runContext(qwen, qwen.baseUrl)).refusal).toMatch(/^qwen\/qwen3\.8-27b is loaded with a 32,767-token context, under the run policy's minimum of 32,768/);
    server.loadedContext.mockResolvedValue({ loaded: 65_536, max: null });
    expect((await runContext(modelNamed("lmstudio-muse-glimmer"), qwen.baseUrl)).refusal).toBeNull();
  });

  it("refuses LM Studio when the window cannot be read: not loaded, or not listed", async () => {
    // Not loaded: LM Studio would load it with its defaults, which the run cannot read.
    server.loadedContext.mockResolvedValue({ loaded: null, max: 262_144 });
    const idle = await runContext(qwen, qwen.baseUrl);
    expect(idle).toMatchObject({ tokens: null, min_tokens: 32_768 });
    expect(idle.refusal).toMatch(/^qwen\/qwen3\.8-27b is not loaded: .*minimum of 32,768.*--context-length 32768/);
    server.loadedContext.mockResolvedValue(null);
    const unread = await runContext(qwen, qwen.baseUrl);
    expect(unread.tokens).toBeNull();
    expect(unread.refusal).toMatch(/^Could not read the context qwen\/qwen3\.8-27b is loaded with from LM Studio at http:\/\/localhost:1234\/v1/);
    expect(unread.refusal).toMatch(/minimum of 32,768/);
  });

  it("says when an LM Studio model cannot hold the minimum at all", async () => {
    server.loadedContext.mockResolvedValue({ loaded: 16_384, max: 24_576 });
    expect((await runContext(qwen, qwen.baseUrl)).refusal).toMatch(/It supports at most 24,576: pick a model that supports more\.$/);
  });

  it("holds Ollama to the longest context the model supports, which the window plan grows num_ctx to", async () => {
    server.ollamaModel.mockResolvedValue({ maxContext: 262_144 });
    const ok = await runContext(gemma, gemma.baseUrl);
    expect(server.ollamaModel).toHaveBeenCalledWith(gemma.baseUrl, "gemma4:26b", undefined);
    expect(ok).toEqual({ tokens: 262_144, min_tokens: 32_768, read_from: "ollama-supported", refusal: null });
    expect(server.loadedContext).not.toHaveBeenCalled();

    server.ollamaModel.mockResolvedValue({ maxContext: 32_768 });
    expect((await runContext(gemma, gemma.baseUrl)).refusal).toBeNull();
    server.ollamaModel.mockResolvedValue({ maxContext: 16_384 });
    const short = await runContext(gemma, gemma.baseUrl);
    expect(short).toMatchObject({ tokens: 16_384, min_tokens: 32_768 });
    expect(short.refusal).toMatch(/^gemma4:26b supports a context of at most 16,384 tokens .* under the run policy's minimum of 32,768/);
    expect(short.refusal).toMatch(/pick a model that supports 32,768 or more/);

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

// The scenario evals (live.test.ts, and scripts/eval-local.sh through it) name a
// model by NEBULA_EVAL_BASE_URL and NEBULA_EVAL_MODEL alone; modelAt makes it one
// runContext holds to the same minimum, with the same refusals.
describe("the scenario evals' context check", () => {
  const LM_STUDIO = "http://localhost:1234/v1";
  const OLLAMA = "http://localhost:11434/v1"; // live.test.ts's default base URL
  const qwen = modelNamed("lmstudio-qwen3.8-27b");

  beforeEach(() => {
    server.loadedContext.mockReset();
    server.ollamaModel.mockReset();
  });

  it("holds a model on a local server to the run policy's minimum, and a cloud one to none", () => {
    for (const url of [LM_STUDIO, OLLAMA, "http://127.0.0.1:1234/v1", "http://localhost:8080/v1"]) {
      expect(modelAt(url, "m")).toEqual({ model: "m", minContextTokens: RUN_POLICY.minLocalContextTokens });
    }
    for (const url of ["https://api.anthropic.com", "https://api.openai.com/v1"]) {
      expect(modelAt(url, "m").minContextTokens).toBeNull();
    }
  });

  it("refuses LM Studio loaded with 24k before the first run, as the validation's runner does", async () => {
    server.loadedContext.mockResolvedValue({ loaded: 24_576, max: 131_072 });
    const c = await runContext(modelAt(LM_STUDIO, "qwen/qwen3.8-27b"), LM_STUDIO);
    expect(server.loadedContext).toHaveBeenCalledWith(LM_STUDIO, "qwen/qwen3.8-27b", expect.anything());
    expect(c).toMatchObject({ tokens: 24_576, min_tokens: 32_768, read_from: "lmstudio-loaded" });
    expect(c.refusal).toMatch(/^qwen\/qwen3\.8-27b is loaded with a 24,576-token context, under the run policy's minimum of 32,768/);
    expect(c.refusal).toMatch(/lms load qwen\/qwen3\.8-27b --context-length 32768/);
    // Word for word the validation runner's refusal for the same model and window.
    expect(c.refusal).toBe((await runContext(qwen, LM_STUDIO)).refusal);
  });

  it("passes LM Studio loaded with 32k or more, with the window a run's record keeps", async () => {
    server.loadedContext.mockResolvedValue({ loaded: 32_768, max: 131_072 });
    expect(await runContext(modelAt(LM_STUDIO, "qwen/qwen3.8-27b"), LM_STUDIO)).toEqual({
      tokens: 32_768,
      min_tokens: 32_768,
      read_from: "lmstudio-loaded",
      refusal: null,
    });
  });

  it("refuses a local window it cannot read: a model LM Studio has not loaded, or a server that does not say", async () => {
    server.loadedContext.mockResolvedValue({ loaded: null, max: 262_144 });
    expect((await runContext(modelAt(LM_STUDIO, "qwen/qwen3.8-27b"), LM_STUDIO)).refusal).toMatch(/^qwen\/qwen3\.8-27b is not loaded: /);
    server.loadedContext.mockResolvedValue(null);
    const other = await runContext(modelAt("http://localhost:8080/v1", "some-model"), "http://localhost:8080/v1");
    expect(other).toMatchObject({ tokens: null, min_tokens: 32_768 });
    expect(other.refusal).toMatch(/^Could not read the context some-model is loaded with .*minimum of 32,768/);
  });

  it("holds Ollama to the longest context the model supports", async () => {
    server.ollamaModel.mockResolvedValue({ maxContext: 16_384 });
    const short = await runContext(modelAt(OLLAMA, "gemma4:26b"), OLLAMA);
    expect(server.ollamaModel).toHaveBeenCalledWith(OLLAMA, "gemma4:26b", undefined);
    expect(short).toMatchObject({ tokens: 16_384, min_tokens: 32_768, read_from: "ollama-supported" });
    expect(short.refusal).toMatch(/^gemma4:26b supports a context of at most 16,384 tokens .* under the run policy's minimum of 32,768/);
    server.ollamaModel.mockResolvedValue({ maxContext: 262_144 });
    expect(await runContext(modelAt(OLLAMA, "gemma4:26b"), OLLAMA)).toEqual({
      tokens: 262_144,
      min_tokens: 32_768,
      read_from: "ollama-supported",
      refusal: null,
    });
    expect(server.loadedContext).not.toHaveBeenCalled();
  });

  it("does not ask a cloud model", async () => {
    for (const url of ["https://api.anthropic.com", "https://api.openai.com/v1"]) {
      expect(await runContext(modelAt(url, "a-cloud-model"), url)).toEqual({ tokens: null, min_tokens: null, read_from: null, refusal: null });
    }
    expect(server.loadedContext).not.toHaveBeenCalled();
    expect(server.ollamaModel).not.toHaveBeenCalled();
  });
});

describe("what a paid model needs", () => {
  const claude = modelNamed("claude-sonnet-5-5");

  it("is the user typing its cap", () => {
    expect(paidRunGate(claude, undefined)).toBe(
      "Claude Sonnet 5.5 (Anthropic) is paid: set NEBULA_VALIDATION_ALLOW_SPEND=40 to approve spending at most $40 on it ($40 in all, on one ledger the Claude models share)",
    );
    expect(paidRunGate(claude, "5")).not.toBeNull();
    expect(paidRunGate(claude, "12")).not.toBeNull();
    expect(paidRunGate(claude, "40")).toBeNull();
    expect(paidRunGate(modelNamed("claude-haiku-5-5"), "40")).toBeNull();
    expect(paidRunGate(modelNamed("ollama-gemma4-26b"), undefined)).toBeNull();
  });
});

describe("cost", () => {
  const price = modelNamed("claude-sonnet-5-5").price!;

  it("counts cached input at its own price, as the eval table does", () => {
    // 1M input of which 900k cache reads and 50k cache writes, 100k output.
    const usd = costOf({ input: 1_000_000, output: 100_000, cacheRead: 900_000, cacheWrite: 50_000 }, price);
    expect(usd).toBeCloseTo((50_000 * 2 + 900_000 * 0.2 + 50_000 * 2.5 + 100_000 * 10) / 1e6, 10);
    expect(costOf({ input: 1000, output: 100 }, price)).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6, 10);
  });

  it("is unknown without the server's counts or a price", () => {
    expect(costOf(null, price)).toBeNull();
    expect(costOf({ input: 1, output: 1 }, null)).toBeNull();
  });
});

describe("the spend tracker", () => {
  const sonnet = modelNamed("claude-sonnet-5-5").price!;
  const run = (usd: number | null) => ({ case: "x", arm: "B", run: 1, usd });

  it("holds the first run to its hard bound, $7.37: the arithmetic of FIRST_RUN_RESERVE_USD's comment, every count the code's", () => {
    const { loop, tuning, margin } = FIRST_RUN_WORST;
    // The loop: its rounds of tool calls and the answer, each request at the validation's output cap.
    expect(loop.requests).toBe(MAX_TOOL_ROUNDS + 1);
    expect(loop.requests).toBe(13);
    expect(loop.outputPerRequest).toBe(VALIDATION_MAX_TOKENS);
    // The tuning: five stages of a stage's most requests, each at the cap its run policy asks for.
    expect(tuning.requests).toBe(TUNE_STAGES.length * TUNE_REQUESTS_PER_STAGE);
    expect(tuning.requests).toBe(15);
    const claude = modelNamed("claude-sonnet-5-5");
    expect(tuning.outputPerRequest).toBe(validationPolicy({ baseUrl: claude.baseUrl, temperature: claude.temperature }, MAX_TOOL_ROUNDS).outputCap.tuning);
    expect(VALIDATION_MAX_TOKENS).toBe(16_000);
    expect(margin).toBe(0.25);
    // Step by step, at Sonnet 5.5's price in MODELS.
    expect([sonnet.input, sonnet.output]).toEqual([2, 10]);
    expect((loop.requests * loop.inputPerRequest * sonnet.input) / 1e6).toBeCloseTo(1.04, 10);
    expect((loop.requests * loop.outputPerRequest * sonnet.output) / 1e6).toBeCloseTo(2.08, 10);
    expect((tuning.requests * tuning.inputPerRequest * sonnet.input) / 1e6).toBeCloseTo(0.375, 10);
    expect((tuning.requests * tuning.outputPerRequest * sonnet.output) / 1e6).toBeCloseTo(2.4, 10);
    expect(firstRunWorstUsd(sonnet)).toBeCloseTo(5.895 * 1.25, 10);
    expect(firstRunWorstUsd(sonnet)).toBeCloseTo(7.36875, 10);
    // Rounded up to the cent: $7.37, inside the $12 cap.
    expect(SpendTracker.FIRST_RUN_RESERVE_USD).toBe(7.37);
    expect(SpendTracker.FIRST_RUN_RESERVE_USD).toBeGreaterThanOrEqual(firstRunWorstUsd(sonnet));
    expect(SpendTracker.FIRST_RUN_RESERVE_USD - firstRunWorstUsd(sonnet)).toBeLessThan(0.01);
    const t = new SpendTracker(SPEND_CAP_USD);
    expect(t.reserve()).toBe(7.37);
    expect(t.canStart()).toBe(true);
  });

  it("prices a tuning past a run's first at its hard bound with the margin, $3.47", () => {
    // The tuning's $0.375 in and $2.400 out, $2.775, × 1.25.
    expect(tuningWorstUsd(sonnet)).toBeCloseTo(2.775 * 1.25, 10);
    expect(tuningWorstUsd(sonnet)).toBeCloseTo(3.46875, 10);
    expect(SpendTracker.EXTRA_TUNING_USD).toBe(3.47);
    expect(SpendTracker.EXTRA_TUNING_USD).toBeGreaterThanOrEqual(tuningWorstUsd(sonnet));
  });

  it("covers every paid model at its own price", () => {
    const paid = MODELS.filter((m) => m.spendCapUsd !== null);
    expect(paid.map((m) => m.key)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    for (const m of paid) {
      expect(firstRunWorstUsd(m.price!)).toBeLessThanOrEqual(SpendTracker.FIRST_RUN_RESERVE_USD);
      expect(tuningWorstUsd(m.price!)).toBeLessThanOrEqual(SpendTracker.EXTRA_TUNING_USD);
    }
  });

  // The tracker's arithmetic, at a $12 cap (NEBULA's cap until THY-52): the
  // class takes any cap, and the numbers below are worked at that one.
  const CAP_12 = 12;

  it("holds a later run to the first run's reserve after cheap runs, and to 1.5 times the dearest after a dear one", () => {
    const t = new SpendTracker(CAP_12);
    t.record(run(0.2));
    t.record(run(0.1));
    // Not 1.5 × $0.20: never below the first run's.
    expect(t.reserve()).toBe(SpendTracker.FIRST_RUN_RESERVE_USD);
    expect(t.spent).toBeCloseTo(0.3, 10);
    expect(t.remaining).toBeCloseTo(11.7, 10);
    // 1.5 × $4.91 = $7.365, under $7.37: still the first run's.
    t.record(run(4.91));
    expect(t.reserve()).toBe(SpendTracker.FIRST_RUN_RESERVE_USD);
    // A dear run: 1.5 × $5.00 = $7.50.
    const dear = new SpendTracker(CAP_12);
    dear.record(run(0.2));
    dear.record(run(5));
    dear.record(run(0.1));
    expect(dear.reserve()).toBeCloseTo(7.5, 10);
  });

  it("stops at the $12 cap whatever the reserve says: no run starts while what is spent and its reserve pass it", () => {
    const t = new SpendTracker(CAP_12);
    t.record(run(4.62));
    expect(t.canStart()).toBe(true); // $4.62 + $7.37 = $11.99
    expect(t.refusal()).toBeNull();
    t.record(run(0.02));
    expect(t.spent).toBeCloseTo(4.64, 10);
    expect(t.canStart()).toBe(false); // $4.64 + $7.37 = $12.01
    expect(t.refusal()).toBe("the spend cap is reached: $4.64 spent of $12.00, and the next run may cost up to $7.37");
    // A dear run's 1.5 times, past what is left.
    const dear = new SpendTracker(CAP_12);
    dear.record(run(6));
    expect(dear.reserve()).toBe(9);
    expect(dear.canStart()).toBe(false);
    expect(dear.refusal()).toBe("the spend cap is reached: $6.00 spent of $12.00, and the next run may cost up to $9.00");
    // The first run's reserve over a smaller cap: no run starts at all.
    expect(new SpendTracker(7).refusal()).toBe("the spend cap is reached: $0.00 spent of $7.00, and the next run may cost up to $7.37");
  });

  it("never runs a $12 cap past $12 over a whole session, whatever each run costs within its reserve", () => {
    for (const cost of [0.05, 0.3, 1, 2.5, 5.895, 7.37]) {
      const t = new SpendTracker(CAP_12);
      let runs = 0;
      while (t.canStart() && runs < 1000) {
        // Each run costs `cost`, or the most its reserve allows when that is less.
        t.record(run(Math.min(cost, t.reserve())));
        runs += 1;
      }
      expect(t.spent, `runs of $${cost}`).toBeLessThanOrEqual(CAP_12);
      expect(runs).toBeGreaterThan(0);
    }
    // Every run that starts after the first is held to $7.37: one starts only while
    // the spend is at most $12 − $7.37 = $4.63, so the dearest so far is at most that,
    // and 1.5 times it under $7.37.
    const cheap = new SpendTracker(CAP_12);
    let runs = 0;
    while (cheap.canStart()) {
      expect(cheap.reserve()).toBe(SpendTracker.FIRST_RUN_RESERVE_USD);
      cheap.record(run(0.3));
      runs += 1;
    }
    expect(runs).toBe(16); // $4.50 + $7.37 ≤ $12; $4.80 + $7.37 > $12
  });

  it("charges a run whose tokens were not reported at the reserve, so the total is never short", () => {
    const t = new SpendTracker(CAP_12);
    t.record(run(0.2));
    const e = t.record(run(null));
    expect(e.estimated).toBe(true);
    expect(e.usd).toBe(SpendTracker.FIRST_RUN_RESERVE_USD);
    expect(t.reserve()).toBe(SpendTracker.FIRST_RUN_RESERVE_USD); // an estimate does not raise the ceiling
    const dear = new SpendTracker(CAP_12);
    dear.record(run(5));
    expect(dear.record(run(null)).usd).toBeCloseTo(7.5, 10);
  });

  it("gives a run's tunings past its first what the cap leaves beyond the spend and the run's reserve", () => {
    // The first run: $12 − $7.37 = $4.63, which covers one more tuning.
    const first = new SpendTracker(CAP_12).tuningBudget();
    expect(first.leftUsd).toBeCloseTo(4.63, 10);
    expect(first.perTuningUsd).toBe(SpendTracker.EXTRA_TUNING_USD);
    expect(covers(first.leftUsd, first.perTuningUsd)).toBe(true);
    // After $2.00: $12 − $2 − $7.37 = $2.63, which does not.
    const later = new SpendTracker(CAP_12);
    later.record(run(2));
    expect(later.tuningBudget().leftUsd).toBeCloseTo(2.63, 10);
    expect(covers(later.tuningBudget().leftUsd, SpendTracker.EXTRA_TUNING_USD)).toBe(false);
    // Past the cap, nothing.
    const spent = new SpendTracker(CAP_12);
    spent.record(run(5));
    expect(spent.tuningBudget().leftUsd).toBe(0);
    // To the micro-dollar.
    expect(covers(3.47, 3.47)).toBe(true);
    expect(covers(3.469999, 3.47)).toBe(false);
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

describe("the validation's run policy", () => {
  it("caps every request at 16,000 tokens, the loop's and the tuning's, on every model, and takes the run's round limit", () => {
    expect(VALIDATION_MAX_TOKENS).toBe(16_000);
    for (const m of MODELS) {
      const policy = validationPolicy({ baseUrl: m.baseUrl, temperature: m.temperature }, 12);
      expect(policy.outputCap).toEqual({ loop: VALIDATION_MAX_TOKENS, tuning: VALIDATION_MAX_TOKENS });
      expect(policy.maxRounds).toBe(12);
    }
    expect(validationPolicy({ baseUrl: modelNamed("ollama-gemma4-26b").baseUrl, temperature: 0.2 }, 5).maxRounds).toBe(5);
  });

  it("is the transport's policy as the app ships it, the cap aside: arm B is the Pilot as it ships", () => {
    for (const m of MODELS) {
      const shipped = runPolicyOf({ baseUrl: m.baseUrl, temperature: m.temperature });
      const run = validationPolicy({ baseUrl: m.baseUrl, temperature: m.temperature }, MAX_TOOL_ROUNDS);
      expect({ ...run, outputCap: shipped.outputCap }).toEqual(shipped);
    }
    expect(runPolicyOf(modelNamed("claude-sonnet-5-5"))).toEqual(RUN_POLICIES.claude);
    expect(runPolicyOf(modelNamed("lmstudio-qwen3.8-27b"))).toEqual(RUN_POLICIES.lmStudio);
    expect(runPolicyOf(modelNamed("ollama-gemma4-26b"))).toEqual(RUN_POLICIES.ollama);
  });

  it("sends each model's temperature where its transport takes one, and none to Claude, which takes no sampling parameters", () => {
    for (const m of MODELS) {
      // What the model's entry says is what is sent and recorded: null exactly where the transport drops it.
      expect(validationPolicy({ baseUrl: m.baseUrl, temperature: m.temperature }, 12).temperature).toBe(m.temperature);
      expect(m.temperature === null).toBe(transportOf(m.baseUrl) === "anthropic");
    }
  });
});

describe("a plan's spend stop below the cap", () => {
  it("starts no run once the ledger has spent the stop, and is no stop without one", () => {
    const t = new SpendTracker(SPEND_CAP_USD);
    expect(spendStopRefusal(t, null)).toBeNull();
    expect(spendStopRefusal(t, 25)).toBeNull();
    t.record({ case: "dev-ub", arm: "B", run: 1, usd: 24.99 });
    expect(spendStopRefusal(t, 25)).toBeNull();
    t.record({ case: "dev-ub", arm: "B", run: 2, usd: 0.01 });
    expect(spendStopRefusal(t, 25)).toBe("the plan's spend stop is reached: $25.00 spent, and it stops at $25.00 (NEBULA_VALIDATION_SPEND_STOP)");
    // The cap's own rule still holds beneath the stop: $32.63 spent leaves no room for the $7.37 reserve under $40.
    const near = new SpendTracker(SPEND_CAP_USD, [{ case: "dev-ub", arm: "B", run: 1, usd: 32.64, estimated: false }]);
    expect(near.refusal()).toMatch(/spend cap is reached/);
  });
});
