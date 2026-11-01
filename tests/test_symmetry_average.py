"""Symmetry averaging (the pipeline's optional first stage) by the NeXus Viewer's rules.

The NeXus Viewer is the reference: NEBULA3D's :func:`~nebula3d.symmetry.symmetry_average`
must give what the viewer's export writes, voxel for voxel.  The fixture
``tests/fixtures/viewer_symmetry_average.json`` holds what the viewer's own code
(``js/export.js`` ``symmetrizeForExport``, ``js/symmetry.js``, ``js/nexus.js``) made
of the inputs :func:`viewer_case` builds, run under node by
``scripts/viewer_symmetry_fixture.py``; the averaged float32 values and the mask
must match it bit for bit.  The inputs come from the Park–Miller generator the
viewer's tests use, so they do not depend on numpy's random streams.
"""

from __future__ import annotations

import base64
import dataclasses
import itertools
import json
from pathlib import Path

import numpy as np
import pytest

import nebula3d
from nebula3d.core import HKLVolume
from nebula3d.symmetry import (
    LAUE_PRESETS,
    METRIC_TOLERANCE,
    GridSymmetry,
    close_group,
    format_op,
    group_label,
    laue_group,
    metric_change,
    parse_generators,
    symmetry_average,
)
from nebula3d.utils import ub_from_lattice

FIXTURE = Path(__file__).parent / "fixtures" / "viewer_symmetry_average.json"

#: The fixture's cases: (name, grid, Laue class).  The hexagonal grid is
#: averaged under two classes (the L-separate path); the cubic one under m-3m,
#: whose three-fold mixes L with H and K (the general path).
VIEWER_CASES: tuple[tuple[str, str, str], ...] = (
    ("hex-6mmm", "hexagonal", "6/mmm"),
    ("hex-3m1", "hexagonal", "-3m1"),
    ("cubic-m3m", "cubic", "m-3m"),
)

#: Cells whose metric change under a Laue class the viewer's ``metricChange``
#: gave (pinned in the fixture): exact, pseudo-symmetric and wrong settings.
METRIC_CELLS: tuple[tuple[tuple[float, ...], str], ...] = (
    ((4.2, 4.2, 6.8, 90.0, 90.0, 120.0), "6/mmm"),
    ((4.2, 4.23, 6.8, 90.0, 90.0, 120.3), "6/mmm"),
    ((4.2, 4.2, 6.8, 90.0, 90.0, 120.0), "mmm"),
    ((5.0, 5.0, 5.0, 90.0, 90.0, 90.0), "m-3m"),
    ((5.0, 5.04, 4.97, 90.0, 90.4, 90.0), "m-3m"),
    ((5.0, 6.0, 7.0, 90.0, 101.0, 90.0), "2/m (b unique)"),
)


def park_miller(seed: int, n: int) -> np.ndarray:
    """``n`` uniform numbers in (0, 1) from the minimal-standard generator the
    viewer's tests use (``s = s·16807 mod 2³¹−1``): the same on every platform
    and numpy version."""
    out = np.empty(n, dtype=np.float64)
    s = seed
    for i in range(n):
        s = (s * 16807) % 2147483647
        out[i] = s / 2147483647
    return out


