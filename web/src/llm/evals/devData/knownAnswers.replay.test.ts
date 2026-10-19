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
//
// A check the grid is too coarse for gives no verdict: at the grids
// TOO_COARSE names it is held to "not judged", with the grid's reason.

import { describe, expect, it } from "vitest";

import { fetchRingDiagnostics } from "../../../api/client";
import type { AgentStep } from "../../agent";
import { withoutInference } from "../../inference";
import { verdicts } from "../../verdicts";
import { bridgeConfig } from "./bridgeWorker";
import { DEV_CASE_IDS, devCase, type DevCase, type DevCaseId, type ToolRunResult } from "./index";

const { n } = bridgeConfig();

const ANGLE_DEG = 0.15;
const COUNTS_SHELL = 0.1;
const SAME_Q = 0.1;

/**
 * The faults the tools miss, by case and check, with what they found instead:
 * each grid's own (81: the default; 161: the nightly run's). None now: the
 * misses at 81 (a false ring at 1.75 Å⁻¹, the shell at 2.9 Å⁻¹ never seen, and
 * fill biases on three cases' cuts) were the ring and texture checks judging a
 * grid too coarse for them, which they now say (TOO_COARSE).
 */
const MISSES: Partial<Record<DevCaseId, Record<string, Partial<Record<number, string>>>>> = {};

/**
 * The checks the grid is too coarse for, by grid: there each says "not
 * judged", with the grid's reason ("grid too coarse: …"), and gives no
 * verdict. The minimums are the checks' own (nebula3d.preprocessing.
 * ring_isotropy, Resolution; metrics/texture.ts, roomForRims, which the
 * fills' 3-D read applies to the volume's holes): on 81 points the dev crystal
 * (a = 3.9 Å, ±4 r.l.u.) puts 0.99 voxels across the widest ring the ring
 * check judges, under one, and its holes, reaching 2 to 3 voxels in 3-D, with
 * their rims need the nodes 12 to 14 voxels apart, where they are 10. On 161
 * points neither check is too coarse, and the known answers hold.
 */
type GridLimited = "rings" | "texture";
const TOO_COARSE: Record<GridLimited, readonly number[]> = { rings: [81], texture: [81] };
const tooCoarse = (which: GridLimited): boolean => TOO_COARSE[which].includes(n);

/** The case's check: expected to pass, or, where MISSES names it at this grid, to fail. */
function check(id: DevCaseId, name: string, body: () => Promise<void>): void {
  const miss = MISSES[id]?.[name]?.[n];
  if (miss) it.fails(`${name} [a known miss: ${miss}]`, body);
  else it(name, body);
}

/** A check's name, and at a grid too coarse for it what the test then holds it to. */
const named = (which: GridLimited, name: string): string => (tooCoarse(which) ? `${name} [at n=${n}: not judged, the grid too coarse]` : name);

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

/** The ring check on a grid too coarse for it: not judged, the grid's reason given, no shell judged. */
function expectRingsNotJudged(c: DevCase, r: ToolRunResult): void {
  const rings = r.result.rings as Record<string, unknown>;
  const [outcome] = outcomeOf(r);
  const msg = evidence(c, { verdict: rings.verdict, ring_rule: rings.ring_rule, shells_judged: rings.shells_judged, outcome });
  expect(rings.verdict, msg).toBe("not judged");
  const why = /^not judged: grid too coarse: ([\d.]+) voxels across a ring's width \(at most [\d.]+ Å⁻¹\), under ([\d.]+)$/.exec(String(rings.ring_rule));
  expect(why, msg).not.toBeNull();
  expect(Number(why![1]), msg).toBeLessThan(Number(why![2]));
  expect([rings.max_ring_left, rings.max_ring_dent, rings.shells_judged], msg).toEqual([null, null, undefined]);
  expect(outcome, msg).toMatchObject({ kind: "info", reasons: ["grid too coarse"] });
}

