# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The Bragg punch's node test on a grid too coarse for its background shell (G2).

The node test (``integer_detect="significance"``) judges a node by its window's
brightest voxel against the median of a shell between 1× and 2× the
resolution ellipsoid R. A median needs 8 voxels (``_SHELL_MIN_VOXELS``); with
fewer the test fell back on the window's median, which on a coarse grid
passes the diffuse at a node. The guard: at a node whose shell holds fewer
than 8 measured voxels the test does not judge. With ``mode="both"`` the node
is left to the search pass; with ``mode="integer"`` it is judged as before,
provisionally. The punch says so out loud, in its log and its record.

Known answers on the validation's dev cases (a = 3.9 Å, ±4 r.l.u.; dev split
only) at 81 points a side (0.161 Å⁻¹ a voxel, over the 0.143 Å⁻¹ the shell
needs) and at 161 (0.081 Å⁻¹, under it).
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from nebula3d.analysis import bragg
from nebula3d.analysis.bragg import BraggRemover
from nebula3d.core import HKLVolume
from nebula3d.pipeline import PunchParams, bragg_remover, node_test_notice, punch_bragg
from nebula3d.preprocessing import GRID_TOO_COARSE
from nebula3d.validation import build, case_named, cases
from nebula3d.validation.cases import ring_qs

R = (0.097, 0.072, 0.115)  # the default resolution ellipsoid (rρ, rθ, rφ), Å⁻¹
DEV = [c.id for c in cases("dev")]
# The 12 nodes of the (1,1,0) family: forbidden on the dev crystal's FCC lattice.
NODES_110 = ([(h, k, 0) for h in (-1, 1) for k in (-1, 1)]
             + [(h, 0, l) for h in (-1, 1) for l in (-1, 1)]
             + [(0, k, l) for k in (-1, 1) for l in (-1, 1)])


def _forbidden(node) -> bool:
    """A node of the dev crystal with no Bragg peak: its FCC lattice keeps the
    nodes whose indices are all even or all odd."""
    h, k, l = (int(x) for x in node)
    return not h % 2 == k % 2 == l % 2


def _node_of(rec) -> tuple[int, int, int] | None:
    """The node a punch record sits on: its source node, or a search peak's
    nearest node within a quarter of a r.l.u. per axis; None off the nodes."""
    if rec.source_node_hkl is not None:
        return tuple(int(x) for x in rec.source_node_hkl)
    c = np.asarray(rec.center_hkl, dtype=float)
    node = np.round(c)
    return tuple(int(x) for x in node) if np.all(np.abs(c - node) <= 0.25) else None


def _grid(a: float, step: float, extent: float, data=None, **kw) -> HKLVolume:
    n = int(round(2 * extent / step)) + 1
    if data is None:
        data = np.zeros((n, n, n))
    return HKLVolume.from_arrays(data, (-extent, extent), (-extent, extent), (-extent, extent),
                                 sigma=np.ones_like(data), ub_matrix=(2 * np.pi / a) * np.eye(3),
                                 **kw)


def _significance(**kw) -> BraggRemover:
    base = dict(integer_detect="significance", min_significance=5.0, punch_incident_beam=False)
    base.update(kw)
    return BraggRemover(**base)


# --------------------------------------------------------------- the limit

def test_the_limit_is_the_shells_volume_over_the_floor(monkeypatch):
    """The R..2R shell is 2³ − 1 = 7 times R's Q-volume, (28π/3)·rρ·rθ·rφ, so
    8 voxels need a voxel Q-volume of (7π/6)·rρ·rθ·rφ or less: 0.143 Å⁻¹ a
    cubic voxel at the default R, about 2·r_min. The limit comes from R and
    the floor, in either punch frame, and moves with them."""
    vol = _grid(3.9, 0.1, 1.0)
    r = _significance()
    limit = r.node_test_limit(vol)
    assert limit == pytest.approx(((7 * np.pi / 6) * np.prod(R)) ** (1 / 3), rel=1e-12)
    assert limit == pytest.approx(0.1433, abs=5e-5)
    assert limit == pytest.approx(2 * min(R), rel=0.01)
    # A voxel is the edge of a cube of its Q-volume: the step on a cubic grid.
    assert r.voxel_edge_q(vol) == pytest.approx(0.1 * 2 * np.pi / 3.9, rel=1e-12)
    # Twice the ellipsoid, twice the voxel it allows.
    wide = _significance(punch_spherical_radii=tuple(2 * x for x in R))
    assert wide.node_test_limit(vol) == pytest.approx(2 * limit, rel=1e-12)
    # A Q-sphere of radius ρ: ρ·∛(7π/6), at any orientation of the cell.
    sphere = _significance(punch_frame="q", punch_q_radius=0.1)
    assert sphere.node_test_limit(vol) == pytest.approx(0.1 * (7 * np.pi / 6) ** (1 / 3))
    # The floor is the test's own constant: twice the floor, a voxel ∛2 smaller.
    assert bragg._SHELL_MIN_VOXELS == 8
    monkeypatch.setattr(bragg, "_SHELL_MIN_VOXELS", 16)
    assert r.node_test_limit(vol) == pytest.approx(limit / 2 ** (1 / 3), rel=1e-12)


