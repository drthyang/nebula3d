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
    angular_lmax: int = 4
    angular_ridge: float = 0.08
    angular_mu_bins: int = 12
    angular_phi_bins: int = 24
    min_angular_bin_count: int = 6
    pseudo_voigt_eta: float = 0.5
    subtraction: SubtractionPolicy = "conservative"
    confidence_z: float = 1.0
    min_angular_coverage: float = 0.15

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
    angular_lmax: int
    angular_coverage: float
    angular_residual_rms: float
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
    schema_version: int = 1
    status: str = "no_rings"
    material_mode: str = "auto"
    subtraction_policy: str = "conservative"
    fitted_al_lattice_a: float | None = None
    n_detected_candidates: int = 0
    n_fitted_shells: int = 0
    removed_energy_fraction: float = 0.0
    negative_flip_fraction: float = 0.0
    median_angular_coverage: float = 0.0
    warnings: list[str] = field(default_factory=list)
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
    cfg = config or GlobalRingConfig()
    q = vol.q_magnitude()
    valid = (vol.mask & np.isfinite(vol.data) & np.isfinite(q)
             & (q >= cfg.q_min) & (q <= cfg.q_max))
    diagnostics = GlobalRingDiagnostics(
        material_mode=cfg.material, subtraction_policy=cfg.subtraction)
    ring_mean = np.zeros(vol.shape, dtype=np.float64)
    ring_var = np.zeros(vol.shape, dtype=np.float64)

    if int(valid.sum()) < 32:
        diagnostics.status = "failed"
        diagnostics.warnings.append("too few valid voxels in the requested Q range")
        return _finish_result(vol, ring_mean, ring_var, diagnostics, cfg)

    edges = np.arange(cfg.q_min, cfg.q_max + cfg.q_step * 1.0001, cfg.q_step)
    if edges[-1] < cfg.q_max:
        edges = np.append(edges, cfg.q_max)
    q_grid = 0.5 * (edges[:-1] + edges[1:])
    pooled, counts = _robust_radial_profile(
        q[valid], np.asarray(vol.data[valid], dtype=np.float64), edges,
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
        return _finish_result(vol, ring_mean, ring_var, diagnostics, cfg)

    noise = _profile_noise(excess, centers, widths, q_grid)
    amps = np.interp(centers, q_grid, excess)
    snr = amps / max(noise, 1e-12)
    keep = snr >= cfg.min_snr
    centers, widths, amps, snr = centers[keep], widths[keep], amps[keep], snr[keep]
    if centers.size == 0:
        diagnostics.warnings.append("radial candidates did not pass the SNR gate")
        return _finish_result(vol, ring_mean, ring_var, diagnostics, cfg)

    al_matches, fitted_a = _match_aluminum(centers, amps, cfg)
    diagnostics.fitted_al_lattice_a = fitted_a
    if cfg.material == "aluminum":
        keep_al = np.array([m is not None for m in al_matches], dtype=bool)
        centers, widths, amps, snr = (
            centers[keep_al], widths[keep_al], amps[keep_al], snr[keep_al])
        al_matches = [m for m in al_matches if m is not None]
        if centers.size == 0:
            diagnostics.warnings.append("no detected shell matched the FCC Al prior")
            return _finish_result(vol, ring_mean, ring_var, diagnostics, cfg)

    for q0, fwhm, pooled_amp, shell_snr, al_line in zip(
            centers, widths, amps, snr, al_matches):
        shell = _fit_one_shell(
            vol, q, valid, float(q0), float(fwhm), float(pooled_amp),
            float(shell_snr), q_grid, baseline, cfg, al_line)
        if shell is None:
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
            if n_al == 1:
                diagnostics.warnings.append(
                    "only one shell supports the Al identification; treat it as tentative")
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

    return _finish_result(vol, ring_mean, ring_var, diagnostics, cfg)


def _finish_result(
    vol: HKLVolume,
    ring_mean: NDArray[np.float64],
    ring_var: NDArray[np.float64],
    diagnostics: GlobalRingDiagnostics,
    cfg: GlobalRingConfig,
) -> GlobalRingResult:
    ring_sigma = np.sqrt(np.maximum(ring_var, 0.0))
    if cfg.subtraction == "diagnose_only":
        subtracted = np.zeros_like(ring_mean)
    elif cfg.subtraction == "mean":
        subtracted = ring_mean.copy()
    else:
        subtracted = np.maximum(ring_mean - cfg.confidence_z * ring_sigma, 0.0)

    cleaned_data = np.asarray(vol.data, dtype=np.float64) - subtracted
    cleaned_sigma = np.sqrt(np.asarray(vol.sigma, dtype=np.float64) ** 2 + ring_var)
    cleaned = dataclasses.replace(vol, data=cleaned_data, sigma=cleaned_sigma)

    valid = vol.mask & np.isfinite(vol.data)
    denom = float(np.sum(np.abs(vol.data[valid]))) if valid.any() else 0.0
    diagnostics.removed_energy_fraction = (
        float(np.sum(subtracted[valid])) / denom if denom > 0 else 0.0)
    pos = valid & (vol.data > 0)
    diagnostics.negative_flip_fraction = (
        float(np.mean(cleaned_data[pos] < 0)) if pos.any() else 0.0)
    return GlobalRingResult(
        cleaned=cleaned, ring_mean=ring_mean, ring_sigma=ring_sigma,
        subtracted=subtracted, diagnostics=diagnostics)


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
) -> tuple[list[AluminumLine | None], float | None]:
    if cfg.material == "generic":
        return [None] * centers.size, None
    nominal = aluminum_fcc_lines(
        cfg.al_lattice_a, cfg.q_max + cfg.al_match_tolerance,
        max(0.0, cfg.q_min - cfg.al_match_tolerance))
    if not nominal:
        return [None] * centers.size, None
    q_nom = np.array([line.q for line in nominal])
    matches: list[AluminumLine | None] = []
    fitted_as: list[float] = []
    fitted_weights: list[float] = []
    for q0, amp in zip(centers, amps):
        j = int(np.argmin(np.abs(q_nom - q0)))
        line = nominal[j]
        if abs(line.q - q0) <= cfg.al_match_tolerance:
            matches.append(line)
            fitted_as.append(2.0 * np.pi * np.sqrt(line.n_hkl) / float(q0))
            fitted_weights.append(max(float(amp), 1e-12))
        else:
            matches.append(None)
    if not fitted_as:
        return matches, None
    a = _weighted_median(np.array(fitted_as), np.array(fitted_weights))
    # Re-label prior positions at the fitted lattice constant while retaining the
    # observed q center for subtraction (the prior identifies; data locate).
    relabeled: list[AluminumLine | None] = []
    for match in matches:
        if match is None:
            relabeled.append(None)
        else:
            relabeled.append(AluminumLine(
                q=float(2.0 * np.pi * np.sqrt(match.n_hkl) / a),
                n_hkl=match.n_hkl, family=match.family))
    return relabeled, float(a)


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
    base = np.interp(q_shell, q_grid, baseline)
    amplitude_samples = (data - base) / np.maximum(profile, 0.35)

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
                directions, trial_basis, amplitude_samples, core,
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

    cell_rows, cell_amp, cell_weight = angular_fit
    n_cells = n_mu * n_phi
    X = np.asarray(cell_rows)
    y = np.asarray(cell_amp)
    w = np.asarray(cell_weight)
    # Prevent a nearly noiseless cell from monopolizing the solve.
    w = np.minimum(w, np.percentile(w, 90))
    beta, covariance, residual_scale = _ridge_irls(
        X, y, w, degrees, cfg.angular_ridge)
    amplitude = np.maximum(basis @ beta, 0.0)
    # A robust physical ceiling guards against broad crystal features that occupy
    # one angular sector. The ceiling is generous enough to retain strong texture.
    ceiling = max(4.0 * pooled_amp, 1.5 * float(np.percentile(y, 95)), 1e-12)
    amplitude = np.minimum(amplitude, ceiling)
    model = amplitude * profile

    pred_var = np.einsum("ij,jk,ik->i", basis, covariance, basis)
    amp_sigma = np.sqrt(np.maximum(pred_var, 0.0) + residual_scale ** 2)
    model_sigma = amp_sigma * profile
    coverage = len(cell_amp) / n_cells
    fitted_at_cells = np.maximum(X @ beta, 0.0)
    residual_rms = float(np.sqrt(np.mean((fitted_at_cells - y) ** 2)))
    summary = GlobalRingShell(
        q_center=q0,
        fwhm=fwhm,
        eta=cfg.pseudo_voigt_eta,
        snr=snr,
        pooled_amplitude=pooled_amp,
        angular_amplitude_median=float(np.median(amplitude)),
        angular_amplitude_max=float(np.max(amplitude)),
        angular_lmax=fitted_lmax,
        angular_coverage=float(coverage),
        angular_residual_rms=residual_rms,
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
    core: NDArray[np.bool_],
    n_mu: int,
    n_phi: int,
    min_count: int,
) -> tuple[list[NDArray[np.float64]], list[float], list[float]]:
    cell_ids = _angular_cell_ids(directions, n_mu, n_phi)
    rows: list[NDArray[np.float64]] = []
    amplitudes: list[float] = []
    weights: list[float] = []
    for cell in range(n_mu * n_phi):
        take = core & (cell_ids == cell)
        n = int(np.count_nonzero(take))
        if n < min_count:
            continue
        vals = amplitude_samples[take]
        med = float(np.median(vals))
        mad = float(np.median(np.abs(vals - med)))
        rows.append(np.mean(basis[take], axis=0))
        amplitudes.append(max(med, 0.0))
        weights.append(n / max((1.4826 * mad) ** 2, 1e-6))
    return rows, amplitudes, weights


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
    covariance = np.asarray(
        np.linalg.pinv(lhs) * residual_scale ** 2, dtype=np.float64)
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
