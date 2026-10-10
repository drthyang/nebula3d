# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Pydantic response models for the API."""

from __future__ import annotations

from pydantic import BaseModel


class StageStatusOut(BaseModel):
    name: str
    exists: bool
    kind: str            # "hkl" | "delta_pdf"
    volume_id: str       # "<dataset_id>.<stage>"


class DatasetOut(BaseModel):
    id: str
    temperature: str | None
    raw_name: str
    stem: str
    stages: list[StageStatusOut]


class DataRootIn(BaseModel):
    data_root: str


class DataRootOut(BaseModel):
    data_root: str
    raw_exists: bool
    processed_exists: bool
    n_datasets: int


class LatticeOut(BaseModel):
    a: float | None
    b: float | None
    c: float | None
    # Direct-cell angles (degrees); None for ΔPDF files written before they
    # were stored — viewers then assume 90°.
    alpha: float | None = None
    beta: float | None = None
    gamma: float | None = None


class VolumeMetaOut(BaseModel):
    id: str
    stage: str
    kind: str
    shape: list[int]
    h_range: list[float]
    k_range: list[float]
    l_range: list[float]
    lattice: LatticeOut
    ub_matrix: list[list[float]] | None = None
    planes: list[str]


class CoverageOut(BaseModel):
    """Where a volume's counts begin and end in |Q| (see analysis.coverage)."""
    id: str
    q: list[float]
    counted: list[float]
    q_min_edge: float | None
    q_max_edge: float | None
    full_q_min: float | None
    full_q_max: float | None
    box_q: float
    box_corner_q: float


class DeltaPdfMetaOut(BaseModel):
    id: str
    shape: list[int]
    x_range: list[float]
    y_range: list[float]
    z_range: list[float]
    lattice: LatticeOut
    q_max: float | None
    planes: list[str]
    # The transform's window, from the ΔPDF's provenance (None if not recorded).
    window_shape: str | None = None
    window_scale: float | None = None
    window_open_weight: float | None = None


class BraggPeakWidthOut(BaseModel):
    index: int
    source_node_hkl: list[int] | None = None
    center_hkl: list[float]
    q_abs: float
    intensity: float | None = None
    local_background: float | None = None
    # Integrated excess over the resolution aperture, in standard errors.
    significance: float | None = None
    width_hkl: list[float]
    width_q: list[float]
    measured_width_hkl: list[float] | None = None
    measured_width_q: list[float] | None = None
    resolution_limited: list[bool] | None = None
    principal_width_hkl: list[float] | None = None
    principal_width_q: list[float] | None = None
    principal_directions_hkl: list[list[float]]
    fit_kind: str


class BraggProfileOut(BaseModel):
    dataset_id: str
    profile_path: str | None = None
    has_profile: bool
    schema_version: int = 1
    width_labels: list[str] = []
    hkl_width_labels: list[str] = []
    width_units: dict[str, str] = {}
    n_peaks: int = 0
    fit_covariance: bool = False
    punch_frame: str | None = None
    peaks: list[BraggPeakWidthOut] = []


