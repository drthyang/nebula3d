# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Tuning runs: every trial in its own folder, never in ``processed/``.

The web assistant's tuning run (``web/src/llm/tune``) tries several settings
for one stage at a time.  Each trial writes its stage output under

    <data_root>/tuning/<run>/trials/<stage>-<n>/

reading its upstream input from the run's own chain of chosen outputs,
``tuning/<run>/processed/``, or — for the stages before the run's first one —
from ``processed/``.  :func:`promote` copies the chosen trial's files into the
run's chain (the next stage builds on them) and deletes that stage's trials.
``processed/`` is only ever read.

Trial 1 of a stage is the current settings.  When the stage's existing output
(the run's chain, else ``processed/``) was made from exactly those settings
and the trial's input, it is not computed again: its files are put into the
trial folder as they are (:func:`reuse_existing_output`).

A run, or one trial of it, can be viewed as a dataset, so the slice, ΔPDF,
Bragg-profile and back-FFT-check endpoints measure a trial without knowing
about tuning:

- ``<dataset>~tune~<run>`` — the run's chain: each stage from the chain, the
  stages before the run's first one from ``processed/``;
- ``<dataset>~tune~<run>~<stage>-<n>`` — one trial: its stage from the trial
  folder, the stages before it as in the chain, none after it.

No FastAPI here: the in-browser bridge reuses this module.
"""

from __future__ import annotations

import ctypes
import json
import os
import re
import secrets
import shutil
import sys
import time
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from pathlib import Path

from nebula3d.pipeline import (
    PipelineParams,
    PipelinePaths,
    pipeline_paths,
    resolve_symmetry_average,
    resume_plan,
)
from nebula3d.server.config import ServerConfig

TUNING_DIR = "tuning"
VIEW_SEP = "~tune~"

#: The stages a tuning run steps through, in order (``pdf`` includes its check).
TUNE_STAGES: tuple[str, ...] = ("rings", "punch", "backfill", "flatten", "pdf")

#: The pipeline stages one trial of each tuning stage runs.
TRIAL_PIPELINE_STAGES: dict[str, tuple[str, ...]] = {
    "rings": ("rings",),
    "punch": ("punch",),
    "backfill": ("backfill",),
    "flatten": ("flatten",),
    "pdf": ("pdf", "pdf_check"),
}

#: The tuning stage that writes each :class:`~nebula3d.pipeline.PipelinePaths`
#: artifact.
ARTIFACT_STAGE: dict[str, str] = {
    "ringremoved": "rings",
    "ring_diagnostics_json": "rings",
    "braggpunched": "punch",
    "bragg_profile_json": "punch",
    "backfilled": "backfill",
    "flattened": "flatten",
    "delta_pdf": "pdf",
    "pdf_check_json": "pdf",
    "pdf_check_png": "pdf",
}

#: Each cleanup stage's output volume (the ``inputs`` keys of run_pipeline).
_STAGE_OUTPUT: dict[str, str] = {
    "rings": "ringremoved",
    "punch": "braggpunched",
    "backfill": "backfilled",
    "flatten": "flattened",
}

_RUN_RE = re.compile(r"^[0-9]{8}T[0-9]{6}-[0-9a-f]{4}$")
_TRIAL_RE = re.compile(r"^(rings|punch|backfill|flatten|pdf)-([1-9][0-9]{0,2})$")


@dataclass(frozen=True)
class Run:
    """One tuning run of one dataset."""

    id: str
    dataset_id: str
    raw_path: Path
    first_stage: str
    root: Path

    @property
    def chain(self) -> Path:
        """The run's own processed folder: the chosen output of each stage."""
        return self.root / "processed"

    def trial_dir(self, trial: str) -> Path:
        parse_trial(trial)
        return self.root / "trials" / trial

    @property
    def label_time(self) -> str:
        """``HH:MM`` of the run's start, for labels."""
        t = self.id.split("T", 1)[1]
        return f"{t[0:2]}:{t[2:4]}"


def tuning_root(cfg: ServerConfig) -> Path:
    return cfg.data_root / TUNING_DIR


def parse_trial(trial: str) -> tuple[str, int]:
    """``"punch-2"`` → ``("punch", 2)``; ValueError for anything else."""
    m = _TRIAL_RE.match(trial)
    if m is None:
        raise ValueError(
            f"bad trial {trial!r}; expected <stage>-<n> with stage one of {TUNE_STAGES}")
    return m.group(1), int(m.group(2))


def _stage_index(stage: str) -> int:
    if stage not in TUNE_STAGES:
        raise ValueError(f"bad stage {stage!r}; choose one of {TUNE_STAGES}")
    return TUNE_STAGES.index(stage)


def new_run(cfg: ServerConfig, dataset_id: str, raw_path: Path, first_stage: str) -> Run:
    """Create a run folder for *dataset_id*, starting at *first_stage*."""
    _stage_index(first_stage)
    run_id = f"{time.strftime('%Y%m%dT%H%M%S')}-{secrets.token_hex(2)}"
    root = tuning_root(cfg) / run_id
    (root / "processed").mkdir(parents=True)
    (root / "trials").mkdir()
    (root / "run.json").write_text(json.dumps({
        "dataset_id": dataset_id,
        "raw_name": raw_path.name,
        "first_stage": first_stage,
    }, indent=2))
    return Run(run_id, dataset_id, raw_path, first_stage, root)


def load_run(cfg: ServerConfig, run_id: str) -> Run | None:
    """The run *run_id*, or None when the id is malformed or unknown."""
    if not _RUN_RE.match(run_id):
        return None
    root = tuning_root(cfg) / run_id
    try:
        meta = json.loads((root / "run.json").read_text())
    except (OSError, ValueError):
        return None
    return Run(run_id, str(meta["dataset_id"]), cfg.raw_dir / str(meta["raw_name"]),
               str(meta["first_stage"]), root)


def list_runs(cfg: ServerConfig) -> list[Run]:
    root = tuning_root(cfg)
    if not root.is_dir():
        return []
    runs = [load_run(cfg, p.name) for p in sorted(root.iterdir()) if p.is_dir()]
    return [r for r in runs if r is not None]


def _artifact_dir(cfg: ServerConfig, run: Run, stage: str,
                  trial: str | None) -> Path | None:
    """Where the view reads *stage*'s artifacts (None: the view has none)."""
    if trial is not None:
        trial_stage, _ = parse_trial(trial)
        if stage == trial_stage:
            return run.trial_dir(trial)
        if _stage_index(stage) > _stage_index(trial_stage):
            return None
    if _stage_index(stage) >= _stage_index(run.first_stage):
        return run.chain
    return cfg.processed_dir


def artifact_paths(cfg: ServerConfig, run: Run, trial: str | None = None) -> dict[str, Path]:
    """Every pipeline artifact of the run's chain (or of one trial) → its path.

    An artifact the view does not have points into a folder that never exists.
    """
    from nebula3d.server.datasets import _find_delta_pdf  # noqa: PLC0415 - import cycle

    # The symmetry average is never tuned: the view takes processed/'s.
    out: dict[str, Path] = {
        "symmetrized": pipeline_paths(run.raw_path, proc_dir=cfg.processed_dir).symmetrized}
    for attr, stage in ARTIFACT_STAGE.items():
        folder = _artifact_dir(cfg, run, stage, trial)
        if folder is None:
            folder = run.root / "absent"
        path = getattr(pipeline_paths(run.raw_path, proc_dir=folder), attr)
        if attr == "delta_pdf" and folder == cfg.processed_dir:
            path = _find_delta_pdf(folder, run.raw_path.stem, path)
        out[attr] = path
    return out


def trial_target(cfg: ServerConfig, run_id: str, trial: str) -> tuple[Run, Path, dict[str, Path]]:
    """``(run, proc_dir, inputs)`` for running *trial* with run_pipeline.

    The trial folder is emptied first (a re-run must not inherit a sidecar
    from an earlier attempt).  *inputs* maps every cleanup stage before the
    trial's to the view's copy of its output — chain or ``processed/`` — so
    nothing upstream is read from, or written to, anywhere else.
    """
    run = load_run(cfg, run_id)
    if run is None:
        raise ValueError(f"unknown tuning run {run_id!r}")
    stage, _ = parse_trial(trial)
    if _stage_index(stage) < _stage_index(run.first_stage):
        raise ValueError(f"run {run_id} starts at {run.first_stage}; cannot try {stage}")
    folder = run.trial_dir(trial)
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    paths = artifact_paths(cfg, run, trial)
    inputs = {
        s: paths[_STAGE_OUTPUT[s]]
        for s in _STAGE_OUTPUT
        if _stage_index(s) < _stage_index(stage)
    }
    # The symmetry average (never tuned) is upstream of every trial.
    inputs["symmetry_average"] = paths["symmetrized"]
    return run, folder, inputs


#: The ring models that write the ring diagnostics beside their output
#: (:func:`nebula3d.pipeline.remove_rings`); the per-plane models write none.
_RING_MODELS_WITH_DIAGNOSTICS = frozenset({"pooled", "global", "global_v2", "sample_only"})


def _trial_files(stage: str, p: PipelineParams, paths: PipelinePaths) -> list[Path]:
    """The files a computed trial of *stage* leaves with the settings *p*:
    the stage's output and the side files written with it."""
    if stage == "rings":
        files = [paths.ringremoved]
        if p.rings.ring_model.strip().lower() in _RING_MODELS_WITH_DIAGNOSTICS:
            files.append(paths.ring_diagnostics_json)
        return files
    if stage == "punch":  # the punch record is a dataset of the output itself
        return [paths.braggpunched, paths.bragg_profile_json]
    if stage == "backfill":
        return [paths.backfilled]
    if stage == "flatten":
        return [paths.flattened]
    files = [paths.delta_pdf]
    if p.pdf_check_enabled:
        files.append(paths.pdf_check_json)
        if p.pdf_check_figure:
            files.append(paths.pdf_check_png)
    return files


def _clone(src: Path, dst: Path) -> None:
    """Copy *src* to *dst*, date included, as a file of its own: a
    copy-on-write clone where the filesystem has one (APFS: no data is
    copied, and neither file changes when the other is rewritten or deleted),
    else a plain copy.  Never a hard link: a trial folder is emptied and
    deleted while ``processed/`` must stay as it is."""
    if sys.platform == "darwin":
        try:
            clonefile = ctypes.CDLL(None, use_errno=True).clonefile
            clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32]
            clonefile.restype = ctypes.c_int
            if clonefile(os.fsencode(src.resolve()), os.fsencode(dst), 0) == 0:
                return
        except (OSError, AttributeError):
            pass
        dst.unlink(missing_ok=True)
    shutil.copy2(src, dst)


