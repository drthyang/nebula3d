"""Tests for the stack-pooled sector ring model (``ring_model="pooled"``).

The synthetic volume carries the property that defeats the per-plane models on
measured data: the ring's |Q| centre wanders with direction by more than half
its FWHM (``q0 + 0.07·cos 4φ`` for a 0.15 Å⁻¹ ring, at the Al 111 line), with
~3 voxels across the ring as on the real grid.  Bragg blobs sit on the ring, and
a weak Al 200 ring lies below the relative detection cut.
"""

import dataclasses

import numpy as np
import pytest

from nebula3d import pipeline
from nebula3d.core import HKLVolume
from nebula3d.preprocessing import PooledRingConfig, fit_pooled_rings
from nebula3d.preprocessing.pooled_rings import _cluster_windows
from nebula3d.preprocessing.radial_background import _detect_rings, _snip_baseline

UB = 0.5 * np.eye(3)            # 0.1 r.l.u. steps → 0.05 Å⁻¹ voxels
AL_A = 4.0494
Q0, FWHM, SHIFT = 2 * np.pi * np.sqrt(3) / AL_A, 0.15, 0.07      # Al 111
WEAK_Q, WEAK_AMP = 2 * np.pi * 2 / AL_A, 0.045                    # Al 200, 4.5 %
NON_AL_Q = 3.55                                                    # no Al line
_R = Q0 / 0.5                                                      # |Q| → r.l.u.
_D = float(np.sqrt((_R ** 2 - 0.09) / 2))
BRAGG = [(0.0, _R, 0.0), (0.0, 0.0, -_R), (0.3, _D, _D)]          # on the ring


def _pseudo_voigt(q, q0, fwhm, eta=0.5):
    """Unit-peak pseudo-Voigt; ``q0`` may vary voxel to voxel."""
    x = (np.asarray(q) - q0) / (0.5 * fwhm)
    return eta / (1.0 + x * x) + (1.0 - eta) * np.exp(-np.log(2.0) * x * x)


def _volume(*, seed=0, weak=True, bragg=True, non_al=False, dtype=np.float64):
    shape = (21, 161, 161)
    ranges = ((-1.0, 1.0), (-8.0, 8.0), (-8.0, 8.0))
    blank = HKLVolume.from_arrays(np.zeros(shape), *ranges, ub_matrix=UB)
    H, K, L = blank.hkl_grid()
    q = blank.q_magnitude()
    phi = np.arctan2(L, K)
    diffuse = 1.0 + 0.3 * np.exp(-((q - 1.8) / 0.6) ** 2) + 0.1 * np.cos(0.4 * K)
    q_ring = Q0 + SHIFT * np.cos(4.0 * phi)
    ring = (1.0 + 0.5 * np.cos(2.0 * phi)) * _pseudo_voigt(q, q_ring, FWHM, 0.5)
    if weak:
        ring = ring + WEAK_AMP * _pseudo_voigt(q, WEAK_Q, 0.12, 0.5)
    if non_al:
        ring = ring + WEAK_AMP * _pseudo_voigt(q, NON_AL_Q, 0.12, 0.5)
    peaks = np.zeros(shape)
    if bragg:
        for h0, k0, l0 in BRAGG:
            peaks += 30.0 * np.exp(-0.5 * (((H - h0) / 0.15) ** 2 + ((K - k0) / 0.12) ** 2
                                           + ((L - l0) / 0.12) ** 2))
    rng = np.random.default_rng(seed)
    data = diffuse + ring + peaks + rng.normal(0.0, 0.01, shape)
    vol = HKLVolume.from_arrays(data.astype(dtype), *ranges, ub_matrix=UB,
                                sigma=np.full(shape, 0.01, dtype=dtype))
    return vol, q, diffuse, ring, peaks


def _config(**kw):
    base = dict(plane="0kl", q_min=1.2, q_max=3.9, q_step=0.025, n_sectors=48,
                pool_deg=8.0, max_fwhm=0.3)
    base.update(kw)
    return PooledRingConfig(**base)


def _ring_residual(out, q, diffuse, peaks, ring):
    shell = (np.abs(q - Q0) < 2 * FWHM) & (peaks < 0.05) & out.mask
    resid = out.data[shell] - diffuse[shell]
    return float(np.sqrt(np.mean(resid ** 2))), float(np.sqrt(np.mean(ring[shell] ** 2)))


def test_removes_a_ring_whose_radius_wanders_with_direction():
    vol, q, diffuse, ring, peaks = _volume()
    out = fit_pooled_rings(vol, _config()).cleaned
    resid, ring_rms = _ring_residual(out, q, diffuse, peaks, ring)
    assert resid < 0.2 * ring_rms

    # The per-plane patched model subtracts at the wrong |Q| (here 2× the residual).
    patched = pipeline.remove_rings(vol, pipeline.RingParams(
        ring_model="patched", q_min=1.2, q_max=3.9, q_step=0.025))
    resid_patched, _ = _ring_residual(patched, q, diffuse, peaks, ring)
    assert resid < 0.6 * resid_patched