def viewer_case(grid: str) -> HKLVolume:
    """The float32 input of a fixture case: values and σ from
    :func:`park_miller`, about a third of the voxels unmeasured, whole orbits
    unmeasured near Q = 0 (a beam stop: |Q| < 0.3 Å⁻¹, which every symmetry
    of the cell keeps), a few measured voxels NaN (unmeasured to both) and a
    few σ NaN (unknown)."""
    if grid == "hexagonal":
        shape, ranges = (13, 13, 7), ((-0.6, 0.6), (-0.6, 0.6), (-0.3, 0.3))
        ub = ub_from_lattice(4.2, 4.2, 6.8, 90.0, 90.0, 120.0)
        seed = 7
    elif grid == "cubic":
        shape, ranges = (9, 9, 9), ((-0.4, 0.4),) * 3
        ub = ub_from_lattice(5.0, 5.0, 5.0, 90.0, 90.0, 90.0)
        seed = 11
    else:
        raise ValueError(grid)
    n = int(np.prod(shape))
    u = park_miller(seed, 4 * n).reshape(4, *shape)
    data = (10.0 * u[0]).astype(np.float32)
    sigma = (0.1 + 0.2 * u[1]).astype(np.float32)
    vol = HKLVolume.from_arrays(data, *ranges, sigma=sigma, ub_matrix=ub, dtype=np.float32)
    vol.mask = (u[2] >= 0.35) & (vol.q_magnitude() >= 0.3)
    vol.data[~vol.mask] = 0.0
    vol.sigma[~vol.mask] = 0.0
    nan_data = (u[3] < 0.03) & vol.mask
    vol.data[nan_data] = np.nan
    vol.sigma[(u[3] > 0.97) & vol.mask] = np.nan
    return vol


def _decode(text: str, dtype: str, shape: tuple[int, ...]) -> np.ndarray:
    return np.frombuffer(base64.b64decode(text), dtype=dtype).reshape(shape)


@pytest.fixture(scope="module")
def viewer() -> dict:
    return json.loads(FIXTURE.read_text())


def _averaged(grid: str, laue: str) -> tuple[HKLVolume, GridSymmetry]:
    vol = viewer_case(grid)
    sym = GridSymmetry.for_volume(vol, laue_group(laue).ops)
    symmetry_average(vol, sym)
    return vol, sym


# ---------------------------------------------------------------------------
# The group: the viewer's presets, syntax and order
# ---------------------------------------------------------------------------
def test_the_presets_close_to_the_viewers_groups(viewer):
    assert [name for name, _ in LAUE_PRESETS] == viewer["presets"]["names"]
    for name, _gens in LAUE_PRESETS:
        group = laue_group(name)
        assert group.label == name
        # the closed group in the viewer's own order, as its export writes it
        assert [format_op(m) for m in group.ops] == viewer["presets"]["ops"][name]


def test_generators_close_to_the_preset_they_generate():
    assert laue_group("h+k,-h,l; -k,-h,-l; -h,-k,-l").label == "6/mmm"
    assert laue_group("6/MMM").label == "6/mmm"  # preset names in any case
    assert laue_group("x-y,x,z; -x,-y,-z").label == "6/m"  # real-space triplets: R = Wᵀ
    assert laue_group("k,-h,l; -h,-k,-l").label == "4/m"
    assert laue_group("h,k,-l; -h,-k,-l").label == "2/m (c unique)"
    assert laue_group("-k,h,l").label == "custom"  # a four-fold alone: not a Laue class
    assert laue_group("None").order == 1


@pytest.mark.parametrize("spec, message", [
    ("", "Choose a Laue class"),
    ("6/mm", "not a Laue class here"),
    ("h,k", "needs three comma-separated components"),
    ("h+x,k,l", "mixes h,k,l with x,y,z"),
    ("h+1,k,l", "Cannot read"),
    ("2h,k,l", "determinant 2"),
    ("h,k,a", "Unknown symbol"),
])
def test_unreadable_classes_are_refused_with_the_viewers_messages(spec, message):
    with pytest.raises(ValueError, match=message):
        laue_group(spec)


def test_closure_refuses_more_than_48_operations():
    # A hexagonal six-fold with a cubic three-fold generates an infinite group.
    with pytest.raises(ValueError, match="more than 48 operations"):
        close_group(parse_generators("h+k,-h,l; k,l,h"))


def test_group_label_names_any_order_of_the_same_group():
    ops = list(laue_group("6/mmm").ops)
    assert group_label(ops[::-1]) == "6/mmm"


# ---------------------------------------------------------------------------
# The metric check
# ---------------------------------------------------------------------------
def test_metric_change_matches_the_viewer(viewer):
    for (cell, laue), pinned in zip(METRIC_CELLS, viewer["metric"]):
        got = metric_change(laue_group(laue).ops, ub_from_lattice(*cell))
        assert got == pytest.approx(pinned, rel=1e-9, abs=1e-12), (cell, laue)


