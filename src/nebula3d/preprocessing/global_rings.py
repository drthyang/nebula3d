# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Sample-only global 3D powder-ring inference.

This module deliberately does not require an empty-environment subtraction.  It
models only the narrow, persistent spherical-shell component of a reciprocal-
space volume and leaves the smooth background/diffuse component untouched.

The production model is intentionally conservative:

* rings are detected in a Bragg-robust global radial median;
* FCC Al positions are a weak identification prior, never a compulsory template;
* each shell has a full 3D angular amplitude field (real spherical harmonics),
  not an independent texture per H/K/L slice;
* angular amplitudes come from medians in equal-solid-angle cells, making sparse
  Bragg peaks unable to dominate the fit;
* model uncertainty is estimated from held angular-cell residuals; and
* the default subtraction removes ``mean - z * sigma``, retaining uncertain
  intensity instead of forcing a visually flat result.

It is a first Ring Removal 2.0 implementation: the result contract and diagnostics
are designed to remain stable while the optimizer and uncertainty model improve.
"""

from __future__ import annotations

import dataclasses
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.special import gammaln, lpmv

from nebula3d.core import HKLVolume
from nebula3d.preprocessing.parametric_ring import _pseudo_voigt
from nebula3d.preprocessing.radial_background import (
    _adaptive_ring_width_profile,
    _detect_rings,
    _estimate_baseline,
    _fill_nan_1d,
    _robust_radial_profile,
)

MaterialMode = Literal["auto", "aluminum", "generic"]
SubtractionPolicy = Literal["conservative", "mean", "diagnose_only"]


@dataclass(frozen=True)
class GlobalRingConfig:
    """Configuration for :func:`fit_global_rings`.

    ``material='auto'`` keeps every statistically supported powder shell and
    annotates those consistent with FCC Al.  ``'aluminum'`` keeps only Al-matched
    shells; ``'generic'`` does not use the Al prior.
    """

    q_min: float = 1.5
    q_max: float = 10.5
    q_step: float = 0.02
    max_fwhm: float = 0.24
    min_snr: float = 5.0
    material: MaterialMode = "auto"
    al_lattice_a: float = 4.0494
    al_match_tolerance: float = 0.12
    al_max_rms_q: float = 0.04
    al_lattice_rel_tolerance: float = 0.03
    min_al_lines: int = 3
    min_al_anchor_lines: int = 2
    angular_lmax: int = 4
    angular_ridge: float = 0.08
    angular_mu_bins: int = 12
    angular_phi_bins: int = 24
    min_angular_bin_count: int = 6
    pseudo_voigt_eta: float = 0.5
    subtraction: SubtractionPolicy = "conservative"
    confidence_z: float = 1.0
    min_angular_coverage: float = 0.15
    min_heldout_improvement: float = 0.20
    generic_snr_multiplier: float = 1.5
    max_profile_voxels: int = 3_000_000

    def __post_init__(self) -> None:
        if self.q_max <= self.q_min:
            raise ValueError("q_max must be greater than q_min")
        if self.q_step <= 0 or self.max_fwhm <= 0:
            raise ValueError("q_step and max_fwhm must be positive")
        if self.min_snr < 0:
            raise ValueError("min_snr must be non-negative")
        if self.material not in {"auto", "aluminum", "generic"}:
            raise ValueError("material must be 'auto', 'aluminum', or 'generic'")
        if self.subtraction not in {"conservative", "mean", "diagnose_only"}:
            raise ValueError(
                "subtraction must be 'conservative', 'mean', or 'diagnose_only'")
        if not 0 <= self.angular_lmax <= 8:
            raise ValueError("angular_lmax must be between 0 and 8")
        if self.angular_mu_bins < 2 or self.angular_phi_bins < 4:
            raise ValueError("angular grid is too small")
        if self.min_angular_bin_count < 1:
            raise ValueError("min_angular_bin_count must be positive")
        if self.confidence_z < 0:
            raise ValueError("confidence_z must be non-negative")
        if not 0.0 <= self.min_heldout_improvement < 1.0:
            raise ValueError("min_heldout_improvement must be in [0, 1)")
        if self.generic_snr_multiplier < 1.0:
            raise ValueError("generic_snr_multiplier must be at least 1")
        if self.max_profile_voxels < 1000:
            raise ValueError("max_profile_voxels must be at least 1000")
        if not 0.0 < self.al_lattice_rel_tolerance < 0.2:
            raise ValueError("al_lattice_rel_tolerance must be in (0, 0.2)")
        if self.min_al_lines < 1:
            raise ValueError("min_al_lines must be positive")
        if self.al_max_rms_q <= 0:
            raise ValueError("al_max_rms_q must be positive")
        if self.min_al_anchor_lines < 0:
            raise ValueError("min_al_anchor_lines must be non-negative")


@dataclass(frozen=True)
class AluminumLine:
    """One unique FCC Al powder line."""

    q: float
    n_hkl: int
    family: str


@dataclass
class GlobalRingShell:
    """Machine-readable fit summary for one powder shell."""

    q_center: float
    fwhm: float
    eta: float
    snr: float
    pooled_amplitude: float
    angular_amplitude_median: float
    angular_amplitude_max: float
    texture_contrast: float
    angular_lmax: int
    angular_coverage: float
    angular_residual_rms: float
    heldout_improvement: float
    heldout_rmse: float
    no_ring_rmse: float
    bright_arc_bias: float
    dim_arc_bias: float
    model_uncertainty_median: float
    material: str = "generic"
    al_family: str | None = None
    al_prior_q: float | None = None

    def to_dict(self) -> dict[str, object]:
        return dataclasses.asdict(self)


@dataclass
class GlobalRingDiagnostics:
    """Persistable global fit diagnostics (large model arrays excluded)."""

    algorithm: str = "global_v2"
    schema_version: int = 2
    status: str = "no_rings"
    material_mode: str = "auto"
    subtraction_policy: str = "conservative"
    fitted_al_lattice_a: float | None = None
    al_matched_lines: int = 0
    al_anchor_lines: int = 0
    al_rms_q: float | None = None
    n_detected_candidates: int = 0
    n_rejected_shells: int = 0
    n_fitted_shells: int = 0
    n_valid_voxels: int = 0
    n_profile_voxels: int = 0
    fit_seconds: float = 0.0
    removed_energy_fraction: float = 0.0
    negative_flip_fraction: float = 0.0
    median_angular_coverage: float = 0.0
    warnings: list[str] = field(default_factory=list)
    rejection_reasons: list[str] = field(default_factory=list)
    effective_config: dict[str, object] = field(default_factory=dict)
    shells: list[GlobalRingShell] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        out = dataclasses.asdict(self)
        out["shells"] = [s.to_dict() for s in self.shells]
        return out


@dataclass
class GlobalRingResult:
    """Full result of sample-only global ring inference."""

    cleaned: HKLVolume
    ring_mean: NDArray[np.float64]
    ring_sigma: NDArray[np.float64]
    subtracted: NDArray[np.float64]
    diagnostics: GlobalRingDiagnostics


def aluminum_fcc_lines(
    a: float = 4.0494, q_max: float = 10.5, q_min: float = 0.0,
) -> list[AluminumLine]:
    """Unique allowed FCC Al powder lines between ``q_min`` and ``q_max``.

    Reflections are allowed when h, k and l are all even or all odd.  Degenerate
    families sharing ``h²+k²+l²`` are represented by the conventional sorted
    non-negative triplet with the largest h first.
    """
    if a <= 0:
        raise ValueError("Al lattice parameter must be positive")
    hmax = int(np.ceil(q_max * a / (2.0 * np.pi))) + 1
    families: dict[int, list[tuple[int, int, int]]] = {}
    for h in range(hmax + 1):
        for k in range(h + 1):
            for l_ in range(k + 1):
                if h == k == l_ == 0:
                    continue
                if not (h % 2 == k % 2 == l_ % 2):
                    continue
                n = h * h + k * k + l_ * l_
                families.setdefault(n, []).append((h, k, l_))
    lines = []
    for n, hkls in sorted(families.items()):
        q = 2.0 * np.pi * np.sqrt(n) / a
        if q_min <= q <= q_max:
            labels = ["".join(str(v) for v in hkl) for hkl in hkls]
            lines.append(AluminumLine(q=float(q), n_hkl=n,
                                      family="/".join(labels)))
    return lines


def write_global_ring_diagnostics(
    diagnostics: GlobalRingDiagnostics | dict[str, object], path: str | Path,
) -> None:
    """Write the small, reproducible JSON sidecar for a global ring fit."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = diagnostics.to_dict() if isinstance(diagnostics, GlobalRingDiagnostics) \
        else diagnostics
    p.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def fit_global_rings(
    vol: HKLVolume, config: GlobalRingConfig | None = None,
) -> GlobalRingResult:
    """Infer and conservatively subtract global powder shells from ``vol``.

    The returned ``cleaned`` volume retains the original mask.  Its uncertainty
    includes the approximate ring-model uncertainty in quadrature.
    """
    started = time.perf_counter()
    cfg = config or GlobalRingConfig()
    q = vol.q_magnitude()
    valid = (vol.mask & np.isfinite(vol.data) & np.isfinite(vol.sigma)
             & (vol.sigma >= 0) & np.isfinite(q)
             & (q >= cfg.q_min) & (q <= cfg.q_max))
    diagnostics = GlobalRingDiagnostics(
        material_mode=cfg.material,
        subtraction_policy=cfg.subtraction,
        effective_config=dataclasses.asdict(cfg),
    )
    ring_mean = np.zeros(vol.shape, dtype=np.float64)
    ring_var = np.zeros(vol.shape, dtype=np.float64)

    n_valid = int(valid.sum())
    diagnostics.n_valid_voxels = n_valid

    def finish() -> GlobalRingResult:
        nonlocal q, valid
        diagnostics.fit_seconds = float(time.perf_counter() - started)
        q = np.array([], dtype=np.float64)
        valid = np.array([], dtype=bool)
        return _finish_result(vol, ring_mean, ring_var, diagnostics, cfg)

    if n_valid < 32:
        diagnostics.status = "failed"
        diagnostics.warnings.append("too few valid voxels in the requested Q range")
        return finish()

    edges = np.arange(cfg.q_min, cfg.q_max + cfg.q_step * 1.0001, cfg.q_step)
    if edges[-1] < cfg.q_max:
        edges = np.append(edges, cfg.q_max)
    q_grid = 0.5 * (edges[:-1] + edges[1:])
    profile_indices = _stratified_valid_indices(valid, cfg.max_profile_voxels)
    diagnostics.n_profile_voxels = int(profile_indices.size)
    pooled, counts = _robust_radial_profile(
        q.ravel()[profile_indices],
        np.asarray(vol.data, dtype=np.float64).ravel()[profile_indices], edges,
        (10.0, 80.0), min_per_bin=3, method="median")
    pooled_filled = _fill_nan_1d(pooled)
    adaptive_width = _adaptive_ring_width_profile(
        q_grid, pooled_filled, cfg.q_step, cfg.max_fwhm, 3.0, 0.9, counts)
    baseline = _estimate_baseline(
        pooled_filled, cfg.q_step, adaptive_width, smooth=0.04, method="snip")
    excess = np.maximum(pooled_filled - baseline, 0.0)
    centers, widths = _detect_rings(
        q_grid, pooled_filled, cfg.q_step, cfg.max_fwhm, counts)
    diagnostics.n_detected_candidates = int(centers.size)

    if centers.size == 0:
        return finish()

    noise = _profile_noise(excess, centers, widths, q_grid)
    amps = np.interp(centers, q_grid, excess)
    snr = amps / max(noise, 1e-12)
    keep = snr >= cfg.min_snr
    centers, widths, amps, snr = centers[keep], widths[keep], amps[keep], snr[keep]
    if centers.size == 0:
        diagnostics.warnings.append("radial candidates did not pass the SNR gate")
        return finish()

    al_matches, fitted_a, al_rms_q = _match_aluminum(centers, amps, cfg)
    diagnostics.fitted_al_lattice_a = fitted_a
    diagnostics.al_matched_lines = sum(m is not None for m in al_matches)
    diagnostics.al_anchor_lines = sum(
        m is not None and m.n_hkl in {3, 4, 8} for m in al_matches)
    diagnostics.al_rms_q = al_rms_q
    if cfg.material in {"auto", "generic"}:
        supported = np.array([
            match is not None or shell_snr >= cfg.min_snr * cfg.generic_snr_multiplier
            for match, shell_snr in zip(al_matches, snr)
        ], dtype=bool)
        rejected = int(np.count_nonzero(~supported))
        if rejected:
            diagnostics.n_rejected_shells += rejected
            diagnostics.rejection_reasons.append(
                f"{rejected} unmatched generic shell(s) failed the elevated SNR gate")
        centers, widths, amps, snr = (
            centers[supported], widths[supported], amps[supported], snr[supported])
        al_matches = [m for m, use in zip(al_matches, supported) if use]
        if centers.size == 0:
            diagnostics.warnings.append(
                "no candidate passed the material/elevated-generic evidence gate")
            return finish()
    if cfg.material == "aluminum":
        keep_al = np.array([m is not None for m in al_matches], dtype=bool)
        centers, widths, amps, snr = (
            centers[keep_al], widths[keep_al], amps[keep_al], snr[keep_al])
        al_matches = [m for m in al_matches if m is not None]
        if centers.size == 0:
            diagnostics.warnings.append("no detected shell matched the FCC Al prior")
            return finish()

    for q0, fwhm, pooled_amp, shell_snr, al_line in zip(
            centers, widths, amps, snr, al_matches):
        shell = _fit_one_shell(
            vol, q, valid, float(q0), float(fwhm), float(pooled_amp),
            float(shell_snr), q_grid, baseline, cfg, al_line)
        if shell is None:
            diagnostics.n_rejected_shells += 1
            diagnostics.rejection_reasons.append(
                f"q={float(q0):.6g}: insufficient angular support or held-out evidence")
            continue
        model_indices, model_values, sigma_values, summary = shell
        mean_flat = ring_mean.ravel()
        var_flat = ring_var.ravel()
        mean_flat[model_indices] += model_values
        var_flat[model_indices] += sigma_values * sigma_values
        diagnostics.shells.append(summary)

    diagnostics.n_fitted_shells = len(diagnostics.shells)
    if diagnostics.shells:
        coverage = np.array([s.angular_coverage for s in diagnostics.shells])
        diagnostics.median_angular_coverage = float(np.median(coverage))
        if np.any(coverage < cfg.min_angular_coverage):
            diagnostics.warnings.append(
                "one or more shells have weak solid-angle coverage")
        if cfg.material in {"auto", "aluminum"}:
            n_al = sum(s.material == "aluminum" for s in diagnostics.shells)
            if 0 < n_al < cfg.min_al_lines:
                evidence = ("only one shell supports" if n_al == 1
                            else f"only {n_al} shells support")
                diagnostics.warnings.append(
                    f"{evidence} the Al identification; "
                    f"at least {cfg.min_al_lines} are required for confident subtraction")
            if (n_al >= cfg.min_al_lines
                    and diagnostics.al_anchor_lines < cfg.min_al_anchor_lines):
                diagnostics.warnings.append(
                    f"only {diagnostics.al_anchor_lines} low-Q Al anchor line(s) "
                    f"matched; at least {cfg.min_al_anchor_lines} are required")
            if (n_al >= cfg.min_al_lines and diagnostics.al_rms_q is not None
                    and diagnostics.al_rms_q > cfg.al_max_rms_q):
                diagnostics.warnings.append(
                    f"Al line-family RMS mismatch {diagnostics.al_rms_q:.4g} Å⁻¹ "
                    f"exceeds {cfg.al_max_rms_q:.4g} Å⁻¹")
        if diagnostics.warnings:
            diagnostics.status = "ambiguous"
        elif cfg.subtraction == "conservative":
            diagnostics.status = "conservative"
        elif cfg.subtraction == "diagnose_only":
            diagnostics.status = "diagnostic"
        else:
            # "validated" is intentionally reserved for a future held-out/full-
            # resolution qualification gate, not merely a converged point fit.
            diagnostics.status = "fitted"
    else:
        diagnostics.status = "no_rings"
        diagnostics.warnings.append("no shell had enough angular support to fit")

    diagnostics.fit_seconds = float(time.perf_counter() - started)
    # Release the full coordinate grid and transient radial arrays before the
    # cleaned/model-uncertainty volumes are allocated in _finish_result. This is
    # the difference between fitting a 48 M-voxel volume inside and outside the
    # browser's 4 GB WASM heap.
    del q, valid, profile_indices, pooled, pooled_filled, adaptive_width, excess
    return _finish_result(vol, ring_mean, ring_var, diagnostics, cfg)


