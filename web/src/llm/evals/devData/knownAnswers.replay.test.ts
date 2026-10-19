// Known answers: each dev case's planted fault, found by the real tools and
// their rules on the case built where the tests run (devData), against the
// case's truth (the validation's manifest). The tools, the verdict rules and
// the pipeline are the app's own; nothing is recorded.
//
// The tolerances are the validation's own where it has one, else the tools':
// - a turn of the UB within 0.15° of the planted one (the validation's grader,
//   evals/validation.ts, for the same angle);
// - an origin shift within half the smallest planted component of it, so the
//   direction and the size are both found;
// - the counts' edge within one shell (0.1 Å⁻¹) of the planted cut: the
//   coverage measures the edge to one shell (qmax_coverage);
// - a ring or shell within 0.1 Å⁻¹ of the planted |Q|: the match radius of the
//   ring check (tune/evaluate.ts) and of arm A (nebula3d.validation.arm_a).
//
// A fault the tools miss is a finding about the tools, not a test to tune:
// MISSES names each, per grid, and the test is then expected to fail
// (it.fails), with the evidence printed beside it. When the tools improve, the
// expected failure passes, fails the run, and its entry goes.

import { describe, expect, it } from "vitest";

import { bridgeConfig } from "./bridgeWorker";
import { devCase, type DevCase, type DevCaseId, type ToolRunResult } from "./index";

const { n } = bridgeConfig();

const ANGLE_DEG = 0.15;
const COUNTS_SHELL = 0.1;
const SAME_Q = 0.1;

/**
 * The faults the tools miss, by case and check, with what they found instead:
 * each grid's own (81: the default; 161: the nightly run's).
 */
const MISSES: Partial<Record<DevCaseId, Record<string, Partial<Record<number, string>>>>> = {
  "dev-rings": {
    "no ring where none was planted": {
      81: "at n=81 the ring check also judges a bump at 1.75 Å⁻¹ a powder ring (isotropy 0.68), where none was planted; at n=161 it judges it the crystal's own",
    },
  },
  "dev-shell": {
    "the shell seen, as the crystal's own": {
      81: "at n=81 no principal plane shows the planted shell at 2.9 Å⁻¹ as a significant bump, so the ring check never judges it (at n=161 it does: ring false)",
    },
  },
  "dev-rings-shell": {
    "no ring where none was planted": {
      81: "at n=81 the ring check also judges a bump at 1.75 Å⁻¹ a powder ring (isotropy 0.63), where none was planted; at n=161 it judges it the crystal's own",
    },
    "the shell seen, as the crystal's own": {
      81: "at n=81 no principal plane shows the planted shell at 2.9 Å⁻¹ as a significant bump, so the ring check never judges it (at n=161 it does: ring false)",
    },
  },
};

/** The case's check: expected to pass, or, where MISSES names it at this grid, to fail. */
function check(id: DevCaseId, name: string, body: () => Promise<void>): void {
  const miss = MISSES[id]?.[name]?.[n];
  if (miss) it.fails(`${name} [a known miss: ${miss}]`, body);
  else it(name, body);
}

/** What the tools found, beside the truth: printed, and the assertions' message. */
function evidence(c: DevCase, found: Record<string, unknown>): string {
  const line = `${c.id} at n=${n}: found ${JSON.stringify(found)}; truth ${JSON.stringify(c.truth)}`;
  console.log(line);
  return line;
}

const ran = (r: ToolRunResult, name: string): ToolRunResult => {
  expect(r.ok, `${name}: ${r.summary}`).toBe(true);
  return r;
};

const outcomeOf = (r: ToolRunResult) => r.outcomes.map((o) => ({ check: o.check, kind: o.kind, reasons: o.reasons, dataProblems: o.dataProblems }));

interface Shell {
  at: number;
  ring: boolean;
  isotropy?: number;
  not_judged?: string;
}

async function shellsJudged(c: DevCase): Promise<{ shells: Shell[]; rings: Record<string, unknown> }> {
  const r = ran(await c.tool("assess_stage", { stage: "rings" }), "assess_stage rings");
  const rings = r.result.rings as Record<string, unknown>;
  return { shells: (rings.shells_judged as Shell[] | undefined) ?? [], rings };
}

const near = (q: number) => (s: Shell) => Math.abs(s.at - q) <= SAME_Q;

describe("dev-control: nothing flagged", () => {
  check("dev-control", "no check needs attention, and the data show no problem", async () => {
    const c = devCase("dev-control");
    const results: Record<string, ToolRunResult> = {};
    for (const [name, args] of [
      ["assess_stage", { stage: "all" }],
      ["ub_check", {}],
      ["qmax_coverage", {}],
      ["texture_check", {}],
      ["grain_check", {}],
      ["symmetry_check", {}],
    ] as const) {
      results[name] = ran(await c.tool(name, args), name);
    }
    const outcomes = Object.values(results).flatMap(outcomeOf);
    const flagged = outcomes.filter((o) => o.kind === "attention");
    const problems = outcomes.flatMap((o) => o.dataProblems);
    const msg = evidence(c, { flagged, problems, kinds: outcomes.map((o) => `${o.check}: ${o.kind}`) });
    expect(flagged, msg).toEqual([]);
    expect(problems, msg).toEqual([]);
  });
});

