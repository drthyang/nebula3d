#!/usr/bin/env node
// The NEBULA Pilot eval results as Markdown tables, from the JSON files
// live.test.ts writes (NEBULA_EVAL_OUT):
//
//   node scripts/eval-table.mjs ../docs/evals/results/*.json
//
// Prints a pass table (scenario × model; a run that ended in an error, such as a
// server crash or a timeout, is counted apart) and a per-model summary: pass rate,
// median latency per run, mean tokens per run and, for models with a price
// in PRICES, the mean cost per run.  Nothing is estimated: a model whose
// server did not report token counts shows "–".

import { readFileSync } from "node:fs";

// US$ per million tokens: input, output, cache hit, 5-minute cache write.
// Source: https://platform.claude.com/docs/en/about-claude/pricing, fetched
// 2026-10-10 (Haiku 5.5 at its rate for prompts up to 100,000 tokens, which
// every eval request is under).
const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/eval-table.mjs <results.json>...");
  process.exit(1);
}
const records = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
const label = (r) => `${r.model} (${r.provider})`;
const ids = [...new Set(records.flatMap((r) => r.summary.map((s) => s.id)))];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const cost = (model, u) => {
  const p = PRICES[model];
  if (!p || !u) return null;
  const cacheRead = u.cacheRead ?? 0;
  const cacheWrite = u.cacheWrite ?? 0;
  const plain = u.input - cacheRead - cacheWrite;
  return (plain * p.input + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite + u.output * p.output) / 1e6;
};

const out = [];
out.push(`| Scenario | ${records.map(label).join(" | ")} |`);
out.push(`| --- | ${records.map(() => ":---:").join(" | ")} |`);
for (const id of ids) {
  const cells = records.map((r) => {
    const runs = r.runs.filter((x) => x.scenario === id);
    if (!runs.length) return "–";
    const passed = runs.filter((x) => x.passed).length;
    const errors = runs.filter((x) => !x.passed && x.error).length;
    const mark = passed === runs.length ? "✓" : passed ? "◐" : "✗";
    return `${mark} ${passed}/${runs.length}${errors ? ` (${errors} error${errors > 1 ? "s" : ""})` : ""}`;
  });
  out.push(`| \`${id}\` | ${cells.join(" | ")} |`);
}
out.push("");
out.push("| Model | Passed | Failed on the checks | Errors (crash, out of memory, timeout) | Median time per run | Mean tokens per run (in / out) | Mean cost per run |");
out.push("| --- | :---: | :---: | :---: | ---: | ---: | ---: |");
for (const r of records) {
  const passed = r.runs.filter((x) => x.passed).length;
  const latency = median(r.runs.map((x) => x.latency_ms)) / 1000;
  const used = r.runs.filter((x) => x.usage);
  const tokens = used.length === r.runs.length && used.length
    ? `${Math.round(used.reduce((a, x) => a + x.usage.input, 0) / used.length).toLocaleString("en")} / ${Math.round(used.reduce((a, x) => a + x.usage.output, 0) / used.length).toLocaleString("en")}`
    : "–";
  const costs = r.runs.map((x) => cost(r.model, x.usage));
  const meanCost = costs.every((c) => c != null) && costs.length ? `$${(costs.reduce((a, c) => a + c, 0) / costs.length).toFixed(4)}` : r.local ? "local" : "–";
  const errors = r.runs.filter((x) => !x.passed && x.error).length;
  const failed = r.runs.length - passed - errors;
  out.push(`| ${label(r)} | ${passed}/${r.runs.length} | ${failed} | ${errors} | ${latency.toFixed(0)} s | ${tokens} | ${meanCost} |`);
}
console.log(out.join("\n"));