def _finish_result(
    vol: HKLVolume,
    ring_mean: NDArray[np.float64],
    ring_var: NDArray[np.float64],
    diagnostics: GlobalRingDiagnostics,
    cfg: GlobalRingConfig,
) -> GlobalRingResult:
    np.maximum(ring_var, 0.0, out=ring_var)
    np.sqrt(ring_var, out=ring_var)
    ring_sigma = ring_var
    if cfg.subtraction == "diagnose_only":
        subtracted = np.zeros_like(ring_mean)
    elif cfg.subtraction == "mean":
        subtracted = ring_mean.copy()
    elif diagnostics.status == "ambiguous":
        # Ambiguity is a scientific result, not permission to make the volume
        # look cleaner. The explicit `mean` policy remains available as a user
        # override; conservative mode retains all intensity.
        subtracted = np.zeros_like(ring_mean)
    else:
        subtracted = np.maximum(ring_mean - cfg.confidence_z * ring_sigma, 0.0)

    cleaned_data = np.asarray(vol.data, dtype=np.float64) - subtracted
    propagated_sigma = np.where(subtracted > 0, ring_sigma, 0.0)
    cleaned_sigma = np.hypot(np.asarray(vol.sigma, dtype=np.float64), propagated_sigma)
    cleaned = dataclasses.replace(vol, data=cleaned_data, sigma=cleaned_sigma)

    denom = _masked_abs_sum(vol.data, vol.mask)
    diagnostics.removed_energy_fraction = (
        _masked_sum(subtracted, vol.mask) / denom if denom > 0 else 0.0)
    diagnostics.negative_flip_fraction = _negative_flip_fraction(
        vol.data, cleaned_data, vol.mask)
    return GlobalRingResult(
        cleaned=cleaned, ring_mean=ring_mean, ring_sigma=ring_sigma,
        subtracted=subtracted, diagnostics=diagnostics)


