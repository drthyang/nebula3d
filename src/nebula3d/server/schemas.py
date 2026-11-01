# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Pydantic response models for the API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class StageStatusOut(BaseModel):
    name: str
    exists: bool
    kind: str            # "hkl" | "delta_pdf"
    volume_id: str       # "<dataset_id>.<stage>"
    mtime: float | None = None  # when the output was last written (POSIX s); None = no output
    source: str | None = None  # the ΔPDF only: the stage output (or "raw") it was made from


class RawFileOut(BaseModel):
    size: int            # bytes
    mtime: float | None  # POSIX s; None where it is not the file's own (browser copy)


class DatasetOut(BaseModel):
    id: str
    temperature: str | None
    raw_name: str
    stem: str
    stages: list[StageStatusOut]
    raw_file: RawFileOut | None = None  # None = the raw input is not on disk


class DataRootIn(BaseModel):
    data_root: str


class DataRootOut(BaseModel):
    data_root: str
    raw_exists: bool
    processed_exists: bool
    n_datasets: int


class ProcessMemoryOut(BaseModel):
    role: str  # "server" | "run" (a pipeline job's worker process)
    pid: int
    bytes: int
    peak_bytes: int | None = None


class MemoryOut(BaseModel):
    """nebula3d's processes against the machine's memory (server.memory)."""
    measured: bool
    kind: str | None = None  # "rss" (Linux) | "footprint" (macOS)
    used_bytes: int | None = None
    ceiling_bytes: int | None = None
    ceiling_source: str | None = None  # "ram" | "container"
    processes: list[ProcessMemoryOut] = []


class RegridIn(BaseModel):
    """Regrid a dataset onto its refined UB (see analysis.ub_regrid)."""
    cell: list[int] = [1, 1, 1]  # the Bragg nodes' spacing, (2, 2, 2) on a doubled cell
    q_max: float | None = None  # the nodes' |Q| limit, Å⁻¹ (default: the whole box)
    symmetrise: bool = False  # symmetrise the new volume under its operations


class RegridRefusalOut(BaseModel):
    """Why nothing was written: a code to act on, a reason to show."""
    code: str  # target_exists | symmetrised_without_source | turn_below_noise | cannot_symmetrise
    reason: str


class RegridOut(BaseModel):
    """A dataset regridded onto its refined UB as a new dataset, or why not."""
    id: str  # the dataset asked for
    written: bool
    refusal: RegridRefusalOut | None = None
    dataset_id: str | None = None  # the new dataset (or the existing one a refusal names)
    file: str | None = None  # ... its file, beside the raw one
    source_file: str  # the dataset's raw file
    refined_on: str | None = None  # whose peaks were fitted and data regridded
    fit: str | None = None
    operations: int | None = None
    operations_from: str | None = None
    source_symmetrised: bool | None = None
    symmetrised: bool = False  # the new file is symmetrised, and declares its operations
    turn_deg: float | None = None
    turn_threshold_deg: float  # the UB check's rule: a smaller turn is within the fit's noise
    axis_uvw: list[float] | None = None
    ub_start: list[list[float]] | None = None
    ub: list[list[float]] | None = None
    cell_start: list[float] | None = None
    cell: list[float] | None = None
    rms_start: float | None = None
    rms: float | None = None
    n_used: int | None = None
    measured_before: int | None = None
    measured_after: int | None = None
    # Measured before, unmeasured now: their Q fell outside the old grid.
    voxels_outside: int | None = None
    voxels_outside_share: float | None = None  # ... over measured_before


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
    # The point group the file declares its data were symmetrised with.
    symmetry: str | None = None
    symmetry_ops: list[list[list[int]]] | None = None
    # The Laue class declared *for* a file that declares none itself (by a
    # symmetrized export beside it naming it as its source, or a regrid's
    # record): {"symmetry", "symmetry_ops", "from"}, what the symmetry
    # average (stage 0) can take for it; None otherwise.
    declared_for: dict[str, Any] | None = None
    # "measured": σ came with the data; "estimated": √|I|, and sigma_note says
    # when that leaves a significance in σ meaningless (normalized values).
    sigma: str = "measured"
    sigma_note: str | None = None
    # The settings the flatten that wrote this file ran with (FlattenParams:
    # fit_q_range, floor_percentile, q_step, …; pipeline.read_flatten_settings),
    # or None: a stage the flatten did not write, or wrote before it recorded them.
    flatten_settings: dict[str, Any] | None = None


