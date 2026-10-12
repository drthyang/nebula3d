"""Tests for the powder-ring confirmation (``nebula3d.preprocessing.ring_isotropy``).

A powder ring rises at its |Q| in every direction, texture or not; the
crystal's own scattering at one |Q| rises in some directions only. The pooled
ring removal subtracts only the shells confirmed as rings, so a crystal with no
rings keeps all of its diffuse.
"""

import dataclasses

import numpy as np
import pytest

from nebula3d.core import HKLVolume
from nebula3d.demo import DemoModel, demo_volume
from nebula3d.preprocessing import (
    IsotropyConfig,
    PooledRingConfig,
    fit_pooled_rings,
    judge_shells,
    shell_isotropy,
)

Q_RING, FWHM = 2.0, 0.15


def _volume(feature: str, *, seed: int = 0, n: int = 81, hump: float = 0.0) -> HKLVolume:
    """A smooth isotropic background with one feature at |Q| = 2 Å⁻¹, on a broad
    hump of height *hump* centred there (σ-like width 0.4 Å⁻¹) if any."""
    blank = HKLVolume.from_arrays(np.zeros((n, n, n)), (-3, 3), (-3, 3), (-3, 3),
                                  ub_matrix=np.eye(3))
    H, K, L = blank.hkl_grid()
    q = blank.q_magnitude()
    shell = np.exp(-0.5 * ((q - Q_RING) / (FWHM / 2.355)) ** 2)
    cos_z = np.divide(L, q, out=np.zeros_like(q), where=q > 0)
    if feature == "ring":
        bump = shell
    elif feature == "textured":  # three times stronger along c* than across it
        bump = shell * (1.0 + 0.5 * (3.0 * cos_z ** 2 - 1.0))
    elif feature == "lobes":  # maxima along the six <100> directions only
        lobes = sum(np.exp(-0.5 * ((H - h) ** 2 + (K - k) ** 2 + (L - l_) ** 2) / 0.25 ** 2)
                    for h, k, l_ in [(2, 0, 0), (-2, 0, 0), (0, 2, 0), (0, -2, 0),
                                     (0, 0, 2), (0, 0, -2)])
        bump = 3.0 * lobes
    else:
        bump = np.zeros_like(q)
    rng = np.random.default_rng(seed)
    data = (1.0 + 0.5 * np.exp(-q / 2.0) + hump * np.exp(-(((q - Q_RING) / 0.4) ** 2)) + bump
            + rng.normal(0.0, 0.01, q.shape))
    return HKLVolume.from_arrays(data, (-3, 3), (-3, 3), (-3, 3), ub_matrix=np.eye(3))


@pytest.mark.parametrize("feature", ["ring", "textured"])
def test_a_ring_rises_in_every_direction(feature):
    (r,) = judge_shells(_volume(feature), [(Q_RING, FWHM)])
    assert r.is_ring
    assert r.n_cells >= IsotropyConfig().min_cells
    assert r.median_height > 0
    assert r.isotropy > (0.9 if feature == "ring" else 0.15)


def test_maxima_in_a_few_directions_are_not_a_ring():
    (r,) = judge_shells(_volume("lobes"), [(Q_RING, FWHM)])
    assert r.median_height != 0
    assert not r.is_ring


@pytest.mark.parametrize("feature", ["none", "lobes"])
def test_a_smooth_hump_is_not_a_ring(feature):
    # Above a line through the flanks, a broad concave hump reads as a height in
    # every direction: an empty shell on it, or maxima along <100> only, passed
    # for a ring. Above a quadratic through the same flanks almost none is left.
    (r,) = judge_shells(_volume(feature, hump=0.3), [(Q_RING, FWHM)])
    assert not r.is_ring
    assert r.beyond_curve < IsotropyConfig().curve_share


def test_a_ring_on_a_smooth_hump_is_still_one():
    vol = _volume("ring", hump=0.3)
    (r,) = judge_shells(vol, [(Q_RING, FWHM)])
    assert r.is_ring
    assert r.snr >= IsotropyConfig().min_snr


def test_nothing_at_that_q_is_not_a_ring():
    (r,) = judge_shells(_volume("none"), [(Q_RING, FWHM)])
    assert not r.is_ring
    assert not r.not_judged


def test_too_few_directions_measured_is_not_judged():
    vol = _volume("ring")
    H, K, L = vol.hkl_grid()
    # A quarter of the cap around c*: four of the top band's sixteen cells.
    corner = dataclasses.replace(vol, mask=vol.mask & (L > 1.5) & (H > 0) & (K > 0))
    (r,) = shell_isotropy(corner, [(Q_RING, FWHM)])
    assert not r.is_ring
    assert "direction cells" in r.not_judged


