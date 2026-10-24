"""The fills' texture in 3-D on a grid too coarse for the punch's node test (G3).

Where the Bragg punch's record carries its node test's notice (the grid too
coarse for the background shell the node test reads, #83, review finding G2),
the punch left the nodes to its search pass, and the 3-D texture read
(``nebula3d.analysis.fill_texture``, served by ``GET /api/volumes/{id}/texture``
and ``webbridge.volume_texture_json``) judges no fill: ``not_judged`` says
"grid too coarse (the punch's node test could not resolve the holes at this
grid)", whatever room the holes leave their rims.  The notice is read from the
punch's record (``nebula3d.pipeline.read_node_test_notice``); its limit, the
node test's 8-voxel shell floor, is not recomputed.

Known answers on synthetic lattices, and on the validation's dev cases (dev
split only, through the package API) at 81 points a side (0.161 Å⁻¹ a voxel,
over the 0.143 Å⁻¹ the shell needs) and at 161 (0.081 Å⁻¹, under it).
"""

from __future__ import annotations

import json

import numpy as np
import pytest

import nebula3d
from nebula3d.analysis import bragg_fill_texture as bft
from nebula3d.analysis import fill_texture, judge_fill_bias
from nebula3d.pipeline import (
    PipelineParams,
    _node_test_record,
    node_test_notice,
    pipeline_paths,
    read_node_test_notice,
    run_pipeline,
)
from nebula3d.preprocessing import GRID_TOO_COARSE
from nebula3d.server.volumes import volume_texture
from nebula3d.validation import build, case_named, cases
from tests.test_fill_texture import _lattice, _on_grid

DEV = [c.id for c in cases("dev")]
# The punch's own words on the dev crystal at 81 points (#83's notice).
NOTICE = node_test_notice(88, 92, 0.1611, 0.1433)
REASON = "grid too coarse (the punch's node test could not resolve the holes at this grid)"


@pytest.fixture(autouse=True)
def _native(monkeypatch):
    """Native mode: an earlier test's ``webbridge.setup()`` leaves
    ``NEBULA3D_LOW_MEMORY=1`` set (the numbers are the same either way)."""
    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)


def _node_test(voxel_q: float, under_floor: int) -> dict:
    """The punch's record of its node test as the punch writes it
    (``_node_test_record``): 92 nodes examined, the shell's floor 8 voxels,
    the limit 0.1433 Å⁻¹, the nodes under the floor left to the search."""
    return _node_test_record({"examined": 92, "under_floor": under_floor, "min_voxels": 8,
                              "voxel_q": voxel_q, "needs_q": 0.1433, "left_to_search": True})


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------
def test_with_the_punchs_node_test_notice_the_fills_are_not_judged():
    """Fills half the level too high in 80 % of the holes, a systematic bias
    with room for every rim: with the punch's notice the same fills are not
    judged, the reason given, and the holes measured as without it."""
    lat = _lattice(bias=0.5, share=0.8)
    plain = fill_texture(lat.punched, lat.filled, punch_record=lat.record)
    told = fill_texture(lat.punched, lat.filled, punch_record=lat.record,
                        node_test_notice=NOTICE)
    assert (plain.judged, plain.systematic_fill_bias, plain.not_judged) == (True, True, None)
    assert (told.judged, told.systematic_fill_bias, told.not_judged) == (False, False, REASON)
    assert bft.NODE_TEST_TOO_COARSE == REASON and REASON.startswith(GRID_TOO_COARSE)
    # Measured all the same: the holes' facts and the summary are the plain read's.
    for name in ("n_holes", "n_judged", "median_fill_bias_sigma", "median_fill_bias_level",
                 "above_fraction", "below_fraction", "above_floor_fraction",
                 "below_floor_fraction"):
        assert getattr(told, name) == getattr(plain, name), name
    assert np.array_equal(told.holes.bias, plain.holes.bias, equal_nan=True)
    # judge_fill_bias takes the notice as fill_texture passes it; none is the read as before.
    again = judge_fill_bias(plain.holes, node_test_notice=NOTICE)
    assert (again.judged, again.systematic_fill_bias, again.not_judged) == (False, False, REASON)
    for none in (None, ""):
        t = judge_fill_bias(plain.holes, node_test_notice=none)
        assert (t.judged, t.systematic_fill_bias, t.not_judged) == (True, True, None)


def test_the_punchs_node_test_comes_before_the_room_for_the_rims():
    """Nodes 13 voxels apart, holes reaching 3: too coarse for the rims
    (they need 14), and with the punch's notice too coarse for the punch
    first, which the reason names."""
    ks = (-13, 0, 13)
    lat = _lattice(n=61, nodes=[(a, b, c) for a in ks for b in ks for c in ks], radius=3,
                   bias=0.5)
    punched, filled = _on_grid(lat, 13)
    plain = fill_texture(punched, filled, punch_record=lat.record)
    assert plain.not_judged == (f"grid too coarse: the nodes are 13 voxels apart, under 14: "
                                f"a hole reaches 3 voxels and its rim {bft.RIM} more")
    told = fill_texture(punched, filled, punch_record=lat.record, node_test_notice=NOTICE)
    assert (told.judged, told.systematic_fill_bias, told.not_judged) == (False, False, REASON)