class CoverageOut(BaseModel):
    """Where a volume's counts begin and end in |Q| (see analysis.coverage)."""
    id: str
    q: list[float]
    counted: list[float]
    q_min_edge: float | None
    q_max_edge: float | None
    full_q_min: float | None
    full_q_max: float | None
    # Where the shells stop being fully measured (mask, finite): the ΔPDF
    # window's support, which a volume storing zeros for unmeasured space
    # carries past its counts.
    measured_q_max: float | None
    box_q: float
    box_corner_q: float
    q_step: float  # the shells' width (Å⁻¹): every edge is known to one shell


class RingShellOut(BaseModel):
    """One shell judged: does it rise in nearly every direction (a powder ring)?"""
    q_center: float | None
    fwhm: float | None
    n_cells: int
    median_height: float | None
    relative_height: float | None
    isotropy: float | None
    snr: float | None = None            # the height over its noise, in the typical cell
    beyond_curve: float | None = None   # the share of the height above a quadratic baseline
    is_ring: bool
    not_judged: str | None = None


class RingIsotropyOut(BaseModel):
    """Which shells of a volume are powder rings (see preprocessing.ring_isotropy)."""
    id: str
    rule: dict[str, float]
    shells: list[RingShellOut]
    not_judged: str | None = None   # why the grid is too coarse to judge any ring


class UnconfirmedRingsOut(BaseModel):
    """The shells the ring removal detected and could not confirm as powder
    rings on its grid, which it did not subtract (pipeline.unconfirmed_rings_notice)."""
    count: int
    needs: str                      # what the grid needs (ring_isotropy.grid_needs)
    notice: str                     # what the run log says of them
    q_centers: list[float] = []     # their |Q| (Å⁻¹)


class RingDiagnosticsOut(BaseModel):
    """The ring removal's record, from its diagnostics (see server.rings)."""
    dataset_id: str
    diagnostics_path: str
    has_diagnostics: bool
    status: str | None = None
    unconfirmed_at_grid: UnconfirmedRingsOut | None = None


class ShellFloorsOut(BaseModel):
    """The floor of every |Q| shell over the whole volume, and of the volume
    the flatten was given (see preprocessing.flatten_floors).  One entry per
    shell in each list; ``floors``, ``centres``, ``counts`` and ``totals`` are
    the Pilot's ``radialFloorShells`` fields."""
    id: str
    before_id: str | None           # the flatten's input, for the flattened stage
    q_step: float                   # shell width, Å⁻¹
    percentile: float               # the floor's percentile, 0–100
    min_count: int                  # fewer measured voxels: no floor
    q_edges: list[float]            # one more than the shells, Å⁻¹
    centres: list[float]            # Å⁻¹
    totals: list[int]               # the grid's voxels in the shell
    counts: list[int]               # ... measured (mask and finite)
    floors: list[float | None]
    medians: list[float | None]
    counts_before: list[int] | None = None
    floors_before: list[float | None] | None = None
    medians_before: list[float | None] | None = None
    level: float | None             # the diffuse level the floors' span is a share of
    level_count: int
    # The settings the flatten recorded in the file (FlattenParams: q_step,
    # floor_percentile, min_count, fit_q_range, q2_term, ion, …), or None.
    flatten: dict[str, Any] | None = None


class TextureHoleOut(BaseModel):
    """One punch hole's fill against the range its 3-D rim allows (see
    analysis.bragg_fill_texture); the values are ``None`` where it was not
    judged."""
    index: int                      # its place among the holes, C order of first voxels
    centre_hkl: list[float]         # the mean position of its voxels, r.l.u.
    voxels: int
    rim_voxels: int                 # measured, in no hole, left as they were by the fill
    fill: float | None              # the mean backfilled value over the hole
    level: float | None             # the rim's median: the local diffuse level
    sigma: float | None             # the rim's robust σ about its trend
    slope: float | None             # the trend's change per voxel outward
    edge: float | None              # the range the rim allows: its trend at the hole's edge ...
    peaked: float | None            # ... and continued linearly to the hole
    bias: float | None              # the fill's signed distance outside that range (0 inside)
    bias_sigma: float | None        # ... in the rim's σ
    bias_level: float | None        # ... in units of the local level
    not_judged: str | None = None   # "thin rim", "flat rim", "too large" or "no outside"


