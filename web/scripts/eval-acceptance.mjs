#!/usr/bin/env node
// The local eval tier's acceptance, for each model across the files given (its
// scenarios and its held-out runs together; full records or their summaries,
// eval-records.mjs):
//
//   node scripts/eval-acceptance.mjs ../docs/evals/local/<date>/*.json
//
// A model passes when at least 80 % of its runs pass, no reply reached the
// round cap, the loop guard ended none, and none ended in an exception. Runs
// the model server failed after its retries (a crash, out of memory, …) are
// listed by kind: they count as failed runs, not as exceptions. Exits 1 when a
// model fails.

import { readFileSync } from "node:fs";

import { runsByModel, tally } from "./eval-records.mjs";

const PASS_RATE = 0.8;

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/eval-acceptance.mjs <results.json>...");
  process.exit(1);
}

let allPass = true;
for (const [model, runs] of runsByModel(files.map((f) => JSON.parse(readFileSync(f, "utf8"))))) {
  const t = tally(runs);
  const rate = t.runs ? t.passed / t.runs : 0;
  const criteria = [
    [`at least ${PASS_RATE * 100} % of runs pass`, rate >= PASS_RATE, `${t.passed}/${t.runs} (${(rate * 100).toFixed(0)} %)`],
    ["no reply reached the round cap", t.turn_cap === 0, String(t.turn_cap)],
    ["the loop guard ended no reply", t.loops === 0, String(t.loops)],
    ["no run ended in an exception", t.errors === 0, String(t.errors)],
  ];
  const ok = criteria.every(([, pass]) => pass);
  allPass &&= ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${model}`);
  for (const [what, pass, value] of criteria) console.log(`  ${pass ? "✓" : "✗"} ${what}: ${value}`);
  const kinds = Object.entries(t.failures);
  console.log(`  server failures after retries: ${kinds.length ? kinds.map(([k, n]) => `${k} ${n}`).join(", ") : "none"}`);
}
process.exit(allPass ? 0 : 1);
