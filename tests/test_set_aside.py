"""Outputs set aside before a run and put back after it (``server.setaside``).

Auto mode sets a dataset's outputs aside before the run of a fix, and puts
them back when the fix is undone, in place of a run that would compute them
again.  The central check: after a restore, every file in ``processed/`` is
byte-identical to what it was, with its date, and a run with the settings put
back computes nothing — through the library, the native server (real job
processes) and the in-browser bridge.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

import nebula3d
from nebula3d import webbridge
from nebula3d.demo import demo_volume
from nebula3d.pipeline import PipelineParams, pipeline_paths, resume_plan, run_pipeline
from nebula3d.server import setaside, tuning
from nebula3d.server import volumes as vol_mod
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import discover_datasets
from nebula3d.server.params import build_params
from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

STEM = "synthetic_rocksalt"
DATASET = "synthetic-rocksalt"
#: A fix's change of the punch.
FIX = {"punch_min_significance": 9.0}


def _state(folder: Path) -> dict[str, tuple[str, int]]:
    """name → (sha256, mtime in ns) of every file in *folder*."""
    return {
        p.name: (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
        for p in sorted(folder.iterdir()) if p.is_file()
    }


def _params(**overrides: object) -> PipelineParams:
    req = PipelineRunRequest(dataset_id="x", params=StageParamsIn(**overrides))  # type: ignore[arg-type]
    return build_params(req)


@pytest.fixture(scope="module")
def data_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A data root whose processed/ holds one full pipeline run."""
    root = tmp_path_factory.mktemp("root")
    (root / "raw").mkdir()
    raw = root / "raw" / f"{STEM}.nxs"
    nebula3d.save(demo_volume(33, dtype=np.float32), raw)
    run_pipeline(raw, PipelineParams(), proc_dir=root / "processed")
    return root


@pytest.fixture
def root(data_root: Path, tmp_path: Path) -> Path:
    """A fresh copy of the module's data root, its files' dates kept."""
    dest = tmp_path / "root"
    shutil.copytree(data_root, dest)
    vol_mod.clear_cache()
    return dest


def _raw(root: Path) -> Path:
    return root / "raw" / f"{STEM}.nxs"


def _fix_run(root: Path, from_stage: str = "punch", **changes: object) -> None:
    """The run of a fix: from *from_stage* on, with the fix's settings."""
    run_pipeline(_raw(root), _params(**(changes or FIX)), proc_dir=root / "processed",
                 force_from=from_stage)


def test_restore_puts_back_every_output_with_its_date(root: Path) -> None:
    cfg, proc = ServerConfig(data_root=root), root / "processed"
    before = _state(proc)
    kept = setaside.set_aside(cfg, DATASET, _raw(root), "punch")
    assert kept.done and kept.bytes > 0
    # From the punch on: its output and profile, the backfill, the flatten,
    # the ΔPDF and its check; the ring removal's files are left out.
    assert not any("ringremoved.h5" == f or f.endswith("_diagnostics.json") for f in kept.files)
    assert {f.rsplit("_", 1)[-1] for f in kept.files} >= {
        "braggpunched.h5", "profile.json", "backfilled.h5", "flattened.h5", "pdf.h5",
        "consistency.json", "consistency.png"}
    assert _state(proc) == before, "setting aside only reads processed/"

    _fix_run(root)
    changed = {n for n, s in _state(proc).items() if s != before[n]}
    assert changed == set(kept.files), "the run rewrote exactly what was set aside"
    assert resume_plan(_raw(root), PipelineParams(), proc_dir=proc), "stale for the old settings"

    out = setaside.restore(cfg, DATASET, _raw(root), PipelineParams())
    assert out.done and out.reason is None and set(out.files) == set(kept.files)
    assert _state(proc) == before
    assert resume_plan(_raw(root), PipelineParams(), proc_dir=proc) == {}
    assert not setaside.set_aside_root(cfg).exists(), "nothing is left set aside"