class TextureOut(BaseModel):
    """The Pilot's fill-bias check (texture.ts) on every punch hole of a
    backfilled stage, with its 3-D rim, against the dataset's punched stage
    (see analysis.bragg_fill_texture).  The summary's fields are texture.ts's
    ``TextureMetrics`` fill-bias fields, with the same meanings."""
    id: str
    punched_id: str                 # the punched stage the holes were read from
    holes_from: str                 # "punch_record" or "masks" (texture.ts's own test)
    rim: int                        # the rim's depth, voxels (texture.ts's RIM)
    min_rim: int                    # the fewest rim voxels a hole is judged with
    min_sigma: float                # the rule's limits: the median bias in rim σ, ...
    one_way: float                  # ... the share of the judged holes one way, ...
    min_holes: int                  # ... the fewest judged holes ...
    floor: float                    # ... and the median bias in units of the level
    n_holes: int
    n_judged: int
    judged: bool                    # room for the rims, n_judged ≥ min_holes: else not judged
    node_spacing: float | None = None  # voxels between neighbouring nodes of the grid's cell
    room_needed: float | None = None   # ... that the median hole's rim needs, 2·(reach + rim)
    not_judged: str | None = None   # why the grid is too coarse for the rule
    median_fill_bias_sigma: float | None
    median_fill_bias_level: float | None
    above_fraction: float | None
    below_fraction: float | None
    above_floor_fraction: float | None  # filled above their range by floor × level or more
    below_floor_fraction: float | None
    systematic_fill_bias: bool
    holes: list[TextureHoleOut]     # the `limit` holes farthest outside their range


class UbPassOut(BaseModel):
    q_max: float
    n_found: int
    n_used: int
    rms_start: float
    rms: float
    angle_deg: float


class UbRadialOut(BaseModel):
    q_lo: float
    q_hi: float | None
    direction: str
    n: int
    before: float
    after: float


class UbMeanOffsetOut(BaseModel):
    """The peak centres' mean offset (centre − node) in r.l.u. over the peaks
    the fit kept: with the volume's UB, with the refined one, and the standard
    error of the first (see analysis.ub_refine.mean_offset)."""
    before: list[float | None]
    after: list[float | None]
    standard_error: list[float | None]
    n: int


class UbCheckOut(BaseModel):
    """Whether a volume's UB puts its Bragg peaks on their nodes (see
    analysis.ub_refine)."""
    id: str
    fit: str
    cell_nodes: list[int]
    operations: int | None
    operations_from: str | None  # the file that declared them (this one, or its symmetrised export)
    symmetry_break: float | None
    symmetrised: bool | None
    passes: list[UbPassOut]
    n_searched: int
    n_used: int
    n_rejected: int
    rms_start: float
    rms: float
    angle_deg: float
    axis_uvw: list[float]
    cell_start: list[float]
    cell: list[float]
    transform: list[list[float]]
    ub_start: list[list[float]]
    ub: list[list[float]]
    radial: list[UbRadialOut]
    voxel_q: float | None = None  # the grid's finest step in Q (Å⁻¹)
    # The peak centres' mean offset from their nodes, r.l.u., before and after the fit.
    mean_offset_rlu: UbMeanOffsetOut | None = None


class LaueReadingOut(BaseModel):
    """R_int of one Laue class (or of whole |Q| shells) on one set of voxels
    (see analysis.laue_compare.Reading)."""
    r_int: float | None
    noise: float | None  # the noise floor: R_int from counting noise alone
    ratio: float | None  # r_int / noise
    ratio_se: float | None
    orbits: int  # orbits with two measured members or more
    voxels: int  # their measured members
    pairs: int  # pairs of measured equivalents they hold


class LaueVerdictOut(BaseModel):
    """What the rule made of a class in one reading."""
    supported: bool
    rises: bool  # its own rise fails the rule (not only a subgroup's)
    against: str | None  # the candidate subgroup it was weighed against
    rise: float | None  # its ratio over that subgroup's
    judged: bool = True


