// Measures one stage's output for the tuning run: that stage's metrics on the
// three principal planes through the origin (plus the volume-wide records the
// stage writes), so a trial is judged on more than one cut.  The numbers are
// the same pure metrics the chat context uses.

import { fetchBraggProfile, fetchConsistencyCheck, fetchDpdfMeta, fetchMeta, fetchRingDiagnostics, fetchRingIsotropy } from "../../api/client";
import type { Dataset } from "../../api/types";
import { dpdfVolumeId, loadPipelineContext, safe, hklVolumeId, type Cut } from "../context/loadContext";
import { OPEN_WEIGHT_OK } from "../metrics/coverage";
import { pedestalLeft } from "../metrics/flatten";
import { roundSig } from "../metrics/sliceStats";
import { sectionSymmetry, type SectionSymmetry } from "../metrics/symmetry";
import { judge, shownWeight, UNROUNDED, WEIGHT_FIGURES, type Unrounded } from "../verdicts/rules";
import type { TuneStage } from "./catalog";

const RECIP_CUTS: Cut[] = [
  { plane: "hk0", value: 0 },
  { plane: "h0l", value: 0 },
  { plane: "0kl", value: 0 },
];
const DPDF_CUTS: Cut[] = [
  { plane: "xy", value: 0 },
  { plane: "xz", value: 0 },
  { plane: "yz", value: 0 },
];

// A stage's numbers, as the tools and the tuning show them; the ΔPDF's keeps
// its window's raw weight beside the shown one (UNROUNDED, which JSON never
// writes), for the ΔPDF's rule.
export type StageEvaluation = Record<string, unknown> & { [UNROUNDED]?: Unrounded };

// Bumps within this |Q| (Å⁻¹) on the planes are one shell, judged once.
const RING_MATCH_Q = 0.1;

/** The planes' bumps as shells: those within RING_MATCH_Q of the first of a run are one. */
function shellsOf(bumps: { at: number; fwhm?: number }[]): { q: number; fwhm: number; members: number[] }[] {
  const order = bumps.map((_b, i) => i).sort((i, j) => bumps[i].at - bumps[j].at);
  const shells: { q: number; fwhm: number; members: number[] }[] = [];
  for (const i of order) {
    const last = shells[shells.length - 1];
    if (last && bumps[i].at - bumps[last.members[0]].at <= RING_MATCH_Q) last.members.push(i);
    else shells.push({ q: 0, fwhm: 0, members: [i] });
  }
  for (const sh of shells) {
    sh.q = sh.members.reduce((t, i) => t + bumps[i].at, 0) / sh.members.length;
    sh.fwhm = Math.max(...sh.members.map((i) => bumps[i].fwhm ?? 0), 0.02);
  }
  return shells;
}

// Fraction of the voxels measured before the punch that the punch removed.
function punchedFraction(before: Float32Array | undefined, after: Float32Array | undefined): number | null {
  if (!before || !after || before.length !== after.length) return null;
  let measured = 0;
  let punched = 0;
  for (let i = 0; i < before.length; i++) {
    if (!Number.isFinite(before[i])) continue;
    measured += 1;
    if (!Number.isFinite(after[i])) punched += 1;
  }
  return measured ? roundSig(punched / measured) : null;
}

const mean = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? roundSig(v.reduce((s, x) => s + x, 0) / v.length) : null;
};
const max = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? roundSig(Math.max(...v)) : null;
};