def _masked_abs_sum(data: NDArray, mask: NDArray[np.bool_]) -> float:
    total = 0.0
    flat_data, flat_mask = data.ravel(), mask.ravel()
    for start in range(0, flat_data.size, 1_000_000):
        d = flat_data[start:start + 1_000_000]
        m = flat_mask[start:start + 1_000_000] & np.isfinite(d)
        if np.any(m):
            total += float(np.sum(np.abs(d[m])))
    return total


def _masked_sum(data: NDArray, mask: NDArray[np.bool_]) -> float:
    total = 0.0
    flat_data, flat_mask = data.ravel(), mask.ravel()
    for start in range(0, flat_data.size, 1_000_000):
        d = flat_data[start:start + 1_000_000]
        m = flat_mask[start:start + 1_000_000] & np.isfinite(d)
        if np.any(m):
            total += float(np.sum(d[m]))
    return total


def _negative_flip_fraction(
    before: NDArray, after: NDArray, mask: NDArray[np.bool_],
) -> float:
    flipped = positives = 0
    bflat, aflat, mflat = before.ravel(), after.ravel(), mask.ravel()
    for start in range(0, bflat.size, 1_000_000):
        b = bflat[start:start + 1_000_000]
        a = aflat[start:start + 1_000_000]
        valid = mflat[start:start + 1_000_000] & np.isfinite(b) & np.isfinite(a)
        pos = valid & (b > 0)
        positives += int(np.count_nonzero(pos))
        flipped += int(np.count_nonzero(pos & (a < 0)))
    return flipped / positives if positives else 0.0


