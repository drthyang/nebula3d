"""The punch stage with the sample's modulation (plan 4.15).

The pipeline's default declares nothing (P3): the search leaves no position
alone. The planes it protected before declarations, H = n ± 1/3 ± 0.08 r.l.u.,
are k = (1/3, 0, 0) declared as planes, which punch as the old default did,
voxel for voxel and peak for peak. The punch records what its search left
alone and whether its sharp peaks off the lattice bunch at a commensurate
fraction, and says so in one line of its log when they do. Every k here is a
generic example, never a material's.
"""

from __future__ import annotations

import dataclasses
import json

import numpy as np
import pytest

import nebula3d
from nebula3d.core import HKLVolume
from nebula3d.modulation import Modulation
from nebula3d.pipeline import (
    PipelineParams,
    PunchParams,
    _sharp_off_lattice,
    bragg_remover,
    default_modulation,
    punch_bragg,
    run_pipeline,
)
from nebula3d.symmetry import GridSymmetry, parse_symmetry_ops
from nebula3d.utils import ub_from_lattice
from tests.test_symmetry import _SHAPE, SIX_M, _hex_volume

#: The search's protection before declarations: H fractions 0.3333 and 0.6667 ± 0.08.
OLD_DEFAULT = PunchParams(search_exclude_h_fractions=(0.3333, 0.6667))
#: The same planes declared: k = (1/3, 0, 0) as planes, ± 0.08 r.l.u. (P1's default).
THIRDS = Modulation.parse({"k": "1/3, 0, 0", "form": "planes"})


def test_the_default_declares_nothing():
    """Nothing is protected unless declared (the user's decision, 2026-10-19;
    plan 4.15, P3): neither a declaration nor the legacy H planes."""
    assert default_modulation() is None
    assert PipelineParams().modulation is None
    assert PunchParams().search_exclude_h_fractions is None
    assert PunchParams().search_exclude_h_centers is None
    assert PunchParams().search_exclude_h_half_width == 0.08
    # The planes the default declared until P3, declared now by name.
    assert THIRDS.to_json() == {"k": [["1/3", "0", "0"]], "order": 1, "form": "planes",
                                "half_width": 0.08, "normal": None}
    assert [p.label for p in THIRDS.positions()] == ["H ≡ 1/3 (mod 1)", "H ≡ 2/3 (mod 1)"]
    # A sample fact, read like the symmetry: "none" declares none.
    assert PipelineParams(modulation="none").modulation is None
    assert PipelineParams(modulation=None).modulation is None
    assert PipelineParams(modulation={"k": "1/4, 0, 0"}).modulation == Modulation.parse(
        "1/4, 0, 0")
    with pytest.raises(ValueError, match="choose 'points' or 'planes'"):
        PipelineParams(modulation={"k": "1/4, 0, 0", "form": "rods"})


def _same_punch(a: HKLVolume, b: HKLVolume) -> bool:
    pa, pb = dict(a._bragg_profile), dict(b._bragg_profile)
    pa.pop("modulation"), pb.pop("modulation")
    return (np.array_equal(a.mask, b.mask) and np.array_equal(a._punched, b._punched)
            and json.dumps(pa) == json.dumps(pb))


@pytest.mark.parametrize("symmetric", [False, True], ids=["plain", "6/m"])
def test_the_thirds_declared_as_planes_punch_as_the_old_default(symmetric):
    """On 6/m data with sharp satellites on the thirds planes and their
    equivalents: k = (1/3, 0, 0) declared as planes and the old
    (0.3333, 0.6667) ± 0.08 punch the same voxels and record the same peaks;
    the default, which declares nothing, punches the satellites too."""
    vol = dataclasses.replace(_hex_volume(), sigma=np.full(_SHAPE, 0.2))
    kw = {"symmetry": GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_M))} if symmetric else {}
    declared = punch_bragg(vol, PunchParams(), modulation=THIRDS, **kw)
    old = punch_bragg(vol, OLD_DEFAULT, **kw)
    default = punch_bragg(vol, PunchParams(), modulation=PipelineParams().modulation, **kw)
    assert _same_punch(declared, old)
    assert int(default._punched.sum()) > int(old._punched.sum())


