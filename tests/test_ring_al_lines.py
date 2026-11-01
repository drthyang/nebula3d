"""The Al lines' test of the pooled ring removal (THY-61).

A powder ring is confirmed when it rises in nearly every direction (the strict
rule, ``ring_isotropy.judge_shells``). Two kinds of Al ring failed it on a
measured volume and were left in: the weaker line of a close doublet, whose
flank the stronger line filled ("no clean flank on one side"), and the
high-|Q| lines, whose |Q| moves with direction (in proportion to |Q|) by more
than their width and which only part of the directions measure. The Al lines'
rule judges them again, doublets together, in each direction cell's Al frame
(``ring_isotropy.al_cell_scales``, ``judge_al_lines``).

The synthetic volumes here carry those properties, and the controls the rule
must leave alone: a ring-like diffuse feature off the Al lines, anisotropic
diffuse features at the |Q| of two Al lines (the 400 and 620, where no Al
ring is planted), and a powder ring of another phase.
"""

import dataclasses

import numpy as np
import pytest

from nebula3d.core import HKLVolume
from nebula3d.preprocessing import IsotropyConfig, PooledRingConfig, fit_pooled_rings, pooled_rings
from nebula3d.preprocessing.ring_isotropy import (
    AlCluster,
    al_cell_scales,
    judge_al_lines,
)

AL_A = 4.0494
# h² + k² + l² of each planted Al line, and its amplitude (the 400 and 620
# lines carry diffuse features instead).
LINES = {3: 1.0, 4: 0.6, 8: 0.5, 11: 0.5, 12: 0.2, 19: 0.5, 20: 0.5, 24: 0.3, 27: 0.25,
         32: 0.1, 35: 0.12, 36: 0.09, 43: 0.06, 44: 0.08}
NON_AL_RING = 3.85        # a powder ring of another phase
RING_LIKE = 4.80          # a ring-like diffuse feature, off the Al lines


def q_line(n: int) -> float:
    return float(2.0 * np.pi * np.sqrt(n) / AL_A)


def _al_scale(nx, ny, nz, amp=1.1):
    """Each direction's Al frame: the Al lines there peak at q_line × (1 + scale)."""
    u = nx ** 2 - ny ** 2
    return amp * (0.012 * u * np.abs(u) + 0.003 * nz)


def _directions(q, qx, qy, qz, shape):
    with np.errstate(invalid="ignore", divide="ignore"):
        n = [np.nan_to_num(np.broadcast_to(c / q, shape)) for c in (qx, qy, qz)]
    return n


def _peak(q, q0, fwhm):
    near = np.abs(q - q0) < 4.0 * fwhm
    out = np.zeros(q.shape, np.float32)
    out[near] = np.exp(-4.0 * np.log(2.0) * ((q[near] - q0) / fwhm) ** 2)
    return out


