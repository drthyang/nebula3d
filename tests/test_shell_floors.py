"""The flatten's per-|Q|-shell floors over the whole volume (shell_floors).

Known answers on synthetic volumes only: the floors are the flatten's own
``raw_levels`` and ``np.percentile`` exactly; a flat floor reads the same in
every shell and a Q² pedestal reads the span it was built with; partly
measured shells count what is measured; the low-memory path gives the same
numbers.  Last, the Pilot's pedestal rule (``web/src/llm/metrics/flatten.ts``,
ported below) read on the three planes through the origin and on the whole
volume: the same pedestal on an isotropic volume, and only the volume's on a
background that the planes miss.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from nebula3d.core import HKLVolume
from nebula3d.preprocessing import flatten_radial_background, shell_floors
from nebula3d.visualization import extract_slice

DTYPES = pytest.mark.parametrize("dtype", [np.float64, np.float32])


def _skewed(shape=(41, 45, 49), seed=0, dtype=np.float64):
    """A triclinic-ish volume: a Q² pedestal on a gamma-distributed diffuse,
    ties at 0 and at a fill value, NaNs, and the low-|Q| core and the box's
    corners unmeasured."""
    rng = np.random.default_rng(seed)
    ub = 2 * np.pi * (np.eye(3) / 4.0 + 0.02 * rng.normal(size=(3, 3)))
    vol = HKLVolume.from_arrays(np.zeros(shape), (-3, 3), (-3.5, 3.5), (-4, 4), ub_matrix=ub,
                                dtype=dtype)
    q = vol.q_magnitude()
    data = 1.0 + 0.2 * q ** 2 + rng.gamma(2.0, 0.5, shape)
    data[rng.random(shape) < 0.01] = 0.0
    data[rng.random(shape) < 0.01] = 7.25
    data[rng.random(shape) < 0.02] = np.nan
    vol.data[...] = data
    vol.mask &= (q > 0.6) & (q < 0.9 * q.max())
    return vol


def _shell_of(vol, edges, q1):
    """Each voxel's shell (−1 outside them), restated from the definition:
    ``digitize − 1``, the measured voxels at the range's end clipped into the
    last shell."""
    q = vol.q_magnitude()
    nb = edges.size - 1
    b = np.clip(np.digitize(q, edges) - 1, 0, nb - 1)
    inside = (q >= edges[0]) & ((q < edges[-1]) | (q <= q1))
    return np.where(inside, b, -1)


def _reference(vol, edges, q1, p, min_count):
    b = _shell_of(vol, edges, q1)
    valid = vol.mask & np.isfinite(vol.data)
    out = np.full(edges.size - 1, np.nan)
    for i in range(out.size):
        seg = vol.data[valid & (b == i)].astype(np.float64)
        if seg.size >= min_count:
            out[i] = np.percentile(seg, p)
    return out


# ---------------------------------------------------------------------------
# Exactly the flatten's floors, exactly np.percentile
# ---------------------------------------------------------------------------
@DTYPES
def test_floors_are_the_flattens_own_levels(dtype):
    vol = _skewed(dtype=dtype)
    res = flatten_radial_background(vol)
    r = shell_floors(vol)
    assert np.array_equal(r.floors, res.raw_levels, equal_nan=True)
    assert np.array_equal(r.counts, res.counts)
    assert np.array_equal(r.centres, res.q_grid)
    assert (r.q_step, r.percentile, r.min_count) == (0.05, 25.0, 20)
    # The pair: the flatten's input sets the shells, and its floors are the
    # flatten's levels; the output is measured on the same shells.
    flat = flatten_radial_background(vol).volume
    pair = shell_floors(flat, before=vol)
    assert np.array_equal(pair.floors_before, res.raw_levels, equal_nan=True)
    assert np.array_equal(pair.centres, res.q_grid)
    assert np.array_equal(pair.counts, pair.counts_before)


@DTYPES
@pytest.mark.parametrize("p", [0.0, 10.0, 25.0, 100 / 3, 50.0, 90.0, 100.0])
def test_every_percentile_is_numpys(dtype, p):
    vol = _skewed(shape=(33, 35, 37), seed=3, dtype=dtype)
    r = shell_floors(vol, percentile=p, q_step=0.08, min_count=1)
    valid = vol.mask & np.isfinite(vol.data)
    q1 = float(vol.q_magnitude()[valid].max())
    assert np.array_equal(r.floors, _reference(vol, r.q_edges, q1, p, 1), equal_nan=True)
    assert np.array_equal(r.medians, _reference(vol, r.q_edges, q1, 50.0, 1), equal_nan=True)
    assert r.level == np.percentile(vol.data[valid].astype(np.float64), 50.0)
    assert r.level_count == int(valid.sum())


def test_hard_distributions_are_exact():
    """Heavy tails, negatives, a constant shell and massive ties: each shell's
    floor and median as np.percentile gives them."""
    rng = np.random.default_rng(5)
    vol = HKLVolume.from_arrays(np.zeros((49, 49, 49)), (-3, 3), (-3, 3), (-3, 3),
                                ub_matrix=2 * np.pi * np.eye(3) / 4.0)
    q = vol.q_magnitude()
    data = rng.standard_cauchy(q.shape) * 1e-3 + np.where(q > 2.5, -3.0, 0.0)
    data[(q > 1.0) & (q < 1.6)] = 4.0                                 # constant shells
    ties = (q > 3.0) & (rng.random(q.shape) < 0.6)
    data[ties] = 0.125                                                # most of a shell tied
    data[(q > 0.5) & (q < 0.9)] *= 1e30                               # past float32's range
    vol.data[...] = data
    r = shell_floors(vol, q_step=0.1)
    q1 = float(q.max())
    assert np.array_equal(r.floors, _reference(vol, r.q_edges, q1, 25.0, 20), equal_nan=True)
    assert np.array_equal(r.medians, _reference(vol, r.q_edges, q1, 50.0, 20), equal_nan=True)
    assert np.isfinite(r.floors).sum() > 30


def test_level_is_the_median_over_voxels_measured_in_both():
    vol = _skewed(seed=1)
    before = dataclasses.replace(vol, data=vol.data + 2.0, mask=vol.mask.copy())
    rng = np.random.default_rng(2)
    vol.mask &= rng.random(vol.mask.shape) > 0.1    # the output lost a tenth
    r = shell_floors(vol, before=before)
    both = (vol.mask & np.isfinite(vol.data)) & (before.mask & np.isfinite(before.data))
    assert r.level == np.percentile(before.data[both], 50.0)
    assert r.level_count == int(both.sum())
    assert np.all(r.counts <= r.counts_before)


def test_constant_volume_is_read_in_one_pass():
    vol = HKLVolume.from_arrays(np.full((21, 23, 25), 3.5), (-2, 2), (-2, 2), (-2, 2),
                                ub_matrix=2 * np.pi * np.eye(3) / 4.0)
    r = shell_floors(vol)
    measured = r.counts >= 20
    assert measured.any() and np.all(r.floors[measured] == 3.5)
    assert np.all(r.medians[measured] == 3.5) and r.level == 3.5
    assert np.all(np.isnan(r.floors[~measured]))
    assert r.passes == 1


def test_nothing_measured_and_bad_arguments():
    vol = HKLVolume.from_arrays(np.zeros((9, 9, 9)), (-1, 1), (-1, 1), (-1, 1))
    vol.mask[...] = False
    r = shell_floors(vol, before=vol)
    assert r.centres.size == 0 and r.floors_before is not None and r.floors_before.size == 0
    assert np.isnan(r.level) and r.level_count == 0
    vol.mask[...] = True
    for bad in ({"q_step": 0.0}, {"q_step": float("nan")}, {"percentile": 101.0},
                {"percentile": -1.0}, {"min_count": 0}, {"q_step": 1e-5}):
        with pytest.raises(ValueError):
            shell_floors(vol, **bad)
    other = HKLVolume.from_arrays(np.zeros((9, 9, 10)), (-1, 1), (-1, 1), (-1, 1))
    with pytest.raises(ValueError, match="grid"):
        shell_floors(vol, before=other)


# ---------------------------------------------------------------------------
# Known answers
# ---------------------------------------------------------------------------
# The diffuse is uniform on [0, D): its 25th percentile is D/4 at every |Q|.
D = 0.2


def _ball(b=0.0, c=0.25, n=81, q_max=6.0, seed=0, pedestal_off_planes=False):
    """(before, after) on a cubic grid measured out to q_max (Å⁻¹): after =
    a uniform diffuse + b·Q², before = after + c (the constant a flatten took
    out).  With pedestal_off_planes, the voxels on the planes h = 0, k = 0 and
    l = 0 carry no b·Q²."""
    rng = np.random.default_rng(seed)
    vol = HKLVolume.from_arrays(np.zeros((n, n, n)), (-4, 4), (-4, 4), (-4, 4),
                                ub_matrix=2 * np.pi * np.eye(3) / 4.0)
    q = vol.q_magnitude()
    pedestal = b * q ** 2
    if pedestal_off_planes:
        H, K, L = vol.hkl_grid()
        on = np.isclose(H, 0.0) | np.isclose(K, 0.0) | np.isclose(L, 0.0)
        pedestal = np.where(on, 0.0, pedestal)
    after = D * rng.random(q.shape) + pedestal
    measured = q <= q_max
    return (dataclasses.replace(vol, data=after + c, mask=measured.copy()),
            dataclasses.replace(vol, data=after, mask=measured.copy()))


def test_a_flat_floor_reads_the_same_in_every_shell():
    before, after = _ball(b=0.0)
    r = shell_floors(after, before=before)
    full = r.counts >= 500
    assert full.sum() > 50
    assert np.all(np.abs(r.floors[full] - D / 4) < 0.012)
    assert np.all(np.abs(r.floors_before[full] - (0.25 + D / 4)) < 0.012)
    trend, span, _ = pedestal_rule(r.floors, r.centres, r.counts, r.totals, r.level)
    assert span < 0.05 and not (abs(trend) >= 0.8 and span >= 0.8)


def test_a_pedestal_reads_as_rising_floors_with_the_span_built_in():
    b = 0.06
    before, after = _ball(b=b)
    r = shell_floors(after, before=before)
    full = r.counts >= 500
    # each shell's floor is the diffuse's plus the pedestal at its |Q|
    assert np.all(np.abs(r.floors[full] - (D / 4 + b * r.centres[full] ** 2)) < 0.02)
    trend, span, judged = pedestal_rule(r.floors, r.centres, r.counts, r.totals, r.level)
    lo, hi = judged
    assert (lo, hi) == pytest.approx((3.025, 5.975))  # the outer half of 0–6 Å⁻¹
    assert trend == 1.0
    assert span == pytest.approx(b * (hi ** 2 - lo ** 2) / r.level, rel=0.02)
    assert span >= 0.8  # a pedestal left, by the Pilot's rule


def test_partly_measured_shells_count_what_is_measured():
    _before, after = _ball(b=0.0, n=61)
    q = after.q_magnitude()
    H, K, L = after.hkl_grid()
    after.mask &= ~((q > 2.5) & (L < 0))       # half of every shell past 2.5 Å⁻¹ unmeasured
    lost = (np.abs(H - 1.0) < 0.2) & (np.abs(K) < 0.2) & (np.abs(L - 0.5) < 0.2)
    after.data[lost] = np.nan                   # and a block lost with its mask still set
    r = shell_floors(after)
    valid = after.mask & np.isfinite(after.data)
    q1 = float(q[valid].max())
    shell = _shell_of(after, r.q_edges, q1)
    assert np.array_equal(r.counts, np.bincount(shell[valid & (shell >= 0)],
                                                minlength=r.centres.size))
    assert np.array_equal(r.totals, np.bincount(shell[shell >= 0], minlength=r.centres.size))
    share = r.counts / np.maximum(r.totals, 1)
    clean = (r.centres > 0.5) & (r.centres < 1.2)          # inside 2.5 Å⁻¹, clear of the block
    half = (r.centres > 2.6) & (r.centres < 5.9)
    assert np.all(share[clean] == 1.0)
    assert np.all((share[half] > 0.45) & (share[half] < 0.6))  # the l ≥ 0 half, l = 0 in it
    assert np.all(share[(r.centres > 1.6) & (r.centres < 1.9)] < 1.0)  # the block's shells
    # The floor is the measured half's, and no shell past 2.5 Å⁻¹ is judged:
    # the counts do not reach them.
    assert np.all(np.abs(r.floors[half] - D / 4) < 0.015)
    judged = judged_shells(r.floors, r.centres, r.counts, r.totals)
    assert judged and max(r.centres[judged]) < 2.5


def test_low_memory_gives_the_same_numbers(monkeypatch):
    vol = _skewed(shape=(47, 41, 43), seed=6, dtype=np.float32)
    flat = flatten_radial_background(vol).volume
    native = shell_floors(flat, before=vol)
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    for slab in (None, 1, 5):
        lean = shell_floors(flat, before=vol, slab=slab)
        for f in dataclasses.fields(native):
            if f.name == "passes":
                continue
            a, b = getattr(native, f.name), getattr(lean, f.name)
            if isinstance(a, np.ndarray):
                assert np.array_equal(a, b, equal_nan=True), f.name
            else:
                assert a == b or (a != a and b != b), f.name


# ---------------------------------------------------------------------------
# The Pilot's rule, on three planes and on the whole volume
# ---------------------------------------------------------------------------
FULL_SHELL = 0.95       # flatten.ts: a shell the counts reach
FIT_Q = (0.8, 10.0)     # flatten.ts: FLATTEN_FIT_Q, the flatten's fit range


def _ts_percentile(values, p):
    """sliceStats.ts ``percentile`` (p in 0–1, linear)."""
    s = np.sort(np.asarray(values, dtype=np.float64))
    idx = max(0.0, min(s.size - 1.0, p * (s.size - 1)))
    lo, hi = int(np.floor(idx)), int(np.ceil(idx))
    return float(s[lo]) if lo == hi else float(s[lo] + (s[hi] - s[lo]) * (idx - lo))


def judged_shells(floors, centres, counts, totals, q_range=FIT_Q):
    """flatten.ts ``judgedShells``: the shells the counts reach (≥ 0.95 of
    their voxels measured, not inside the fit range's start), from half the
    outermost one's |Q| outward."""
    reached = [i for i in range(len(floors))
               if np.isfinite(floors[i]) and totals[i] > 0
               and counts[i] >= FULL_SHELL * totals[i] and centres[i] >= q_range[0]]
    if not reached:
        return []
    outer = max(centres[i] for i in reached)
    return [i for i in reached if centres[i] >= 0.5 * outer]


def _rank_trend(y):
    """flatten.ts ``rankTrend``: Spearman correlation of y with its order."""
    n = len(y)
    if n < 5:
        return None
    rank = np.empty(n)
    rank[np.argsort(y, kind="stable")] = np.arange(n)
    i = np.arange(n) - (n - 1) / 2
    return float(np.sum(i * (rank - (n - 1) / 2)) / np.sum(i * i))


def pedestal_rule(floors, centres, counts, totals, base):
    """flatten.ts's trend and span: the judged floors' rank correlation with
    |Q|, and their range over the diffuse level ``base``; and the judged |Q|."""
    j = judged_shells(floors, centres, counts, totals)
    out = [float(floors[i]) for i in j]
    trend = _rank_trend(out)
    span = (max(out) - min(out)) / base if len(out) >= 5 and base > 0 else None
    return trend, span, ((float(centres[j[0]]), float(centres[j[-1]])) if j else None)


def _plane(vol, plane):
    """flatten.ts's inputs on one plane through the origin: sliceStats.ts
    ``radialFloorShells`` (30 shells out to the plane's farthest |Q|, the 25th
    percentile, at least 20 voxels), and the plane's values."""
    sd = extract_slice(vol, plane, 0.0)
    hkl = np.zeros(sd.data.shape + (3,))
    xx, yy = np.meshgrid(sd.x_axis, sd.y_axis)
    hkl[..., "hkl".index(sd.x_label[0].lower())] = xx
    hkl[..., "hkl".index(sd.y_label[0].lower())] = yy
    r = np.linalg.norm(hkl @ np.asarray(vol.ub_matrix).T, axis=-1)
    nbins, rmax = 30, float(r.max())
    shell = np.minimum(nbins - 1, np.floor(r * nbins / rmax).astype(int))
    floors, counts, totals = [], [], []
    for i in range(nbins):
        v = sd.data[shell == i]
        v = v[np.isfinite(v)]
        totals.append(int(np.sum(shell == i)))
        counts.append(int(v.size))
        floors.append(_ts_percentile(v, 0.25) if v.size >= 20 else np.nan)
    centres = (np.arange(nbins) + 0.5) * rmax / nbins
    return np.array(floors), centres, np.array(counts), np.array(totals), sd.data


def _plane_rule(before, after, plane):
    fa, ca, na, ta, da = _plane(after, plane)
    *_, db = _plane(before, plane)
    both = np.isfinite(da) & np.isfinite(db)
    return pedestal_rule(fa, ca, na, ta, _ts_percentile(db[both], 0.5)), (fa, ca, na, ta)


PLANES = ("hk0", "h0l", "0kl")


def test_planes_and_volume_read_the_same_isotropic_pedestal():
    b = 0.06
    before, after = _ball(b=b)
    r = shell_floors(after, before=before)
    trend3, span3, _ = pedestal_rule(r.floors, r.centres, r.counts, r.totals, r.level)
    for plane in PLANES:
        (trend2, span2, _), (fa, ca, na, ta) = _plane_rule(before, after, plane)
        # The planes' floors lie on the volume's within noise (their shells
        # are six times wider: a few hundredths on a floor rising 2 over them).
        ok = np.isfinite(fa) & (na >= FULL_SHELL * ta) & (ca >= FIT_Q[0])
        assert np.max(np.abs(fa[ok] - np.interp(ca[ok], r.centres, r.floors))) < 0.06
        assert trend2 == trend3 == 1.0
        assert span2 >= 0.8 and span3 >= 0.8
        # The spans differ by the judged range and by the level: a plane's
        # median weights the inner shells more than the volume's does.
        assert span3 == pytest.approx(span2, rel=0.12)


def test_the_volume_sees_a_pedestal_the_planes_miss():
    before, after = _ball(b=0.06, pedestal_off_planes=True)
    r = shell_floors(after, before=before)
    trend3, span3, _ = pedestal_rule(r.floors, r.centres, r.counts, r.totals, r.level)
    assert trend3 >= 0.99 and span3 >= 0.8
    for plane in PLANES:
        (trend2, span2, _), _shells = _plane_rule(before, after, plane)
        # A level floor on every plane (its span the noise): no pedestal there.
        assert span2 < 0.2
        assert not (abs(trend2) >= 0.8 and span2 >= 0.8)