/** A known answer of the ring check, read from the shells it judged; on a grid too coarse for it, "not judged" with the reason instead. */
function ringCheck(id: DevCaseId, name: string, known: (c: DevCase, shells: Shell[], rings: Record<string, unknown>) => void): void {
  check(id, named("rings", name), async () => {
    const c = devCase(id);
    const r = ran(await c.tool("assess_stage", { stage: "rings" }), "assess_stage rings");
    if (tooCoarse("rings")) return expectRingsNotJudged(c, r);
    const rings = r.result.rings as Record<string, unknown>;
    known(c, (rings.shells_judged as Shell[] | undefined) ?? [], rings);
  });
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

  // The verdict on the run, {{achieved}}, from the checks a reply ran: met, or
  // on a grid too coarse for the ring check not judged, saying why (G1), and
  // likewise on one too coarse for the fills' texture (plan 4.2).
  check("dev-control", named("rings", "the verdict on the run is met, or says why the ring removal and the fills' texture are not judged"), async () => {
    const c = devCase("dev-control");
    const steps: AgentStep[] = [];
    for (const [name, args] of [
      ["assess_stage", { stage: "all" }],
      ["qmax_coverage", {}],
      ["texture_check", {}],
      ["symmetry_check", {}],
    ] as const) {
      const r = ran(await c.tool(name, args), name);
      steps.push({ id: name, name, args, status: "done", result: JSON.stringify(r.result), outcomes: r.outcomes });
    }
    const v = verdicts({ reply: steps }).achieved;
    const msg = evidence(c, { achieved: v });
    const notJudged = [
      ...(tooCoarse("rings") ? ["the ring removal (grid too coarse for the ring check)"] : []),
      ...(tooCoarse("texture") ? ["the backfill's texture (grid too coarse)"] : []),
    ];
    expect(v?.text, msg).toBe(notJudged.length ? `not judged: ${notJudged.join(", ")}` : "met: every stage meets its goal");
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
    ringCheck(id, "every planted ring judged a powder ring", (c, shells, rings) => {
      const msg = evidence(c, { shells_judged: shells, verdict: rings.verdict });
      for (const q of c.truth.ring_q!) expect(shells.some((s) => s.ring && near(q)(s)), `${msg} (no ring at ${q})`).toBe(true);
    });

    ringCheck(id, "no ring where none was planted", (c, shells) => {
      const extra = shells.filter((s) => s.ring && !c.truth.ring_q!.some((q) => near(q)(s)));
      const msg = evidence(c, { shells_judged: shells, rings_not_planted: extra });
      expect(extra, msg).toEqual([]);
    });
  });
}

// The ring removal's notice (G1): on a grid too coarse to confirm a ring, the
// removal subtracts none of the ring candidates it detected (powder rings or
// the crystal's own scattering) and says so out loud, with how many, what the
// grid needs and the two ways out, in its run log line, its record (the
// diagnostics) and the ring check's result; arm C reads it without the remedy.
// On a grid fine enough it leaves no ring unconfirmed, and says nothing of the
// kind. The planted rings are among those it detected. Its words, for more
// than one candidate (the count in group 1) and for one (group 2):
const NEEDS_AND_WAYS = String.raw` detected but not confirmed at this grid \(needs ≥ 1 voxel across 0\.16 Å⁻¹\); not subtracted\. Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract`;
const NOTICE = new RegExp(
  String.raw`^(?:(\d+) ring candidates \(shells that may be powder rings or the crystal's own scattering\)${NEEDS_AND_WAYS} every candidate, the crystal's own shells included\.` +
    String.raw`|(1) ring candidate \(a shell that may be a powder ring or the crystal's own scattering\)${NEEDS_AND_WAYS} it, even if it is the crystal's own shell\.)$`,
);

