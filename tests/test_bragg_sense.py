"""The pre-run Bragg sensing (THY-43, nebula3d.analysis.bragg_sense).

On synthetic volumes with Bragg peaks of a known shape at the integer nodes of
the 0kl sections (H = 0 and ±1), the sensing must keep the default footprint
for round, axis-aligned peaks; switch to the fitted ellipsoid for tilted,
elongated peaks the axis-aligned default misses the ends of; also drop the
fit's constraints for doublets the capped fit cannot reach; flag a reach that
grows with |Q| (no setting follows it) only where the leftover grows and is
large; ask to declare mmm only where the data were symmetrised already on an
orthorhombic cell and the file declares none; and judge nothing on a grid too
coarse to show a peak's shape. Synthetic data only.
"""

import json
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

import nebula3d
from nebula3d.analysis import bragg_sense as bs
from nebula3d.core import HKLVolume
from nebula3d.pipeline import PipelineParams, PunchParams
from nebula3d.server import bragg as bragg_mod
from nebula3d.server import volumes as vol_mod
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from nebula3d.server.schemas import BraggSenseOut

STEP = 0.05
SPAN = 5.0
# The 0kl sections only: the thin volumes below span H = ±1.05.
OKL = (("0kl", 0.0), ("0kl", 1.0))


def thin(shape, *, cell=(4.5, 4.5, 4.5), step=STEP, span=SPAN, noise=0.01, seed=0,
         symmetrise=False):
    """A volume over H = ±1.05 and K, L = ±span with a peak of *shape* at every
    node of the H = 0 and ±1 planes past |Q| = 1 Å⁻¹, on a flat level with noise."""
    rng = np.random.default_rng(seed)
    h = np.arange(-21, 22) * step
    k = np.arange(-span, span + step / 2, step)
    ub = np.diag([2 * math.pi / c for c in cell])
    kk, ll = np.meshgrid(k, k, indexing="ij")
    data = np.zeros((h.size, k.size, k.size))
    for ih, hv in enumerate(h):
        hn = round(hv)
        if abs(hv - hn) > 0.2:
            continue
        for kn in range(-int(span) + 1, int(span)):
            for ln in range(-int(span) + 1, int(span)):
                q = float(np.linalg.norm(ub @ [hn, kn, ln]))
                if q < 1.0:
                    continue
                data[ih] += shape((kk - kn) / step, (ll - ln) / step, (hv - hn) / step, q)
    data += 1.0 + noise * rng.standard_normal(data.shape)
    if symmetrise:
        data = sum(data[::a, ::b, ::c] for a in (1, -1) for b in (1, -1) for c in (1, -1)) / 8
    return HKLVolume.from_arrays(data, (h[0], h[-1]), (k[0], k[-1]), (k[0], k[-1]), ub_matrix=ub)


def gauss(sx, sy, angle=0.0, amp=5.0):
    """A Gaussian in voxels, its axes sx, sy turned by *angle* degrees in the K–L plane."""
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))

    def f(dk, dl, dh, q):
        u, v = c * dk + s * dl, -s * dk + c * dl
        return amp * np.exp(-0.5 * ((u / sx) ** 2 + (v / sy) ** 2 + dh**2))

    return f


def doublet(width, sep, share, amp=5.0, grows=False):
    """A peak and a lobe *sep* voxels along K holding *share* of it (times
    |Q|/4 when it *grows*)."""

    def f(dk, dl, dh, q):
        g = lambda a, b: np.exp(-0.5 * ((a / width) ** 2 + (b / width) ** 2 + dh**2))  # noqa: E731
        lobe = share * (q / 4.0 if grows else 1.0)
        return amp * (g(dk, dl) + lobe * g(dk - sep, dl))

    return f


def sense(vol, punch=None, declared=False, cuts=bs.CUTS):
    return bs.sense_bragg(vol, punch or PunchParams(), declared=declared, cuts=cuts)


def test_round_axis_aligned_peaks_keep_the_default():
    rec = sense(thin(gauss(0.8, 0.8)), cuts=OKL)
    assert rec["n_nodes"] > 100
    assert rec["evidence"]["tilted_elongated_share"] == 0
    assert rec["evidence"]["multi_lobe_share"] == 0
    pr = rec["prediction"]
    assert (pr["footprint"], pr["drop_fit_constraints"]) == ("own", False)
    assert pr["q_dependent_reach"] is False
    lines = bs.sense_lines(rec)
    assert lines["footprint"].startswith("punchFootprint own (keep)")
    assert "constraints" not in lines and "q" not in lines