def test_the_notice_prints_the_limit_it_derives(monkeypatch):
    """The limit the notice prints is the remover's, from R and the floor, not
    a number written down: a wider R, or a higher floor, prints another, and
    the floor that moves the limit moves the count of nodes not judged too."""
    vol = build(case_named("dev-control"), 81).raw

    def notice(params: PunchParams) -> tuple[str, float]:
        lines: list[str] = []
        punch_bragg(vol, params, progress=lambda stage, status, frac, msg: lines.append(msg or ""))
        return lines[-1].split(". ⚠ ", 1)[1], bragg_remover(params).node_test_limit(vol)

    said, limit = notice(PunchParams())
    assert f"its background shell needs ≤ {limit:.3g} Å⁻¹." in said and f"{limit:.3g}" == "0.143"
    wide = tuple(1.05 * x for x in R)
    said_wide, limit_wide = notice(PunchParams(punch_spherical_radii=wide))
    assert limit_wide == pytest.approx(1.05 * limit) and f"{limit_wide:.3g}" == "0.15"
    assert f"needs ≤ {limit_wide:.3g} Å⁻¹." in said_wide
    monkeypatch.setattr(bragg, "_SHELL_MIN_VOXELS", 16)
    said_16, limit_16 = notice(PunchParams())
    assert f"{limit_16:.3g}" == "0.114" and f"needs ≤ {limit_16:.3g} Å⁻¹." in said_16
    count = int(said.split(". ")[1].split(" of ")[0])
    assert int(said_16.split(". ")[1].split(" of ")[0]) > count


def test_the_notice_in_words():
    """Opens with the grid's reason (GRID_TOO_COARSE), the voxel against what
    the shell needs; says what became of the nodes, by mode; ends on the remedy.
    What may remain is said of the Bragg peaks the search cannot see, not of
    weak ones: at the box's far corners they are strong."""
    assert node_test_notice(703, 728, 0.16111, 0.14332) == (
        "grid too coarse for the Bragg punch's node test: a voxel is 0.161 Å⁻¹; its background "
        "shell needs ≤ 0.143 Å⁻¹. 703 of 728 nodes were not judged and were left to the search "
        "pass; Bragg peaks the search cannot see may remain. Use a finer grid.")
    assert node_test_notice(1, 728, 0.16111, 0.14332) == (
        "grid too coarse for the Bragg punch's node test: a voxel is 0.161 Å⁻¹; its background "
        "shell needs ≤ 0.143 Å⁻¹. 1 of 728 nodes was not judged and was left to the search "
        "pass; Bragg peaks the search cannot see may remain. Use a finer grid.")
    assert node_test_notice(703, 728, 0.16111, 0.14332, left_to_search=False) == (
        "grid too coarse for the Bragg punch's node test: a voxel is 0.161 Å⁻¹; its background "
        "shell needs ≤ 0.143 Å⁻¹. 703 of 728 nodes were judged provisionally, against their "
        "window's median; diffuse maxima at nodes may be punched. Use a finer grid.")
    assert node_test_notice(1, 2, 0.2, 0.143, left_to_search=False).startswith(
        f"{GRID_TOO_COARSE} for the Bragg punch's node test: a voxel is 0.2 Å⁻¹; its background "
        "shell needs ≤ 0.143 Å⁻¹. 1 of 2 nodes was judged provisionally, against its window's")


# ------------------------------------------------- the count, node by node