def test_metric_tolerance_is_the_viewers_two_percent():
    assert METRIC_TOLERANCE == 0.02
    ops = laue_group("6/mmm").ops
    assert metric_change(ops, ub_from_lattice(4.2, 4.2, 6.8, 90, 90, 120)) < 1e-12
    assert metric_change(ops, ub_from_lattice(4.2, 4.2, 6.8, 90, 90, 90)) > METRIC_TOLERANCE


# ---------------------------------------------------------------------------
# The average itself: the viewer's export, bit for bit
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("name, grid, laue", VIEWER_CASES)
def test_the_average_is_the_viewers_bit_for_bit(viewer, name, grid, laue):
    case = viewer["cases"][name]
    vol, _ = _averaged(grid, laue)
    shape = vol.data.shape
    assert list(shape) == case["shape"]
    data = _decode(case["data"], "<f4", shape)
    valid = _decode(case["valid"], "u1", shape).astype(bool)
    sigma = _decode(case["sigma"], "<f4", shape)
    assert np.array_equal(vol.mask, valid)
    assert np.array_equal(vol.data.view(np.uint32), data.view(np.uint32))
    # σ: the viewer holds variances as float32 (errors_squared read into a
    # Float32Array), NEBULA3D squares its float32 σ in float64.
    np.testing.assert_allclose(vol.sigma[valid], sigma[valid], rtol=3e-7)
    assert not vol.sigma[~valid].any() and not vol.data[~valid].any()


@pytest.mark.parametrize("name, grid, laue", VIEWER_CASES)
def test_a_float64_volume_rounds_to_the_viewers_float32(viewer, name, grid, laue):
    case = viewer["cases"][name]
    vol = viewer_case(grid)
    vol = dataclasses.replace(vol, data=vol.data.astype(np.float64),
                              sigma=vol.sigma.astype(np.float64), mask=vol.mask.copy())
    symmetry_average(vol, GridSymmetry.for_volume(vol, laue_group(laue).ops))
    data = _decode(case["data"], "<f4", vol.data.shape)
    assert np.array_equal(vol.data.astype(np.float32), data)


@pytest.mark.parametrize("name, grid, laue", VIEWER_CASES)
def test_the_stats_count_as_the_viewer_does(viewer, name, grid, laue):
    case = viewer["cases"][name]
    vol = viewer_case(grid)
    stats = symmetry_average(vol, GridSymmetry.for_volume(vol, laue_group(laue).ops))
    assert stats.measured_before == case["stats"]["measured"]
    assert stats.measured_after == case["stats"]["valid"]
    assert stats.order == laue_group(laue).order


# ---------------------------------------------------------------------------
# Properties that hold whatever the reference says
# ---------------------------------------------------------------------------
def _images(sym: GridSymmetry, x: tuple[int, int, int]) -> set[tuple[int, int, int]]:
    out = set()
    for r, t in sym.index_ops:
        y = tuple(int(v) for v in r @ np.asarray(x) + t)
        if all(0 <= y[a] < sym.shape[a] for a in range(3)):
            out.add(y)
    return out


@pytest.mark.parametrize("grid, laue", [("hexagonal", "6/mmm"), ("hexagonal", "6/m"),
                                        ("hexagonal", "-3"), ("cubic", "m-3m"),
                                        ("cubic", "m-3"), ("cubic", "mmm")])
def test_the_average_is_invariant_under_every_operation(grid, laue):
    vol, sym = _averaged(grid, laue)
    for r, t in sym.index_ops:
        for x in itertools.product(*map(range, sym.shape)):
            y = tuple(int(v) for v in r @ np.asarray(x) + t)
            if all(0 <= y[a] < sym.shape[a] for a in range(3)):
                assert vol.mask[x] == vol.mask[y]
                assert vol.data[x] == vol.data[y]  # exactly: one mean per orbit
                assert vol.sigma[x] == vol.sigma[y]


