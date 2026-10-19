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
    GRID_TOO_COARSE,
    IsotropyConfig,
    PooledRingConfig,
    fit_pooled_rings,
    grid_needs,
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


@pytest.mark.parametrize("cap", [IsotropyConfig().fwhm_cap, 0.3])
def test_what_the_grid_needs_is_the_rules_own(cap):
    """The need the ring removal's notice states, from the same constants as
    the limit: on a grid too coarse for any ring, the voxels its reason says
    the grid is under, across fwhm_cap; else the share of a shell's direction
    cells, and the voxels in each of their |Q| bins, that the rule asks."""
    cfg = IsotropyConfig(fwhm_cap=cap)
    coarse = _grid(cap / (SAMPLES_PER_FWHM * 0.5) * 1.01)
    assert grid_too_coarse(coarse, cfg).endswith(", under 1")
    assert grid_needs(coarse, cfg) == f"1 voxel across {cap:g} Å⁻¹"
    fine = _grid(cfg.q_step)
    assert grid_needs(fine, cfg) == "90 % of the direction cells with 5 voxels in each |Q| bin"
    assert grid_needs(fine, IsotropyConfig(fwhm_cap=cap, direction_share=0.75, min_voxels=8)) == (
        "75 % of the direction cells with 8 voxels in each |Q| bin")
    assert GRID_TOO_COARSE == "grid too coarse"
    assert grid_too_coarse(coarse, cfg).startswith(GRID_TOO_COARSE)


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
    says so out loud (not that they are the crystal's own): how many, what
    the grid needs, and the two ways out."""
    from nebula3d.pipeline import RING_GRID_REMEDY, RingParams, remove_rings

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
    out = remove_rings(vol, RingParams(ring_model="pooled"),
                       progress=lambda stage, status, frac, msg: lines.append(msg or ""))
    done = lines[-1]
    n = len(d["rejected_shells"])
    notice = (f"{n} ring{'s' if n > 1 else ''} detected but not confirmed at this grid (needs ≥ "
              f"{grid_needs(vol)}); not subtracted. {RING_GRID_REMEDY}")
    assert done.endswith(f"0 not (the crystal's own scattering, kept) (of 41/41 planes fitted), "
                         f"removed 0% of |I|. ⚠ {notice}"), done
    assert "not judged" not in done
    record = getattr(out, "_ring_diagnostics")["unconfirmed_at_grid"]
    assert record == {"count": n, "needs": "1 voxel across 0.16 Å⁻¹", "notice": notice,
                      "q_centers": [round(s["q_center"], 4) for s in d["rejected_shells"]]}


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


def _al_lines(min_rel: float) -> list[float]:
    """The demo's Al powder lines (|Q|, Å⁻¹) planted at min_rel or more of the strongest."""
    from nebula3d.demo import _AL_A, _AL_LINES

    return [2 * np.pi * np.sqrt(sum(i * i for i in hkl)) / _AL_A
            for hkl, rel in _AL_LINES if rel >= min_rel]


def test_on_the_dev_grid_the_ring_removal_says_how_many_rings_it_left_and_the_ways_out():
    """A known answer on a synthetic coarse volume (G1): the demo crystal on
    the validation's dev cell (a = 3.9 Å) and its replays' grid, 81 points
    over ±4 r.l.u. (0.99 voxels across 0.16 Å⁻¹). The ring removal detects the
    demo's four strong Al lines, confirms none and subtracts none, and its log
    says so with that count, what the grid needs and the two ways out. Both
    hold: with the confirmation off it subtracts those shells; on the
    validation's own 161 points it confirms and subtracts the lines, and says
    nothing of the kind."""
    from nebula3d.pipeline import RING_GRID_REMEDY, RingParams, remove_rings

    def run(n: int, confirm: bool = True) -> tuple[HKLVolume, HKLVolume, dict, str]:
        vol = demo_volume(n, seed=3, model=DemoModel(a=3.9), dtype=np.float32)
        lines: list[str] = []
        out = remove_rings(vol, RingParams(ring_model="pooled", pooled_confirm_rings=confirm),
                           progress=lambda stage, status, frac, msg: lines.append(msg or ""))
        return vol, out, getattr(out, "_ring_diagnostics"), lines[-1]

    strong = _al_lines(0.28)  # 111, 200, 220 and 311
    vol, out, d, done = run(81)
    assert grid_too_coarse(vol).startswith("grid too coarse: 0.99 voxels")
    record = d["unconfirmed_at_grid"]
    assert record["count"] == len(record["q_centers"]) == len(strong) == 4
    for q in strong:
        assert any(abs(c - q) < 0.1 for c in record["q_centers"]), (q, record)
    assert done.endswith(
        f"removed 0% of |I|. ⚠ 4 rings detected but not confirmed at this grid (needs ≥ 1 voxel "
        f"across 0.16 Å⁻¹); not subtracted. {RING_GRID_REMEDY}"), done
    assert record["notice"] == done.split("⚠ ", 1)[1]
    assert d["shells"] == [] and np.array_equal(out.data, vol.data)

    _, _, off, done_off = run(81, confirm=False)
    subtracted = [s["q_center"] for s in off["shells"]]
    for q in record["q_centers"]:
        assert any(abs(c - q) < 1e-3 for c in subtracted), (q, subtracted)
    assert float(off["removed_fraction"]) > 0
    assert "unconfirmed_at_grid" not in off and "⚠" not in done_off

    fine_vol, _, fine, done_fine = run(161)
    assert grid_too_coarse(fine_vol) == ""
    assert "unconfirmed_at_grid" not in fine and "⚠" not in done_fine
    assert not any(GRID_TOO_COARSE in str((s.get("isotropy") or {}).get("not_judged"))
                   for s in fine["rejected_shells"])
    confirmed = [s["q_center"] for s in fine["shells"]]
    for q in strong:
        assert any(abs(c - q) < 0.1 for c in confirmed), (q, confirmed)


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
