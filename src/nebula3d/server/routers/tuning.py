# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Tuning-run endpoints: start a run, promote a trial into the run's chain.

Trials themselves run through ``POST /api/pipeline/run`` with a ``tuning``
target; see :mod:`nebula3d.server.tuning`.  Nothing here writes to
``processed/``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from nebula3d.server import tuning
from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import find_dataset
from nebula3d.server.deps import get_config
from nebula3d.server.schemas import (
    TuningPromoteIn,
    TuningPromoteOut,
    TuningRunIn,
    TuningRunOut,
)

router = APIRouter(prefix="/api/tuning", tags=["tuning"])


@router.post("/runs", response_model=TuningRunOut)
def start_run(req: TuningRunIn, cfg: ServerConfig = Depends(get_config)) -> TuningRunOut:
    """Create a run folder for a dataset, starting at ``first_stage``."""
    ds = find_dataset(cfg, req.dataset_id)
    if ds is None or tuning.parse_view_id(req.dataset_id) is not None:
        raise HTTPException(404, f"unknown dataset {req.dataset_id!r}")
    try:
        run = tuning.new_run(cfg, ds.id, ds.raw_path, req.first_stage)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return TuningRunOut(run_id=run.id, dataset_id=tuning.view_id(ds.id, run.id))


@router.post("/runs/{run_id}/promote", response_model=TuningPromoteOut)
def promote(run_id: str, req: TuningPromoteIn,
            cfg: ServerConfig = Depends(get_config)) -> TuningPromoteOut:
    """Copy one trial's output into the run's chain; drop the stage's trials."""
    try:
        files = tuning.promote(cfg, run_id, req.trial)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    run = tuning.load_run(cfg, run_id)
    assert run is not None
    return TuningPromoteOut(run_id=run_id, trial=req.trial, files=files,
                            dataset_id=tuning.view_id(run.dataset_id, run_id))