def reuse_existing_output(
    cfg: ServerConfig, run: Run, trial: str, params: PipelineParams,
    inputs: Mapping[str, Path], *,
    pdf_configs: Collection[str] | None = None,
) -> bool:
    """Make trial 1 of a stage from the stage's existing output, when that
    output is what the trial would compute; True when it was.

    Trial 1 is the current settings.  The stage's existing output (the run's
    chain, else ``processed/``) is taken when a resumed run would reuse it for
    this trial: :func:`nebula3d.pipeline.resume_plan`, with the trial's
    *params* and *inputs*, computes nothing — its record names the trial's
    input, edge trim, symmetry and settings, and it is not older than that
    input.  Its files are then cloned into the trial folder (emptied by
    :func:`trial_target`), every file a computed trial leaves; the plan is
    checked again on the trial folder, and the caller runs the trial without
    ``force``, so the run finds its output there and skips the stage.

    False — and the trial folder left empty, for the caller to compute the
    trial as before — for any other trial, a stage switched off, an output or
    a side file that is not there, and an output a resumed run would make
    again.  *pdf_configs*: as :func:`~nebula3d.pipeline.resume_plan` takes it.
    """
    stage, n = parse_trial(trial)
    if n != 1:
        return False
    stages = TRIAL_PIPELINE_STAGES[stage]
    p, _ = resolve_symmetry_average(params, run.raw_path)
    if not p.stage_enabled(stage):
        return False
    folder = run.trial_dir(trial)

    def current(proc_dir: Path) -> bool:
        files = _trial_files(stage, p, pipeline_paths(run.raw_path, proc_dir=proc_dir))
        return all(f.is_file() for f in files) and not resume_plan(
            run.raw_path, params, proc_dir=proc_dir, stages=stages, inputs=inputs,
            pdf_configs=pdf_configs)

    for source in (run.chain, cfg.processed_dir):
        try:
            if not current(source):
                continue
            for f in _trial_files(stage, p, pipeline_paths(run.raw_path, proc_dir=source)):
                _clone(f, folder / f.name)
            if current(folder):
                return True
        except OSError:
            pass
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)
    return False


