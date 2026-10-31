// TypeScript mirrors of the FastAPI response models (nebula3d/server/schemas.py).

export type VolumeKind = "hkl" | "delta_pdf";

export interface StageStatus {
  name: string;
  exists: boolean;
  kind: VolumeKind;
  volume_id: string;
  // When the output was last written (POSIX seconds); null or absent when it
  // does not exist, for the raw input, or from a server that does not say
  // (api/stale.ts).
  mtime?: number | null;
  // The ΔPDF only: the output it was made from ("flattened", "backfilled", …,
  // "raw"), as its file records it; null or absent when not known (api/stale.ts).
  source?: string | null;
}

export interface Dataset {
  id: string;
  temperature: string | null;
  raw_name: string;
  stem: string;
  stages: StageStatus[];
  // The raw input file's size (bytes) and mtime (POSIX s; null in the
  // browser build, whose copy's time is not the file's); null when it is not
  // on disk, absent from a server that does not say. A saved session checks
  // its input against it (state/session.ts).
  raw_file?: { size: number; mtime: number | null } | null;
}

export interface DataRoot {
  data_root: string;
  raw_exists: boolean;
  processed_exists: boolean;
  n_datasets: number;
}

export interface Lattice {
  a: number | null;
  b: number | null;
  c: number | null;
  // Direct-cell angles (degrees).  Absent/null for ΔPDF files written before
  // they were stored — treat as 90°.
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
}

/** Where a volume's counts begin and end in |Q| (GET /api/volumes/{id}/coverage). */
export interface VolumeCoverage {
  id: string;
  q: number[]; // shell centres (Å⁻¹)
  counted: number[]; // share of each shell's voxels holding counts
  q_min_edge: number | null; // where that share first rises through ½ (null: from 0)
  q_max_edge: number | null; // where it last falls through ½ (null: to the corner)
  full_q_min: number | null; // first shell ≥ 95 %
  full_q_max: number | null; // last shell ≥ 95 %
  // Last shell ≥ 95 % measured (mask set, finite): where the ΔPDF window's
  // support ends, past the counts where the volume stores zeros it marks measured.
  measured_q_max: number | null;
  box_q: number; // the nearest face of the box in Q (a face through the origin, a half-space volume's, aside)
  box_corner_q: number;
  q_step: number; // the shells' width (Å⁻¹): every edge is known to one shell
}

/** One shell judged: does it rise in nearly every direction over the sphere (a powder ring)? */
export interface RingShell {
  q_center: number | null; // Å⁻¹
  fwhm: number | null; // Å⁻¹
  n_cells: number; // direction cells with data
  median_height: number | null; // the shell's median height above its flanks (data units)
  relative_height: number | null; // that height over the flanks' level
  isotropy: number | null; // the low-quantile height over the median height
  snr?: number | null; // the height over its noise, in the typical cell
  beyond_curve?: number | null; // the share of the height above a quadratic through the flanks
  is_ring: boolean;
  not_judged: string | null; // why no verdict, if none
}

export interface RingIsotropy {
  id: string;
  rule: { direction_share: number; height_share: number };
  shells: RingShell[];
  // Why the grid is too coarse to judge any ring ("grid too coarse: …"), or null;
  // given with no shell asked too. Absent from a backend before it was measured.
  not_judged?: string | null;
}

/** One punch hole's fill against the range its 3-D rim allows (VolumeTexture's `holes`); the values are null where it was not judged. */
export interface TextureHole {
  index: number; // its place among the holes, C order of their first voxels
  centre_hkl: number[]; // the mean position of its voxels, r.l.u.
  voxels: number;
  rim_voxels: number; // measured, in no hole, left as they were by the fill
  fill: number | null; // the mean backfilled value over the hole
  level: number | null; // the rim's median: the local diffuse level
  sigma: number | null; // the rim's robust σ about its trend
  slope: number | null; // the trend's change per voxel outward
  edge: number | null; // the range the rim allows: its trend at the hole's edge ...
  peaked: number | null; // ... and continued linearly to the hole
  bias: number | null; // the fill's signed distance outside that range (0 inside)
  bias_sigma: number | null; // ... in the rim's σ
  bias_level: number | null; // ... in units of the local level
  not_judged: string | null; // "thin rim", "flat rim", "too large" or "no outside"
}

