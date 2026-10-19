"""Tests for the powder-ring confirmation (``nebula3d.preprocessing.ring_isotropy``).

A powder ring rises at its |Q| in every direction, texture or not; the
crystal's own scattering at one |Q| rises in some directions only. The pooled
ring removal subtracts only the shells confirmed as rings, so a crystal with no
rings keeps all of its diffuse.
"""

import dataclasses
import re

import numpy as np
import pytest

from nebula3d.core import HKLVolume
from nebula3d.demo import DemoModel, demo_volume
from nebula3d.preprocessing import (
    IsotropyConfig,
    PooledRingConfig,
    fit_pooled_rings,
    grid_too_coarse,
    judge_shells,
    shell_isotropy,
)
from nebula3d.preprocessing.ring_isotropy import SAMPLES_PER_FWHM, profile_step, voxel_q_step

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


# ---------------------------------------------------------------- the grid's resolution

def _grid(step: float, n: int = 9, ub: float = 1.0) -> HKLVolume:
    """A blank n³ grid, *step* r.l.u. a voxel, |Q| = *ub* × |hkl|: only its axes count."""
    half = step * (n // 2)
    return HKLVolume.from_arrays(np.zeros((n, n, n)), (-half, half), (-half, half),
                                 (-half, half), ub_matrix=ub * np.eye(3))


@pytest.mark.parametrize("cap", [IsotropyConfig().fwhm_cap, 0.3])
def test_the_grid_limit_is_the_rules_own(cap):
    """One voxel or more across the widest ring the rule takes: its narrowest
    FWHM, SAMPLES_PER_FWHM |Q| bins of half a voxel, within fwhm_cap. The
    limit moves with both constants, and is no number of its own."""
    cfg = IsotropyConfig(fwhm_cap=cap)
    limit = cap / (SAMPLES_PER_FWHM * 0.5)       # the voxel whose half-voxel bins span the cap
    assert grid_too_coarse(_grid(limit * (1 - 1e-9)), cfg) == ""
    coarse = _grid(limit * 1.01)
    voxel = voxel_q_step(coarse)
    assert grid_too_coarse(coarse, cfg) == (
        f"grid too coarse: {cap / voxel:.2g} voxels across a ring's width (at most {cap:g} Å⁻¹), "
        f"under {SAMPLES_PER_FWHM * profile_step(coarse, cfg) / voxel:.2g}")
    # Bins never finer than q_step: a grid finer than twice it is never too coarse.
    assert grid_too_coarse(_grid(cfg.q_step), cfg) == ""


def test_the_validation_dev_grids_either_side_of_the_limit():
    """A check of the limit, not its derivation: the validation's dev crystal
    (a = 3.9 Å) on ±4 r.l.u., at the replays' 81 points a side (0.1 r.l.u. a
    voxel) and the validation's own 161 (0.05)."""
    a_star = 2 * np.pi / 3.9
    assert grid_too_coarse(_grid(0.1, ub=a_star)).startswith("grid too coarse: 0.99 voxels")
    assert grid_too_coarse(_grid(0.05, ub=a_star)) == ""


def test_a_grid_too_coarse_judges_no_shell():
    # 0.1875 Å⁻¹ a voxel: 0.85 voxels across 0.16 Å⁻¹.
    vol = _volume("ring", n=33)
    reason = grid_too_coarse(vol)
    assert reason.startswith("grid too coarse: 0.85 voxels across a ring's width")
    for r in judge_shells(vol, [(Q_RING, FWHM), (1.62, 0.3)]):
        assert not r.is_ring and r.not_judged == reason and r.n_cells == 0
        assert r.as_dict()["isotropy"] is None


def test_the_ring_removal_subtracts_no_ring_on_a_grid_too_coarse_to_confirm_it():
    """The demo's aluminium rings on 0.2 r.l.u. a voxel (0.3 Å⁻¹): the shells
    are found but none can be confirmed, so none is subtracted, and the log
    says they were not judged (not that they are the crystal's own)."""
    from nebula3d.pipeline import RingParams, remove_rings

    vol = demo_volume(41, seed=3, model=DemoModel(sro_amp=0.09, ring_amp=0.9), dtype=np.float32)
    reason = grid_too_coarse(vol)
    assert reason.startswith("grid too coarse: ")
    res = fit_pooled_rings(vol, PooledRingConfig())
    d = res.diagnostics
    assert d["status"] == "no_confirmed_rings" and d["shells"] == []
    assert d["rejected_shells"]
    assert all(s["isotropy"]["not_judged"] == reason for s in d["rejected_shells"])
    assert np.array_equal(res.cleaned.data, vol.data)
    lines: list[str] = []
    remove_rings(vol, RingParams(ring_model="pooled"),
                 progress=lambda stage, status, frac, msg: lines.append(msg or ""))
    done = lines[-1]
    assert (f"0 not (the crystal's own scattering, kept) and {len(d['rejected_shells'])} not "
            f"judged ({reason}; kept)") in done, done


def test_a_shell_whose_direction_cells_the_grid_cannot_fill_is_not_judged():
    """A shell near |Q| = 0, where a cell's |Q| bins get a few voxels each,
    fills only the cells along the lattice's own directions: not judged. The
    same grid fills every cell of the ring further out, which is judged. The
    limit is the rule's: min_voxels a bin in direction_share of the cells."""
    # 0.075 Å⁻¹ a voxel: about 9 voxels a cell's bin at 1 Å⁻¹ on average, 35 at 2 Å⁻¹.
    vol = _volume("ring")
    (near,) = shell_isotropy(vol, [(1.0, FWHM)])
    assert not near.is_ring
    m = re.fullmatch(r"grid too coarse: (\d+) of the (\d+) direction cells get 5 voxels in "
                     r"each \|Q\| bin, under 90 %", near.not_judged)
    assert m and 0 < int(m.group(1)) < 0.9 * int(m.group(2))
    (far,) = shell_isotropy(vol, [(Q_RING, FWHM)])
    assert far.is_ring and not far.not_judged
    # The limit moves with the rule's constants: a median of one voxel a bin,
    # or a verdict on half the directions, takes the near shell.
    for loose in (IsotropyConfig(min_voxels=1), IsotropyConfig(direction_share=0.5)):
        (r,) = shell_isotropy(vol, [(1.0, FWHM)], loose)
        assert not r.not_judged.startswith("grid too coarse")


def test_a_shell_the_box_cuts_is_not_taken_for_one_the_grid_cannot_fill():
    """Past the box's inscribed sphere its faces cut a shell's cells short:
    that is the box's coverage, not the grid's resolution, and the shell is
    judged on the cells it has, as before. The demo's aluminium (311) line,
    5.15 Å⁻¹, beyond a ±3 r.l.u. box's faces at 4.49 Å⁻¹."""
    from nebula3d.preprocessing.ring_isotropy import inscribed_q

    assert inscribed_q(_volume("none")) == pytest.approx(3.0)       # ±3 r.l.u., |Q| = |hkl|
    tilted = HKLVolume.from_arrays(np.zeros((5, 5, 5)), (-1, 1), (-2, 2), (0, 2),
                                   ub_matrix=np.diag([2.0, 1.0, 1.0]))
    assert inscribed_q(tilted) == 0.0                                 # the origin on a face
    vol = demo_volume(97, extent=3.0, seed=3, model=DemoModel(ring_amp=0.9), dtype=np.float32)
    box = inscribed_q(vol)
    assert box == pytest.approx(3 * 2 * np.pi / DemoModel().a)
    (r,) = judge_shells(vol, [(5.145, 0.08)])
    assert r.q_center > box and not r.not_judged.startswith("grid too coarse")
    assert r.is_ring


def test_a_sample_that_leaves_the_cells_too_few_voxels_is_not_judged():
    """In low-memory mode's share of the voxels, with no per-bin floor
    (sample_per_bin=0): a fiftieth of the shell's voxels leaves its cells'
    bins under min_voxels. The per-bin floor (the default) keeps them."""
    vol = _volume("ring")
    lean = IsotropyConfig(max_voxels=2_000, sample_per_bin=0)
    (thin,) = judge_shells(vol, [(Q_RING, FWHM)], lean)
    assert not thin.is_ring and thin.not_judged.startswith("grid too coarse: ")
    (kept,) = judge_shells(vol, [(Q_RING, FWHM)], IsotropyConfig(max_voxels=2_000))
    assert kept.is_ring


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
