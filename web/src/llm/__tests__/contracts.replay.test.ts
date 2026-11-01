// The tools' live results against their contracts (tools/contracts.ts): every
// tool whose result is an object, run on the validation's dev control through
// the CPython bridge (devCase, evals/devData/), on the paths its arguments
// reach there. A result that disagrees fails, naming the call and the field:
// the contract follows the tool (docs/development.md, "A Pilot tool's result
// contract"), or the disagreement is a finding about the tool.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { loadSettings, saveSettings } from "../settings";
import { contractDisagreements, RESULT_CONTRACTS } from "../tools/contracts";
import { devCase } from "../evals/devData";

type Call = [tool: string, args: Record<string, unknown>, userMessage?: string, replySteps?: AgentStep[]];

// A cut measured earlier in the reply: what a mark rests on (mark_region's evidence).
const MEASURED: AgentStep = { id: "0:c", name: "measure_reciprocal_cut", args: { plane: "h0l", value: 0 }, status: "done", result: JSON.stringify({ cut: "H–L plane at K = 0" }) };
const PEAKS: AgentStep = { id: "1:c", name: "dpdf_peaks", args: {}, status: "done", result: JSON.stringify({ features: [] }) };

// Each call in turn, on one handle: the tools that change settings or outputs
// come last, so the reads see the case's default run.
const CALLS: Call[] = [
  ["describe_dataset", {}],
  ["current_view", {}],
  ["measure_reciprocal_cut", { plane: "h0l", value: 0 }],
  ["measure_reciprocal_cut", { plane: "hk0", value: 0.5 }],
  ["measure_dpdf_cut", { plane: "xy", value: 0 }],
  ["assess_stage", { stage: "all" }],
  // One stage alone adds its per-plane detail and its goal.
  ["assess_stage", { stage: "rings" }],
  ["assess_stage", { stage: "punch" }],
  ["assess_stage", { stage: "backfill" }],
  ["assess_stage", { stage: "flatten" }],
  ["assess_stage", { stage: "pdf" }],
  ["texture_check", {}],
  ["texture_check", { plane: "hk0", value: 0.5 }],
  ["qmax_coverage", {}],
  ["symmetry_check", {}],
  ["dpdf_contrast", {}],
  ["dpdf_contrast", { percentile: 99 }],
  ["dpdf_contrast", { limit_sigma: 3 }],
  ["dpdf_contrast", { reset: true }],
  ["dpdf_peaks", {}],
  ["dpdf_peaks", { min_sigma: 3, limit: 30 }],
  ["grain_check", {}],
  ["ub_check", {}],
  ["compare_laue_classes", {}],
  ["radial_profile", {}],
  ["radial_profile", { plane: "0kl", stages: ["raw", "flattened"], bins: 8 }],
  ["line_profile", { stage: "flattened", along: "H", at: { K: 0, L: 0 } }],
  ["line_profile", { stage: "delta_pdf", along: "x", at: { y: 0, z: 0 } }],
  ["bragg_peaks", {}],
  ["bragg_peaks", { near_hkl: [1, 0, 0], limit: 3 }],
  ["bragg_peaks", { sort_by: "width" }],
  ["consistency_details", {}],
  ["run_log", {}],
  ["run_log", { stage: "punch", limit: 5 }],
  ["compare_datasets", { kind: "dpdf", plane: "xy", value: 0 }],
  ["compare_datasets", { kind: "reciprocal", plane: "hk0", value: 0 }],
  // A cut outside the data: each dataset's row is its error.
  ["compare_datasets", { kind: "reciprocal", plane: "hk0", value: 99 }],
  // No check on this handle: the verdict before any (its words null).
  ["run_verdict", {}],
  ["configure_settings", {}],
  ["configure_settings", { all: true }],
  ["show_in_viewer", { view: "cleanup", plane: "hk0", value: 0 }],
  ["show_in_viewer", { view: "dpdf", plane: "xy", value: 0 }],
  // A region inside the volume, and points of which one lies outside it (its clipped field).
  ["mark_region", { where: "flatten", shape: "ellipsoid", center: [0.5, 0.5, 0], half_size: [0.2, 0.2, 0.2], label: "a diffuse maximum", evidence: ["measure_reciprocal_cut"] }, undefined, [MEASURED]],
  ["mark_region", { where: "pdf", shape: "points", points: [[2, 0, 0], [99, 0, 0]], label: "a pair", evidence: ["dpdf_peaks"] }, undefined, [PEAKS]],
  // The same mark again: already marked.
  ["mark_region", { where: "pdf", shape: "points", points: [[2, 0, 0], [99, 0, 0]], label: "a pair", evidence: ["dpdf_peaks"] }, undefined, [PEAKS]],
  ["update_settings", { changes: { pdfWindowSupport: true, flattenQ2: true } }],
  ["update_settings", { changes: { flattenQ2: true } }],
  ["run_pipeline", { from_stage: "pdf" }],
  ["tune_pipeline", { stages: ["pdf"], trials_per_stage: 2 }],
  // Asked for by the user (its gate). The dev control's UB is right: refused, nothing written
  // (its written shape is held on the turned UB, evals/devData/regrid.replay.test.ts).
  ["regrid_refined_ub", {}, "Regrid the volume onto the refined UB."],
];