/**
 * The Pilot's fill-bias rule (metrics/texture.ts) on every punch hole of a
 * backfilled stage, each with its 3-D rim, against the dataset's punched stage
 * (GET /api/volumes/{id}/texture; nebula3d.analysis.fill_texture).
 */
export interface VolumeTexture {
  id: string;
  punched_id: string; // the punched stage the holes were read from
  holes_from: "punch_record" | "masks"; // the punch's record, or texture.ts's own test
  rim: number; // the rim's depth, voxels
  min_rim: number; // the fewest rim voxels a hole is judged with
  // The rule's limits, as asked for (else the server's, texture.ts's).
  min_sigma: number;
  one_way: number;
  min_holes: number;
  floor: number;
  n_holes: number;
  n_judged: number;
  judged: boolean; // room for the rims, and n_judged ≥ min_holes: else not judged
  node_spacing: number | null; // voxels between neighbouring nodes of the grid's cell
  room_needed: number | null; // ... that the median hole's rim needs, 2·(reach + rim)
  not_judged: string | null; // why the grid is too coarse for the rule ("grid too coarse: …")
  median_fill_bias_sigma: number | null;
  median_fill_bias_level: number | null;
  above_fraction: number | null;
  below_fraction: number | null;
  above_floor_fraction: number | null; // filled above their range by floor × level or more
  below_floor_fraction: number | null;
  systematic_fill_bias: boolean; // false whenever not judged
  holes: TextureHole[]; // the `limit` holes farthest outside their range
}

/**
 * What the ring stage recorded in its diagnostics (GET /api/rings/{id}/diagnostics):
 * the rings the pooled model detected and could not confirm on its grid, which it
 * did not subtract, or null where it left none. Diagnostics older than the
 * ring-removed volume give none (has_diagnostics false).
 */
export interface RingDiagnostics {
  dataset_id: string;
  diagnostics_path: string;
  has_diagnostics: boolean;
  status: string | null;
  unconfirmed_at_grid: {
    count: number;
    needs: string; // what the grid needs, from the ring test's constants
    notice: string; // what the run log says of them, the remedy included
    q_centers: number[]; // their |Q| (Å⁻¹)
  } | null;
}

export interface UbCheck {
  id: string;
  fit: "orientation" | "lattice" | "both" | "symmetric";
  cell_nodes: number[]; // the Bragg nodes' spacing (the punch cell)
  operations: number | null; // the declared operations, if any
  operations_from: string | null; // the file that declared them: this one, or its symmetrised export
  symmetry_break: number | null; // RMS difference from the images under them, relative
  symmetrised: boolean | null;
  passes: { q_max: number; n_found: number; n_used: number; rms_start: number; rms: number; angle_deg: number }[];
  n_searched: number;
  n_used: number;
  n_rejected: number;
  rms_start: number; // RMS distance of the peak centres from their nodes with the volume's UB (Å⁻¹)
  rms: number; // ... with the refined UB
  angle_deg: number; // the orientation's change
  axis_uvw: number[];
  cell_start: number[]; // a, b, c (Å), α, β, γ (°)
  cell: number[];
  transform: number[][]; // UB_start⁻¹·UB
  ub_start: number[][];
  ub: number[][];
  // The peaks' median offset along Q from their nodes relative to |Q|, per |Q| band and direction.
  radial: { q_lo: number; q_hi: number | null; direction: string; n: number; before: number; after: number }[];
  voxel_q?: number | null; // the grid's finest step in Q (Å⁻¹)
  // The peak centres' mean offset (centre − node) in r.l.u., with the volume's
  // UB and the refined one, and the first's standard error: a shifted HKL
  // origin is this vector, which no UB removes.
  mean_offset_rlu?: { before: (number | null)[]; after: (number | null)[]; standard_error: (number | null)[]; n: number } | null;
}

/**
 * A dataset's raw volume regridded onto its refined UB, as a new dataset beside
 * it, or why nothing was written (POST /api/datasets/{id}/regrid, the bridge's
 * dataset_regrid_json: nebula3d.server.regrid.regrid_out). The fit is the UB
 * check's. Fields a refusal came before are null; docs/regrid.md.
 */
