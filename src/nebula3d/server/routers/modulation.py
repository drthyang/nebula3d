# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The sample's modulation (:mod:`nebula3d.server.modulation`): checking a
declaration, and the labels of the positions a run's search left alone."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from nebula3d.server.config import ServerConfig
from nebula3d.server.deps import get_config
from nebula3d.server.modulation import check_payload, labels_envelope
from nebula3d.server.schemas import ModulationCheckIn, ModulationCheckOut

router = APIRouter(prefix="/api/modulation", tags=["modulation"])


@router.post("/check", response_model=ModulationCheckOut)
def check(body: ModulationCheckIn) -> ModulationCheckOut:
    """What a declaration means before a run: its description and the
    positions it protects, on the cell and closed under the symmetry given, or
    the error that stops it (``ok`` false, still a 200)."""
    return ModulationCheckOut(**check_payload(body.modulation, cell=body.cell,
                                              symmetry_ops=body.symmetry_ops))


@router.get("/{dataset_id}/labels")
def labels(
    dataset_id: str,
    plane: str = Query("hk"),
    value: float = Query(0.0),
    interp: bool = Query(False),
    cfg: ServerConfig = Depends(get_config),
) -> Response:
    """Which protected position each voxel of a slice of the punched stage
    lies in (the slice wire format; ``legend`` in its header), from the
    punch's record of the run."""
    try:
        body = labels_envelope(cfg, dataset_id, plane, value, interp)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, f"could not read the punch's record: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if body is None:
        raise HTTPException(404, f"unknown dataset id {dataset_id!r}")
    return Response(content=body, media_type="application/octet-stream")