class LaueCandidateOut(BaseModel):
    laue: str
    generators: str
    order: int
    ops: str
    metric_change: float | None
    subgroups: list[str]
    maximal_subgroups: list[str]
    depth: int
    all: LaueReadingOut | None
    diffuse: LaueReadingOut | None
    verdict: dict[str, LaueVerdictOut | None]


class LaueRefusedOut(BaseModel):
    laue: str
    order: int
    reason: str  # "metric" | "grid"
    detail: str
    metric_change: float | None = None


class LaueRuleOut(BaseModel):
    delta: float
    z: float
    text: str


class LaueCompareOut(BaseModel):
    """Candidate Laue classes compared by R_int (analysis.laue_compare): the
    table, the classes refused, the |Q|-shell reference, the Bragg
    neighbourhood the diffuse reading leaves out, the rule and its suggestion."""
    id: str
    volume: str
    edge_trim: int
    candidates: list[LaueCandidateOut]
    refused: list[LaueRefusedOut]
    isotropic: dict[str, LaueReadingOut]
    bragg: dict[str, Any]
    measured: int
    sigma: str
    rule: LaueRuleOut
    readings: dict[str, dict[str, Any]]
    suggestion: str | None
    suggested_by: dict[str, str | None]
    reason: str
    disagreement: str | None
    notes: list[str]
    limits: str


class LaueProgressOut(BaseModel):
    fraction: float | None
    message: str
    running: bool


class DpdfFeatureGroupOut(BaseModel):
    """The copies of one correlation: extrema of one sign that are images of one
    another under the declared point group, or of one sign, length and size
    with none declared (see analysis.dpdf_features)."""
    sign: int
    length: float  # |r| of the strongest, Å
    size_sigma: float  # the largest |ΔPDF| in the group, in robust σ
    mean_size_sigma: float  # the mean |ΔPDF| of its n extrema, in robust σ
    value: float
    n: int  # extrema in the group, one per ± pair
    # With a declared symmetry, the orbit's distinct vectors, one per ± pair (n is
    # fewer when some are below the threshold or outside the volume); None without.
    multiplicity: int | None
    vectors: list[list[float]]  # (x, y, z) along a, b, c, Å, the strongest (representative) first
    vectors_rlu: list[list[float] | None]  # the same in lattice units
    sizes_sigma: list[float]


class DpdfFeaturesOut(BaseModel):
    """The ΔPDF's strongest extrema outside the origin's disk."""
    id: str
    sigma: float | None  # robust σ outside the origin's disk; None when it holds no data
    min_sigma: float
    origin_radius: float  # Å
    n_extrema: int
    # "declared symmetry (<label or operations>: <n> operations, r ≡ −r)", or
    # "sign, length and size (<why: none declared, or why it was not applied>)"
    grouped_by: str
    groups: list[DpdfFeatureGroupOut]


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
    # Which pass found it: "integer" (the node test) or "search"; a search peak
    # with a source node is the Bragg peak of a node the node test left to the
    # search. None in a profile written before the punch recorded it.
    found_by: str | None = None


class NodeTestOut(BaseModel):
    """The nodes whose background shell held fewer measured voxels than the
    Bragg punch's node test needs (server.bragg): with mode "both" not judged
    and left to the search pass, with mode "integer" judged provisionally."""
    examined: int                   # the nodes with a measured window
    under_floor: int                # of them, those whose shell was under min_voxels
    min_voxels: int                 # the shell median's floor
    voxel_q: float                  # a voxel, Å⁻¹ (the edge of a cube of its Q-volume)
    needs_q: float                  # the largest voxel that gives the shell min_voxels, Å⁻¹
    left_to_search: bool            # mode "both"; else judged provisionally
    notice: str | None = None       # what the run log says, on a grid too coarse (voxel > needs)


class ModulationRecordOut(BaseModel):
    """The punch's record of what its search left alone: the sample's declared
    modulation (Modulation.to_json, None for none), the indexing cell and the
    symmetry it was applied on, the legacy H planes (search_exclude_h_*, None
    for none), and whether the search's sharp peaks off the lattice bunched at
    one commensurate fraction (Bunching.to_json, None when they did not)."""

    declared: dict[str, Any] | None = None
    cell: list[int] | None = None
    symmetry_ops: list[list[list[int]]] | None = None
    legacy: dict[str, Any] | None = None
    bunching: dict[str, Any] | None = None


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
    # The nodes the node test could not judge, if any (pipeline.node_test_notice).
    node_test: NodeTestOut | None = None
    # What the search left alone and what it found (server.modulation.record_out);
    # None for a record written before the punch kept it.
    modulation: ModulationRecordOut | None = None


