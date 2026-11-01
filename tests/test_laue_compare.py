"""Comparing candidate Laue classes by R_int (THY-56): the evidence for stage 0.

Every check here runs on a volume whose true Laue class is known by
construction:

- a hexagonal crystal whose Bragg peaks and diffuse carry ``1 + A·sin 6φ``
  (6/m: the vertical mirrors flip it) or ``1 + A·cos 6φ`` (6/mmm);
- the demo's FCC crystal without its rods (m-3m) and with them (4/mmm);
- counting noise about a constant (no class can be preferred);
- strong m-3m Bragg peaks carrying errors beyond their counting noise (as
  extinction and absorption give real ones) with 4/mmm rods in the diffuse:
  the full reading accepts m-3m, the diffuse does not;
- small grids with unmeasured voxels, NaN values and unknown σ, where every
  orbit, voxel, pair and χ² term is counted again by brute force;
- counting noise smoothed over neighbouring voxels (as the resolution
  correlates them), where the spread of the ratios over independent
  realisations is known: the orbits as independent samples understate it,
  the spatial block bootstrap gives it (THY-59);
- the 6/m crystal with an error that only the poorly covered region carries,
  which the common-subset reading flags.

The numbers pinned below come from these builders with fixed seeds; their
tolerances are several standard errors of the ratios (≈ 0.003 on the larger
grids), so they hold across numpy's random streams.
"""

from __future__ import annotations

import dataclasses
import functools
import itertools
import math
import tracemalloc

import numpy as np
import pytest
from scipy.ndimage import gaussian_filter

from nebula3d.analysis.laue_compare import (
    BLOCK_MIN,
    DELTA,
    REPLICATES,
    Z,
    _class_readings,
    bragg_neighbourhood,
    bragg_radius_from_punch,
    compare_laue_classes,
    laue_candidates,
)
from nebula3d.core import HKLVolume
from nebula3d.demo import DemoModel, demo_volume
from nebula3d.pipeline import PunchParams
from nebula3d.symmetry import GridSymmetry, laue_group, symmetry_average
from nebula3d.utils import ub_from_lattice
from tests.test_symmetry_average import viewer_case

CUBIC = ("background", "sro", "tds", "bragg")  # the demo without its rods: m-3m
HEX_UB = ub_from_lattice(4.0, 4.0, 6.0, 90.0, 90.0, 120.0)


# ---------------------------------------------------------------------------
# Known-answer builders
# ---------------------------------------------------------------------------
@functools.lru_cache(maxsize=4)
def _hex_model(mirror_break: bool, n_hk: int, n_l: int) -> tuple[np.ndarray, ...]:
    """The noise-free hexagonal crystal (a = 4, c = 6 Å) over ±3 r.l.u. in H
    and K and ±2 in L: a radial background, a diffuse and Gaussian Bragg peaks
    (0.1 Å⁻¹) at every integer node, peaks and diffuse modulated by
    ``1 + 0.4·sin 6φ`` (6/m) or ``1 + 0.4·cos 6φ`` (6/mmm), φ the azimuth of
    Q about c*."""
    h = np.linspace(-3.0, 3.0, n_hk)
    l_ = np.linspace(-2.0, 2.0, n_l)
    hh, kk, ll = np.meshgrid(h, h, l_, indexing="ij")
    q = np.einsum("ij,j...->i...", HEX_UB, np.stack([hh, kk, ll]))
    q2 = (q ** 2).sum(0)

    def mod(phi: np.ndarray | float) -> np.ndarray | float:
        return np.sin(6 * phi) if mirror_break else np.cos(6 * phi)

    lam = (0.05 + 0.3 * np.exp(-np.sqrt(q2) / 3.0) * (1 + 0.4 * mod(np.arctan2(q[1], q[0])))
           * (0.6 + 0.4 * np.cos(math.pi * ll) ** 2))
    for node in itertools.product(range(-4, 5), range(-4, 5), range(-3, 4)):
        qn = HEX_UB @ np.asarray(node, dtype=float)
        qq = float(np.linalg.norm(qn))
        if qq == 0.0:
            continue
        amp = (50.0 * math.exp(-0.3 * qq * qq / (8 * math.pi ** 2)) / (1 + 0.1 * qq * qq)
               * (1 + 0.4 * mod(math.atan2(qn[1], qn[0]))))
        lam += amp * np.exp(-((q - qn[:, None, None, None]) ** 2).sum(0) / (2 * 0.1 ** 2))
    return lam, np.sqrt(lam / 400.0 + 0.005 ** 2)


