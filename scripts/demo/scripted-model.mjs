// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-han Yang
//
// A scripted model for demos and the demo QA: an OpenAI-compatible server
// with no model behind it, so every reply and tool call is the same on each
// run and costs nothing. It sends no data anywhere and holds no keys; use it
// with the synthetic demo volume.
//
// Run (Node 18+):
//   node scripts/demo/scripted-model.mjs [port] [pause-ms]
//   defaults: port 18790, a 600 ms pause before each reply.
//
// Point NEBULA Pilot at it: in its connection settings, set the base URL to
// http://127.0.0.1:18790/v1 (the provider then shows as Custom; a local URL
// needs no key) and pick the model "scripted-pilot".
// It allows every origin (CORS), so the Pages site can reach it too.
//
// What to type in the chat (matched on your latest message):
//   "highlights"  a check on every stage and page (assess_stage on all five
//                 stages, ub_check, dpdf_peaks, consistency_details,
//                 qmax_coverage), then a short answer: the highlights.
//   "cards"       assesses the punch, asks to set the punch's supercell along
//                 L (refused: a sample-fact card), then names two settings
//                 with values (two setting cards).
//   "long N"      N characters of plain prose, to fill the context meter.
//   anything else one short line.
// Auto mode ("Run auto analysis"): the stage fixes and the report. Choose
// the scenario first:
//   curl 'http://127.0.0.1:18790/scenario?name=fix'    (one ring fix)
//   curl 'http://127.0.0.1:18790/scenario?name=clean'  (no fix, the default)
// GET /log lists the requests it has served.
import { createServer } from "node:http";
const PORT = Number(process.argv[2] ?? 18790);
const PAUSE = Number(process.argv[3] ?? 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const STAGE_SKILL = { "the ring removal": "reduction-qc", "the Bragg punch": "bragg-node-audit", "the backfill": "bragg-node-audit", "the flatten": "reduction-qc", "the 3D-ΔPDF": "delta-pdf-interpretation" };
const SCENARIOS = { clean: {}, fix: { "the ring removal": [{ ringPooledSectors: 36 }] } };
const HIGHLIGHTS = [
  ["assess_stage", { stage: "rings" }], ["assess_stage", { stage: "punch" }], ["assess_stage", { stage: "backfill" }],
  ["assess_stage", { stage: "flatten" }], ["assess_stage", { stage: "pdf" }], ["ub_check", {}], ["dpdf_peaks", {}],
  ["consistency_details", {}], ["qmax_coverage", {}],
];
const CARDS = [["assess_stage", { stage: "punch" }], ["update_settings", { changes: { punchSupercellL: 2 } }]];
const SENTENCE = "This note walks through the reduction in words only and makes no claim about any stage. ";
let scenario = "clean";
const log = [];
function chunk(res, delta, finish = null) {
  res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
}
async function toolCall(res, name, args) {
  chunk(res, { role: "assistant", tool_calls: [{ index: 0, id: `call_${name}_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  await sleep(50);
  chunk(res, {}, "tool_calls");
}
async function say(res, text) {
  const step = text.length > 2000 ? 400 : 0;
  if (step) for (let i = 0; i < text.length; i += step) { chunk(res, { content: text.slice(i, i + step) }); await sleep(3); }
  else for (const w of text.split(/(?<= )/)) { chunk(res, { content: w }); await sleep(12); }
  chunk(res, {}, "stop");
}
createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const json = (v) => { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(v)); };
  if (url.pathname === "/scenario") { scenario = url.searchParams.get("name") ?? "clean"; return json({ scenario }); }
  if (url.pathname === "/log") return json(log);
  if (url.pathname === "/v1/models") return json({ object: "list", data: [{ id: "scripted-pilot", object: "model" }] });
  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    let body = "";
    for await (const c of req) body += c;
    const msg = JSON.parse(body);
    const users = msg.messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    const last = users[users.length - 1] ?? "";
    // The calls since the last user message, as this reply's progress.
    const lastUser = msg.messages.map((m) => m.role).lastIndexOf("user");
    const calls = msg.messages.slice(lastUser + 1).filter((m) => m.role === "assistant" && m.tool_calls).flatMap((m) => m.tool_calls).filter((c) => !c.id.startsWith("seed_"));
    const fix = /^Change or tune (.+?) so /.exec(last);
    const report = last.startsWith("Report on this auto run");
    const entry = { at: new Date().toISOString(), last: last.slice(0, 60), calls: calls.length, chars: body.length, phase: fix ? `fix ${fix[1]}` : report ? "report" : "chat" };
    log.push(entry);
    console.log(JSON.stringify(entry));
    res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    await sleep(PAUSE);
    if (fix) {
      const plan = SCENARIOS[scenario]?.[fix[1]];
      if (!plan) await say(res, "No setting change would help this stage: its check above reads as it is.");
      else if (calls.length === 0) await toolCall(res, "read_skill", { name: STAGE_SKILL[fix[1]] });
      else if (calls.length <= plan.length) await toolCall(res, "update_settings", { changes: plan[calls.length - 1] });
      else await say(res, "I halved the ring model's azimuthal sectors so each pools more counts; the run from the punch will show whether it helped.");
    } else if (report) {
      await say(res, "The auto run is done. Each stage's verdict is in its check above, and the changes the run made are in its decision log.");
    } else if (/highlights/i.test(last)) {
      if (calls.length < HIGHLIGHTS.length) await toolCall(res, ...HIGHLIGHTS[calls.length]);
      else await say(res, "Each stage's check is above, with its highlights on the views.");
    } else if (/cards/i.test(last)) {
      if (calls.length < CARDS.length) await toolCall(res, ...CARDS[calls.length]);
      else await say(res, "The punch cell along L is yours to state, so I did not change it: its card is below. You could also set `punchMinSig` to 6, or `flattenFitQMax` to 9.");
    } else if (/^long (\d+)/.test(last)) {
      const n = Number(/^long (\d+)/.exec(last)[1]);
      await say(res, SENTENCE.repeat(Math.ceil(n / SENTENCE.length)).slice(0, n).trimEnd());
    } else {
      await say(res, "Ask me about this reduction.");
    }
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  res.writeHead(404, cors); res.end("not found");
}).listen(PORT, "127.0.0.1", () => console.log(`scripted model on http://127.0.0.1:${PORT}/v1`));
