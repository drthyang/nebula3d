# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Noise-aware detection gate (``min_significance``) and its companions.

The volume reproduces the real-data failure: a flat diffuse level whose noise
is 3× higher in one region (the high-|Q| coverage edge on CORELLI).  A |Q|-shell
median + n·MAD threshold is set by the quiet voxels, so the noisy region's
single-voxel spikes pass it; judged against their own ``sigma`` they do not.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from nebula3d.analysis.bragg import BraggRemover
from nebula3d.core import HKLVolume
from nebula3d.pipeline import PunchParams, punch_bragg

A = 4.2  # cubic cell (Å); 0.05 r.l.u. voxels = 0.075 Å⁻¹
N = 81
EXTENT = 2.0
NOISY_K = 1.2  # K above this has 3× the noise
QUIET, LOUD = 0.02, 0.06
BG = 0.2
# Satellites on voxel centres (off-integer), one of them in the noisy region.
SATELLITES = ((0.5, 0.35, 0.5), (-0.65, -0.4, 0.3), (0.3, 1.6, -0.5))
NODE_PEAK = (1, 0, 0)


def _axis() -> np.ndarray:
    return np.linspace(-EXTENT, EXTENT, N)


def _index(hkl: tuple[float, float, float]) -> tuple[int, int, int]:
    ax = _axis()
    return tuple(int(np.argmin(np.abs(ax - v))) for v in hkl)  # type: ignore[return-value]


def _noisy_edge_volume(*, seed: int = 7) -> HKLVolume:
    rng = np.random.default_rng(seed)
    ax = _axis()
    sigma = np.full((N, N, N), QUIET)
    sigma[:, ax > NOISY_K, :] = LOUD
    data = BG + sigma * rng.standard_normal((N, N, N))
    for hkl in (*SATELLITES, NODE_PEAK):
        data[_index(hkl)] += 3.0
    vol = HKLVolume.from_arrays(
        data, (-EXTENT, EXTENT), (-EXTENT, EXTENT), (-EXTENT, EXTENT),
        sigma=sigma, ub_matrix=(2 * np.pi / A) * np.eye(3))
    return vol


def _search(**kw) -> BraggRemover:
    base = dict(mode="search", search_n_mad=4.0, search_min_intensity=0.25,
                punch_incident_beam=False)
    base.update(kw)
    return BraggRemover(**base)


def _centres(peaks) -> set[tuple[int, int, int]]:
    return {(p.ih, p.ik, p.il) for p in peaks}


def test_shell_threshold_alone_punches_noise_in_the_noisy_region():
    vol = _noisy_edge_volume()
    peaks = _search()._detect_peak_records(vol)
    ax = _axis()
    noisy = [p for p in peaks if ax[p.ik] > NOISY_K]
    assert len(noisy) > 20  # the failure being fixed
    assert {_index(s) for s in SATELLITES} <= _centres(peaks)


def test_significance_gate_keeps_peaks_and_drops_noise():
    vol = _noisy_edge_volume()
    peaks = _search(min_significance=5.0)._detect_peak_records(vol)
    planted = {_index(s) for s in SATELLITES} | {_index(NODE_PEAK)}
    assert _centres(peaks) == planted
    assert all(p.significance >= 5.0 for p in peaks)
    assert all(np.isfinite(p.local_background) for p in peaks)


def test_gate_applies_to_integer_nodes():
    vol = _noisy_edge_volume()
    loose = BraggRemover(mode="integer", min_intensity=0.25, min_prominence=0.05,
                         punch_incident_beam=False)
    gated = dataclasses.replace(loose, min_significance=5.0)
    found = {p.source_node_hkl for p in loose._detect_peak_records(vol)}
    kept = gated._detect_peak_records(vol)
    assert len(found) > 1  # noise maxima at nodes in the noisy region pass the floors
    assert {p.source_node_hkl for p in kept} == {NODE_PEAK}
    assert kept[0].significance > 50


