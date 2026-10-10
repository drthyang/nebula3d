// TypeScript mirrors of the FastAPI response models (nebula3d/server/schemas.py).

export type VolumeKind = "hkl" | "delta_pdf";

export interface StageStatus {
  name: string;
  exists: boolean;
  kind: VolumeKind;
  volume_id: string;
}

export interface Dataset {
  id: string;
  temperature: string | null;
  raw_name: string;
  stem: string;
  stages: StageStatus[];
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
  box_q: number; // the nearest face of the box
  box_corner_q: number;
}

export interface UbCheck {
  id: string;
  fit: "orientation" | "lattice" | "both" | "symmetric";
  cell_nodes: number[]; // the Bragg nodes' spacing (the punch cell)
  operations: number | null; // the declared operations, if any
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
    "pearson_r" | "normalized_rms" | "rms" | "n_voxels" | "per_plane_r" | "q_band" | "crop_hkl" | "apodization"
  > | null;
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
  // Off-lattice search: floor (× diffuse scatter), protected H fractions ([]
  // = none) and their half width (r.l.u.).
  punch_search_floor?: number;
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
  stages?: string[]; // enabled-stage subset; omitted → all stages run
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
}
