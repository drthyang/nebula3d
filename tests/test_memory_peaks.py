"""Peak-memory guards for the stages that bound the browser's WASM heap.

The in-browser engine (Pyodide: a 4 GB wasm32 heap that never shrinks) admits a
volume by a bytes-per-voxel budget (``webbridge._PIPELINE_PEAK_BYTES_PER_VOXEL``).
A full float64 |Q| grid with its temporaries costs ~40 B/voxel on its own, and
four stages built one: the cross-plane ring confirmation, the punch's |Q|-shell
thresholds, the direct-beam fill (over the whole volume once unmeasured
coverage reaches the origin) and the radial flatten.  On a 64.5 M-voxel TOPAZ
volume that ran the backfill out of memory.  Each test pins one stage to its
per-plane / slab-wise form: values identical to the whole-volume form, and a
traced peak (numpy reports its allocations to ``tracemalloc``) below one
float64 volume over the input.
"""

import dataclasses
import tracemalloc

import numpy as np

from nebula3d.analysis import bragg_fill
from nebula3d.analysis.bragg import BraggRemover
from nebula3d.analysis.bragg_fill import backfill_bragg
from nebula3d.core import HKLVolume
from nebula3d.preprocessing import (
    PooledRingConfig,
    confirm_ring_shells_across_h,
    fit_pooled_rings,
    radial_flatten,
)
from nebula3d.preprocessing.radial_background import (
    _offset_q_magnitude,
    _stack_plane_q_magnitude,
)
from nebula3d.preprocessing.radial_flatten import flatten_radial_background


def _traced_peak(fn, *args, **kwargs):
    """``(result, peak traced bytes)`` of one call."""
    tracemalloc.start()
    try:
        out = fn(*args, **kwargs)
        return out, tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()


def _topaz_like(shape=(40, 48, 56), seed=0):
    """float32 volume on a skewed cell, measured only in a |Q| shell — the
    low-|Q| core and the box corners unmeasured (zeroed and masked, as the
    loader leaves them), ~25 % of voxels valid, like a TOPAZ cube."""
    rng = np.random.default_rng(seed)
    ub = 2 * np.pi * (np.eye(3) / 4.0 + 0.02 * rng.normal(size=(3, 3)))
    vol = HKLVolume.from_arrays(rng.uniform(0.5, 1.5, shape), (-4, 4), (-5, 5),
                                (-6, 6), ub_matrix=ub, dtype=np.float32)
    q = vol.q_magnitude()
    measured = (q > 1.0) & (q < 0.45 * q.max())
    vol.data[~measured] = 0.0
    vol.mask &= measured
    return vol


def test_ring_confirmation_computes_q_per_plane():
    vol = _topaz_like()
    full = {plane: _offset_q_magnitude(vol, plane) for plane in ("0kl", "h0l", "hk0")}
    for plane, axis in (("0kl", 0), ("h0l", 1), ("hk0", 2)):
        for ip in range(vol.shape[axis]):
            got = _stack_plane_q_magnitude(vol, plane, axis, ip)
            assert np.array_equal(got, np.take(full[plane], ip, axis=axis)), (plane, ip)

    q_hi = float(0.45 * vol.q_magnitude().max())
    _, peak = _traced_peak(confirm_ring_shells_across_h, vol, plane="0kl",
                           q_range=(1.0, q_hi), q_step=0.05)
    assert peak < 8 * vol.data.size  # was ~40 B/voxel: the full |Q| grid


def test_pooled_ring_model_works_plane_by_plane(monkeypatch):
    # |Q|, φ and the profiles are built one plane at a time; the sector profiles
    # are (planes × sectors × bins), and in low-memory mode the output overwrites
    # the input, so the output mask is the one volume-sized allocation.
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    vol = _topaz_like(shape=(80, 128, 128))  # many planes, as on a real grid
    q_hi = float(0.45 * vol.q_magnitude().max())
    cfg = PooledRingConfig(q_min=1.0, q_max=q_hi, q_step=0.05, n_sectors=36)
    reference = fit_pooled_rings(dataclasses.replace(vol, data=vol.data.copy()), cfg)
    res, peak = _traced_peak(fit_pooled_rings, vol, cfg)
    assert res.cleaned.data is vol.data
    assert np.array_equal(res.cleaned.data, reference.cleaned.data)
    assert res.cleaned.data.dtype == np.float32
    assert peak < 8 * vol.data.size


