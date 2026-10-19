# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The ring removal's record (its diagnostics, :mod:`nebula3d.server.rings`)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from nebula3d.server.config import ServerConfig
from nebula3d.server.deps import get_config
from nebula3d.server.rings import saved_ring_diagnostics
from nebula3d.server.schemas import RingDiagnosticsOut

router = APIRouter(prefix="/api/rings", tags=["rings"])


@router.get("/{dataset_id}/diagnostics", response_model=RingDiagnosticsOut)
def diagnostics(
    dataset_id: str,
    cfg: ServerConfig = Depends(get_config),
) -> RingDiagnosticsOut:
    """What the ring stage recorded of one dataset: the ring candidates it
    detected and could not confirm on its grid, which it did not subtract (a
    file read)."""
    try:
        out = saved_ring_diagnostics(cfg, dataset_id)
    except (OSError, ValueError) as exc:
        raise HTTPException(500, f"could not read the ring diagnostics: {exc}") from exc
    if out is None:
        raise HTTPException(404, f"unknown dataset id {dataset_id!r}")
    return RingDiagnosticsOut(**out)