export interface RegridResult {
  id: string; // the dataset asked for
  written: boolean;
  // Why nothing was written: target_exists | symmetrised_without_source | turn_below_noise | cannot_symmetrise.
  refusal: { code: string; reason: string } | null;
  dataset_id: string | null; // the new dataset, or the existing one a target_exists refusal names
  file: string | null; // ... its file, beside the raw one
  source_file: string; // the dataset's raw file
  refined_on: string | null; // whose peaks were fitted and whose data regridded
  fit: string | null;
  operations: number | null;
  operations_from: string | null;
  source_symmetrised: boolean | null;
  symmetrised: boolean; // the new file is symmetrised, and declares its operations
  turn_deg: number | null; // the fit's turn of the UB
  turn_threshold_deg: number; // the UB check's rule (UB_TURN): a smaller turn is within the fit's noise
  axis_uvw: number[] | null;
  ub_start: number[][] | null;
  ub: number[][] | null;
  cell_start: number[] | null; // a, b, c (Å), α, β, γ (°)
  cell: number[] | null;
  rms_start: number | null; // the peaks' RMS distance from their nodes, Å⁻¹, before and after
  rms: number | null;
  n_used: number | null;
  measured_before: number | null; // measured voxels regridded (after the edge trim)
  measured_after: number | null; // measured voxels in the new file
  voxels_outside: number | null; // measured before, unmeasured now: their Q left the old grid
  voxels_outside_share: number | null; // ... over measured_before
}

export interface VolumeMeta {
  id: string;
  stage: string;
  kind: string;
  shape: [number, number, number];
  h_range: [number, number];
  k_range: [number, number];
  l_range: [number, number];
  lattice: Lattice;
  ub_matrix?: number[][];
  planes: string[];
  // The point group the file declares its data were symmetrised with.
  symmetry?: string | null;
  symmetry_ops?: number[][][] | null;
  // The Laue class declared *for* a file that declares none itself: by a
  // symmetrized NeXus Viewer export beside it naming it as its source, or a
  // regrid's record. What "Symmetrize here" takes for the symmetry average.
  declared_for?: { symmetry: string; symmetry_ops: number[][][]; from: string } | null;
  // "measured": σ came with the data; "estimated": √|I|. sigma_note says when
  // that leaves a significance in σ meaningless (normalized values).
  sigma?: "measured" | "estimated";
  sigma_note?: string | null;
  // The settings the flatten that wrote this file ran with: null for a stage
  // the flatten did not write, or wrote before it recorded them; absent from
  // a backend that predates the field.
  flatten_settings?: FlattenSettings | null;
}

/**
 * What the flatten recorded in its output (nebula3d.pipeline.FlattenParams, as
 * read_flatten_settings returns it: ranges as lists). Every field is optional:
 * a file records the fields of the version that wrote it.
 */
export interface FlattenSettings {
  estimator?: string;
  ion?: string | null;
  fit_q_range?: [number, number] | null; // Å⁻¹; null: every shell with a level was fitted
  q2_term?: boolean;
  floor_percentile?: number; // 0–100
  q_step?: number; // Å⁻¹
  smooth?: number;
  snip_width?: number;
  min_count?: number;
  q_range?: [number, number] | null;
}

/**
 * The floor of every |Q| shell over the whole volume, on the flatten's own
 * shells (GET /api/volumes/{id}/shell-floors, the bridge's
 * volume_shell_floors_json; nebula3d.preprocessing.shell_floors). One entry
 * per shell in each list. For the flattened stage, the flatten's input (the
 * backfilled stage, `before_id`) is measured on the same shells, and `level`
 * is its median over the voxels measured in both: the diffuse level a
 * pedestal's span is a share of. Without an input (`before_id` null) `level`
 * is the volume's own median.
 */
export interface ShellFloors {
  id: string;
  before_id: string | null;
  q_step: number; // Å⁻¹
  percentile: number; // 0–100
  min_count: number;
  q_edges: number[]; // one more than the shells, Å⁻¹
  centres: number[]; // Å⁻¹
  totals: number[]; // the grid's voxels in the shell, measured or not
  counts: number[]; // ... measured (mask and finite)
  floors: (number | null)[]; // null under min_count
  medians: (number | null)[];
  counts_before?: number[] | null;
  floors_before?: (number | null)[] | null;
  medians_before?: (number | null)[] | null;
  level: number | null;
  level_count: number;
  flatten?: FlattenSettings | null; // what the flatten recorded in the file, or null
}