for (const id of ["dev-rings", "dev-rings-shell"] as const) {
  describe(`${id}: the rings the removal could not confirm, said out loud`, () => {
    const name = tooCoarse("rings")
      ? `the ring removal says how many rings it left unconfirmed at n=${n}, the planted ones among them, in its log, its record and the ring check`
      : `the ring removal leaves no ring unconfirmed at n=${n}, and says nothing of the kind`;
    check(id, name, async () => {
      const c = devCase(id);
      const log = ran(await c.tool("run_log", { stage: "rings" }), "run_log");
      const done = (log.result.lines as { status: string; message: string }[]).filter((l) => l.status === "done").pop()?.message ?? "";
      const rings = ran(await c.tool("assess_stage", { stage: "rings" }), "assess_stage rings").result.rings as Record<string, unknown>;
      const left = (await fetchRingDiagnostics((await c.dataset()).id)).unconfirmed_at_grid;
      const msg = evidence(c, { ring_log: done, notice: rings.notice ?? null, unconfirmed_at_grid: left });
      if (!tooCoarse("rings")) {
        expect(done, msg).toMatch(/^pooled ring removal /);
        expect(done, msg).not.toContain("⚠");
        expect(rings, msg).not.toHaveProperty("notice");
        expect(left, msg).toBeNull();
        return;
      }
      const notice = done.split(". ⚠ ")[1] ?? "";
      const said = NOTICE.exec(notice);
      expect(said, msg).not.toBeNull();
      const count = Number(said![1] ?? said![2]);
      if (said![1] !== undefined) expect(count, msg).toBeGreaterThan(1); // "1 ring candidate" is said in the singular
      expect(rings.notice, msg).toBe(notice);
      expect(left, msg).toMatchObject({ count, needs: "1 voxel across 0.16 Å⁻¹", notice });
      expect(left!.q_centers.length, msg).toBe(left!.count);
      for (const q of c.truth.ring_q!) expect(left!.q_centers.some((x) => Math.abs(x - q) <= SAME_Q), `${msg} (no ${q} among them)`).toBe(true);
      // Arm C reads the notice without its remedy, in the ring check's result and the run log.
      const definition = notice.slice(0, notice.indexOf(" Use a finer grid"));
      expect((withoutInference(rings) as Record<string, unknown>).notice, msg).toBe(definition);
      expect(withoutInference(done), msg).toBe(done.replace(notice, definition));
    });
  });
}

for (const id of ["dev-shell", "dev-rings-shell"] as const) {
  describe(`${id}: the crystal's shell is its own`, () => {
    ringCheck(id, "the shell never judged a powder ring", (c, shells) => {
      const msg = evidence(c, { shells_judged: shells });
      expect(shells.filter((s) => s.ring && near(c.truth.shell_q!)(s)), msg).toEqual([]);
    });

    ringCheck(id, "the shell seen, as the crystal's own", (c, shells) => {
      const msg = evidence(c, { shells_judged: shells });
      expect(shells.some((s) => !s.ring && near(c.truth.shell_q!)(s)), msg).toBe(true);
    });
  });
}

// The fills' texture (texture_check): the default backfill prints no fill bias
// of its own over the punch's holes, every one judged in 3-D with its rim
// (plan 4.2). On a grid too coarse to leave the holes room for their rims the
// check is not judged, says why, and measures no bias. At 81 points, before
// that rule (#60), the cuts read a false bias on three of these cases
// (dev-origin, dev-rings, dev-shell), and the 3-D read, past it, would read
// one on six: the rule, not the 3-D read, keeps them from a verdict.
for (const id of DEV_CASE_IDS) {
  describe(`${id}: the fills leave no texture`, () => {
    check(id, named("texture", "texture_check finds no systematic fill bias over the holes in 3-D"), async () => {
      const c = devCase(id);
      const r = ran(await c.tool("texture_check"), "texture_check");
      const fills = r.result;
      const [outcome] = outcomeOf(r);
      const { per_cut: cuts, ...shown } = fills;
      const msg = evidence(c, { fills: shown, per_cut: cuts, outcome });
      expect(fills.systematic_fill_bias, msg).not.toBe(true);
      // The cuts carry the azimuthal texture only.
      for (const x of cuts as Record<string, unknown>[]) expect(Object.keys(x), msg).toEqual(["cut", "azimuthal_ratio"]);
      if (tooCoarse("texture")) {
        expect(outcome, msg).toMatchObject({ kind: "info", reasons: ["grid too coarse"] });
        const why = /^grid too coarse: the nodes are ([\d.]+) voxels apart, under ([\d.]+): a hole reaches [\d.]+ voxels? and its rim \d+ more$/.exec(String(fills.not_judged));
        expect(why, msg).not.toBeNull();
        expect(Number(why![1]), msg).toBeLessThan(Number(why![2]));
        expect([fills.systematic_fill_bias, fills.median_fill_bias_sigma, fills.median_fill_bias_level], msg).toEqual([null, null, null]);
      } else {
        expect(outcome, msg).toMatchObject({ kind: "pass", reasons: [] });
        expect(fills, msg).not.toHaveProperty("not_judged");
        expect(fills.systematic_fill_bias, msg).toBe(false);
        expect(fills.n_judged, msg).toBeGreaterThan(0);
      }
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
