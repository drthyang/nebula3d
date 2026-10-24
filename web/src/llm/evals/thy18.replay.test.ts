// THY-18 replayed: a scripted model through the real agent loop, its answer
// checks and its tools, the tools running on the validation's dev cases built
// where the tests run (devData: the pipeline in Python through the CPython
// bridge; nothing recorded, so the flatten's rerun is a real one). Three
// rules, each shown sending an answer back and then letting the fixed one
// through:
//
// - no verdict without its evidence, measured this reply after the last run
//   that recomputed its stage;
// - numbers by reference: {{tool.field}} filled in from the result, and one
//   that names nothing sent back;
// - computed verdicts: "achieved" comes from the checks; an answer that calls
//   the run a success they do not give is sent back to quote {{achieved}}.
//
// The numbers an answer quotes are read from the tools' results, as the
// references fill them; where they are a planted fault's, they are held to
// the case's truth.
//
// A rule shown on the clean control's verdict, met, needs every stage judged:
// those replays build the control on the validation's own grid, whatever the
// run's. On the replays' default grid the ring check is not judged, the grid
// too coarse for its 3D test (nebula3d.preprocessing.ring_isotropy), so the
// control's run is not judged there either.

import { describe, expect, it } from "vitest";

import type { AgentResult } from "../agent";
import { devCase } from "./devData";
import { DEV_GRIDS } from "./devData/bridgeWorker";
import type { ScriptTurn } from "./scripted";

/** The validation's own grid, on which every check judges the dev cases. */
const EVERY_CHECK_JUDGES = { n: DEV_GRIDS[1] } as const;

/** A value as a filled reference shows it (references.ts): a number as written, a list in brackets. */
const shown = (v: unknown): string => (Array.isArray(v) ? `(${v.join(", ")})` : String(v));

const called = (r: AgentResult) => r.steps.map((s) => `${s.name}${s.args.stage ? `:${String(s.args.stage)}` : ""}`);

/** The origin shift ub_check found, held to the planted one: each component within half the smallest planted. */
function expectPlantedShift(found: unknown, planted: number[]): void {
  const tol = Math.min(...planted.filter((x) => x !== 0).map(Math.abs)) / 2;
  expect(Array.isArray(found) && found.length === planted.length, `found ${JSON.stringify(found)}`).toBe(true);
  (found as number[]).forEach((x, i) => expect(Math.abs(x - planted[i]), `found ${JSON.stringify(found)}, planted ${JSON.stringify(planted)}`).toBeLessThanOrEqual(tol));
}