export interface DeltaPdfMeta {
  id: string;
  shape: [number, number, number];
  x_range: [number, number];
  y_range: [number, number];
  z_range: [number, number];
  lattice: Lattice;
  q_max: number | null;
  planes: string[];
  // The transform's window from the ΔPDF's provenance: "ellipsoid" or
  // "separable", its scale (< 1: shrunk to the coverage), and the share of its
  // weight on unmeasured space reaching a box face.  Absent on older files.
  window_shape?: string | null;
  window_scale?: number | null;
  window_open_weight?: number | null;
}

// The ΔPDF's strongest extrema outside the origin's disk, grouped by the point
// group the dataset's raw file declares, else by sign, length and size
// (nebula3d.analysis.dpdf_features): one per ± pair.
export interface DpdfFeatureGroup {
  sign: 1 | -1;
  length: number; // |r| of the strongest, Å
  size_sigma: number; // the largest |ΔPDF| in the group, in robust σ
  mean_size_sigma: number; // the mean |ΔPDF| of its n extrema, in robust σ
  value: number;
  n: number; // extrema in the group, one per ± pair
  // With a declared symmetry, the orbit's distinct vectors, one per ± pair (n is
  // fewer when some are below the threshold or outside the volume); null without.
  multiplicity: number | null;
  vectors: number[][]; // (x, y, z) along a, b, c, Å, strongest first
  vectors_rlu: (number[] | null)[]; // the same in lattice units
  sizes_sigma: number[];
}

export interface DpdfFeatures {
  id: string;
  sigma: number | null; // robust σ of the ΔPDF outside the origin's disk
  min_sigma: number;
  origin_radius: number; // Å
  n_extrema: number;
  // "declared symmetry (<label or operations>: <n> operations, r ≡ −r)", or
  // "sign, length and size (<why: none declared, or why it was not applied>)"
  grouped_by: string;
  groups: DpdfFeatureGroup[];
}

export interface ConsistencyMetrics {
  pearson_r: number;
  normalized_rms: number;
  rms: number;
  n_voxels: number;
  per_plane_r: Record<string, number>;
  q_band: [number, number] | null;
  r_band: [number, number] | null;
  q_data_max: number;
  r_data_max: number;
  crop_hkl: number[] | null;
  apodization: string;
  // Against the data's even part under Q → −Q, what the real transform keeps:
  // 1 to rounding when the transform is sound (absent from checks made before
  // 2026-10-17). odd_share is the share of the data's variance that is odd,
  // which no real transform keeps: counting noise on unsymmetrised data.
  pearson_r_even?: number | null;
  normalized_rms_even?: number | null;
  odd_share?: number | null;
  n_voxels_even?: number;
}

// The pipeline's own back-FFT check, saved to *_delta_pdf_consistency.json: the
// agreement metrics for the ΔPDF on disk, computed with the run's ΔPDF params.
// has_check is false when the check never ran or predates the current ΔPDF.
export interface ConsistencyCheck {
  dataset_id: string;
  check_path: string;
  has_check: boolean;
  metrics: Pick<
    ConsistencyMetrics,
    | "pearson_r" | "normalized_rms" | "rms" | "n_voxels" | "per_plane_r" | "q_band" | "crop_hkl" | "apodization"
    | "pearson_r_even" | "normalized_rms_even" | "odd_share" | "n_voxels_even"
  > | null;
}

// What the viewer's round trip transforms and how, and where both came from:
// the run's ΔPDF records the volume it was made from (made_from) and its
// window, σ, shape, support, padding and subtractions (source "run"); without
// a readable record the package defaults are used (source "defaults").
// defaulted names the settings a record lacked. input is the volume the view
// transforms: the record's (same_input true), else the flattened volume, else
// the backfilled one (same_input false when the record's is gone, null when no
// record names one). note says why for every fallback. The view keeps the full
// |Q| range and its own band: the run's crop and band are reported, not applied.
export interface ConsistencySettings {
  source: "run" | "defaults";
  note: string | null;
  delta_pdf: string | null;
  made_from: string | null;
  input: string | null;
  same_input: boolean | null;
  defaulted: string[];
  apodization: string;
  gaussian_sigma: number;
  zero_pad: boolean;
  subtract_mean: boolean;
  subtract_smooth_bg: number | number[] | null;
  window_shape: string;
  window_support: boolean;
  run_crop_hkl: number[] | null;
  run_q_band: number[] | null;
}