def _stratified_valid_indices(
    valid: NDArray[np.bool_], max_voxels: int,
) -> NDArray[np.intp]:
    """Deterministically sample valid flat indices with bounded peak memory.

    Sampling every ``ceil(n_valid/max_voxels)``-th *valid* voxel (rather than
    every n-th array position) avoids bias from regular missing wedges/masks.
    The volume is scanned in small chunks so a sparse 48 M-voxel mask never
    creates a volume-sized int64 index array.
    """
    flat = valid.ravel()
    n_valid = int(np.count_nonzero(flat))
    if n_valid <= max_voxels:
        return np.flatnonzero(flat).astype(np.intp, copy=False)
    stride = int(np.ceil(n_valid / max_voxels))
    selected: list[NDArray[np.intp]] = []
    seen = 0
    chunk_size = 1_000_000
    for start in range(0, flat.size, chunk_size):
        local = np.flatnonzero(flat[start:start + chunk_size]).astype(np.intp)
        if local.size:
            ordinal = seen + np.arange(local.size, dtype=np.int64)
            keep = ordinal % stride == 0
            if np.any(keep):
                selected.append(local[keep] + start)
            seen += int(local.size)
    if not selected:
        return np.array([], dtype=np.intp)
    return np.concatenate(selected).astype(np.intp, copy=False)


