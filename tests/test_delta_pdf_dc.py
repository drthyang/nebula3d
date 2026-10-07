# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The ΔPDF's DC removal and window must not draw streaks along the axes.

A constant in I(Q) may change the ΔPDF only at r = 0.  The transform used to
window the volume, subtract the plain mean from the whole box and then
zero-pad it: that left a step of the mean at the box faces, and the step's
transform (a 3-D sinc sampled off its zeros) drew a dashed line of
alternating sign along every grid axis.
"""

from __future__ import annotations

import numpy as np
import pytest

from nebula3d.analysis.delta_pdf import (
    _prepare_forward,
    _window_axes,
    compute_delta_pdf,
    invert_delta_pdf,
)
from nebula3d.core import HKLVolume


def _volume(data: np.ndarray) -> HKLVolume:
    axes = [np.linspace(-3.0, 3.0, s) for s in data.shape]
    return HKLVolume(
        data=data, sigma=np.zeros_like(data), mask=np.ones(data.shape, dtype=bool),
        h_axis=axes[0], k_axis=axes[1], l_axis=axes[2], ub_matrix=np.eye(3),
    )


@pytest.mark.parametrize("apodization", ["gaussian", "hann", "none"])
def test_constant_intensity_transforms_to_nothing(apodization):
    """31³ pads to 32³, so a box step would show; a constant must vanish."""
    vol = _volume(np.full((31, 31, 31), 7.0))
    dp = compute_delta_pdf(vol, apodization=apodization)
    assert dp.data.shape == (32, 32, 32)
    assert np.abs(dp.data).max() < 1e-9 * 7.0 * 31**3


@pytest.mark.parametrize("apodization", ["gaussian", "hann"])
def test_input_sums_to_zero_and_vanishes_at_the_box_faces(apodization):
    rng = np.random.default_rng(0)
    vol = _volume(rng.normal(5.0, 1.0, (21, 25, 19)))
    plan = _prepare_forward(vol, apodization=apodization)
    d = plan.data
    assert abs(float(d.sum(dtype=np.float64))) < 1e-9 * float(np.abs(d).sum())
    for face in (d[0], d[-1], d[:, 0], d[:, -1], d[:, :, 0], d[:, :, -1]):
        assert np.abs(face).max() == 0.0


def test_gaussian_window_reaches_zero_at_the_edge():
    wh, wk, wl = _window_axes((41, 40, 1), "gaussian", 0.4)
    assert wh[0] == wh[-1] == 0.0 and wk[0] == wk[-1] == 0.0
    assert wh[20] == pytest.approx(1.0)
    assert np.all(np.diff(wh[:21]) > 0)
    assert wl.tolist() == [1.0]                      # a single plane keeps 1


@pytest.mark.parametrize("apodization", ["gaussian", "hann", "none"])
@pytest.mark.parametrize("deapodize", [True, False])
def test_inverse_restores_the_input(apodization, deapodize):
    rng = np.random.default_rng(2)
    data = rng.normal(5.0, 1.0, (17, 19, 15))
    data = 0.5 * (data + data[::-1, ::-1, ::-1])  # centrosymmetric, like I(Q)
    vol = _volume(data)
    dp = compute_delta_pdf(vol, apodization=apodization)
    rec = invert_delta_pdf(dp, deapodize=deapodize)
    if deapodize:
        np.testing.assert_allclose(rec.data[rec.mask], data[rec.mask], rtol=1e-9)
        assert not rec.data[~rec.mask].any()
    else:
        wh, wk, wl = dp.window_axes
        w = wh[:, None, None] * wk[None, :, None] * wl[None, None, :]
        np.testing.assert_allclose(rec.data, w * data, rtol=1e-9, atol=1e-12)