export interface ConsistencyMeta {
  shape: [number, number, number];
  h_range: [number, number];
  k_range: [number, number];
  l_range: [number, number];
  dpdf_shape: [number, number, number];
  x_range: [number, number];
  y_range: [number, number];
  z_range: [number, number];
  lattice: Lattice;
  planes: string[];
  q_data_max: number;
  r_data_max: number;
  metrics: ConsistencyMetrics;
  settings: ConsistencySettings;
}

export interface BraggPeakWidth {
  index: number;
  source_node_hkl: number[] | null;
  center_hkl: [number, number, number];
  q_abs: number;
  intensity: number | null;
  local_background: number | null;
  // Integrated excess over the resolution aperture, in standard errors
  // (absent in profiles written before the significance gate).
  significance?: number | null;
  width_hkl: [number, number, number];
  width_q: [number, number, number];
  // Pad-free / floor-free measured peak widths from a local moment fit.
  // null when the peak is unmeasurable (no positive excess / too few voxels).
  measured_width_hkl?: [number, number, number] | null;
  measured_width_q?: [number, number, number] | null;
  // Per-axis flag: measured width below the half-voxel pad (resolution-limited).
  resolution_limited?: [boolean, boolean, boolean] | null;
  principal_width_hkl?: [number, number, number];
  principal_width_q?: [number, number, number];
  principal_directions_hkl: number[][];
  fit_kind: string;
}

export interface BraggProfile {
  dataset_id: string;
  profile_path: string | null;
  has_profile: boolean;
  schema_version: number;
  width_labels: string[];
  hkl_width_labels?: string[];
  width_units: Record<string, string>;
  n_peaks: number;
  fit_covariance: boolean;
  punch_frame: string | null;
  peaks: BraggPeakWidth[];
  // What the punch's search left alone, and the bunching it measured
  // (nebula3d.server.modulation.record_out): null for a record written
  // before the punch kept it; absent from an older server's.
  modulation?: ModulationRecord | null;
}

// ---------------------------------------------------------------- the sample's modulation

/** A declaration as the backend writes it (nebula3d.modulation.Modulation.to_json): k's fractions exact. */
export interface ModulationDeclaration {
  k: string[][];
  order: number;
  form: string; // "points" | "planes"
  half_width: number;
  normal: number[] | null;
}

/** One position a declaration protects (nebula3d.modulation.Position): a plane family or a satellite about each node. */
export interface ModulationPosition {
  label: string;
  kind: string; // "plane" | "point"
  half_width: number;
  coordinate: number[] | null;
  centre: string | null;
  period: number | null;
  vector: string[] | null;
}

/** POST /api/modulation/check's body: a declaration as a run's request holds it (absent: the backend's default, none), on a cell and a symmetry. */
export interface ModulationCheckIn {
  modulation?: StageParamsIn["modulation"] | null;
  cell?: [number, number, number] | null;
  // Operation triplets as text, or HKL matrices as a volume's meta lists them.
  symmetry_ops?: number[][][] | string | null;
}

/** What a declaration means before a run (POST /api/modulation/check); ok false gives the error alone. */
export interface ModulationCheck {
  ok: boolean;
  error: string | null;
  default: boolean; // none named: the backend's default, which declares none
  declared: ModulationDeclaration | null;
  description: string | null;
  positions: ModulationPosition[];
}

/** Sharp peaks off the lattice bunched at one commensurate fraction (nebula3d.modulation.Bunching.to_json). */
export interface Bunching {
  coordinate: string; // "H", "K", "L"
  equivalents: string[];
  period: number;
  denominator: number;
  values: { value: string; hits: number }[]; // each fraction of the period with hits
  hits: number;
  peaks: number; // the sharp peaks off the lattice tested, each symmetry orbit once
  expected: number; // the hits chance would give
  p0: number;
  p_value: number;
  alpha: number;
  tests: number;
  half_width: number; // r.l.u.: one grid step
  centres: number[][];
  mean_distance: number;
  others: string[];
  where: string; // "H ≡ ±1/3 (mod 1)"
}

/** The punch's record of what its search left alone and what it found (BraggProfile.modulation). */
export interface ModulationRecord {
  declared: ModulationDeclaration | null;
  cell: number[] | null;
  symmetry_ops: number[][][] | null;
  legacy: { h_centers: number[] | null; h_fractions: number[] | null; half_width: number } | null;
  bunching: Bunching | null;
}