def _q_shell_thresholds_whole_volume(vol, q_step, n_mad, min_intensity,
                                     min_shell_size=20):
    """The whole-volume form the slab-wise thresholds replaced (reference)."""
    q = vol.q_magnitude()
    valid = vol.mask & np.isfinite(vol.data)
    qv = q[valid]
    edges = np.arange(qv.min(), qv.max() + q_step, q_step)
    nb = max(len(edges) - 1, 1)
    bin_idx = np.clip(np.digitize(q, edges) - 1, 0, nb - 1).astype(np.int32)
    flat_b = bin_idx[valid]
    order = np.argsort(flat_b, kind="stable")
    sb = flat_b[order]
    s_i = vol.data[valid][order]
    bounds = np.searchsorted(sb, np.arange(nb + 1))
    thr = np.full(nb, np.inf)
    for b in range(nb):
        seg = s_i[bounds[b]:bounds[b + 1]].astype(np.float64)
        if seg.size < min_shell_size:
            continue
        med = float(np.median(seg))
        mad = float(np.median(np.abs(seg - med)))
        thr[b] = med + n_mad * (1.4826 * mad if mad > 0 else (float(np.std(seg)) or 1.0))
    return bin_idx, np.maximum(thr, min_intensity)


def test_punch_shell_thresholds_bin_q_by_slab():
    vol = _topaz_like(shape=(93, 40, 48))  # 93 H planes: a ragged last slab
    vol.mask[:18] = False                   # and a whole slab with nothing valid
    ref_bins, ref_thr = _q_shell_thresholds_whole_volume(vol, 0.05, 6.0, 0.0)

    (bins, thr), peak = _traced_peak(BraggRemover._q_shell_thresholds, vol,
                                     q_step=0.05, n_mad=6.0, min_intensity=0.0)

    assert np.array_equal(bins, ref_bins)
    assert np.array_equal(thr, ref_thr)
    assert peak < 16 * vol.data.size  # was ~28 B/voxel at this valid fraction


def test_direct_beam_fill_skips_coverage_that_reaches_the_origin(monkeypatch):
    # Unmeasured coverage joined to the unmeasured origin is one masked blob as
    # large as the volume.  It is not a beam: the beam fill must leave all of it
    # to the generic fill, without volume-sized |Q| work, while a compact beam
    # (box under the cap) is still resolved by the beam fill.
    monkeypatch.setattr(bragg_fill, "LAPLACE_MAX_UNKNOWNS", 10_000)
    vol = _topaz_like()
    ik0 = int(np.argmin(np.abs(vol.k_axis)))
    vol.mask[:, ik0:, :] = False            # a coverage gap through the origin
    vol.data[:, ik0:, :] = 0.0
    holes = ~vol.mask
    valid = vol.mask.copy()

    resolved, peak = _traced_peak(
        bragg_fill._fill_direct_beam, vol, vol.data.copy(), vol.sigma.copy(),
        holes, valid, 1.0, q_gap=0.05, q_width=0.15, min_count=8)

    assert not resolved.any()
    assert peak < 8 * vol.data.size  # a volume-sized float64 |Q| box was 8+
    with_beam = backfill_bragg(vol, method="local")
    without = backfill_bragg(vol, method="local", direct_beam_fill=False)
    assert np.array_equal(with_beam.data, without.data)
    assert np.array_equal(with_beam.sigma, without.sigma)

    beam = HKLVolume.from_arrays(np.full((41, 41, 41), 0.3), (-1, 1), (-1, 1), (-1, 1))
    ball = beam.q_magnitude() <= 0.25       # an 11³ box, under the cap
    beam.mask[ball] = False
    resolved = bragg_fill._fill_direct_beam(
        beam, beam.data.copy(), beam.sigma.copy(), ball, beam.mask.copy(), 1.0,
        q_gap=0.2, q_width=0.15, min_count=8)
    assert resolved[ball].all()


def test_flatten_bins_and_subtracts_by_slab(monkeypatch):
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")  # in place, as in the browser
    vol = _topaz_like(shape=(93, 40, 48))
    monkeypatch.setattr(radial_flatten, "_SLAB", 10**6)  # one slab: whole volume
    whole = flatten_radial_background(dataclasses.replace(vol, data=vol.data.copy()))
    monkeypatch.setattr(radial_flatten, "_SLAB", 16)

    res, peak = _traced_peak(flatten_radial_background, vol)

    assert np.array_equal(res.volume.data, whole.volume.data)
    assert np.array_equal(res.bg_curve, whole.bg_curve)
    assert peak < 16 * vol.data.size  # was ~25 B/voxel: full |Q| + temporaries