def test_the_punch_records_what_its_search_left_alone():
    vol = dataclasses.replace(_hex_volume(), sigma=np.full(_SHAPE, 0.2))
    gs = GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_M))
    record = punch_bragg(vol, PunchParams(), symmetry=gs,
                         modulation=THIRDS)._bragg_profile["modulation"]
    assert record["declared"] == THIRDS.to_json()
    assert record["cell"] == [1, 1, 1]
    assert record["symmetry_ops"] == [m.tolist() for m in gs.ops]
    assert record["legacy"] is None
    assert set(record) == {"declared", "cell", "symmetry_ops", "legacy", "bunching"}
    legacy = punch_bragg(vol, OLD_DEFAULT)._bragg_profile["modulation"]
    assert legacy["declared"] is None and legacy["symmetry_ops"] is None
    assert legacy["legacy"] == {"h_centers": None, "h_fractions": [0.3333, 0.6667],
                                "half_width": 0.08}
    off = PunchParams(search_exclude_h_fractions=(0.3333,), search_exclude_h_half_width=0.0)
    assert punch_bragg(vol, off)._bragg_profile["modulation"]["legacy"] is None


def _satellites(*, sigma_sat: float = 0.04, fraction: float = 0.2) -> HKLVolume:
    """A cubic volume (a = 8 Å, ±2 r.l.u. every 0.05) with sharp Bragg peaks
    at the nodes (σ = 0.04 r.l.u., inside the resolution ellipsoid) and
    satellites at G ± (*fraction*, 0, 0) about every node (1/5 by default),
    of width *sigma_sat*: a modulation nobody declared."""
    ax = np.round(np.linspace(-2.0, 2.0, 81), 6)
    hh, kk, ll = np.meshgrid(ax, ax, ax, indexing="ij")
    rng = np.random.default_rng(1)
    data = 1.0 + rng.normal(0.0, 0.05, hh.shape)
    for g in np.ndindex(5, 5, 5):
        node = np.asarray(g, dtype=float) - 2.0
        for centre, amp, sig in [(node, 200.0, 0.04)] + [
                (node + s * np.array([fraction, 0.0, 0.0]), 40.0, sigma_sat) for s in (1, -1)]:
            r2 = (hh - centre[0]) ** 2 + (kk - centre[1]) ** 2 + (ll - centre[2]) ** 2
            near = r2 < (5 * sig) ** 2
            data[near] += amp * np.exp(-0.5 * r2[near] / sig**2)
    return HKLVolume.from_arrays(data, (-2.0, 2.0), (-2.0, 2.0), (-2.0, 2.0),
                                 sigma=np.full(data.shape, 0.05),
                                 ub_matrix=ub_from_lattice(8.0, 8.0, 8.0))


def _punch_lines(vol, **kw):
    lines: list[str] = []
    out = punch_bragg(vol, PunchParams(), progress=lambda s, st, f, m: lines.append(m or ""),
                      **kw)
    return out, lines


def _off_lattice(out) -> list[dict]:
    return [r for r in out._bragg_profile["peaks"]
            if r["found_by"] == "search" and r["source_node_hkl"] is None]


