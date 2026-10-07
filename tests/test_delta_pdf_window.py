# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The ΔPDF window must respect the lattice's symmetry.

A product of 1-D tapers along H, K and L is invariant under the sign flips and
axis swaps of orthogonal, monoclinic and triclinic Laue groups, but not under
the hexagonal 6-fold ``(h, k, l) → (−k, h + k, l)``: on Fe3Ge2 (6/m) the ΔPDF
along a and b differed from a + b by 0.03–0.05 of the main peak.  The
ellipsoid window tapers in the radius of the largest lattice-invariant
ellipsoid inside the box, so symmetry-equivalent directions get the same
resolution, and it still reaches zero at the box faces and inverts exactly.
"""

from __future__ import annotations

import asyncio
import sys
import tracemalloc
import types

import numpy as np
import pytest

from nebula3d.analysis.delta_pdf import (
    _apodization_window,
    _fft_core_forward,
    _finish_forward,
    _lattice_point_group,
    _prepare_forward,
    compute_delta_pdf,
    invert_delta_pdf,
)
from nebula3d.core import HKLVolume
from nebula3d.utils import ub_from_lattice

HEX = ub_from_lattice(8.0, 8.0, 10.0, 90.0, 90.0, 120.0)
# 6/m on (h, k, l): the 6-fold and the inversion.
SIX = np.array([[0, -1, 0], [1, 1, 0], [0, 0, 1]])
SIX_M = [s * np.linalg.matrix_power(SIX, n) for n in range(6) for s in (1, -1)]


def _volume(data, ub, axes):
    return HKLVolume(data=data, sigma=np.zeros_like(data),
                     mask=np.ones(data.shape, dtype=bool),
                     h_axis=axes[0], k_axis=axes[1], l_axis=axes[2], ub_matrix=ub)


def _hex_volume(nhk=41, nl=31, dtype=np.float64):
    """A 6/m-symmetric I(Q) on a hexagonal grid (step 0.2 r.l.u.): cosines summed
    over the 6/m orbit (correlation peaks at ±a, ±b, ±(a+b) and further out)
    on a smooth hexagonal pedestal.  Built from integer indices, so the
    symmetry holds to round-off."""
    step = 0.2
    ih = np.arange(nhk) - nhk // 2
    il = np.arange(nl) - nl // 2
    n = np.stack(np.meshgrid(ih, ih, il, indexing="ij"))          # (3, nh, nk, nl)
    data = np.zeros(n.shape[1:])
    for r in SIX_M:
        m = np.tensordot(r, n, axes=1) * step
        data += np.cos(2 * np.pi * m[0]) + 0.5 * np.cos(2 * np.pi * (m[0] + 2 * m[1]))
        data += 0.3 * np.cos(2 * np.pi * (m[0] + 0.5 * m[2]))
    h, k, l_ = n * step
    data += 20.0 * np.exp(-((h * h + h * k + k * k) / 4.0 + l_ * l_ / 6.0))
    axes = (ih * step, ih * step, il * step)
    return _volume(data.astype(dtype), HEX, axes)


def _six_fold_residual(plane):
    """max |D − D∘R₆₀| / max |D| on one oblique a–b section: the real-space 60°
    rotation is (u, v) → (u − v, u), periodic on the padded grid."""
    n = plane.shape[0]
    assert plane.shape == (n, n)
    c = n // 2
    o = np.arange(n) - c
    i, j = np.meshgrid(o, o, indexing="ij")
    rot = plane[(i - j + c) % n, (i + c) % n]
    return float(np.abs(rot - plane).max() / np.abs(plane).max())


def _profiles(d):
    """ΔPDF along a, b and a + b (oblique (t, 0), (0, t), (t, t); |a + b| = a)."""
    c = np.array(d.shape) // 2
    t = np.arange(1, min(c[0], c[1]))
    plane = d[:, :, c[2]]
    return plane[c[0] + t, c[1]], plane[c[0], c[1] + t], plane[c[0] + t, c[1] + t]


# ---------------------------------------------------------------------------
# lattice symmetry and the ellipsoid
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(("cell", "order"), [
    ((8.0, 8.0, 10.0, 90.0, 90.0, 120.0), 24),                # 6/mmm
    ((8.028, 8.019, 10.03, 90.13, 90.23, 119.98), 24),        # Fe3Ge2 90 K's refined UB
    ((5.0, 5.0, 9.0, 90.0, 90.0, 90.0), 16),                  # 4/mmm
    ((5.0, 6.0, 9.0, 90.0, 90.0, 90.0), 8),                   # mmm
    ((8.0, 9.0, 10.0, 90.0, 110.0, 90.0), 4),                 # 2/m
    ((4.5, 5.0, 6.0, 75.0, 100.0, 115.0), 2),                 # -1
])
def test_lattice_point_group_from_the_ub(cell, order):
    ops = _lattice_point_group(ub_from_lattice(*cell))
    assert len(ops) == order
    g = HEX.T @ HEX
    if order == 24:
        assert any(np.array_equal(r, SIX) for r in ops)
        for r in ops:
            np.testing.assert_allclose(r.T @ g @ r, g, atol=1e-12)


def test_hexagonal_ellipsoid_is_q_perp_and_q_par_over_the_face_distances():
    """ρ² = (Q⊥/d_ab)² + (Q∥/d_c)², d = 2π·X/|a_i| the box-face distances —
    the window that removed the a vs a + b mismatch on Fe3Ge2."""
    ax = np.linspace(-20.0, 20.0, 401)
    _, ell = _apodization_window("auto", "hann", 0.4, (ax, ax, ax), HEX)
    assert ell is not None
    np.testing.assert_allclose(ell.form * 400.0,
                               [[4 / 3, 2 / 3, 0], [2 / 3, 4 / 3, 0], [0, 0, 1]],
                               atol=1e-12)
    a, _, c = np.linalg.norm(2 * np.pi * np.linalg.inv(HEX).T, axis=0)
    d_ab, d_c = 2 * np.pi * 20.0 / a, 2 * np.pi * 20.0 / c       # 15.71, 12.57 Å⁻¹
    c_star = HEX[:, 2] / np.linalg.norm(HEX[:, 2])
    for hkl in np.random.default_rng(0).uniform(-20, 20, (20, 3)):
        q = HEX @ hkl
        q_par = q @ c_star
        q_perp2 = q @ q - q_par**2
        assert hkl @ ell.form @ hkl == pytest.approx(
            q_perp2 / d_ab**2 + q_par**2 / d_c**2, rel=1e-12)


@pytest.mark.parametrize(("cell", "expected"), [
    ((8.0, 8.0, 10.0, 90.0, 90.0, 120.0), "ellipsoid"),
    ((5.0, 6.0, 9.0, 90.0, 90.0, 90.0), "separable"),
    ((5.0, 5.0, 5.0, 90.0, 90.0, 90.0), "separable"),
    ((8.0, 9.0, 10.0, 90.0, 110.0, 90.0), "separable"),
    ((4.5, 5.0, 6.0, 75.0, 100.0, 115.0), "separable"),
])
def test_auto_uses_the_ellipsoid_only_where_axes_mix(cell, expected):
    axes = (np.linspace(-3, 3, 31), np.linspace(-3, 3, 31), np.linspace(-2, 2, 21))
    ub = ub_from_lattice(*cell)
    window_axes, ell = _apodization_window("auto", "gaussian", 0.4, axes, ub)
    assert ("ellipsoid" if ell is not None else "separable") == expected
    assert (window_axes is None) == (ell is not None)
    # "none" stays no window at all, whatever the cell
    window_axes, ell = _apodization_window("auto", "none", 0.4, axes, ub)
    assert ell is None and all(np.all(w == 1.0) for w in window_axes)


def test_orthorhombic_auto_is_bit_identical_to_the_separable_window():
    rng = np.random.default_rng(1)
    axes = (np.linspace(-3, 3, 25), np.linspace(-4, 4, 27), np.linspace(-2, 2, 21))
    data = rng.normal(5.0, 1.0, (25, 27, 21))
    data = 0.5 * (data + data[::-1, ::-1, ::-1])
    vol = _volume(data, ub_from_lattice(5.0, 6.0, 9.0), axes)
    auto = compute_delta_pdf(vol, apodization="gaussian", gaussian_sigma=0.4)
    sep = compute_delta_pdf(vol, apodization="gaussian", gaussian_sigma=0.4,
                            window_shape="separable")
    assert auto.window_shape == "separable"
    assert np.array_equal(auto.data, sep.data)


def test_explicit_ellipsoid_on_an_orthogonal_box_is_the_index_sphere():
    """Without axis-mixing symmetry the largest inscribed ellipsoid is
    Σ (x_i / X_i)²; a tetragonal box with unequal H, K extents gets the
    inscribed circle of the smaller one (the 4-fold maps H onto K)."""
    axes = (np.linspace(-4, 4, 41), np.linspace(-3, 3, 31), np.linspace(-2, 2, 21))
    _, ell = _apodization_window("ellipsoid", "hann", 0.4, axes,
                                 ub_from_lattice(5.0, 6.0, 9.0))
    np.testing.assert_allclose(ell.form, np.diag([1 / 16, 1 / 9, 1 / 4]), atol=1e-12)
    _, ell = _apodization_window("ellipsoid", "hann", 0.4, axes,
                                 ub_from_lattice(5.0, 5.0, 9.0))
    np.testing.assert_allclose(ell.form, np.diag([1 / 9, 1 / 9, 1 / 4]), atol=1e-12)


def test_ellipsoid_window_is_invariant_peaks_at_one_and_vanishes_on_the_faces():
    vol = _hex_volume()
    _, ell = _apodization_window("ellipsoid", "hann", 0.4,
                                 (vol.h_axis, vol.k_axis, vol.l_axis), HEX)
    w = np.stack(list(ell.planes()))
    for face in (w[0], w[-1], w[:, 0], w[:, -1], w[:, :, 0], w[:, :, -1]):
        assert np.abs(face).max() == 0.0
    c = np.array(w.shape) // 2
    assert w[tuple(c)] == 1.0 and w.min() == 0.0
    # w(R·hkl) = w(hkl) wherever both are on the grid
    idx = np.argwhere(w >= 0.0) - c
    for r in SIX_M:
        moved = idx @ r.T + c
        ok = np.all((moved >= 0) & (moved < w.shape), axis=1)
        src = idx[ok] + c
        np.testing.assert_allclose(w[tuple(moved[ok].T)], w[tuple(src.T)], atol=1e-14)


def test_single_plane_axes_take_no_part():
    """A 2-D (h, k) section keeps the in-plane 6-fold; ρ ignores L."""
    axes = (np.linspace(-4, 4, 41), np.linspace(-4, 4, 41), np.array([0.0]))
    _, ell = _apodization_window("auto", "hann", 0.4, axes, HEX)
    assert ell is not None
    np.testing.assert_allclose(ell.form[:2, :2] * 16, [[4 / 3, 2 / 3], [2 / 3, 4 / 3]])
    assert not ell.form[2].any() and not ell.form[:, 2].any()


def test_ellipsoid_needs_q_zero_inside_the_box():
    axes = (np.linspace(0.5, 4, 8), np.linspace(-4, 4, 41), np.linspace(-2, 2, 21))
    with pytest.raises(ValueError, match="Q = 0"):
        _apodization_window("ellipsoid", "hann", 0.4, axes, HEX)
    _, ell = _apodization_window("auto", "hann", 0.4, axes, HEX)
    assert ell is None  # auto falls back to the separable window
    with pytest.raises(ValueError, match="window_shape"):
        _apodization_window("sphere", "hann", 0.4, axes, HEX)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# the ΔPDF of a hexagonal volume: a, b and a + b agree
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("apodization", ["gaussian", "hann"])
def test_hexagonal_delta_pdf_has_six_fold_symmetry(apodization):
    vol = _hex_volume()
    dp = compute_delta_pdf(vol, apodization=apodization)   # auto → ellipsoid
    assert dp.window_shape == "ellipsoid"
    d = dp.data
    a, b, ab = _profiles(d)
    peak = np.abs(d).max()
    assert np.abs(a - ab).max() < 1e-9 * peak
    assert np.abs(b - ab).max() < 1e-9 * peak
    for iz in range(d.shape[2]):
        assert _six_fold_residual(d[:, :, iz]) < 1e-9

    # the separable window breaks it — the artifact this option removes
    sep = compute_delta_pdf(vol, apodization=apodization, window_shape="separable").data
    a, b, ab = _profiles(sep)
    assert np.abs(a - ab).max() > 1e-3 * np.abs(sep).max()
    assert _six_fold_residual(sep[:, :, sep.shape[2] // 2]) > 1e-3


def test_constant_intensity_transforms_to_nothing_with_the_ellipsoid():
    vol = _hex_volume()
    vol.data[:] = 7.0
    dp = compute_delta_pdf(vol, apodization="gaussian")
    assert dp.window_shape == "ellipsoid"
    assert np.abs(dp.data).max() < 1e-9 * 7.0 * vol.data.size


# ---------------------------------------------------------------------------
# exact inverse, float32 and the WebGPU glue
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("apodization", ["gaussian", "hann", "none"])
@pytest.mark.parametrize("deapodize", [True, False])
def test_inverse_divides_out_the_ellipsoid(apodization, deapodize):
    rng = np.random.default_rng(2)
    vol = _hex_volume(nhk=21, nl=15)
    vol.data += 0.1 * rng.normal(size=vol.data.shape)
    vol.data = 0.5 * (vol.data + vol.data[::-1, ::-1, ::-1])  # centrosymmetric
    data = vol.data.copy()
    dp = compute_delta_pdf(vol, apodization=apodization, window_shape="ellipsoid")
    rec = invert_delta_pdf(dp, deapodize=deapodize)
    if deapodize:
        assert rec.mask.any() and not rec.mask.all()
        np.testing.assert_allclose(rec.data[rec.mask], data[rec.mask], rtol=1e-9)
        assert not rec.data[~rec.mask].any()
    else:
        w = np.stack(list(dp.window_ellipsoid.planes()))
        np.testing.assert_allclose(rec.data, w * data, rtol=1e-9, atol=1e-12)


def test_float32_ellipsoid_streams_plane_by_plane():
    vol = _hex_volume(dtype=np.float32)
    data = vol.data.copy()
    plan = _prepare_forward(vol, apodization="gaussian")
    assert plan.window_ellipsoid is not None and plan.data.dtype == np.float32

    # a few float64 H-plane temporaries, however many planes the volume has
    ell = plan.window_ellipsoid
    work = data.copy()
    plane64 = 8 * work[0].size
    _, peak = _traced(ell.weighted_mean, work)
    assert peak < 8 * plane64
    _, peak = _traced(ell.apply, work)
    assert peak < 8 * plane64

    dp = _finish_forward(plan, _fft_core_forward(plan))
    rec = invert_delta_pdf(dp)
    assert rec.data.dtype == np.float32
    scale = float(np.abs(data).max())
    assert np.abs(rec.data[rec.mask] - data[rec.mask]).max() < 1e-3 * scale


def _traced(fn, *args):
    tracemalloc.start()
    try:
        out = fn(*args)
        return out, tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()


class _Proxy:
    def __init__(self, arr):
        self.arr = arr

    def destroy(self):
        pass


class _FakeGpu:
    """numpy stand-in for web/src/gpu/deltaPdf.ts: pad → centred FFT → real part
    (forward), centred inverse FFT → crop (inverse), all float32 — the window
    never reaches the GPU, so the Python glue around it is what is tested."""

    async def forwardDpdf(self, dp, op, shape, padded, lo):  # noqa: N802 - JS API
        pad = [(lo_i, p - s - lo_i) for s, p, lo_i in zip(shape, padded, lo)]
        x = np.pad(dp.arr.astype(np.float64), pad)
        op.arr[...] = np.fft.fftshift(np.fft.fftn(np.fft.ifftshift(x)).real)
        return True

    async def inverseDpdf(self, dp, op, padded, crop_lo, out_shape):  # noqa: N802
        x = np.fft.fftshift(np.fft.ifftn(np.fft.ifftshift(dp.arr.astype(np.float64))).real)
        sl = tuple(slice(c, c + n) for c, n in zip(crop_lo, out_shape))
        op.arr[...] = x[sl]
        return True


def test_webgpu_core_round_trips_the_ellipsoid(monkeypatch):
    from nebula3d import webbridge

    ffi = types.ModuleType("pyodide.ffi")
    ffi.create_proxy = _Proxy
    ffi.to_js = lambda x: x
    monkeypatch.setitem(sys.modules, "pyodide", types.ModuleType("pyodide"))
    monkeypatch.setitem(sys.modules, "pyodide.ffi", ffi)

    vol = _hex_volume(nhk=21, nl=15, dtype=np.float32)
    data = vol.data.copy()
    cpu = compute_delta_pdf(vol, apodization="gaussian")
    plan = _prepare_forward(vol, apodization="gaussian", fast_len=webbridge._five_smooth)
    gpu = _FakeGpu()
    dp = _finish_forward(plan, asyncio.run(webbridge._gpu_forward(gpu, plan)))
    assert dp.window_shape == "ellipsoid"
    if dp.data.shape == cpu.data.shape:
        np.testing.assert_allclose(dp.data, cpu.data, atol=1e-4 * np.abs(cpu.data).max())
    a, b, ab = _profiles(dp.data)
    assert np.abs(a - ab).max() < 1e-5 * np.abs(dp.data).max()

    rec = asyncio.run(webbridge._gpu_inverse(gpu, dp))
    assert rec.mask.any()
    scale = float(np.abs(data).max())
    assert np.abs(rec.data[rec.mask] - data[rec.mask]).max() < 1e-4 * scale
