"""End-to-end test of the in-browser bridge (:mod:`nebula3d.webbridge`).

Exercises the same code path the Pyodide build uses — minus Pyodide itself —
on a tiny synthetic volume: set up the virtual workspace, run the full pipeline,
then pull the dataset listing, HKL/ΔPDF/consistency metadata, and binary slice
envelopes, asserting they have the shapes the React viewers decode.

The bridge must stay importable without FastAPI (it runs under Pyodide), so the
import itself is part of the contract under test.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

import nebula3d
from nebula3d import webbridge


def _decode_envelope(buf: bytes) -> tuple[dict, np.ndarray]:
    """Decode [uint32 header_len][JSON header][float32 data] (the wire format)."""
    (header_len,) = struct.unpack_from("<I", buf, 0)
    header = json.loads(buf[4 : 4 + header_len].decode("utf-8"))
    data = np.frombuffer(buf[4 + header_len :], dtype="<f4")
    return header, data


def test_webbridge_imports_without_fastapi():
    """The bridge (and the server helpers it reuses) must not import FastAPI.

    Run in a fresh interpreter: FastAPI is unavailable under Pyodide, so dragging
    it in transitively would break the in-browser build.  A subprocess isolates
    this from other tests in the suite (e.g. test_server) that do import FastAPI.
    """
    code = (
        "import sys; import nebula3d.webbridge; "
        "assert 'fastapi' not in sys.modules, sorted(sys.modules)"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True,
                          text=True)
    assert proc.returncode == 0, proc.stderr


@pytest.fixture
def ran_pipeline(tmp_path):
    """Run the full pipeline once on a synthetic volume in a temp workspace."""
    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=25)

    events: list[tuple] = []

    def progress(stage, status, fraction, message):
        events.append((stage, status, fraction, message))

    datasets_json = webbridge.run(
        "", "{}", flatten_enabled=True, force=True, progress=progress)
    return dataset_id, json.loads(datasets_json), events


def test_demo_input_is_labelled_synthetic_and_stored_float32(tmp_path):
    """The demo must never pass for measured data, and is stored in the
    precision the browser computes in (half the MEMFS / heap of float64)."""
    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=9)
    assert dataset_id == "synthetic-rocksalt"
    (raw,) = (tmp_path / "work" / "raw").glob("*.nxs")
    assert raw.name == "synthetic_rocksalt.nxs"
    vol = nebula3d.load(raw, dtype=None)
    assert vol.data.dtype == np.float32 and vol.sigma.dtype == np.float32


def test_select_input_runs_the_named_dataset_not_the_last_loaded(tmp_path):
    """With two volumes loaded, a run reduces the one the UI names; a dataset
    the workspace does not hold (the worker was restarted) reports false so
    the engine reloads it."""
    webbridge.setup(workdir=str(tmp_path / "work"))
    demo_id = webbridge.make_demo_input(n=9)
    demo_raw = tmp_path / "work" / "raw" / "synthetic_rocksalt.nxs"
    other_id = webbridge.load_input("other_sample.nxs", str(demo_raw))
    assert webbridge._S.input.name == "other_sample.nxs"

    assert json.loads(webbridge.select_input(demo_id)) is True
    assert webbridge._S.input == demo_raw
    assert webbridge._S.dataset_id == demo_id

    assert json.loads(webbridge.select_input(other_id)) is True
    assert webbridge._S.input.name == "other_sample.nxs"

    webbridge.setup(workdir=str(tmp_path / "fresh"))
    assert json.loads(webbridge.select_input(demo_id)) is False


def test_run_streams_progress_for_every_stage(ran_pipeline):
    _id, _datasets, events = ran_pipeline
    stages_seen = {ev[0] for ev in events}
    # Every pipeline stage should have emitted at least one progress event.
    assert set(webbridge.run.__globals__["STAGES"]).issubset(stages_seen)
    assert any(status == "done" for _s, status, _f, _m in events)


def test_datasets_listing_has_all_stages(ran_pipeline):
    dataset_id, datasets, _events = ran_pipeline
    assert len(datasets) == 1
    ds = datasets[0]
    assert ds["id"] == dataset_id
    assert ds["temperature"] is None
    by_name = {s["name"]: s for s in ds["stages"]}
    for stage in ("raw", "ringremoved", "braggpunched", "backfilled",
                  "flattened", "delta_pdf"):
        assert stage in by_name, stage
        assert by_name[stage]["volume_id"] == f"{dataset_id}.{stage}"
    # The cleanup stages and the ΔPDF should all exist on disk after the run.
    assert by_name["ringremoved"]["exists"]
    assert by_name["delta_pdf"]["exists"]
    assert by_name["delta_pdf"]["kind"] == "delta_pdf"
    # Each output is dated, in the order the run wrote them; the raw input,
    # which no stage writes, is not.
    assert by_name["raw"]["mtime"] is None
    assert by_name["ringremoved"]["mtime"] <= by_name["delta_pdf"]["mtime"]
    # The ΔPDF says which output it was made from (its file records it).
    assert by_name["delta_pdf"]["source"] in ("flattened", "backfilled")
    assert by_name["backfilled"]["source"] is None


def test_hkl_meta_and_slice(ran_pipeline):
    dataset_id, _datasets, _events = ran_pipeline
    vid = f"{dataset_id}.ringremoved"
    meta = json.loads(webbridge.volume_meta_json(vid))
    assert meta["id"] == vid
    assert meta["kind"] == "hkl"
    assert meta["shape"] == [25, 25, 25]
    assert "hk" in meta["planes"]

    env = webbridge.volume_slice(vid, "hk", 0.0, False)
    header, data = _decode_envelope(bytes(env))
    assert header["nx"] * header["ny"] == data.size
    assert header["ny"] == 25 and header["nx"] == 25


def test_dpdf_meta_and_slice(ran_pipeline):
    dataset_id, _datasets, _events = ran_pipeline
    vid = f"{dataset_id}.delta_pdf"
    meta = json.loads(webbridge.dpdf_meta_json(vid))
    assert meta["id"] == vid
    assert len(meta["shape"]) == 3
    assert set(meta["planes"]) == {"xy", "xz", "yz"}

    env = webbridge.dpdf_slice(vid, "xy", 0.0)
    header, data = _decode_envelope(bytes(env))
    assert header["nx"] * header["ny"] == data.size
    assert header["robust_max"] > 0


def test_dpdf_features_json(ran_pipeline):
    from nebula3d.server.schemas import DpdfFeatureGroupOut, DpdfFeaturesOut

    dataset_id, _datasets, _events = ran_pipeline
    vid = f"{dataset_id}.delta_pdf"
    f = json.loads(webbridge.dpdf_features_json(vid, 5.0, 4))
    assert f["id"] == vid and f["min_sigma"] == 5.0
    assert 0 < len(f["groups"]) <= 4
    assert all(g["size_sigma"] >= 5.0 and g["length"] >= f["origin_radius"] for g in f["groups"])
    # The fields the server's response has, no more and no fewer.
    assert set(f) == set(DpdfFeaturesOut.model_fields)
    assert all(set(g) == set(DpdfFeatureGroupOut.model_fields) for g in f["groups"])
    # The demo's raw file declares no symmetry.
    assert f["grouped_by"] == "sign, length and size (no symmetry declared)"
    with pytest.raises(ValueError):
        webbridge.dpdf_features_json(vid, 0.0, 4)


@pytest.mark.parametrize("declared", [True, False])
def test_dpdf_features_json_is_the_servers_response(tmp_path, declared):
    """The browser build's features are the native server's, field for field,
    with the raw file declaring m-3m and declaring nothing."""
    from fastapi.testclient import TestClient

    from nebula3d.server.app import create_app
    from nebula3d.server.config import ServerConfig
    from tests.test_dpdf_features import M3M, write_declared_dataset

    write_declared_dataset(tmp_path, "sample_cubic", ("m-3m", M3M) if declared else None)
    vid = "sample-cubic.delta_pdf"
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    served = client.get(f"/api/deltapdf/{vid}/features", params={"min_sigma": 8, "limit": 30})
    assert served.status_code == 200, served.text
    webbridge.setup(workdir=str(tmp_path))
    bridged = json.loads(webbridge.dpdf_features_json(vid, 8.0, 30))
    assert bridged == served.json()
    assert bridged["grouped_by"].startswith("declared symmetry (m-3m" if declared else "sign,")


def test_volume_shell_floors_json_is_the_servers_response(tmp_path, monkeypatch):
    """The browser build's whole-volume shell floors are the native server's,
    field for field: computed natively by the server and in low-memory mode
    by the bridge, as in the browser."""
    from fastapi.testclient import TestClient

    from nebula3d.server import volumes as vol_mod
    from nebula3d.server.app import create_app
    from nebula3d.server.config import ServerConfig
    from nebula3d.server.schemas import ShellFloorsOut
    from tests.test_server import SLUG, write_flatten_stages

    write_flatten_stages(tmp_path)
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    for vid, settings in ((f"{SLUG}.flattened", {}),
                          (f"{SLUG}.flattened", {"percentile": 10.0, "q_step": 0.1,
                                                 "min_count": 5}),
                          (f"{SLUG}.backfilled", {})):
        monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "0")  # native; restored after the test
        vol_mod.clear_cache()
        served = client.get(f"/api/volumes/{vid}/shell-floors", params=settings)
        assert served.status_code == 200, served.text
        vol_mod.clear_cache()  # the bridge computes its own
        webbridge.setup(workdir=str(tmp_path))  # low-memory mode, as in the browser
        bridged = json.loads(webbridge.volume_shell_floors_json(vid, **settings))
        assert bridged == served.json()
        assert set(bridged) == set(ShellFloorsOut.model_fields)
    assert bridged["before_id"] is None
    flattened = json.loads(webbridge.volume_shell_floors_json(f"{SLUG}.flattened"))
    assert flattened["before_id"] == f"{SLUG}.backfilled"
    with pytest.raises(ValueError):
        webbridge.volume_shell_floors_json(f"{SLUG}.flattened", percentile=101.0)
    with pytest.raises(KeyError):
        webbridge.volume_shell_floors_json("nope.flattened")


def test_volume_texture_json_is_the_servers_response(tmp_path, monkeypatch):
    """The browser build's fill texture over every punch hole is the native
    server's, field for field: computed natively by the server and in
    low-memory mode by the bridge, as in the browser."""
    from fastapi.testclient import TestClient

    from nebula3d.pipeline import pipeline_paths
    from nebula3d.server import volumes as vol_mod
    from nebula3d.server.app import create_app
    from nebula3d.server.config import ServerConfig
    from nebula3d.server.schemas import TextureOut
    from tests.test_server import SLUG, STEM, write_texture_stages

    write_texture_stages(tmp_path, n=61, bias=0.5, share=0.8)
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    vid = f"{SLUG}.backfilled"
    for params in ({}, {"limit": 5, "floor": 0.6, "one_way": 0.5},
                   {"limit": 0, "min_holes": 30, "min_sigma": 2.0}):
        monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "0")  # native; restored after the test
        vol_mod.clear_cache()
        served = client.get(f"/api/volumes/{vid}/texture", params=params)
        assert served.status_code == 200, served.text
        vol_mod.clear_cache()  # the bridge computes its own
        webbridge.setup(workdir=str(tmp_path))  # low-memory mode, as in the browser
        bridged = json.loads(webbridge.volume_texture_json(vid, **params))
        assert bridged == served.json()
        assert set(bridged) == set(TextureOut.model_fields)
    assert bridged["holes"] == [] and not bridged["judged"]  # 27 holes, 30 asked for
    with pytest.raises(ValueError):
        webbridge.volume_texture_json(vid, one_way=1.5)
    with pytest.raises(ValueError):
        webbridge.volume_texture_json(vid, limit=-1)
    with pytest.raises(ValueError, match="backfilled"):
        webbridge.volume_texture_json(f"{SLUG}.braggpunched")
    with pytest.raises(KeyError):
        webbridge.volume_texture_json("nope.backfilled")
    pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs",
                   proc_dir=tmp_path / "processed").braggpunched.unlink()
    with pytest.raises(FileNotFoundError):
        webbridge.volume_texture_json(vid)


def test_consistency_meta_and_slice(ran_pipeline):
    dataset_id, _datasets, _events = ran_pipeline
    meta = json.loads(webbridge.consistency_meta_json(dataset_id))
    assert "metrics" in meta
    assert "pearson_r" in meta["metrics"]
    assert len(meta["shape"]) == 3

    # The reciprocal panels slice on HKL planes; the ΔPDF panel on real-space ones.
    for panel, plane in (("data", "hk"), ("recon", "hk"), ("residual", "hk"),
                         ("dpdf", "xy")):
        env = webbridge.consistency_slice(dataset_id, panel, plane, 0.0)
        header, data = _decode_envelope(bytes(env))
        assert header["nx"] * header["ny"] == data.size


def test_consistency_check_json(ran_pipeline):
    """The run's saved check is what the pipeline logged, read without an FFT."""
    dataset_id, _datasets, events = ran_pipeline
    check = json.loads(webbridge.consistency_check_json(dataset_id))
    assert check["dataset_id"] == dataset_id
    assert check["has_check"] is True
    r = check["metrics"]["pearson_r"]
    logged = [m for s, st, _f, m in events if s == "pdf_check" and st == "done"]
    assert logged and f"r={r:.5f}" in logged[-1]
    with pytest.raises(KeyError):
        webbridge.consistency_check_json("nope")


