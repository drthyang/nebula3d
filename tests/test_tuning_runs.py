"""Tuning runs never write to ``processed/``.

Each trial runs into ``tuning/<run>/trials/<stage>-<n>/``, reading its inputs
from the run's chain (or ``processed/`` before the run's first stage); the
chosen trial is copied into ``tuning/<run>/processed/``.  The central check:
after a tuning run, every file in ``processed/`` is byte-identical — through
the library, the native server (real job processes) and the in-browser bridge.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

import nebula3d
from nebula3d import webbridge
from nebula3d.demo import demo_volume
from nebula3d.pipeline import PipelineParams, pipeline_paths, run_pipeline
from nebula3d.server import tuning
from nebula3d.server import volumes as vol_mod
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import discover_datasets, find_dataset
from nebula3d.server.params import build_params
from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

STEM = "synthetic_rocksalt"


def _snapshot(folder: Path) -> dict[str, str]:
    """name → sha256 of every file under *folder*."""
    return {
        str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(folder.rglob("*")) if p.is_file()
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
    """A fresh copy of the module's data root (runs must not leak between tests)."""
    import shutil

    dest = tmp_path / "root"
    shutil.copytree(data_root, dest)
    vol_mod.clear_cache()
    return dest


def _trial(cfg: ServerConfig, run_id: str, trial: str, params: PipelineParams) -> Path:
    run, folder, inputs = tuning.trial_target(cfg, run_id, trial)
    stage, _ = tuning.parse_trial(trial)
    run_pipeline(run.raw_path, params, proc_dir=folder, inputs=inputs,
                 stages=tuning.TRIAL_PIPELINE_STAGES[stage], force=True)
    return folder