def test_the_punch_says_when_sharp_peaks_off_the_lattice_bunch_at_a_fraction():
    """Satellites at H ≡ ±1/5, which the default (nothing declared) does not
    protect: the search punches them, and the punch records
    the bunching and says so in one line, which names none of the words arm A
    reads. On this grid (0.05 r.l.u.) the band of one grid step about 1/5 holds
    1/4, 1/6 and 2/9 too: the hits sit on 1/5 itself, and it is the one named."""
    from nebula3d.validation.arm_a import _SAYS

    out, lines = _punch_lines(_satellites(), modulation=default_modulation())
    bunching = out._bragg_profile["modulation"]["bunching"]
    assert bunching is not None
    assert (bunching["coordinate"], bunching["denominator"], bunching["where"]) == (
        "H", 5, "H ≡ ±1/5 (mod 1)")
    assert bunching["mean_distance"] == pytest.approx(0.0, abs=1e-9)
    assert "H ≡ ±1/4 (mod 1)" in bunching["others"]
    assert bunching["hits"] == bunching["peaks"] >= 150 and bunching["p_value"] < 1e-12
    said = [m for m in lines if m.startswith("sharp peaks off the lattice bunch")]
    assert len(said) == 1 and said[0].startswith(
        "sharp peaks off the lattice bunch at H ≡ ±1/5 (mod 1): ")
    assert not any(says.search(said[0]) for says in _SAYS.values())
    # The satellites were punched: the search took them for spurious peaks.
    assert len(_off_lattice(out)) >= bunching["peaks"]


def test_a_declared_modulation_is_left_alone_and_raises_no_question():
    """With k = (1/5, 0, 0) declared, as planes or as points, the search finds
    no peak off the lattice: not the satellites, and not the voxels beside
    them, which are flanks of brighter protected peaks, not maxima. The punch
    asks nothing. (Before the fix it found 200 such flanks with the planes
    declared and 837 with the points.)"""
    vol = _satellites()
    for declared in (Modulation.parse({"k": "1/5, 0, 0", "form": "planes"}),
                     Modulation.parse("1/5, 0, 0")):
        out, lines = _punch_lines(vol, modulation=declared)
        assert out._bragg_profile["modulation"]["bunching"] is None
        assert not any(m.startswith("sharp peaks off the lattice") for m in lines)
        assert not _off_lattice(out)


def _six_m_satellites():
    """The exactly 6/m test data of tests/test_symmetry.py with its noise as
    σ, its symmetry on the grid, and the centre voxels of its satellites at the
    star of k = (1/3, 0, 0) that lie in the grid and are measured: Gaussians of
    σ about 0.08 r.l.u. on a 0.1 r.l.u. grid, wider than a ± 0.08 protection."""
    vol = dataclasses.replace(_hex_volume(), sigma=np.full(_SHAPE, 0.2))
    gs = GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_M))
    measured = vol.mask & np.isfinite(vol.data)
    nodes = [np.array(g, dtype=float) - [3, 3, 2] for g in np.ndindex(7, 7, 5)]
    nodes = [n for n in nodes if n.any()]
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    centres = set()
    for n in nodes[::7]:  # the nodes _hex_volume plants satellites about
        for op in gs.ops:
            s = op @ (n + [1 / 3, 0, 0])
            idx = tuple(int(np.argmin(np.abs(a - v))) for a, v in zip(axes, s))
            if all(abs(float(a[i]) - v) <= 0.05 + 1e-9 for a, i, v in zip(axes, idx, s)) \
                    and measured[idx]:
                centres.add(idx)
    return vol, gs, sorted(centres)


@pytest.mark.parametrize("form", ["points", "planes"])
def test_a_protected_satellite_comes_through_the_search_whole(form):
    """Satellites wider than their protection, at the 6/m star of
    k = (1/3, 0, 0) declared ± 0.08: none of the 216 is punched, and no
    protected voxel is punched but by the incident beam's punch at the origin,
    which is not the search's. Before the fix the search found the voxel beside
    a protected satellite, and its punch took the satellite: 198 of 216 with
    the points declared."""
    vol, gs, centres = _six_m_satellites()
    assert len(centres) == 216
    declared = Modulation.parse({"k": "1/3, 0, 0", "form": form})
    punched = punch_bragg(vol, PunchParams(), symmetry=gs, modulation=declared)._punched
    assert sum(bool(punched[i]) for i in centres) == 0
    remover = dataclasses.replace(bragg_remover(PunchParams()), symmetry_ops=gs.ops)
    beam = ~remover._symmetric_keep(vol, remover._punch_incident_beam(
        vol, np.ones(vol.shape, dtype=bool)))
    protected = np.broadcast_to(declared.mask(vol, gs), vol.shape)
    assert (punched & protected).any() and not (punched & protected & ~beam).any()