def test_unknown_volume_raises(ran_pipeline):
    with pytest.raises(KeyError):
        webbridge.volume_meta_json("nope.ringremoved")


def test_bragg_profile_json(ran_pipeline):
    dataset_id, _datasets, _events = ran_pipeline
    prof = json.loads(webbridge.bragg_profile_json(dataset_id))
    assert prof["dataset_id"] == dataset_id
    assert prof["has_profile"] is True
    assert prof["n_peaks"] == len(prof["peaks"]) > 0
    assert prof["width_labels"]


def test_bragg_profile_json_missing_file(ran_pipeline):
    from pathlib import Path

    dataset_id, _datasets, _events = ran_pipeline
    prof = json.loads(webbridge.bragg_profile_json(dataset_id))
    Path(prof["profile_path"]).unlink()
    prof2 = json.loads(webbridge.bragg_profile_json(dataset_id))
    assert prof2["has_profile"] is False
    assert prof2["peaks"] == []


def test_bragg_profile_json_unknown_dataset(ran_pipeline):
    with pytest.raises(KeyError):
        webbridge.bragg_profile_json("nope")


def test_ring_diagnostics_json_is_the_servers_response(tmp_path):
    """The ring removal's record in the browser build is the native server's,
    field for field. The demo on 41 points over ±4 r.l.u. (0.3 Å⁻¹ a voxel):
    the rings the pooled model detected and could not confirm on that grid,
    with the notice its run log line ends on (G1)."""
    from fastapi.testclient import TestClient

    from nebula3d.server.app import create_app
    from nebula3d.server.config import ServerConfig
    from nebula3d.server.schemas import RingDiagnosticsOut

    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=41)
    events: list[tuple] = []
    webbridge.run("rings", "{}", flatten_enabled=True, force=True,
                  progress=lambda *ev: events.append(ev))
    bridged = json.loads(webbridge.ring_diagnostics_json(dataset_id))
    client = TestClient(create_app(ServerConfig(data_root=tmp_path / "work")))
    served = client.get(f"/api/rings/{dataset_id}/diagnostics")
    assert served.status_code == 200, served.text
    assert bridged == served.json()
    assert set(bridged) == set(RingDiagnosticsOut.model_fields)
    left = bridged["unconfirmed_at_grid"]
    assert bridged["has_diagnostics"] is True and left["count"] > 0
    (done,) = [m for stage, status, _f, m in events if stage == "rings" and status == "done"]
    assert done.endswith(f". ⚠ {left['notice']}")
    with pytest.raises(KeyError):
        webbridge.ring_diagnostics_json("nope")


