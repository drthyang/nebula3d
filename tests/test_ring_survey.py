"""The pre-run powder ring survey (THY-43, nebula3d.preprocessing.ring_survey).

On synthetic volumes (tests/powder_phase_volumes.py: textured rings of
library phases on a falling background with noise, half the sphere past
5.5 Å⁻¹ unmeasured), the survey must label the sample environment's Al lines
with their hkl, name another phase's rings as a possibility, flag a ring no
line explains with its |Q| and strength, and flag nothing on a volume with no
ring. It is the ring stage's detection as a dry run: the same shells,
verdicts, Al lattice and phase record as the stage on the same volume, the
volume left as it was.
"""

import dataclasses
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

import nebula3d
from nebula3d import pipeline
from nebula3d.preprocessing import PooledRingConfig, fit_pooled_rings, ring_isotropy
from nebula3d.preprocessing.ring_survey import CODES, survey_lines, survey_rings
from nebula3d.server import volumes as vol_mod
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from nebula3d.server.schemas import RingSurveyOut

from .powder_phase_volumes import phase_volume

AL = (-0.004, 1.0)
CFG = PooledRingConfig(q_max=7.0)
UNKNOWN_Q = 3.60
SAMPLE = "synthetic_20K.nxs"


def _survey(vol, cfg=CFG):
    return survey_rings(vol, cfg, sample=SAMPLE)


def _codes(rec):
    return [r["code"] for r in rec["rings"]]


@pytest.fixture(scope="module")
def al_only():
    vol, _ = phase_volume({"Al": AL}, seed=5)
    return vol, _survey(vol)


@pytest.fixture(scope="module")
def al_bi():
    vol, _ = phase_volume({"Al": AL, "Bi": (-0.004, 0.12)}, seed=5)
    return vol, _survey(vol)


@pytest.fixture(scope="module")
def al_unknown():
    vol, _ = phase_volume({"Al": AL}, extra=[(UNKNOWN_Q, 0.25)], seed=5)
    return vol, _survey(vol)


def test_al_rings_are_labelled_with_their_lines(al_only):
    _vol, rec = al_only
    assert rec["al_lattice_a"] == pytest.approx(4.0495 * (1 - 0.004), abs=0.004)
    al = [r for r in rec["rings"] if r["code"] == "AL"]
    assert [r["line"] for r in al][:4] == ["Al111", "Al200", "Al220", "Al311"]
    assert all(r["removed"] and r["ring"] for r in al)
    assert set(_codes(rec)) == {"AL"}
    lines = survey_lines(rec)
    assert lines["al"].startswith("a=4.03") and "111 2.69, 200 3.10" in lines["al"]
    assert lines["phases"] is None and lines["unrecognized"] == "none"
    assert lines["removal"] == f"would remove {len(al)} (Al {len(al)}); keep 0"


def test_another_phases_rings_are_a_possibility_with_their_evidence(al_bi):
    _vol, rec = al_bi
    bi = [r for r in rec["rings"] if r["code"] == "PH"]
    assert bi and all(r["phase"] == "Bi" and r["line"].startswith("Bi") for r in bi)
    assert bi[0]["line"] == "Bi012" and bi[0]["removed"]
    assert rec["phase_summary"].startswith("likely Bi flux") or rec["phase_summary"].startswith(
        "possibly Bi flux")
    assert "scale -0.4 %" in rec["phase_summary"]
    lines = survey_lines(rec)
    assert lines["phases"] == rec["phase_summary"] and lines["unrecognized"] == "none"
    assert "phase 1" in lines["removal"]


def test_a_ring_no_line_explains_is_flagged_with_its_q_and_strength(al_unknown):
    _vol, rec = al_unknown
    unk = [r for r in rec["rings"] if r["code"] == "UNK"]
    assert len(unk) == 1 and unk[0]["q"] == pytest.approx(UNKNOWN_Q, abs=0.03)
    assert unk[0]["ring"] and unk[0]["removed"] and unk[0]["snr"] > 20
    lines = survey_lines(rec)
    assert lines["unrecognized"].startswith("3.59 (snr ") or lines["unrecognized"].startswith(
        "3.60 (snr ")
    assert lines["unrecognized"].endswith(", removed)")
    assert "unrecognized 1" in lines["removal"]