def test_the_search_still_punches_the_satellites_nobody_declared():
    """The fix does not blind the search: with nothing declared, or with a
    modulation declared elsewhere (k = (0, 0, 1/2)), every one of the 216
    satellites is punched."""
    vol, gs, centres = _six_m_satellites()
    for extra in ({}, {"modulation": Modulation.parse("0, 0, 1/2")}):
        punched = punch_bragg(vol, PunchParams(), symmetry=gs, **extra)._punched
        assert sum(bool(punched[i]) for i in centres) == len(centres) == 216


def test_the_test_reads_the_sharp_peaks_off_the_lattice():
    """Its input: the search's peaks off the lattice whose measured widths are
    at most twice the median of the peaks at the nodes on every axis; a peak
    not measured is left out, and without five measured peaks at the nodes
    there is no Bragg width to compare with."""
    def row(found_by, node, width, centre=(0.2, 0.0, 0.0)):
        return {"found_by": found_by, "source_node_hkl": node, "measured_width_hkl": width,
                "center_hkl": list(centre)}

    nodes = [row("integer", [1, 0, 0], [0.1, 0.1, 0.12])] * 4 + [
        row("search", [0, 1, 0], [0.1, 0.1, 0.12])]  # a node's Bragg peak the search found
    rows = nodes + [
        row("search", None, [0.2, 0.2, 0.24], (0.2, 0.0, 0.0)),   # twice the median: sharp
        row("search", None, [0.21, 0.1, 0.1], (0.8, 0.0, 0.0)),   # broad along H
        row("search", None, None, (1.2, 0.0, 0.0)),               # not measured
        row("integer", [2, 0, 0], [0.1, 0.1, 0.1], (2.0, 0.0, 0.0)),
    ]
    assert _sharp_off_lattice(rows) == [(0.2, 0.0, 0.0)]
    # Four measured peaks at the nodes and one not measured: no Bragg width to compare with.
    few = nodes[1:] + rows[len(nodes):-1] + [row("integer", [2, 0, 0], None)]
    assert _sharp_off_lattice(few) == []


def test_run_pipeline_hands_the_punch_the_samples_modulation(tmp_path):
    raw = tmp_path / "raw" / "satellites.h5"
    raw.parent.mkdir()
    nebula3d.save(_satellites(), raw)
    for name, declared, fired in (("none", None, True), ("fifth", "1/5, 0, 0", False),
                                  ("default", default_modulation(), True),
                                  ("thirds", THIRDS, True)):
        params = PipelineParams(modulation=declared, flatten_enabled=False)
        paths = run_pipeline(raw, params, proc_dir=tmp_path / name, stages=("punch",))
        record = json.loads(paths.bragg_profile_json.read_text())["modulation"]
        assert record["declared"] == (None if declared is None
                                      else Modulation.parse(declared).to_json())
        assert (record["bunching"] is not None) == fired


def _thirds_run(tmp_path, params: PipelineParams):
    """The punch stage of a run with *params* on the cubic volume with
    satellites at G ± (1/3, 0, 0): its profile, its punched volume and its log."""
    raw = tmp_path / "raw" / "thirds.h5"
    if not raw.exists():
        raw.parent.mkdir(parents=True)
        nebula3d.save(_satellites(fraction=1 / 3), raw)
    lines: list[str] = []
    name = "default" if params.modulation is None else "declared"
    paths = run_pipeline(raw, params, proc_dir=tmp_path / name, stages=("punch",),
                         progress=lambda s, st, f, m: lines.append(m or ""))
    profile = json.loads(paths.bragg_profile_json.read_text())
    return profile, nebula3d.load(paths.braggpunched), lines