class ModulationPositionOut(BaseModel):
    """One position a declaration protects (nebula3d.modulation.Position):
    a plane family (its coordinate, centre and period) or a satellite about
    each node (its vector)."""

    label: str
    kind: str  # "plane" | "point"
    half_width: float
    coordinate: list[int] | None = None
    centre: str | None = None
    period: int | None = None
    vector: list[str] | None = None


class ModulationCheckIn(BaseModel):
    """A declaration to check: what StageParamsIn.modulation would hold (None:
    the pipeline's default; "none": nothing), the punch's indexing cell and the
    symmetry, as operation triplets or HKL matrices."""

    modulation: dict[str, Any] | str | None = None
    cell: list[int] | None = None
    symmetry_ops: list[list[list[int]]] | str | None = None


class ModulationCheckOut(BaseModel):
    ok: bool
    error: str | None = None
    default: bool = False  # the request named none: the pipeline's default
    declared: dict[str, Any] | None = None
    description: str | None = None
    positions: list[ModulationPositionOut] = []


class StageParamsIn(BaseModel):
    """Curated, optional per-stage overrides (None = use the validated default)."""

    # The cleanup stages' switches (the page's "Enable stage"; the flatten's is
    # the request's flatten_enabled).  False switches the stage off: it is not
    # run and its input passes through to the next stage, never an output an
    # earlier run left.  A stage merely left out of the request's `stages` is a
    # partial re-run instead, whose output on disk the next stage reads.
    # None: on.
    rings_enabled: bool | None = None
    punch_enabled: bool | None = None
    backfill_enabled: bool | None = None
    # Stage 0, the symmetry average (PipelineParams.symmetry_average): off
    # unless switched on (None: off).  Its Laue class, the sample's to
    # declare: a preset name ("6/mmm") or generators ("h+k,-h,l; -h,-k,-l");
    # whether an input that declares a symmetry already is averaged again; and
    # whether to proceed when the operations change the cell's metric by more
    # than 2 % (refused otherwise; the run then records a warning).
    symmetry_average_enabled: bool | None = None
    symmetry_average_laue: str | None = None
    symmetry_average_reaverage: bool | None = None
    symmetry_average_allow_metric_change: bool | None = None
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
    # The sample's modulation, a fact about the sample (PipelineParams.
    # modulation): its k vectors, order, form ("points" or "planes") and half
    # width, as Modulation.parse reads them (a mapping, or the k vectors as
    # text); "none" declares none.  None: the pipeline's default.
    modulation: dict[str, Any] | str | None = None
    # Legacy: H planes the search leaves alone, as fractional parts of H (e.g.
    # [1/3, 2/3]; [] protects none), and their half width in r.l.u.  Without a
    # modulation they say what is protected as before: the fractions replace
    # the default declaration, the half width alone sets its half width.  Not
    # with a modulation.
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
    # The stages to run in this call; None → all.  One left out is a partial
    # re-run (the stages after it read its output on disk); a stage switched
    # off is not run either way (flatten_enabled, params.*_enabled).
    stages: list[str] | None = None
    params: StageParamsIn = StageParamsIn()
    # A tuning trial: the stage runs into tuning/<run>/trials/<trial>/ and
    # reads its inputs from the run, never writing to processed/.
    tuning: TuningTrialIn | None = None


class StaleOutputsIn(BaseModel):
    """The Configure page's settings for a dataset, as a run would take them."""
    dataset_id: str
    flatten_enabled: bool = True
    params: StageParamsIn = StageParamsIn()


class StaleOutputsOut(BaseModel):
    """Each output on disk that a run with those settings would make again,
    and why (``ringremoved`` → "it was made with edge trim 1, now 2"); an
    output it would reuse, or that is missing, is not listed."""
    stale: dict[str, str]


class LaueCompareIn(BaseModel):
    """The run's settings (the edge trim, the punch cell and footprint), any
    custom classes to compare beside the presets, and a token to poll the
    progress under (GET .../laue-compare/progress)."""
    params: StageParamsIn = StageParamsIn()
    extra: list[str] = []
    token: str | None = None


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
