// THY-18 replayed: a scripted model through the real agent loop, its answer
// checks and its tools, the tools answering from what they read on the
// validation's dev cases (fixtures/validation-dev.json, synthetic, from the
// dev sweep). Three rules, each shown sending an answer back and then letting
// the fixed one through:
//
// - no verdict without its evidence, measured this reply after the last run
//   that recomputed its stage;
// - numbers by reference: {{tool.field}} filled in from the result, and one
//   that names nothing sent back;
// - computed verdicts: "achieved" comes from the checks; an answer that calls
//   the run a success they do not give is sent back to quote {{achieved}}.

import { afterEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import { configOf } from "../../state/configMemory";
import { usePipelineStore } from "../../state/pipelineStore";
import { runAgent, type AgentResult } from "../agent";
import type { ChatMessage } from "../provider/client";
import { CHAT_TOOLS, type AgentTool } from "../tools";
import fixture from "./fixtures/validation-dev.json";
import { scriptedModel, SCRIPTED_URL, type ScriptTurn } from "./scripted";

const results = fixture.results as Record<string, string[]>;
const DATASETS = fixture.datasets as Record<"control" | "flatten" | "origin", string>;

// A rerun from the flatten: the stages it computed and those it reused.
const RERUN_FROM_FLATTEN = {
  ended: "done",
  seconds: 12.3,
  stages: { rings: "reused", punch: "reused", backfill: "reused", flatten: "computed", pdf: "computed", pdf_check: "computed" },
  outputs: ["raw", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"],
  log_tail: [],
};

/** The app's tools, answering from the recordings in order (a repeated call gets the next one); the local ones run as they are. */
function replayed(dataset: string): AgentTool[] {
  const served = new Map<string, number>();
  return CHAT_TOOLS.map((tool) =>
    ["read_skill", "update_settings", "configure_settings"].includes(tool.name)
      ? tool
      : {
          ...tool,
          run: async (args) => {
            if (tool.name === "run_pipeline") return { result: RERUN_FROM_FLATTEN, summary: "replayed run" };
            const key = `${dataset}|${tool.name}|${JSON.stringify(args)}`;
            const list = results[key];
            if (!list) throw new Error(`no recording of ${key}`);
            const n = served.get(key) ?? 0;
            served.set(key, n + 1);
            return { result: JSON.parse(list[Math.min(n, list.length - 1)]) as unknown, summary: "replayed" };
          },
        },
  );
}

const datasetOf = (id: string): Dataset => ({
  id,
  temperature: null,
  raw_name: `${id}.nxs`,
  stem: id,
  stages: [
    ...["raw", "ringremoved", "braggpunched", "backfilled", "flattened"].map((name) => ({ name, exists: true, kind: "hkl" as const, volume_id: `${id}.${name}` })),
    { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: `${id}.delta_pdf` },
  ],
});

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
  usePipelineStore.getState().patch(configOf(usePipelineStore.getInitialState()));
});

async function replay(
  which: keyof typeof DATASETS,
  question: string,
  script: ScriptTurn[],
): Promise<AgentResult & { requests: number; overrun: number; sent: string[] }> {
  const model = scriptedModel(script);
  uninstall = model.install();
  const dataset = datasetOf(DATASETS[which]);
  const messages: ChatMessage[] = [
    { role: "system", content: "You are NEBULA Pilot." },
    { role: "user", content: question },
  ];
  const result = await runAgent({
    messages,
    tools: replayed(dataset.id),
    // The skills counted as read: the gate on a stage's settings is not under test here.
    ctx: { dataset, datasets: [dataset], skillsRead: new Set(["reduction-qc", "bragg-node-audit", "delta-pdf-interpretation"]) },
    settings: { baseUrl: SCRIPTED_URL, model: "scripted", apiKey: "", temperature: 0, attachImages: false, useTools: true, followViews: false },
    signal: new AbortController().signal,
  });
  return { ...result, requests: model.requests(), overrun: model.overrun(), sent: model.sent() };
}

const called = (r: AgentResult) => r.steps.map((s) => `${s.name}${s.args.stage ? `:${String(s.args.stage)}` : ""}`);