def test_tilted_elongated_peaks_ask_for_the_ellipsoid():
    # 45° in the K–L plane, 3.3 : 1, against a noise that stops own's reach short of their ends.
    rec = sense(thin(gauss(2.0, 0.6, 45), noise=0.083), cuts=OKL)
    ev, pr = rec["evidence"], rec["prediction"]
    assert ev["tilted_elongated_share"] > 0.9
    assert ev["median_elongation"] > 3
    assert pr["footprint"] == "ellipsoid"
    # The ellipsoid leaves less than own, and punches no more than AREA_MAX times it.
    assert pr["compared"]["ellipsoid_gain"] >= bs.FOOTPRINT_GAIN
    assert pr["compared"]["ellipsoid_area"] <= bs.AREA_MAX
    assert rec["footprints"]["ellipsoid"]["median_left"] < rec["footprints"]["own"]["median_left"]
    # The sensed peaks, for the Highlights: each tilted, its long axis first.
    flagged = rec["flagged"]
    assert flagged and all(f["tilted"] for f in flagged)
    long, short, _ = flagged[0]["widths"]
    assert long > 2 * short
    dirs = np.array(flagged[0]["dirs"])
    assert np.allclose(dirs @ dirs.T, np.eye(3), atol=1e-3)


def test_doublets_the_capped_fit_cannot_reach_drop_its_constraints():
    rec = sense(thin(doublet(0.7, 3.0, 0.6), noise=0.083), cuts=OKL)
    ev, pr = rec["evidence"], rec["prediction"]
    assert ev["multi_lobe_share"] > 0.8
    assert ev["cap_binds_share"] >= bs.CAP_SHARE
    assert (pr["footprint"], pr["drop_fit_constraints"]) == ("ellipsoid", True)
    lines = bs.sense_lines(rec)
    assert lines["footprint"].startswith("punchFootprint ellipsoid:")
    assert lines["constraints"].startswith("punchFitUnconstrained true:")


def test_never_a_footprint_that_leaves_more_than_the_default():
    # Tilted, but far wider than the cap: the constrained ellipsoid leaves much more than own,
    # and dropping its constraints punches past DROP_AREA_MAX of it.
    rec = sense(thin(gauss(3.0, 1.0, 35)), cuts=OKL)
    pr = rec["prediction"]
    assert rec["evidence"]["tilted_elongated_share"] > 0.9
    assert pr["compared"]["ellipsoid_gain"] < 0
    assert (pr["footprint"], pr["drop_fit_constraints"]) == ("own", False)


def test_a_reach_growing_with_q_is_flagged_where_the_leftover_grows_and_is_large():
    grows = sense(thin(doublet(0.8, 3.5, 0.5, grows=True), noise=0.083), cuts=OKL)
    pr = grows["prediction"]
    assert pr["q_dependent_reach"] is True
    assert pr["compared"]["own_rise"] >= bs.QDEP_RISE
    assert pr["compared"]["own_high_q"] >= bs.QDEP_HIGH
    assert "which no setting follows" in bs.sense_lines(grows)["q"]
    # The same shape at every |Q|: no flag.
    flat = sense(thin(doublet(0.8, 3.5, 0.9), noise=0.083), cuts=OKL)
    assert flat["prediction"]["q_dependent_reach"] is False


def test_symmetrised_data_on_an_orthorhombic_cell_are_asked_to_declare_mmm():
    ortho = (4.5, 5.0, 5.6)
    rec = sense(thin(gauss(0.8, 0.8), cell=ortho, symmetrise=True))
    m = rec["mirrors"]
    assert m["exact"] is True and m["worst_share"] <= bs.MIRROR_EXACT and m["tested"] >= 3
    assert m["declare"] == "mmm"
    assert "declaring mmm is the user's" in bs.sense_lines(rec)["symmetry"]
    # Declared already: nothing to ask.
    declared = sense(thin(gauss(0.8, 0.8), cell=ortho, symmetrise=True), declared=True)
    assert declared["mirrors"]["declare"] is None
    # Not symmetrised: the mirrors differ by the counting noise.
    raw = sense(thin(gauss(0.8, 0.8), cell=ortho))["mirrors"]
    assert raw["exact"] is False and raw["worst_share"] > 100 * bs.MIRROR_EXACT
    assert raw["declare"] is None