def al_volume(*, seed=0, lines=LINES, features=True, scale_amp=1.1):
    """Al lines whose |Q| moves with direction (± 1.3 % at the 95th
    percentile, as measured), textured (± 30 %), on a falling background with
    noise, measured past 8.3 Å⁻¹ in about half the directions only. Returns the
    volume, its Al rings alone, and its diffuse features alone."""
    extent, step = 10.8, 0.12
    ax = np.arange(-extent, extent + 1e-9, step)
    shape = (ax.size,) * 3
    qx, qy, qz = ax[:, None, None], ax[None, :, None], ax[None, None, :]
    q = np.sqrt(qx ** 2 + qy ** 2 + qz ** 2)
    nx, ny, nz = _directions(q, qx, qy, qz, shape)
    phi = np.arctan2(ny, nx)
    al_q = q / (1.0 + _al_scale(nx, ny, nz, scale_amp))
    texture = 1.0 + 0.3 * (1.5 * nz ** 2 - 0.5)
    rings = np.zeros(shape, np.float32)
    for n, amp in lines.items():
        q0 = q_line(n)
        rings += (amp * texture * _peak(al_q, q0, 0.06 + 0.003 * q0)).astype(np.float32)
    diffuse = np.zeros(shape, np.float32)
    if features:
        diffuse += 0.2 * _peak(q, NON_AL_RING, 0.08)
        lobe = np.clip(np.cos(2.0 * phi), 0.0, None)
        diffuse += (0.35 * lobe * _peak(q, RING_LIKE, 0.1)).astype(np.float32)
        # At the Al 400 |Q|: where |cos θ| < 0.6 only, fixed in |Q|.
        band = 1.0 / (1.0 + np.exp((np.abs(nz) - 0.6) / 0.05))
        w400, w620 = 0.06 + 0.003 * q_line(16), 0.06 + 0.003 * q_line(40)
        diffuse += (0.25 * band * _peak(q, q_line(16), w400)).astype(np.float32)
        # At the Al 620 |Q|: two lobes in φ.
        diffuse += (0.3 * lobe * _peak(q, q_line(40), w620)).astype(np.float32)
    rng = np.random.default_rng(seed)
    data = ((1.0 + 2.0 * np.exp(-q / 3.0)).astype(np.float32) + rings + diffuse
            + rng.normal(0.0, 0.1, shape).astype(np.float32))
    vol = HKLVolume.from_arrays(data, (-extent, extent), (-extent, extent), (-extent, extent),
                                ub_matrix=np.eye(3))
    vol.mask[...] = (q < 8.3) | ((nz > -0.3) & (nx > -0.2))
    return vol, rings, diffuse


def doublet_volume(*, seed=0):
    """Al 331 (narrow) and 420 (broad) 0.18 Å⁻¹ apart, as on the measured
    volume, after the lines that fix the lattice; the grid's L steps fine
    enough for 0.02 Å⁻¹ profile bins. Returns the volume and its Al rings."""
    extent, step, fine = 7.4, 0.12, 0.04
    ax = np.arange(-extent, extent + 1e-9, step)
    lx = np.arange(-extent, extent + 1e-9, fine)
    q = np.sqrt(ax[:, None, None] ** 2 + ax[None, :, None] ** 2 + lx[None, None, :] ** 2)
    rings = np.zeros(q.shape, np.float32)
    for n, amp, fwhm in ((3, 1.0, 0.09), (4, 0.6, 0.09), (8, 0.5, 0.09), (11, 0.5, 0.09),
                         (12, 0.2, 0.09), (16, 0.3, 0.1), (19, 0.25, 0.064), (20, 0.3, 0.15)):
        rings += amp * _peak(q, q_line(n), fwhm)
    data = ((1.0 + 2.0 * np.exp(-q / 3.0)).astype(np.float32) + rings
            + np.random.default_rng(seed).normal(0.0, 0.05, q.shape).astype(np.float32))
    vol = HKLVolume.from_arrays(data, (-extent, extent), (-extent, extent), (-extent, extent),
                                ub_matrix=np.eye(3))
    return vol, rings


def _fit(vol, cfg=None, *, al_rule=True):
    """The pooled ring removal, with or without the Al lines' rule (without,
    as before it: the strict rule alone)."""
    with pytest.MonkeyPatch.context() as mp:
        if not al_rule:
            mp.setattr(pooled_rings, "_judge_al_lines", lambda *a, **k: None)
        vol = dataclasses.replace(vol, data=vol.data.copy(), mask=vol.mask.copy())
        return fit_pooled_rings(vol, cfg or PooledRingConfig())


def _at(shells, q, tol=0.06):
    found = [s for s in shells if abs(s["q_center"] - q) <= tol]
    return found[0] if found else None


def _hkl(shells, hkl):
    """The shell matched to the Al line *hkl*, if any."""
    found = [s for s in shells if s.get("match", {}).get("hkl") == hkl]
    return found[0] if found else None


@pytest.fixture(scope="module")
def al_case():
    vol, rings, diffuse = al_volume()
    return vol, rings, diffuse, _fit(vol), _fit(vol, al_rule=False)


@pytest.fixture(scope="module")
def doublet_case():
    vol, rings = doublet_volume()
    return vol, rings, _fit(vol), _fit(vol, al_rule=False)


