# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The stages' switches (the Configure page's "Enable stage"), known answers on
the validation's dev rings case at 121³, built in code.

A run with a stage switched off follows a run with every stage on, which left
that stage's output on disk. The stage after it must read what came before it,
never that output, and every output of the run must equal, bit for bit, a fresh
run with the stage off; the old output is left as it was. A stage left out of
`stages` with its switch on is still a partial re-run, reading the output on
disk. Before the fix the page sent a switch only as a stage left out, so the
stage after it read the old output.
"""

from __future__ import annotations

import dataclasses
import json
import shutil
from pathlib import Path

import h5py
import numpy as np
import pytest

from nebula3d.io import load_delta_pdf
from nebula3d.io.hkl_reader import save
from nebula3d.pipeline import (
    STAGES,
    PipelineParams,
    PipelinePaths,
    pipeline_paths,
    run_pipeline,
)
from nebula3d.server.params import build_params
from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn
from nebula3d.validation import build, case_named

N = 121
CASE = "dev-rings"

#: Each switch's stage: the stage after it, and what that one reads with it off.
SWITCHES = {
    "rings": ("punch", "input"),
    "punch": ("backfill", "ringremoved"),
    "backfill": ("flatten", "braggpunched"),
}
#: The files each stage writes (PipelinePaths' names).
WRITES = {
    "rings": ("ringremoved", "ring_diagnostics_json"),
    "punch": ("braggpunched", "bragg_profile_json"),
    "backfill": ("backfilled",),
    "flatten": ("flattened",),
    "pdf": ("delta_pdf", "pdf_check_json"),
}
NAMES = {"rings": "ring removal", "punch": "Bragg punch", "backfill": "backfill",
         "flatten": "flatten"}


@pytest.fixture(scope="module")
def raw(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp(CASE) / "raw" / f"{CASE}.nxs"
    path.parent.mkdir()
    save(build(case_named(CASE), N).raw, path)
    return path


@pytest.fixture(scope="module")
def all_on(raw: Path, tmp_path_factory: pytest.TempPathFactory) -> PipelinePaths:
    """A run with every stage on, as the page's Run with nothing switched off."""
    return run_pipeline(raw, PipelineParams(), proc_dir=tmp_path_factory.mktemp("all-on"))


def _page_params(**switches: bool) -> PipelineParams:
    """The settings as the page sends them: every switch, through the server."""
    flags = {f"{s}_enabled": switches.get(s, True) for s in ("rings", "punch", "backfill")}
    return build_params(PipelineRunRequest(dataset_id="x", params=StageParamsIn(**flags)))


def _page_stages(off: str | None = None) -> tuple[str, ...]:
    """The stages the page runs: those switched on."""
    return tuple(s for s in STAGES if s != off)


def _numbers(path: Path) -> dict[str, np.ndarray]:
    """Every numeric dataset of an HDF5 file (it also records when it was written)."""
    out: dict[str, np.ndarray] = {}
    with h5py.File(path, "r") as f:

        def visit(name: str, obj: object) -> None:
            if isinstance(obj, h5py.Dataset) and obj.dtype.kind in "biuf":
                out[name] = obj[()]

        f.visititems(visit)
    return out


def _record(path: Path) -> object:
    """A JSON record without its timings (the ring diagnostics' timing_s)."""
    def drop(x: object) -> object:
        if isinstance(x, dict):
            return {k: drop(v) for k, v in x.items() if k != "timing_s"}
        return [drop(v) for v in x] if isinstance(x, list) else x

    return drop(json.loads(path.read_text()))


def _same(a: Path, b: Path) -> bool:
    """The two artifacts hold the same numbers (a JSON record: the same record)."""
    if a.suffix == ".json":
        return _record(a) == _record(b)
    na, nb = _numbers(a), _numbers(b)
    return na.keys() == nb.keys() and all(
        np.array_equal(na[k], nb[k], equal_nan=True) for k in na)


