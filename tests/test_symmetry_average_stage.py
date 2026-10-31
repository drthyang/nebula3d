"""The symmetry average as the pipeline's stage 0 (``symmetry_average``).

Off by default.  Switched on with a Laue class, it averages the raw volume
(its coverage edge trimmed first) before the ring removal, writes
``<stem>_symmetrized.h5`` declaring its operations as the NeXus Viewer's export
does, and the stages after it read that symmetry there.  It refuses what the
viewer would not do or warns against: no Laue class, a grid the operations do
not map, operations that change the cell's metric by more than 2 %.  An input
symmetrized already passes through unless asked to be averaged again.
"""

from __future__ import annotations

import dataclasses
import json

import h5py
import numpy as np
import pytest

import nebula3d
from nebula3d import pipeline
from nebula3d.analysis.delta_pdf import WindowSupportError
from nebula3d.demo import demo_volume
from nebula3d.server.params import build_params
from nebula3d.symmetry import GridSymmetry, laue_group, read_symmetry_ops, symmetry_average
from nebula3d.utils import ub_from_lattice

CUBIC = ("background", "sro", "tds", "bragg")  # the demo without its 4/mmm rods: m-3m


def _cubic_with_gap(n: int = 25) -> nebula3d.HKLVolume:
    """A small m-3m crystal (the demo's FCC model, rods left out) whose k = 0
    plane was never measured: a gap through Q = 0, open to the box faces, as
    an unsymmetrized volume has.  The ΔPDF's window then has no room."""
    vol = demo_volume(n, extent=3.0, components=CUBIC, dtype=np.float32)
    gap = np.zeros(vol.data.shape, dtype=bool)
    gap[:, n // 2, :] = True
    vol.mask &= ~gap
    vol.data[gap] = 0.0
    vol.sigma[gap] = 0.0
    return vol


def _off_all_cleanup(**kw) -> pipeline.PipelineParams:
    """Straight from the symmetry average to the ΔPDF (the stages between off)."""
    return pipeline.PipelineParams(rings_enabled=False, punch_enabled=False,
                                   backfill_enabled=False, flatten_enabled=False,
                                   pdf_check_enabled=False, **kw)


def _symmetrized(laue: str | None, **kw) -> pipeline.PipelineParams:
    return _off_all_cleanup(symmetry_average_enabled=True,
                            symmetry_average=pipeline.SymmetryAverageParams(laue=laue, **kw))


@pytest.fixture
def gap_input(tmp_path):
    path = tmp_path / "raw" / "cubic_gap.nxs"
    path.parent.mkdir()
    nebula3d.save(_cubic_with_gap(), path)
    return path


# ---------------------------------------------------------------------------
# What it fixes: the ΔPDF of an unsymmetrized volume with a gap through Q = 0
# ---------------------------------------------------------------------------
def test_a_gap_through_q0_stops_the_delta_pdf_without_the_stage(tmp_path, gap_input):
    with pytest.raises(WindowSupportError, match="Symmetrize here"):
        pipeline.run_pipeline(gap_input, _off_all_cleanup(), proc_dir=tmp_path / "proc",
                              stages=("pdf",))


def test_the_symmetry_average_lets_that_volume_through(tmp_path, gap_input):
    events: list[tuple] = []
    paths = pipeline.run_pipeline(gap_input, _symmetrized("m-3m"), proc_dir=tmp_path / "proc",
                                  stages=("symmetry_average", "pdf"),
                                  progress=lambda *a: events.append(a))
    assert paths.symmetrized.exists() and paths.delta_pdf.exists()
    assert paths.pdf_input == paths.symmetrized
    done = [e[3] for e in events if e[0] == "symmetry_average" and e[1] == "done"]
    assert len(done) == 1 and "m-3m: 48 operations, pooled with equal weight" in done[0]
    assert "metric (UB) kept to 0.00%" in done[0]
    vol = nebula3d.load(paths.symmetrized)
    c = vol.data.shape[1] // 2
    # The gap filled from its equivalents, but for the voxels next to the
    # origin: the edge trim, before the average, took the planes beside the gap
    # too, so the orbits within one voxel of Q = 0 (their members all in those
    # three planes) stay unmeasured, a hole enclosed by measured voxels.
    near = np.zeros(vol.data.shape, dtype=bool)
    near[c - 1:c + 2, c - 1:c + 2, c - 1:c + 2] = True
    assert np.array_equal(~vol.mask, near)


# ---------------------------------------------------------------------------
# The output: the viewer's declaration, and what the stages after it read
# ---------------------------------------------------------------------------
def test_the_output_declares_the_operations_as_the_viewer_writes_them(tmp_path, gap_input):
    paths = pipeline.run_pipeline(gap_input, _symmetrized("m-3m"), proc_dir=tmp_path,
                                  stages=("symmetry_average",))
    with h5py.File(paths.symmetrized, "r") as f:
        attrs = f["MDHistoWorkspace/nebula3d"].attrs
        assert attrs["symmetry"] == "m-3m"
        assert attrs["symmetry_ops"] == laue_group("m-3m").ops_text
        assert attrs["source_file"] == "cubic_gap.nxs"
    assert len(read_symmetry_ops(paths.symmetrized)) == 48
    record = pipeline.read_symmetry_average(paths.symmetrized)
    assert record["laue"] == "m-3m" and record["order"] == 48
    assert record["edge_trim"] == 1 and record["source_file"] == "cubic_gap.nxs"
    assert record["metric_change"] == pytest.approx(0.0, abs=1e-12)
    assert record["measured_after"] - record["measured_before"] == record["filled"] > 0


def test_the_stage_averages_what_symmetry_average_averages_after_the_edge_trim(tmp_path,
                                                                             gap_input):
    paths = pipeline.run_pipeline(gap_input, _symmetrized("m-3m"), proc_dir=tmp_path,
                                  stages=("symmetry_average",))
    expect = pipeline.load_input(gap_input, pipeline.PipelineParams())  # trimmed, as the stage
    symmetry_average(expect, GridSymmetry.for_volume(expect, laue_group("m-3m").ops))
    got = nebula3d.load(paths.symmetrized, dtype=None)
    assert np.array_equal(got.mask, expect.mask)
    assert np.array_equal(got.data, expect.data)


def test_the_stages_after_it_read_the_symmetry_and_keep_declaring_it(tmp_path, gap_input,
                                                                     monkeypatch):
    seen: dict[str, object] = {}

    def punch(v, params=None, *, progress=None, symmetry=None, **_facts):
        seen["punch"] = symmetry
        return v

    def backfill(v, params=None, *, progress=None, symmetry=None):
        seen["backfill"] = symmetry
        return v

    monkeypatch.setattr(pipeline, "remove_rings", lambda v, params=None, *, progress=None: v)
    monkeypatch.setattr(pipeline, "punch_bragg", punch)
    monkeypatch.setattr(pipeline, "backfill", backfill)
    monkeypatch.setattr(pipeline, "flatten", lambda v, params=None, *, progress=None: v)
    p = pipeline.PipelineParams(symmetry_average_enabled=True,
                                symmetry_average=pipeline.SymmetryAverageParams(laue="m-3m"))
    paths = pipeline.run_pipeline(gap_input, p, proc_dir=tmp_path,
                                  stages=("symmetry_average", "rings", "punch", "backfill",
                                          "flatten"))
    assert seen["punch"] is not None and seen["punch"].order == 48
    assert seen["backfill"] is not None and seen["backfill"].order == 48
    for out in (paths.ringremoved, paths.braggpunched, paths.backfilled, paths.flattened):
        assert len(read_symmetry_ops(out)) == 48, out.name
    # A partial re-run of the punch alone reads the symmetry from its own input.
    seen.clear()
    pipeline.run_pipeline(gap_input, p, proc_dir=tmp_path, stages=("punch",), force=True)
    assert seen["punch"].order == 48


def test_the_ring_stage_reads_the_symmetrized_volume(tmp_path, gap_input, monkeypatch):
    got: dict[str, object] = {}

    def rings(v, params=None, *, progress=None):
        got["mask"] = v.mask.copy()
        return v

    monkeypatch.setattr(pipeline, "remove_rings", rings)
    p = pipeline.PipelineParams(symmetry_average_enabled=True,
                                symmetry_average=pipeline.SymmetryAverageParams(laue="m-3m"))
    paths = pipeline.run_pipeline(gap_input, p, proc_dir=tmp_path,
                                  stages=("symmetry_average", "rings"))
    assert np.array_equal(got["mask"], nebula3d.load(paths.symmetrized).mask)


# ---------------------------------------------------------------------------
# Off by default; refusals
# ---------------------------------------------------------------------------
def test_off_by_default_it_writes_nothing_and_says_nothing(tmp_path, gap_input, monkeypatch):
    monkeypatch.setattr(pipeline, "remove_rings", lambda v, params=None, *, progress=None: v)
    events: list[tuple] = []
    paths = pipeline.run_pipeline(gap_input, proc_dir=tmp_path, stages=("symmetry_average",
                                                                        "rings"),
                                  progress=lambda *a: events.append(a))
    assert not paths.symmetrized.exists()
    assert not [e for e in events if e[0] == "symmetry_average"]
    assert pipeline.PipelineParams().symmetry_average_enabled is False


def test_switched_on_without_a_laue_class_it_refuses_before_any_work(tmp_path, gap_input):
    with pytest.raises(pipeline.SymmetryAverageError, match="needs the sample's Laue class"):
        pipeline.run_pipeline(gap_input, _symmetrized(None), proc_dir=tmp_path,
                              stages=("symmetry_average",))
    with pytest.raises(pipeline.SymmetryAverageError, match="averages nothing"):
        pipeline.run_pipeline(gap_input, _symmetrized("1"), proc_dir=tmp_path,
                              stages=("symmetry_average",))
    assert not (tmp_path / "cubic_gap_symmetrized.h5").exists()


def test_operations_that_are_no_symmetry_of_the_cell_are_refused(tmp_path):
    # A hexagonal Laue class on a cubic cell: the metric changes by 100 %.
    path = tmp_path / "cubic.nxs"
    nebula3d.save(_cubic_with_gap(), path)
    with pytest.raises(pipeline.SymmetryAverageError,
                       match=r"change this cell's metric by up to \d+% \(more than 2%\)"):
        pipeline.run_pipeline(path, _symmetrized("6/mmm"), proc_dir=tmp_path,
                              stages=("symmetry_average",))
    assert not (tmp_path / "cubic_symmetrized.h5").exists()


def test_a_pseudo_symmetric_cell_within_two_percent_is_averaged_and_reported(tmp_path):
    vol = _cubic_with_gap()
    vol.ub_matrix = ub_from_lattice(4.2, 4.2 * 1.01, 4.2, 90, 90, 90)  # b 1 % longer
    path = tmp_path / "pseudo.nxs"
    nebula3d.save(vol, path)
    events: list[tuple] = []
    pipeline.run_pipeline(path, _symmetrized("m-3m"), proc_dir=tmp_path,
                          stages=("symmetry_average",), progress=lambda *a: events.append(a))
    done = next(e[3] for e in events if e[0] == "symmetry_average" and e[1] == "done")
    assert "metric (UB) kept to 2.0" in done or "metric (UB) kept to 1.9" in done


def test_a_grid_the_operations_do_not_map_is_refused_with_the_remedy(tmp_path):
    vol = _cubic_with_gap()
    vol = dataclasses.replace(vol, l_axis=vol.l_axis * 0.5)  # L steps half of H's and K's
    path = tmp_path / "squashed.nxs"
    nebula3d.save(vol, path)
    with pytest.raises(pipeline.SymmetryAverageError,
                       match="does not map this volume's HKL grid onto itself.*Re-bin"):
        pipeline.run_pipeline(path, _symmetrized("m-3m"), proc_dir=tmp_path,
                              stages=("symmetry_average",))


def test_build_params_refuses_a_laue_class_the_viewer_would_not_read():
    from types import SimpleNamespace

    class Params:
        def __init__(self, **kw):
            self.__dict__.update(kw)

        def __getattr__(self, name):
            return None

    def req(**kw):
        return SimpleNamespace(flatten_enabled=True, params=Params(**kw))

    p = build_params(req(symmetry_average_enabled=True, symmetry_average_laue=" 6/mmm "))
    assert p.symmetry_average_enabled and p.symmetry_average.laue == "6/mmm"
    assert build_params(req(symmetry_average_laue="")).symmetry_average.laue is None
    with pytest.raises(ValueError, match="not a Laue class"):
        build_params(req(symmetry_average_enabled=True, symmetry_average_laue="6/mm"))
    # switched off, a half-typed class is no error
    assert not build_params(req(symmetry_average_laue="6/mm")).symmetry_average_enabled


# ---------------------------------------------------------------------------
# An input symmetrized already; resume and staleness
# ---------------------------------------------------------------------------
def _declared(path, ops_text, label):
    with h5py.File(path, "a") as f:
        attrs = f["MDHistoWorkspace/nebula3d"].attrs
        attrs["symmetry"] = label
        attrs["symmetry_ops"] = ops_text


def test_an_input_symmetrized_already_passes_through(tmp_path, gap_input):
    _declared(gap_input, laue_group("m-3m").ops_text, "m-3m")
    events: list[tuple] = []
    paths = pipeline.run_pipeline(gap_input, _symmetrized("m-3m"), proc_dir=tmp_path,
                                  stages=("symmetry_average",),
                                  progress=lambda *a: events.append(a))
    assert not paths.symmetrized.exists()
    skip = [e[3] for e in events if e[0] == "symmetry_average" and e[1] == "skip"]
    assert len(skip) == 1
    assert "declares m-3m (48 operations): it is symmetrized already" in skip[0]
    assert "Average again" in skip[0]
    # Asked to, it averages it again.
    pipeline.run_pipeline(gap_input, _symmetrized("m-3m", reaverage=True), proc_dir=tmp_path,
                          stages=("symmetry_average",))
    assert paths.symmetrized.exists()


def test_an_unsymmetrized_viewer_export_declaring_the_identity_is_averaged(tmp_path, gap_input):
    _declared(gap_input, "h,k,l", "none")  # the viewer's export without a Laue class
    paths = pipeline.run_pipeline(gap_input, _symmetrized("m-3m"), proc_dir=tmp_path,
                                  stages=("symmetry_average",))
    assert paths.symmetrized.exists()


def test_an_output_of_another_laue_class_is_made_again_not_reused(tmp_path, gap_input):
    run = dict(proc_dir=tmp_path, stages=("symmetry_average",))
    paths = pipeline.run_pipeline(gap_input, _symmetrized("m-3m"), **run)
    events: list[tuple] = []
    pipeline.run_pipeline(gap_input, _symmetrized("m-3m"),
                          progress=lambda *a: events.append(a), **run)
    assert ("symmetry_average", "skip", None, f"{paths.symmetrized.name} exists") in events
    events.clear()
    pipeline.run_pipeline(gap_input, _symmetrized("4/mmm"),
                          progress=lambda *a: events.append(a), **run)
    assert ("symmetry_average", "progress", None,
            f"{paths.symmetrized.name} stale — recomputing") in events
    assert pipeline.read_symmetry_average(paths.symmetrized)["laue"] == "4/mmm"
    events.clear()
    pipeline.run_pipeline(gap_input, dataclasses.replace(_symmetrized("4/mmm"), edge_trim=2),
                          progress=lambda *a: events.append(a), **run)
    assert any(e[3].endswith("stale — recomputing") for e in events)


def test_the_symmetrized_stage_is_listed_between_raw_and_the_ring_removal(tmp_path, gap_input):
    from nebula3d.server.config import ServerConfig
    from nebula3d.server.datasets import HKL_STAGES, discover_datasets

    cfg = ServerConfig(data_root=tmp_path)
    proc = cfg.processed_dir
    proc.mkdir(parents=True, exist_ok=True)
    pipeline.run_pipeline(gap_input, _symmetrized("m-3m"), proc_dir=proc,
                          stages=("symmetry_average",))
    (ds,) = discover_datasets(cfg)
    names = [s.name for s in ds.stages]
    assert names[:3] == ["raw", "symmetrized", "ringremoved"]
    assert next(s for s in ds.stages if s.name == "symmetrized").exists
    assert HKL_STAGES[:3] == ("raw", "symmetrized", "ringremoved")


def test_the_record_is_json_with_the_numbers_the_log_gives(tmp_path, gap_input):
    paths = pipeline.run_pipeline(gap_input, _symmetrized("m-3m"), proc_dir=tmp_path,
                                  stages=("symmetry_average",))
    with h5py.File(paths.symmetrized, "r") as f:
        raw = f["MDHistoWorkspace/nebula3d"].attrs["symmetry_average"]
    record = json.loads(raw)
    assert set(record) >= {"laue", "generators", "order", "metric_change", "measured_before",
                           "measured_after", "filled", "orbits", "r_int", "sigma_defaulted",
                           "source_file", "edge_trim"}


# ---------------------------------------------------------------------------
# The native server's run path, and tuning trials
# ---------------------------------------------------------------------------
def test_the_server_runs_the_stage_and_refuses_a_bad_laue_class(tmp_path, gap_input):
    import time

    from fastapi.testclient import TestClient

    from nebula3d.server.app import create_app
    from nebula3d.server.config import ServerConfig

    cfg = ServerConfig(data_root=tmp_path)
    client = TestClient(create_app(cfg))
    (ds,) = client.get("/api/datasets").json()
    on = {"symmetry_average_enabled": True, "symmetry_average_laue": "m-3m"}
    bad = client.post("/api/pipeline/run", json={
        "dataset_id": ds["id"], "stages": ["symmetry_average"],
        "params": {**on, "symmetry_average_laue": "6/mm"}})
    assert bad.status_code == 400 and "not a Laue class" in bad.text
    r = client.post("/api/pipeline/run", json={
        "dataset_id": ds["id"], "stages": ["symmetry_average"], "params": on,
        "force_from": "symmetry_average"})
    assert r.status_code == 200, r.text
    deadline = time.time() + 120
    while (job := client.get(f"/api/pipeline/jobs/{r.json()['id']}").json())["status"] == "running":
        assert time.time() < deadline
        time.sleep(0.2)
    assert job["status"] == "done", job
    (ds,) = client.get("/api/datasets").json()
    sym = next(s for s in ds["stages"] if s["name"] == "symmetrized")
    assert sym["exists"] and sym["volume_id"] == f"{ds['id']}.symmetrized"
    meta = client.get(f"/api/volumes/{sym['volume_id']}/meta").json()
    assert meta["symmetry"] == "m-3m" and len(meta["symmetry_ops"]) == 48


def test_a_tuning_trial_takes_the_symmetrized_volume_from_processed(tmp_path, gap_input):
    """The symmetry average is never tuned: a ring trial reads processed/'s,
    never the raw input, when the stage is on."""
    from nebula3d.server import tuning
    from nebula3d.server.config import ServerConfig

    cfg = ServerConfig(data_root=tmp_path)
    p = _symmetrized("m-3m")
    pipeline.run_pipeline(gap_input, p, proc_dir=cfg.processed_dir,
                          stages=("symmetry_average",))
    run = tuning.new_run(cfg, "cubic-gap", gap_input, "rings")
    _run, folder, inputs = tuning.trial_target(cfg, run.id, "rings-1")
    symmetrized = cfg.processed_dir / "cubic_gap_symmetrized.h5"
    assert inputs == {"symmetry_average": symmetrized} and symmetrized.exists()
    trial = pipeline._run_paths(gap_input, p, proc_dir=folder)
    assert pipeline._stage_input("rings", p, trial, ("rings",), inputs) == symmetrized
    view = tuning.artifact_paths(cfg, run, "rings-1")
    assert view["symmetrized"] == symmetrized
