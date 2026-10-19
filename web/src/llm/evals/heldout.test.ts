// The held-out scenarios' CI replay: each played by a scripted model against
// the tool results recorded on the held-out volumes (heldoutFixture.ts's,
// from heldoutProbe.test.ts), through the real agent loop, its answer checks
// and the graders, as evals.test.ts does for the measured set. A good script
// writes what a careful model would, and must pass every check on its first
// answer; a bad one, a failure as models make them, must fail the checks named
// for it. The injected sizes grade the tools too: what they read must be the
// fault that was put in.

import { afterEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import type { PipelineContext } from "../context/pipelineContext";
import { CHAT_TOOLS } from "../tools";
import { WORDS } from "../verdicts";
import { runScenario, transcript, type Scenario } from "./harness";
import { HELDOUT, HELDOUT_CALLS, HELDOUT_SCENARIOS, TRUTH } from "./heldout";
import { HOLDOUT_ENV, holdoutOptedIn, loadHeldoutFixture } from "./heldoutFixture";
import { replayTools, scriptedModel, SCRIPTED_URL, type ScriptTurn } from "./scripted";

// The recording is held out: read with NEBULA_HOLDOUT_TESTS=1 alone (CI sets it).
// Without it nothing below runs and no held-out scenario is collected, so none of
// their names is printed; one test says why.
const fixture = holdoutOptedIn() ? await loadHeldoutFixture() : null;

it.runIf(fixture === null)(`leaves the held-out scenarios out without ${HOLDOUT_ENV}=1`, async () => {
  await expect(loadHeldoutFixture()).rejects.toThrow(`${HOLDOUT_ENV}=1`);
});

interface Replay {
  good: ScriptTurn[];
  bad: ScriptTurn[];
  catches: string[]; // checks the bad run must fail
  flags?: RegExp; // what the agent's answer checks note under the bad run
}

const REPLAYS: Record<string, Replay> = {
  "heldout-ub-turned": {
    good: [
      { calls: [{ name: "ub_check", args: {} }] },
      {
        text: "No, the UB is off. ub_check found it turned by 0.602° and fitted that rotation away: the Bragg peaks' RMS offset from their nodes fell from 0.0492 to 0.0016 Å⁻¹. Use the refined UB before the punch.",
      },
    ],
    bad: [{ calls: [{ name: "ub_check", args: {} }] }, { text: "Yes, the UB is right: the Bragg peaks sit on their nodes." }],
    catches: ["quotes the rotation the fit measured", "quotes the rotation (0.6, injected)", "says that the UB is off"],
    flags: /Contradicts the tools' verdict on the UB/,
  },
  "heldout-ub-right": {
    good: [
      { calls: [{ name: "ub_check", args: {} }] },
      {
        text: "Yes, the UB is right. ub_check found a rotation of only 0.001°, and the Bragg peaks' RMS offset from their nodes stayed at 0.0004 Å⁻¹, so there is nothing to correct.",
      },
    ],
    bad: [{ calls: [{ name: "ub_check", args: {} }] }, { text: "No, the UB is misoriented by about 0.5°; refine it before the punch." }],
    catches: ["says that the UB is right", "never claims a misorientation"],
    flags: /Contradicts the tools' verdict on the UB/,
  },
  "heldout-origin-shifted": {
    good: [
      { calls: [{ name: "ub_check", args: {} }] },
      {
        text: "No, the UB is not what is wrong. ub_check found a rotation of only 0.001°, and the fit removed none of the peaks' offset: the RMS stayed at 0.0583 Å⁻¹, against a voxel of 0.0806 Å⁻¹, so no UB change explains it. Look at the origin of the HKL grid, or at how |Q| was assigned.",
      },
    ],
    bad: [
      { calls: [{ name: "ub_check", args: {} }] },
      { text: "Yes, the UB is wrong: the peaks sit 0.0583 Å⁻¹ off their nodes. Refine the UB to put them back." },
    ],
    catches: ["says where the offset comes from", "never claims that the UB is wrong"],
    flags: /Contradicts the tools' verdict on the UB/,
  },
  "heldout-coverage-edge": {
    good: [
      { calls: [{ name: "qmax_coverage", args: {} }] },
      {
        text: "The raw counts end at 4.507 Å⁻¹. Every direction is measured from 0.15 to 4.45 Å⁻¹, and nothing past the edge, well short of the box's face at 6.444 Å⁻¹. Give the 3D-ΔPDF the band the tool suggests, 0 to 4.5 Å⁻¹; the ellipsoid window, shrunk to 0.695 ×, then puts 9.8e-4 of its weight on unmeasured reciprocal space.",
      },
    ],
    bad: [{ text: "The coverage is complete: the counts reach the box's face, so use the whole box, out to 6.4 Å⁻¹." }],
    catches: ["calls qmax_coverage", "quotes the counts' upper edge", "quotes the edge (4.511, injected)"],
    flags: /Not measured in this reply: the ΔPDF window against the coverage/,
  },
  "heldout-rings-found": {
    good: [
      { calls: [{ name: "assess_stage", args: { stage: "rings" } }] },
      {
        text: "Yes. The raw data have two powder rings, at 2.45 and 3.66 Å⁻¹: each rises in nearly every direction over the sphere (isotropy 0.92 and 0.97). The bumps at 1.68, 3.16, 4.59 and 7.08 Å⁻¹ do not, so they are the crystal's own scattering, which the removal rightly left. The removal took the ring at 3.66 Å⁻¹ out: its residuals are below the noise on every plane. Part of the ring at 2.45 Å⁻¹ is left on hk0: a residual of 0.149, above three times that plane's noise.",
      },
    ],
    bad: [{ text: "No: the raw data have no powder rings, and the ring removal left nothing behind." }],
    catches: ["calls assess_stage for the rings", "quotes the first ring (2.45, injected)", "quotes the second ring (3.65, injected)", "says that a ring is left"],
    flags: /Not measured in this reply: the ring removal/,
  },
};

const datasets = (fixture?.datasets ?? []) as unknown as Dataset[];
const contexts = (fixture?.contexts ?? {}) as unknown as Record<string, PipelineContext>;
const results = (fixture?.results ?? {}) as Record<string, string>;
const scenarios = fixture ? HELDOUT_SCENARIOS : [];
const recorded = <T,>(dataset: string, call: string, args: Record<string, unknown> = {}) =>
  JSON.parse(results[`${dataset}|${call}|${JSON.stringify(args)}`]) as T;

async function replay(scenario: Scenario, turns: ScriptTurn[]) {
  const model = scriptedModel(turns);
  uninstall = model.install();
  const result = await runScenario(scenario, {
    datasets,
    settings: { baseUrl: SCRIPTED_URL, model: "scripted", apiKey: "", temperature: 0 },
    tools: replayTools(results, scenario.dataset, CHAT_TOOLS),
    context: contexts[scenario.dataset],
  });
  return { result, model };
}

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
});