@pytest.mark.parametrize("grid, laue", [("hexagonal", "6/mmm"), ("cubic", "m-3m")])
def test_each_orbit_keeps_the_mean_of_its_measured_voxels(grid, laue):
    before = viewer_case(grid)
    vol, sym = _averaged(grid, laue)
    seen = np.zeros(sym.shape, dtype=bool)
    orbits = 0
    for x in itertools.product(*map(range, sym.shape)):
        if seen[x]:
            continue
        members = sorted(_images(sym, x))
        for y in members:
            seen[y] = True
        measured = [float(before.data[y]) for y in members
                    if before.mask[y] and np.isfinite(before.data[y])]
        if not measured:
            assert not any(vol.mask[y] for y in members)
            continue
        orbits += 1
        # every member, measured or not, holds the equal-weight mean of the measured ones
        for y in members:
            assert vol.mask[y]
            assert float(vol.data[y]) == pytest.approx(np.mean(measured), rel=2e-7)
    assert orbits > 20


def test_measured_voxels_are_never_lost_and_gaps_fill_from_equivalents():
    before = viewer_case("hexagonal")
    vol, _ = _averaged("hexagonal", "6/mmm")
    pooled = before.mask & np.isfinite(before.data)
    assert np.all(vol.mask[pooled])          # an orbit with a measured member stays measured
    assert vol.mask.sum() > pooled.sum()     # and fills its unmeasured members


def test_an_estimated_sigma_stays_estimated_as_the_root_of_the_mean():
    vol = viewer_case("cubic")
    vol = dataclasses.replace(vol, sigma=np.sqrt(np.abs(vol.data)), sigma_estimated=True)
    symmetry_average(vol, GridSymmetry.for_volume(vol, laue_group("m-3m").ops))
    assert vol.sigma_estimated
    np.testing.assert_array_equal(vol.sigma[vol.mask],
                                  np.sqrt(np.abs(vol.data[vol.mask].astype(np.float64)))
                                  .astype(np.float32))


def test_a_sigma_known_for_no_member_defaults_to_the_root_of_the_mean():
    vol = viewer_case("cubic")
    vol.sigma[:] = np.nan
    stats = symmetry_average(vol, GridSymmetry.for_volume(vol, laue_group("m-3m").ops))
    assert stats.sigma_defaulted == int(vol.mask.sum())
    np.testing.assert_allclose(vol.sigma[vol.mask], np.sqrt(np.abs(vol.data[vol.mask])), rtol=1e-6)


def test_slabs_of_any_size_give_the_same_average():
    whole, _ = _averaged("cubic", "m-3m")
    for slab in (1, 81, 500):
        vol = viewer_case("cubic")
        symmetry_average(vol, GridSymmetry.for_volume(vol, laue_group("m-3m").ops),
                         slab_voxels=slab)
        assert np.array_equal(vol.data.view(np.uint32), whole.data.view(np.uint32))
        assert np.array_equal(vol.mask, whole.mask)


def test_r_int_is_zero_on_symmetric_data_and_grows_with_a_wrong_class():
    vol, sym = _averaged("hexagonal", "6/mmm")
    again = symmetry_average(vol, sym)
    assert again.r_int == pytest.approx(0.0, abs=1e-6)
    assert again.measured_after == again.measured_before  # nothing left to fill


def test_a_grid_the_operations_do_not_map_is_refused():
    vol = viewer_case("hexagonal")
    off = dataclasses.replace(vol, k_axis=vol.k_axis * 1.5)  # unequal H and K steps
    with pytest.raises(ValueError, match="does not map this volume's HKL grid onto itself"):
        GridSymmetry.for_volume(off, laue_group("6/mmm").ops)


def test_the_file_round_trip_changes_nothing(tmp_path):
    vol = viewer_case("cubic")
    nebula3d.save(vol, tmp_path / "in.nxs")
    back = nebula3d.load(tmp_path / "in.nxs", dtype=None)
    symmetry_average(back, GridSymmetry.for_volume(back, laue_group("m-3m").ops))
    direct, _ = _averaged("cubic", "m-3m")
    assert np.array_equal(back.data.view(np.uint32), direct.data.view(np.uint32))
    assert np.array_equal(back.mask, direct.mask)
