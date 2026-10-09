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

import json
import re
import secrets
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from nebula3d.pipeline import pipeline_paths
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

    out: dict[str, Path] = {}
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
    return run, folder, inputs


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