describe.runIf(fixture !== null)("held-out evals, replayed", () => {
  it("has a replay for every scenario, and a recording of every call", () => {
    expect(Object.keys(REPLAYS).sort()).toEqual(HELDOUT_SCENARIOS.map((s) => s.id).sort());
    for (const [dataset, calls] of Object.entries(HELDOUT_CALLS)) {
      for (const c of calls) expect(results[`${dataset}|${c.name}|${JSON.stringify(c.args)}`], `${dataset} ${c.name}`).toBeDefined();
    }
  });

  for (const scenario of scenarios) {
    it(`${scenario.id}: a good run passes on its first answer, a bad one is caught`, async () => {
      const r = REPLAYS[scenario.id];
      const good = await replay(scenario, r.good);
      const failing = good.result.grades.filter((g) => !g.pass);
      expect(failing, `${failing.map((g) => `${g.check}: ${g.detail}`).join("\n")}\n${transcript(good.result.run)}`).toEqual([]);
      expect(good.result.passed).toBe(true);
      expect(good.model.overrun()).toBe(0);
      expect(good.result.run.usage?.requests, `the answer checks sent the good answer back\n${transcript(good.result.run)}`).toBe(r.good.length);

      uninstall?.();
      const bad = await replay(scenario, r.bad);
      const caught = bad.result.grades.filter((g) => !g.pass).map((g) => g.check);
      expect(bad.result.passed).toBe(false);
      for (const name of r.catches) expect(caught, `${name}\n${transcript(bad.result.run)}`).toContain(name);
      if (r.flags) expect(bad.result.run.note ?? "", transcript(bad.result.run)).toMatch(r.flags);
      else expect(bad.result.run.note ?? "", "a bad run the answer checks do not flag").not.toMatch(/Not measured|Contradicts/);
    });
  }
});