def test_mad_noise_model_ignores_a_meaningless_sigma():
    vol = _noisy_edge_volume()
    # sqrt(|I|) is what from_arrays invents without errors — far above the noise.
    bogus = dataclasses.replace(vol, sigma=np.sqrt(np.abs(vol.data)))
    by_sigma = _search(min_significance=5.0)._detect_peak_records(bogus)
    by_mad = _search(min_significance=5.0,
                     significance_noise="mad")._detect_peak_records(bogus)
    ungated = _search()._detect_peak_records(bogus)
    planted = {_index(s) for s in SATELLITES} | {_index(NODE_PEAK)}
    assert len(by_sigma) < len(planted)  # the inflated sigma hides real peaks
    assert planted <= _centres(by_mad)
    # The window's scatter cannot see a step in the noise inside the window, so
    # a few summits survive right at the step — and nowhere else.
    extra = [p for p in by_mad if (p.ih, p.ik, p.il) not in planted]
    assert len(extra) < len(ungated) / 100
    assert all(abs(_axis()[p.ik] - NOISY_K) <= 0.05 + 1e-9 for p in extra)


def test_unknown_noise_model_is_rejected():
    with pytest.raises(ValueError, match="significance_noise"):
        BraggRemover(significance_noise="poisson")


def test_zero_error_cannot_reject():
    vol = _noisy_edge_volume()
    zeroed = dataclasses.replace(vol, sigma=np.zeros_like(vol.sigma))
    r = _search(min_significance=5.0)
    idx = _index(SATELLITES[0])
    assert r._peak_significance(zeroed, idx, BG, 0.0) == np.inf


def test_detect_window_q_is_sized_in_inverse_angstrom_and_capped():
    vol = _noisy_edge_volume()
    q_vox = 0.05 * 2 * np.pi / A  # Å⁻¹ per voxel on every axis
    assert BraggRemover(detect_window_q=2.0 * q_vox)._detect_half_widths(vol) == (2, 2, 2)
    # 0.3 r.l.u. cap = 6 voxels at 0.05 r.l.u.
    assert BraggRemover(detect_window_q=1.0)._detect_half_widths(vol) == (6, 6, 6)
    # Without it, the r.l.u. window is unchanged.
    assert BraggRemover()._detect_half_widths(vol) == (4, 4, 4)


def test_gate_does_not_resize_the_punches_it_keeps():
    """The scaling reference counts the candidates the gate rejects."""
    vol = _noisy_edge_volume()
    loose = _search(intensity_scale=True)
    gated = dataclasses.replace(loose, min_significance=5.0)
    all_peaks, ref_loose, _ = loose._detect(vol)
    kept, ref_gated, _ = gated._detect(vol)
    assert len(kept) < len(all_peaks)
    assert ref_gated == ref_loose
    # Kept peaks are punched exactly as without the gate.
    ones = np.ones(vol.shape, dtype=bool)
    assert np.array_equal(
        gated._punch_centers(vol, ones.copy(), kept, reference=ref_gated),
        loose._punch_centers(vol, ones.copy(), kept, reference=ref_loose))
    # Measured from the kept peaks alone, the reference would differ.
    assert gated._scaling_reference(kept) > 2 * ref_loose


def test_gate_reference_in_both_mode_is_close():
    """In "both" the rejected nodes are not punched before the search pass, so
    its candidates differ slightly; the reference stays close."""
    vol = _noisy_edge_volume()
    loose = BraggRemover(mode="both", min_intensity=0.25, min_prominence=0.05,
                         search_n_mad=4.0, search_min_intensity=0.25,
                         intensity_scale=True, punch_incident_beam=False)
    _, ref_loose, _ = loose._detect(vol)
    _, ref_gated, _ = dataclasses.replace(loose, min_significance=5.0)._detect(vol)
    assert ref_gated == pytest.approx(ref_loose, rel=0.01)


def test_pipeline_profile_reports_significance():
    vol = _noisy_edge_volume()
    out = punch_bragg(vol, PunchParams(min_intensity=0.25, search_min_intensity=0.25,
                                       search_min_prominence=0.0,
                                       search_exclude_h_fractions=None))
    rows = out._bragg_profile["peaks"]  # type: ignore[attr-defined]
    assert rows and all(r["significance"] is not None and r["significance"] >= 5.0
                        for r in rows)