@pytest.mark.parametrize("node,whole,measured", [
    ((1, 0, 0), 14, 7),     # by the corner of the mask: under the floor
    ((-1, 0, 0), 14, 9),    # by its K face: cut, still 8 or more
    ((0, -1, 0), 14, 14),   # its shell clear of the edge
    ((-1, -1, 0), 10, 10),  # another direction of Q, another count
])
def test_the_shell_count_is_each_nodes_own_and_takes_the_mask(node, whole, measured):
    """On a cubic a = 5.2 Å grid of 0.1 r.l.u. (0.121 Å⁻¹ a voxel, under the
    0.143 limit) the shell at (1, 0, 0) holds 14 voxels: ±1 voxel along each
    axis, four in the plane of ρ̂ and φ̂, four in that of φ̂ and θ̂. The count
    is the node's own: it varies with the direction of Q (10 at (-1, -1, 0)),
    and with the volume measured only where H ≤ 1 and K ≤ 0 it is the shell's
    voxels on that side (7 at (1, 0, 0), under the floor by the mask). Each
    voxel's value is its own index, so the shell is read voxel by voxel."""
    a, step, extent = 5.2, 0.1, 2.0
    n = int(round(2 * extent / step)) + 1
    vol = _grid(a, step, extent, data=np.arange(n ** 3, dtype=np.float64).reshape(n, n, n))
    r = _significance()
    assert r.voxel_edge_q(vol) < r.node_test_limit(vol)
    ax = np.linspace(-extent, extent, n)
    idx = tuple(int(np.argmin(np.abs(ax - v))) for v in node)
    full = r._background_shell(vol, idx)
    assert full is not None and full.size == whole
    hh, kk, _ = np.meshgrid(ax, ax, ax, indexing="ij")
    inside = (hh <= 1 + 1e-9) & (kk <= 1e-9)
    cut = r._background_shell(dataclasses.replace(vol, mask=inside), idx)
    assert cut is not None
    kept = sorted(int(v) for v in full if inside.ravel()[int(v)])
    assert sorted(int(v) for v in cut) == kept and len(kept) == measured
    # The origin has no frame, so no shell.
    centre = tuple(int(np.argmin(np.abs(ax - 0.0))) for _ in range(3))
    assert r._background_shell(vol, centre) is None


def _peak_at_edge(masked: bool) -> HKLVolume:
    """A sharp Bragg peak at (1, 0, 0) and a weaker one at (-1, -1, 0) on a
    flat background with noise, on the grid of the test above; measured only
    where H ≤ 1 and K ≤ 0 when *masked*."""
    a, step, extent = 5.2, 0.1, 2.0
    n = int(round(2 * extent / step)) + 1
    ax = np.linspace(-extent, extent, n)
    hh, kk, ll = np.meshgrid(ax, ax, ax, indexing="ij")
    rng = np.random.default_rng(5)
    data = 1.0 + 0.05 * rng.standard_normal((n, n, n))
    for node, amp in (((1, 0, 0), 20.0), ((-1, -1, 0), 5.0)):
        data += amp * np.exp(-0.5 * ((hh - node[0]) ** 2 + (kk - node[1]) ** 2
                                     + (ll - node[2]) ** 2) / 0.03 ** 2)
    vol = HKLVolume.from_arrays(data, (-extent, extent), (-extent, extent), (-extent, extent),
                                sigma=np.full_like(data, 0.05),
                                ub_matrix=(2 * np.pi / a) * np.eye(3))
    if masked:
        vol = dataclasses.replace(vol, mask=(hh <= 1 + 1e-9) & (kk <= 1e-9))
    return vol