class StageParamsIn(BaseModel):
    """Curated, optional per-stage overrides (None = use the validated default)."""

    # Voxel layers trimmed off the edge of the measured coverage at load (0 = none).
    edge_trim: int | None = None
    rings_n_patches: int | None = None
    rings_n_fourier: int | None = None
    rings_slice_axis: str | None = None
    # "pooled" (stack-pooled sector profiles) | "global_v2" (sample-only
    # global 3D) | "patched" (legacy per-patch) | "parametric" (legacy
    # separable Ring(|Q|) × Fourier texture).
    rings_model: str | None = None
    rings_ring_width: float | None = None
    rings_radial_mode: str | None = None
    rings_global_material: str | None = None
    rings_global_subtraction: str | None = None
    rings_global_confidence_z: float | None = None
    rings_global_angular_lmax: int | None = None
    rings_global_min_snr: float | None = None
    # "pooled": azimuthal sectors, and the stack-pooling half-width (degrees on
    # the ring sphere).
    rings_pooled_sectors: int | None = None
    rings_pooled_window_deg: float | None = None
    # The intensity floor of the "floors" integer-node test (data units).
    punch_min_intensity: float | None = None
    # Noise-aware detection gate (standard errors), the whole integer-node test
    # by default; 0 or below turns it off and the nodes fall back to the floors.
    punch_min_significance: float | None = None
    # "profile" (profile-matched punch) | "ellipsoid"; and the noise level (σ)
    # the profile-matched punch stops at.
    punch_footprint: str | None = None
    punch_profile_n_sigma: float | None = None
    punch_search_n_mad: float | None = None
    # The |Q|-shell search's intensity and prominence floors, as multiples of
    # the diffuse scatter (both; > 0).
    punch_search_floor: float | None = None
    # H planes the search leaves alone, as fractional parts of H (e.g. [1/3,
    # 2/3] for a q = (1/3, 0, 0) satellite family; [] protects none), and
    # their half width in r.l.u.
    punch_search_protect_h: list[float] | None = None
    punch_search_protect_half_width: float | None = None
    punch_search_max_width_ratio: float | None = None
    punch_mode: str | None = None
    # Supercell the volume is indexed on, per axis (≥ 1): integer-mode Bragg
    # nodes are the parent lattice's only.
    punch_supercell_h: int | None = None
    punch_supercell_k: int | None = None
    punch_supercell_l: int | None = None
    # Integer punches stop this far (r.l.u.) from their node's H plane; 0 or
    # below turns the guard off.
    punch_h_guard: float | None = None
    punch_margin: float | None = None
    punch_phi_tail_hkl: float | None = None
    # Q-space punch: frame "spherical" (default) = (rρ, rθ, rφ) in the local
    # spherical frame; frame "q" = isotropic or per-a*,b*,c* radius (Å^-1).
    punch_frame: str | None = None
    punch_q_radius: float | None = None
    punch_q_radius_a: float | None = None
    punch_q_radius_b: float | None = None
    punch_q_radius_c: float | None = None
    # Spherical-frame radii (Å^-1): rρ radial, rθ polar, rφ azimuth.
    punch_spherical_radius_rho: float | None = None
    punch_spherical_radius_theta: float | None = None
    punch_spherical_radius_phi: float | None = None
    incident_beam_q_radius_a: float | None = None
    incident_beam_q_radius_b: float | None = None
    incident_beam_q_radius_c: float | None = None
    incident_beam_q_margin: float | None = None
    # Legacy HKL direct-beam overrides kept for API compatibility.
    incident_beam_radius_h: float | None = None
    incident_beam_radius_k: float | None = None
    incident_beam_radius_l: float | None = None
    incident_beam_margin: float | None = None
    # Experimental diagnostic: do not floor/cap Bragg covariance-fit radii.
    punch_fit_unconstrained: bool | None = None
    # Fit a tilted covariance ellipsoid to the direct-beam remnant at the origin
    incident_beam_fit_covariance: bool | None = None
    backfill_method: str | None = None
    flatten_estimator: str | None = None
    flatten_floor_percentile: float | None = None
    # Magnetic ion of the flatten's const + c·F(Q)² model ("none": constant only)
    flatten_ion: str | None = None
    flatten_q2: bool | None = None
    flatten_fit_q_max: float | None = None
    pdf_apodization: str | None = None
    # ΔPDF window geometry: "auto" | "separable" | "ellipsoid"
    pdf_window_shape: str | None = None
    # Taper the ΔPDF window to the measured coverage (the input's mask)
    pdf_window_support: bool | None = None
    pdf_gaussian_sigma: float | None = None
    pdf_crop_h: float | None = None
    pdf_crop_k: float | None = None
    pdf_crop_l: float | None = None
    pdf_q_min: float | None = None
    pdf_q_max: float | None = None


class TuningTrialIn(BaseModel):
    """Run as one trial of a tuning run (outputs in its own folder)."""

    run_id: str
    trial: str  # "<stage>-<n>", e.g. "punch-2"


class PipelineRunRequest(BaseModel):
    dataset_id: str
    flatten_enabled: bool = True
    force: bool = False
    force_from: str | None = None
    stages: list[str] | None = None  # enabled-stage subset; None → all stages
    params: StageParamsIn = StageParamsIn()
    # A tuning trial: the stage runs into tuning/<run>/trials/<trial>/ and
    # reads its inputs from the run, never writing to processed/.
    tuning: TuningTrialIn | None = None


class TuningRunIn(BaseModel):
    dataset_id: str
    first_stage: str


class TuningRunOut(BaseModel):
    run_id: str
    dataset_id: str  # the run's chain, viewable as a dataset


class TuningPromoteIn(BaseModel):
    trial: str


class TuningPromoteOut(BaseModel):
    run_id: str
    trial: str
    files: list[str]
    dataset_id: str


class JobOut(BaseModel):
    id: str
    input: str
    status: str
    error: str | None = None
    n_events: int