export async function evaluateStage(stage: TuneStage, dataset: Dataset): Promise<StageEvaluation> {
  if (stage === "pdf") {
    const dId = dpdfVolumeId(dataset);
    const rawId = hklVolumeId(dataset);
    const [check, dmeta, rawMeta, ...sections] = await Promise.all([
      safe(fetchConsistencyCheck(dataset.id)),
      dId ? safe(fetchDpdfMeta(dId)) : Promise.resolve(null),
      rawId ? safe(fetchMeta(rawId)) : Promise.resolve(null),
      ...DPDF_CUTS.map((dpdf) => loadPipelineContext(dataset, { recip: null, dpdf, records: false })),
    ]);
    // The x–y section through the origin against its images under the cell's
    // in-plane operations (symmetry_check's numbers): the worst one.
    const xy = sections[0];
    const cell = xy?.lattice;
    const sym = xy?.slices.dpdf && cell?.a && cell?.b ? sectionSymmetry(xy.slices.dpdf, { a: cell.a, b: cell.b }) : null;
    const worstOp = (sym?.ops ?? []).reduce<SectionSymmetry | null>((w, o) => (!w || o.rms_difference > w.rms_difference ? o : w), null);
    const perPlane = Object.fromEntries(
      sections.map((s, i) => {
        const d = s.context.delta_pdf;
        return [
          DPDF_CUTS[i].plane,
          d && {
            feature_snr: d.feature_snr,
            strong_feature_fraction: d.strong_feature_fraction,
            positive_fraction: d.positive_fraction,
            anisotropy_ratio: d.anisotropy_ratio,
          },
        ];
      }),
    );
    const m = check?.has_check ? check.metrics : null;
    const open = dmeta?.window_open_weight;
    return {
      back_fft_pearson_r: m ? roundSig(m.pearson_r, 5) : null,
      back_fft_normalized_rms: m ? roundSig(m.normalized_rms, 4) : null,
      // Against the data's even part, which the real transform keeps (the
      // verdict's r): 1 when the transform is sound. The odd share is what r
      // against the data loses to counting noise on unsymmetrised data.
      back_fft_pearson_r_even: m?.pearson_r_even != null ? roundSig(m.pearson_r_even, 6) : null,
      back_fft_odd_share: m?.odd_share != null ? roundSig(m.odd_share, 3) : null,
      back_fft_per_plane_r: m?.per_plane_r ?? null,
      mean_feature_snr: mean(Object.values(perPlane).map((p) => p?.feature_snr)),
      // The share of the window's weight on unmeasured reciprocal space
      // (qmax_coverage's verdict), shown to three figures, and the window's shape.
      window_weight_on_unmeasured: typeof open === "number" ? roundSig(open, WEIGHT_FIGURES) : null,
      window_shape: dmeta?.window_shape ?? null,
      max_symmetry_break: worstOp ? worstOp.rms_difference : null,
      worst_symmetry_op: worstOp?.op ?? null,
      // Whether the file declares a symmetry its data were symmetrised with.
      // Without one the section's asymmetry is the data's own (counting noise
      // included), not a stage's break; null when the volume was not read.
      symmetry_declared: rawMeta ? Boolean(rawMeta.symmetry) : null,
      per_plane: perPlane,
      [UNROUNDED]: { window_weight_on_unmeasured: typeof open === "number" ? open : null },
    };
  }

  // Cuts outside the grid (an L range not containing 0) are skipped.
  const metaId = hklVolumeId(dataset);
  const meta = metaId ? await safe(fetchMeta(metaId)) : null;
  const ranges = meta ? [meta.h_range, meta.k_range, meta.l_range] : null;
  const fixed: Record<string, number> = { hk0: 2, h0l: 1, "0kl": 0 };
  const cuts = RECIP_CUTS.filter((c) => {
    const r = ranges?.[fixed[c.plane]];
    return !r || (c.value >= r[0] && c.value <= r[1]);
  });
  // Every leftover peak, marked, not only the strongest few the chat's context lists: the punch counts them by their marks.
  const contexts = await Promise.all(cuts.map((recip) => loadPipelineContext(dataset, { recip, dpdf: null, records: false, allLeftovers: true })));
  const per = (f: (i: number) => unknown) => Object.fromEntries(cuts.map((c, i) => [c.plane, f(i)]));

  if (stage === "rings") {
    const r = contexts.map((c) => c.context.ring_removal);
    const all = cuts.flatMap((c, i) => (r[i]?.ring_residuals ?? []).map((x) => ({ plane: c.plane, ...x })));
    const planesMeasured = r.filter((x) => x?.ring_residuals).length;
    // A powder ring rises at its |Q| in nearly every direction over the sphere;
    // the crystal's own scattering there (short-range order, thermal diffuse,
    // the Bragg nodes) rises in some directions only. The three planes cannot
    // tell them apart where symmetry makes them equivalent (all three on a cubic
    // cell; h0l and 0kl on a hexagonal or tetragonal one), so every bump is
    // judged in 3D on the raw volume, and only confirmed rings count.
    const shells = shellsOf(all);
    // The 3D test of each bump, and the grid's own limit, asked with no bump
    // too: on a grid too coarse for the test (too few voxels across a ring's
    // width, nebula3d.preprocessing.ring_isotropy), the planes' bumps, or
    // their absence, are no evidence either, and the rings are not judged.
    // And what the ring removal recorded of the rings it detected and could not
    // confirm on its grid, which it did not subtract: its notice, said first.
    const [tested, record] = await Promise.all([
      metaId ? safe(fetchRingIsotropy(metaId, shells)) : Promise.resolve(null),
      safe(fetchRingDiagnostics(dataset.id)),
    ]);
    const notice = record?.unconfirmed_at_grid?.notice ?? null;
    const tooCoarse = typeof tested?.not_judged === "string" ? tested.not_judged : null;
    const judged = shells.length && !tooCoarse ? (tested ?? null) : null;
    const shellOf = new Map<number, number>();
    shells.forEach((sh, k) => sh.members.forEach((i) => shellOf.set(i, k)));
    const verdictOf = (i: number) => judged?.shells[shellOf.get(i) ?? -1] ?? null;
    const isRing = (i: number) => verdictOf(i)?.is_ring === true;
    const unjudged = (shells.length > 0 && !judged) || tooCoarse !== null;
    const rings = all.map((x, i) => ({ x, i })).filter(({ x, i }) => x.significant && isRing(i)).map(({ x }) => x);
    const worstOf = <T extends { at: number; residual_fraction: number }>(xs: T[], sign: 1 | -1) =>
      xs.reduce<T | null>(
        (best, x) =>
          sign * x.residual_fraction > 0 && (!best || sign * x.residual_fraction > sign * best.residual_fraction) ? x : best,
        null,
      );
    const worst = (sign: 1 | -1) => {
      const x = worstOf(rings, sign);
      return x && { plane: x.plane, at: x.at, residual_fraction: x.residual_fraction };
    };
    const dent = worst(-1);
    const left = worst(1);
    // Each plane's residuals marked ring or not, its extremes picked among the
    // rings alone, so the plane agrees with the totals.
    let offset = 0;
    const planeResiduals = cuts.map((_c, i) => {
      const xs = r[i]?.ring_residuals ?? null;
      const start = offset;
      offset += xs?.length ?? 0;
      // The width went to the 3D test; the residual reads without it. Judged,
      // a bump neither significant nor a ring is noise, and left out.
      return (
        xs?.flatMap((residual, k) => {
          const { fwhm, ...x } = residual;
          void fwhm;
          if (!judged) return [x];
          const ring = isRing(start + k);
          return ring || x.significant ? [{ ...x, ring }] : [];
        }) ?? null
      );
    });
    const planeWorst = (xs: (typeof planeResiduals)[number], sign: 1 | -1) =>
      worstOf((xs ?? []).filter((x) => x.significant && "ring" in x && x.ring), sign);
    const rule = judged?.rule;
    return {
      // The rings the removal left unsubtracted, unconfirmed on its grid, said out
      // loud (verdicts/rules.ts, RING_NOTICE_REMEDY: arm C reads it without its remedy).
      ...(notice ? { notice } : {}),
      mean_ring_energy_ratio: mean(r.map((x) => x?.ring_energy_ratio)),
      max_over_subtraction_fraction: max(r.map((x) => x?.over_subtraction_fraction)),
      // The deepest dent and largest leftover at the confirmed rings, over the
      // planes; not judged when the 3D test could not run, or the grid is too
      // coarse for it.
      max_ring_dent: planesMeasured && !unjudged ? roundSig(dent ? -dent.residual_fraction : 0) : null,
      max_ring_left: planesMeasured && !unjudged ? roundSig(left ? left.residual_fraction : 0) : null,
      worst_ring_dent: dent,
      worst_ring_left: left,
      // Each shell the planes' bumps make, judged in 3D: a ring rises by at least
      // height_share of its median height in direction_share of the directions
      // (isotropy: the height there over the median); the others are the
      // crystal's own scattering, which the removal must leave.
      ...(unjudged
        ? { ring_rule: `not judged: ${tooCoarse ?? "the test of each bump in 3D could not run"}` }
        : {
            ring_rule: { direction_share: rule?.direction_share ?? null, height_share: rule?.height_share ?? null },
            // The rings, and the bumps significant on some plane (the rest are noise).
            shells_judged: shells.flatMap((sh, k) => {
              const v = judged?.shells[k];
              if (!v?.is_ring && !sh.members.some((i) => all[i].significant)) return [];
              return [{
                at: roundSig(sh.q, 3),
                ring: v?.is_ring ?? false,
                ...(v?.isotropy != null ? { isotropy: roundSig(v.isotropy, 2) } : {}),
                ...(v?.not_judged ? { not_judged: v.not_judged } : {}),
              }];
            }),
          }),
      per_plane: per((i) => {
        const residuals = planeResiduals[i];
        return r[i] && {
          ring_energy_ratio: r[i]!.ring_energy_ratio,
          after_ring_energy: r[i]!.after_ring_energy,
          over_subtraction_fraction: r[i]!.over_subtraction_fraction,
          after_negative_fraction: r[i]!.after_negative_fraction,
          worst_ring_dent: planeWorst(residuals, -1),
          worst_ring_left: planeWorst(residuals, 1),
          ring_residuals: residuals,
        };
      }),
    };
  }
  if (stage === "punch") {
    const rawId = hklVolumeId(dataset);
    const [profile, rawMeta] = await Promise.all([
      safe(fetchBraggProfile(dataset.id)),
      rawId ? safe(fetchMeta(rawId)) : null,
    ]);
    const leftovers = contexts.map((c) => c.context.bragg_punch?.leftover);
    const fractions = contexts.map((c) =>
      punchedFraction(c.slices.ringremoved?.data, c.slices.braggpunched?.data),
    );
    const total = (key: "n_suspicious" | "n_at_nodes" | "n_off_nodes" | "n_on_protected" | "n_broad_off_nodes" | "n_skipped_noisy") =>
      leftovers.reduce((s, l) => s + (l?.[key] ?? 0), 0);
    // The sharp off-lattice leftovers on the protected H planes, from each peak's marks: they stay by design.
    const sharpOnProtected = leftovers.reduce((s, l) => s + (l?.suspicious_peaks ?? []).filter((p) => p.on_protected_plane === true && !p.broad).length, 0);
    // The strongest leftover over the planes, with its plane.
    const strongest = cuts.reduce<Record<string, unknown> | null>((best, c, i) => {
      const p = leftovers[i]?.suspicious_peaks[0];
      return p && (!best || p.sigma > (best.sigma as number)) ? { plane: c.plane, ...p } : best;
    }, null);
    return {
      // The significance test counts σ: say so when σ is √|I| of normalized data.
      ...(rawMeta?.sigma_note ? { sigma_note: rawMeta.sigma_note } : {}),
      total_leftover_peaks: total("n_suspicious"),
      leftover_at_nodes: total("n_at_nodes"),
      leftover_off_lattice: total("n_off_nodes"),
      // Of those, on the H planes the search leaves alone (protected satellites),
      // and broad enough to be diffuse maxima rather than reflections.
      leftover_on_protected_planes: total("n_on_protected"),
      // The sharp ones of those, on their own line: by design, as the punch's goal says, and out of its verdict (verdicts/rules.ts, D5).
      leftover_on_protected_planes_sharp: sharpOnProtected,
      leftover_off_lattice_broad: total("n_broad_off_nodes"),
      leftover_off_lattice_sharp: total("n_off_nodes") - total("n_broad_off_nodes"),
      strongest_leftover: strongest,
      noisy_spikes_skipped: total("n_skipped_noisy"),
      mean_punched_fraction: mean(fractions),
      fitted_peaks: profile?.has_profile ? profile.n_peaks : null,
      per_plane: per((i) => ({
        leftover_peaks: leftovers[i]?.n_suspicious ?? null,
        at_nodes: leftovers[i]?.n_at_nodes ?? null,
        off_lattice: leftovers[i]?.n_off_nodes ?? null,
        on_protected_planes: leftovers[i]?.n_on_protected ?? null,
        off_lattice_broad: leftovers[i]?.n_broad_off_nodes ?? null,
        strongest_leftover: leftovers[i]?.suspicious_peaks[0] ?? null,
        punched_fraction: fractions[i],
      })),
    };
  }
  if (stage === "backfill") {
    const b = contexts.map((c) => c.context.backfill);
    return {
      mean_median_seam_sigma: mean(b.map((x) => x?.median_seam_sigma)),
      max_bright_fill_fraction: max(b.map((x) => x?.bright_fill_fraction)),
      per_plane: per((i) => b[i] ?? null),
    };
  }
  // flatten
  const f = contexts.map((c) => c.context.flatten);
  return {
    max_after_floor_sigma: max(f.map((x) => x?.after_floor_max_sigma)),
    // The strongest leftover |Q| trend of the floors (by |rank correlation|),
    // and the widest floor span, over the planes: each on the outer half of the
    // shells the counts reach on its plane (metrics/flatten.ts, judgedShells).
    max_floor_trend: max(f.map((x) => (x?.floor_trend != null ? Math.abs(x.floor_trend) : null))),
    max_floor_span_fraction: max(f.map((x) => x?.floor_span_fraction)),
    // Whether that trend and span make a pedestal left (metrics/flatten.ts):
    // the flatten's Q² term is for a pedestal, so this is the answer to
    // "does it want flattenQ2", stated, not left to the model to read off two numbers.
    pedestal_left: pedestalLeft(
      max(f.map((x) => (x?.floor_trend != null ? Math.abs(x.floor_trend) : null))),
      max(f.map((x) => x?.floor_span_fraction)),
    ),
    per_plane: per((i) => f[i] ?? null),
  };
}