def test_a_cell_that_takes_a_higher_class_is_left_to_compare_laue_classes():
    rec = sense(thin(gauss(0.8, 0.8), symmetrise=True))  # cubic: a 4-fold or more may hold
    assert rec["mirrors"]["exact"] is True and rec["mirrors"]["declare"] is None
    assert "compare_laue_classes" in bs.sense_lines(rec)["symmetry"]


def test_a_grid_too_coarse_for_a_peaks_shape_is_not_judged():
    rec = sense(thin(gauss(0.8, 0.8), step=0.1, span=4.0))
    assert rec["not_judged"].startswith("grid too coarse")
    assert rec["prediction"] is None and rec["n_nodes"] == 0
    assert bs.sense_lines(rec)["shape"].startswith("grid too coarse")


def test_the_footprints_are_modelled_with_the_runs_punch_settings():
    vol = thin(gauss(2.0, 0.6, 45), noise=0.083)
    base = sense(vol, cuts=OKL)
    # A larger margin punches more with every footprint: each leaves less.
    wide = sense(vol, PunchParams(margin=0.06), cuts=OKL)
    for name in bs.FOOTPRINTS:
        assert wide["footprints"][name]["median_left"] < base["footprints"][name]["median_left"]


def _raw_root(tmp_path, vol, stem="sense_test_cc"):
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    nebula3d.save(vol, tmp_path / "raw" / f"{stem}.nxs")
    return f"{stem.replace('_', '-')}.raw"


def test_the_api_serves_the_sensing_of_the_raw_volume(tmp_path):
    vid = _raw_root(tmp_path, thin(gauss(0.8, 0.8), cell=(4.5, 5.0, 5.6), symmetrise=True))
    vol_mod.clear_cache()
    bragg_mod._sense_cache.clear()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    r = client.post(f"/api/volumes/{vid}/bragg-sense", json={"params": {}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == set(BraggSenseOut.model_fields)
    assert body["prediction"]["footprint"] == "own"
    assert body["mirrors"]["declare"] == "mmm"
    assert set(body["lines"]) >= {"shape", "left", "footprint", "symmetry"}
    # Cached: the same record again; another punch setting senses again.
    assert client.post(f"/api/volumes/{vid}/bragg-sense", json={"params": {}}).json() == body
    other = client.post(f"/api/volumes/{vid}/bragg-sense",
                        json={"params": {"punch_margin": 0.06}}).json()
    assert other["footprints"] != body["footprints"]
    assert client.post("/api/volumes/nope.raw/bragg-sense", json={"params": {}}).status_code == 404


def test_the_browser_bridge_senses_as_the_server_does(tmp_path, monkeypatch):
    from nebula3d import webbridge

    vid = _raw_root(tmp_path, thin(doublet(0.7, 3.0, 0.6), noise=0.083))
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "0")
    vol_mod.clear_cache()
    bragg_mod._sense_cache.clear()
    served = TestClient(create_app(ServerConfig(data_root=tmp_path))).post(
        f"/api/volumes/{vid}/bragg-sense", json={"params": {}}).json()
    bragg_mod._sense_cache.clear()
    webbridge.setup(workdir=str(tmp_path))
    bridged = json.loads(webbridge.volume_bragg_sense_json(vid, "{}"))
    assert set(bridged) == set(BraggSenseOut.model_fields)
    # float32 in the browser: the same prediction, the shares within rounding.
    assert bridged["prediction"]["footprint"] == served["prediction"]["footprint"]
    drop = "drop_fit_constraints"
    assert bridged["prediction"][drop] == served["prediction"][drop]
    assert bridged["n_nodes"] == served["n_nodes"]
    for name in bs.FOOTPRINTS:
        assert bridged["footprints"][name]["median_left"] == pytest.approx(
            served["footprints"][name]["median_left"], abs=2e-3)
    with pytest.raises(KeyError):
        webbridge.volume_bragg_sense_json("nope.raw", "{}")


def test_the_run_loads_the_volume_the_sensing_reads():
    # The sensing reads the raw volume as the run loads it: its edge trim takes the coverage edge.
    vol = thin(gauss(0.8, 0.8))
    p = PipelineParams()
    assert p.edge_trim >= 1
    assert sense(vol)["sections"][0]["plane"] == "0kl"
