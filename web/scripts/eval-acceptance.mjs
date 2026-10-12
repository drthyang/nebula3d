#!/usr/bin/env node
// The local eval tier's acceptance, from the JSON records live.test.ts writes
// (NEBULA_EVAL_OUT), for each model across the records given (its scenarios
// and its held-out runs together):
//
//   node scripts/eval-acceptance.mjs ../docs/evals/results/local-*.json
//
// A model passes when at least 80 % of its runs pass, no reply reached the
// round cap, the loop guard ended none, and none ended in an exception. Runs
// the model server failed after its retries (a crash, out of memory, …) are
// listed by kind: they count as failed runs, not as exceptions. Exits 1 when a
// model fails.

import { readFileSync } from "node:fs";

const PASS_RATE = 0.8;
const TURN_CAP = /^Stopped after \d+ rounds/;
const LOOP = /repeated calls that brought nothing new/;

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/eval-acceptance.mjs <results.json>...");
  process.exit(1);
}

const byModel = new Map();
for (const f of files) {
  const r = JSON.parse(readFileSync(f, "utf8"));
  const key = `${r.model} (${r.provider})`;
  const runs = byModel.get(key) ?? [];
  byModel.set(key, runs.concat(r.runs));
}

let allPass = true;
for (const [model, runs] of byModel) {
  const passed = runs.filter((x) => x.passed).length;
  const turnCap = runs.filter((x) => TURN_CAP.test(x.note ?? "")).length;
  const loops = runs.filter((x) => LOOP.test(x.note ?? "")).length;
  const errors = runs.filter((x) => x.error).length;
  const failures = {};
  for (const x of runs) if (x.failure) failures[x.failure.kind] = (failures[x.failure.kind] ?? 0) + 1;
  const rate = runs.length ? passed / runs.length : 0;
  const criteria = [
    [`at least ${PASS_RATE * 100} % of runs pass`, rate >= PASS_RATE, `${passed}/${runs.length} (${(rate * 100).toFixed(0)} %)`],
    ["no reply reached the round cap", turnCap === 0, String(turnCap)],
    ["the loop guard ended no reply", loops === 0, String(loops)],
    ["no run ended in an exception", errors === 0, String(errors)],
  ];
  const ok = criteria.every(([, pass]) => pass);
  allPass &&= ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${model}`);
  for (const [what, pass, value] of criteria) console.log(`  ${pass ? "✓" : "✗"} ${what}: ${value}`);
  const kinds = Object.entries(failures);
  console.log(`  server failures after retries: ${kinds.length ? kinds.map(([k, n]) => `${k} ${n}`).join(", ") : "none"}`);
}
process.exit(allPass ? 0 : 1);