/**
 * Which protected position each voxel of a slice of the punched stage lies in
 * (GET /api/modulation/{id}/labels): i for legend[i − 1], 0 for none, on the
 * punched stage's grid, read from the run's punch record.
 */
export interface ProtectedLabelsHeader extends SliceHeader {
  recorded: boolean; // false: the record predates what the search left alone, and nothing is labelled
  declared: ModulationDeclaration | null;
  legend: ModulationPosition[];
}

export interface ProtectedLabels {
  header: ProtectedLabelsHeader;
  data: Float32Array;
}

// Header decoded from the binary slice envelope.
export interface SliceHeader {
  ny: number;
  nx: number;
  x_axis: number[];
  y_axis: number[];
  x_label: string;
  y_label: string;
  cut_label: string;
  robust_max: number;
  // Real-space (ΔPDF) sections only: the true angle between the x and y axes
  // (deg; γ for x_H–y_K, β for x_H–z_L, α for y_K–z_L), the display position of
  // the section point nearest the origin, and the section plane's distance
  // from it — so |r|² = (X − cx)² + (Y − cy)² + r_perp².  See oblique.ts.
  axes_angle?: number;
  r_center?: [number, number];
  r_perp?: number;
}

export interface Slice {
  header: SliceHeader;
  // length ny*nx, row-major; row index = y (ascending), NaN = masked.
  data: Float32Array;
}

export interface StageParamsIn {
  // The cleanup stages' switches (the page's "Enable stage"; the flatten's is
  // the request's flatten_enabled). false: the stage is not run and its input
  // passes through to the next stage, never an output an earlier run left. A
  // stage merely left out of the request's `stages` is a partial re-run, whose
  // output on disk the next stage reads. Omitted: on.
  rings_enabled?: boolean;
  punch_enabled?: boolean;
  backfill_enabled?: boolean;
  // Stage 0, the symmetry average (omitted: off): its Laue class, the
  // sample's to declare (a preset name or generators), and whether an input
  // that declares a symmetry already is averaged again.
  symmetry_average_enabled?: boolean;
  symmetry_average_laue?: string;
  symmetry_average_reaverage?: boolean;
  // Voxel layers trimmed off the edge of the measured coverage at load (0 = none).
  edge_trim?: number;
  rings_n_patches?: number;
  rings_n_fourier?: number;
  rings_slice_axis?: string;
  // "pooled" (stack-pooled sector profiles) | "global_v2" (sample-only global 3D)
  // | "patched" | "parametric"
  rings_model?: string;
  rings_ring_width?: number;
  // "rolling" (continuous Ring(|Q|)) | "peaks" (discrete pseudo-Voigt)
  rings_radial_mode?: string;
  rings_global_material?: string;
  rings_global_subtraction?: string;
  rings_global_confidence_z?: number;
  rings_global_angular_lmax?: number;
  rings_global_min_snr?: number;
  // "pooled": azimuthal sectors; stack-pooling half-width (degrees on the ring sphere)
  rings_pooled_sectors?: number;
  rings_pooled_window_deg?: number;
  // Intensity floor of the "floors" integer-node test (data units).
  punch_min_intensity?: number;
  // Noise-aware detection gate (standard errors), the whole integer-node test by
  // default; 0 turns it off and the nodes fall back to the intensity floors.
  punch_min_significance?: number;
  // "profile" (profile-matched punch, default) | "ellipsoid"; and the noise
  // level (σ) the profile-matched punch stops at.
  punch_footprint?: string;
  punch_profile_n_sigma?: number;
  punch_search_n_mad?: number;
  punch_mode?: string;
  // Supercell the volume is indexed on, per axis (≥ 1): integer-mode Bragg
  // nodes are the parent lattice's only.
  punch_supercell_h?: number;
  punch_supercell_k?: number;
  punch_supercell_l?: number;
  // Integer-punch H guard (r.l.u.); 0 turns it off.
  punch_h_guard?: number;
  // Off-lattice search: floor (× diffuse scatter).
  punch_search_floor?: number;
  // The sample's modulation, a fact about the sample, which the search leaves
  // alone: its k vectors, order, form and half width as Modulation.parse reads
  // them, as the Configure page holds them (state/modulation.ts); "none"
  // declares none, and absent the backend's default (none too).
  modulation?: string | Record<string, string>;
  // Legacy: the protected H fractions ([] = none) and their half width
  // (r.l.u.), as a console from before declarations sent them. The backend
  // still reads them; this console sends `modulation`, never both.
  punch_search_protect_h?: number[];
  punch_search_protect_half_width?: number;
  punch_search_max_width_ratio?: number;
  punch_margin?: number;
  // Q-space punch: frame "spherical" (rρ,rθ,rφ, default) or "q" (a*,b*,c*) (Å⁻¹)
  punch_frame?: string;
  punch_q_radius?: number;
  punch_q_radius_a?: number;
  punch_q_radius_b?: number;
  punch_q_radius_c?: number;
  punch_spherical_radius_rho?: number;
  punch_spherical_radius_theta?: number;
  punch_spherical_radius_phi?: number;
  incident_beam_q_radius_a?: number;
  incident_beam_q_radius_b?: number;
  incident_beam_q_radius_c?: number;
  incident_beam_q_margin?: number;
  // Legacy HKL direct-beam overrides.
  incident_beam_radius_h?: number;
  incident_beam_radius_k?: number;
  incident_beam_radius_l?: number;
  incident_beam_margin?: number;
  punch_fit_unconstrained?: boolean;
  incident_beam_fit_covariance?: boolean;
  backfill_method?: string;
  flatten_estimator?: string;
  flatten_floor_percentile?: number;
  /** Magnetic ion of the flatten's const + c·F(Q)² model; "none" = constant only. */
  flatten_ion?: string;
  flatten_q2?: boolean;
  flatten_fit_q_max?: number;
  pdf_apodization?: string;
  /** ΔPDF window geometry: "auto" | "separable" | "ellipsoid". */
  pdf_window_shape?: string;
  /** Taper the ΔPDF window to the measured coverage (default true). */
  pdf_window_support?: boolean;
  pdf_gaussian_sigma?: number;
  pdf_crop_h?: number;
  pdf_crop_k?: number;
  pdf_crop_l?: number;
  pdf_q_min?: number;
  pdf_q_max?: number;
}

