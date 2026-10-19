"""End-to-end test of the in-browser bridge (:mod:`nebula3d.webbridge`).

Exercises the same code path the Pyodide build uses — minus Pyodide itself —
on a tiny synthetic volume: set up the virtual workspace, run the full pipeline,
then pull the dataset listing, HKL/ΔPDF/consistency metadata, and binary slice
envelopes, asserting they have the shapes the React viewers decode.

The bridge must stay importable without FastAPI (it runs under Pyodide), so the
import itself is part of the contract under test.
"""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys

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
