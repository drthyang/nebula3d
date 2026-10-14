#!/usr/bin/env node
// A full eval record's publishable summary (eval-records.mjs): pass or fail,
// the failed checks' names, failure kinds, time and tokens; no tool results,
// arguments or answers.
//
//   node scripts/eval-summary.mjs <record.json> <summary.json>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { summarize } from "./eval-records.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/eval-summary.mjs <record.json> <summary.json>");
  process.exit(1);
}
const summary = summarize(JSON.parse(readFileSync(input, "utf8")));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(summary, null, 1) + "\n");
console.log(`${output}: ${summary.runs.filter((r) => r.passed).length}/${summary.runs.length} runs passed`);
