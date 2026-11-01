#!/usr/bin/env node
// Count the Pilot's context components with real tokenizers: a local Ollama
// model's own count of each text (prompt_eval_count), against the context
// guard's estimate (provider/tokens.ts: prose 3.5, data 1.4 characters a token).
//
// Input: components.json from measure.spec.ts (PILOT_CONTEXT_OUT). Each text is
// sent once, raw (no chat template), behind a nonce that keeps Ollama's prompt
// cache from matching an earlier text; the nonce's own count is subtracted.
// The whole requests it holds go through /api/chat with their tools, so the
// chat template and the tools' rendering count as the model sees them.
//
// Local and free: Ollama on this machine, one model at a time, unloaded after
// (keep_alive 0 on the last call). Synthetic texts only (the measurement's
// components): no measured data. Usage:
//   node scripts/pilot_context/realtokens.mjs <dir> [model ...]
// Default models: gemma4:26b qwen3:32b. Writes <dir>/realtokens.json and
// prints a table by group.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const [dir, ...modelArgs] = process.argv.slice(2);
if (!dir) {
  console.error("usage: realtokens.mjs <dir with components.json> [model ...]");
  process.exit(2);
}
const models = modelArgs.length ? modelArgs : ["gemma4:26b", "qwen3:32b"];
const { components, requests = [] } = JSON.parse(readFileSync(join(dir, "components.json"), "utf8"));

let counter = 0;
const nonce = () => `[measure ${String(100000 + ((counter++ * 7919) % 900000))}]\n`;

async function post(path, body) {
  const res = await fetch(`${OLLAMA}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const options = { num_predict: 1, temperature: 0, num_ctx: 65536 };

async function rawCount(model, text, keep = "10m") {
  const r = await post("/api/generate", { model, prompt: nonce() + text, raw: true, stream: false, options, keep_alive: keep });
  return r.prompt_eval_count;
}

/** OpenAI-style messages as Ollama's /api/chat takes them. */
const toOllama = (messages) =>
  messages.map((m) => {
    const content = typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join("\n");
    if (m.role === "assistant" && m.tool_calls?.length) {
      return { role: "assistant", content, tool_calls: m.tool_calls.map((c) => ({ function: { name: c.function.name, arguments: JSON.parse(c.function.arguments || "{}") } })) };
    }
    if (m.role === "tool") return { role: "tool", content };
    return { role: m.role, content };
  });

async function chatCount(model, req, keep = "10m") {
  const messages = toOllama(req.messages);
  messages[0] = { ...messages[0], content: nonce() + messages[0].content };
  const r = await post("/api/chat", { model, messages, tools: req.tools, stream: false, options, keep_alive: keep, think: false });
  return r.prompt_eval_count;
}

const results = { measured: new Date().toISOString(), models: {} };
for (const model of models) {
  process.stderr.write(`${model}: loading…\n`);
  await rawCount(model, "warm up"); // load the model
  const base = [];
  for (let i = 0; i < 5; i++) base.push(await rawCount(model, ""));
  const nonceTokens = base.reduce((a, b) => a + b, 0) / base.length;
  const counted = [];
  for (const [i, c] of components.entries()) {
    if (!c.text) continue;
    const t = (await rawCount(model, c.text)) - nonceTokens;
    counted.push({ group: c.group, name: c.name, arm: c.arm, rate: c.rate, chars: c.chars, est: c.est, real: t });
    if (i % 20 === 0) process.stderr.write(`  ${i + 1}/${components.length}\n`);
  }
  const reqs = [];
  for (const [i, r] of requests.entries()) {
    const last = i === requests.length - 1;
    reqs.push({ label: r.label, est: r.est, real: await chatCount(model, r, last ? 0 : "10m") });
  }
  if (!requests.length) await rawCount(model, "", 0);
  results.models[model] = { nonceTokens, components: counted, requests: reqs };
}
writeFileSync(join(dir, "realtokens.json"), JSON.stringify(results, null, 1));

// The table: by group and rate, the estimate against each model's count.
const groups = new Map();
for (const [model, r] of Object.entries(results.models)) {
  for (const c of r.components) {
    const key = `${c.group} (${c.arm})`;
    const g = groups.get(key) ?? { chars: 0, est: 0, rate: c.rate, real: {} };
    if (model === models[0]) {
      g.chars += c.chars;
      g.est += c.est;
    }
    g.real[model] = (g.real[model] ?? 0) + c.real;
    groups.set(key, g);
  }
}
const fmt = (x) => Math.round(x).toLocaleString("en-US");
console.log(`| group (arm) | rate | chars | estimate | ${models.map((m) => `${m} | chars/token`).join(" | ")} |`);
console.log(`| --- | --- | ---: | ---: | ${models.map(() => "---: | ---:").join(" | ")} |`);
for (const [key, g] of groups) {
  console.log(`| ${key} | ${g.rate} | ${fmt(g.chars)} | ${fmt(g.est)} | ${models.map((m) => `${fmt(g.real[m])} | ${(g.chars / g.real[m]).toFixed(2)}`).join(" | ")} |`);
}
console.log("");
console.log(`| whole request | estimate | ${models.join(" | ")} |`);
console.log(`| --- | ---: | ${models.map(() => "---:").join(" | ")} |`);
for (const [i, r] of (results.models[models[0]].requests ?? []).entries()) {
  console.log(`| ${r.label} | ${fmt(r.est)} | ${models.map((m) => fmt(results.models[m].requests[i].real)).join(" | ")} |`);
}