// The tuning run asks its model for alternatives outside the agent loop: a
// model content with the current settings proposes none (as devData.replay.test.ts's).
const TUNER_URL = "http://tuner.invalid/v1";
function contentTuner(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(TUNER_URL)) return real(input, init);
    const content = JSON.stringify({ candidates: [], best: 1, why: "the current settings" });
    // Answered as asked, as a server does: streamed (the tuner's requests are,
    // under the stall watchdog) or whole.
    if ((JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean }).stream) {
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
      return Promise.resolve(new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    }
    const reply = { choices: [{ message: { content } }] };
    return Promise.resolve(new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  const settings = loadSettings();
  saveSettings({ baseUrl: TUNER_URL, model: "content" });
  return () => {
    globalThis.fetch = real;
    saveSettings(settings);
  };
}

describe("the tools' live results against their contracts", () => {
  it("runs every tool with a contract on the dev control", () => {
    expect([...new Set(CALLS.map(([tool]) => tool))].sort()).toEqual(Object.keys(RESULT_CONTRACTS).sort());
  });

  it("each result on the dev control keeps its tool's contract", async () => {
    const c = devCase("dev-control");
    await c.dataset();
    const restore = contentTuner();
    const problems: string[] = [];
    try {
      for (const [tool, args, userMessage, replySteps] of CALLS) {
        const r = await c.tool(tool, args, { userMessage, replySteps });
        const call = `${tool} ${JSON.stringify(args)}`;
        expect(r.ok, `${call}: ${r.summary}`).toBe(true);
        problems.push(...contractDisagreements(tool, r.result).map((d) => `${call}: ${d}`));
      }
    } finally {
      restore();
    }
    expect(problems).toEqual([]);
  });

  // On 81³ the ring check and the texture check are not judged (the grid is
  // too coarse for them: docs/development.md, "The replay tests"); on the
  // validation's own grid they judge, and their results take their other shapes.
  it("on 161³, where the ring check and the texture check judge, their results keep their contracts too", async () => {
    const c = devCase("dev-control", { n: 161 });
    const problems: string[] = [];
    const shapes: string[] = [];
    for (const [tool, args] of FINE_GRID_CALLS) {
      const r = await c.tool(tool, args);
      const call = `${tool} ${JSON.stringify(args)}`;
      expect(r.ok, `${call}: ${r.summary}`).toBe(true);
      problems.push(...contractDisagreements(tool, r.result).map((d) => `${call}: ${d}`));
      if (tool === "assess_stage") shapes.push(typeof (r.result.rings as Record<string, unknown>).ring_rule);
      if (tool === "texture_check") shapes.push(typeof r.result.systematic_fill_bias);
    }
    expect(problems).toEqual([]);
    // The judged shapes: the ring rule as its two shares, and the fill bias judged over every hole in 3-D.
    expect(shapes).toEqual(["object", "object", "boolean"]);
  });
});

const FINE_GRID_CALLS: Call[] = [
  ["assess_stage", { stage: "all" }],
  ["assess_stage", { stage: "rings" }],
  ["texture_check", {}],
];