def test_a_node_whose_shell_the_mask_cuts_is_not_judged():
    """The peak at (1, 0, 0) is judged and punched with its whole shell; with
    the mask leaving 7 shell voxels, the node test does not judge it: with
    mode "both" it is left to the search pass (which, the peak being sharp and
    strong, punches it), with mode "integer" judged against its window's
    median, provisionally. The box's faces cut shells too: nodes on them with
    a shell of 7 voxels or fewer are not judged either. On this grid, finer
    than the limit, the punch's log counts them without the grid's ⚠ notice,
    and its record says so (no notice)."""
    def integer_nodes(rem: BraggRemover, vol: HKLVolume) -> set:
        return {_node_of(p) for p in rem._detect_integer(vol, []) if p.source_node_hkl}

    whole = _significance(mode="both")
    assert integer_nodes(whole, _peak_at_edge(False)) == {(1, 0, 0), (-1, -1, 0)}
    report = whole._node_report
    assert report["examined"] == 124 and (1, 0, 0) not in report["nodes"]
    # Under the floor unmasked: nodes on the box's faces (±2 r.l.u.) only.
    assert report["nodes"] and all(2 in np.abs(nd) for nd in report["nodes"])

    edge = _peak_at_edge(True)
    both = _significance(mode="both")
    assert integer_nodes(both, edge) == {(-1, -1, 0)}
    report = both._node_report
    assert report["nodes"] == [(0, 0, 2), (1, 0, 0)] and report["under_floor"] == 2
    assert report["examined"] == 59 and report["left_to_search"] is True
    records = both._detect_peak_records(edge)
    assert {_node_of(p) for p in records} == {(1, 0, 0), (-1, -1, 0)}
    # The search found the peak at (1, 0, 0), in that node's window: its Bragg peak.
    assert {(p.source_node_hkl, p.found_by) for p in records} == {
        ((1, 0, 0), "search"), ((-1, -1, 0), "integer")}

    provisional = _significance(mode="integer")
    assert integer_nodes(provisional, edge) == {(1, 0, 0), (-1, -1, 0)}
    assert provisional._node_report["nodes"] == [(0, 0, 2), (1, 0, 0)]
    assert provisional._node_report["left_to_search"] is False

    lines: list[str] = []
    out = punch_bragg(edge, PunchParams(), progress=lambda s, st, f, m: lines.append(m or ""))
    assert getattr(out, "_bragg_profile")["node_test"] == {
        "examined": 59, "under_floor": 2, "min_voxels": 8, "voxel_q": 0.1208,
        "needs_q": 0.1433, "left_to_search": True, "notice": None}
    (tally,) = [m for m in lines if m.startswith("integer nodes")]
    assert tally.endswith("; 2 of 59 nodes not judged (fewer than 8 measured voxels in the "
                          "background shell), left to the search pass")
    assert not any("⚠" in m for m in lines)


# ------------------------------------------------- known answers, dev cases

@pytest.mark.parametrize("case_id", DEV)
def test_on_the_coarse_dev_grid_no_forbidden_node_is_punched(case_id):
    """At 81 points (0.161 Å⁻¹ a voxel) the node test's shell holds 2 to 6
    voxels at 96 % of the nodes, and the test fell back on the window's
    median: 29 to 125 forbidden nodes punched per case, all diffuse. With the
    guard, no punch (integer node or search peak) sits on a forbidden node.
    The ring cases' planted rings are taken out first, as a ring removal that
    confirmed them would: the ring stage confirms none at this grid (G1), and
    where the node test judges a node on the 4.05 Å⁻¹ ring with a full shell,
    it punches the ring's excess there (on the raw volume, every forbidden
    punch sits on a planted ring)."""
    built = build(case_named(case_id), 81)
    vol = built.raw
    rem = bragg_remover(PunchParams())
    on_rings = []
    if built.rings is not None:
        ub = np.asarray(vol.ub_matrix, dtype=float)
        for rec in rem._detect(vol)[0]:
            node = _node_of(rec)
            if node is not None and _forbidden(node):
                q = float(np.linalg.norm(ub @ np.asarray(rec.center_hkl, dtype=float)))
                on_rings.append(min(abs(q - p) for p in ring_qs(built)))
        assert on_rings and max(on_rings) < 0.05, on_rings
        vol = dataclasses.replace(vol, data=(np.asarray(vol.data, dtype=float) - built.rings)
                                  .astype(vol.data.dtype))
    records = rem._detect(vol)[0]
    forbidden = [n for n in map(_node_of, records) if n is not None and _forbidden(n)]
    assert forbidden == []
    report = rem._node_report
    assert report["under_floor"] > 0.9 * report["examined"] > 0
    # The provisional test, mode "integer", is the test as it was: it punches them.
    old = bragg_remover(PunchParams(mode="integer"))
    assert any(_forbidden(n) for n in map(_node_of, old._detect(vol)[0]) if n is not None)


