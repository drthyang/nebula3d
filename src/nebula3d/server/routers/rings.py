# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Global powder-ring removal diagnostic endpoints."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException

from nebula3d.pipeline import pipeline_paths
from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import find_dataset
from nebula3d.server.deps import get_config
from nebula3d.server.schemas import RingDiagnosticsOut

router = APIRouter(prefix="/api/rings", tags=["rings"])


@router.get("/{dataset_id}/diagnostics", response_model=RingDiagnosticsOut)
def diagnostics(
    dataset_id: str,
    cfg: ServerConfig = Depends(get_config),
) -> RingDiagnosticsOut:
    """Return the persisted global ring-fit diagnostics for one dataset."""
    ds = find_dataset(cfg, dataset_id)
    if ds is None:
        raise HTTPException(404, f"unknown dataset id {dataset_id!r}")

    paths = pipeline_paths(ds.raw_path, proc_dir=cfg.processed_dir)
    path = paths.ring_diagnostics_json
    if not path.exists():
        return RingDiagnosticsOut(
            dataset_id=dataset_id,
            diagnostics_path=str(path),
            has_diagnostics=False,
        )

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(
            500, f"could not read ring diagnostics {path.name}: {exc}") from exc

    return RingDiagnosticsOut(
        dataset_id=dataset_id,
        diagnostics_path=str(path),
        has_diagnostics=True,
        schema_version=int(data.get("schema_version", 1)),
        algorithm=data.get("algorithm"),
        status=data.get("status"),
        material_mode=data.get("material_mode"),
        subtraction_policy=data.get("subtraction_policy"),
        fitted_al_lattice_a=data.get("fitted_al_lattice_a"),
        n_detected_candidates=int(data.get("n_detected_candidates", 0)),
        n_rejected_shells=int(data.get("n_rejected_shells", 0)),
        n_fitted_shells=int(data.get("n_fitted_shells", 0)),
        n_valid_voxels=int(data.get("n_valid_voxels", 0)),
        n_profile_voxels=int(data.get("n_profile_voxels", 0)),
        fit_seconds=float(data.get("fit_seconds", 0.0)),
        removed_energy_fraction=float(data.get("removed_energy_fraction", 0.0)),
        negative_flip_fraction=float(data.get("negative_flip_fraction", 0.0)),
        median_angular_coverage=float(data.get("median_angular_coverage", 0.0)),
        warnings=list(data.get("warnings", [])),
        rejection_reasons=list(data.get("rejection_reasons", [])),
        effective_config=dict(data.get("effective_config", {})),
        shells=list(data.get("shells", [])),
    )
