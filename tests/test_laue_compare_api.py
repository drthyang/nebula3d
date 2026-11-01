"""The Laue-class comparison through the API and the in-browser bridge.

``POST /api/volumes/{id}/laue-compare`` and ``webbridge.volume_laue_compare_json``
read the raw volume as the symmetry average (stage 0) reads it — the run's
edge trim first — and compare every candidate class by R_int with the run's
punch cell.  They give the same table, refuse a volume symmetrized already, and
report their progress.
"""

from __future__ import annotations

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

import nebula3d
from nebula3d import pipeline, webbridge
from nebula3d.server import laue
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from tests.test_laue_compare import hex_crystal


@pytest.fixture
def hex_root(tmp_path):
    """A data root whose raw/ holds the 6/m crystal of the comparison's tests."""
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    nebula3d.save(hex_crystal(n_hk=41, n_l=21), tmp_path / "raw" / "hex_6m.nxs")
    laue.clear_cache()
    return tmp_path


def _client(root) -> TestClient:
    return TestClient(create_app(ServerConfig(data_root=root)))


def test_the_endpoint_compares_the_classes_on_the_trimmed_raw_volume(hex_root):
    client = _client(hex_root)
    r = client.post("/api/volumes/hex-6m.raw/laue-compare", json={"params": {}})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["id"] == "hex-6m.raw" and out["volume"] == "hex_6m.nxs"
    assert out["suggestion"] == "6/m" and out["edge_trim"] == 1
    labels = [c["laue"] for c in out["candidates"]]
    assert labels == ["-1", "2/m (c unique)", "-3", "-3m1", "-31m", "6/m", "6/mmm"]
    assert {x["laue"] for x in out["refused"]} >= {"mmm", "m-3m"}
    assert "10%" in out["rule"]["text"] and "Twinning" in out["limits"]
    # The edge trim is the run's: none trims nothing (the volume is fully
    # measured, so the faces are its only edge, and they are none).
    r0 = client.post("/api/volumes/hex-6m.raw/laue-compare", json={"params": {"edge_trim": 0}})
    assert r0.json()["edge_trim"] == 0 and r0.json()["measured"] == out["measured"]


def test_the_punch_cell_sets_the_bragg_nodes(hex_root):
    client = _client(hex_root)
    one = client.post("/api/volumes/hex-6m.raw/laue-compare", json={"params": {}}).json()
    two = client.post("/api/volumes/hex-6m.raw/laue-compare", json={
        "params": {"punch_supercell_h": 2, "punch_supercell_k": 2, "punch_supercell_l": 2}}).json()
    assert one["bragg"]["cell"] == [1, 1, 1] and two["bragg"]["cell"] == [2, 2, 2]
    assert two["bragg"]["voxels"] < one["bragg"]["voxels"]  # an eighth of the nodes
    assert one["bragg"]["radius_q"] == pytest.approx(0.25)


def test_a_bad_edge_trim_is_a_400(hex_root):
    r = _client(hex_root).post("/api/volumes/hex-6m.raw/laue-compare",
                               json={"params": {"edge_trim": -1}})
    assert r.status_code == 400 and "edge_trim takes 0 to 10" in r.json()["detail"]


def test_a_symmetrized_volume_is_refused(hex_root):
    # Stage 0's output declares the class it was averaged over: its
    # equivalents agree by construction.
    params = pipeline.PipelineParams(
        symmetry_average_enabled=True, symmetry_average=pipeline.SymmetryAverageParams(laue="6/m"),
        rings_enabled=False, punch_enabled=False, backfill_enabled=False, flatten_enabled=False)
    pipeline.run_pipeline(hex_root / "raw" / "hex_6m.nxs", params,
                          proc_dir=hex_root / "processed", stages=("symmetry_average",))
    r = _client(hex_root).post("/api/volumes/hex-6m.symmetrized/laue-compare", json={})
    assert r.status_code == 422
    assert "symmetrized already" in r.json()["detail"] and "6/m" in r.json()["detail"]


def test_the_progress_is_polled_under_its_token(hex_root, monkeypatch):
    seen: list[tuple] = []
    real = laue.set_progress

    def record(token, fraction, message, **kw):
        seen.append((token, fraction, message))
        real(token, fraction, message, **kw)

    monkeypatch.setattr(laue, "set_progress", record)
    client = _client(hex_root)
    r = client.post("/api/volumes/hex-6m.raw/laue-compare", json={"token": "t1"})
    assert r.status_code == 200
    assert seen[0][0] == "t1" and seen[-1][1] == 1.0
    assert any("R_int over 6/mmm" in m for _t, _f, m in seen)
    # Finished: nothing left under the token.
    p = client.get("/api/volumes/hex-6m.raw/laue-compare/progress", params={"token": "t1"})
    assert p.json() == {"fraction": None, "message": "", "running": False}


def test_a_repeated_comparison_comes_from_the_cache(hex_root, monkeypatch):
    client = _client(hex_root)
    first = client.post("/api/volumes/hex-6m.raw/laue-compare", json={}).json()
    calls: list[int] = []
    monkeypatch.setattr(laue, "compare_laue_classes",
                        lambda *a, **k: calls.append(1))  # would break if called
    again = client.post("/api/volumes/hex-6m.raw/laue-compare", json={}).json()
    assert again == first and not calls


def test_the_bridge_gives_the_same_table_in_float32(hex_root, tmp_path):
    native = _client(hex_root).post("/api/volumes/hex-6m.raw/laue-compare", json={}).json()
    webbridge.setup(workdir=str(tmp_path / "work"))
    src = tmp_path / "work" / "raw" / "hex_6m.nxs"
    nebula3d.save(nebula3d.load(hex_root / "raw" / "hex_6m.nxs", dtype=None), src)
    ds = "hex-6m"
    assert json.loads(webbridge.select_input(ds)) is True
    ticks: list[tuple[float, str]] = []
    out = json.loads(webbridge.volume_laue_compare_json(
        f"{ds}.raw", "{}", "[]", lambda f, m: ticks.append((f, m))))
    assert out["id"] == f"{ds}.raw" and out["suggestion"] == native["suggestion"] == "6/m"
    for a, b in zip(out["candidates"], native["candidates"]):
        assert a["laue"] == b["laue"]
        for reading in ("all", "diffuse"):
            assert a[reading]["orbits"] == b[reading]["orbits"]
            assert a[reading]["pairs"] == b[reading]["pairs"]
            assert a[reading]["r_int"] == pytest.approx(b[reading]["r_int"], rel=1e-5)
    fractions = [f for f, _ in ticks]
    assert fractions == sorted(fractions) and fractions[-1] == 1.0


def test_the_bridge_compares_the_demo_as_4_mmm(tmp_path):
    webbridge.setup(workdir=str(tmp_path / "work"))
    ds = webbridge.make_demo_input(n=41)
    out = json.loads(webbridge.volume_laue_compare_json(f"{ds}.raw", json.dumps({"edge_trim": 2})))
    assert out["suggestion"] == "4/mmm" and out["edge_trim"] == 2
    m3m = next(c for c in out["candidates"] if c["laue"] == "m-3m")
    assert not m3m["verdict"]["all"]["supported"] and m3m["verdict"]["all"]["rise"] > 1.2
    assert np.isfinite(out["isotropic"]["all"]["ratio"])