def test_on_the_coarse_dev_grid_the_punch_says_how_many_nodes_it_left():
    """dev-control at 81 points: of its 728 nodes (9³ − 1, every node within
    ±4 r.l.u. but the origin, each with a measured window) 703 have under 8
    voxels in their background shell. The punch leaves them to the search pass
    and says so: a tally on the integer nodes' line, the ⚠ notice on its done
    line, and its record (the profile JSON) with the same notice. The search
    finds 172 peaks, each in the window of a node left to it: those nodes'
    Bragg peaks, recorded with their node and found_by "search"."""
    vol = build(case_named("dev-control"), 81).raw
    lines: list[str] = []
    out = punch_bragg(vol, PunchParams(), progress=lambda s, st, f, m: lines.append(m or ""))
    notice = node_test_notice(703, 728, 0.16110731556870750, 0.14331761681120767)
    assert notice == (
        "grid too coarse for the Bragg punch's node test: a voxel is 0.161 Å⁻¹; its background "
        "shell needs ≤ 0.143 Å⁻¹. 703 of 728 nodes were not judged and were left to the search "
        "pass; Bragg peaks the search cannot see may remain. Use a finer grid.")
    (tally,) = [m for m in lines if m.startswith("integer nodes")]
    assert tally.endswith(": 8 peaks; 703 of 728 nodes not judged (fewer than 8 measured voxels "
                          "in the background shell), left to the search pass")
    (search,) = [m for m in lines if m.startswith("search floors")]
    assert search.endswith(": 172 peaks, 172 of them the Bragg peaks of nodes the node test "
                           "left to it")
    assert lines[-1].endswith(f" voxels. ⚠ {notice}")
    profile = getattr(out, "_bragg_profile")
    assert profile["node_test"] == {
        "examined": 728, "under_floor": 703, "min_voxels": 8, "voxel_q": 0.1611,
        "needs_q": 0.1433, "left_to_search": True, "notice": notice}
    found = sorted((r["found_by"], r["source_node_hkl"] is not None) for r in profile["peaks"])
    assert found == [("integer", True)] * 8 + [("search", True)] * 172


def test_on_the_coarse_dev_grid_the_profile_is_learned_from_the_searchs_bragg_peaks_too():
    """With 8 peaks from the node test the punch could learn no Bragg profile
    (it needs 20). The search's Bragg peaks at the nodes left to it are learned
    from like the node test's: on dev-control at 81 points the profile stacks
    180 peaks in three |Q| ranges, 172 of them the search's, and the peaks whose
    own width cannot be measured (within 5 voxels of the box's faces) get its
    footprint, not the bare resolution ellipsoid."""
    vol = build(case_named("dev-control"), 81).raw
    lines: list[str] = []
    out = punch_bragg(vol, PunchParams(), progress=lambda s, st, f, m: lines.append(m or ""))
    learned = getattr(out, "_bragg_profile")["footprint_profile"]
    assert learned is not None
    assert learned["n_peaks"] == [58, 54, 68] and learned["from_search"] == 172
    kinds = sorted(r["fit_kind"] for r in getattr(out, "_bragg_profile")["peaks"])
    assert kinds == ["own"] * 90 + ["profile"] * 90
    (own,) = [m for m in lines if m.startswith("own-width punch")]
    assert own == ("own-width punch: 90 of 180 peaks punched to their own measured width, the "
                   "rest to the shared Bragg profile (learned from 180 peaks, 172 of them the "
                   "search's at nodes the node test left to it)")


def test_the_search_peak_in_a_left_nodes_window_is_that_nodes_bragg_peak():
    """On a coarse grid (a = 3.9 Å, 0.1 r.l.u.: 0.161 Å⁻¹ a voxel) the node test
    leaves (1, 0, 0) and (0, 1, 1) to the search. The search's peak in a left
    node's window, the box the node test searches (±2 voxels here), is that
    node's Bragg peak: the brightest only, so a weaker peak 0.2 r.l.u. from
    (1, 0, 0) stays a search peak of its own, as does one between the nodes."""
    a, step, extent = 3.9, 0.1, 2.0
    n = int(round(2 * extent / step)) + 1
    ax = np.linspace(-extent, extent, n)
    hh, kk, ll = np.meshgrid(ax, ax, ax, indexing="ij")
    rng = np.random.default_rng(7)
    data = 1.0 + 0.05 * rng.standard_normal((n, n, n))
    for c, amp in (((1, 0, 0), 20.0), ((1.2, 0, 0), 8.0), ((0, 1, 1), 20.0),
                   ((0.5, 0.5, 0), 20.0)):
        data += amp * np.exp(-0.5 * ((hh - c[0]) ** 2 + (kk - c[1]) ** 2 + (ll - c[2]) ** 2)
                             / 0.03 ** 2)
    vol = HKLVolume.from_arrays(data, (-extent, extent), (-extent, extent), (-extent, extent),
                                sigma=np.full_like(data, 0.05),
                                ub_matrix=(2 * np.pi / a) * np.eye(3))
    r = _significance(mode="both")
    records = r._detect_peak_records(vol)
    assert {(1, 0, 0), (0, 1, 1)} <= set(r._node_report["nodes"])
    assert r._detect_half_widths(vol) == (2, 2, 2)
    found = {tuple(round(x, 2) for x in p.center_hkl): (p.source_node_hkl, p.found_by)
             for p in records}
    assert found == {(1.0, 0.0, 0.0): ((1, 0, 0), "search"),
                     (1.2, 0.0, 0.0): (None, "search"),
                     (0.0, 1.0, 1.0): ((0, 1, 1), "search"),
                     (0.5, 0.5, 0.0): (None, "search")}
    # Without nodes left to it the search claims none.
    assert r._claim_left_nodes(vol, records, []) == records


