// Real models through the eval scenarios, against a running backend that
// serves the eval datasets (the measured hexagonal volume, its pipeline run
// and its unsymmetrised export).  Skipped unless NEBULA_EVAL=1:
//
//   NEBULA_EVAL=1 NEBULA_EVAL_BASE_URL=http://localhost:11434/v1 NEBULA_EVAL_MODEL=gemma4:26b \
//     NEBULA_EVAL_OUT=../docs/evals/results/ollama-gemma4-26b.json npm run eval:agent
//
// NEBULA_EVAL_API       the backend (default http://127.0.0.1:8000)
// NEBULA_EVAL_SET       heldout: the held-out scenarios instead (heldout.ts), on a backend
//                       serving the volumes examples/make_eval_volumes.py writes, run
//                       with the defaults
// NEBULA_EVAL_ONLY      scenario ids to run, comma-separated (default all)
// NEBULA_EVAL_REPEAT    runs per scenario (default 1)
// NEBULA_EVAL_TIMEOUT   minutes per run before it is stopped (default 20)
// NEBULA_EVAL_PROVIDER  a label for the results (default: from the base URL)
// ANTHROPIC_API_KEY / OPENAI_API_KEY  read for an Anthropic / other cloud base URL; never written out

import { describe, expect, it } from "vitest";

import { fetchDatasets } from "../../api/client";
import type { AgentStep } from "../agent";
import { isAnthropicUrl } from "../provider/anthropic";
import { isLocalUrl, providerForUrl } from "../provider/presets";
import { backendUrl, env, readText, useBackend, writeText } from "./backend";
import { grade, runScenario, transcript, type EvalRun, type ScenarioResult } from "./harness";
import { HELDOUT_SCENARIOS } from "./heldout";
import { SCENARIOS } from "./scenarios";
import { sampleScrubber } from "./scrub";

const live = env("NEBULA_EVAL") === "1";
const SET = env("NEBULA_EVAL_SET") === "heldout" ? HELDOUT_SCENARIOS : SCENARIOS;

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
    // The record is committed: it names no sample (scrub.ts).
    const scrub = sampleScrubber(datasets);
    const scenarios = SET.filter((s) => !only.size || only.has(s.id));
    const results: ScenarioResult[] = [];
    const out = env("NEBULA_EVAL_OUT");
    // The record is rewritten after every run, so progress shows and a run cut
    // short keeps what it measured.
    const save = async (done: boolean) => {
      if (!out) return;
      const record = {
        provider,
        model,
        local: isLocalUrl(baseUrl),
        at: new Date().toISOString(),
        complete: done,
        backend: backendUrl(),
        repeat,
        timeout_minutes: minutes,
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
          steps: r.run.steps.map((s) => ({ name: s.name, args: s.args, status: s.status, summary: s.summary, result: s.result })),
          answer: r.run.content,
          note: r.run.note ?? null,
          error: r.run.error ?? null,
        })),
      };
      await writeText(new URL(out, `file://${env("PWD") ?? ""}/`), scrub(JSON.stringify(record, null, 1)) + "\n");
    };
    for (const scenario of scenarios) {
      for (let i = 0; i < repeat; i++) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), minutes * 60_000);
        const started = performance.now();
        // The abort stops the model's stream; a tool waiting on the backend may
        // not hear it, so the run is also given up a minute later, as failed.
        let giveUp: ReturnType<typeof setTimeout> | undefined;
        const stalled = new Promise<ScenarioResult>((resolve) => {
          giveUp = setTimeout(() => {
            const run: EvalRun = { scenario: scenario.id, steps: [], content: "", error: `timed out after ${minutes} min`, latencyMs: performance.now() - started, usage: null };
            resolve(grade(scenario, run));
          }, (minutes + 1) * 60_000);
        });
        const r = await Promise.race([
          runScenario(scenario, { datasets, settings: { baseUrl, model, apiKey, temperature: 0.2 }, signal: abort.signal }),
          stalled,
        ]);
        clearTimeout(timer);
        clearTimeout(giveUp);
        if (abort.signal.aborted && !r.run.error) r.run.error = `timed out after ${minutes} min`;
        results.push(r);
        await save(false);
        const u = r.run.usage;
        console.log(
          `${r.passed ? "✓" : "✗"} ${scenario.id} (${(r.run.latencyMs / 1000).toFixed(0)} s` +
            `${u ? `, ${u.input} in / ${u.output} out over ${u.requests} requests` : ""})` +
            (r.passed ? "" : `\n${r.grades.filter((g) => !g.pass).map((g) => `    ✗ ${g.check}: ${g.detail}`).join("\n")}\n${transcript(r.run)}`),
        );
      }
    }
    await save(true);
    const passed = results.filter((r) => r.passed).length;
    console.log(`NEBULA Pilot evals (${provider}, ${model}): ${passed}/${results.length} runs passed`);
    for (const r of results) expect.soft(r.passed, `${r.scenario}`).toBe(true);
  }, 6 * 3600_000);
});

// Grades recorded runs again with the current checks (NEBULA_EVAL_REGRADE=<results.json>,
// relative to the working directory), rewriting their grades and summary in place.
const regrade = env("NEBULA_EVAL_REGRADE");

describe.skipIf(!regrade)("NEBULA Pilot evals, re-graded", () => {
  it("grades the recorded runs with the current checks", async () => {
    const url = new URL(regrade!, `file://${env("PWD") ?? ""}/`);
    const record = JSON.parse(await readText(url)) as RecordFile;
    for (const r of record.runs) {
      const scenario = [...SCENARIOS, ...HELDOUT_SCENARIOS].find((s) => s.id === r.scenario);
      if (!scenario) continue;
      const run: EvalRun = {
        scenario: r.scenario,
        steps: r.steps.map((s, i) => ({ id: String(i), ...s })),
        content: r.answer,
        note: r.note ?? undefined,
        error: r.error ?? undefined,
        latencyMs: r.latency_ms,
        usage: r.usage,
      };
      const g = grade(scenario, run);
      r.passed = g.passed;
      r.grades = g.grades;
    }
    record.summary = record.summary.map((s) => {
      const runs = record.runs.filter((r) => r.scenario === s.id);
      return { ...s, passed: runs.filter((r) => r.passed).length, runs: runs.length };
    });
    await writeText(url, JSON.stringify(record, null, 1) + "\n");
    console.log(record.summary.map((s) => `${s.passed}/${s.runs} ${s.id}`).join("\n"));
  });
});

interface RecordFile {
  summary: { id: string; passed: number; runs: number }[];
  runs: {
    scenario: string;
    passed: boolean;
    grades: unknown;
    latency_ms: number;
    usage: EvalRun["usage"];
    steps: Omit<AgentStep, "id">[];
    answer: string;
    note: string | null;
    error: string | null;
  }[];
}