describe("THY-18: no verdict without its evidence", () => {
  it("sends back a ring verdict given without assess_stage, and takes the one that ran it", async () => {
    const r = await replay("control", "Is the powder-ring removal clean?", [
      { text: "Yes, the powder-ring removal is clean." },
      { calls: [{ name: "assess_stage", args: { stage: "rings" } }] },
      { text: "The ring removal {{assess_stage.rings.verdict}}: no ring is left above its plane's noise (left ≤ {{assess_stage.rings.max_ring_left}})." },
    ]);
    expect(called(r)).toEqual(["assess_stage:rings"]);
    expect(r.sent[1]).toMatch(/gives a verdict on the ring removal without its evidence in this reply: call assess_stage with stage rings/);
    expect(r.content).toBe("The ring removal meets its goal: no ring is left above its plane's noise (left ≤ 0).");
    expect(r.note).toBeUndefined();
    expect([r.requests, r.overrun]).toEqual([3, 0]);
  });

  it("sends back a verdict on the flatten measured before the rerun that recomputed it", async () => {
    const r = await replay("flatten", "Does the flatten leave a pedestal? Fix it if so.", [
      { calls: [{ name: "assess_stage", args: { stage: "flatten" } }] },
      { calls: [{ name: "update_settings", args: { changes: { flattenQ2: true } } }] },
      { calls: [{ name: "run_pipeline", args: { from_stage: "flatten" } }] },
      // From the assessment before the rerun: stale.
      { text: "The Q² term took the pedestal out: the flatten now meets its goal." },
      { calls: [{ name: "assess_stage", args: { stage: "flatten" } }] },
      {
        text:
          "There was a pedestal: the floors rose with |Q|. With the Q² term on and the flatten rerun, the flatten {{assess_stage.flatten.verdict}}: " +
          "trend ≤ {{assess_stage.flatten.max_floor_trend}}, span ≤ {{assess_stage.flatten.max_floor_span_fraction}}.",
      },
    ]);
    expect(called(r)).toEqual(["assess_stage:flatten", "update_settings", "run_pipeline", "assess_stage:flatten"]);
    expect(r.sent[4]).toMatch(/gives a verdict on the flatten from a measurement taken before the last run recomputed it: call assess_stage with stage flatten again/);
    // The first assessment found the planted background; the second, after the rerun, none.
    expect(JSON.parse(r.steps[0].result!).flatten.pedestal_left).toBe(true);
    expect(r.content).toBe(
      "There was a pedestal: the floors rose with |Q|. With the Q² term on and the flatten rerun, the flatten meets its goal: trend ≤ 0.025, span ≤ 0.333.",
    );
    expect(r.note).toBeUndefined();
  });

  it("sends back the ΔPDF's correlations named without a measurement of them", async () => {
    const r = await replay("control", "What are the strongest pair correlations in the 3D-ΔPDF?", [
      { text: "The strongest pair correlation is negative, at ⟨½ ½ 0⟩." },
      { calls: [{ name: "dpdf_peaks" }] },
      {
        text:
          "The strongest pair correlation is {{dpdf_peaks.features.0.sign}} at {{dpdf_peaks.features.0.vectors_rlu.0}} r.l.u. " +
          "({{dpdf_peaks.features.0.length_A}} Å, {{dpdf_peaks.features.0.size_sigma}}σ), in {{dpdf_peaks.features.0.n_vectors}} directions.",
      },
    ]);
    expect(called(r)).toEqual(["dpdf_peaks"]);
    expect(r.sent[1]).toMatch(/gives a verdict on the 3D-ΔPDF's pair correlations without its evidence in this reply: call dpdf_peaks/);
    expect(r.content).toBe("The strongest pair correlation is − at (0.497, 0.497, 0) r.l.u. (2.74 Å, 1520σ), in 6 directions.");
    expect(r.note).toBeUndefined();
  });
});

describe("THY-18: numbers by reference", () => {
  it("fills each reference from the tool's own result", async () => {
    const r = await replay("origin", "Is the UB right?", [
      { calls: [{ name: "ub_check" }] },
      {
        text:
          "The UB is not what is wrong: the fit turned it by {{ub_check.orientation_change_deg}}°, and the peaks' offset stayed at {{ub_check.rms}} Å⁻¹. " +
          "Every peak sits {{ub_check.origin_shift_rlu}} r.l.u. off its node: the HKL origin is shifted.",
      },
    ]);
    expect(r.content).toBe(
      "The UB is not what is wrong: the fit turned it by 0°, and the peaks' offset stayed at 0.0583 Å⁻¹. Every peak sits (0.0305, 0.0195, 0) r.l.u. off its node: the HKL origin is shifted.",
    );
    expect([r.note, r.requests]).toEqual([undefined, 2]);
  });

  it("sends back a reference that names nothing, and keeps one still unfilled as written, with a note", async () => {
    const fixed = await replay("control", "How far did the UB fit turn the orientation?", [
      { calls: [{ name: "ub_check" }] },
      { text: "The fit turned the orientation by {{ub_check.angle}}°." },
      { text: "The fit turned the orientation by {{ub_check.orientation_change_deg}}°." },
    ]);
    expect(fixed.content).toBe("The fit turned the orientation by 0°.");
    expect(fixed.sent[2]).toMatch(/These references name no value in this reply's tool results: \{\{ub_check\.angle\}\}/);
    expect([fixed.note, fixed.requests]).toEqual([undefined, 3]);
    const stuck = await replay("control", "How far did the UB fit turn the orientation?", [
      { calls: [{ name: "ub_check" }] },
      { text: "The fit turned the orientation by {{ub_check.angle}}°." },
      { text: "The fit turned the orientation by {{ub_check.angle}}°." },
    ]);
    expect(stuck.content).toBe("The fit turned the orientation by {{ub_check.angle}}°.");
    expect(stuck.note).toMatch(/References that name no tool value: \{\{ub_check\.angle\}\}/);
  });
});

describe("THY-18: computed verdicts", () => {
  const everyStage: ScriptTurn = { calls: ["rings", "punch", "backfill", "flatten", "pdf"].map((stage) => ({ name: "assess_stage", args: { stage } })) };

  it("sends back a run called trustworthy that the checks do not give, and the verdict is theirs", async () => {
    const r = await replay("flatten", "Can I trust this 3D-ΔPDF?", [
      everyStage,
      { text: "Every stage meets its goal, so the 3D-ΔPDF can be trusted." },
      {
        text:
          "The run's goal is {{achieved}}. The flatten left a pedestal: its floors follow |Q| (trend ≤ {{assess_stage.flatten.max_floor_trend}}, span ≤ {{assess_stage.flatten.max_floor_span_fraction}}); " +
          "the reduction-qc skill turns the Q² term on for that.",
      },
    ]);
    expect(r.verdict).toMatchObject({ achieved: false, attention: ["the flatten"], text: "not met: needs attention: the flatten" });
    expect(r.sent[2]).toMatch(/It calls the run a success, but the verdict computed from the checks is "not met: needs attention: the flatten".*quote it as \{\{achieved\}\}/);
    expect(r.content).toBe(
      "The run's goal is not met: needs attention: the flatten. The flatten left a pedestal: its floors follow |Q| (trend ≤ 0.975, span ≤ 0.971); the reduction-qc skill turns the Q² term on for that.",
    );
    expect([r.note, r.requests]).toEqual([undefined, 3]);
  });

  it("lets the clean control's run through on its first answer, its verdict met", async () => {
    const r = await replay("control", "Can I trust this 3D-ΔPDF?", [
      everyStage,
      { text: "Yes: {{achieved}}, so the 3D-ΔPDF can be trusted for analysis." },
    ]);
    expect(r.verdict).toMatchObject({ achieved: true, attention: [], notMeasured: [] });
    expect(r.content).toBe("Yes: met: every stage meets its goal, so the 3D-ΔPDF can be trusted for analysis.");
    expect([r.note, r.requests]).toEqual([undefined, 2]);
  });

  it("asks for the checks a success rests on when they did not all run", async () => {
    const r = await replay("control", "Can I trust this 3D-ΔPDF?", [
      { calls: [{ name: "assess_stage", args: { stage: "pdf" } }] },
      { text: "The 3D-ΔPDF is ready for analysis." },
      { calls: ["rings", "punch", "backfill", "flatten"].map((stage) => ({ name: "assess_stage", args: { stage } })) },
      { text: "The run's goal is {{achieved}}." },
    ]);
    expect(called(r)).toEqual(["assess_stage:pdf", "assess_stage:rings", "assess_stage:punch", "assess_stage:backfill", "assess_stage:flatten"]);
    expect(r.sent[2]).toMatch(/did not all run on the outputs as they now are.*call assess_stage with stage all first/);
    expect(r.content).toBe("The run's goal is met: every stage meets its goal.");
    expect(r.note).toBeUndefined();
  });

  it("states the data's problems that no setting fixes with the verdict", async () => {
    const r = await replay("origin", "Is the UB right?", [{ calls: [{ name: "ub_check" }] }, { text: "{{achieved}}" }]);
    expect(r.verdict?.dataProblems).toEqual(["the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u."]);
    expect(r.verdict?.achieved).toBeNull(); // no stage was assessed
  });
});