def test_with_mode_integer_the_nodes_are_judged_provisionally_and_it_says_so():
    """mode="integer" has no search pass to leave a node to: the 703 are judged
    against their window's median, as before the guard, and the notice says
    the verdict is provisional and may punch diffuse maxima at nodes."""
    vol = build(case_named("dev-control"), 81).raw
    lines: list[str] = []
    out = punch_bragg(vol, PunchParams(mode="integer"),
                      progress=lambda s, st, f, m: lines.append(m or ""))
    record = getattr(out, "_bragg_profile")["node_test"]
    assert record["left_to_search"] is False and record["under_floor"] == 703
    assert record["notice"] == node_test_notice(703, 728, 0.1611, 0.1433, left_to_search=False)
    assert "703 of 728 nodes were judged provisionally, against their window's median" in (
        record["notice"])
    (tally,) = [m for m in lines if m.startswith("integer nodes")]
    assert tally.endswith("; 703 of 728 nodes judged provisionally, against the window's median "
                          "(fewer than 8 measured voxels in the background shell)")
    assert lines[-1].endswith(f". ⚠ {record['notice']}")


def _with_broad_maxima(vol: HKLVolume, height: float, fwhm_q: float = 0.3) -> HKLVolume:
    """*vol* with a Gaussian maximum *fwhm_q* Å⁻¹ wide (three times the
    resolution) of *height* at each (1,1,0)-family node."""
    ub = np.asarray(vol.ub_matrix, dtype=float)
    hh, kk, ll = np.meshgrid(vol.h_axis, vol.k_axis, vol.l_axis, indexing="ij")
    add = np.zeros(vol.shape)
    sig = fwhm_q / (2 * np.sqrt(2 * np.log(2)))
    for node in NODES_110:
        dq = np.einsum("ij,j...->i...", ub, np.stack([hh - node[0], kk - node[1], ll - node[2]]))
        add += height * np.exp(-0.5 * (dq ** 2).sum(axis=0) / sig ** 2)
    return dataclasses.replace(vol, data=(np.asarray(vol.data, dtype=float) + add)
                               .astype(vol.data.dtype))


@pytest.mark.parametrize("n", [81, 161])
def test_broad_maxima_at_the_110_nodes_are_not_bragg_peaks(n):
    """Broad maxima (0.3 Å⁻¹ wide, under the search floors) planted at the 12
    (1,1,0)-family nodes of dev-control, where its FCC lattice has no Bragg
    peak. At 81 points the test as it was (mode "integer", provisional)
    punches all 12 against the window's median; with the guard (mode "both")
    none. At 161 points the shell and the width test judge them, and neither
    mode punches one."""
    vol = _with_broad_maxima(build(case_named("dev-control"), n).raw, 1.0)

    def hits(params: PunchParams) -> int:
        return sum(_node_of(r) in NODES_110 for r in bragg_remover(params)._detect(vol)[0])

    assert hits(PunchParams()) == 0
    assert hits(PunchParams(mode="integer")) == (12 if n == 81 else 0)


@pytest.mark.parametrize("case_id", DEV)
def test_on_the_fine_dev_grid_every_node_is_judged(case_id):
    """At 161 points (0.081 Å⁻¹ a voxel) every node's shell holds 9 voxels or
    more, at the box's corners too: the guard judges every node the test
    examines, so the punch's records are the test's as before it, and the punch
    has nothing to say of it (no record, no notice)."""
    from nebula3d.pipeline import _node_test_record

    vol = build(case_named(case_id), 161).raw
    rem = bragg_remover(PunchParams())
    rem._detect_integer(vol, [])
    report = rem._node_report
    assert report["under_floor"] == 0 and report["nodes"] == []
    assert report["examined"] == (116 if case_id == "dev-coverage" else 728)
    assert report["voxel_q"] < report["needs_q"]
    assert _node_test_record(report) is None