def test_ring_diagnostics_json_without_a_ring_left(ran_pipeline):
    """On the run's 25 points (0.5 Å⁻¹ a voxel) the pooled model detects no
    shell: its record has none left unconfirmed, and its log no notice."""
    dataset_id, _datasets, events = ran_pipeline
    record = json.loads(webbridge.ring_diagnostics_json(dataset_id))
    assert record["has_diagnostics"] is True and record["unconfirmed_at_grid"] is None
    (done,) = [m for stage, status, _f, m in events if stage == "rings" and status == "done"]
    assert "⚠" not in done


def test_volume_ub_check_json(tmp_path):
    """The UB check through the bridge, on the demo crystal (a = 4.2 Å, its UB
    right): no symmetry declared, so the rotation and a triclinic cell are fitted."""
    webbridge.setup(workdir=str(tmp_path / "work"))
    ds = webbridge.make_demo_input(n=101)
    out = json.loads(webbridge.volume_ub_check_json(f"{ds}.raw", "1,1,1"))
    assert out["id"] == f"{ds}.raw"
    assert out["fit"] == "both" and out["symmetrised"] is None
    assert out["cell"][:3] == pytest.approx([4.2, 4.2, 4.2], rel=2e-3)
    assert out["angle_deg"] < 0.05
    # The peaks' mean offset from their nodes, r.l.u.: none on a right UB and origin.
    off = out["mean_offset_rlu"]
    assert off["n"] == out["n_used"]
    assert max(abs(x) for x in off["before"] + off["after"]) < 1e-3
    with pytest.raises(ValueError, match="cell must be"):
        webbridge.volume_ub_check_json(f"{ds}.raw", "0,1,1")


