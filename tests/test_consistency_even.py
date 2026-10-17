# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The back-FFT check against what the transform keeps: the data's even part.

The ΔPDF is the real part of the Fourier transform, the transform of the
data's even part under Q → −Q, so the round trip reproduces that part and never
the odd one. On unsymmetrised data the odd part is counting noise: r against
the data reads below 0.999 on every dev case of the validation (0.979 to 0.996)
while the transform is sound (docs/pilot-review.md, finding 3). Against the even
part r is 1 to rounding, and a transform that drops part of the ΔPDF lowers it.
"""

from __future__ import annotations

import numpy as np
import pytest

from nebula3d import pipeline
from nebula3d.analysis.delta_pdf import compute_delta_pdf
from nebula3d.core import HKLVolume
from nebula3d.utils import ub_from_lattice

CUBIC = ub_from_lattice(4.0, 4.0, 4.0, 90.0, 90.0, 90.0)


def _axis(n: int, step: float = 0.2) -> np.ndarray:
    return (np.arange(n) - n // 2) * step  # Q = 0 on index n//2, the transform's origin


def _volume(n: int = 41, noise: float = 0.05, seed: int = 0, symmetrise: bool = False) -> HKLVolume:
    """A centrosymmetric diffuse pattern (cosines: pair correlations at ±a, ±(a+b))
    on a pedestal, with unsymmetrised Gaussian noise."""
    ax = _axis(n)
    h, k, l = np.meshgrid(ax, ax, ax, indexing="ij")
    signal = (1.0 + 0.3 * np.cos(2 * np.pi * h) + 0.2 * np.cos(2 * np.pi * (h + k))
              + 0.1 * np.cos(2 * np.pi * l))
    data = signal + noise * np.random.default_rng(seed).standard_normal(signal.shape)
    if symmetrise:
        data = 0.5 * (data + data[::-1, ::-1, ::-1])  # odd n: index i ↔ n − 1 − i is Q ↔ −Q
    return HKLVolume(data=data, sigma=np.zeros_like(data), mask=np.ones(data.shape, dtype=bool),
                     h_axis=ax, k_axis=ax, l_axis=ax, ub_matrix=CUBIC)


def _check(vol: HKLVolume) -> dict:
    p = pipeline.DeltaPdfParams()
    return pipeline.pdf_consistency_check(vol, pipeline.delta_pdf(vol, p), p)


def test_unsymmetrised_noise_limits_r_but_not_r_against_the_even_part():
    m = _check(_volume())
    assert m["pearson_r"] < 0.999  # what the old gate failed
    assert m["pearson_r_even"] > 1 - 1e-9
    assert m["normalized_rms_even"] < 1e-6
    # r² ≈ the even share of the variance: the odd share is the noise's.
    assert m["odd_share"] == pytest.approx(1 - m["pearson_r"] ** 2, rel=0.05)
    assert m["n_voxels_even"] == m["n_voxels"]


def test_symmetrised_data_read_one_either_way():
    m = _check(_volume(symmetrise=True))
    assert m["pearson_r"] > 1 - 1e-9 and m["pearson_r_even"] > 1 - 1e-9
    assert m["odd_share"] < 1e-12


def test_dropping_part_of_the_delta_pdf_lowers_r_against_the_even_part():
    """The check still catches a transform that loses signal: here the
    reconstruction from the ΔPDF beyond 3 Å only (the correlations at a = 4 Å
    and a√2 stay, the r < 3 Å part, mostly the pedestal's, is dropped)."""
    out = pipeline.consistency_reconstruction(_volume(), pipeline.DeltaPdfParams(),
                                              r_band=(3.0, 1e3))
    assert out["metrics"]["pearson_r_even"] < 0.999


def test_the_mirror_is_about_the_origin_voxel_on_even_axes_too():
    assert pipeline._mirror_index(9, 0) == 8 and pipeline._mirror_index(9, 4) == 4
    assert pipeline._mirror_index(8, 0) is None  # Q = 0 at index 4: index 0 has no −Q on the grid
    assert pipeline._mirror_index(8, 1) == 7 and pipeline._mirror_index(8, 4) == 4
    a = np.arange(12.0).reshape(4, 3)  # an even axis and an odd one
    m = pipeline._mirror_plane(a, -1.0)
    assert m[0].tolist() == [-1.0, -1.0, -1.0]
    assert m[1:].tolist() == a[1:][::-1, ::-1].tolist()
    # The whole check on an even grid, unsymmetrised: still 1 against the even part.
    vol = _volume(n=40)
    assert compute_delta_pdf(vol).data is not None  # the grid puts Q = 0 on the origin voxel
    assert _check(vol)["pearson_r_even"] > 1 - 1e-6