def _satellite_voxels(vol: HKLVolume, fraction: float) -> list[tuple[int, ...]]:
    """The voxel nearest each satellite G ± (*fraction*, 0, 0) inside the grid."""
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    out = []
    for g in np.ndindex(5, 5, 5):
        for s in (1, -1):
            centre = np.asarray(g, dtype=float) - 2.0 + s * np.array([fraction, 0.0, 0.0])
            if abs(centre[0]) <= 2.0:
                out.append(tuple(int(np.argmin(np.abs(a - v))) for a, v in zip(axes, centre)))
    return out


def test_no_declaration_protects_nothing(tmp_path):
    """A run that declares nothing (the default since P3) records
    ``declared: null`` and no legacy planes, and its search punches the
    satellites at H = n ± 1/3 that the old default left alone: every one of
    the 200 inside the grid. With k = (1/3, 0, 0) declared as planes, none."""
    profile, out, _ = _thirds_run(tmp_path, PipelineParams(flatten_enabled=False))
    record = profile["modulation"]
    assert record["declared"] is None and record["legacy"] is None
    voxels = _satellite_voxels(out, 1 / 3)
    assert len(voxels) == 200
    assert not any(out.mask[i] for i in voxels)
    off = [r for r in profile["peaks"]
           if r["found_by"] == "search" and r["source_node_hkl"] is None]
    assert len(off) == 200
    declared, kept, _ = _thirds_run(tmp_path, PipelineParams(modulation=THIRDS,
                                                             flatten_enabled=False))
    assert declared["modulation"]["declared"] == THIRDS.to_json()
    assert all(kept.mask[i] for i in voxels)


def test_the_thirds_declared_reproduce_the_old_default_exactly():
    """k = (1/3, 0, 0) declared as planes punches what the old default,
    H fractions (0.3333, 0.6667) ± 0.08, punched: the same voxels and the same
    peak records, on satellites at H = n ± 1/3 between the grid's voxels
    (0.05 r.l.u.). On the same data the default punches more: the satellites."""
    vol = _satellites(fraction=1 / 3)
    declared = punch_bragg(vol, PunchParams(), modulation=THIRDS)
    old = punch_bragg(vol, OLD_DEFAULT)
    assert _same_punch(declared, old)
    default = punch_bragg(vol, PunchParams(), modulation=PipelineParams().modulation)
    assert int(default._punched.sum()) > int(old._punched.sum())


def test_an_undeclared_thirds_family_raises_the_question(tmp_path):
    """Satellites at G ± (1/3, 0, 0), left undeclared, as a run with the
    default settings leaves them: the search punches them, and the punch
    records that its sharp peaks off the lattice bunch at H ≡ ±1/3 (mod 1),
    names that fraction, and says so in one line of its log. Declared as
    planes, the punch asks nothing."""
    profile, _, lines = _thirds_run(tmp_path, PipelineParams(flatten_enabled=False))
    bunching = profile["modulation"]["bunching"]
    assert bunching is not None
    assert (bunching["coordinate"], bunching["denominator"], bunching["where"]) == (
        "H", 3, "H ≡ ±1/3 (mod 1)")
    assert bunching["hits"] == bunching["peaks"] == 200 and bunching["p_value"] < 1e-12
    said = [m for m in lines if m.startswith("sharp peaks off the lattice bunch")]
    assert len(said) == 1 and said[0].startswith(
        "sharp peaks off the lattice bunch at H ≡ ±1/3 (mod 1): ")
    declared, _, lines = _thirds_run(tmp_path, PipelineParams(modulation=THIRDS,
                                                              flatten_enabled=False))
    assert declared["modulation"]["bunching"] is None
    assert not any(m.startswith("sharp peaks off the lattice") for m in lines)
