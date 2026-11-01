"""Record-based resume (THY-57): each stage output records what it was made
from — its input and that input's identity, the edge trim, the symmetry and
the stage's settings — and a resumed run makes an output again when its record
no longer matches the run, with every output after it; without Force.

The stage computations are stubbed (fast, deterministic); the symmetry average,
the records and the resume rule are the real ones.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from types import SimpleNamespace

import h5py
import numpy as np
import pytest

import nebula3d
from nebula3d import pipeline
from nebula3d.demo import demo_volume

CUBIC = ("background", "sro", "tds", "bragg")  # the demo without its 4/mmm rods: m-3m
ALL_AFTER_RAW = ["rings", "punch", "backfill", "flatten", "pdf", "pdf_check"]


class _FakeDpdf:
    """What write_delta_pdf_h5 reads of a DeltaPDF."""

    def __init__(self, shape=(8, 8, 8)):
        self.data = np.zeros(shape)
        self.x_axis = self.y_axis = self.z_axis = np.linspace(-1, 1, shape[0])
        self.q_max = 1.0
        self.apodization = "gaussian"
        self.window_shape = "separable"
        self.window_ellipsoid = None


@pytest.fixture
def stubbed(monkeypatch):
    """Stub the stages' compute (the symmetry average stays real): each stub
    records its name and hands its input volume on."""
    calls: list[str] = []

    def mk(name):
        def stub(v, params=None, *, progress=None, **_facts):
            calls.append(name)
            return v
        return stub

    for name, fn in (("rings", "remove_rings"), ("punch", "punch_bragg"),
                     ("backfill", "backfill"), ("flatten", "flatten")):
        monkeypatch.setattr(pipeline, fn, mk(name))

    def pdf_stub(v, params=None, *, progress=None):
        calls.append("pdf")
        return _FakeDpdf()

    def check_stub(vol, dpdf, params, *, h_values=(0.0,), figure_path=None,
                   consume_dpdf=False):
        calls.append("pdf_check")
        if figure_path is not None:
            Path(figure_path).write_bytes(b"")
        return {"pearson_r": 1.0, "normalized_rms": 0.0}

    monkeypatch.setattr(pipeline, "delta_pdf", pdf_stub)
    monkeypatch.setattr(pipeline, "pdf_consistency_check", check_stub)
    return SimpleNamespace(calls=calls)


@pytest.fixture
def raw(tmp_path):
    path = tmp_path / "raw" / "cubic.nxs"
    path.parent.mkdir()
    nebula3d.save(demo_volume(17, extent=3.0, components=CUBIC, dtype=np.float32), path)
    return path


def _run(raw, p=None, **kw):
    events: list[tuple] = []
    paths = pipeline.run_pipeline(raw, p, proc_dir=raw.parent.parent / "proc",
                                  progress=lambda *a: events.append(a), **kw)
    return paths, events


def _plan(raw, p=None, **kw):
    return pipeline.resume_plan(raw, p, proc_dir=raw.parent.parent / "proc", **kw)


def _skipped(events):
    return {e[0] for e in events if e[1] == "skip"}


def _with_laue(laue: str, **kw) -> pipeline.PipelineParams:
    return pipeline.PipelineParams(
        symmetry_average_enabled=True,
        symmetry_average=pipeline.SymmetryAverageParams(laue=laue), **kw)


# ---------------------------------------------------------------------------
# The records
# ---------------------------------------------------------------------------
def test_every_output_records_what_it_was_made_from(raw, stubbed):
    paths, _ = _run(raw, _with_laue("m-3m"))
    sym = pipeline.read_stage_record(paths.symmetrized)
    assert sym["stage"] == "symmetry_average" and sym["source_file"] == "cubic.nxs"
    assert sym["edge_trim"] == 1 and sym["source"]["edge_trim"] == 1
    assert sym["source"]["raw"]["size"] == raw.stat().st_size
    assert sym["symmetry"] == "auto" and len(sym["settings"]["ops"].split(";")) == 48
    rings = pipeline.read_stage_record(paths.ringremoved)
    assert rings["source_file"] == paths.symmetrized.name and "edge_trim" not in rings
    assert set(rings["source"]) == {"record"}
    assert rings["settings"]["ring_model"] == pipeline.RingParams().ring_model
    assert pipeline.read_stage_record(paths.braggpunched)["settings"]["modulation"] is None
    assert pipeline.read_stage_record(paths.flattened)["settings"]["estimator"] == "model"
    logs = nebula3d.io.load_delta_pdf(paths.delta_pdf, read_data=False).logs
    assert logs["source_record"] and "edge_trim" not in logs


def test_unchanged_settings_reuse_every_output(raw, stubbed):
    _run(raw, _with_laue("m-3m"))
    stubbed.calls.clear()
    assert _plan(raw, _with_laue("m-3m")) == {}
    _, events = _run(raw, _with_laue("m-3m"))
    assert stubbed.calls == []
    assert _skipped(events) == {"symmetry_average", *ALL_AFTER_RAW}
    assert not any("stale" in e[3] for e in events)


# ---------------------------------------------------------------------------
# A changed edge trim, Laue class or stage setting
# ---------------------------------------------------------------------------
def test_a_changed_edge_trim_makes_every_output_after_the_raw_load_again(raw, stubbed):
    paths, _ = _run(raw)
    stubbed.calls.clear()
    p = pipeline.PipelineParams(edge_trim=2)
    plan = _plan(raw, p)
    assert plan["rings"] == "it was made with edge trim 1, now 2"
    assert plan["punch"] == f"its input {paths.ringremoved.name} is made again first"
    assert set(plan) == set(ALL_AFTER_RAW)

    _, events = _run(raw, p)
    assert stubbed.calls == ALL_AFTER_RAW               # no Force
    assert (("rings", "progress", None, f"{paths.ringremoved.name} stale — recomputing")
            in events)
    assert pipeline.read_stage_record(paths.ringremoved)["edge_trim"] == 2
    stubbed.calls.clear()
    assert _plan(raw, p) == {}
    _run(raw, p)
    assert stubbed.calls == []


def test_a_changed_edge_trim_reaches_the_stages_after_the_symmetry_average(raw, stubbed):
    _run(raw, _with_laue("m-3m"))
    stubbed.calls.clear()
    p = _with_laue("m-3m", edge_trim=0)
    assert _plan(raw, p)["symmetry_average"] == "it was made with edge trim 1, now 0"
    _, events = _run(raw, p)
    assert stubbed.calls == ALL_AFTER_RAW
    assert "symmetry_average" not in _skipped(events)


def test_a_changed_laue_class_makes_the_average_and_every_output_after_it_again(
        raw, stubbed):
    paths, _ = _run(raw, _with_laue("m-3m"))
    stubbed.calls.clear()
    plan = _plan(raw, _with_laue("4/mmm"))
    assert plan["symmetry_average"] == "it was averaged over another Laue class"
    assert plan["rings"] == f"its input {paths.symmetrized.name} is made again first"
    assert set(plan) == {"symmetry_average", *ALL_AFTER_RAW}

    _, events = _run(raw, _with_laue("4/mmm"))
    assert stubbed.calls == ALL_AFTER_RAW
    assert _skipped(events) == set()
    assert len(pipeline.read_stage_record(paths.symmetrized)["settings"]["ops"].split(";")) == 16
    stubbed.calls.clear()
    _run(raw, _with_laue("4/mmm"))
    assert stubbed.calls == []


def test_a_changed_stage_setting_leaves_the_stages_before_it_alone(raw, stubbed):
    _run(raw)
    stubbed.calls.clear()
    p = pipeline.PipelineParams()
    p.backfill = dataclasses.replace(p.backfill, local_radius=3)
    plan = _plan(raw, p)
    assert plan["backfill"] == "it was made with other settings (local_radius)"
    assert set(plan) == {"backfill", "flatten", "pdf", "pdf_check"}
    _, events = _run(raw, p)
    assert stubbed.calls == ["backfill", "flatten", "pdf", "pdf_check"]
    assert {"rings", "punch"} <= _skipped(events)


def test_a_changed_symmetry_setting_or_modulation_makes_the_outputs_again(raw, stubbed):
    _run(raw)
    assert _plan(raw, pipeline.PipelineParams(symmetry=None))["rings"] == (
        "it was made with another symmetry setting")
    plan = _plan(raw, pipeline.PipelineParams(modulation={"k": "1/3, 0, 0"}))
    assert plan["punch"] == "it was made with other settings (modulation)"
    assert "rings" not in plan


def test_a_changed_raw_input_makes_every_output_again(raw, stubbed):
    _run(raw)
    vol = nebula3d.load(raw)
    vol.data = vol.data * 2.0
    nebula3d.save(vol, raw)
    assert _plan(raw)["rings"] == "cubic.nxs changed since it was made"


def test_a_copied_raw_input_is_the_same_input(raw, stubbed, tmp_path):
    """The raw input's identity is its size and sampled content, not its date:
    a copy of the data folder (re-dated) reuses its outputs."""
    import os

    _run(raw)
    later = raw.stat().st_mtime + 3600
    os.utime(raw, (later, later))
    assert _plan(raw) == {}


def test_an_output_older_than_its_input_is_made_again(raw, stubbed):
    """A stage re-run alone (the stages after it not in that run) re-dates its
    output: the outputs after it were made from what it held before."""
    import os

    paths, _ = _run(raw)
    t = paths.ringremoved.stat().st_mtime
    os.utime(paths.braggpunched, (t - 10, t - 10))
    plan = _plan(raw)
    assert plan["punch"] == f"it is older than {paths.ringremoved.name}"
    assert "rings" not in plan and set(plan) == {"punch", "backfill", "flatten", "pdf",
                                                  "pdf_check"}


def test_the_ring_stage_gate_follows_the_records(raw, stubbed):
    _run(raw)
    proc = raw.parent.parent / "proc"
    assert not pipeline.ring_stage_pending(raw, proc_dir=proc)
    assert pipeline.ring_stage_pending(raw, pipeline.PipelineParams(edge_trim=3), proc_dir=proc)


# ---------------------------------------------------------------------------
# Outputs written before the records: made again
# ---------------------------------------------------------------------------
def _drop_record(path: Path) -> None:
    with h5py.File(path, "a") as fh:
        del fh["MDHistoWorkspace/nebula3d"].attrs["stage_record"]


def test_an_output_that_records_nothing_is_made_again_with_those_after_it(raw, stubbed):
    paths, _ = _run(raw)
    _drop_record(paths.braggpunched)
    plan = _plan(raw)
    assert plan["punch"] == pipeline.NO_RECORD_REASON
    assert set(plan) == {"punch", "backfill", "flatten", "pdf", "pdf_check"}
    stubbed.calls.clear()
    _run(raw)
    assert stubbed.calls == ["punch", "backfill", "flatten", "pdf", "pdf_check"]
    assert pipeline.read_stage_record(paths.braggpunched) is not None


def test_a_delta_pdf_that_records_no_input_is_made_again(raw, stubbed):
    paths, _ = _run(raw)
    with h5py.File(paths.delta_pdf, "a") as fh:
        hits: list[str] = []
        fh.visit(lambda name: hits.append(name) if name.endswith("source_record") else None)
        for name in hits:
            del fh[name]
    assert hits
    assert _plan(raw) == {"pdf": pipeline.NO_RECORD_REASON,
                          "pdf_check": f"its input {paths.delta_pdf.name} is made again first"}


def test_a_folder_without_its_raw_input_still_compares_the_rest(raw, stubbed):
    """With only the processed outputs (the raw input gone), the raw input's
    identity cannot be compared and is not; the settings still are."""
    _run(raw)
    raw.unlink()
    assert _plan(raw) == {}
    assert _plan(raw, pipeline.PipelineParams(edge_trim=2))["rings"] == (
        "it was made with edge trim 1, now 2")


# ---------------------------------------------------------------------------
# The Configure page's stage track: the server and the browser
# ---------------------------------------------------------------------------
def test_the_server_lists_the_outputs_a_run_would_make_again(tmp_path, stubbed):
    from fastapi.testclient import TestClient

    from nebula3d.server.app import create_app
    from nebula3d.server.config import ServerConfig

    cfg = ServerConfig(data_root=tmp_path)
    cfg.raw_dir.mkdir(parents=True)
    raw = cfg.raw_dir / "cubic.nxs"
    nebula3d.save(demo_volume(17, extent=3.0, components=CUBIC, dtype=np.float32), raw)
    pipeline.run_pipeline(raw, proc_dir=cfg.processed_dir)
    client = TestClient(create_app(cfg))
    (ds,) = client.get("/api/datasets").json()

    same = client.post("/api/pipeline/stale", json={"dataset_id": ds["id"], "params": {}})
    assert same.status_code == 200 and same.json() == {"stale": {}}
    trimmed = client.post("/api/pipeline/stale", json={
        "dataset_id": ds["id"], "params": {"edge_trim": 2}}).json()["stale"]
    assert trimmed["ringremoved"] == "it was made with edge trim 1, now 2"
    assert set(trimmed) == {"ringremoved", "braggpunched", "backfilled", "flattened",
                            "delta_pdf"}
    assert client.post("/api/pipeline/stale", json={
        "dataset_id": "nope", "params": {}}).status_code == 404


def test_the_browser_lists_them_too(tmp_path, stubbed):
    from nebula3d import webbridge

    webbridge.setup(workdir=str(tmp_path / "work"))
    dataset_id = webbridge.make_demo_input(n=9)
    webbridge.run("", "{}", flatten_enabled=True)
    assert json.loads(webbridge.stale_outputs_json(dataset_id, "{}", True)) == {"stale": {}}
    stale = json.loads(webbridge.stale_outputs_json(
        dataset_id, json.dumps({"edge_trim": 2}), True))["stale"]
    assert stale["ringremoved"] == "it was made with edge trim 1, now 2"
    assert "delta_pdf" in stale