def test_save_dpdf_envelope(ran_pipeline):
    dataset_id, _datasets, _events = ran_pipeline
    env = bytes(webbridge.save_dpdf(dataset_id, q_min=0.5, q_max=3.0))
    (header_len,) = struct.unpack_from("<I", env, 0)
    header = json.loads(env[4 : 4 + header_len].decode("utf-8"))
    assert header["filename"].endswith(".h5")
    assert "delta_pdf" in header["filename"]
    payload = env[4 + header_len:]
    assert payload[:8] == b"\x89HDF\r\n\x1a\n"  # HDF5 magic signature
    # The temp file must not linger in the workspace (unlinked after read).
    cfg = webbridge._S.cfg
    assert cfg is not None
    assert header["filename"] not in {p.name for p in cfg.processed_dir.iterdir()}


def test_inspect_input_admits_full_resolution_volume(tmp_path):
    """A real full-resolution grid (301×401×401 = 48.4 M voxels, float64) must
    pass the browser memory gate — the 4 GB Pyodide heap plus the memory-lean
    float64 pipeline admit it (no precision reduction, see webbridge budget).

    Metadata-only file: the gate reads just the HDF5 dataset shape, so the
    dataset is never written (h5py allocates contiguous storage lazily).
    """
    import h5py

    webbridge.setup(workdir=str(tmp_path / "work"))
    path = tmp_path / "full_res.h5"
    with h5py.File(path, "w") as f:
        f.create_group("entry").create_dataset(
            "data", shape=(301, 401, 401), dtype="f8")

    report = json.loads(webbridge.inspect_input("full_res.h5", str(path)))
    assert report["shape"] == [301, 401, 401]
    assert report["n_voxels"] == 301 * 401 * 401
    assert report["ok"] is True, report["message"]