@pytest.mark.parametrize("diffuse", [(), ((2.2, 0.3), (3.45, 0.25), (4.6, 0.25))])
def test_a_volume_with_no_ring_flags_nothing(diffuse):
    # Noise on a falling background, and the crystal's own diffuse shells,
    # which rise in some directions only: no Al, no phase, no ring flagged.
    vol, _ = phase_volume({}, diffuse=diffuse, seed=2)
    rec = _survey(vol)
    assert rec["al_lattice_a"] is None
    assert not {"AL", "PH", "UNK", "GRID", "NJ"} & set(_codes(rec))
    assert rec["phase_summary"] is None
    lines = survey_lines(rec)
    assert (lines["al"], lines["phases"], lines["unrecognized"]) == (
        "no Al lattice fitted", None, "none")
    assert "unconfirmed" not in lines and lines["removal"].startswith("would remove 0;")


def test_the_survey_is_the_ring_stages_detection_and_removes_nothing(al_bi):
    vol, rec = al_bi
    before = (vol.data.copy(), vol.mask.copy())
    again = _survey(vol)
    np.testing.assert_array_equal(vol.data, before[0])
    np.testing.assert_array_equal(vol.mask, before[1])
    fit = fit_pooled_rings(dataclasses.replace(vol, data=vol.data.copy(), mask=vol.mask.copy()),
                           CFG, sample=SAMPLE).diagnostics
    assert again["al_lattice_a"] == pytest.approx(fit["al_lattice_a"], abs=1e-5)
    assert [r["q"] for r in again["rings"] if r["removed"]] == [
        round(s["q_center"], 4) for s in fit["shells"]]
    stage_lines = {round(s["q_center"], 4): s.get("match", {}).get("hkl") for s in fit["shells"]}
    for r in again["rings"]:
        if r["removed"] and r.get("line"):
            assert r["line"].endswith(str(stage_lines[r["q"]]))
    assert json.dumps(again["phases"], sort_keys=True) == json.dumps(fit["powder_phases"],
                                                                     sort_keys=True)
    assert set(_codes(again)) <= set(CODES)
    assert again["dry_run"] is True and again["timing_s"]["total"] > 0


def test_the_survey_reads_the_ring_stages_settings():
    p = pipeline.RingParams(slice_axis="L", q_max=7.0, pooled_min_snr=8.0)
    cfg = pipeline.pooled_ring_config(p)
    assert (cfg.plane, cfg.q_max, cfg.min_snr) == ("hk0", 7.0, 8.0)
    assert cfg.isotropy.direction_share == p.pooled_ring_direction_share


def test_the_slabs_on_threads_judge_as_in_turn(al_unknown, monkeypatch):
    # The 3D test reads its slabs on threads natively: the same verdicts as
    # one slab at a time, and the same sort of its cells' values.
    vol, rec = al_unknown
    monkeypatch.setenv("NEBULA3D_RING_THREADS", "1")
    serial = _survey(vol)
    for r in (rec, serial):
        r.pop("timing_s")
    assert json.dumps(serial, sort_keys=True) == json.dumps(rec, sort_keys=True)
    rng = np.random.default_rng(0)
    key = rng.integers(0, 5000, 2_000_000).astype(np.int32)
    val = rng.normal(size=key.size).astype(np.float32)
    count = np.bincount(key, minlength=5000)
    for workers in (1, 3, 8):
        np.testing.assert_array_equal(ring_isotropy._sorted_by_key(key, val, count, workers),
                                      val[np.lexsort((val, key))])