def _left_of(vol, out, rings, q0, half=0.05):
    """The ring intensity left at q0 (RMS of cleaned − (data − rings)) over the
    ring's own RMS there, on the measured voxels."""
    q = vol.q_magnitude()
    shell = (np.abs(q - q0) < half) & vol.mask & out.cleaned.mask
    resid = out.cleaned.data[shell] - (vol.data[shell] - rings[shell])
    return float(np.sqrt(np.mean(resid ** 2)) / np.sqrt(np.mean(rings[shell] ** 2)))


# ------------------------------------------------------------- the doublet

def test_an_al_331_420_doublet_is_judged_together_and_both_removed(doublet_case):
    vol, rings, out, strict = doublet_case
    q331, q420 = q_line(19), q_line(20)
    # Before: the 420 confirmed, the 331 beside it never judged.
    before = _at(strict.diagnostics["rejected_shells"], q331)
    assert before is not None and before["isotropy"]["not_judged"] == "no clean flank on one side"
    assert _at(strict.diagnostics["shells"], q420) is not None
    # Now: judged as one cluster, flanks outside it, each line rising on its own.
    d = out.diagnostics
    s331, s420 = _at(d["shells"], q331), _at(d["shells"], q420)
    assert s331 is not None and s420 is not None, [s["q_center"] for s in d["shells"]]
    verdict = s331["isotropy"]
    assert verdict["rule"] == "al" and verdict["is_ring"]
    assert [round(line["q"], 2) for line in verdict["lines"]] == pytest.approx(
        [round(q331, 2), round(q420, 2)], abs=0.03)
    assert all(line["isotropy"] >= 0.15 for line in verdict["lines"])
    assert s331["match"] == {"phase": "Al", "hkl": "331", "q": pytest.approx(q331, abs=0.03)}
    assert not _at(d["rejected_shells"], q331)
    # The 420's envelope took most of the 331 before too; now it is a ring of
    # its own, and no more of it is left.
    left, left_before = _left_of(vol, out, rings, q331), _left_of(vol, strict, rings, q331)
    assert left <= left_before and left < 0.25, (left, left_before)


# ----------------------------------------------- high |Q|, partial coverage

def test_noisy_al_lines_measured_in_part_of_the_directions_are_removed(al_case):
    vol, rings, _diffuse, out, strict = al_case
    for n, hkl in ((32, "440"), (44, "622")):  # their |Q| moves by up to 0.13 Å⁻¹ with direction
        before = _hkl(strict.diagnostics["rejected_shells"], hkl)
        assert before is not None and "isotropy" in before["isotropy"]["fails"], n
        after = _hkl(out.diagnostics["shells"], hkl)
        assert after is not None and after["isotropy"]["rule"] == "al", n
        assert after["isotropy"]["n_cells"] < 0.6 * 128, n  # the measured cells only
        assert _left_of(vol, out, rings, q_line(n)) < 0.6 * _left_of(vol, strict, rings, q_line(n))
    frame = out.diagnostics["al_frame"]
    assert frame["cells"] == 128 and frame["reliability"] > 0.8
    assert 0.008 < frame["scale_p95"] < 0.02