def test_the_notice_is_read_from_the_punchs_record(tmp_path):
    """read_node_test_notice reads ``node_test.notice`` from the punch's
    record, the profile JSON the pipeline writes beside the punched stage, as
    the punch wrote it: none without a record, without ``node_test`` (a punch
    from before #83), with a notice of None (nodes under the floor at the
    volume's edge on a grid fine enough for the test), or unreadable."""
    paths = pipeline_paths(tmp_path / "raw" / "x.nxs", proc_dir=tmp_path / "processed")
    paths.bragg_profile_json.parent.mkdir()
    assert paths.bragg_profile_json == paths.braggpunched.with_name(
        f"{paths.braggpunched.stem}_profile.json")
    assert read_node_test_notice(paths.braggpunched) is None
    for record, notice in (({"schema_version": 1, "peaks": []}, None),
                           ({"node_test": None}, None),
                           ({"node_test": _node_test(0.0806, 3)}, None),
                           ({"node_test": _node_test(0.1611, 88)}, NOTICE)):
        paths.bragg_profile_json.write_text(json.dumps(record), encoding="utf-8")
        assert read_node_test_notice(paths.braggpunched) == notice, record
    paths.bragg_profile_json.write_text("{not json", encoding="utf-8")
    assert read_node_test_notice(paths.braggpunched) is None


# ---------------------------------------------------------------------------
# Known answers, dev cases
# ---------------------------------------------------------------------------
def _dev_texture(case_id: str, n: int, root):
    """The default pipeline's ring removal, punch and backfill on the dev
    case at *n* points, and the 3-D read of its fills as the server and the
    browser serve it (every hole listed)."""
    raw = root / "raw" / f"{case_id}.nxs"
    raw.parent.mkdir(parents=True)
    nebula3d.save(build(case_named(case_id), n).raw, raw)
    paths = run_pipeline(raw, PipelineParams(), proc_dir=root / "processed",
                         stages=("rings", "punch", "backfill"))
    return paths, volume_texture(paths.backfilled, paths.braggpunched, limit=1000)


@pytest.mark.parametrize("case_id", DEV)
def test_on_the_coarse_dev_grid_the_fills_are_not_judged(case_id, tmp_path):
    """At 81 points every dev case's punch records that its node test could
    not resolve the nodes, and the 3-D read judges no fill, for that reason.
    Without it the room rule stopped seven of them (their median hole, the
    search's, reaches 2 voxels: 12 needed where the nodes are 10 apart) and
    judged dev-coverage, whose counts end at 4.511 Å⁻¹ before the higher
    nodes: its holes reach 1 voxel at the (111) nodes and 2 at the (200) ones,
    the median 1, so 10 needed, as far as the nodes are apart.  There it read
    a systematic bias above, from rims that rise away from most holes (the
    diffuse turning toward the next nodes inside the rim's 0.4 r.l.u.), not
    from the fills."""
    paths, t = _dev_texture(case_id, 81, tmp_path)
    assert read_node_test_notice(paths.braggpunched)
    assert (t["judged"], t["systematic_fill_bias"], t["not_judged"]) == (False, False, REASON)
    assert t["holes_from"] == "punch_record" and t["n_holes"] == len(t["holes"]) > 0
    rising = np.mean([h["slope"] > 0 for h in t["holes"] if h["slope"] is not None])
    assert rising > 0.8
    if case_id == "dev-coverage":
        assert t["room_needed"] == t["node_spacing"] == 10.0     # room for the rims, by that count
        assert (t["median_fill_bias_sigma"] >= bft.MIN_SIGMA
                and t["median_fill_bias_level"] >= bft.FILL_BIAS_FLOOR
                and t["above_fraction"] >= bft.ONE_WAY)           # the bias it read
    else:
        assert t["room_needed"] > t["node_spacing"] == 10.0


def test_on_the_fine_dev_grid_the_fills_are_judged_as_before(tmp_path):
    """At 161 points the node test resolves every node (#83: no record of it,
    no notice): dev-coverage's fills are judged, its rims falling away from
    their holes, and none is biased (the replays' known answer at 161)."""
    paths, t = _dev_texture("dev-coverage", 161, tmp_path)
    assert read_node_test_notice(paths.braggpunched) is None
    assert (t["judged"], t["systematic_fill_bias"], t["not_judged"]) == (True, False, None)
    assert t["room_needed"] < t["node_spacing"] == 20.0
    assert not any(h["slope"] > 0 for h in t["holes"] if h["slope"] is not None)
