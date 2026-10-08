# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""A Bragg punch that does not depend on the data's intensity units.

X-ray rates and neutron counts differ by orders of magnitude, and so do two
experiments on the same instrument.  The pipeline's default punch decides
integer nodes by significance over each peak's own background shell
(``integer_detect="significance"``) and sizes the search floors in units of
the diffuse scatter (``search_floor_unit="scatter"``), so a volume multiplied
by any factor is punched the same.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from nebula3d.analysis.bragg import BraggRemover
from nebula3d.core import HKLVolume
from nebula3d.demo import demo_volume
from nebula3d.pipeline import PunchParams, punch_bragg

A = 4.2  # cubic cell (Å); 0.05 r.l.u. voxels = 0.075 Å⁻¹
N = 81
EXTENT = 2.0
BG = 0.05


def _axis() -> np.ndarray:
    return np.linspace(-EXTENT, EXTENT, N)


def _index(hkl: tuple[float, float, float]) -> tuple[int, int, int]:
    ax = _axis()
    return tuple(int(np.argmin(np.abs(ax - v))) for v in hkl)  # type: ignore[return-value]


def _gaussian(centre: tuple[float, float, float], width: float) -> np.ndarray:
    ax = _axis()
    hh, kk, ll = np.meshgrid(ax, ax, ax, indexing="ij")
    r2 = (hh - centre[0]) ** 2 + (kk - centre[1]) ** 2 + (ll - centre[2]) ** 2
    return np.exp(-0.5 * r2 / width**2)


def _volume(*, sharp=(), broad=(), noise=0.01, seed=3) -> HKLVolume:
    """Flat background, sharp (resolution-width) and broad Gaussians, noise.

    *sharp* / *broad*: ``((h, k, l), amplitude)`` pairs.  Sharp peaks are half
    a voxel wide, broad ones 0.25 r.l.u. (5 voxels).
    """
    rng = np.random.default_rng(seed)
    data = np.full((N, N, N), BG)
    for centre, amp in sharp:
        data += amp * _gaussian(centre, 0.025)
    for centre, amp in broad:
        data += amp * _gaussian(centre, 0.25)
    sigma = np.full_like(data, noise)
    data += noise * rng.standard_normal(data.shape)
    return HKLVolume.from_arrays(
        data, (-EXTENT, EXTENT), (-EXTENT, EXTENT), (-EXTENT, EXTENT),
        sigma=sigma, ub_matrix=(2 * np.pi / A) * np.eye(3))


def _scaled(vol: HKLVolume, factor: float) -> HKLVolume:
    return dataclasses.replace(vol, data=vol.data * factor, sigma=vol.sigma * factor)


def _significance(**kw) -> BraggRemover:
    base = dict(mode="integer", integer_detect="significance", min_significance=5.0,
                punch_incident_beam=False)
    base.update(kw)
    return BraggRemover(**base)


def _nodes(peaks) -> set[tuple[int, int, int]]:
    return {p.source_node_hkl for p in peaks}


def test_default_punch_is_the_same_at_any_intensity_scale():
    vol = demo_volume(65, extent=3.0)
    base = punch_bragg(vol, PunchParams()).mask
    # Powers of two scale every median, sum and threshold exactly.
    for factor in (2.0**-10, 2.0**10):
        assert np.array_equal(punch_bragg(_scaled(vol, factor), PunchParams()).mask, base)


def test_data_unit_floors_were_not():
    vol = demo_volume(65, extent=3.0)
    legacy = PunchParams(integer_detect="floors", search_floor_unit="data",
                         search_min_intensity=0.8, search_min_prominence=0.8)
    n = int((~punch_bragg(vol, legacy).mask & vol.mask).sum())
    # ×8 puts the diffuse above the data-unit floors: they stop protecting it.
    n8 = int((~punch_bragg(_scaled(vol, 8.0), legacy).mask & vol.mask).sum())
    assert n8 > 1.5 * n


def test_weak_sharp_peaks_are_found_at_any_scale():
    planted = ((1, 0, 0), (0, 1, 1), (-1, 1, 0))
    vol = _volume(sharp=[(n, 0.2) for n in planted])
    for factor in (1.0, 1e-4, 1e4):
        found = _nodes(_significance()._detect_peak_records(_scaled(vol, factor)))
        assert found == set(planted)


