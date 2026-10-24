// 3D-ΔPDF feature analysis on a real-space orthoslice.  The ΔPDF is signed
// (positive = more correlation than the average structure, negative = less), so
// we ask: are there features that rise above the background noise, are they
// directional (anisotropic), and how do they trend with distance?  A huge
// self-correlation peak sits at the origin, so a small central disk is excluded
// before every statistic — otherwise it would swamp both the SNR and the
// anisotropy.  The disk is the share of the section's half-width that the ΔPDF
// page and dpdf_peaks leave out (ORIGIN_EXCLUDED).  Positions are taken in true
// Cartesian Å: a section whose axes meet at a non-right angle (hexagonal
// ab-plane, 120°) is first mapped through its `axes_angle`, so radii and
// feature directions are physical.

import type { ConsistencyMetrics } from "../../api/types";
import { ORIGIN_EXCLUDED } from "../../components/dpdfLevels";
import { toDisplay } from "../../components/oblique";
import type { GridSlice } from "./sliceStats";
import { roundSig } from "./sliceStats";

/**
 * Which robust σ a ΔPDF tool's sizes are in, as its result names it
 * (`sigma_of`; plan 4.10). Each is 1.4826 × the median absolute deviation of
 * the ΔPDF outside the origin's disk, but each tool takes it over other
 * values, so a size in σ from one tool is no size in σ from another: on the
 * validation's dev cases the volume's σ is 0.58 to 0.96 of the x–y section's
 * through the origin, and the three centre sections' own differ by up to a
 * factor of 4. dpdf_peaks names its own, the volume's
 * (nebula3d.analysis.dpdf_features), in its description and its reading.
 */
export const SIGMA_OF = {
  // dpdfMetrics on the section measured (measure_dpdf_cut).
  section: "this section outside the origin's disk, robust",
  // The same on each dataset (compare_datasets).
  datasets: "this section outside the origin's disk, each dataset's own, robust",
  // The same on each centre section (assess_stage's pdf; its mean_feature_snr averages them).
  sections: "each section outside the origin's disk, its own, robust",
  // The three centre sections' values together (dpdf_contrast).
  centre: "the three sections together, outside the origin's disk, robust",
} as const;

interface StrongPoint {
  x: number;
  y: number;
  v: number;
  w: number; // |v|
}

const collectFinite = (
  grid: GridSlice,
  excludeR: number,
): { values: number[]; abs: number[]; coords: [number, number][] } => {
  const { nx, ny, x_axis, y_axis } = grid.header;
  const angle = grid.header.axes_angle ?? 90;
  const data = grid.data;
  const values: number[] = [];
  const abs: number[] = [];
  const coords: [number, number][] = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const v = data[iy * nx + ix];
      if (!Number.isFinite(v)) continue;
      const [x, y] = toDisplay(x_axis[ix] ?? 0, y_axis[iy] ?? 0, angle);
      if (Math.sqrt(x * x + y * y) < excludeR) continue;
      values.push(v);
      abs.push(Math.abs(v));
      coords.push([x, y]);
    }
  }
  return { values, abs, coords };
};

export interface DpdfMetrics {
  origin_excluded_radius: number;
  background_sigma: number | null; // robust noise level away from the origin
  // Strongest feature amplitude in σ units — the headline "features stronger
  // than background?" number.  ≳ 5 means clear structured signal.
  feature_snr: number | null;
  strong_feature_fraction: number | null; // fraction of voxels beyond 5σ
  // Positive share of the strong features: ≈ 0.5 is balanced ±; skew tells
  // whether correlation excess or depletion dominates the pattern.
  positive_fraction: number | null;
  // Directionality of the strong features from their |v|-weighted covariance:
  // ratio = major/minor spread (1 = isotropic, > ~1.5 = anisotropic rods/sheets),
  // angle_deg = orientation of the major axis in the slice plane.
  anisotropy_ratio: number | null;
  anisotropy_angle_deg: number | null;
  // Mean |ΔPDF| in inner / mid / outer radial thirds — a falling trend means
  // short-range correlations, a flat trend means they persist to large r.
  radial_trend: [number | null, number | null, number | null];
  // Back-FFT consistency (if available): does the ΔPDF reproduce the data?
  consistency_pearson_r?: number | null;
  consistency_normalized_rms?: number | null;
}

// A metrics object carrying only the (optional) back-FFT consistency numbers —
// used when there is no ΔPDF slice but we still want to report trustworthiness.
type Consistency = Pick<ConsistencyMetrics, "pearson_r" | "normalized_rms">;