def _profile_noise(
    excess: NDArray[np.float64], centers: NDArray[np.float64],
    widths: NDArray[np.float64], q_grid: NDArray[np.float64],
) -> float:
    off = np.ones(excess.size, dtype=bool)
    for q0, width in zip(centers, widths):
        off &= np.abs(q_grid - q0) > max(2.0 * width, 0.08)
    sample = excess[off] if np.count_nonzero(off) >= 8 else np.diff(excess)
    med = float(np.median(sample)) if sample.size else 0.0
    mad = float(np.median(np.abs(sample - med))) if sample.size else 0.0
    return max(1.4826 * mad, float(np.std(sample)) * 0.25 if sample.size else 0.0,
               1e-9)


def _match_aluminum(
    centers: NDArray[np.float64], amps: NDArray[np.float64], cfg: GlobalRingConfig,
) -> tuple[list[AluminumLine | None], float | None, float | None]:
    if cfg.material == "generic":
        return [None] * centers.size, None, None
    nominal = aluminum_fcc_lines(
        cfg.al_lattice_a, cfg.q_max + cfg.al_match_tolerance,
        max(0.0, cfg.q_min - cfg.al_match_tolerance))
    if not nominal:
        return [None] * centers.size, None, None

    # Joint one-to-one assignment under one shared lattice parameter. Independent
    # nearest-line matching is unsafe at high Q, where ±0.12 Å⁻¹ windows cover a
    # large fraction of the axis and multiple noise peaks can claim the same line.
    a_lo = cfg.al_lattice_a * (1.0 - cfg.al_lattice_rel_tolerance)
    a_hi = cfg.al_lattice_a * (1.0 + cfg.al_lattice_rel_tolerance)
    trials = [cfg.al_lattice_a]
    for q0 in centers:
        for line in nominal:
            a_trial = 2.0 * np.pi * np.sqrt(line.n_hkl) / float(q0)
            if a_lo <= a_trial <= a_hi:
                trials.append(float(a_trial))

    best_pairs: list[tuple[int, int, float]] = []
    best_score = (-1, -np.inf)
    for a_trial in trials:
        predicted = np.array([
            2.0 * np.pi * np.sqrt(line.n_hkl) / a_trial for line in nominal])
        pairs = _greedy_unique_matches(centers, predicted, cfg.al_match_tolerance)
        weighted_quality = sum(
            float(amps[i]) * (1.0 - dist / cfg.al_match_tolerance)
            for i, _j, dist in pairs)
        score = (len(pairs), weighted_quality)
        if score > best_score:
            best_score, best_pairs = score, pairs

    if not best_pairs:
        return [None] * centers.size, None, None

    fitted_as = np.array([
        2.0 * np.pi * np.sqrt(nominal[j].n_hkl) / float(centers[i])
        for i, j, _dist in best_pairs])
    fitted_weights = np.array([max(float(amps[i]), 1e-12)
                               for i, _j, _dist in best_pairs])
    a = _weighted_median(fitted_as, fitted_weights)
    predicted = np.array([
        2.0 * np.pi * np.sqrt(line.n_hkl) / a for line in nominal])
    best_pairs = _greedy_unique_matches(centers, predicted, cfg.al_match_tolerance)

    matches: list[AluminumLine | None] = [None] * centers.size
    residuals: list[float] = []
    for i, j, _dist in best_pairs:
        line = nominal[j]
        q_fit = float(2.0 * np.pi * np.sqrt(line.n_hkl) / a)
        matches[i] = AluminumLine(q=q_fit, n_hkl=line.n_hkl, family=line.family)
        residuals.append(float(centers[i] - q_fit))

    # Re-label prior positions at the fitted lattice constant while retaining the
    # observed q center for subtraction (the prior identifies; data locate).
    rms_q = float(np.sqrt(np.mean(np.square(residuals)))) if residuals else None
    return matches, float(a), rms_q