def test_leaves_voxels_outside_the_shells_untouched():
    vol, q, diffuse, ring, peaks = _volume(weak=False)
    res = fit_pooled_rings(vol, _config(), return_ring=True)
    (shell,) = res.diagnostics["shells"]
    # The envelope is flat to ±halfwidth and tapers to 0 by ±2·halfwidth.
    far = np.abs(q - shell["q_center"]) > 2 * shell["envelope_halfwidth"] + 0.025
    assert far.sum() > 0.5 * far.size
    assert np.array_equal(res.cleaned.data[far], vol.data[far])
    assert np.all(res.ring >= 0.0)


def test_does_not_eat_bragg_peaks_sitting_on_the_ring():
    vol, q, diffuse, ring, peaks = _volume()
    clean_vol, *_ = _volume(bragg=False)
    core = peaks > 3.0
    assert core.any()

    def inflation(pool_sectors):
        cfg = _config(pool_sectors=pool_sectors)
        with_bragg = fit_pooled_rings(vol, cfg, return_ring=True)
        without = fit_pooled_rings(clean_vol, cfg, return_ring=True)
        extra = float(np.mean(with_bragg.ring[core] - without.ring[core]))
        return extra / float(np.mean(without.ring[core])), (with_bragg, without)

    # A Bragg peak spans a few planes but one sector: pooling the neighbouring
    # sectors too is what keeps it out of the ring estimate (on measured data,
    # stack pooling alone inflated the ring markedly at Bragg-on-ring voxels;
    # ±1 sector brought it down to about the patched model's level).
    rel_stack_only, _ = inflation(0)
    rel, (with_bragg, without) = inflation(1)
    assert rel < 0.75 * rel_stack_only
    assert rel < 0.35
    # Each peak keeps its intensity for the punch (or the 3D-PDF).
    kept = with_bragg.cleaned.data[core] - without.cleaned.data[core]
    assert float(kept.sum()) > 0.98 * float(peaks[core].sum())


def test_detects_a_weak_al_ring_the_relative_cut_misses():
    vol, *_ = _volume(non_al=True)
    # Both weak rings rise 6–7σ above this small volume's profile noise.
    diag = fit_pooled_rings(vol, _config(min_snr=5.0)).diagnostics
    shells = {round(s["q_center"], 2): s["detection"] for s in diag["shells"]}
    assert any(abs(c - Q0) < 0.05 and o == "relative" for c, o in shells.items())
    # The weak ring on an Al line is taken; the equally weak one off every Al
    # line (as a sharp maximum of the diffuse would be) is not.
    assert any(abs(c - WEAK_Q) < 0.05 and o == "al_line" for c, o in shells.items())
    assert not any(abs(c - NON_AL_Q) < 0.1 for c in shells)
    # fitted from the one strong ring, whose apparent centre its wander biases
    assert abs(diag["al_lattice_a"] - AL_A) < 0.01 * AL_A
    # Without the Al prior only the strong ring is kept.
    plain = fit_pooled_rings(vol, _config(min_snr=5.0, al_prior=False)).diagnostics
    assert [abs(s["q_center"] - Q0) < 0.05 for s in plain["shells"]] == [True]


def test_detect_rings_noise_floor():
    q = np.arange(1.0, 4.0, 0.02)
    rng = np.random.default_rng(3)
    prof = (1.0 + _pseudo_voigt(q, 2.0, 0.1, 0.5)
            + 0.04 * _pseudo_voigt(q, 3.0, 0.1, 0.5) + rng.normal(0, 0.002, q.size))
    legacy, _ = _detect_rings(q, prof, 0.02, 0.24)
    both, _ = _detect_rings(q, prof, 0.02, 0.24, min_snr=6.0)
    noise_only, _ = _detect_rings(q, prof, 0.02, 0.24, min_snr=6.0, rel_prominence=0.0)
    # The 4 % ring is below the relative cut, above the noise cut.
    assert not np.any(np.abs(legacy - 3.0) < 0.05)
    assert np.array_equal(both, legacy)
    assert np.any(np.abs(noise_only - 3.0) < 0.05)
    assert np.any(np.abs(noise_only - 2.0) < 0.05)
    # Pure noise: the relative cut alone finds "rings", the noise floor does not.
    noise = 1.0 + rng.normal(0, 0.002, q.size)
    assert _detect_rings(q, noise, 0.02, 0.24)[0].size > 0
    assert _detect_rings(q, noise, 0.02, 0.24, min_snr=6.0)[0].size == 0


