# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The backfill interpolates inside the measured support and never extrapolates.

Never-measured voxels (masked by the loader, not punched) are filled only where
measured data enclose them: the direct-beam shadow, a dead voxel.  Unmeasured
space that reaches the edge of the box — past the coverage, or where the
coverage edge meets a box face — stays masked; the ΔPDF reads it as zero.
"""

from __future__ import annotations

import numpy as np
import pytest

from nebula3d.analysis import backfill_bragg, compute_delta_pdf, invert_delta_pdf
from nebula3d.core import HKLVolume


def _ramp(n: int = 21) -> tuple[HKLVolume, np.ndarray]:
    i, j, k = np.meshgrid(*(np.arange(n),) * 3, indexing="ij")
    truth = 0.3 + 0.10 * i + 0.05 * j - 0.02 * k
    return HKLVolume.from_arrays(truth.copy(), (-1, 1), (-1, 1), (-1, 1)), truth


def _unmeasure(vol: HKLVolume, where) -> None:
    """Mark voxels never measured, as the loader leaves them: zeroed, masked."""
    vol.mask[where] = False
    vol.data[where] = 0.0
    vol.sigma[where] = 0.0


@pytest.mark.parametrize("method", ["laplace", "local", "q_shell"])
def test_open_unmeasured_stays_masked_enclosed_pocket_is_filled(method):
    vol, truth = _ramp()
    slab = (slice(None), slice(None), slice(16, None))  # reaches three faces
    pocket = (slice(9, 11), slice(9, 11), slice(9, 11))  # enclosed by data
    _unmeasure(vol, slab)
    _unmeasure(vol, pocket)
    punched = np.zeros(vol.shape, dtype=bool)
    punched[3:6, 3:6, 3:6] = True
    vol.mask[punched] = False
    vol.data[punched] = 100.0                 # the Bragg peak left under the hole

    out = backfill_bragg(vol, method=method, direct_beam_fill=False,
                         punched=punched)

    # past the coverage: not filled, still masked, data as the loader left it
    assert not out.mask[slab].any()
    np.testing.assert_array_equal(out.data[slab], 0.0)
    rest = np.ones(vol.shape, dtype=bool)
    rest[slab] = False
    assert out.mask[rest].all()
    # the enclosed pocket is filled from the data around it
    assert abs(float(out.data[pocket].mean()) - float(truth[pocket].mean())) < 0.05
    assert np.all(out.data[punched] < 10.0)
    if method == "laplace":                   # harmonic: the ramp continues
        np.testing.assert_allclose(out.data[punched], truth[punched], atol=1e-8)

    # unmeasured="all" fills the open slab too (the behaviour before 2026-10)
    every = backfill_bragg(vol, method=method, direct_beam_fill=False,
                           punched=punched, unmeasured="all")
    assert every.mask.all()
    assert np.all(every.data[slab] > 1.0)     # invented: the slab rim's level
    np.testing.assert_array_equal(every.data[rest], out.data[rest])


def _sphere_coverage(n: int = 41):
    """Data measured inside a |Q| sphere, with a beam shadow at the origin."""
    vol = HKLVolume.from_arrays(np.full((n, n, n), 0.3), (-1, 1), (-1, 1), (-1, 1))
    q = vol.q_magnitude()
    q_edge = 0.8 * float(q[n // 2, n // 2, -1])  # sphere well inside the box
    outside = q > q_edge
    shadow = q <= 0.25
    _unmeasure(vol, outside)
    _unmeasure(vol, shadow)
    return vol, outside, shadow


def test_coverage_sphere_keeps_its_exterior_and_fills_the_beam_shadow():
    vol, outside, shadow = _sphere_coverage()
    notes: list[str] = []
    c = vol.shape[0] // 2

    out = backfill_bragg(vol, method="laplace", direct_beam_q_gap=0.2,
                         direct_beam_q_width=0.15, report=notes.append)

    np.testing.assert_array_equal(out.mask, ~outside)
    np.testing.assert_array_equal(out.data[outside], 0.0)
    assert out.mask[shadow].all()             # enclosed: the direct-beam fill
    assert abs(float(out.data[c, c, c]) - 0.3) < 1e-6
    assert any(f"{int(outside.sum()):,} unmeasured voxels" in m for m in notes)

    every = backfill_bragg(vol, method="laplace", direct_beam_q_gap=0.2,
                           direct_beam_q_width=0.15, unmeasured="all")
    assert every.mask.all()


def test_beam_shadow_open_to_the_box_edge_stays_masked():
    # A gap from the origin out to a box face (a missing wedge): the shadow is
    # not enclosed by data, so neither it nor the gap is filled.
    vol, outside, shadow = _sphere_coverage()
    c = vol.shape[0] // 2
    channel = (slice(c - 1, c + 2), slice(c - 1, c + 2), slice(c, None))
    _unmeasure(vol, channel)

    out = backfill_bragg(vol, method="laplace", direct_beam_q_gap=0.2,
                         direct_beam_q_width=0.15)

    assert not out.mask[shadow].any()
    assert not out.mask[channel].any()
    np.testing.assert_array_equal(out.data[shadow], 0.0)


def test_unknown_unmeasured_option_raises():
    vol, _ = _ramp(9)
    with pytest.raises(ValueError, match="unmeasured"):
        backfill_bragg(vol, unmeasured="none")  # type: ignore[arg-type]


def test_delta_pdf_reads_the_open_region_as_zero():
    # The masked exterior enters the transform as zero and comes back as zero:
    # the back-FFT reproduces the measured data and the empty exterior.
    rng = np.random.default_rng(1)
    vol, outside, _ = _sphere_coverage(31)
    noise = rng.normal(0.0, 0.05, vol.shape)
    noise = 0.5 * (noise + noise[::-1, ::-1, ::-1])  # I(Q) = I(−Q): a real ΔPDF
    vol.data[~outside] += noise[~outside]
    filled = backfill_bragg(vol, method="laplace", direct_beam_q_gap=0.2,
                            direct_beam_q_width=0.15)
    assert not filled.mask[outside].any()

    dpdf = compute_delta_pdf(filled, apodization="gaussian", gaussian_sigma=0.4)
    assert np.isfinite(dpdf.data).all()
    recon = invert_delta_pdf(dpdf, deapodize=True)
    data0 = np.where(filled.mask, filled.data, 0.0)
    region = recon.mask
    np.testing.assert_allclose(recon.data[region], data0[region], atol=1e-9)
    np.testing.assert_allclose(recon.data[region & outside], 0.0, atol=1e-9)