/** One trial of a tuning run: its stage runs into tuning/<run>/trials/<trial>/. */
export interface TuningTrial {
  run_id: string;
  trial: string; // "<stage>-<n>", e.g. "punch-2"
}

export interface PipelineRunRequest {
  dataset_id: string;
  flatten_enabled: boolean;
  force: boolean;
  force_from?: string | null;
  // The stages to run in this call; omitted → all. One left out is a partial
  // re-run (the stages after it read its output on disk); a stage switched off
  // (flatten_enabled, params.*_enabled) is not run either way.
  stages?: string[];
  params: StageParamsIn;
  tuning?: TuningTrial; // a tuning trial: never writes to processed/
}

/** A tuning run's folder; `dataset_id` views its chain of kept outputs. */
export interface TuningRun {
  run_id: string;
  dataset_id: string;
}

export interface TuningPromote extends TuningRun {
  trial: string;
  files: string[];
}

export interface JobOut {
  id: string;
  input: string;
  status: string;
  error: string | null;
  n_events: number;
}

// One Server-Sent-Event payload from a running job.
export interface JobEvent {
  type: string; // "progress" | "done" | "error" | "cancelled"
  stage?: string;
  status?: string;
  fraction?: number | null;
  message?: string;
  // The job's own end, why it failed as the server said (state/pipelineStore
  // finish): the page's log shows it; run_pipeline's result leaves it out, as
  // the validation frozen at 812e686 does.
  end?: true;
}

// GET /api/memory (nebula3d.server.memory): the native server's processes
// against the machine's memory, for the console's memory bar.
export interface ProcessMemory {
  role: string; // "server" | "run" (a pipeline job's worker process)
  pid: number;
  bytes: number;
  peak_bytes: number | null;
}

export interface ServerMemory {
  measured: boolean; // false where the platform can't be read (no bar)
  kind: "rss" | "footprint" | null; // Linux RSS, or macOS's physical footprint
  used_bytes: number | null;
  ceiling_bytes: number | null; // the RAM, or the container's lower limit
  ceiling_source: "ram" | "container" | null;
  processes: ProcessMemory[];
}