def test_broad_diffuse_maximum_at_a_node_is_not_bragg():
    hump, peak = (1, 1, 0), (-1, 0, 1)
    vol = _volume(sharp=[(peak, 0.4)], broad=[(hump, 0.4)])
    r = _significance()
    assert _nodes(r._detect_peak_records(vol)) == {peak}
    # Against its window's median the hump is significant: the shell is what
    # tells it from a peak.
    idx = _index(hump)
    sl = r._box(vol, idx, r._detect_half_widths(vol))
    assert r._peak_significance(vol, idx, float(np.median(vol.data[sl])), 0.0) > 5.0


def _two_peaks(width: float, *, noise: float = 0.005) -> HKLVolume:
    """A sharp peak at (-1, 0, 1) and an equally high maximum *width* r.l.u.
    wide at (1, 1, 0)."""
    rng = np.random.default_rng(3)
    data = (np.full((N, N, N), BG) + 0.4 * _gaussian((-1, 0, 1), 0.025)
            + 0.4 * _gaussian((1, 1, 0), width)
            + noise * rng.standard_normal((N, N, N)))
    return HKLVolume.from_arrays(
        data, (-EXTENT, EXTENT), (-EXTENT, EXTENT), (-EXTENT, EXTENT),
        sigma=np.full_like(data, noise), ub_matrix=(2 * np.pi / A) * np.eye(3))


def test_a_maximum_a_few_times_wider_than_bragg_is_not_bragg():
    # 0.1 r.l.u. is two voxels: about three times the resolution here.  It
    # stands above its 1–2× shell, so the shell test alone takes it; the
    # width test sees that the shell still holds much of its excess.
    vol = _two_peaks(0.10)
    assert _nodes(_significance()._detect_peak_records(vol)) == {(-1, 0, 1), (1, 1, 0)}
    width = _significance(integer_max_shell_fraction=0.15)
    assert _nodes(width._detect_peak_records(vol)) == {(-1, 0, 1)}


def test_width_test_keeps_weak_sharp_peaks_at_any_scale():
    planted = ((1, 0, 0), (0, 1, 1), (-1, 1, 0))
    vol = _volume(sharp=[(n, 0.2) for n in planted])
    r = _significance(integer_max_shell_fraction=0.15)
    for factor in (1.0, 1e-4, 1e4):
        assert _nodes(r._detect_peak_records(_scaled(vol, factor))) == set(planted)


def test_window_threshold_corrects_for_picking_the_brightest_voxel():
    r = _significance()
    assert r._window_threshold(1) == pytest.approx(5.0)
    assert r._window_threshold(125) == pytest.approx(5.86, abs=0.01)
    assert r._window_threshold(343) == pytest.approx(6.03, abs=0.01)


def test_significance_test_needs_min_significance():
    with pytest.raises(ValueError, match="min_significance"):
        BraggRemover(integer_detect="significance", min_significance=None)
    with pytest.raises(ValueError, match="integer_detect"):
        BraggRemover(integer_detect="height")


def test_search_floors_in_scatter_units_follow_the_scale():
    vol = _volume(noise=0.01)
    r = BraggRemover(mode="search", search_floor_unit="scatter",
                     search_min_intensity=27.0, search_min_prominence=20.0,
                     punch_incident_beam=False)
    r._detect_peak_records(vol)
    scatter = r._search_report["diffuse_scatter"]
    assert scatter == pytest.approx(0.01, rel=0.05)  # the noise: nothing else varies
    assert r._search_report["min_intensity"] == pytest.approx(27.0 * scatter)
    assert r._search_report["min_prominence"] == pytest.approx(20.0 * scatter)
    r._detect_peak_records(_scaled(vol, 4.0))
    assert r._search_report["diffuse_scatter"] == pytest.approx(4.0 * scatter)
    with pytest.raises(ValueError, match="search_floor_unit"):
        BraggRemover(search_floor_unit="counts")


def test_data_unit_search_floors_are_unchanged():
    vol = _volume(noise=0.01)
    r = BraggRemover(mode="search", search_min_intensity=0.3, search_min_prominence=0.1,
                     punch_incident_beam=False)
    r._detect_peak_records(vol)
    assert "diffuse_scatter" not in r._search_report
    assert r._search_report["min_intensity"] == 0.3
    assert r._search_report["min_prominence"] == 0.1