def test_the_al_frame_follows_each_cells_scale(al_case):
    """The frame read off the confirmed rings is each direction cell's own
    scale (here planted), and no frame where the lines do not move."""
    vol, _rings, _diffuse, out, _strict = al_case
    cfg = IsotropyConfig()
    rings = [(q_line(n), 0.06 + 0.003 * q_line(n)) for n in (3, 4, 8, 24, 27)]
    frame = al_cell_scales(vol, rings, cfg)
    # The planted scale averaged over each cell's directions.
    rng = np.random.default_rng(1)
    v = rng.normal(size=(200_000, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    band = np.minimum(((v[:, 2] + 1.0) * 0.5 * cfg.n_cos).astype(int), cfg.n_cos - 1)
    sector = np.minimum(((np.arctan2(v[:, 1], v[:, 0]) + np.pi) / (2 * np.pi) * cfg.n_phi)
                        .astype(int), cfg.n_phi - 1)
    cell = band * cfg.n_phi + sector
    planted = (np.bincount(cell, _al_scale(v[:, 0], v[:, 1], v[:, 2]), minlength=128)
               / np.bincount(cell, minlength=128))
    assert frame.n_cells == 128
    assert np.corrcoef(frame.scale, planted)[0, 1] > 0.95
    assert np.sqrt(np.mean((frame.scale - planted) ** 2)) < 0.002

    still, _, _ = al_volume(scale_amp=0.0, features=False)
    flat = al_cell_scales(still, rings, cfg)
    assert flat.n_cells == 0 or flat.p95 < 0.002


# ---------------------------------------------------------------- controls

def test_a_ring_like_diffuse_feature_off_the_al_lines_survives(al_case):
    vol, _rings, diffuse, out, _strict = al_case
    left = _at(out.diagnostics["rejected_shells"], RING_LIKE)
    assert left is not None and "match" not in left
    assert left["isotropy"].get("rule", "strict") == "strict"
    assert "isotropy" in left["isotropy"]["fails"]
    assert _at(out.diagnostics["shells"], RING_LIKE) is None
    _assert_kept(vol, out, diffuse, RING_LIKE)


@pytest.mark.parametrize("n,hkl", [(16, "400"), (40, "620")])
def test_an_anisotropic_feature_at_an_al_q_survives(al_case, n, hkl):
    """Diffuse at the |Q| of an Al line that carries no ring here: the Al
    lines' rule judges it, and its isotropy (0.9 of the measured directions,
    as the strict rule asks) rejects it; in the Al frame a feature fixed in
    |Q| sits off the core in the cells whose lines move, which only lowers it."""
    vol, _rings, diffuse, out, _strict = al_case
    left = _at(out.diagnostics["rejected_shells"], q_line(n))
    assert left is not None, [s["q_center"] for s in out.diagnostics["shells"]]
    assert left["match"]["hkl"] == hkl
    assert left["isotropy"]["rule"] == "al" and "isotropy" in left["isotropy"]["fails"]
    assert "strict" in left  # the first verdict, kept
    assert _at(out.diagnostics["shells"], q_line(n)) is None
    _assert_kept(vol, out, diffuse, q_line(n))


def _assert_kept(vol, out, diffuse, q0):
    """Where the feature stands (its top tenth), the removal took under 5 % of it."""
    q = vol.q_magnitude()
    where = (np.abs(q - q0) < 0.03) & vol.mask & (diffuse > 0.9 * diffuse.max(
        where=np.abs(q - q0) < 0.03, initial=0.0))
    taken = float(np.mean(vol.data[where] - out.cleaned.data[where]))
    assert taken < 0.05 * float(np.mean(diffuse[where])), taken


def test_a_powder_ring_of_another_phase_is_left_to_the_strict_rule(al_case):
    _vol, _rings, _diffuse, out, _strict = al_case
    ring = _at(out.diagnostics["shells"], NON_AL_RING)
    assert ring is not None and "match" not in ring
    assert ring["isotropy"].get("rule", "strict") == "strict"
    # No Al-rule verdict on any shell off the Al lines, kept or left.
    for s in out.diagnostics["shells"] + out.diagnostics["rejected_shells"]:
        if s["isotropy"].get("rule") == "al":
            assert s.get("match", {}).get("phase") == "Al", s


def test_the_al_rule_confirms_no_noise():
    """No ring at all: every Al line's |Q| (and a doublet's) judged by the Al
    lines' rule, framed and not, confirms nothing."""
    vol, _, _ = al_volume(lines={}, features=False)
    cfg = IsotropyConfig()
    clusters = [AlCluster((q_line(n),), 0.06 + 0.003 * q_line(n))
                for n in (3, 4, 8, 11, 16, 24, 27, 32, 40)]
    clusters.append(AlCluster((q_line(35), q_line(36)), 0.09))
    frame = np.random.default_rng(2).uniform(-0.01, 0.01, cfg.n_cos * cfg.n_phi)
    for scale in (None, frame):
        verdicts = judge_al_lines(vol, clusters, cfg, cell_scale=scale)
        assert not any(v.is_ring for v in verdicts), [v.as_dict() for v in verdicts]


def test_the_al_rule_needs_the_lattice_on_three_lines():
    """One ring always sits near some Al line: two confirmed rings on Al lines
    do not open the Al lines' rule."""
    lines = np.array([q_line(n) for n in (3, 4, 8, 11, 12)])
    shells = pooled_rings._Shells(
        np.array([lines[0], lines[1]]), np.array([0.1, 0.1]), np.array([1.0, 1.0]),
        ["relative"] * 2, [None, None], AL_A,
        [{"q_center": float(lines[3]), "fwhm": 0.1, "amplitude": 0.1, "detection": "relative",
          "isotropy": {}}])

    def never(*_a):
        raise AssertionError("the Al lines' test ran")

    test = pooled_rings._AlTest(scales=never, judge=never, width_ratio=2.0)
    pooled_rings._judge_al_lines(shells, lines, 0.04, 0.02, PooledRingConfig(), [], test)
    assert len(shells.rejected) == 1 and shells.al_frame is None


def test_nothing_changes_where_no_candidate_sits_on_an_al_line():
    """A volume whose rings are all confirmed by the strict rule: the Al
    lines' test never runs, and the removal is what it was, voxel for voxel."""
    from tests.test_pooled_rings import _config, _volume

    vol, *_ = _volume()
    with_rule, without = _fit(vol, _config()), _fit(vol, _config(), al_rule=False)
    assert with_rule.diagnostics["al_frame"] is None
    assert np.array_equal(with_rule.cleaned.data, without.cleaned.data)
    assert with_rule.diagnostics["shells"] == without.diagnostics["shells"]


def test_al_config_validation():
    with pytest.raises(ValueError):
        IsotropyConfig(al_width_ratio=0.0)
    with pytest.raises(ValueError):
        IsotropyConfig(al_min_snr=-1.0)


# ------------------------------------------------- the record, in one line

def test_the_record_in_one_line(al_case):
    """What NEBULA Pilot reads of the ring stage (server.rings, ``summary``):
    the Al lattice, the shells removed (of them on Al lines), and the shells
    left with their Al line and why, the Al lines first."""
    from nebula3d.preprocessing.pooled_rings import shell_summary

    out = al_case[3]
    line = shell_summary(out.diagnostics)
    d = out.diagnostics
    n_al = sum(1 for s in d["shells"] if s.get("match"))
    assert line.startswith(f"Al a={d['al_lattice_a']:.3f} Å; removed {len(d['shells'])} "
                           f"(Al {n_al}); left {len(d['rejected_shells'])}: ")
    assert line.endswith("6.21 Al400 isotropy, 9.81 Al620 isotropy, 4.83 isotropy"), line
    assert len(line) < 160


def test_the_record_names_four_shells_left_and_counts_the_rest():
    from nebula3d.preprocessing.pooled_rings import shell_summary

    def left(q, verdict, hkl=None):
        return {"q_center": q, "fwhm": 0.1, "isotropy": verdict,
                **({"match": {"phase": "Al", "hkl": hkl, "q": q}} if hkl else {})}

    record = {"algorithm": "pooled", "al_lattice_a": None, "shells": [], "rejected_shells": [
        left(5.0, {"is_ring": False, "fails": ["snr", "curve"]}),
        left(3.0, {"is_ring": False, "not_judged": "no clean flank on one side"}),
        left(2.0, {"is_ring": False, "not_judged": "grid too coarse: 0.99 voxels"}),
        left(9.2, {"is_ring": False, "fails": ["member"]}, "531"),
        left(4.0, {"is_ring": False, "median_height": 0.1, "isotropy": -0.2, "snr": 9.0}),
        left(6.0, {"is_ring": False, "not_judged": "measured in 9 direction cells, under 16"}),
    ]}
    assert shell_summary(record) == ("removed 0; left 6: 9.20 Al531 member, 2.00 grid, "
                                     "3.00 flank, 6.00 cells, +2 more")
    assert shell_summary({"algorithm": "global_v2"}) is None
    empty = {"algorithm": "pooled", "shells": [], "rejected_shells": []}
    assert shell_summary(empty) == "removed 0"
