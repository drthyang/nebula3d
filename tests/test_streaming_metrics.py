# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Regression tests for the streaming/chunked memory fixes.

The streaming consistency metrics and the per-plane deapodization replaced
whole-volume temporaries at the pipeline's peak-memory stage; these tests pin
their equivalence to the previous ``np.corrcoef``/materialised-window
implementations (kept inline here as references).
"""

from __future__ import annotations

import numpy as np

from nebula3d.analysis.delta_pdf import compute_delta_pdf, invert_delta_pdf
from nebula3d.core import HKLVolume
from nebula3d.pipeline import _consistency_metrics


def _random_fields(seed: int = 0, shape=(9, 12, 10)):
    rng = np.random.default_rng(seed)
    rec = rng.normal(2.0, 1.0, shape)
    data = rec + rng.normal(0.0, 0.1, shape)
    region = rng.random(shape) > 0.25
    h_axis = np.linspace(-1.0, 1.0, shape[0])
    return rec, data, region, h_axis


def _reference_metrics(rec, data, region):
    """The pre-streaming implementation (np.corrcoef / whole-volume means)."""
    a, b = rec[region], data[region]
    r = float(np.corrcoef(a, b)[0, 1]) if a.size > 1 else float("nan")
    rms = float(np.sqrt(np.mean((rec - data)[region] ** 2))) if region.any() else 0.0
    denom = (float(np.sqrt(np.mean(data[region] ** 2)))
             if region.any() else 0.0) or 1.0
    return r, rms, rms / denom


def test_streaming_metrics_match_corrcoef():
    rec, data, region, h_axis = _random_fields()
    metrics, rows = _consistency_metrics(rec, data, region, h_axis, (0.0, 1.0))
    r_ref, rms_ref, nrms_ref = _reference_metrics(rec, data, region)
    assert np.isclose(metrics["pearson_r"], r_ref, rtol=1e-12, atol=0.0)
    assert np.isclose(metrics["rms"], rms_ref, rtol=1e-12, atol=0.0)
    assert np.isclose(metrics["normalized_rms"], nrms_ref, rtol=1e-12, atol=0.0)
    assert metrics["n_voxels"] == int(region.sum())
    # Per-plane r still uses np.corrcoef directly — exact match, and the figure
    # rows carry the actual plane arrays.
    for (hv, d2, r2, m2, rho), key in zip(rows, metrics["per_plane_r"]):
        a, b = r2[m2], d2[m2]
        expect = float(np.corrcoef(a, b)[0, 1]) if a.size > 1 else float("nan")
        assert (np.isnan(rho) and np.isnan(expect)) or rho == expect
        assert metrics["per_plane_r"][key] == rho


def test_streaming_metrics_plane_callables_match_arrays():
    """Array inputs and per-plane callables must produce identical metrics."""
    rec, data, region, h_axis = _random_fields(seed=3)
    m_arr, _ = _consistency_metrics(rec, data, region, h_axis, (0.0,))
    m_call, _ = _consistency_metrics(
        rec, lambda i: data[i], lambda i: region[i], h_axis, (0.0,))
    assert m_arr == m_call


def test_streaming_metrics_empty_region():
    rec, data, region, h_axis = _random_fields(seed=5)
    region[:] = False
    metrics, _ = _consistency_metrics(rec, data, region, h_axis, (0.0,))
    assert metrics["rms"] == 0.0
    assert metrics["normalized_rms"] == 0.0
    assert np.isnan(metrics["pearson_r"])
    assert metrics["n_voxels"] == 0


def _demo_volume(n: int = 21) -> HKLVolume:
    rng = np.random.default_rng(1)
    axes = np.linspace(-2.0, 2.0, n)
    data = rng.normal(5.0, 1.0, (n, n, n))
    return HKLVolume(
        data=data,
        sigma=np.sqrt(np.abs(data)),
        mask=np.ones(data.shape, dtype=bool),
        h_axis=axes, k_axis=axes, l_axis=axes,
        ub_matrix=np.eye(3),
    )


def test_deapodize_chunked_matches_materialized_window():
    """Per-plane deapodization == the old whole-volume window divide, bitwise."""
    vol = _demo_volume()
    for kind in ("gaussian", "hann"):
        dpdf = compute_delta_pdf(vol, apodization=kind)
        recon = invert_delta_pdf(dpdf, deapodize=True)

        # Reference: the pre-chunking implementation, reproduced verbatim
        # (same scipy.fft calls as production so the FFT halves are identical).
        from scipy.fft import fftshift, ifftn, ifftshift

        dpdf2 = compute_delta_pdf(vol, apodization=kind)
        work = ifftshift(dpdf2.data)
        ft = ifftn(work, workers=-1)
        prep_pad = fftshift(np.ascontiguousarray(ft.real))
        sl = tuple(slice(lo, lo + m)
                   for (lo, _hi), m in zip(dpdf2.pad_width, dpdf2.cropped_shape))
        prep = prep_pad[sl] + dpdf2.subtracted_mean
        win = (dpdf2.window_axes[0][:, None, None]
               * dpdf2.window_axes[1][None, :, None]
               * dpdf2.window_axes[2][None, None, :])
        reliable = win >= 1e-3 * float(win.max())
        ref = np.divide(prep, win, out=np.zeros_like(prep), where=reliable)

        assert np.array_equal(recon.mask, reliable), kind
        assert np.array_equal(recon.data, ref), kind


def test_streaming_pearson_is_clipped_to_unit_interval():
    """np.corrcoef clips to [-1, 1]; the streaming quotient must too.  Seed 2
    with an ulp-level perturbation makes the raw quotient round to
    1 + 2e-16 — deterministic regression for the clip."""
    rng = np.random.default_rng(2)
    a3 = rng.normal(0, 1.0, 4096).reshape(4, 32, 32)
    b3 = a3 * (1.0 + rng.normal(0, 1e-16, a3.size).reshape(a3.shape))
    region = np.ones(a3.shape, dtype=bool)
    h_axis = np.linspace(-1, 1, 4)
    metrics, _ = _consistency_metrics(a3, b3, region, h_axis, (0.0,))
    assert metrics["pearson_r"] <= 1.0
    assert metrics["pearson_r"] > 0.999999