def test_inspect_input_still_rejects_oversized_volume(tmp_path):
    """Beyond the physical 4 GB WASM ceiling the gate must still refuse."""
    import h5py

    webbridge.setup(workdir=str(tmp_path / "work"))
    path = tmp_path / "huge.h5"
    with h5py.File(path, "w") as f:
        f.create_group("entry").create_dataset(
            "data", shape=(501, 501, 501), dtype="f8")  # 125 M voxels

    report = json.loads(webbridge.inspect_input("huge.h5", str(path)))
    assert report["ok"] is False
    assert "native build" in report["message"]


def _shape_only_volume(path, shape):
    import h5py

    with h5py.File(path, "w") as f:
        f.create_group("entry").create_dataset("data", shape=shape, dtype="f8")
    return str(path)


def test_inspect_input_phone_gate_is_tab_wide(tmp_path):
    """On a phone / tablet the whole tab is budgeted (the OS kills the one
    content process and the browser reloads the page): ~5 M voxels, the 161³
    demo (4.2 M) fits, a desktop-sized volume is refused with a message that
    points to a desktop browser.  setup() without mobile restores the desktop
    gate."""
    demo = _shape_only_volume(tmp_path / "demo.h5", (161, 161, 161))
    mid = _shape_only_volume(tmp_path / "mid.h5", (201, 201, 151))  # 6.1 M
    try:
        webbridge.setup(workdir=str(tmp_path / "work"), mobile=True)
        report = json.loads(webbridge.inspect_input("demo.h5", demo))
        assert report["ok"] is True, report["message"]
        assert report["device"] == "mobile"
        assert 4_300_000 < report["ceiling_voxels"] < 8_000_000
        # the estimate counts the runtime, not just the pipeline's heap
        assert report["est_peak_mb"] > 550 + 4.2 * 125

        report = json.loads(webbridge.inspect_input("mid.h5", mid))
        assert report["ok"] is False
        message = report["message"]
        assert "phone or tablet" in message
        assert "desktop browser" in message
        assert "native build" in message
    finally:
        webbridge.setup(workdir=str(tmp_path / "work"))

    report = json.loads(webbridge.inspect_input("mid.h5", mid))
    assert report["ok"] is True and report["device"] == "desktop"
    assert report["ceiling_voxels"] == 80_000_000


# ---------------------------------------------------------------------------
# run_async — the parallel-rings orchestration seam
# ---------------------------------------------------------------------------
def test_run_async_without_pool_delegates(tmp_path):
    """Natively there is no JS ring pool, so run_async must behave exactly
    like run(): full pipeline, every stage present."""
    import asyncio

    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=25)
    events: list[tuple] = []

    def progress(stage, status, fraction, message):
        events.append((stage, status, fraction, message))

    datasets = json.loads(asyncio.run(webbridge.run_async(
        "", "{}", flatten_enabled=True, force=True, progress=progress)))
    by_name = {s["name"]: s for s in datasets[0]["stages"]}
    assert datasets[0]["id"] == dataset_id
    assert by_name["delta_pdf"]["exists"]
    stages_seen = {ev[0] for ev in events}
    assert set(webbridge.STAGES).issubset(stages_seen)