describe("dev-ub: the turn is found", () => {
  check("dev-ub", "ub_check turns the UB by the planted angle, and judges it turned", async () => {
    const c = devCase("dev-ub");
    const ub = ran(await c.tool("ub_check"), "ub_check");
    const angle = ub.result.orientation_change_deg as number;
    const [outcome] = outcomeOf(ub);
    const msg = evidence(c, { orientation_change_deg: angle, axis_uvw: ub.result.axis_uvw, rms_start: ub.result.rms_start, rms: ub.result.rms, outcome });
    expect(Math.abs(angle - c.truth.angle_deg!), msg).toBeLessThanOrEqual(ANGLE_DEG);
    expect(outcome.reasons, msg).toContain("UB turned");
    expect(outcome.dataProblems, msg).toContain(`the UB is turned by ${angle}°`);
  });
});

describe("dev-origin: the shift is found", () => {
  check("dev-origin", "ub_check finds the HKL origin shifted by the planted vector", async () => {
    const c = devCase("dev-origin");
    const ub = ran(await c.tool("ub_check"), "ub_check");
    const shift = ub.result.origin_shift_rlu as number[] | null;
    const [outcome] = outcomeOf(ub);
    const planted = c.truth.offset_rlu!;
    const tol = Math.min(...planted.filter((x) => x !== 0).map(Math.abs)) / 2;
    const msg = evidence(c, { origin_shift_rlu: shift, mean_offset_rlu: ub.result.mean_offset_rlu, rms_start: ub.result.rms_start, rms: ub.result.rms, tolerance: tol, outcome });
    expect(shift, msg).not.toBeNull();
    shift!.forEach((x, i) => expect(Math.abs(x - planted[i]), msg).toBeLessThanOrEqual(tol));
    expect(outcome.dataProblems, msg).toContain(`the HKL origin is shifted by (${shift!.join(", ")}) r.l.u.`);
  });
});

describe("dev-coverage: the counts end inside the box", () => {
  check("dev-coverage", "qmax_coverage puts the counts' edge within a shell of the planted cut", async () => {
    const c = devCase("dev-coverage");
    const cov = ran(await c.tool("qmax_coverage"), "qmax_coverage");
    const counts = cov.result.raw_counts as { q_max_edge: number | null; box_face_q: number };
    const [outcome] = outcomeOf(cov);
    const msg = evidence(c, { counts_end_inside_box: cov.result.counts_end_inside_box, raw_counts: counts, suggested_band: cov.result.suggested_band, outcome });
    expect(cov.result.counts_end_inside_box, msg).toBe(true);
    expect(Math.abs(counts.q_max_edge! - c.truth.q_cut!), msg).toBeLessThanOrEqual(COUNTS_SHELL);
    expect(outcome.dataProblems, msg).toContain(`the counts end at ${counts.q_max_edge} Å⁻¹, inside the box`);
  });
});

// The rings and the crystal's own shell: the ring check (assess_stage rings)
// judges each bump the principal planes show in 3D on the raw volume, a
// powder ring only if it rises in nearly every direction (shells_judged).
for (const id of ["dev-rings", "dev-rings-shell"] as const) {
  describe(`${id}: the powder rings are found`, () => {
    check(id, "every planted ring judged a powder ring", async () => {
      const c = devCase(id);
      const { shells, rings } = await shellsJudged(c);
      const msg = evidence(c, { shells_judged: shells, verdict: rings.verdict });
      for (const q of c.truth.ring_q!) expect(shells.some((s) => s.ring && near(q)(s)), `${msg} (no ring at ${q})`).toBe(true);
    });

    check(id, "no ring where none was planted", async () => {
      const c = devCase(id);
      const { shells } = await shellsJudged(c);
      const extra = shells.filter((s) => s.ring && !c.truth.ring_q!.some((q) => near(q)(s)));
      const msg = evidence(c, { shells_judged: shells, rings_not_planted: extra });
      expect(extra, msg).toEqual([]);
    });
  });
}

for (const id of ["dev-shell", "dev-rings-shell"] as const) {
  describe(`${id}: the crystal's shell is its own`, () => {
    check(id, "the shell never judged a powder ring", async () => {
      const c = devCase(id);
      const { shells } = await shellsJudged(c);
      const msg = evidence(c, { shells_judged: shells });
      expect(shells.filter((s) => s.ring && near(c.truth.shell_q!)(s)), msg).toEqual([]);
    });

    check(id, "the shell seen, as the crystal's own", async () => {
      const c = devCase(id);
      const { shells } = await shellsJudged(c);
      const msg = evidence(c, { shells_judged: shells });
      expect(shells.some((s) => !s.ring && near(c.truth.shell_q!)(s)), msg).toBe(true);
    });
  });
}

describe("dev-flatten: the pedestal is found, and the Q² term takes it out", () => {
  check("dev-flatten", "a pedestal, then none with the Q² term on and the flatten rerun", async () => {
    const c = devCase("dev-flatten");
    const flatten = async () => {
      const r = ran(await c.tool("assess_stage", { stage: "flatten" }), "assess_stage flatten");
      const f = r.result.flatten as Record<string, unknown>;
      return { pedestal_left: f.pedestal_left, trend: f.max_floor_trend, span: f.max_floor_span_fraction, verdict: f.verdict, outcome: outcomeOf(r)[0] };
    };
    const before = await flatten();
    ran(await c.tool("update_settings", { changes: { flattenQ2: true } }), "update_settings");
    const rerun = ran(await c.tool("run_pipeline", { from_stage: "flatten" }), "run_pipeline");
    const after = await flatten();
    const msg = evidence(c, { before, rerun: rerun.result.stages, after });
    expect(before.pedestal_left, msg).toBe(true);
    expect(before.outcome.reasons, msg).toEqual(["pedestal"]);
    expect(rerun.result.stages, msg).toMatchObject({ flatten: "computed" });
    expect(after.pedestal_left, msg).toBe(false);
    expect(after.outcome.kind, msg).toBe("pass");
  });
});
