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


def test_bridge_tuning_run_leaves_processed_byte_identical(tmp_path: Path) -> None:
    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=24)
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