def test_run_async_with_pool_matches_sync_run(tmp_path, monkeypatch):
    """With a (fake) pool installed, run_async fans the ring stage out through
    nebula3d.ringworker and must reproduce run()'s artifacts bit for bit.  The
    pool serves the per-plane models, so this pins ``patched``."""
    import asyncio

    import nebula3d
    from tests.test_ring_parallel import FakeExecutor

    params = json.dumps({"rings_model": "patched"})
    # Reference: plain sync run in workspace A.
    webbridge.setup(workdir=str(tmp_path / "a"))
    webbridge.make_demo_input(n=25)
    webbridge.run("", params, flatten_enabled=True, force=True)
    ring_a = sorted((tmp_path / "a" / "processed").glob("*_ringremoved.h5"))[0]
    vol_a = nebula3d.load(ring_a)

    # Parallel: fake pool + FakeExecutor in workspace B.
    monkeypatch.setattr(webbridge, "_ring_pool_js", lambda: object())
    monkeypatch.setattr(webbridge, "_JsPlaneExecutor",
                        lambda pool, progress=None: FakeExecutor(n_workers=3))
    webbridge.setup(workdir=str(tmp_path / "b"))
    webbridge.make_demo_input(n=25)
    events: list[tuple] = []

    def progress(stage, status, fraction, message):
        events.append((stage, status, fraction, message))

    datasets = json.loads(asyncio.run(webbridge.run_async(
        "", params, flatten_enabled=True, force=True, progress=progress)))
    ring_b = sorted((tmp_path / "b" / "processed").glob("*_ringremoved.h5"))[0]
    vol_b = nebula3d.load(ring_b)

    assert np.array_equal(vol_a.data, vol_b.data)
    assert np.array_equal(vol_a.mask, vol_b.mask)
    assert np.array_equal(vol_a.sigma, vol_b.sigma)
    # The fan-out label reaches the progress stream, and downstream stages ran.
    assert any("3-way" in ev[3] for ev in events if ev[0] == "rings")
    by_name = {s["name"]: s for s in datasets[0]["stages"]}
    assert by_name["delta_pdf"]["exists"]


def test_run_async_pool_skipped_when_rings_current(tmp_path, monkeypatch):
    """A resume run whose ring artifact is current must not engage the pool
    (ring_stage_pending is the shared gate)."""
    import asyncio

    webbridge.setup(workdir=str(tmp_path / "work"))
    webbridge.make_demo_input(n=25)
    webbridge.run("", "{}", flatten_enabled=True, force=True)

    def _boom(pool):  # noqa: ANN001
        raise AssertionError("pool must not be constructed on a current resume")

    monkeypatch.setattr(webbridge, "_ring_pool_js", lambda: object())
    monkeypatch.setattr(webbridge, "_JsPlaneExecutor", _boom)
    events: list[tuple] = []

    def progress(stage, status, fraction, message):
        events.append((stage, status, fraction, message))

    asyncio.run(webbridge.run_async(
        "", "{}", flatten_enabled=True, force=False, progress=progress))
    assert any(status == "skip" for st, status, _f, _m in events if st == "rings")


def test_browser_run_is_matplotlib_free(tmp_path):
    """The Pyodide boot no longer loads matplotlib (~9 MB of wheels), so a full
    browser-style run — import the bridge, make the demo input, run every
    stage — must succeed with matplotlib *uninstallable*: a fresh interpreter
    with the import blocked exactly as a missing package would be.  Guards
    both the lazy ``nebula3d.visualization`` import and the bridge skipping the
    native ``pdf_check`` PNG (the only matplotlib consumer on the run path)."""
    import subprocess
    import sys

    code = (
        "import sys\n"
        "sys.modules['matplotlib'] = None  # any `import matplotlib` -> ImportError\n"
        "import json\n"
        "from nebula3d import webbridge\n"
        f"webbridge.setup(workdir={str(tmp_path / 'work')!r})\n"
        "webbridge.make_demo_input(n=25)\n"
        "out = json.loads(webbridge.run('', '{}', flatten_enabled=True, force=True))\n"
        "assert out, 'no datasets returned'\n"
        "loaded = [m for m in sys.modules if m.startswith('matplotlib') "
        "and sys.modules[m] is not None]\n"
        "assert not loaded, loaded\n"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True,
                          text=True, env={**os.environ, "MPLCONFIGDIR": str(tmp_path)})
    assert proc.returncode == 0, proc.stderr