def test_a_broad_candidate_beside_a_ring_does_not_hide_it():
    # The broad candidate's core covers the ring's lower flank: judged with the
    # other candidates kept apart, the ring has no clean flank on that side,
    # and is judged again with only the confirmed rings kept apart.
    vol = _volume("ring")
    alone = shell_isotropy(vol, [(Q_RING, FWHM), (1.62, 0.3)])
    assert alone[0].not_judged == "no clean flank on one side"
    ring, broad = judge_shells(vol, [(Q_RING, FWHM), (1.62, 0.3)])
    assert ring.is_ring
    assert not broad.is_ring


def test_reads_a_subset_past_the_voxel_budget_and_agrees():
    vol = _volume("ring")
    (full,) = judge_shells(vol, [(Q_RING, FWHM)])
    # About half of the ~90k voxels in the shell's window, with no per-shell floor.
    (sub,) = judge_shells(vol, [(Q_RING, FWHM)],
                          IsotropyConfig(max_voxels=45_000, sample_per_bin=0))
    assert sub.is_ring and full.is_ring
    assert sub.n_cells >= 0.9 * full.n_cells
    assert abs(sub.isotropy - full.isotropy) < 0.05


def test_config_validation():
    with pytest.raises(ValueError):
        IsotropyConfig(direction_share=1.0)
    with pytest.raises(ValueError):
        IsotropyConfig(core_scale=0.0)
    with pytest.raises(ValueError):
        IsotropyConfig(sample_per_bin=-1)


# ---------------------------------------------------------------- the removal

def _demo(ring_amp: float) -> HKLVolume:
    return demo_volume(81, seed=3, model=DemoModel(sro_amp=0.09, ring_amp=ring_amp),
                       dtype=np.float32)


def test_a_crystal_with_no_rings_keeps_all_its_diffuse():
    # The held-out evals' crystal (another cell, stronger short-range order): its
    # own diffuse makes shells the detection finds, and the test rejects them all.
    vol = demo_volume(121, seed=7, model=DemoModel(a=3.9, sro_amp=0.09, ring_amp=0.0),
                      dtype=np.float32)
    res = fit_pooled_rings(vol, PooledRingConfig())
    d = res.diagnostics
    assert d["status"] == "no_confirmed_rings"
    assert d["shells"] == []
    assert len(d["rejected_shells"]) >= 2
    assert all(not s["isotropy"]["is_ring"] for s in d["rejected_shells"])
    assert d["removed_fraction"] == 0.0
    assert np.array_equal(res.cleaned.data, vol.data)
    assert np.array_equal(res.cleaned.mask, vol.mask)


def test_the_demo_aluminium_rings_are_confirmed_and_removed():
    vol = _demo(0.9)
    d = fit_pooled_rings(vol, PooledRingConfig()).diagnostics
    assert d["status"] == "fitted"
    kept = [s["q_center"] for s in d["shells"]]
    # The strong Al lines (111, 200, 220) are among the confirmed rings.
    for q_al in (2.69, 3.106, 4.392):
        assert any(abs(q - q_al) < 0.05 for q in kept), (q_al, kept)
    assert all(s["isotropy"]["is_ring"] for s in d["shells"])
    assert all(not s["isotropy"]["is_ring"] for s in d["rejected_shells"])


def test_low_memory_mode_confirms_the_rings_native_mode_does(monkeypatch):
    """The browser's low-memory budget is an eighth of the volume's voxels.
    Shared by every shell alike, it thinned the small shells near |Q| = 0 to a
    few direction cells, so the demo's lowest Al rings went unjudged and stayed
    in. Each shell now keeps sample_per_bin voxels per cell and bin."""
    def confirmed(lean: bool, **isotropy: int) -> list[float]:
        if lean:
            monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
        else:
            monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)
        # A fresh volume each time: in low-memory mode the output overwrites it.
        cfg = PooledRingConfig(isotropy=IsotropyConfig(**isotropy))
        shells = fit_pooled_rings(_demo(0.9), cfg).diagnostics["shells"]
        return [round(s["q_center"], 2) for s in shells]

    native = confirmed(False)
    assert confirmed(True) == native
    shared_budget_only = confirmed(True, sample_per_bin=0)
    assert min(native) not in shared_budget_only


def test_confirmation_off_subtracts_every_detected_shell():
    vol = _demo(0.0)
    d = fit_pooled_rings(vol, PooledRingConfig(confirm_rings=False)).diagnostics
    assert d["confirmation"] is None
    assert d["rejected_shells"] == []