def hex_crystal(*, mirror_break: bool = True, seed: int = 0, n_hk: int = 61,
                n_l: int = 41) -> HKLVolume:
    """:func:`_hex_model` with Gaussian counting noise of its σ."""
    lam, sigma = _hex_model(mirror_break, n_hk, n_l)
    data = lam + sigma * np.random.default_rng(seed).standard_normal(lam.shape)
    return HKLVolume.from_arrays(data, (-3.0, 3.0), (-3.0, 3.0), (-2.0, 2.0),
                                 sigma=sigma.copy(), ub_matrix=HEX_UB)


def noise_only(*, seed: int = 0, n: int = 41, hexagonal: bool = False) -> HKLVolume:
    """Counting noise (σ 0.1) about 1: every class agrees within the noise."""
    ub = HEX_UB if hexagonal else ub_from_lattice(5.0, 5.0, 5.0)
    data = 1.0 + 0.1 * np.random.default_rng(seed).standard_normal((n, n, n))
    return HKLVolume.from_arrays(data, (-2.0, 2.0), (-2.0, 2.0), (-2.0, 2.0),
                                 sigma=np.full((n, n, n), 0.1), ub_matrix=ub)


@functools.lru_cache(maxsize=2)
def _two_part_model(n: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    m = DemoModel(bragg_height=15000.0, rod_amp=0.15)
    bragg = demo_volume(n, extent=3.0, components=("bragg",), noise=False, model=m)
    diffuse = demo_volume(n, extent=3.0, components=("background", "sro", "tds", "rods"),
                          noise=False, model=m)
    return bragg.data, diffuse.data, diffuse.ub_matrix


def bragg_over_diffuse(*, seed: int = 0, n: int = 61) -> HKLVolume:
    """Strong m-3m Bragg peaks (100× the demo's) whose intensities carry a 5 %
    error beyond their counting noise, as extinction and absorption give real
    ones, over a 4/mmm diffuse (the demo's rods along L): the Bragg peaks are
    cubic, the diffuse is not."""
    lb, ld, ub = _two_part_model(n)
    lam = lb + ld
    sigma = np.sqrt(np.clip(lam, 0.0, None) / 600.0 + 0.006 ** 2)
    rng = np.random.default_rng(seed)
    data = lb * (1 + 0.05 * rng.standard_normal(lb.shape)) + ld + sigma * rng.standard_normal(
        lb.shape)
    return HKLVolume.from_arrays(data, (-3.0, 3.0), (-3.0, 3.0), (-3.0, 3.0), sigma=sigma,
                                 ub_matrix=ub)


def wedge_cut(vol: HKLVolume, *, seed: int = 0) -> HKLVolume:
    """*vol* with partial coverage: a 60° wedge of azimuths about c* never
    measured, a beam stop (|Q| < 0.5 Å⁻¹) and a fifth of the rest at random,
    unmeasured as the loader leaves them (0, σ 0, masked)."""
    q = np.einsum("ij,j...->i...", np.asarray(vol.ub_matrix),
                  np.stack(np.meshgrid(vol.h_axis, vol.k_axis, vol.l_axis, indexing="ij")))
    phi = np.degrees(np.arctan2(q[1], q[0])) % 360.0
    keep = ~((phi > 20.0) & (phi < 80.0)) & (np.sqrt((q ** 2).sum(0)) >= 0.5)
    keep &= np.random.default_rng(seed + 100).random(vol.data.shape) >= 0.2
    out = dataclasses.replace(vol, data=vol.data.copy(), sigma=vol.sigma.copy(),
                              mask=vol.mask & keep)
    out.data[~out.mask] = 0.0
    out.sigma[~out.mask] = 0.0
    return out


ORTHO_UB = ub_from_lattice(5.0, 5.5, 6.1)


def correlated_noise(*, seed: int = 0, n: int = 61, width: float = 1.0) -> HKLVolume:
    """Counting noise (σ 0.1) about 1 on an orthorhombic cell (classes -1 to
    mmm), smoothed by a Gaussian of *width* voxels, as the resolution
    correlates neighbouring voxels, and scaled back to unit variance by the
    kernel's own norm (not each realisation's spread, which would pin the
    sum of squares and shrink the spread of R_int): every class agrees within
    the noise, and neighbours share it."""
    delta = np.zeros((n, n, n))
    delta[n // 2, n // 2, n // 2] = 1.0
    norm = float(np.sqrt((gaussian_filter(delta, width, mode="wrap") ** 2).sum()))
    e = gaussian_filter(np.random.default_rng(seed).standard_normal((n, n, n)), width,
                        mode="wrap") / norm
    return HKLVolume.from_arrays(1.0 + 0.1 * e, (-2.0, 2.0), (-2.0, 2.0), (-2.0, 2.0),
                                 sigma=np.full((n, n, n), 0.1), ub_matrix=ORTHO_UB)


def poorly_covered(*, scale: float = 1.1, seed: int = 0) -> HKLVolume:
    """The 6/m crystal with the wedge cut (:func:`wedge_cut`) and its
    intensities scaled by *scale* where their Friedel mates fall in the
    unmeasured wedge (azimuths 200°–260°), as an absorption or a detector
    region would: an error only the poorly covered region carries, which only
    classes above -1 compare there."""
    out = wedge_cut(hex_crystal(seed=seed), seed=seed)
    q = np.einsum("ij,j...->i...", np.asarray(out.ub_matrix),
                  np.stack(np.meshgrid(out.h_axis, out.k_axis, out.l_axis, indexing="ij")))
    phi = np.degrees(np.arctan2(q[1], q[0])) % 360.0
    out.data[(phi > 200.0) & (phi < 260.0) & out.mask] *= scale
    return out


def _rows(cmp) -> dict[str, tuple[float, float]]:
    return {c.label: (c.all.ratio, c.diffuse.ratio) for c in cmp.candidates}


# ---------------------------------------------------------------------------
# The candidates: the stage's metric and grid checks
# ---------------------------------------------------------------------------
def test_a_hexagonal_cell_compares_the_hexagonal_classes_and_refuses_the_rest():
    cands, refused = laue_candidates(hex_crystal())
    assert [c.label for c in cands] == ["-1", "2/m (c unique)", "-3", "-3m1", "-31m", "6/m",
                                        "6/mmm"]
    assert {r.label: r.reason for r in refused} == {
        "2/m (b unique)": "metric", "mmm": "metric", "4/m": "metric", "4/mmm": "metric",
        "m-3": "metric", "m-3m": "metric"}
    # The stage's own tolerance and wording.
    mmm = next(r for r in refused if r.label == "mmm")
    assert mmm.metric_change > 0.02 and "not symmetries of this lattice" in mmm.detail
    by = {c.label: c for c in cands}
    assert by["6/mmm"].maximal == ["-3m1", "-31m", "6/m"]
    assert by["6/m"].maximal == ["2/m (c unique)", "-3"]
    assert by["-3m1"].maximal == ["-3"] and by["-1"].maximal == []
    assert [by[x].depth for x in ("-1", "2/m (c unique)", "-3", "6/m", "6/mmm")] == [0, 1, 1, 2, 3]
    assert all(c.metric_change == pytest.approx(0.0, abs=1e-12) for c in cands)


def test_a_cubic_cell_compares_the_cubic_classes():
    cands, refused = laue_candidates(demo_volume(25, extent=3.0, components=CUBIC))
    assert [c.label for c in cands] == ["-1", "2/m (b unique)", "2/m (c unique)", "mmm", "4/m",
                                        "4/mmm", "m-3", "m-3m"]
    assert {r.label for r in refused} == {"-3", "-3m1", "-31m", "6/m", "6/mmm"}
    by = {c.label: c for c in cands}
    assert by["m-3m"].maximal == ["4/mmm", "m-3"]
    assert by["4/mmm"].maximal == ["mmm", "4/m"]
    assert by["m-3"].maximal == ["mmm"]


def test_a_grid_the_operations_do_not_map_refuses_them_with_the_stages_reason():
    vol = demo_volume(25, extent=3.0, components=CUBIC)
    # K steps 1.5× H's: the four-folds and three-folds mix axes of unequal steps.
    off = dataclasses.replace(vol, k_axis=vol.k_axis * 1.5)
    cands, refused = laue_candidates(off)
    grid = {r.label for r in refused if r.reason == "grid"}
    assert {"4/m", "4/mmm", "m-3", "m-3m"} <= grid
    assert "-1" in {c.label for c in cands} and "mmm" in {c.label for c in cands}
    detail = next(r.detail for r in refused if r.label == "4/m")
    assert "does not map this volume's HKL grid onto itself" in detail


def test_custom_generators_join_the_candidates_unless_a_preset_has_them():
    vol = hex_crystal()
    cands, _ = laue_candidates(vol, extra=["6/mmm", "h+k,-h,l; -h,-k,-l", "-h,-k,l; h,k,-l"])
    labels = [c.label for c in cands]
    assert labels.count("6/m") == 1 and labels.count("6/mmm") == 1  # presets already
    assert "custom" not in labels  # -h,-k,l; h,k,-l closes to 2/m (c unique)
    cands, _ = laue_candidates(vol, extra=["h+k,-h,l"])  # the six-fold alone: 6, not a Laue class
    assert "custom" in [c.label for c in cands]


# ---------------------------------------------------------------------------
# R_int: the stage's own, and counted orbit by orbit
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("laue", ["-1", "-3", "6/m", "6/mmm"])
def test_r_int_on_every_voxel_is_the_symmetry_averages_own(laue):
    vol = hex_crystal()
    cmp = compare_laue_classes(vol)
    copy = dataclasses.replace(vol, data=vol.data.copy(), sigma=vol.sigma.copy(),
                               mask=vol.mask.copy())
    stats = symmetry_average(copy, GridSymmetry.for_volume(copy, laue_group(laue).ops))
    assert cmp.candidate(laue).all.r_int == stats.r_int  # the same sums, bit for bit


def _brute(vol: HKLVolume, sym: GridSymmetry, mask: np.ndarray) -> dict:
    """R_int, its noise floor, the orbits, voxels and pairs, counted orbit by
    orbit with Python sets: every orbit's distinct members on the grid, those
    measured (mask True, value finite), σ² taken as |I| where σ is unknown."""
    seen = np.zeros(sym.shape, dtype=bool)
    dev = mag = noise = chi2 = 0.0
    orbits = voxels = pairs = dof = 0
    for x in itertools.product(*map(range, sym.shape)):
        if seen[x]:
            continue
        members = set()
        for r, t in sym.index_ops:
            y = tuple(int(v) for v in r @ np.asarray(x) + t)
            if all(0 <= y[a] < sym.shape[a] for a in range(3)):
                members.add(y)
        for y in members:
            seen[y] = True
        meas = [y for y in members if mask[y] and np.isfinite(vol.data[y])]
        n = len(meas)
        if n < 2:
            continue
        vals = [float(vol.data[y]) for y in meas]
        var = [float(vol.sigma[y]) ** 2 if np.isfinite(vol.sigma[y]) else abs(float(vol.data[y]))
               for y in meas]
        mean = sum(vals) / n
        dev += sum(abs(v - mean) for v in vals)
        mag += sum(abs(v) for v in vals)
        total = sum(var)
        noise += sum(math.sqrt(2 / math.pi) * math.sqrt(max(0.0, w * (1 - 2 / n) + total / n ** 2))
                     for w in var)
        # χ² about the inverse-variance mean, over the members whose σ² is above 0.
        weighted = [(v, 1.0 / w) for v, w in zip(vals, var) if w > 0]
        if weighted:
            wmean = sum(v * w for v, w in weighted) / sum(w for _, w in weighted)
            chi2 += sum(w * (v - wmean) ** 2 for v, w in weighted)
            dof += len(weighted) - 1
        orbits += 1
        voxels += n
        pairs += n * (n - 1) // 2
    return {"r_int": dev / mag, "noise": noise / mag, "orbits": orbits, "voxels": voxels,
            "pairs": pairs, "chi2": chi2 / dof, "dof": dof}


@pytest.mark.parametrize("grid, laue", [("hexagonal", "6/mmm"), ("hexagonal", "6/m"),
                                        ("hexagonal", "-3m1"), ("hexagonal", "-1"),
                                        ("cubic", "m-3m"), ("cubic", "4/mmm"), ("cubic", "m-3")])
def test_partial_coverage_counts_every_orbit_voxel_and_pair(grid, laue):
    # About a third of the voxels unmeasured, whole orbits near Q = 0, NaN
    # values (unmeasured to both) and NaN σ (√|I| then): both readings, the
    # second with a "Bragg" set left out, against counting by hand.
    vol = viewer_case(grid)
    sym = GridSymmetry.for_volume(vol, laue_group(laue).ops)
    bragg = np.random.default_rng(3).random(vol.data.shape) < 0.15
    masks = (vol.mask, vol.mask & ~bragg)
    for got, mask in zip(_class_readings(vol, sym, masks, slab_voxels=50), masks):
        want = _brute(vol, sym, mask)
        assert (got.orbits, got.voxels, got.pairs) == (want["orbits"], want["voxels"],
                                                       want["pairs"])
        assert got.r_int == pytest.approx(want["r_int"], rel=1e-12)
        assert got.noise == pytest.approx(want["noise"], rel=1e-12)
        assert got.dof == want["dof"] and got.chi2 == pytest.approx(want["chi2"], rel=1e-9)
        assert want["orbits"] > 20


def test_slabs_of_any_size_read_the_same():
    vol = viewer_case("cubic")
    sym = GridSymmetry.for_volume(vol, laue_group("m-3m").ops)
    masks = (vol.mask,)
    whole = _class_readings(vol, sym, masks)[0]
    for slab in (1, 81, 300):
        part = _class_readings(vol, sym, masks, slab_voxels=slab)[0]
        assert (part.orbits, part.voxels, part.pairs) == (whole.orbits, whole.voxels,
                                                          whole.pairs)
        assert part.r_int == pytest.approx(whole.r_int, rel=1e-12)


def test_the_noise_floor_is_r_int_of_pure_counting_noise():
    # Counting noise alone: R_int sits on its floor for every class, within
    # its standard error, however many members the class pools.
    cmp = compare_laue_classes(noise_only(n=41))
    for c in cmp.candidates:
        assert c.all.ratio == pytest.approx(1.0, abs=4 * c.all.ratio_se + 0.002), c.label
    # The floor grows with the orbits' size as √(1 − 1/n): -1 pools pairs,
    # m-3m up to 48 voxels.
    assert cmp.candidate("m-3m").all.noise > 1.3 * cmp.candidate("-1").all.noise


# ---------------------------------------------------------------------------
# The known answers
# ---------------------------------------------------------------------------
def test_a_true_6_m_crystal_ranks_6_mmm_clearly_worse_and_suggests_6_m():
    cmp = compare_laue_classes(hex_crystal())
    assert cmp.suggestion == "6/m"
    assert cmp.suggested_by == {"all": "6/m", "diffuse": "6/m"}
    assert cmp.disagreement is None
    rows = _rows(cmp)
    # The classes the crystal has agree to their noise floor (pinned) ...
    for label in ("-1", "2/m (c unique)", "-3", "6/m"):
        assert rows[label][0] == pytest.approx(1.002, abs=0.01), label
        assert rows[label][1] == pytest.approx(1.002, abs=0.01), label
    # ... those with the mirrors it lacks are far above it (pinned rises).
    for label in ("-3m1", "-31m", "6/mmm"):
        v_all, v_dif = cmp.candidate(label).verdict_all, cmp.candidate(label).verdict_diffuse
        assert not v_all.supported and not v_dif.supported, label
    assert cmp.candidate("6/mmm").verdict_all.rise == pytest.approx(2.08, abs=0.1)
    assert cmp.candidate("6/mmm").verdict_diffuse.rise == pytest.approx(1.58, abs=0.05)
    assert cmp.candidate("-3m1").verdict_all.rises and cmp.candidate("-31m").verdict_all.rises
    assert "6/mmm rose 2." in cmp.reason
    assert cmp.isotropic["all"].ratio == pytest.approx(13.3, abs=0.5)


def test_a_true_6_mmm_crystal_suggests_6_mmm():
    cmp = compare_laue_classes(hex_crystal(mirror_break=False))
    assert cmp.suggestion == "6/mmm"
    assert all(c.verdict_all.supported and c.verdict_diffuse.supported for c in cmp.candidates)


def test_a_true_m_3m_crystal_ranks_m_3m_best():
    cmp = compare_laue_classes(demo_volume(61, extent=3.0, components=CUBIC))
    assert cmp.suggestion == "m-3m"
    assert cmp.suggested_by == {"all": "m-3m", "diffuse": "m-3m"}
    for c in cmp.candidates:
        assert c.all.ratio == pytest.approx(1.0, abs=0.01), c.label
        assert c.verdict_all.supported and c.verdict_diffuse.supported, c.label
    assert cmp.readings["all"]["tells_apart"] and cmp.readings["diffuse"]["tells_apart"]


def test_the_demo_is_4_mmm_its_rods_break_the_cubic_three_fold():
    cmp = compare_laue_classes(demo_volume(61, extent=3.0))
    assert cmp.suggestion == "4/mmm"
    for label in ("m-3", "m-3m"):
        assert cmp.candidate(label).verdict_all.rise == pytest.approx(1.44, abs=0.05)
        assert not cmp.candidate(label).verdict_diffuse.supported


def test_counting_noise_alone_gives_no_meaningful_preference():
    for hexagonal in (False, True):
        cmp = compare_laue_classes(noise_only(hexagonal=hexagonal))
        assert cmp.suggestion is None
        assert cmp.reason.startswith("No meaningful preference")
        assert not cmp.readings["all"]["tells_apart"]
        assert not cmp.readings["diffuse"]["tells_apart"]
        # The noise floor says why: whole |Q| shells, which pool more than any
        # class, sit on their floor too.
        assert cmp.isotropic["all"].ratio == pytest.approx(1.0, abs=0.01)
        assert cmp.readings["all"]["isotropic_rise"] < 1 + DELTA


def test_a_diffuse_of_lower_symmetry_than_its_bragg_peaks_raises_the_flag():
    cmp = compare_laue_classes(bragg_over_diffuse())
    assert cmp.suggested_by == {"all": "m-3m", "diffuse": "4/mmm"}
    assert cmp.suggestion == "4/mmm"  # supported by both readings
    assert cmp.disagreement is not None and "diffuse alone supports only 4/mmm" in cmp.disagreement
    m3m = cmp.candidate("m-3m")
    assert m3m.verdict_all.supported and m3m.verdict_all.rise < 1 + DELTA
    assert not m3m.verdict_diffuse.supported
    assert m3m.verdict_diffuse.rise == pytest.approx(1.27, abs=0.05)


def test_partial_coverage_keeps_the_answer():
    cmp = compare_laue_classes(wedge_cut(hex_crystal()))
    assert cmp.suggestion == "6/m"
    full = compare_laue_classes(hex_crystal())
    # Fewer orbits measured twice, fewer members each.
    assert cmp.candidate("6/mmm").all.orbits < full.candidate("6/mmm").all.orbits
    assert cmp.candidate("6/m").all.voxels < full.candidate("6/m").all.voxels


@pytest.mark.parametrize("name, build, answer, flag", [
    ("6/m", lambda s: hex_crystal(seed=s, n_hk=41, n_l=21), "6/m", False),
    ("6/mmm", lambda s: hex_crystal(mirror_break=False, seed=s, n_hk=41, n_l=21), "6/mmm", False),
    ("m-3m", lambda s: demo_volume(41, extent=3.0, components=CUBIC, seed=s), "m-3m", False),
    ("4/mmm", lambda s: demo_volume(41, extent=3.0, seed=s), "4/mmm", False),
    ("noise", lambda s: noise_only(seed=s, n=31), None, False),
    ("bragg over diffuse", lambda s: bragg_over_diffuse(seed=s, n=41), "4/mmm", True),
])
def test_the_suggestion_is_stable_to_the_noise(name, build, answer, flag):
    for seed in range(5):
        cmp = compare_laue_classes(build(seed))
        assert cmp.suggestion == answer, (name, seed, cmp.reason)
        assert (cmp.disagreement is not None) == flag, (name, seed)
        assert cmp.common["flag"] is None, (name, seed)  # clean data: no region effect


# ---------------------------------------------------------------------------
# Honest statistics: the block bootstrap, χ²/dof, the common subset (THY-59)
# ---------------------------------------------------------------------------
def test_correlated_noise_the_bootstrap_gives_the_spread_the_orbits_understate():
    # 24 independent realisations of noise smoothed over about a voxel: the
    # ratios' spread over them is the standard error to match.  Orbits as
    # independent samples give a third of it; the block bootstrap gives it
    # within its own and the spread's sampling error (the spread of 24 values
    # is itself uncertain by ≈ 15 %).
    runs = [compare_laue_classes(correlated_noise(seed=seed)) for seed in range(24)]
    first = runs[0]
    assert [c.label for c in first.candidates] == ["-1", "2/m (b unique)", "2/m (c unique)",
                                                   "mmm"]
    for label in ("-1", "2/m (b unique)", "2/m (c unique)", "mmm"):
        reads = [r.candidate(label).all for r in runs]
        spread = float(np.std([x.ratio for x in reads], ddof=1))
        orbit = float(np.mean([x.ratio_se_orbits for x in reads]))
        boot = float(np.mean([x.ratio_se for x in reads]))
        assert orbit < 0.5 * spread, (label, orbit, spread)
        assert 0.7 * spread < boot < 1.45 * spread, (label, boot, spread)
    # The rule's paired difference, on the same resamples: mmm against 2/m.
    excess, se = [], []
    for r in runs:
        g, h = r.candidate("mmm").all, r.candidate("2/m (b unique)").all
        excess.append(g.ratio - (1 + DELTA) * h.ratio)
        se.append(float(np.std(g.replicates - (1 + DELTA) * h.replicates, ddof=1)))
    spread = float(np.std(excess, ddof=1))
    assert 0.7 * spread < float(np.mean(se)) < 1.6 * spread
    # The blocks follow the correlation: longer than the white-noise minimum.
    boot = first.bootstrap
    assert boot["block_voxels"] > BLOCK_MIN and boot["replicates"] == REPLICATES
    assert all(0.5 < x < 0.9 for x in boot["correlation_voxels"])
    assert boot["blocks"] >= 64 and 0 < boot["effective_blocks"] <= boot["blocks"]


def test_white_noise_keeps_the_smallest_blocks_and_the_orbits_standard_error():
    cmp = compare_laue_classes(hex_crystal())
    assert cmp.bootstrap["block_voxels"] == BLOCK_MIN
    for c in cmp.candidates:
        if c.label in ("-1", "2/m (c unique)", "-3", "6/m"):  # the classes it has
            assert c.all.ratio_se == pytest.approx(c.all.ratio_se_orbits, rel=0.35), c.label


def test_chi2_per_degree_of_freedom_is_one_for_the_true_class_and_more_for_a_wrong_one():
    cmp = compare_laue_classes(hex_crystal())
    for label in ("-1", "2/m (c unique)", "-3", "6/m"):
        for r in (cmp.candidate(label).all, cmp.candidate(label).diffuse):
            assert r.chi2 == pytest.approx(1.0, abs=4 * math.sqrt(2 / r.dof) + 0.005), label
    wrong = cmp.candidate("6/mmm")
    assert wrong.all.chi2 > 3.0 and wrong.diffuse.chi2 > 2.0
    # Counting noise alone: every class, and whole |Q| shells, at 1.
    noise = compare_laue_classes(noise_only())
    for r in [c.all for c in noise.candidates] + [noise.isotropic["all"]]:
        assert r.chi2 == pytest.approx(1.0, abs=4 * math.sqrt(2 / r.dof) + 0.005)


def test_a_region_dependent_error_raises_the_common_subset_flag():
    # A 10 % error where -1 cannot judge: the classes above it pool those voxels
    # with well-measured equivalents and rise, so every measured voxel rejects
    # 6/m (the conservative failure: a lower class, gaps left unfilled); on the
    # voxels -1 judges, 6/m is supported, and the flag says so.
    cmp = compare_laue_classes(poorly_covered())
    assert cmp.suggestion == "2/m (c unique)"
    assert cmp.common["lowest"] == "-1" and 0.4 < cmp.common["share"] < 0.7
    assert cmp.common["suggestion"] == "6/m" and cmp.common["main"] == "2/m (c unique)"
    assert cmp.common["flag"] is not None and "supports 6/m" in cmp.common["flag"]
    six = cmp.candidate("6/m")
    assert not six.verdict_all.supported and six.verdict_common_all.supported
    assert six.common_all.ratio == pytest.approx(1.0, abs=0.02) and six.all.ratio > 1.15
    assert six.all.chi2 > 1.15 and six.common_all.chi2 == pytest.approx(1.0, abs=0.03)


def test_the_common_subset_flag_is_quiet_on_clean_data():
    for vol in (wedge_cut(hex_crystal()), hex_crystal(), bragg_over_diffuse()):
        cmp = compare_laue_classes(vol)
        assert cmp.common["flag"] is None
        assert cmp.common["suggestion"] == cmp.suggestion
    # On full coverage the lowest class judges every voxel: one reading.
    full = compare_laue_classes(hex_crystal())
    assert full.common["share"] == 1.0
    assert full.candidate("6/m").common_all is full.candidate("6/m").all


def test_the_bootstrap_is_seeded_and_reproducible():
    vol = hex_crystal(n_hk=41, n_l=21)
    a, b = compare_laue_classes(vol), compare_laue_classes(vol)
    assert a.bootstrap == b.bootstrap
    for ca, cb in zip(a.candidates, b.candidates):
        assert ca.all.ratio_se == cb.all.ratio_se and ca.diffuse.ratio_se == cb.diffuse.ratio_se
        assert np.array_equal(ca.all.replicates, cb.all.replicates)
        assert ca.verdict_all == cb.verdict_all
    other = compare_laue_classes(vol, seed=1)
    se = [(c.all.ratio_se, o.all.ratio_se) for c, o in zip(a.candidates, other.candidates)]
    assert any(x != y for x, y in se)
    assert all(y == pytest.approx(x, rel=0.3) for x, y in se)


# ---------------------------------------------------------------------------
# The Bragg neighbourhood
# ---------------------------------------------------------------------------
def test_the_bragg_radius_is_the_punchs_largest_node_ellipsoid():
    node, origin, source = bragg_radius_from_punch()
    # max_radius_scale × the longest radius of the punch ellipsoid, + the margin
    assert node == pytest.approx(2.0 * 0.115 + 0.02)
    assert origin == pytest.approx(0.30)  # the incident-beam punch's longest radius
    assert "2 × 0.115" in source
    node, _, _ = bragg_radius_from_punch(PunchParams(punch_spherical_radii=(0.05, 0.05, 0.05),
                                                     margin=0.0, max_radius_scale=3.0))
    assert node == pytest.approx(0.15)


def test_the_bragg_neighbourhood_sits_on_the_punch_cells_nodes_and_is_symmetric():
    vol = hex_crystal()
    sym = GridSymmetry.for_volume(vol, laue_group("6/mmm").ops)
    mask, radius = bragg_neighbourhood(vol, (2, 2, 2), 0.25, symmetry=sym)
    assert radius == pytest.approx(0.25)
    ih = lambda v: int(np.argmin(np.abs(vol.h_axis - v)))  # noqa: E731
    il = lambda v: int(np.argmin(np.abs(vol.l_axis - v)))  # noqa: E731
    assert mask[ih(2), ih(0), il(0)] and mask[ih(-2), ih(2), il(2)]  # even nodes: Bragg
    assert not mask[ih(1), ih(0), il(0)] and not mask[ih(2), ih(1), il(1)]  # odd: diffuse kept
    for r, t in sym.index_ops:  # closed under the group
        for x in [(10, 20, 5), (ih(2), ih(0), il(0)), (31, 33, 20)]:
            y = tuple(int(v) for v in r @ np.asarray(x) + t)
            if all(0 <= y[a] < sym.shape[a] for a in range(3)):
                assert mask[x] == mask[y]


def test_a_radius_beyond_the_node_spacing_is_capped():
    vol = hex_crystal()
    mask, radius = bragg_neighbourhood(vol, (1, 1, 1), 5.0)
    assert radius < 1.0  # half the smallest singular value of the node lattice
    cmp = compare_laue_classes(vol, bragg_radius_q=5.0)
    assert any("capped" in note for note in cmp.notes)


# ---------------------------------------------------------------------------
# The rule's record, the progress and the memory
# ---------------------------------------------------------------------------
def test_the_result_records_the_rule_and_the_numbers_that_drove_it():
    out = compare_laue_classes(hex_crystal()).to_dict()
    assert out["rule"]["delta"] == DELTA == 0.10 and out["rule"]["z"] == Z == 2.0
    assert "10%" in out["rule"]["text"] and "noise floor" in out["rule"]["text"]
    assert set(out["bootstrap"]) >= {"replicates", "seed", "block_voxels", "blocks",
                                     "effective_blocks", "correlation_voxels"}
    assert set(out["common"]) == {"lowest", "voxels", "share", "suggestion", "main", "flag"}
    assert "standard errors (a spatial block bootstrap" in out["rule"]["text"]
    row = next(c for c in out["candidates"] if c["laue"] == "6/mmm")
    assert set(row["common"]) == {"all", "diffuse"}
    assert set(row["verdict"]) == {"all", "diffuse", "common_all", "common_diffuse"}
    assert row["verdict"]["all"]["se"] > 0
    assert set(row["all"]) == {"r_int", "noise", "ratio", "ratio_se", "ratio_se_orbits", "chi2",
                               "dof", "orbits", "voxels", "pairs"}
    assert row["verdict"]["all"]["against"] == "-1" and row["verdict"]["all"]["rises"]
    assert out["bragg"]["radius_q"] == pytest.approx(0.25)
    assert out["bragg"]["closed_under"] == "6/mmm"
    assert 0.0 < out["bragg"]["share"] < 0.1
    assert "Twinning" in out["limits"]
    assert out["refused"][0]["reason"] == "metric"


def test_progress_runs_to_the_end_in_order():
    ticks: list[tuple[float, str]] = []
    compare_laue_classes(hex_crystal(n_hk=41, n_l=21), progress=lambda f, m: ticks.append((f, m)))
    fractions = [f for f, _ in ticks]
    assert fractions == sorted(fractions) and fractions[-1] == 1.0
    assert any("R_int over 6/mmm" in m for _, m in ticks)


def test_the_volume_is_not_changed():
    vol = hex_crystal(n_hk=41, n_l=21)
    before = (vol.data.copy(), vol.sigma.copy(), vol.mask.copy())
    compare_laue_classes(vol)
    assert np.array_equal(vol.data, before[0]) and np.array_equal(vol.mask, before[2])
    assert np.array_equal(vol.sigma, before[1])


def test_the_comparison_holds_no_volume_sized_temporary_beyond_its_masks():
    # Two boolean masks (measured, diffuse) and the Bragg mask while it is
    # made are the only arrays the size of the grid; the rest is a slab's.  On
    # a grid 1.5 times as fine (3.4 times the voxels) the traced peak grows by
    # under 3 bytes per voxel gained, where a float64 copy would be 8.
    def case(n):
        rng = np.random.default_rng(n)
        vol = HKLVolume.from_arrays(rng.random((n, n, n), dtype=np.float32), (-4, 4), (-4, 4),
                                    (-4, 4), ub_matrix=HEX_UB, dtype=np.float32)
        vol.mask = rng.random(vol.data.shape) > 0.3
        return vol

    def peak(vol):
        tracemalloc.start()
        try:
            compare_laue_classes(vol, slab_voxels=1 << 16)
            return tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()

    small, big = case(65), case(97)
    grown = peak(big) - peak(small)
    assert grown < 3.0 * (big.data.size - small.data.size)
