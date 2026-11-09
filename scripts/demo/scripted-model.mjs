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
//   "tune"        reads the punch's skill and tunes the punch (tune_pipeline,
//                 two trials: a tuning card under the reply), then answers.
//   "long N"      N characters of plain prose, to fill the context meter.
//   The context-meter story (believable turns that fill the window; paste the
//   notes after the question's first line, as a user would):
//   "Assess the run."             the check on each stage, then how to read them.
//   "These are the ring-removal notes …"   (docs/algorithms/powder_rings.md pasted)
//                 the ring check, then an answer about the rings.
//   "These are the 3D-ΔPDF notes …"        (docs/algorithms/delta_pdf.md pasted)
//                 the ΔPDF's peaks and its consistency check, then what to look for.
//   anything else one short line.
// Auto mode ("Run auto analysis"): the stage fixes and the report. Choose
// the scenario first:
//   curl 'http://127.0.0.1:18790/scenario?name=fix'    (one ring fix)
//   curl 'http://127.0.0.1:18790/scenario?name=clean'  (no fix, the default)
//   curl 'http://127.0.0.1:18790/scenario?name=tune'   (each stage the run asks
//                 to fix is tuned: tune_pipeline with two trials, the tuning's
//                 proposal one setting changed, its judgement the user's settings)
// GET /log lists the requests it has served.
import { createServer } from "node:http";
const PORT = Number(process.argv[2] ?? 18790);
const PAUSE = Number(process.argv[3] ?? 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const STAGE_SKILL = { "the ring removal": "reduction-qc", "the Bragg punch": "bragg-node-audit", "the backfill": "bragg-node-audit", "the flatten": "reduction-qc", "the 3D-ΔPDF": "delta-pdf-interpretation" };
const SCENARIOS = { clean: {}, fix: { "the ring removal": [{ ringPooledSectors: 36 }] }, tune: {} };
// The tune scenario: each stage the run asks to fix is tuned (tune_pipeline),
// one trial besides the user's settings, which the judgement keeps.
const TUNE_STAGE = { "the ring removal": "rings", "the Bragg punch": "punch", "the backfill": "backfill", "the flatten": "flatten", "the 3D-ΔPDF": "pdf" };
const TUNE_TRY = { rings: { ringPooledSectors: 36 }, punch: { punchMinSig: 6 }, backfill: { backfillMethod: "local" }, flatten: { flattenFitQMax: 9 }, pdf: { pdfApod: "hann" } };
const HIGHLIGHTS = [
  ["assess_stage", { stage: "rings" }], ["assess_stage", { stage: "punch" }], ["assess_stage", { stage: "backfill" }],
  ["assess_stage", { stage: "flatten" }], ["assess_stage", { stage: "pdf" }], ["ub_check", {}], ["dpdf_peaks", {}],
  ["consistency_details", {}], ["qmax_coverage", {}],
];
const TUNE_CHAT = [["read_skill", { name: "bragg-node-audit" }], ["tune_pipeline", { stages: ["punch"], trials_per_stage: 2 }]];
const CARDS = [["assess_stage", { stage: "punch" }], ["update_settings", { changes: { punchSupercellL: 2 } }]];
// The context-meter story: generic and true for the synthetic demo volume; no
// number is written (the checks above carry them).
const STORY = [
  {
    match: /^Assess the run\.?$/,
    calls: [["assess_stage", { stage: "rings" }], ["assess_stage", { stage: "punch" }], ["assess_stage", { stage: "backfill" }], ["assess_stage", { stage: "flatten" }], ["assess_stage", { stage: "pdf" }]],
    answer: [
      "I ran the stage check on each of the five stages. Each one's verdict, and the planes it read, are in its step above, and its highlights are on the Reciprocal cleanup views.",
      "",
      "How to read them on this volume:",
      "",
      "- **Ring removal.** The aluminium powder rings sit at the same |Q| on every plane, so anything left of them shows as arcs at one radius in the ring-removed view.",
      "- **Bragg punch.** The rock-salt lattice puts its Bragg peaks on integer nodes: look for counts left at a node, and for sharp maxima away from the lattice.",
      "- **Backfill.** A good fill carries the diffuse texture through where the hole was; a flat disc or a bright rim marks a fill that does not follow it.",
      "- **Background correction.** It takes out the smooth radial background and keeps the diffuse; what is left between the nodes should be the crystal's own scattering.",
      "- **3D-ΔPDF.** The transform of what the cleanup kept; ask me about it next.",
      "",
      "The verdict under this reply is computed from those checks, not written by me.",
    ].join("\n"),
  },
  {
    match: /^These are the ring-removal notes/,
    calls: [["assess_stage", { stage: "rings" }]],
    answer: [
      "It works the way the notes describe: the ring removal subtracts only the shells it confirms as powder rings and leaves every other shell to the crystal. On this volume the rings come from the aluminium in the sample environment, so they sit at fixed |Q| and are easy to tell from the rock-salt's diffuse, which follows the lattice.",
      "",
      "The ring check is in the step above, with its verdict and the shells it read. To see it for yourself:",
      "",
      "- Open **Reciprocal cleanup** and put **Raw** and **Ring-removed** side by side.",
      "- Step the cut along L. A leftover ring is an arc at one radius that stays put while the lattice features move.",
      "- Where a ring crosses a Bragg node, look at the node in **Bragg-punched** too: the punch, not the ring removal, takes the peak.",
      "",
      "If an arc remains, the ring model's azimuthal sectors are the setting to try: fewer sectors pool more counts in each, which steadies a weak ring's fit. Change it, run from the ring removal, and ask me to check again.",
    ].join("\n"),
  },
  {
    match: /^These are the 3D-ΔPDF notes/,
    calls: [["dpdf_peaks", {}], ["consistency_details", {}]],
    answer: [
      "The 3D-ΔPDF is the Fourier transform of what the cleanup kept: the diffuse alone, with the Bragg peaks and the smooth background gone. Its features are the pair correlations that differ from the average structure, so read them as positive and negative lobes at interatomic vectors, not as atoms.",
      "",
      "On this volume, look for:",
      "",
      "- **Alternating shells around the origin.** The demo's planted short-range order shows as correlations that change sign from one neighbour shell to the next. The strongest features are listed in the dpdf_peaks step above.",
      "- **Lobes on the rock-salt's interatomic vectors.** A lobe off those vectors is worth a look in the cleanup views before you read it as order.",
      "- **The consistency check.** Its back-FFT is compared with the data in the step above; a faithful transform follows the data's even part closely.",
      "",
      "The 3D-ΔPDF page shows three linked sections in a diverging colour scale, one colour for each sign. Step a cut through a lobe to follow it along the third axis.",
    ].join("\n"),
  },
];
const story = (text) => STORY.find((t) => t.match.test(text.split("\n")[0].trim()));
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
    // The tuning run's own questions (llm/tune/prompts.ts): what to try, and which trial won.
    const propose = /^Stage: (.+?)\.\n[\s\S]*Propose up to/.exec(last);
    const judge = /^Stage: (.+?)\.\n[\s\S]*Pick the trial/.exec(last);
    const report = last.startsWith("Report on this auto run");
    const entry = { at: new Date().toISOString(), last: last.slice(0, 60), calls: calls.length, chars: body.length, phase: fix ? `fix ${fix[1]}` : report ? "report" : "chat" };
    log.push(entry);
    console.log(JSON.stringify(entry));
    res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    await sleep(PAUSE);
    if (propose || judge) {
      const label = (propose ?? judge)[1];
      const stage = { "Ring removal": "rings", "Bragg punch": "punch", "Backfill": "backfill", "Flatten": "flatten", "Background correction": "flatten", "3D-ΔPDF": "pdf" }[label] ?? "punch";
      const answer = propose
        ? { candidates: [{ changes: TUNE_TRY[stage], why: "One setting changed, to see whether the stage's check moves." }] }
        : { best: 1, why: "Trial 1 meets the goal as well as trial 2. A small change in one number is not worth a change." };
      await say(res, JSON.stringify(answer));
    } else if (fix && scenario === "tune") {
      const stage = TUNE_STAGE[fix[1]];
      if (!stage) await say(res, "No setting change would help this stage: its check above reads as it is.");
      else if (calls.length === 0) await toolCall(res, "read_skill", { name: STAGE_SKILL[fix[1]] });
      else if (calls.length === 1) await toolCall(res, "tune_pipeline", { stages: [stage], trials_per_stage: 2 });
      else await say(res, "I tuned this stage with two trials; the tuning kept your settings, and its card above has each trial's numbers.");
    } else if (fix) {
      const plan = SCENARIOS[scenario]?.[fix[1]];
      if (!plan) await say(res, "No setting change would help this stage: its check above reads as it is.");
      else if (calls.length === 0) await toolCall(res, "read_skill", { name: STAGE_SKILL[fix[1]] });
      else if (calls.length <= plan.length) await toolCall(res, "update_settings", { changes: plan[calls.length - 1] });
      else await say(res, "I halved the ring model's azimuthal sectors so each pools more counts; the run from the punch will show whether it helped.");
    } else if (report) {
      await say(res, "The auto run is done. Each stage's verdict is in its check above, and the changes the run made are in its decision log.");
    } else if (story(last)) {
      const t = story(last);
      if (calls.length < t.calls.length) await toolCall(res, ...t.calls[calls.length]);
      else await say(res, t.answer);
    } else if (/highlights/i.test(last)) {
      if (calls.length < HIGHLIGHTS.length) await toolCall(res, ...HIGHLIGHTS[calls.length]);
      else await say(res, "Each stage's check is above, with its highlights on the views.");
    } else if (/^tune\b/i.test(last)) {
      if (calls.length < TUNE_CHAT.length) await toolCall(res, ...TUNE_CHAT[calls.length]);
      else await say(res, ["I tuned the Bragg punch with two trials. The tuning kept your settings: the card above has each trial's numbers and why.", "", "- **Trial 1** is your settings.", "- **Trial 2** changed one setting; its check did not read better.", "", "Nothing changed: your processed files and settings stand."].join("\n"));
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