def test_cluster_window_spans_a_close_doublet():
    q = np.arange(6.0, 8.0, 0.02)
    centers, fwhm = np.array([6.79, 6.97]), np.array([0.064, 0.151])
    win = _cluster_windows(q, centers, fwhm, 0.02, 0.24, 3.0, 0.9)
    # The doublet shares one window at least as wide as its ±FWHM span (0.39 Å⁻¹
    # × ¾); the per-ring cap would have given the broad member 0.9 × 0.18.
    at = win[np.argmin(np.abs(q - 6.97))]
    assert at >= 0.75 * ((6.97 + 0.151) - (6.79 - 0.064)) - 1e-9
    assert at > 0.9 * 0.18


def test_snip_baseline_rows_match_one_call_per_row():
    rng = np.random.default_rng(1)
    prof = rng.normal(1.0, 0.1, (5, 80)) + np.exp(-((np.arange(80) - 40) / 3.0) ** 2)
    n_iter = np.full(80, 6)
    n_iter[50:] = 3
    rows = _snip_baseline(prof, n_iter)
    for r in range(5):
        assert np.array_equal(rows[r], _snip_baseline(prof[r], n_iter))


def test_is_deterministic_and_keeps_float32_storage():
    vol, *_ = _volume(bragg=False)
    a = fit_pooled_rings(vol, _config()).cleaned
    b = fit_pooled_rings(vol, _config()).cleaned
    assert np.array_equal(a.data, b.data)
    assert np.array_equal(a.mask, b.mask)

    vol32, *_ = _volume(bragg=False, dtype=np.float32)
    c = fit_pooled_rings(vol32, _config()).cleaned
    assert c.data.dtype == np.float32
    np.testing.assert_allclose(c.data, a.data, atol=2e-3)


def test_other_stack_axes_remove_the_ring_too():
    vol, q, diffuse, ring, peaks = _volume(bragg=False, weak=False)
    # Same physics stacked along L (hk0 planes): the ring is still removed.
    out = fit_pooled_rings(vol, _config(plane="hk0", pool_deg=12.0)).cleaned
    resid, ring_rms = _ring_residual(out, q, diffuse, peaks, ring)
    assert resid < 0.3 * ring_rms


def test_planes_without_data_are_left_alone():
    vol, *_ = _volume(bragg=False)
    mask = vol.mask.copy()
    mask[0] = False
    vol = dataclasses.replace(vol, mask=mask)
    res = fit_pooled_rings(vol, _config())
    assert np.array_equal(res.cleaned.data[0], vol.data[0])
    assert not res.cleaned.mask[0].any()
    assert res.diagnostics["n_planes_fitted"] == vol.shape[0] - 1


def test_no_rings_returns_the_data_unchanged():
    shape = (9, 61, 61)
    rng = np.random.default_rng(0)
    vol = HKLVolume.from_arrays(1.0 + rng.normal(0, 0.01, shape), (-1, 1), (-3, 3),
                                (-3, 3), ub_matrix=UB)
    res = fit_pooled_rings(vol, _config(q_min=0.3, q_max=1.5))
    assert res.diagnostics["status"] == "no_rings"
    assert np.array_equal(res.cleaned.data, vol.data)


@pytest.mark.parametrize("bad", [
    dict(plane="xyz"), dict(q_min=3.0, q_max=2.0), dict(n_sectors=4),
    dict(pool_sectors=40), dict(amp_cap=-1.0), dict(pool_deg=0.0),
])
def test_config_validation(bad):
    with pytest.raises(ValueError):
        _config(**bad)


def test_pipeline_pooled_stage_writes_diagnostics(tmp_path):
    import json

    import nebula3d

    vol, *_ = _volume(bragg=False)
    inp = tmp_path / "pooled_sample.nxs"
    nebula3d.save(vol, inp)
    rings = pipeline.RingParams(ring_model="pooled", q_min=1.2, q_max=3.9, q_step=0.025,
                                ring_width=0.3, pooled_sectors=48,
                                pooled_window_deg=8.0)
    events = []
    paths = pipeline.run_pipeline(
        inp, pipeline.PipelineParams(rings=rings), proc_dir=tmp_path,
        stages=("rings",), progress=lambda *a: events.append(a))
    diagnostic = json.loads(paths.ring_diagnostics_json.read_text())
    assert diagnostic["algorithm"] == "pooled"
    assert diagnostic["status"] == "fitted"
    assert any(abs(s["q_center"] - Q0) < 0.05 for s in diagnostic["shells"])
    assert any(e[0] == "rings" and e[1] == "done" for e in events)


def test_async_driver_falls_back_to_the_whole_volume_model():
    import asyncio

    vol, *_ = _volume(bragg=False)
    p = pipeline.RingParams(ring_model="pooled", q_min=1.2, q_max=3.9, q_step=0.025,
                            ring_width=0.3, pooled_sectors=48, pooled_window_deg=8.0)
    serial = pipeline.remove_rings(vol, p)
    out = asyncio.run(pipeline.remove_rings_async(vol, p))
    assert np.array_equal(out.data, serial.data)