def test_the_api_serves_the_survey_of_the_raw_volume(tmp_path):
    vol, _ = phase_volume({"Al": AL}, extra=[(UNKNOWN_Q, 0.25)], seed=5, step=0.12)
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    stem = "survey_20K_test_cc"
    nebula3d.save(vol, tmp_path / "raw" / f"{stem}.nxs")
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    r = client.get(f"/api/volumes/{stem.replace('_', '-')}.raw/ring-survey")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == set(RingSurveyOut.model_fields)
    assert (body["slice_axis"], body["edge_trim"], body["dry_run"]) == ("H", 1, True)
    assert body["al_lattice_a"] is not None and body["lines"]["al"].startswith("a=")
    assert "AL" in _codes(body)
    # Cached: the same record again, without a second survey.
    assert client.get(f"/api/volumes/{stem.replace('_', '-')}.raw/ring-survey").json() == body
    for bad in ({"slice_axis": "Q"}, {"edge_trim": 11}):
        bad_r = client.get(f"/api/volumes/{stem.replace('_', '-')}.raw/ring-survey", params=bad)
        assert bad_r.status_code in (400, 422)


def test_the_browser_bridge_surveys_as_the_server_does(tmp_path, monkeypatch):
    # The in-browser build's survey (float32, low-memory mode, no threads)
    # finds what the native server finds: the same shells, labels and lines.
    from nebula3d import webbridge

    vol, _ = phase_volume({"Al": AL, "Bi": (-0.004, 0.12)}, extra=[(UNKNOWN_Q, 0.25)],
                          seed=5, step=0.12)
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    stem = "survey_20K_test_cc"
    nebula3d.save(vol, tmp_path / "raw" / f"{stem}.nxs")
    vid = f"{stem.replace('_', '-')}.raw"
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "0")  # native; restored after the test
    vol_mod.clear_cache()
    vol_mod._survey_cache.clear()
    served = TestClient(create_app(ServerConfig(data_root=tmp_path))).get(
        f"/api/volumes/{vid}/ring-survey").json()
    vol_mod._survey_cache.clear()
    webbridge.setup(workdir=str(tmp_path))  # low-memory mode, as in the browser
    bridged = json.loads(webbridge.volume_ring_survey_json(vid))
    assert set(bridged) == set(RingSurveyOut.model_fields)

    def shells(rec, codes):
        return [(r["code"], r.get("line"), r["removed"], r["q"]) for r in rec["rings"]
                if r["code"] in codes]

    # The shells it flags alike; a shell neither engine finds a ring may fail
    # another criterion of the 3D test in low-memory mode, which judges a
    # faint shell on a sample of its voxels (XTAL or NR).
    flagged = ("AL", "PH", "UNK", "GRID", "NJ")
    assert [s[:3] for s in shells(bridged, flagged)] == [s[:3] for s in shells(served, flagged)]
    every = flagged + ("XTAL", "NR")
    assert np.allclose([s[3] for s in shells(bridged, every)],
                       [s[3] for s in shells(served, every)], atol=0.01)
    assert bridged["al_lattice_a"] == pytest.approx(served["al_lattice_a"], abs=1e-3)
    assert {k: v for k, v in bridged["lines"].items() if k != "al"} == {
        k: v for k, v in served["lines"].items() if k != "al"}
    with pytest.raises(KeyError):
        webbridge.volume_ring_survey_json("nope.raw")


def test_the_slab_threads_keep_to_their_memory_budget(monkeypatch):
    # One thread in low-memory mode (the browser); natively as many as the
    # CPUs, the cap and the budget allow: a big slab gets fewer.
    monkeypatch.delenv("NEBULA3D_RING_THREADS", raising=False)
    assert ring_isotropy._slab_workers(40, True, 1000) == 1
    assert ring_isotropy._slab_workers(1, False, 1000) == 1
    cpus = ring_isotropy.os.cpu_count() or 1
    assert ring_isotropy._slab_workers(40, False, 1000) == min(8, cpus)
    big = ring_isotropy._SLAB_BUDGET // ring_isotropy._SLAB_BYTES_PER_VOXEL // 2
    assert ring_isotropy._slab_workers(40, False, big) == min(2, cpus)
    monkeypatch.setenv("NEBULA3D_RING_THREADS", "3")
    assert ring_isotropy._slab_workers(40, False, 1000) == min(3, cpus)