def _pdf_source(paths: PipelinePaths) -> str:
    """The volume the run's ΔPDF records it was made from."""
    return str(load_delta_pdf(paths.delta_pdf, read_data=False).logs["source_file"])


@pytest.mark.parametrize("off", list(SWITCHES))
def test_a_stage_switched_off_after_a_run_equals_a_fresh_run_with_it_off(
        raw: Path, all_on: PipelinePaths, tmp_path: Path, off: str) -> None:
    after_dir = tmp_path / "after"
    shutil.copytree(all_on.delta_pdf.parent, after_dir)
    params = _page_params(**{off: False})
    events: list[tuple] = []
    after = run_pipeline(raw, params, proc_dir=after_dir, stages=_page_stages(off),
                         force=True, progress=lambda *a: events.append(a))
    fresh = run_pipeline(raw, params, proc_dir=tmp_path / "fresh", stages=_page_stages(off))

    # The stage after it read what came before it, and said so.
    nxt, source = SWITCHES[off]
    reads = f"{NAMES[off]} disabled: the {NAMES[nxt]} reads {getattr(after, source).name}"
    assert (nxt, "progress", None, reads) in events
    # Every output equals the fresh run's, bit for bit.
    written = [attr for stage in STAGES[STAGES.index(nxt):] for attr in WRITES.get(stage, ())]
    for attr in written:
        assert getattr(fresh, attr).exists(), attr
        assert _same(getattr(after, attr), getattr(fresh, attr)), attr
    assert _pdf_source(after) == _pdf_source(fresh) == after.pdf_input.name
    # The switch changed the run: the stage after it differs from the all-on run's.
    nxt_out = WRITES[nxt][0]
    assert not _same(getattr(after, nxt_out), getattr(all_on, nxt_out)), nxt_out
    # The switched-off stage's own output: left as the first run wrote it, and
    # never written by the fresh run.
    for attr in WRITES[off]:
        assert getattr(after, attr).read_bytes() == getattr(all_on, attr).read_bytes(), attr
        assert not getattr(fresh, attr).exists(), attr


def test_a_stage_left_out_still_reads_the_stored_output(
        raw: Path, all_on: PipelinePaths, tmp_path: Path) -> None:
    """The ring removal left out, its switch on (the Pilot's re-run from the
    punch): the punch reads the ring-removed volume on disk, so the run's
    outputs are the all-on run's, bit for bit. A tuning trial of the punch
    reads the one its `inputs` name, as before."""
    rerun_dir = tmp_path / "rerun"
    shutil.copytree(all_on.delta_pdf.parent, rerun_dir)
    events: list[tuple] = []
    rerun = run_pipeline(raw, _page_params(), proc_dir=rerun_dir, stages=STAGES[1:],
                         force=True, progress=lambda *a: events.append(a))
    for stage in STAGES[1:]:
        for attr in WRITES.get(stage, ()):
            assert _same(getattr(rerun, attr), getattr(all_on, attr)), attr
    assert not any("disabled" in ev[3] for ev in events)

    trial = run_pipeline(raw, _page_params(), proc_dir=tmp_path / "trial", stages=("punch",),
                         force=True, inputs={"rings": all_on.ringremoved})
    assert _same(trial.braggpunched, all_on.braggpunched)
    assert not trial.ringremoved.exists()


def test_every_switch_on_as_the_page_sends_it_is_the_default_run(
        raw: Path, all_on: PipelinePaths, tmp_path: Path) -> None:
    """The page sends every switch; all on, the run is the default one, its
    outputs the all-on run's, bit for bit."""
    params = _page_params()
    assert dataclasses.asdict(params) == dataclasses.asdict(PipelineParams())
    paths = run_pipeline(raw, params, proc_dir=tmp_path / "on")
    for attrs in WRITES.values():
        for attr in attrs:
            assert _same(getattr(paths, attr), getattr(all_on, attr)), attr
    assert paths.pdf_input == paths.flattened
    assert pipeline_paths(raw, proc_dir=tmp_path / "on").pdf_input == paths.flattened