const consistencyOnly = (consistency: Consistency | null): DpdfMetrics => ({
  origin_excluded_radius: 0,
  background_sigma: null,
  feature_snr: null,
  strong_feature_fraction: null,
  positive_fraction: null,
  anisotropy_ratio: null,
  anisotropy_angle_deg: null,
  radial_trend: [null, null, null],
  consistency_pearson_r: consistency ? roundSig(consistency.pearson_r) : null,
  consistency_normalized_rms: consistency ? roundSig(consistency.normalized_rms) : null,
});

export const dpdfMetrics = (
  grid: GridSlice | null,
  {
    sigmaThreshold = 5,
    consistency = null,
  }: { sigmaThreshold?: number; consistency?: Consistency | null } = {},
): DpdfMetrics | null => {
  if (!grid) return consistency ? consistencyOnly(consistency) : null;
  const { nx, ny, x_axis, y_axis } = grid.header;
  const rMax = Math.max(
    Math.abs(x_axis[0] ?? 0),
    Math.abs(x_axis[nx - 1] ?? 0),
    Math.abs(y_axis[0] ?? 0),
    Math.abs(y_axis[ny - 1] ?? 0),
  );
  const excludeR = ORIGIN_EXCLUDED * rMax;

  const { values, abs, coords } = collectFinite(grid, excludeR);
  const base: DpdfMetrics = {
    origin_excluded_radius: roundSig(excludeR, 3),
    background_sigma: null,
    feature_snr: null,
    strong_feature_fraction: null,
    positive_fraction: null,
    anisotropy_ratio: null,
    anisotropy_angle_deg: null,
    radial_trend: [null, null, null],
    consistency_pearson_r: consistency ? roundSig(consistency.pearson_r) : null,
    consistency_normalized_rms: consistency ? roundSig(consistency.normalized_rms) : null,
  };
  if (values.length < 16) return base;

  // Robust σ from the MAD of the (origin-excluded) signed values.
  const sorted = [...values].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const madArr = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = madArr[Math.floor(madArr.length / 2)];
  const sigma = mad * 1.4826;
  base.background_sigma = roundSig(sigma, 3);
  if (sigma <= 0) return base;

  // Loop rather than Math.max(...abs): the spread overflows the call stack on
  // full-resolution slices (hundreds of thousands of voxels).
  let maxAbs = 0;
  for (let i = 0; i < abs.length; i++) if (abs[i] > maxAbs) maxAbs = abs[i];
  base.feature_snr = roundSig(maxAbs / sigma);

  const floor = sigmaThreshold * sigma;
  const strong: StrongPoint[] = [];
  let positive = 0;
  for (let i = 0; i < values.length; i++) {
    if (abs[i] >= floor) {
      strong.push({ x: coords[i][0], y: coords[i][1], v: values[i], w: abs[i] });
      if (values[i] > 0) positive += 1;
    }
  }
  base.strong_feature_fraction = roundSig(strong.length / values.length);
  base.positive_fraction = strong.length ? roundSig(positive / strong.length) : null;

  // |v|-weighted covariance of strong-feature positions → principal spread.
  if (strong.length >= 8) {
    let sw = 0;
    let mx = 0;
    let my = 0;
    for (const s of strong) {
      sw += s.w;
      mx += s.w * s.x;
      my += s.w * s.y;
    }
    mx /= sw;
    my /= sw;
    let cxx = 0;
    let cyy = 0;
    let cxy = 0;
    for (const s of strong) {
      const dx = s.x - mx;
      const dy = s.y - my;
      cxx += s.w * dx * dx;
      cyy += s.w * dy * dy;
      cxy += s.w * dx * dy;
    }
    cxx /= sw;
    cyy /= sw;
    cxy /= sw;
    const tr = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = tr / 2 - disc;
    if (l2 > 0) {
      base.anisotropy_ratio = roundSig(Math.sqrt(l1 / l2));
      // Major-axis orientation from the covariance eigenvector.
      const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy) * (180 / Math.PI);
      base.anisotropy_angle_deg = roundSig(angle, 3);
    }
  }

  // Radial trend of mean |ΔPDF| in three shells between excludeR and rMax.
  const zones: number[][] = [[], [], []];
  const inner = excludeR;
  const span = (rMax - inner) / 3;
  for (let i = 0; i < values.length; i++) {
    const [x, y] = coords[i];
    const r = Math.sqrt(x * x + y * y);
    let zone = Math.floor((r - inner) / (span || 1));
    if (zone < 0) zone = 0;
    if (zone > 2) zone = 2;
    zones[zone].push(abs[i]);
  }
  base.radial_trend = zones.map((z) =>
    z.length ? roundSig(z.reduce((s, v) => s + v, 0) / z.length, 3) : null,
  ) as [number | null, number | null, number | null];

  return base;
};