def test_set_aside_files_are_files_of_their_own(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    setaside.set_aside(cfg, DATASET, _raw(root), "rings")
    folder = setaside.set_aside_root(cfg) / DATASET
    for f in folder.iterdir():
        if f.name == "manifest.json":
            continue
        original = root / "processed" / f.name
        assert f.stat().st_nlink == 1 and original.stat().st_nlink == 1, "never a hard link"
        assert f.stat().st_ino != original.stat().st_ino
        assert f.stat().st_mtime_ns == original.stat().st_mtime_ns


def test_the_browsers_copy_is_the_same_file(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """In the browser the copy is sized first and filled in place: the same
    bytes and date as the clone the native build makes."""
    cfg, proc = ServerConfig(data_root=root), root / "processed"
    monkeypatch.setattr(setaside, "_COPY_CHUNK", 1000)
    monkeypatch.setattr(setaside.sys, "platform", "emscripten")
    monkeypatch.setattr(setaside, "_clone", lambda *_a: pytest.fail("no clone in the browser"))
    kept = setaside.set_aside(cfg, DATASET, _raw(root), "rings")
    monkeypatch.undo()
    assert kept.done
    folder = setaside.set_aside_root(cfg) / DATASET
    before = _state(proc)
    assert {n: s for n, s in _state(folder).items() if n != "manifest.json"} == {
        n: before[n] for n in kept.files}
    _fix_run(root, "rings", rings_pooled_sectors=36)
    assert setaside.restore(cfg, DATASET, _raw(root), PipelineParams()).done
    assert _state(proc) == before


def test_discard_leaves_the_outputs_as_they_are(root: Path) -> None:
    cfg, proc = ServerConfig(data_root=root), root / "processed"
    setaside.set_aside(cfg, DATASET, _raw(root), "punch")
    _fix_run(root)
    after_fix = _state(proc)
    assert setaside.discard(cfg, DATASET) is True
    assert _state(proc) == after_fix
    assert not setaside.set_aside_root(cfg).exists()
    assert setaside.discard(cfg, DATASET) is False
    out = setaside.restore(cfg, DATASET, _raw(root), _params(**FIX))
    assert not out.done and out.reason == "nothing was set aside"
    assert _state(proc) == after_fix


def test_what_is_set_aside_is_no_dataset_and_no_tuning_run(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    listed = [d.id for d in discover_datasets(cfg)]
    setaside.set_aside(cfg, DATASET, _raw(root), "rings")
    assert (setaside.set_aside_root(cfg) / DATASET).is_dir()
    assert [d.id for d in discover_datasets(cfg)] == listed == [DATASET]
    assert tuning.list_runs(cfg) == []
    # A tuning run beside it is listed as before, and reads nothing of it.
    run = tuning.new_run(cfg, DATASET, _raw(root), "flatten")
    assert [r.id for r in tuning.list_runs(cfg)] == [run.id]
    assert not any("set-aside" in str(p) for p in tuning.artifact_paths(cfg, run).values())


def test_a_second_set_aside_replaces_the_first(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    first = setaside.set_aside(cfg, DATASET, _raw(root), "rings")
    second = setaside.set_aside(cfg, DATASET, _raw(root), "flatten")
    assert set(second.files) < set(first.files)
    held = setaside.held(cfg, DATASET)
    assert held is not None and held["from_stage"] == "flatten"
    folder = setaside.set_aside_root(cfg) / DATASET
    assert {f.name for f in folder.iterdir()} == {*second.files, "manifest.json"}


def test_a_server_starting_deletes_what_was_set_aside(root: Path) -> None:
    cfg, proc = ServerConfig(data_root=root), root / "processed"
    setaside.set_aside(cfg, DATASET, _raw(root), "rings")
    before = _state(proc)
    create_app(cfg)
    assert not setaside.set_aside_root(cfg).exists()
    assert _state(proc) == before
    assert setaside.sweep(cfg) == 0


def test_not_restored_when_the_outputs_are_not_those_of_the_settings(root: Path) -> None:
    """Set aside with the fix's outputs already in place: putting them back
    for the old settings leaves a run to make, and says so."""
    cfg = ServerConfig(data_root=root)
    _fix_run(root)
    setaside.set_aside(cfg, DATASET, _raw(root), "punch")
    out = setaside.restore(cfg, DATASET, _raw(root), PipelineParams())
    assert not out.done and out.reason is not None and "punch" in out.reason
    assert not setaside.set_aside_root(cfg).exists()


def test_not_restored_when_a_file_is_missing_or_changed(root: Path) -> None:
    cfg, proc = ServerConfig(data_root=root), root / "processed"
    paths = pipeline_paths(_raw(root), proc_dir=proc)
    folder = setaside.set_aside_root(cfg) / DATASET

    setaside.set_aside(cfg, DATASET, _raw(root), "punch")
    _fix_run(root)
    after_fix = _state(proc)
    (folder / paths.backfilled.name).unlink()
    out = setaside.restore(cfg, DATASET, _raw(root), PipelineParams())
    assert not out.done and out.reason == f"{paths.backfilled.name} was not set aside"
    assert _state(proc) == after_fix, "nothing was moved: all or none"
    assert not folder.exists()

    setaside.set_aside(cfg, DATASET, _raw(root), "punch")
    with (folder / paths.flattened.name).open("ab") as fh:
        fh.write(b"x")
    out = setaside.restore(cfg, DATASET, _raw(root), _params(**FIX))
    assert not out.done and out.reason == f"{paths.flattened.name} changed since it was set aside"
    assert _state(proc) == after_fix


def test_nothing_is_set_aside_when_space_is_short(root: Path,
                                                monkeypatch: pytest.MonkeyPatch) -> None:
    cfg, proc = ServerConfig(data_root=root), root / "processed"
    before = _state(proc)
    need = setaside.set_aside(cfg, DATASET, _raw(root), "punch").bytes
    setaside.discard(cfg, DATASET)
    assert setaside.space_refusal(need, 2 * need + setaside.FREE_SPACE_MARGIN_BYTES) is None
    assert setaside.space_refusal(need, 2 * need + setaside.FREE_SPACE_MARGIN_BYTES - 1)

    usage = shutil.disk_usage(root)
    monkeypatch.setattr(shutil, "disk_usage",
                        lambda _p: usage._replace(free=setaside.FREE_SPACE_MARGIN_BYTES))
    out = setaside.set_aside(cfg, DATASET, _raw(root), "punch")
    assert not out.done and out.reason is not None and "free" in out.reason
    assert not setaside.set_aside_root(cfg).exists() and _state(proc) == before
    monkeypatch.undo()

    out = setaside.set_aside(cfg, DATASET, _raw(root), "punch", max_bytes=need - 1)
    assert not out.done and out.reason is not None and "kept in memory" in out.reason
    assert not setaside.set_aside_root(cfg).exists() and _state(proc) == before


def test_a_file_of_a_stage_switched_off_is_left_as_the_run_left_it(root: Path) -> None:
    """With the flatten off, a run writes no flattened file and a restore puts
    none back: the one on disk stays whatever the run in between made it."""
    cfg, proc = ServerConfig(data_root=root), root / "processed"
    raw = _raw(root)
    off = _params()
    off.flatten_enabled = False
    run_pipeline(raw, off, proc_dir=proc)  # the ΔPDF from the backfilled volume
    paths = pipeline_paths(raw, proc_dir=proc)
    before = _state(proc)
    setaside.set_aside(cfg, DATASET, raw, "flatten")
    run_pipeline(raw, _params(flatten_estimator="floor"), proc_dir=proc, force_from="flatten")
    made = _state(proc)[paths.flattened.name]
    assert made != before[paths.flattened.name]

    out = setaside.restore(cfg, DATASET, raw, off)
    assert out.done and paths.flattened.name not in out.files
    after = _state(proc)
    assert after[paths.flattened.name] == made
    assert {n: s for n, s in after.items() if n != paths.flattened.name} == {
        n: s for n, s in before.items() if n != paths.flattened.name}


def test_bad_requests_are_refused(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    with pytest.raises(ValueError):
        setaside.set_aside(cfg, DATASET, _raw(root), "pdf_check")
    with pytest.raises(ValueError):
        setaside.set_aside(cfg, "../processed", _raw(root), "punch")
    with pytest.raises(ValueError):
        setaside.discard(cfg, f"{DATASET}~tune~x")
    assert not setaside.set_aside_root(cfg).exists()


# ---------------------------------------------------------------------------
# The native server (real job processes)
# ---------------------------------------------------------------------------
def _wait(client: TestClient, job_id: str) -> dict:
    deadline = time.time() + 180
    while time.time() < deadline:
        job = client.get(f"/api/pipeline/jobs/{job_id}").json()
        if job["status"] != "running":
            return job
        time.sleep(0.2)
    raise AssertionError("the job did not finish")


def test_server_set_aside_run_and_restore(root: Path) -> None:
    proc = root / "processed"
    before = _state(proc)
    client = TestClient(create_app(ServerConfig(data_root=root)))

    kept = client.post("/api/pipeline/set-aside",
                       json={"dataset_id": DATASET, "from_stage": "punch"}).json()
    assert kept["set_aside"] and kept["bytes"] > 0
    assert [d["id"] for d in client.get("/api/datasets").json()] == [DATASET]

    job = client.post("/api/pipeline/run", json={
        "dataset_id": DATASET, "force_from": "punch", "params": FIX}).json()
    assert _wait(client, job["id"])["status"] == "done"
    assert _state(proc) != before
    stale = client.post("/api/pipeline/stale", json={"dataset_id": DATASET}).json()["stale"]
    assert "braggpunched" in stale

    out = client.post("/api/pipeline/set-aside/restore", json={"dataset_id": DATASET}).json()
    assert out == {"restored": True, "reason": None, "files": sorted(kept["files"])}
    assert _state(proc) == before
    assert client.post("/api/pipeline/stale", json={"dataset_id": DATASET}).json()["stale"] == {}
    assert not (root / "set-aside").exists()

    # Nothing set aside any more: not restored; discard says there was none.
    again = client.post("/api/pipeline/set-aside/restore", json={"dataset_id": DATASET}).json()
    assert again["restored"] is False and again["reason"] == "nothing was set aside"
    assert client.post("/api/pipeline/set-aside/discard",
                       json={"dataset_id": DATASET}).json() == {"discarded": False}
    assert _state(proc) == before


def test_server_refuses_while_a_run_writes_the_outputs(root: Path) -> None:
    app = create_app(ServerConfig(data_root=root))
    client = TestClient(app)
    assert client.post("/api/pipeline/set-aside",
                       json={"dataset_id": DATASET, "from_stage": "punch"}).json()["set_aside"]
    app.state.jobs.running = lambda: True
    out = client.post("/api/pipeline/set-aside/restore", json={"dataset_id": DATASET}).json()
    assert out["restored"] is False and out["reason"] == "a pipeline run is in progress"
    assert not (root / "set-aside").exists(), "what was set aside is gone with the refusal"
    kept = client.post("/api/pipeline/set-aside",
                       json={"dataset_id": DATASET, "from_stage": "punch"}).json()
    assert kept["set_aside"] is False and kept["reason"] == "a pipeline run is in progress"


def test_server_refuses_unknown_datasets_views_and_stages(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    client = TestClient(create_app(cfg))
    run = tuning.new_run(cfg, DATASET, _raw(root), "flatten")
    for dataset_id in ("nope", f"{DATASET}~tune~{run.id}"):
        for url, body in (("/api/pipeline/set-aside", {"from_stage": "punch"}),
                          ("/api/pipeline/set-aside/restore", {}),
                          ("/api/pipeline/set-aside/discard", {})):
            assert client.post(url, json={"dataset_id": dataset_id, **body}).status_code == 404
    assert client.post("/api/pipeline/set-aside",
                       json={"dataset_id": DATASET, "from_stage": "report"}).status_code == 400


def test_switching_the_data_root_deletes_what_was_set_aside(root: Path, tmp_path: Path) -> None:
    client = TestClient(create_app(ServerConfig(data_root=root)))
    client.post("/api/pipeline/set-aside", json={"dataset_id": DATASET, "from_stage": "punch"})
    assert (root / "set-aside" / DATASET).is_dir()
    other = tmp_path / "other"
    other.mkdir()
    assert client.put("/api/data-root", json={"data_root": str(other)}).status_code == 200
    assert not (root / "set-aside").exists()


# ---------------------------------------------------------------------------
# The in-browser bridge
# ---------------------------------------------------------------------------
@pytest.fixture
def bridge(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[str, Path]:
    monkeypatch.setattr(webbridge._S, "mobile", False)
    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=25)
    webbridge.run("", "{}", flatten_enabled=True, force=True)
    return dataset_id, tmp_path / "work"


def test_bridge_set_aside_run_and_restore(bridge: tuple[str, Path]) -> None:
    dataset_id, work = bridge
    proc = work / "processed"
    before = _state(proc)
    listed = json.loads(webbridge.datasets_json())

    kept = json.loads(webbridge.set_aside_json(dataset_id, "punch"))
    assert kept["set_aside"] and kept["bytes"] > 0
    assert json.loads(webbridge.datasets_json()) == listed
    fix = json.dumps(FIX)
    webbridge.run("", fix, True, force_from="punch")
    assert _state(proc) != before
    assert json.loads(webbridge.stale_outputs_json(dataset_id, "{}", True))["stale"]

    out = json.loads(webbridge.set_aside_restore_json(dataset_id, "{}", True))
    assert out == {"restored": True, "reason": None, "files": sorted(kept["files"])}
    assert _state(proc) == before
    assert json.loads(webbridge.stale_outputs_json(dataset_id, "{}", True))["stale"] == {}
    assert not (work / "set-aside").exists()
    assert json.loads(webbridge.datasets_json()) == listed

    # Kept, then discarded: the fix's outputs stay.
    webbridge.set_aside_json(dataset_id, "punch")
    webbridge.run("", fix, True, force_from="punch")
    after_fix = _state(proc)
    assert json.loads(webbridge.set_aside_discard_json(dataset_id)) == {"discarded": True}
    assert _state(proc) == after_fix and not (work / "set-aside").exists()
    out = json.loads(webbridge.set_aside_restore_json(dataset_id, "{}", True))
    assert out["restored"] is False and out["reason"] == "nothing was set aside"


def test_bridge_sets_nothing_aside_on_a_phone_or_over_its_cap(
        bridge: tuple[str, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    dataset_id, work = bridge
    before = _state(work / "processed")
    need = json.loads(webbridge.set_aside_json(dataset_id, "rings"))["bytes"]

    monkeypatch.setattr(webbridge, "_SET_ASIDE_MAX_BYTES", need - 1)
    out = json.loads(webbridge.set_aside_json(dataset_id, "rings"))
    assert out["set_aside"] is False and "kept in memory" in out["reason"]
    assert not (work / "set-aside").exists(), "the earlier one went, none replaced it"

    monkeypatch.setattr(webbridge, "_SET_ASIDE_MAX_BYTES", need)
    assert json.loads(webbridge.set_aside_json(dataset_id, "rings"))["set_aside"] is True
    monkeypatch.setattr(webbridge._S, "mobile", True)
    out = json.loads(webbridge.set_aside_json(dataset_id, "rings"))
    assert out["set_aside"] is False and "phone or tablet" in out["reason"]
    assert not (work / "set-aside").exists()
    assert _state(work / "processed") == before