/** A one-line headline of an evaluation, for the trial table. */
export function headline(stage: TuneStage, e: StageEvaluation | undefined): string {
  if (!e) return "—";
  const v = (k: string) => (e[k] == null ? "–" : String(e[k]));
  // " (<plane>, <|Q|> Å⁻¹)" for a residual that names its plane and |Q|.
  const where = (k: string) => {
    const w = e[k] as { plane?: string; at?: number } | null | undefined;
    return w?.plane ? ` (${w.plane}, ${w.at} Å⁻¹)` : "";
  };
  switch (stage) {
    case "rings":
      return `ring ratio ${v("mean_ring_energy_ratio")} · over-sub ≤ ${v("max_over_subtraction_fraction")} · ring dent ≤ ${v("max_ring_dent")}${where("worst_ring_dent")} · left ≤ ${v("max_ring_left")}${where("worst_ring_left")}`;
    case "punch": {
      // The sharp ones on the protected planes stay by design (D5), so the
      // headline counts them apart, and names them whenever there are any.
      const sharp = e.leftover_off_lattice_sharp;
      const kept = e.leftover_on_protected_planes_sharp;
      const off = typeof sharp === "number" && typeof kept === "number" ? sharp - kept : v("leftover_off_lattice_sharp");
      const onProtected = typeof kept === "number" && kept > 0 ? ` (${kept} more on protected planes, kept)` : "";
      return `${v("leftover_at_nodes")} missed at nodes · ${off} sharp off-lattice${onProtected} · ${v("leftover_off_lattice_broad")} broad maxima kept · punched ${v("mean_punched_fraction")}`;
    }
    case "backfill":
      return `seam ${v("mean_median_seam_sigma")}σ · bright ≤ ${v("max_bright_fill_fraction")}`;
    case "flatten":
      return (
        `floor ≤ ${v("max_after_floor_sigma")}σ · trend ≤ ${v("max_floor_trend")} · span ≤ ${v("max_floor_span_fraction")}` +
        (typeof e.pedestal_left === "boolean" ? (e.pedestal_left ? " · pedestal left" : " · no pedestal") : "")
      );
    case "pdf": {
      const open = e.window_weight_on_unmeasured;
      const broken = e.max_symmetry_break;
      return (
        `r ${v("back_fft_pearson_r")}` +
        (typeof e.back_fft_pearson_r_even === "number" ? ` (even part ${v("back_fft_pearson_r_even")})` : "") +
        ` · RMS ${v("back_fft_normalized_rms")} · SNR ${v("mean_feature_snr")}` +
        (typeof open === "number" ? ` · unmeasured ${shownWeight(open)}` : "") +
        (typeof broken === "number"
          ? e.symmetry_declared === false
            ? ` · no symmetry declared (asymmetry ${tiny(broken)})`
            : ` · symmetry off ≤ ${tiny(broken)}`
          : "")
      );
    }
  }
}

// A share in exponent form when it is tiny (1.5e-6, not 0.0000015).
const tiny = (x: number): string => (x !== 0 && Math.abs(x) < 1e-3 ? x.toExponential(1) : String(x));

/** Why a trial's output breaks a hard limit of its stage, or null.  The tuning
 * run does not choose such a trial while the user's settings keep the limit:
 * the ΔPDF's window past the limit, by the ΔPDF's rule (verdicts/rules.ts, D6),
 * which reads the raw weight; the reason gives that weight, not the rounded one. */
export function outOfBounds(stage: TuneStage, e: StageEvaluation | undefined): string | null {
  const shown = e?.window_weight_on_unmeasured;
  if (stage === "pdf" && typeof shown === "number" && judge("pdf", e ?? {}).reasons.includes("window past limit")) {
    const raw = e?.[UNROUNDED]?.window_weight_on_unmeasured;
    return `its window puts ${shownWeight(typeof raw === "number" ? raw : shown)} of its weight on unmeasured reciprocal space, past the ${OPEN_WEIGHT_OK} the backend's own window allows`;
  }
  return null;
}