def test_tuning_run_leaves_processed_byte_identical(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    before = _snapshot(cfg.processed_dir)
    assert before, "the fixture ran the pipeline"
    (base,) = discover_datasets(cfg)
    run = tuning.new_run(cfg, base.id, base.raw_path, "punch")

    # Two trials per stage — the defaults and a changed setting — and the
    # changed one is kept, so every later stage builds on a new input.
    changed = {
        "punch": _params(punch_min_significance=3.0, punch_margin=0.1),
        "backfill": _params(backfill_method="local"),
        "flatten": _params(flatten_estimator="floor"),
        "pdf": _params(pdf_apodization="hann"),
    }
    for stage, params in changed.items():
        first = _trial(cfg, run.id, f"{stage}-1", PipelineParams())
        second = _trial(cfg, run.id, f"{stage}-2", params)
        assert any(first.iterdir()) and any(second.iterdir())
        tuning.promote(cfg, run.id, f"{stage}-2")
        assert not (run.root / "trials" / f"{stage}-1").exists()

    assert _snapshot(cfg.processed_dir) == before

    # The chain holds a full set of outputs, made with the kept settings.
    proc = pipeline_paths(base.raw_path, proc_dir=cfg.processed_dir)
    chain = pipeline_paths(base.raw_path, proc_dir=run.chain)
    for attr in ("braggpunched", "bragg_profile_json", "backfilled", "flattened",
                 "delta_pdf", "pdf_check_json"):
        assert getattr(chain, attr).exists(), attr
    assert not chain.ringremoved.exists()  # before the run's first stage
    fill_proc = nebula3d.load(proc.backfilled).data
    fill_chain = nebula3d.load(chain.backfilled).data
    assert not np.array_equal(fill_proc, fill_chain, equal_nan=True)
    with open(chain.delta_pdf, "rb") as fh:
        assert hashlib.sha256(fh.read()).hexdigest() != before[proc.delta_pdf.name]


def test_trial_reads_the_chain_not_processed(root: Path) -> None:
    """A later stage's trial starts from the chosen earlier trial."""
    cfg = ServerConfig(data_root=root)
    (base,) = discover_datasets(cfg)
    run = tuning.new_run(cfg, base.id, base.raw_path, "backfill")
    _trial(cfg, run.id, "backfill-1", _params(backfill_method="local"))
    tuning.promote(cfg, run.id, "backfill-1")
    _, _, inputs = tuning.trial_target(cfg, run.id, "flatten-1")
    assert inputs["backfill"] == pipeline_paths(base.raw_path, proc_dir=run.chain).backfilled
    assert inputs["punch"].parent == cfg.processed_dir  # before the run's first stage


def test_views_resolve_each_stage_to_its_folder(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    (base,) = discover_datasets(cfg)
    run = tuning.new_run(cfg, base.id, base.raw_path, "punch")
    _trial(cfg, run.id, "punch-1", PipelineParams())

    trial_view = find_dataset(cfg, tuning.view_id(base.id, run.id, "punch-1"))
    assert trial_view is not None
    where = {s.name: s.path.parent for s in trial_view.stages}
    exists = {s.name: s.exists for s in trial_view.stages}
    assert where["ringremoved"] == cfg.processed_dir
    assert where["braggpunched"] == run.trial_dir("punch-1")
    assert exists == {"raw": True, "ringremoved": True, "braggpunched": True,
                      "backfilled": False, "flattened": False, "delta_pdf": False}

    # Listed after its dataset only once a stage is kept.
    assert [d.id for d in discover_datasets(cfg)] == [base.id]
    tuning.promote(cfg, run.id, "punch-1")
    ids = [d.id for d in discover_datasets(cfg)]
    assert ids == [base.id, tuning.view_id(base.id, run.id)]
    assert find_dataset(cfg, tuning.view_id(base.id, run.id, "punch-9")) is not None
    assert find_dataset(cfg, f"{base.id}~tune~../../etc") is None
    # The folder's count is its own datasets: a tuning run's view is listed, not counted.
    body = TestClient(create_app(cfg)).get("/api/data-root").json()
    assert body["n_datasets"] == 1


def test_bad_trials_are_refused(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    (base,) = discover_datasets(cfg)
    run = tuning.new_run(cfg, base.id, base.raw_path, "backfill")
    for bad in ("../punch-1", "punch-1/..", "punch", "pdf-0", "rings-1"):
        with pytest.raises(ValueError):
            tuning.trial_target(cfg, run.id, bad)
    with pytest.raises(ValueError):
        tuning.trial_target(cfg, "20260101T000000-zzzz", "backfill-1")
    with pytest.raises(ValueError, match="no output"):
        tuning.promote(cfg, run.id, "backfill-1")


def _wait(client: TestClient, job_id: str) -> dict:
    deadline = time.time() + 180
    while time.time() < deadline:
        job = client.get(f"/api/pipeline/jobs/{job_id}").json()
        if job["status"] != "running":
            return job
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def test_server_tuning_run_leaves_processed_byte_identical(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    before = _snapshot(cfg.processed_dir)
    client = TestClient(create_app(cfg))
    (base,) = client.get("/api/datasets").json()

    r = client.post("/api/tuning/runs", json={"dataset_id": base["id"], "first_stage": "backfill"})
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]

    def run_trial(trial: str, stages: list[str], params: dict) -> None:
        r = client.post("/api/pipeline/run", json={
            "dataset_id": base["id"], "stages": stages, "params": params,
            "tuning": {"run_id": run_id, "trial": trial}})
        assert r.status_code == 200, r.text
        job = _wait(client, r.json()["id"])
        assert job["status"] == "done", job

    # A trial may run only its own stage.
    bad = client.post("/api/pipeline/run", json={
        "dataset_id": base["id"], "stages": ["punch", "backfill"],
        "tuning": {"run_id": run_id, "trial": "backfill-1"}})
    assert bad.status_code == 400

    run_trial("backfill-1", ["backfill"], {"backfill_method": "local"})
    view = client.get(f"/api/datasets/{base['id']}~tune~{run_id}~backfill-1").json()
    exists = {s["name"]: s["exists"] for s in view["stages"]}
    assert exists["braggpunched"] and exists["backfilled"] and not exists["flattened"]
    meta = client.get(f"/api/volumes/{view['id']}.backfilled/meta")
    assert meta.status_code == 200, meta.text

    r = client.post(f"/api/tuning/runs/{run_id}/promote", json={"trial": "backfill-1"})
    assert r.status_code == 200, r.text
    chain_id = r.json()["dataset_id"]
    run_trial("flatten-1", ["flatten"], {"flatten_estimator": "floor"})
    client.post(f"/api/tuning/runs/{run_id}/promote", json={"trial": "flatten-1"})
    run_trial("pdf-1", ["pdf", "pdf_check"], {"pdf_apodization": "hann"})
    client.post(f"/api/tuning/runs/{run_id}/promote", json={"trial": "pdf-1"})

    listed = [d["id"] for d in client.get("/api/datasets").json()]
    assert listed == [base["id"], chain_id]
    check = client.get(f"/api/consistency/{chain_id}/check").json()
    assert check["has_check"]
    assert Path(check["check_path"]).parent == root / "tuning" / run_id / "processed"
    assert client.get(f"/api/bragg/{chain_id}/profile").json()["has_profile"]

    assert _snapshot(cfg.processed_dir) == before


def _numbers(path: Path) -> dict[str, np.ndarray]:
    """Every numeric dataset of an HDF5 file (it also records when it was written)."""
    import h5py

    out: dict[str, np.ndarray] = {}
    with h5py.File(path, "r") as f:
        f.visititems(lambda name, obj: out.__setitem__(name, obj[()])
                     if isinstance(obj, h5py.Dataset) and obj.dtype.kind in "biuf" else None)
    return out


def _same_numbers(a: Path, b: Path) -> bool:
    na, nb = _numbers(a), _numbers(b)
    return na.keys() == nb.keys() and all(
        np.array_equal(na[k], nb[k], equal_nan=True) for k in na)


def test_server_run_and_trial_with_the_punch_switched_off(root: Path,
                                                          tmp_path: Path) -> None:
    """The page's switch through the server: params.punch_enabled false
    reaches the job, whose backfill reads the ring-removed volume, never the
    punched one the full run left in processed/ (left as it was): the
    backfilled volume is a fresh punch-off run's. A tuning trial of the
    backfill, whose inputs name that punched volume, the same."""
    cfg = ServerConfig(data_root=root)
    client = TestClient(create_app(cfg))
    (base,) = client.get("/api/datasets").json()
    raw = cfg.raw_dir / f"{STEM}.nxs"
    proc = pipeline_paths(raw, proc_dir=cfg.processed_dir)
    left = proc.braggpunched.read_bytes()
    fresh = run_pipeline(raw, PipelineParams(punch_enabled=False),
                         proc_dir=tmp_path / "fresh", stages=("rings", "backfill"))
    assert not _same_numbers(fresh.backfilled, proc.backfilled)  # the switch matters
    switches = {"rings_enabled": True, "punch_enabled": False, "backfill_enabled": True}

    r = client.post("/api/pipeline/run", json={
        "dataset_id": base["id"], "stages": ["rings", "backfill", "flatten", "pdf", "pdf_check"],
        "force": True, "params": switches})
    assert r.status_code == 200, r.text
    job = _wait(client, r.json()["id"])
    assert job["status"] == "done", job
    assert _same_numbers(proc.backfilled, fresh.backfilled)
    assert proc.braggpunched.read_bytes() == left

    r = client.post("/api/tuning/runs", json={"dataset_id": base["id"], "first_stage": "backfill"})
    run_id = r.json()["run_id"]
    r = client.post("/api/pipeline/run", json={
        "dataset_id": base["id"], "stages": ["backfill"], "params": switches,
        "tuning": {"run_id": run_id, "trial": "backfill-1"}})
    assert r.status_code == 200, r.text
    assert _wait(client, r.json()["id"])["status"] == "done"
    trial = pipeline_paths(raw, proc_dir=root / "tuning" / run_id / "trials" / "backfill-1")
    assert _same_numbers(trial.backfilled, fresh.backfilled)


def test_bridge_tuning_run_leaves_processed_byte_identical(tmp_path: Path) -> None:
    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=25)
    webbridge.run("", "{}", flatten_enabled=True, force=True)
    processed = tmp_path / "work" / "processed"
    before = _snapshot(processed)

    start = json.loads(webbridge.tuning_start_json(dataset_id, "flatten"))
    run_id = start["run_id"]
    webbridge.run("flatten", json.dumps({"flatten_estimator": "floor"}), True,
                  tuning_run=run_id, tuning_trial="flatten-1")
    view = json.loads(webbridge.dataset_json(f"{dataset_id}~tune~{run_id}~flatten-1"))
    assert {s["name"]: s["exists"] for s in view["stages"]}["flattened"]
    webbridge.tuning_promote_json(run_id, "flatten-1")
    asyncio.run(webbridge.run_async("pdf,pdf_check", "{}", True,
                                    tuning_run=run_id, tuning_trial="pdf-1"))
    promoted = json.loads(webbridge.tuning_promote_json(run_id, "pdf-1"))
    assert any(f.endswith("_delta_pdf.h5") for f in promoted["files"])
    with pytest.raises(ValueError):
        webbridge.run("rings,punch", "{}", True, tuning_run=run_id, tuning_trial="pdf-2")

    assert _snapshot(processed) == before
    chain = json.loads(webbridge.dataset_json(start["dataset_id"]))
    assert all(s["exists"] for s in chain["stages"])


# ---------------------------------------------------------------------------
# Trial 1 from the stage's existing output
# ---------------------------------------------------------------------------
#: What a file records of when and how long, not of what (the files' ``date``
#: dataset and ``file_time`` attribute, the ring diagnostics' ``timing_s``):
#: left out of a comparison of a reused trial with a computed one.
_CLOCK_KEYS = {"date", "file_time", "timing_s"}


def _h5_content(path: Path) -> dict[str, object]:
    """Every dataset and attribute of an HDF5 file, wall-clock attributes aside."""
    import h5py

    out: dict[str, object] = {}

    def attrs(name: str, obj: h5py.HLObject) -> None:
        for key, value in obj.attrs.items():
            if key not in _CLOCK_KEYS:
                out[f"{name}@{key}"] = (value.tobytes() if isinstance(value, np.ndarray)
                                        else value)

    def visit(name: str, obj: h5py.HLObject) -> None:
        attrs(name, obj)
        if isinstance(obj, h5py.Dataset) and name.rsplit("/", 1)[-1] not in _CLOCK_KEYS:
            data = obj[()]
            out[name] = ((data.dtype.str, data.shape, data.tobytes())
                         if isinstance(data, np.ndarray) else data)

    with h5py.File(path, "r") as fh:
        attrs("/", fh)
        fh.visititems(visit)
    return out


def _json_content(path: Path) -> object:
    def strip(obj: object) -> object:
        if isinstance(obj, dict):
            return {k: strip(v) for k, v in obj.items() if k not in _CLOCK_KEYS}
        if isinstance(obj, list):
            return [strip(v) for v in obj]
        return obj

    return strip(json.loads(path.read_text()))


def _folder_content(folder: Path) -> dict[str, object]:
    out: dict[str, object] = {}
    for f in sorted(folder.iterdir()):
        out[f.name] = (_h5_content(f) if f.suffix == ".h5"
                       else _json_content(f) if f.suffix == ".json"
                       else f.stat().st_size > 0)
    return out


def _target(cfg: ServerConfig, run_id: str, trial: str,
            params: PipelineParams) -> tuple[Path, dict[str, Path], bool]:
    """A trial's folder, inputs and whether it was made from the existing output."""
    run, folder, inputs = tuning.trial_target(cfg, run_id, trial)
    return folder, inputs, tuning.reuse_existing_output(cfg, run, trial, params, inputs)


def _never(name: str):  # noqa: ANN202
    def stage(*_a: object, **_k: object) -> None:
        raise AssertionError(f"{name} ran: the trial was to be taken from the existing output")
    return stage


_STAGE_FUNCTIONS = {"rings": ("remove_rings",), "punch": ("punch_bragg",),
                    "backfill": ("backfill",), "flatten": ("flatten",),
                    "pdf": ("delta_pdf", "pdf_consistency_check")}


@pytest.mark.parametrize("stage", tuning.TUNE_STAGES)
def test_trial_1_is_taken_from_the_existing_output(
        root: Path, stage: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """Current settings, unchanged input: trial 1 is the processed output, in
    the trial folder exactly as a computed trial 1 leaves it, and the stage
    does not run."""
    import nebula3d.pipeline as pipeline_mod

    cfg = ServerConfig(data_root=root)
    before = _snapshot(cfg.processed_dir)
    (base,) = discover_datasets(cfg)
    run = tuning.new_run(cfg, base.id, base.raw_path, stage)
    trial = f"{stage}-1"
    computed = _folder_content(_trial(cfg, run.id, trial, PipelineParams()))

    folder, inputs, reused = _target(cfg, run.id, trial, PipelineParams())
    assert reused
    with monkeypatch.context() as m:
        for name in _STAGE_FUNCTIONS[stage]:
            m.setattr(pipeline_mod, name, _never(name))
        log: list[tuple[str, str]] = []
        run_pipeline(run.raw_path, PipelineParams(), proc_dir=folder, inputs=inputs,
                     stages=tuning.TRIAL_PIPELINE_STAGES[stage], force=False,
                     progress=lambda s, status, _f, _m: log.append((s, status)))
    assert {status for _s, status in log} == {"skip"}
    assert _folder_content(folder) == computed
    assert _snapshot(cfg.processed_dir) == before

    # Not hard links: keeping the trial and clearing the folders leaves processed/ alone.
    proc = pipeline_paths(base.raw_path, proc_dir=cfg.processed_dir)
    for f in folder.iterdir():
        assert f.stat().st_ino != (cfg.processed_dir / f.name).stat().st_ino
        assert f.stat().st_nlink == 1
    kept = tuning.promote(cfg, run.id, trial)
    assert kept and not folder.exists()
    assert _snapshot(cfg.processed_dir) == before
    # A file of the chain rewritten, then the run deleted: processed/ still stands.
    for name in kept:
        with open(run.chain / name, "r+b") as fh:
            fh.write(b"\0" * 64)
    tuning.trial_target(cfg, run.id, trial)  # empties the trial folder again
    import shutil

    shutil.rmtree(run.root)
    assert _snapshot(cfg.processed_dir) == before
    assert proc.ringremoved.exists()


def test_trial_1_is_computed_when_the_settings_differ(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    (base,) = discover_datasets(cfg)
    run = tuning.new_run(cfg, base.id, base.raw_path, "punch")
    folder, _, reused = _target(cfg, run.id, "punch-1", _params(punch_margin=0.1))
    assert not reused and not any(folder.iterdir())
    # … and only trial 1 is ever taken from the existing output.
    folder, _, reused = _target(cfg, run.id, "punch-2", PipelineParams())
    assert not reused and not any(folder.iterdir())


def test_trial_1_follows_the_chain(root: Path) -> None:
    """The input an earlier stage of the run left decides: kept as it was,
    the next stage's trial 1 is still the processed output; made again or
    made with other settings, it is computed."""
    cfg = ServerConfig(data_root=root)
    (base,) = discover_datasets(cfg)

    # Trial 1 of the punch reused and kept: the backfill's input is the same.
    run = tuning.new_run(cfg, base.id, base.raw_path, "punch")
    assert _target(cfg, run.id, "punch-1", PipelineParams())[2]
    tuning.promote(cfg, run.id, "punch-1")
    folder, inputs, reused = _target(cfg, run.id, "backfill-1", PipelineParams())
    assert inputs["punch"].parent == run.chain
    assert reused and any(folder.iterdir())

    # The punch computed again (same settings, a new file): the backfill in
    # processed/ is older than its input, so it is computed.
    run = tuning.new_run(cfg, base.id, base.raw_path, "punch")
    time.sleep(0.05)
    _trial(cfg, run.id, "punch-1", PipelineParams())
    tuning.promote(cfg, run.id, "punch-1")
    folder, _, reused = _target(cfg, run.id, "backfill-1", PipelineParams())
    assert not reused and not any(folder.iterdir())

    # Another punch kept: the backfill's input is another one.
    run = tuning.new_run(cfg, base.id, base.raw_path, "punch")
    _trial(cfg, run.id, "punch-2", _params(punch_min_significance=3.0, punch_margin=0.1))
    tuning.promote(cfg, run.id, "punch-2")
    folder, _, reused = _target(cfg, run.id, "backfill-1", PipelineParams())
    assert not reused and not any(folder.iterdir())


def test_trial_1_is_computed_when_the_output_is_missing_or_stale(root: Path) -> None:
    cfg = ServerConfig(data_root=root)
    (base,) = discover_datasets(cfg)
    proc = pipeline_paths(base.raw_path, proc_dir=cfg.processed_dir)
    run = tuning.new_run(cfg, base.id, base.raw_path, "rings")

    # Older than its input: the ring removal was made again after the punch.
    stale = time.time() + 5
    import os

    os.utime(proc.ringremoved, (stale, stale))
    assert not _target(cfg, run.id, "punch-1", PipelineParams())[2]
    assert _target(cfg, run.id, "rings-1", PipelineParams())[2]  # itself still current

    # A side file missing: the punch profile, the ring diagnostics, the check.
    for attr, trial in (("ring_diagnostics_json", "rings-1"), ("pdf_check_json", "pdf-1")):
        getattr(proc, attr).unlink()
        folder, _, reused = _target(cfg, run.id, trial, PipelineParams())
        assert not reused and not any(folder.iterdir()), attr
    os.utime(proc.ringremoved, None)
    os.utime(proc.braggpunched, None)
    proc.bragg_profile_json.unlink()
    assert not _target(cfg, run.id, "punch-1", PipelineParams())[2]

    # No output at all.
    proc.flattened.unlink()
    folder, _, reused = _target(cfg, run.id, "flatten-1", PipelineParams())
    assert not reused and not any(folder.iterdir())


def test_server_and_bridge_take_trial_1_from_the_existing_output(
        root: Path, tmp_path: Path) -> None:
    """Through the native server (a real job) and the in-browser bridge: the
    job of a reused trial 1 only skips, a changed setting computes."""
    cfg = ServerConfig(data_root=root)
    before = _snapshot(cfg.processed_dir)
    client = TestClient(create_app(cfg))
    (base,) = client.get("/api/datasets").json()
    run_id = client.post("/api/tuning/runs", json={
        "dataset_id": base["id"], "first_stage": "punch"}).json()["run_id"]

    def statuses(trial: str, params: dict) -> set[str]:
        r = client.post("/api/pipeline/run", json={
            "dataset_id": base["id"], "stages": ["punch"], "params": params,
            "tuning": {"run_id": run_id, "trial": trial}})
        assert r.status_code == 200, r.text
        job = _wait(client, r.json()["id"])
        assert job["status"] == "done", job
        events, _ = client.app.state.jobs.get(job["id"]).events_since(0)  # type: ignore[attr-defined]
        return {e["status"] for e in events if e.get("stage") == "punch"}

    assert statuses("punch-1", {}) == {"skip"}
    folder = root / "tuning" / run_id / "trials" / "punch-1"
    assert sorted(f.name for f in folder.iterdir()) == [
        f"{STEM}_ringremoved_braggpunched.h5", f"{STEM}_ringremoved_braggpunched_profile.json"]
    assert "done" in statuses("punch-1", {"punch_margin": 0.1})
    assert "done" in statuses("punch-2", {})
    assert _snapshot(cfg.processed_dir) == before

    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=25)
    webbridge.run("", "{}", flatten_enabled=True, force=True)
    processed = tmp_path / "work" / "processed"
    before = _snapshot(processed)
    for stages, trial, sync in (("rings", "rings-1", True), ("punch", "punch-1", False),
                                ("pdf,pdf_check", "pdf-1", False)):
        run_id = json.loads(
            webbridge.tuning_start_json(dataset_id, trial.split("-")[0]))["run_id"]
        log: list[str] = []

        def progress(_stage: str, status: str, _f: float | None, _m: str,
                     log: list[str] = log) -> None:
            log.append(status)

        if sync:
            webbridge.run(stages, "{}", True, progress=progress,
                          tuning_run=run_id, tuning_trial=trial)
        else:
            asyncio.run(webbridge.run_async(stages, "{}", True, progress=progress,
                                            tuning_run=run_id, tuning_trial=trial))
        assert set(log) == {"skip"}, (trial, log)
        assert json.loads(webbridge.tuning_promote_json(run_id, trial))["files"]
    assert _snapshot(processed) == before