def test_shell_floors_hold_no_volume_sized_array(monkeypatch):
    # The whole-volume shell floors (the Pilot's flatten check) read a pair of
    # volumes one slab at a time and select each percentile from histograms:
    # what they hold is fixed by the shells, not the grid.  On a grid 1.5 times
    # as fine over the same box (the same shells, 3.4 times the voxels) the
    # traced peak grows by under a quarter of the extra float32 data (by 1 %
    # when measured, 26 MiB both); a volume-sized int16 array alone would add
    # half of it.
    # The numbers are the native path's.
    from nebula3d.preprocessing import shell_floors

    def pair(n):
        vol = _topaz_like(shape=(n, n, n))
        return vol, dataclasses.replace(vol, data=vol.data - np.float32(0.5))

    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)  # native, whatever ran before
    small, small_after = pair(128)
    big, big_after = pair(192)
    native = shell_floors(big_after, before=big)
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    _, peak_small = _traced_peak(shell_floors, small_after, before=small)
    lean, peak_big = _traced_peak(shell_floors, big_after, before=big)

    assert np.array_equal(lean.floors, native.floors, equal_nan=True)
    assert np.array_equal(lean.floors_before, native.floors_before, equal_nan=True)
    assert lean.level == native.level
    assert peak_big - peak_small < 0.25 * (big.data.nbytes - small.data.nbytes)


def test_fill_texture_holds_no_volume_sized_array(monkeypatch):
    # The backfill's texture check (texture_check's rule over the volume)
    # labels the punch's holes one slab of H planes at a time and measures
    # each hole inside its own box: it holds a slab's labels and masks, one
    # hole's box and the per-hole facts, not the grid.  A volume-sized int32
    # label array would be four boolean volumes.  In low-memory mode, holes
    # every 16 voxels on 128³ and on 192³ (3.4 times the voxels and the
    # holes), the traced peak stays under 0.6 of a boolean volume of the larger
    # grid and grows by under 40 % of the boolean volume it gained.  The
    # numbers are the native path's.
    from scipy import ndimage

    from nebula3d.analysis import fill_texture

    def lattice(n, spacing=16, radius=3):
        rng = np.random.default_rng(n)
        data = (1.0 + 0.02 * rng.standard_normal((n, n, n))).astype(np.float32)
        record = np.zeros(data.shape, dtype=bool)
        g = np.arange(-radius, radius + 1)
        ball = np.array([(a, b, c) for a in g for b in g for c in g
                         if a * a + b * b + c * c <= radius * radius])
        for node in np.ndindex(*(len(range(8, n, spacing)),) * 3):
            idx = ball + 8 + spacing * np.array(node)
            record[tuple(idx[np.all(idx < n, axis=1)].T)] = True
        filled = data.copy()
        filled[ndimage.binary_dilation(record) & ~record] = 1.0  # the gap band
        filled[record] = 1.1
        vol = HKLVolume.from_arrays(data, (-4, 4), (-4, 4), (-4, 4))
        return (dataclasses.replace(vol, mask=~record), dataclasses.replace(vol, data=filled),
                record)

    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)  # native, whatever ran before
    small = lattice(128)
    big = lattice(192)
    native = fill_texture(*big[:2], punch_record=big[2])
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    _, peak_small = _traced_peak(fill_texture, *small[:2], punch_record=small[2])
    lean, peak_big = _traced_peak(fill_texture, *big[:2], punch_record=big[2])

    assert lean.n_holes == native.n_holes == 12 ** 3
    assert np.array_equal(lean.holes.bias, native.holes.bias)
    assert lean.median_fill_bias_level == native.median_fill_bias_level
    assert peak_big < 0.6 * big[2].nbytes
    assert peak_big - peak_small < 0.4 * (big[2].nbytes - small[2].nbytes)


def test_symmetry_average_holds_no_volume_sized_array():
    # The symmetry average (pipeline stage 0) works a slab of H planes at a
    # time, in place, and touches only each slab's orbit representatives and
    # their images: what it holds is fixed by the slab, not the grid.  On a
    # grid 1.5 times as fine (3.4 times the voxels) the traced peak grows by
    # under 15 % of the float32 data it gained (6 to 9 % measured), on the
    # L-separate path (6/mmm) and the general one (m-3m).  A second volume, or
    # a volume-sized index array, would be several times that.
    from nebula3d.symmetry import GridSymmetry, laue_group, symmetry_average
    from nebula3d.utils import ub_from_lattice

    def case(n, laue):
        rng = np.random.default_rng(n)
        ub = (ub_from_lattice(4.2, 4.2, 6.8, 90, 90, 120) if laue == "6/mmm"
              else ub_from_lattice(5.0, 5.0, 5.0))
        vol = HKLVolume.from_arrays(rng.random((n, n, n), dtype=np.float32), (-4, 4), (-4, 4),
                                    (-4, 4), ub_matrix=ub, dtype=np.float32)
        vol.mask = rng.random(vol.data.shape) > 0.3
        return vol, GridSymmetry.for_volume(vol, laue_group(laue).ops)

    for laue in ("6/mmm", "m-3m"):
        small, small_sym = case(97, laue)
        big, big_sym = case(145, laue)
        _, peak_small = _traced_peak(symmetry_average, small, small_sym, slab_voxels=1 << 16)
        _, peak_big = _traced_peak(symmetry_average, big, big_sym, slab_voxels=1 << 16)
        assert peak_big - peak_small < 0.15 * (big.data.nbytes - small.data.nbytes), laue