// What the tools read on the held-out volumes, as recorded: these pin the
// recording the replays use. tests/test_faults.py runs the tools themselves
// (the UB fit, the coverage edge, the ring stage) on faults made live.
describe.runIf(fixture !== null)("the recorded tools, against the faults put in", () => {
  interface UbCheck {
    orientation_change_deg: number;
    rms_start: number;
    rms: number;
    unexplained: boolean;
  }

  it("ub_check measures the turn put into the UB, and none where there is none", () => {
    const turned = recorded<UbCheck>(HELDOUT.turned, "ub_check");
    expect(turned.orientation_change_deg).toBeCloseTo(TRUTH.misorientDeg, 1);
    expect(turned.rms).toBeLessThan(0.1 * turned.rms_start);
    const clean = recorded<UbCheck>(HELDOUT.clean, "ub_check");
    expect(clean.orientation_change_deg).toBeLessThan(0.05);
    expect(clean.unexplained).toBe(false);
  });

  it("ub_check says no UB explains a shifted origin", () => {
    const shifted = recorded<UbCheck>(HELDOUT.shifted, "ub_check");
    expect(shifted.orientation_change_deg).toBeLessThan(0.05);
    expect(shifted.unexplained).toBe(true);
  });

  it("qmax_coverage finds where the counts were cut", () => {
    const coverage = recorded<{ raw_counts: { q_max_edge: number } }>(HELDOUT.coverage, "qmax_coverage");
    expect(Math.abs(coverage.raw_counts.q_max_edge - TRUTH.coverageQMax)).toBeLessThan(0.05);
  });

  interface Rings {
    rings: {
      verdict: string;
      max_ring_left: number | null;
      shells_judged: { at: number; ring: boolean }[];
      per_plane: Record<string, { ring_residuals: { at: number; ring?: boolean }[] }>;
    };
  }
  const near = (at: number, q: number) => Math.abs(at - q) < 0.05;

  it("the ring check confirms the rings put in, in 3D, and sees them on every plane", () => {
    const rings = recorded<Rings>(HELDOUT.rings, "assess_stage", { stage: "rings" }).rings;
    for (const q of TRUTH.ringQ) {
      expect(rings.shells_judged.find((x) => near(x.at, q))?.ring, `${q} Å⁻¹`).toBe(true);
      for (const [plane, p] of Object.entries(rings.per_plane)) {
        expect(p.ring_residuals.find((x) => near(x.at, q))?.ring, `${q} Å⁻¹ on ${plane}`).toBe(true);
      }
    }
    // Only the rings put in: every other bump is the crystal's own.
    expect(rings.shells_judged.filter((x) => x.ring)).toHaveLength(TRUTH.ringQ.length);
  });

  // The clean volume has no ring. The crystal's own diffuse makes bumps on all
  // three planes (on a cubic crystal they are equivalent), which the two-plane
  // rule took for rings; none rises in nearly every direction in 3D.
  it("the ring check finds no ring on the clean volume", () => {
    const rings = recorded<Rings>(HELDOUT.clean, "assess_stage", { stage: "rings" }).rings;
    expect(rings.verdict).toBe(WORDS.label.pass);
    expect(rings.max_ring_left).toBe(0);
    expect(rings.shells_judged.length).toBeGreaterThan(0);
    expect(rings.shells_judged.some((x) => x.ring)).toBe(false);
  });
});
