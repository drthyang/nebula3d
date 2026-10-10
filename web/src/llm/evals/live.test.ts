// Real models through the eval scenarios, against a running backend that
// serves the eval datasets (the measured hexagonal volume, its pipeline run
// and its unsymmetrised export).  Skipped unless NEBULA_EVAL=1:
//
//   NEBULA_EVAL=1 NEBULA_EVAL_BASE_URL=http://localhost:11434/v1 NEBULA_EVAL_MODEL=gemma4:26b \
//     NEBULA_EVAL_OUT=../docs/evals/results/ollama-gemma4-26b.json npm run eval:agent
//
// NEBULA_EVAL_API       the backend (default http://127.0.0.1:8000)
// NEBULA_EVAL_ONLY      scenario ids to run, comma-separated (default all)
// NEBULA_EVAL_REPEAT    runs per scenario (default 1)
// NEBULA_EVAL_TIMEOUT   minutes per run before it is stopped (default 20)
// NEBULA_EVAL_PROVIDER  a label for the results (default: from the base URL)
// ANTHROPIC_API_KEY / OPENAI_API_KEY  read for an Anthropic / other cloud base URL; never written out

import { describe, expect, it } from "vitest";

import { fetchDatasets } from "../../api/client";
import { isAnthropicUrl } from "../provider/anthropic";
import { isLocalUrl, providerForUrl } from "../provider/presets";
import { backendUrl, env, useBackend, writeText } from "./backend";
import { runScenario, transcript, type ScenarioResult } from "./harness";
import { SCENARIOS } from "./scenarios";

const live = env("NEBULA_EVAL") === "1";

describe.skipIf(!live)("NEBULA Pilot evals, live", () => {
  it("runs the scenarios on a real model", async () => {
    const baseUrl = env("NEBULA_EVAL_BASE_URL") ?? "http://localhost:11434/v1";
    const model = env("NEBULA_EVAL_MODEL") ?? "";
    expect(model, "set NEBULA_EVAL_MODEL").not.toBe("");
    const apiKey = isLocalUrl(baseUrl) ? "" : ((isAnthropicUrl(baseUrl) ? env("ANTHROPIC_API_KEY") : env("OPENAI_API_KEY")) ?? "");
    const only = new Set((env("NEBULA_EVAL_ONLY") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    const repeat = Math.max(1, Number(env("NEBULA_EVAL_REPEAT") ?? 1));
    const minutes = Number(env("NEBULA_EVAL_TIMEOUT") ?? 20);
    const provider = env("NEBULA_EVAL_PROVIDER") ?? providerForUrl(baseUrl)?.label ?? (isLocalUrl(baseUrl) ? "local" : "cloud");

    useBackend();
    const datasets = await fetchDatasets();
    const scenarios = SCENARIOS.filter((s) => !only.size || only.has(s.id));
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      for (let i = 0; i < repeat; i++) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), minutes * 60_000);
        const r = await runScenario(scenario, {
          datasets,
          settings: { baseUrl, model, apiKey, temperature: 0.2 },
          signal: abort.signal,
        });
        clearTimeout(timer);
        results.push(r);
        const u = r.run.usage;
        console.log(
          `${r.passed ? "✓" : "✗"} ${scenario.id} (${(r.run.latencyMs / 1000).toFixed(0)} s` +
            `${u ? `, ${u.input} in / ${u.output} out over ${u.requests} requests` : ""})` +
            (r.passed ? "" : `\n${r.grades.filter((g) => !g.pass).map((g) => `    ✗ ${g.check}: ${g.detail}`).join("\n")}\n${transcript(r.run)}`),
        );
      }
    }

    const passed = results.filter((r) => r.passed).length;
    console.log(`NEBULA Pilot evals (${provider}, ${model}): ${passed}/${results.length} runs passed`);
    const out = env("NEBULA_EVAL_OUT");
    if (out) {
      const record = {
        provider,
        model,
        local: isLocalUrl(baseUrl),
        at: new Date().toISOString(),
        backend: backendUrl(),
        repeat,
        summary: scenarios.map((s) => {
          const runs = results.filter((r) => r.scenario === s.id);
          return { id: s.id, passed: runs.filter((r) => r.passed).length, runs: runs.length };
        }),
        runs: results.map((r) => ({
          scenario: r.scenario,
          passed: r.passed,
          grades: r.grades,
          latency_ms: Math.round(r.run.latencyMs),
          usage: r.run.usage,
          steps: r.run.steps.map((s) => ({ name: s.name, args: s.args, status: s.status, summary: s.summary })),
          answer: r.run.content,
          note: r.run.note ?? null,
          error: r.run.error ?? null,
        })),
      };
      await writeText(new URL(out, `file://${env("PWD") ?? ""}/`), JSON.stringify(record, null, 1) + "\n");
    }
    for (const r of results) expect.soft(r.passed, `${r.scenario}`).toBe(true);
  }, 6 * 3600_000);
});
