# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The ΔPDF at a structure's pair vectors (the ΔPDF page's structure overlay).

Constructed volumes: Gaussian peaks of known sign at known interatomic
vectors over a faint ripple, and a field that is linear along each axis, which
reading between voxels must return exactly. Every cell, vector and amplitude
here is made up.
"""

from __future__ import annotations

import tracemalloc

import numpy as np
import pytest

from nebula3d.analysis import dpdf_features
from nebula3d.analysis.delta_pdf import real_space_radius
from nebula3d.analysis.dpdf_features import (
    PairSignal,
    TooManyVectors,
    pair_vector_signal,
    sigma_outside_origin,
    strongest_features,
)

STEP = 0.25  # Å per voxel
WIDTH = 0.5  # the planted peaks' Gaussian σ, Å
RIPPLE = 0.01


def _axes(shape=(161, 161, 161), step=STEP):
    """Axes along a, b, c in Å with the origin on index n//2 (±20 Å at 161)."""
    return [(np.arange(n) - n // 2) * step for n in shape]


def _volume(axes, angles, peaks, seed=0):
    """A ripple of spread RIPPLE plus a Gaussian of amplitude *amp* at each
    (vector along a, b, c in Å, amp), its width a true (not an oblique) length."""
    x, y, z = axes[0][:, None, None], axes[1][None, :, None], axes[2][None, None, :]
    shape = tuple(a.size for a in axes)
    data = RIPPLE * np.random.default_rng(seed).standard_normal(shape)
    for (u, v, w), amp in peaks:
        r = real_space_radius(x - u, y - v, z - w, angles)
        data += amp * np.exp(-0.5 * (r / WIDTH) ** 2)
    return data.astype(np.float32)


def _value(sig: PairSignal, k: int, n: tuple[int, int, int]) -> float | None:
    """The value of difference *k* at lattice translation *n*; None outside the volume."""
    first, count = sig.first[k], sig.count[k]
    rel = np.array(n) - first
    if (rel < 0).any() or (rel >= count).any():
        return None
    start = int(np.prod(sig.count[:k].astype(np.int64), axis=1).sum())
    return float(sig.values[start + (rel[0] * count[1] + rel[1]) * count[2] + rel[2]])


def test_planted_peaks_read_with_their_signs_in_sigma():
    lat = (4.0, 5.0, 6.0)
    angles = (90.0, 90.0, 90.0)
    axes = _axes()
    diffs = [(0.5, 0.5, 0.0), (0.25, 0.0, 0.5), (0.0, 0.3, 0.0)]
    # (difference, lattice translation, amplitude): each lands on a grid point.
    planted = [(0, (0, 0, 0), 0.5), (0, (-2, 1, 1), -0.4), (1, (1, -1, 0), -0.3),
               (2, (0, 1, 2), 0.6)]
    peaks = [(tuple((diffs[k][a] + n[a]) * lat[a] for a in range(3)), amp) for k, n, amp in planted]
    data = _volume(axes, angles, peaks)
    sig = pair_vector_signal(data, *axes, angles, diffs, lat)

    # σ and the disk are the features' own.
    f = strongest_features(data, *axes, angles, min_sigma=5)
    assert sig.sigma == f.sigma and sig.origin_radius == f.origin_radius
    assert sig.sigma == pytest.approx(RIPPLE, rel=0.05)
    for k, n, amp in planted:
        assert _value(sig, k, n) == pytest.approx(amp / sig.sigma, abs=4.0)
    # A vector with nothing planted reads the ripple.
    assert abs(_value(sig, 1, (0, 0, 0))) < 5.0
    assert abs(_value(sig, 2, (-3, 2, -1))) < 5.0


def test_each_translation_inside_the_volume_has_one_value():
    lat = (4.0, 5.0, 6.0)
    axes = _axes()  # ±20 Å
    data = _volume(axes, (90.0, 90.0, 90.0), [])
    diffs = [(0.5, 0.5, 0.0), (0.0, 0.0, 0.0)]
    sig = pair_vector_signal(data, *axes, (90.0, 90.0, 90.0), diffs, lat)
    # (0.5 + n)·4 within ±20: n = −5 … 4; (0.5 + n)·5: n = −4 … 3; n·6: n = −3 … 3.
    assert sig.first[0].tolist() == [-5, -4, -3] and sig.count[0].tolist() == [10, 8, 7]
    # n·4, n·5, n·6: the faces at ±20 Å are inside.
    assert sig.first[1].tolist() == [-5, -4, -3] and sig.count[1].tolist() == [11, 9, 7]
    assert sig.values.size == 10 * 8 * 7 + 11 * 9 * 7
    assert _value(sig, 0, (4, 3, 3)) is not None
    assert _value(sig, 0, (5, 0, 0)) is None  # 22 Å: outside the volume
    assert _value(sig, 0, (0, -5, 0)) is None


def test_a_cell_longer_than_the_volume_keeps_what_fits():
    axes = _axes()
    data = _volume(axes, (90.0, 90.0, 90.0), [])
    sig = pair_vector_signal(data, *axes, (90.0, 90.0, 90.0), [(0.5, 0.0, 0.0), (0.25, 0.0, 0.0)],
                             (50.0, 5.0, 6.0))
    assert sig.count[0].tolist() == [0, 0, 0]  # ±25 Å along a: never inside
    assert sig.count[1].tolist() == [1, 9, 7] and sig.first[1, 0] == 0  # 12.5 Å along a
    assert sig.values.size == 9 * 7


def test_the_origins_disk_has_no_value():
    lat = (4.0, 5.0, 6.0)
    axes = _axes()
    data = _volume(axes, (90.0, 90.0, 90.0), [((0.4, 0.5, 0.0), 0.5)])
    sig = pair_vector_signal(data, *axes, (90.0, 90.0, 90.0),
                             [(0.1, 0.1, 0.0), (0.0, 0.0, 0.0)], lat)
    assert sig.origin_radius == pytest.approx(1.0)  # 5 % of ±20 Å
    assert np.isnan(_value(sig, 0, (0, 0, 0)))  # |u| = 0.64 Å
    assert np.isfinite(_value(sig, 0, (1, 0, 0)))
    assert np.isnan(_value(sig, 1, (0, 0, 0)))  # u = 0
    assert np.isfinite(_value(sig, 1, (0, 0, 1)))


def test_a_hexagonal_cell_is_read_on_its_oblique_axes():
    lat = (4.0, 4.0, 6.0)
    angles = (90.0, 90.0, 120.0)
    axes = _axes()
    diffs = [(1 / 3, 2 / 3, 0.0), (0.175, -0.175, 0.0), (0.2, 0.2, 0.0)]
    # One peak of each sign, off the grid points (4/3 Å is 5.33 voxels).
    plus = tuple((diffs[0][a] + n) * lat[a] for a, n in enumerate((1, -2, 1)))
    minus = tuple((diffs[0][a] + n) * lat[a] for a, n in enumerate((-2, 0, 0)))
    data = _volume(axes, angles, [(plus, 0.5), (minus, -0.4)])
    sig = pair_vector_signal(data, *axes, angles, diffs, lat)
    # Between voxels a peak 0.5 Å wide reads a little under its top.
    assert _value(sig, 0, (1, -2, 1)) == pytest.approx(0.5 / sig.sigma, rel=0.08)
    assert _value(sig, 0, (-2, 0, 0)) == pytest.approx(-0.4 / sig.sigma, rel=0.08)
    assert abs(_value(sig, 0, (0, 0, 0))) < 5.0
    # The disk (1 Å) is a true length. Along a − b at γ = 120°, components of
    # 0.7 Å make 1.21 Å (outside the disk; 0.99 Å on square axes); along
    # a + b, components of 0.8 Å make 0.8 Å (inside; 1.13 Å on square axes).
    assert np.isfinite(_value(sig, 1, (0, 0, 0)))
    assert np.isnan(_value(sig, 2, (0, 0, 0)))


@pytest.mark.parametrize("angles", [(90.0, 90.0, 90.0), (90.0, 90.0, 120.0), (80.0, 95.0, 105.0)])
def test_between_voxels_a_linear_field_is_read_exactly(angles):
    """Vectors off the grid points, on a grid whose three sizes and steps differ."""
    steps = (0.25, 0.2, 0.4)
    axes = [(np.arange(n) - n // 2) * s for n, s in zip((81, 101, 51), steps)]
    x, y, z = axes[0][:, None, None], axes[1][None, :, None], axes[2][None, None, :]
    field = (0.3 + 0.1 * x - 0.2 * y + 0.05 * z).astype(np.float32)
    lat = (3.7, 4.3, 5.9)
    diffs = np.array([(0.13, 0.57, 0.31), (0.71, 0.02, 0.88)])
    sig = pair_vector_signal(field, *axes, angles, diffs, lat)
    assert sig.sigma > 0
    for k in range(2):
        for n in [(0, 0, 0), (1, -1, 0), (-2, 1, -1), (1, 1, -2)]:
            u = (diffs[k] + n) * lat
            expected = 0.3 + 0.1 * u[0] - 0.2 * u[1] + 0.05 * u[2]
            if real_space_radius(u[0], u[1], u[2], angles) < sig.origin_radius:
                continue
            assert _value(sig, k, n) * sig.sigma == pytest.approx(expected, abs=2e-5)


def test_a_vector_off_a_section_reads_the_volume_at_its_own_position():
    """A marker drawn inside the slab around a cut is not read on the cut plane."""
    lat = (4.0, 5.0, 6.0)
    angles = (90.0, 90.0, 90.0)
    axes = _axes()
    # A peak 0.6 Å above the plane z = 0 (2.4 voxels: between two sections).
    data = _volume(axes, angles, [((2.0, 2.5, 0.6), 0.5)])
    sig = pair_vector_signal(data, *axes, angles, [(0.5, 0.5, 0.1)], lat)
    at_vector = _value(sig, 0, (0, 0, 0))
    on_plane = float(data[80 + 8, 80 + 10, 80]) / sig.sigma
    assert at_vector == pytest.approx(0.5 / sig.sigma, rel=0.08)
    assert on_plane < 0.6 * at_vector


def test_an_axis_permutation_reads_the_permuted_vector():
    """A structure whose b is the data's a: its differences and lengths are
    given along the data's axes, and read there."""
    data_lat = (4.0, 5.0, 6.0)
    angles = (90.0, 90.0, 90.0)
    axes = _axes(shape=(161, 141, 121))
    data = _volume(axes, angles, [((2.0, 0.0, 1.5), 0.5)])
    cif_lat = (5.0, 4.0, 6.0)
    cif_diff = (0.0, 0.5, 0.25)
    perm = (1, 0, 2)  # data axis i is the structure's axis perm[i]
    diff = tuple(cif_diff[p] for p in perm)
    assert tuple(cif_lat[p] for p in perm) == data_lat
    sig = pair_vector_signal(data, *axes, angles, [diff], data_lat)
    assert _value(sig, 0, (0, 0, 0)) == pytest.approx(0.5 / sig.sigma, abs=4.0)
    # Left in the structure's own order it is another vector, (0, 2, 1.5) Å.
    unpermuted = pair_vector_signal(data, *axes, angles, [cif_diff], cif_lat)
    assert abs(_value(unpermuted, 0, (0, 0, 0))) < 5.0


def test_vectors_are_read_at_the_lengths_they_are_drawn_at():
    """A structure whose cell differs from the ΔPDF's is drawn at its own lengths."""
    angles = (90.0, 90.0, 90.0)
    axes = _axes()
    data = _volume(axes, angles, [((4.4, 0.0, 0.0), -0.5)])
    sig = pair_vector_signal(data, *axes, angles, [(0.5, 0.0, 0.0)], (8.8, 5.0, 6.0))
    assert _value(sig, 0, (0, 0, 0)) == pytest.approx(-0.5 / sig.sigma, rel=0.08)


def test_a_voxel_that_is_not_finite_counts_as_zero():
    axes = _axes(shape=(41, 41, 41))
    x, y, z = axes[0][:, None, None], axes[1][None, :, None], axes[2][None, None, :]
    field = (1.0 + 0.1 * x + 0.0 * y + 0.0 * z).astype(np.float32)
    holed = field.copy()
    holed[28, 20, 20] = np.nan  # (2, 0, 0) Å
    lat = (4.0, 4.0, 4.0)
    sig = pair_vector_signal(holed, *axes, (90.0, 90.0, 90.0), [(0.5, 0.0, 0.0)], lat)
    assert _value(sig, 0, (0, 0, 0)) == 0.0
    assert np.isfinite(sig.values).all()


def test_with_no_spread_every_value_is_missing():
    axes = _axes(shape=(41, 41, 41))
    flat = np.zeros((41, 41, 41), dtype=np.float32)
    sig = pair_vector_signal(flat, *axes, (90.0, 90.0, 90.0), [(0.5, 0.0, 0.0)], (4.0, 4.0, 4.0))
    assert sig.sigma == 0.0 and sig.values.size > 0 and np.isnan(sig.values).all()


def test_more_vectors_than_the_limit_are_refused_before_reading():
    axes = _axes(shape=(41, 41, 41))
    data = _volume(axes, (90.0, 90.0, 90.0), [])
    with pytest.raises(TooManyVectors) as err:
        pair_vector_signal(data, *axes, (90.0, 90.0, 90.0), [(0.5, 0.0, 0.0)], (1.0, 1.0, 1.0),
                           max_values=500)
    assert err.value.n_values == 10 * 11 * 11 and err.value.max_values == 500


def test_bad_input_is_refused():
    axes = _axes(shape=(41, 41, 41))
    data = _volume(axes, (90.0, 90.0, 90.0), [])
    with pytest.raises(ValueError):
        pair_vector_signal(data, *axes, (90.0, 90.0, 90.0), [(0.5, 0.0, 0.0)], (4.0, 0.0, 4.0))
    with pytest.raises(ValueError):
        pair_vector_signal(data, *axes, (90.0, 90.0, 90.0), [(np.nan, 0.0, 0.0)], (4.0, 4.0, 4.0))


def test_reading_in_chunks_changes_nothing_and_copies_no_volume(monkeypatch):
    lat = (4.0, 5.0, 6.0)
    angles = (90.0, 90.0, 120.0)
    axes = _axes(shape=(121, 121, 121))
    data = _volume(axes, angles, [((2.0, 2.5, 0.0), 0.5)])
    diffs = np.random.default_rng(3).random((120, 3))
    whole = pair_vector_signal(data, *axes, angles, diffs, lat)
    floor = sigma_outside_origin(data, *axes, angles)
    assert floor == (whole.sigma, whole.origin_radius)

    monkeypatch.setattr(dpdf_features, "SAMPLE_CHUNK", 4096)
    tracemalloc.start()
    chunked = pair_vector_signal(data, *axes, angles, diffs, lat, floor=floor)
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    assert chunked.values.size > 3 * 4096
    np.testing.assert_array_equal(chunked.values, whole.values)
    # With σ in hand, the working memory is the chunk's, not the volume's (7 MB).
    assert peak < data.nbytes / 3
