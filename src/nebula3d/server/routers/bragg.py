# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Bragg peak profile review endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from nebula3d.server.config import ServerConfig
from nebula3d.server.deps import get_config
from nebula3d.server.modulation import bragg_profile_payload
from nebula3d.server.schemas import BraggProfileOut

router = APIRouter(prefix="/api/bragg", tags=["bragg"])


@router.get("/{dataset_id}/profile", response_model=BraggProfileOut)
def profile(
    dataset_id: str,
    cfg: ServerConfig = Depends(get_config),
) -> BraggProfileOut:
    """Return per-peak Bragg punch width metadata for one dataset, the nodes
    the punch's node test could not judge (``node_test``), if any, and what
    its search left alone (``modulation``)."""
    try:
        out = bragg_profile_payload(cfg, dataset_id)
    except (OSError, ValueError) as exc:
        raise HTTPException(500, f"could not read the Bragg profile: {exc}") from exc
    if out is None:
        raise HTTPException(404, f"unknown dataset id {dataset_id!r}")
    return BraggProfileOut(**out)
