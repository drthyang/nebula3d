# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The ΔPDF's strongest features (docs/pilot-review.md, finding 1): pair
correlations put into I(Q) at known vectors and signs come out of the
transform at those vectors, with those signs, strongest first."""

from __future__ import annotations

import numpy as np
import pytest

from nebula3d.analysis.delta_pdf import compute_delta_pdf
from nebula3d.analysis.dpdf_features import strongest_features
from nebula3d.core import HKLVolume
from nebula3d.utils import ub_from_lattice

A = 4.0
# (vector in lattice units, amplitude): a correlation at ±r adds 2·amp·cos(2π h·r) to I(Q).
PLANTED = [((1.5, 0.0, 0.0), 0.5), ((0.5, 1.0, 0.0), -0.3)]


def _transform(seed: int = 0, noise: float = 0.02):
    step = 0.1
    ax = (np.arange(81) - 40) * step  # ±4 r.l.u., Q = 0 on index 40
    h, k, l = np.meshgrid(ax, ax, ax, indexing="ij")
    data = 1.0 + noise * np.random.default_rng(seed).standard_normal(h.shape)
    for (u, v, w), amp in PLANTED:
        data = data + 2 * amp * np.cos(2 * np.pi * (h * u + k * v + l * w))
    vol = HKLVolume(data=data, sigma=np.zeros_like(data), mask=np.ones(data.shape, dtype=bool),
                    h_axis=ax, k_axis=ax, l_axis=ax,
                    ub_matrix=ub_from_lattice(A, A, A, 90.0, 90.0, 90.0))
    return compute_delta_pdf(vol, real_space_angstrom=True)


def test_planted_correlations_come_out_at_their_vectors_with_their_signs():
    d = _transform()
    f = strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, d.cell_angles, min_sigma=5)
    assert f.sigma > 0 and f.origin_radius == pytest.approx(0.05 * 20.0, rel=0.05)
    top = f.groups[:2]
    assert [g.sign for g in top] == [1, -1]  # the stronger first
    for g, ((u, v, w), _amp) in zip(top, PLANTED):
        assert g.n == 1  # one per ± pair
        x, y, z = g.vectors[0]
        # The listed copy is in the half with the first non-zero index offset positive.
        # Within a fifth of a voxel (0.125 r.l.u.).
        assert (x / A, y / A, z / A) == pytest.approx((u, v, w), abs=0.02)
        assert g.length == pytest.approx(A * np.sqrt(u * u + v * v + w * w), abs=0.05)
    # Its sizes compare as the amplitudes put in (the Gaussian window broadens both alike).
    assert top[0].size_sigma / top[1].size_sigma == pytest.approx(0.5 / 0.3, rel=0.1)
    assert top[0].size_sigma > 50 * 5  # far above the listing threshold


def test_the_origin_is_left_out_and_the_threshold_bounds_the_list():
    d = _transform()
    f = strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, min_sigma=5)
    assert all(g.length >= f.origin_radius for g in f.groups)
    high = strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, min_sigma=1e6)
    assert high.n_extrema == 0 and high.groups == ()
    assert len(strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, limit=1).groups) == 1
    with pytest.raises(ValueError):
        strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, min_sigma=0)


def test_symmetric_copies_are_one_entry():
    """The same correlation along a, b and c (a cubic crystal's ⟨1 0 0⟩ orbit):
    one sign, length and size, listed as one entry of three vectors."""
    step = 0.1
    ax = (np.arange(81) - 40) * step
    h, k, l = np.meshgrid(ax, ax, ax, indexing="ij")
    data = 1.0 + 0.4 * (np.cos(2 * np.pi * h) + np.cos(2 * np.pi * k) + np.cos(2 * np.pi * l))
    vol = HKLVolume(data=data, sigma=np.zeros_like(data), mask=np.ones(data.shape, dtype=bool),
                    h_axis=ax, k_axis=ax, l_axis=ax,
                    ub_matrix=ub_from_lattice(A, A, A, 90.0, 90.0, 90.0))
    d = compute_delta_pdf(vol, real_space_angstrom=True)
    g = strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis).groups[0]
    assert g.sign == 1 and g.n == 3 and g.length == pytest.approx(A, abs=0.05)
    units = sorted(tuple(round(abs(c) / A, 2) for c in v) for v in g.vectors)
    assert units == [(0.0, 0.0, 1.0), (0.0, 1.0, 0.0), (1.0, 0.0, 0.0)]


def test_a_large_volume_takes_sigma_from_a_subsample_and_unmeasured_voxels_count_as_zero():
    """Past SIGMA_VOXELS the σ comes from a regular subsample (a measured 405³
    ΔPDF must fit the browser's heap); a NaN voxel is no extremum."""
    n = 211  # 9.4 M voxels: every second voxel along each axis
    rng = np.random.default_rng(1)
    data = rng.standard_normal((n, n, n)).astype(np.float32)
    data[0, 0, :5] = np.nan
    ax = (np.arange(n) - n // 2) * 0.25
    f = strongest_features(data, ax, ax, ax, min_sigma=5.5)
    assert f.sigma == pytest.approx(1.0, rel=0.01)  # unit Gaussian noise
    assert all(g.size_sigma >= 5.5 for g in f.groups)
    assert all(np.isfinite(v).all() for g in f.groups for v in g.vectors)
