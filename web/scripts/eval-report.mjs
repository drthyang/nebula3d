#!/usr/bin/env node
// The local tier before and after, as Markdown, from two sets of files (full
// records or their summaries, eval-records.mjs), matched by model:
//
//   node scripts/eval-report.mjs --before ../docs/evals/local/2026-10-10/*.json \
//     --after ../docs/evals/local/<date>/*.json
//
// Per model: runs passed, runs that ended in an exception, runs the model
// server failed after its retries (by kind), loop-guard endings and round-cap
// hits; over every run, and over the scenarios both sets ran. Then each
// scenario's passes before and after.

import { readFileSync } from "node:fs";

import { runsByModel, tally } from "./eval-records.mjs";

const args = process.argv.slice(2);
if (!args.includes("--before") || !args.includes("--after")) {
  console.error("usage: node scripts/eval-report.mjs --before <files>... --after <files>...");
  process.exit(1);
}
// The files after a flag, up to the next flag.
const filesAfter = (flag) => {
  const rest = args.slice(args.indexOf(flag) + 1);
  const end = rest.findIndex((x) => x.startsWith("--"));
  return end < 0 ? rest : rest.slice(0, end);
};
const read = (files) => runsByModel(files.map((f) => JSON.parse(readFileSync(f, "utf8"))));
const before = read(filesAfter("--before"));
const after = read(filesAfter("--after"));

const kinds = (failures) => {
  const e = Object.entries(failures);
  return e.length ? e.map(([k, n]) => `${k} ${n}`).join(", ") : "none";
};
const row = (label, t) =>
  `| ${label} | ${t.passed}/${t.runs} (${t.runs ? ((100 * t.passed) / t.runs).toFixed(0) : 0} %) | ${t.errors} | ${kinds(t.failures)} | ${t.loops} | ${t.turn_cap} |`;

const out = [];
for (const model of [...new Set([...before.keys(), ...after.keys()])]) {
  const was = before.get(model) ?? [];
  const now = after.get(model) ?? [];
  const shared = new Set(was.map((r) => r.scenario).filter((id) => now.some((r) => r.scenario === id)));
  out.push(`### ${model}`, "");
  out.push("| Runs | Passed | Exceptions | Server failures after retries | Loop-guard endings | Round-cap hits |");
  out.push("| --- | :---: | :---: | --- | :---: | :---: |");
  if (was.length) out.push(row("before, all", tally(was)));
  if (now.length) out.push(row("after, all", tally(now)));
  if (was.length && now.length && shared.size) {
    out.push(row("before, scenarios in both", tally(was.filter((r) => shared.has(r.scenario)))));
    out.push(row("after, scenarios in both", tally(now.filter((r) => shared.has(r.scenario)))));
  }
  out.push("");
  const ids = [...new Set([...was, ...now].map((r) => r.scenario))];
  out.push("| Scenario | Before | After |", "| --- | :---: | :---: |");
  for (const id of ids) {
    const cell = (runs) => {
      const r = runs.filter((x) => x.scenario === id);
      return r.length ? `${r.filter((x) => x.passed).length}/${r.length}` : "–";
    };
    out.push(`| \`${id}\` | ${cell(was)} | ${cell(now)} |`);
  }
  out.push("");
}
console.log(out.join("\n"));