def _greedy_unique_matches(
    observed: NDArray[np.float64], predicted: NDArray[np.float64], tolerance: float,
) -> list[tuple[int, int, float]]:
    candidates = sorted(
        (float(abs(q_obs - q_pred)), i, j)
        for i, q_obs in enumerate(observed)
        for j, q_pred in enumerate(predicted)
        if abs(q_obs - q_pred) <= tolerance)
    used_observed: set[int] = set()
    used_predicted: set[int] = set()
    pairs: list[tuple[int, int, float]] = []
    for distance, i, j in candidates:
        if i in used_observed or j in used_predicted:
            continue
        used_observed.add(i)
        used_predicted.add(j)
        pairs.append((i, j, distance))
    return pairs


def _weighted_median(values: NDArray[np.float64], weights: NDArray[np.float64]) -> float:
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cutoff = 0.5 * float(np.sum(w))
    return float(v[min(int(np.searchsorted(np.cumsum(w), cutoff)), v.size - 1)])


def _fit_one_shell(
    vol: HKLVolume,
    q: NDArray[np.float64],
    valid: NDArray[np.bool_],
    q0: float,
    fwhm: float,
    pooled_amp: float,
    snr: float,
    q_grid: NDArray[np.float64],
    baseline: NDArray[np.float64],
    cfg: GlobalRingConfig,
    al_line: AluminumLine | None,
) -> tuple[NDArray[np.intp], NDArray[np.float64], NDArray[np.float64],
           GlobalRingShell] | None:
    fwhm = max(fwhm, cfg.q_step)
    support = valid & (np.abs(q - q0) <= max(3.0 * fwhm, 2.0 * cfg.q_step))
    indices = np.flatnonzero(support)
    if indices.size < cfg.min_angular_bin_count * 4:
        return None

    q_shell = q.ravel()[indices]
    profile = _pseudo_voigt(q_shell, q0, fwhm, cfg.pseudo_voigt_eta)
    core = profile >= 0.35
    if np.count_nonzero(core) < cfg.min_angular_bin_count * 4:
        return None

    directions = _directions_for_flat_indices(vol, indices)
    data = np.asarray(vol.data, dtype=np.float64).ravel()[indices]
    input_sigma = np.asarray(vol.sigma, dtype=np.float64).ravel()[indices]
    base = np.interp(q_shell, q_grid, baseline)
    amplitude_samples = (data - base) / np.maximum(profile, 0.35)
    amplitude_sigma = input_sigma / np.maximum(profile, 0.35)

    # Start at the requested angular resolution, then coarsen only if incomplete
    # reciprocal-space coverage leaves too few populated cells. This preserves a
    # global 3D fit for thin slabs without inventing values in missing directions.
    angular_fit = None
    basis: NDArray[np.float64] | None = None
    degrees: NDArray[np.float64] | None = None
    fitted_lmax = 0
    n_mu, n_phi = cfg.angular_mu_bins, cfg.angular_phi_bins
    # Reduce angular degree before accepting an underdetermined fit. Ridge
    # regularization stabilizes weak harmonics; it is not a substitute for data.
    for trial_lmax in range(cfg.angular_lmax, -1, -1):
        trial_basis, trial_degrees = _real_spherical_basis(directions, trial_lmax)
        required_cells = max(4, trial_basis.shape[1] + 2)
        trial_mu, trial_phi = cfg.angular_mu_bins, cfg.angular_phi_bins
        while True:
            candidate = _angular_cell_observations(
                directions, trial_basis, amplitude_samples, amplitude_sigma, core,
                trial_mu, trial_phi, cfg.min_angular_bin_count)
            if len(candidate[1]) >= required_cells:
                angular_fit = candidate
                basis, degrees = trial_basis, trial_degrees
                fitted_lmax = trial_lmax
                n_mu, n_phi = trial_mu, trial_phi
                break
            if trial_mu <= 2 and trial_phi <= 4:
                break
            trial_mu, trial_phi = max(2, trial_mu // 2), max(4, trial_phi // 2)
        if angular_fit is not None:
            break
    if angular_fit is None:
        return None
    assert basis is not None and degrees is not None

    cell_rows, cell_amp, cell_weight, _cell_sigma = angular_fit
    n_cells = n_mu * n_phi
    X = np.asarray(cell_rows)
    y = np.asarray(cell_amp)
    w = np.asarray(cell_weight)
    # Prevent a nearly noiseless cell from monopolizing the solve.
    w = np.minimum(w, np.percentile(w, 90))
    heldout_improvement, heldout_rmse, no_ring_rmse = _cross_validate_angular(
        X, y, w, degrees, cfg.angular_ridge)
    if heldout_improvement < cfg.min_heldout_improvement:
        return None
    beta, covariance, residual_scale = _ridge_irls(
        X, y, w, degrees, cfg.angular_ridge)
    amplitude = np.maximum(basis @ beta, 0.0)
    # A robust physical ceiling guards against broad crystal features that occupy
    # one angular sector. The ceiling is generous enough to retain strong texture.
    ceiling = max(4.0 * pooled_amp, 1.5 * float(np.percentile(y, 95)), 1e-12)
    amplitude = np.minimum(amplitude, ceiling)
    positive_amplitude = amplitude[amplitude > 0]
    if positive_amplitude.size:
        p10, p50, p90 = np.percentile(positive_amplitude, (10, 50, 90))
        texture_contrast = float((p90 - p10) / max(p50, 1e-12))
    else:
        texture_contrast = 0.0
    model = amplitude * profile

    pred_var = np.einsum("ij,jk,ik->i", basis, covariance, basis)
    mean_residual_var = residual_scale ** 2 / max(len(y), 1)
    amp_sigma = np.sqrt(np.maximum(pred_var, 0.0) + mean_residual_var)
    model_sigma = amp_sigma * profile
    coverage = len(cell_amp) / n_cells
    fitted_at_cells = np.maximum(X @ beta, 0.0)
    residual_rms = float(np.sqrt(np.mean((fitted_at_cells - y) ** 2)))
    normalized_cell_residual = (fitted_at_cells - y) / max(pooled_amp, 1e-12)
    split = y >= np.median(y)
    bright_bias = float(np.median(normalized_cell_residual[split])) \
        if np.any(split) else 0.0
    dim_bias = float(np.median(normalized_cell_residual[~split])) \
        if np.any(~split) else 0.0
    summary = GlobalRingShell(
        q_center=q0,
        fwhm=fwhm,
        eta=cfg.pseudo_voigt_eta,
        snr=snr,
        pooled_amplitude=pooled_amp,
        angular_amplitude_median=float(np.median(amplitude)),
        angular_amplitude_max=float(np.max(amplitude)),
        texture_contrast=texture_contrast,
        angular_lmax=fitted_lmax,
        angular_coverage=float(coverage),
        angular_residual_rms=residual_rms,
        heldout_improvement=heldout_improvement,
        heldout_rmse=heldout_rmse,
        no_ring_rmse=no_ring_rmse,
        bright_arc_bias=bright_bias,
        dim_arc_bias=dim_bias,
        model_uncertainty_median=float(np.median(model_sigma)),
        material="aluminum" if al_line is not None else "generic",
        al_family=al_line.family if al_line is not None else None,
        al_prior_q=al_line.q if al_line is not None else None,
    )
    return indices, model, model_sigma, summary


def _directions_for_flat_indices(
    vol: HKLVolume, indices: NDArray[np.intp],
) -> NDArray[np.float64]:
    ih, ik, il = np.unravel_index(indices, vol.shape)
    hkl = np.column_stack((vol.h_axis[ih], vol.k_axis[ik], vol.l_axis[il]))
    qvec = hkl @ np.asarray(vol.ub_matrix, dtype=np.float64).T
    norm = np.linalg.norm(qvec, axis=1)
    return qvec / np.maximum(norm[:, None], 1e-15)


def _angular_cell_ids(
    directions: NDArray[np.float64], n_mu: int, n_phi: int,
) -> NDArray[np.int32]:
    mu = np.clip(directions[:, 2], -1.0, 1.0)
    phi = np.mod(np.arctan2(directions[:, 1], directions[:, 0]), 2.0 * np.pi)
    im = np.minimum(((mu + 1.0) * 0.5 * n_mu).astype(int), n_mu - 1)
    ip = np.minimum((phi / (2.0 * np.pi) * n_phi).astype(int), n_phi - 1)
    return np.asarray(im * n_phi + ip, dtype=np.int32)


def _angular_cell_observations(
    directions: NDArray[np.float64],
    basis: NDArray[np.float64],
    amplitude_samples: NDArray[np.float64],
    amplitude_sigma: NDArray[np.float64],
    core: NDArray[np.bool_],
    n_mu: int,
    n_phi: int,
    min_count: int,
) -> tuple[list[NDArray[np.float64]], list[float], list[float], list[float]]:
    cell_ids = _angular_cell_ids(directions, n_mu, n_phi)
    rows: list[NDArray[np.float64]] = []
    amplitudes: list[float] = []
    weights: list[float] = []
    uncertainties: list[float] = []
    for cell in range(n_mu * n_phi):
        take = core & (cell_ids == cell)
        n = int(np.count_nonzero(take))
        if n < min_count:
            continue
        vals = amplitude_samples[take]
        med = float(np.median(vals))
        mad = float(np.median(np.abs(vals - med)))
        sigma_mean = float(np.sqrt(np.mean(amplitude_sigma[take] ** 2) / n))
        robust_mean = 1.4826 * mad / np.sqrt(n)
        combined = max(sigma_mean, robust_mean, 1e-6)
        rows.append(np.mean(basis[take], axis=0))
        amplitudes.append(max(med, 0.0))
        weights.append(1.0 / combined ** 2)
        uncertainties.append(combined)
    return rows, amplitudes, weights, uncertainties


def _real_spherical_basis(
    directions: NDArray[np.float64], lmax: int,
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Orthonormal real spherical harmonics through degree ``lmax``."""
    z = np.clip(directions[:, 2], -1.0, 1.0)
    phi = np.arctan2(directions[:, 1], directions[:, 0])
    cols: list[NDArray[np.float64]] = []
    degrees: list[float] = []
    for ell in range(lmax + 1):
        for m in range(-ell, ell + 1):
            am = abs(m)
            log_norm = 0.5 * (
                np.log((2.0 * ell + 1.0) / (4.0 * np.pi))
                + gammaln(ell - am + 1.0) - gammaln(ell + am + 1.0))
            col = np.exp(log_norm) * lpmv(am, ell, z)
            if m < 0:
                col = np.sqrt(2.0) * col * np.sin(am * phi)
            elif m > 0:
                col = np.sqrt(2.0) * col * np.cos(am * phi)
            cols.append(np.asarray(col, dtype=np.float64))
            degrees.append(float(ell))
    return np.column_stack(cols), np.asarray(degrees)


def _cross_validate_angular(
    X: NDArray[np.float64], y: NDArray[np.float64], w: NDArray[np.float64],
    degrees: NDArray[np.float64], ridge: float,
) -> tuple[float, float, float]:
    """Deterministic angular-cell cross-validation against a no-ring model."""
    n = len(y)
    if n < 4 or not np.any(y > 0):
        return 0.0, float("inf"), float(np.sqrt(np.mean(y * y)))
    n_folds = min(4, max(2, n // 4))
    order = np.argsort(np.argmax(np.abs(X[:, 1:]), axis=1)) \
        if X.shape[1] > 1 else np.arange(n)
    fold_id = np.empty(n, dtype=int)
    fold_id[order] = np.arange(n) % n_folds
    model_sse = zero_sse = weight_sum = 0.0
    for fold in range(n_folds):
        test = fold_id == fold
        train = ~test
        if np.count_nonzero(train) < X.shape[1] or not np.any(test):
            continue
        beta, _cov, _scale = _ridge_irls(
            X[train], y[train], w[train], degrees, ridge)
        pred = np.maximum(X[test] @ beta, 0.0)
        wt = w[test]
        model_sse += float(np.sum(wt * (pred - y[test]) ** 2))
        zero_sse += float(np.sum(wt * y[test] ** 2))
        weight_sum += float(np.sum(wt))
    if weight_sum <= 0 or zero_sse <= 1e-20:
        return 0.0, float("inf"), float("inf")
    improvement = float(np.clip(1.0 - model_sse / zero_sse, -1.0, 1.0))
    return improvement, float(np.sqrt(model_sse / weight_sum)), \
        float(np.sqrt(zero_sse / weight_sum))


def _ridge_irls(
    X: NDArray[np.float64], y: NDArray[np.float64], w: NDArray[np.float64],
    degrees: NDArray[np.float64], ridge: float,
) -> tuple[NDArray[np.float64], NDArray[np.float64], float]:
    robust = np.ones_like(y)
    beta = np.zeros(X.shape[1], dtype=np.float64)
    lhs = np.eye(X.shape[1])
    for _ in range(4):
        ww = w * robust
        xtwx = X.T @ (ww[:, None] * X)
        scale = max(float(np.trace(xtwx)) / max(X.shape[1], 1), 1e-12)
        penalty = ridge * scale * degrees * (degrees + 1.0)
        penalty[0] = max(penalty[0], 1e-12)
        lhs = xtwx + np.diag(penalty)
        rhs = X.T @ (ww * y)
        try:
            beta = np.linalg.solve(lhs, rhs)
        except np.linalg.LinAlgError:
            beta = np.linalg.lstsq(lhs, rhs, rcond=None)[0]
        resid = y - X @ beta
        med = float(np.median(resid))
        mad = max(1.4826 * float(np.median(np.abs(resid - med))), 1e-12)
        u = np.abs(resid - med) / (1.5 * mad)
        robust = np.ones_like(u)
        high = u > 1.0
        robust[high] = 1.0 / u[high]
    resid = y - X @ beta
    residual_scale = max(
        1.4826 * float(np.median(np.abs(resid - np.median(resid)))), 1e-12)
    bread = np.linalg.pinv(lhs)
    # Known-variance WLS covariance plus a heteroscedastic robust sandwich.
    # Unlike multiplying bread by a raw residual variance, both terms retain
    # amplitude² units when w=1/sigma² and respond correctly to input sigma.
    data_hessian = X.T @ (ww[:, None] * X)
    measurement_cov = bread @ data_hessian @ bread
    score = ww * resid
    meat = X.T @ ((score * score)[:, None] * X)
    sandwich = bread @ meat @ bread
    covariance = np.asarray(measurement_cov + sandwich, dtype=np.float64)
    return np.asarray(beta, dtype=np.float64), covariance, residual_scale


__all__ = [
    "AluminumLine",
    "GlobalRingConfig",
    "GlobalRingDiagnostics",
    "GlobalRingResult",
    "GlobalRingShell",
    "aluminum_fcc_lines",
    "fit_global_rings",
    "write_global_ring_diagnostics",
]