describe("THY-18: no verdict without its evidence", () => {
  it("sends back a ring verdict given without assess_stage, and takes the one that ran it", async () => {
    const r = await devCase("dev-control", EVERY_CHECK_JUDGES).replay("Is the powder-ring removal clean?", [
      { text: "Yes, the powder-ring removal is clean." },
      { calls: [{ name: "assess_stage", args: { stage: "rings" } }] },
      { text: "The ring removal {{assess_stage.rings.verdict}}: no ring is left above its plane's noise (left ≤ {{assess_stage.rings.max_ring_left}})." },
    ]);
    expect(called(r)).toEqual(["assess_stage:rings"]);
    expect(r.sent[1]).toMatch(/gives a verdict on the ring removal without its evidence in this reply: call assess_stage with stage rings/);
    const rings = r.results("assess_stage")[0].rings as Record<string, unknown>;
    expect(r.content).toBe(`The ring removal ${rings.verdict}: no ring is left above its plane's noise (left ≤ ${shown(rings.max_ring_left)}).`);
    expect(r.note).toBeUndefined();
    expect([r.requests, r.overrun]).toEqual([3, 0]);
  });

  it("sends back a verdict on the flatten measured before the rerun that recomputed it", async () => {
    const r = await devCase("dev-flatten").replay("Does the flatten leave a pedestal? Fix it if so.", [
      { calls: [{ name: "assess_stage", args: { stage: "flatten" } }] },
      { calls: [{ name: "update_settings", args: { changes: { flattenQ2: true } } }] },
      { calls: [{ name: "run_pipeline", args: { from_stage: "flatten" } }] },
      // From the assessment before the rerun: stale.
      { text: "The Q² term took the pedestal out: the flatten now meets its goal." },
      { calls: [{ name: "assess_stage", args: { stage: "flatten" } }] },
      {
        text:
          "There was a pedestal: the floors rose with |Q|. With the Q² term on and the flatten rerun, the flatten {{assess_stage.flatten.verdict}}: " +
          "trend {{assess_stage.flatten.floor_trend}}, span {{assess_stage.flatten.floor_span_fraction}}.",
      },
    ]);
    expect(called(r)).toEqual(["assess_stage:flatten", "update_settings", "run_pipeline", "assess_stage:flatten"]);
    expect(r.sent[4]).toMatch(/gives a verdict on the background correction from a measurement taken before the last run recomputed it: call assess_stage with stage flatten again/);
    // The first assessment found the planted background; the rerun with the Q² term recomputed the flatten, and the second found none.
    const [before, after] = r.results("assess_stage").map((x) => x.flatten as Record<string, unknown>);
    expect([before.pedestal_left, after.pedestal_left]).toEqual([true, false]);
    expect(r.results("run_pipeline")[0].stages).toMatchObject({ flatten: "computed" });
    expect(r.content).toBe(
      `There was a pedestal: the floors rose with |Q|. With the Q² term on and the flatten rerun, the flatten ${after.verdict}: ` +
        `trend ${shown(after.floor_trend)}, span ${shown(after.floor_span_fraction)}.`,
    );
    expect(r.note).toBeUndefined();
  });

  it("sends back the ΔPDF's correlations named without a measurement of them", async () => {
    const r = await devCase("dev-control").replay("What are the strongest pair correlations in the 3D-ΔPDF?", [
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
    const top = (r.results("dpdf_peaks")[0].features as Record<string, unknown>[])[0];
    expect(r.content).toBe(
      `The strongest pair correlation is ${top.sign} at ${shown((top.vectors_rlu as unknown[])[0])} r.l.u. ` +
        `(${shown(top.length_A)} Å, ${shown(top.size_sigma)}σ), in ${shown(top.n_vectors)} directions.`,
    );
    expect(r.note).toBeUndefined();
  });
});

describe("THY-18: numbers by reference", () => {
  it("fills each reference from the tool's own result", async () => {
    const c = devCase("dev-origin");
    const r = await c.replay("Is the UB right?", [
      { calls: [{ name: "ub_check" }] },
      {
        text:
          "The UB is not what is wrong: the fit turned it by {{ub_check.orientation_change_deg}}°, and the peaks' offset stayed at {{ub_check.rms}} Å⁻¹. " +
          "Every peak sits {{ub_check.origin_shift_rlu}} r.l.u. off its node: the HKL origin is shifted.",
      },
    ]);
    const ub = r.results("ub_check")[0];
    expect(r.content).toBe(
      `The UB is not what is wrong: the fit turned it by ${shown(ub.orientation_change_deg)}°, and the peaks' offset stayed at ${shown(ub.rms)} Å⁻¹. ` +
        `Every peak sits ${shown(ub.origin_shift_rlu)} r.l.u. off its node: the HKL origin is shifted.`,
    );
    expectPlantedShift(ub.origin_shift_rlu, c.truth.offset_rlu!);
    expect([r.note, r.requests]).toEqual([undefined, 2]);
  });

  it("sends back a reference that names nothing, and keeps one still unfilled as written, with a note", async () => {
    const fixed = await devCase("dev-control").replay("How far did the UB fit turn the orientation?", [
      { calls: [{ name: "ub_check" }] },
      { text: "The fit turned the orientation by {{ub_check.angle}}°." },
      { text: "The fit turned the orientation by {{ub_check.orientation_change_deg}}°." },
    ]);
    expect(fixed.content).toBe(`The fit turned the orientation by ${shown(fixed.results("ub_check")[0].orientation_change_deg)}°.`);
    expect(fixed.sent[2]).toMatch(/These references name no value in this reply's tool results: \{\{ub_check\.angle\}\}/);
    expect([fixed.note, fixed.requests]).toEqual([undefined, 3]);
    const stuck = await devCase("dev-control").replay("How far did the UB fit turn the orientation?", [
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
    const r = await devCase("dev-flatten").replay("Can I trust this 3D-ΔPDF?", [
      everyStage,
      { text: "Every stage meets its goal, so the 3D-ΔPDF can be trusted." },
      {
        text:
          "The run's goal is {{achieved}}. The flatten left a pedestal: its floors follow |Q| (trend {{assess_stage.flatten.floor_trend}}, span {{assess_stage.flatten.floor_span_fraction}}); " +
          "the reduction-qc skill turns the Q² term on for that.",
      },
    ]);
    // The planted pedestal is the one thing the checks find.
    expect(r.verdict).toMatchObject({ achieved: false, attention: ["the background correction"], text: "not met: needs attention: the background correction" });
    expect(r.sent[2]).toMatch(/It calls the run a success, but the verdict computed from the checks is "not met: needs attention: the background correction".*quote it as \{\{achieved\}\}/);
    const flatten = r.results("assess_stage").find((x) => x.flatten)!.flatten as Record<string, unknown>;
    expect(r.content).toBe(
      `The run's goal is not met: needs attention: the background correction. The flatten left a pedestal: its floors follow |Q| (trend ${shown(flatten.floor_trend)}, span ${shown(flatten.floor_span_fraction)}); ` +
        "the reduction-qc skill turns the Q² term on for that.",
    );
    expect([r.note, r.requests]).toEqual([undefined, 3]);
  });

  it("lets the clean control's run through on its first answer, its verdict met", async () => {
    const r = await devCase("dev-control", EVERY_CHECK_JUDGES).replay("Can I trust this 3D-ΔPDF?", [
      everyStage,
      { text: "Yes: {{achieved}}, so the 3D-ΔPDF can be trusted for analysis." },
    ]);
    expect(r.verdict).toMatchObject({ achieved: true, attention: [], notMeasured: [] });
    expect(r.content).toBe("Yes: met: every stage meets its goal, so the 3D-ΔPDF can be trusted for analysis.");
    expect([r.note, r.requests]).toEqual([undefined, 2]);
  });

  it("asks for the checks a success rests on when they did not all run", async () => {
    const r = await devCase("dev-control", EVERY_CHECK_JUDGES).replay("Can I trust this 3D-ΔPDF?", [
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
    const c = devCase("dev-origin");
    const r = await c.replay("Is the UB right?", [{ calls: [{ name: "ub_check" }] }, { text: "{{achieved}}" }]);
    const shift = r.results("ub_check")[0].origin_shift_rlu;
    expectPlantedShift(shift, c.truth.offset_rlu!);
    expect(r.verdict?.dataProblems).toEqual([`the HKL origin is shifted by ${shown(shift)} r.l.u.`]);
    expect(r.verdict?.achieved).toBeNull(); // no stage was assessed
  });
});