def promote(cfg: ServerConfig, run_id: str, trial: str) -> list[str]:
    """Copy *trial*'s files into the run's chain; delete the stage's trials.

    The chain's artifacts of this stage and every later one are removed first,
    so nothing downstream of the new choice survives from an older one.
    Returns the copied file names.  ``processed/`` is not touched.
    """
    run = load_run(cfg, run_id)
    if run is None:
        raise ValueError(f"unknown tuning run {run_id!r}")
    stage, _ = parse_trial(trial)
    src = run.trial_dir(trial)
    files = sorted(p for p in src.iterdir() if p.is_file()) if src.is_dir() else []
    if not files:
        raise ValueError(f"trial {trial} of run {run_id} has no output to promote")
    chain_paths = pipeline_paths(run.raw_path, proc_dir=run.chain)
    for attr, s in ARTIFACT_STAGE.items():
        if _stage_index(s) >= _stage_index(stage):
            getattr(chain_paths, attr).unlink(missing_ok=True)
    for f in files:
        shutil.copy2(f, run.chain / f.name)
    for other in (run.root / "trials").glob(f"{stage}-*"):
        shutil.rmtree(other, ignore_errors=True)
    return [f.name for f in files]


def view_id(dataset_id: str, run_id: str, trial: str | None = None) -> str:
    return f"{dataset_id}{VIEW_SEP}{run_id}" + (f"~{trial}" if trial else "")


def parse_view_id(dataset_id: str) -> tuple[str, str, str | None] | None:
    """``(dataset, run, trial | None)`` for a tuning view id, else None."""
    if VIEW_SEP not in dataset_id:
        return None
    base, _, rest = dataset_id.partition(VIEW_SEP)
    run_id, _, trial = rest.partition("~")
    return base, run_id, (trial or None)
