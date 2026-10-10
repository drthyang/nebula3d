# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Volume metadata and 2D-slice endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import StageStatus, resolve_volume
from nebula3d.server.deps import get_config
from nebula3d.server.schemas import CoverageOut, LatticeOut, UbCheckOut, VolumeMetaOut
from nebula3d.server.volumes import (
    PLANES,
    slice_envelope,
    volume_coverage,
    volume_meta,
    volume_ub_check,
)

router = APIRouter(prefix="/api/volumes", tags=["volumes"])


def _resolve_hkl(cfg: ServerConfig, volume_id: str) -> StageStatus:
    """Resolve a volume id to an existing HKLVolume stage, or raise HTTP errors."""
    stage = resolve_volume(cfg, volume_id)
    if stage is None:
        raise HTTPException(404, f"unknown volume id {volume_id!r}")
    if not stage.path.exists():
        raise HTTPException(404, f"stage output not found for {volume_id!r}")
    if stage.kind != "hkl":
        raise HTTPException(
            400, f"{volume_id!r} is a {stage.kind} volume; use the ΔPDF endpoints")
    return stage


@router.get("/{volume_id}/meta", response_model=VolumeMetaOut)
def meta(volume_id: str, cfg: ServerConfig = Depends(get_config)) -> VolumeMetaOut:
    stage = _resolve_hkl(cfg, volume_id)
    m = volume_meta(stage.path)
    return VolumeMetaOut(
        id=volume_id, stage=stage.name, kind=stage.kind,
        shape=m["shape"], h_range=m["h_range"], k_range=m["k_range"],
        l_range=m["l_range"], lattice=LatticeOut(**m["lattice"]),
        ub_matrix=m.get("ub_matrix"),
        planes=m["planes"],
        symmetry=m.get("symmetry"),
        symmetry_ops=m.get("symmetry_ops"),
    )


@router.get("/{volume_id}/coverage", response_model=CoverageOut)
def coverage(volume_id: str, cfg: ServerConfig = Depends(get_config)) -> CoverageOut:
    """Where the volume's counts begin and end in |Q|: the ΔPDF band's limits."""
    stage = _resolve_hkl(cfg, volume_id)
    return CoverageOut(id=volume_id, **volume_coverage(stage.path))


def parse_cell(text: str) -> tuple[int, int, int]:
    """``"2,2,2"`` → (2, 2, 2): the Bragg nodes' spacing, positive integers."""
    try:
        cell = tuple(int(x) for x in text.split(","))
    except ValueError as exc:
        raise HTTPException(400, f"cell must be three integers, not {text!r}") from exc
    if len(cell) != 3 or min(cell) < 1:
        raise HTTPException(400, f"cell must be three positive integers, not {text!r}")
    return cell  # type: ignore[return-value]


@router.get("/{volume_id}/ub", response_model=UbCheckOut)
def ub_check(
    volume_id: str,
    cell: str = Query("1,1,1"),
    q_max: float | None = Query(None, gt=0),
    cfg: ServerConfig = Depends(get_config),
) -> UbCheckOut:
    """Whether the volume's UB puts its Bragg peaks (nodes every *cell*) on
    their nodes, and the refined UB."""
    stage = _resolve_hkl(cfg, volume_id)
    try:
        out = volume_ub_check(stage.path, parse_cell(cell), q_max)
    except ValueError as exc:  # too few peaks to fit
        raise HTTPException(422, str(exc)) from exc
    return UbCheckOut(id=volume_id, **out)


@router.get("/{volume_id}/slice")
def slice_(
    volume_id: str,
    plane: str = Query("hk"),
    value: float = Query(0.0),
    interp: bool = Query(False),
    cfg: ServerConfig = Depends(get_config),
) -> Response:
    stage = _resolve_hkl(cfg, volume_id)
    if plane not in PLANES:
        raise HTTPException(400, f"unknown plane {plane!r}; choose one of {PLANES}")
    body = slice_envelope(stage.path, plane=plane, value=value, interp=interp)
    return Response(content=body, media_type="application/octet-stream")
