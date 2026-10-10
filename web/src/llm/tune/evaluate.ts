// Measures one stage's output for the tuning run: that stage's metrics on the
// three principal planes through the origin (plus the volume-wide records the
// stage writes), so a trial is judged on more than one cut.  The numbers are
// the same pure metrics the chat context uses.

import { fetchBraggProfile, fetchConsistencyCheck, fetchDpdfMeta, fetchMeta } from "../../api/client";
import type { Dataset } from "../../api/types";
import { dpdfVolumeId, loadPipelineContext, safe, hklVolumeId, type Cut } from "../context/loadContext";
import { OPEN_WEIGHT_OK } from "../metrics/coverage";
import { roundSig } from "../metrics/sliceStats";
import { sectionSymmetry, type SectionSymmetry } from "../metrics/symmetry";
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

export type StageEvaluation = Record<string, unknown>;

// Two planes' rings within this |Q| (Å⁻¹) are the same powder ring.
const RING_MATCH_Q = 0.1;

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
    const [check, dmeta, ...sections] = await Promise.all([
      safe(fetchConsistencyCheck(dataset.id)),
      dId ? safe(fetchDpdfMeta(dId)) : Promise.resolve(null),
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
      back_fft_per_plane_r: m?.per_plane_r ?? null,
      mean_feature_snr: mean(Object.values(perPlane).map((p) => p?.feature_snr)),
      // The share of the window's weight on unmeasured reciprocal space
      // (qmax_coverage's verdict), and the window's shape.
      window_weight_on_unmeasured: typeof open === "number" ? roundSig(open, 2) : null,
      window_shape: dmeta?.window_shape ?? null,
      max_symmetry_break: worstOp ? worstOp.rms_difference : null,
      worst_symmetry_op: worstOp?.op ?? null,
      per_plane: perPlane,
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
  const contexts = await Promise.all(cuts.map((recip) => loadPipelineContext(dataset, { recip, dpdf: null, records: false })));
  const per = (f: (i: number) => unknown) => Object.fromEntries(cuts.map((c, i) => [c.plane, f(i)]));

  if (stage === "rings") {
    const r = contexts.map((c) => c.context.ring_removal);
    // A powder ring is isotropic: it shows at one |Q| on every plane.  A bump on
    // a single plane is the crystal's own scattering (Bragg tails, a diffuse
    // shell), which the ring stage rightly leaves, so only rings seen on two or
    // more planes count when more than one plane was measured.
    const all = cuts.flatMap((c, i) => (r[i]?.ring_residuals ?? []).map((x) => ({ plane: c.plane, ...x })));
    const planesMeasured = r.filter((x) => x?.ring_residuals).length;
    const isRing = (x: { plane: string; at: number }) =>
      planesMeasured < 2 || new Set(all.filter((y) => Math.abs(y.at - x.at) <= RING_MATCH_Q).map((y) => y.plane)).size >= 2;
    const rings = all.filter((x) => x.significant && isRing(x));
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
    // Each plane's residuals with its one-plane bumps marked, and its extremes
    // picked among the rings alone, so the plane agrees with the totals.
    const planeResiduals = (i: number) =>
      r[i]?.ring_residuals?.map((x) => (isRing({ plane: cuts[i].plane, at: x.at }) ? x : { ...x, single_plane_bump: true })) ?? null;
    const planeWorst = (xs: ReturnType<typeof planeResiduals>, sign: 1 | -1) =>
      worstOf((xs ?? []).filter((x) => x.significant && !("single_plane_bump" in x)), sign);
    return {
      mean_ring_energy_ratio: mean(r.map((x) => x?.ring_energy_ratio)),
      max_over_subtraction_fraction: max(r.map((x) => x?.over_subtraction_fraction)),
      // The deepest dent and largest leftover at the raw rings, over the planes.
      max_ring_dent: planesMeasured ? roundSig(dent ? -dent.residual_fraction : 0) : null,
      max_ring_left: planesMeasured ? roundSig(left ? left.residual_fraction : 0) : null,
      worst_ring_dent: dent,
      worst_ring_left: left,
      // Significant bumps on one plane only: crystal scattering, not rings.
      single_plane_bumps: all.filter((x) => x.significant && !isRing(x)).map(({ plane, at, residual_fraction }) => ({ plane, at, residual_fraction })),
      per_plane: per((i) => {
        const residuals = planeResiduals(i);
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
    const profile = await safe(fetchBraggProfile(dataset.id));
    const leftovers = contexts.map((c) => c.context.bragg_punch?.leftover);
    const fractions = contexts.map((c) =>
      punchedFraction(c.slices.ringremoved?.data, c.slices.braggpunched?.data),
    );
    const total = (key: "n_suspicious" | "n_at_nodes" | "n_off_nodes" | "n_on_protected" | "n_broad_off_nodes" | "n_skipped_noisy") =>
      leftovers.reduce((s, l) => s + (l?.[key] ?? 0), 0);
    // The strongest leftover over the planes, with its plane.
    const strongest = cuts.reduce<Record<string, unknown> | null>((best, c, i) => {
      const p = leftovers[i]?.suspicious_peaks[0];
      return p && (!best || p.sigma > (best.sigma as number)) ? { plane: c.plane, ...p } : best;
    }, null);
    return {
      total_leftover_peaks: total("n_suspicious"),
      leftover_at_nodes: total("n_at_nodes"),
      leftover_off_lattice: total("n_off_nodes"),
      // Of those, on the H planes the search leaves alone (protected satellites),
      // and broad enough to be diffuse maxima rather than reflections.
      leftover_on_protected_planes: total("n_on_protected"),
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
    // and the widest floor span, over the planes.
    max_floor_trend: max(f.map((x) => (x?.floor_trend != null ? Math.abs(x.floor_trend) : null))),
    max_floor_span_fraction: max(f.map((x) => x?.floor_span_fraction)),
    per_plane: per((i) => f[i] ?? null),
  };
}

/** A one-line headline of an evaluation, for the trial table. */
export function headline(stage: TuneStage, e: StageEvaluation | undefined): string {
  if (!e) return "—";
  const v = (k: string) => (e[k] == null ? "–" : String(e[k]));
  // " (h0l, 7.58 Å⁻¹)" for a residual that names its plane and |Q|.
  const where = (k: string) => {
    const w = e[k] as { plane?: string; at?: number } | null | undefined;
    return w?.plane ? ` (${w.plane}, ${w.at} Å⁻¹)` : "";
  };
  switch (stage) {
    case "rings":
      return `ring ratio ${v("mean_ring_energy_ratio")} · over-sub ≤ ${v("max_over_subtraction_fraction")} · ring dent ≤ ${v("max_ring_dent")}${where("worst_ring_dent")} · left ≤ ${v("max_ring_left")}${where("worst_ring_left")}`;
    case "punch":
      return `${v("leftover_at_nodes")} missed at nodes · ${v("leftover_off_lattice_sharp")} sharp off-lattice · ${v("leftover_off_lattice_broad")} broad maxima kept · punched ${v("mean_punched_fraction")}`;
    case "backfill":
      return `seam ${v("mean_median_seam_sigma")}σ · bright ≤ ${v("max_bright_fill_fraction")}`;
    case "flatten":
      return `floor ≤ ${v("max_after_floor_sigma")}σ · trend ≤ ${v("max_floor_trend")} · span ≤ ${v("max_floor_span_fraction")}`;
    case "pdf": {
      const open = e.window_weight_on_unmeasured;
      const broken = e.max_symmetry_break;
      return (
        `r ${v("back_fft_pearson_r")} · RMS ${v("back_fft_normalized_rms")} · SNR ${v("mean_feature_snr")}` +
        (typeof open === "number" ? ` · unmeasured ${tiny(open)}` : "") +
        (typeof broken === "number" ? ` · symmetry off ≤ ${tiny(broken)}` : "")
      );
    }
  }
}

// A share in exponent form when it is tiny (3.2e-6, not 0.0000032).
const tiny = (x: number): string => (x !== 0 && Math.abs(x) < 1e-3 ? x.toExponential(1) : String(x));

/** Why a trial's output breaks a hard limit of its stage, or null.  The tuning
 * run does not choose such a trial while the user's settings keep the limit. */
export function outOfBounds(stage: TuneStage, e: StageEvaluation | undefined): string | null {
  const open = e?.window_weight_on_unmeasured;
  if (stage === "pdf" && typeof open === "number" && open > OPEN_WEIGHT_OK) {
    return `its window puts ${tiny(open)} of its weight on unmeasured reciprocal space, past the ${OPEN_WEIGHT_OK} the backend's own window allows`;
  }
  return null;
}