# ---------------------------------------------------------------------------
# The CPython adapter at the Worker seam (web/src/llm/evals/devData/bridge.py)
# ---------------------------------------------------------------------------
# The replay tests (web/src/llm/evals/devData/) run the engine, the stores and
# the Pilot's tools over the pipeline worker's messages, answered by this
# bridge from the same webbridge over stdio. The TS side's type test pins its
# Worker to every WorkerRequest type; these pin the bridge to the same union,
# read from pyodideWorker.ts, and the frames both ends share.
_REPO = Path(__file__).resolve().parents[1]
_BRIDGE = _REPO / "web" / "src" / "llm" / "evals" / "devData" / "bridge.py"
_FRAME = struct.Struct("<II")


def _bridge_module():
    spec = importlib.util.spec_from_file_location("devdata_bridge", _BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _worker_request_types() -> list[str]:
    """The `type`s of pyodideWorker.ts's WorkerRequest union, in order."""
    text = (_REPO / "web" / "src" / "workers" / "pyodideWorker.ts").read_text()
    union = re.search(r"type WorkerRequest =(.*?);\n\n", text, re.S)
    assert union, "pyodideWorker.ts no longer declares the WorkerRequest union"
    return re.findall(r'type: "(\w+)"', union.group(1))


def _bridge_env() -> dict[str, str]:
    path = os.pathsep.join(p for p in (str(_REPO / "src"), os.environ.get("PYTHONPATH")) if p)
    return {**os.environ, "PYTHONPATH": path}


class _StdioBridge:
    """A client of the bridge's frames: [u32 LE header len][u32 LE body len][JSON][bytes]."""

    def __init__(self, root):
        self.proc = subprocess.Popen(
            [sys.executable, str(_BRIDGE), "serve", "--root", str(root)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=_bridge_env())

    def send(self, header: dict, body: bytes = b"") -> None:
        data = json.dumps(header).encode()
        self.proc.stdin.write(_FRAME.pack(len(data), len(body)) + data + body)
        self.proc.stdin.flush()

    def recv(self) -> tuple[dict, bytes]:
        lengths = self.proc.stdout.read(_FRAME.size)
        if len(lengths) != _FRAME.size:
            self.proc.kill()
            pytest.fail(f"the bridge ended: {self.proc.stderr.read().decode()[-2000:]}")
        n_header, n_body = _FRAME.unpack(lengths)
        header = json.loads(self.proc.stdout.read(n_header))
        return header, self.proc.stdout.read(n_body) if n_body else b""

    def call(self, header: dict, body: bytes = b"") -> tuple[dict, bytes, list[dict]]:
        """Send one message; the reply to it, and the events before it."""
        self.send(header, body)
        events = []
        while True:
            reply, data = self.recv()
            if reply["id"] is None:
                events.append(reply)
                continue
            assert reply["id"] == header["id"], reply
            return reply, data, events


def test_the_bridge_handles_every_worker_message_type():
    types = _worker_request_types()
    assert types == ["boot", "load_file", "load_demo", "run_pipeline", "json_call", "slice_call"]
    assert set(_bridge_module().WORKER_TYPES) == set(types)


def test_the_stdio_bridge_answers_every_message_type(tmp_path):
    from nebula3d.demo import demo_volume

    bridge = _StdioBridge(tmp_path / "root")
    answered = set()
    try:
        reply, _, events = bridge.call(
            {"id": 1, "type": "boot", "wheelBase": "https://example.invalid/", "mobile": False})
        assert reply["type"] == "result" and reply["payload"].startswith("native:nebula3d-")
        assert [e["type"] for e in events] == ["boot_status"] and events[0]["ready"] is True
        gpu, _ = bridge.recv()  # no WebGPU: the CPU FFT, as in a browser without it
        assert gpu == {"id": None, "type": "gpu_status", "available": False, "adapter": "",
                       "maxBufferMB": 0}
        answered.add("boot")

        small = tmp_path / "small.nxs"
        nebula3d.save(demo_volume(9, dtype=np.float32), small)
        reply, _, _ = bridge.call({"id": 2, "type": "load_file", "name": "small.nxs"},
                                  small.read_bytes())
        assert reply == {"id": 2, "type": "result", "payload": "small"}
        answered.add("load_file")

        # n: a coarse demo for the test (the worker always loads 161³).
        reply, _, _ = bridge.call({"id": 3, "type": "load_demo", "n": 25})
        assert reply["payload"] == "synthetic-rocksalt"
        answered.add("load_demo")

        reply, _, events = bridge.call({
            "id": 4, "type": "run_pipeline", "paramsJson": "{}", "flattenEnabled": True,
            "force": True, "forceFrom": None, "stages": None, "tuningRun": None,
            "tuningTrial": None})
        assert reply["type"] == "result", reply
        assert {e["stage"] for e in events if e["type"] == "progress"} >= set(webbridge.STAGES)
        assert {d["id"] for d in json.loads(reply["payload"])} == {"small", "synthetic-rocksalt"}
        answered.add("run_pipeline")

        reply, _, _ = bridge.call({"id": 5, "type": "json_call", "method": "dataset_json",
                                   "args": ["synthetic-rocksalt"]})
        assert json.loads(reply["payload"])["id"] == "synthetic-rocksalt"
        answered.add("json_call")

        reply, data, _ = bridge.call({"id": 6, "type": "slice_call", "method": "volume_slice",
                                      "args": ["synthetic-rocksalt.flattened", "hk0", 0, False]})
        assert reply == {"id": 6, "type": "result_binary"}
        header, values = _decode_envelope(data)
        assert values.size == header["nx"] * header["ny"] > 0
        answered.add("slice_call")

        # A Python exception is the error reply, as Pyodide words it: the traceback.
        for n, method in enumerate(("no_such_method", "_S", "volume_slice"), start=7):
            reply, _, _ = bridge.call({"id": n, "type": "json_call", "method": method,
                                       "args": ["nope"]})
            assert reply["type"] == "error" and reply["message"].startswith("Traceback"), reply

        # A dev case: built, run, kept, then given again from the snapshot.
        reply, _, _ = bridge.call({"id": "ctl-1", "type": "dev_case", "case": "dev-control",
                                   "n": 81, "arm": "B", "run": 1})
        assert reply["type"] == "result" and reply["payload"]["restored"] is False, reply
        dev_id = reply["payload"]["dataset_id"]
        assert dev_id.endswith("-B1") and "control" not in dev_id  # the label stays opaque
        reply, _, _ = bridge.call({"id": 20, "type": "run_pipeline", "paramsJson": "{}",
                                   "flattenEnabled": True, "force": False, "forceFrom": None,
                                   "stages": None, "tuningRun": None, "tuningTrial": None})
        (ran,) = json.loads(reply["payload"])  # the fresh workspace holds the case alone
        assert ran["id"] == dev_id and all(s["exists"] for s in ran["stages"])
        reply, _, _ = bridge.call({"id": "ctl-2", "type": "dev_snapshot", "case": "dev-control",
                                   "n": 81, "arm": "B", "run": 1})
        assert reply["payload"] is True
        reply, _, _ = bridge.call({"id": "ctl-3", "type": "dev_case", "case": "dev-control",
                                   "n": 81, "arm": "B", "run": 1})
        assert reply["payload"] == {"dataset_id": dev_id, "restored": True}
        reply, _, _ = bridge.call({"id": 21, "type": "json_call", "method": "datasets_json",
                                   "args": []})
        (restored,) = json.loads(reply["payload"])
        assert restored["stages"] == ran["stages"]
        # Only the dev split is built.
        reply, _, _ = bridge.call({"id": "ctl-4", "type": "dev_case", "case": "not-a-dev-case",
                                   "n": 81})
        assert reply["type"] == "error" and "is not a dev case" in reply["message"]
        reply, _, _ = bridge.call({"id": 22, "type": "no_such_type"})
        assert reply["type"] == "error" and "no message 'no_such_type'" in reply["message"]

        reply, _, _ = bridge.call({"id": "ctl-5", "type": "terminate"})
        assert reply["payload"] is True
        assert bridge.proc.wait(timeout=30) == 0
    finally:
        if bridge.proc.poll() is None:
            bridge.proc.kill()
    assert answered == set(_worker_request_types())


def test_the_bridge_check_reads_the_browser_pins(tmp_path):
    bridge = _bridge_module()
    pins, python = bridge.read_pins(_REPO / ".github" / "constraints" / "pyodide-0.27.7.txt")
    assert python == "3.12" and set(pins) == {"numpy", "scipy", "h5py", "matplotlib"}

    here = ".".join(map(str, sys.version_info[:2]))
    same = tmp_path / "same.txt"
    same.write_text(f"# CPython {here}\nnumpy=={np.__version__}\n")
    other = tmp_path / "other.txt"
    other.write_text(f"# CPython {here}\nnumpy==0.0.1\n")

    def check(path):
        proc = subprocess.run([sys.executable, str(_BRIDGE), "check", "--pins", str(path)],
                              capture_output=True, text=True, env=_bridge_env())
        return proc.returncode, json.loads(proc.stdout)

    code, report = check(same)
    assert code == 0 and report["pins"]["differ"] == {}, report
    assert Path(report["nebula3d"]) == _REPO / "src" / "nebula3d" / "__init__.py"
    code, report = check(other)
    assert code == 1
    assert report["pins"]["differ"] == {"numpy": {"pinned": "0.0.1", "installed": np.__version__}}
