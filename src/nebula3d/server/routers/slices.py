# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Volume metadata and 2D-slice endpoints."""

from __future__ import annotations

from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from nebula3d.server import laue
from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import (
    StageStatus,
    flatten_input_of,
    punched_stage_of,
    resolve_volume,
)
from nebula3d.server.deps import get_config
from nebula3d.server.params import build_params
from nebula3d.server.schemas import (
    CoverageOut,
    LatticeOut,
    LaueCompareIn,
    LaueCompareOut,
    LaueProgressOut,
    RingIsotropyOut,
    ShellFloorsOut,
    TextureOut,
    UbCheckOut,
    VolumeMetaOut,
)
from nebula3d.server.volumes import (
    PLANES,
    TEXTURE_MAX_LIMIT,
    parse_ring_shells,
    slice_envelope,
    volume_coverage,
    volume_meta,
    volume_ring_isotropy,
    volume_shell_floors,
    volume_texture,
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
        sigma=m["sigma"],
        sigma_note=m["sigma_note"],
        flatten_settings=m["flatten_settings"],
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


@router.post("/{volume_id}/laue-compare", response_model=LaueCompareOut)
def laue_compare(
    volume_id: str, req: LaueCompareIn, cfg: ServerConfig = Depends(get_config),
) -> LaueCompareOut:
    """Every candidate Laue class compared by R_int, on all measured voxels
    and on the diffuse, with the rule's suggestion (analysis.laue_compare).
    The volume is read as the symmetry average reads its raw input: the run's
    edge trim first.  A volume symmetrized already is refused (422).  Poll
    the progress under ``req.token`` (``/{volume_id}/laue-compare/progress``)."""
    stage = _resolve_hkl(cfg, volume_id)
    try:
        params = build_params(SimpleNamespace(flatten_enabled=True, params=req.params))  # type: ignore[arg-type]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    def progress(fraction: float, message: str) -> None:
        laue.set_progress(req.token, fraction, message)

    laue.set_progress(req.token, 0.0, "starting")
    try:
        out = laue.laue_compare(stage.path, params, extra=req.extra, progress=progress)
    except ValueError as exc:  # symmetrized already, or a grid nothing maps
        raise HTTPException(422, str(exc)) from exc
    finally:
        laue.drop_progress(req.token)
    return LaueCompareOut(id=volume_id, **out)


@router.get("/{volume_id}/laue-compare/progress", response_model=LaueProgressOut)
def laue_compare_progress(volume_id: str, token: str = Query(...)) -> LaueProgressOut:
    """How far the comparison started under *token* has come."""
    return LaueProgressOut(**laue.progress_of(token))


def parse_shells(q: str, fwhm: str) -> list[tuple[float, float]]:
    """The shells a /rings request names (:func:`parse_ring_shells`), or a 400."""
    try:
        return parse_ring_shells(q, fwhm)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/{volume_id}/rings", response_model=RingIsotropyOut)
def rings(
    volume_id: str,
    q: str = Query(..., description="shell centres in Å⁻¹, comma-separated"),
    fwhm: str = Query(..., description="their widths in Å⁻¹, comma-separated"),
    cfg: ServerConfig = Depends(get_config),
) -> RingIsotropyOut:
    """Which of the shells are powder rings: each rises in nearly every direction."""
    stage = _resolve_hkl(cfg, volume_id)
    return RingIsotropyOut(id=volume_id, **volume_ring_isotropy(stage.path, parse_shells(q, fwhm)))


@router.get("/{volume_id}/shell-floors", response_model=ShellFloorsOut)
def shell_floors(
    volume_id: str,
    q_step: float | None = Query(None, gt=0, description="shell width, Å⁻¹ (default 0.05)"),
    percentile: float | None = Query(None, ge=0, le=100,
                                     description="the floor's percentile (default 25)"),
    min_count: int | None = Query(None, ge=1,
                                  description="fewer measured voxels: no floor (default 20)"),
    cfg: ServerConfig = Depends(get_config),
) -> ShellFloorsOut:
    """The floor of every |Q| shell over the whole volume, on the flatten's
    shells; for the flattened stage, also of the flatten's input (the
    backfilled stage) on the same shells, and the diffuse level."""
    stage = _resolve_hkl(cfg, volume_id)
    pair = flatten_input_of(cfg, volume_id)
    try:
        out = volume_shell_floors(stage.path, pair[1].path if pair else None, q_step=q_step,
                                  percentile=percentile, min_count=min_count)
    except ValueError as exc:  # too many shells for q_step
        raise HTTPException(422, str(exc)) from exc
    return ShellFloorsOut(id=volume_id, before_id=pair[0] if pair else None, **out)


@router.get("/{volume_id}/texture", response_model=TextureOut)
def texture(
    volume_id: str,
    limit: int = Query(20, ge=0, le=TEXTURE_MAX_LIMIT,
                       description="holes listed, farthest outside their range first"),
    min_sigma: float | None = Query(None, ge=0,
                                    description="a systematic bias's median in rim σ (0.5)"),
    one_way: float | None = Query(None, ge=0, le=1,
                                  description="its share of the judged holes one way (0.75)"),
    min_holes: int | None = Query(None, ge=1, description="its fewest judged holes (5)"),
    floor: float | None = Query(None, ge=0,
                                description="its median in units of the local level (0.2)"),
    cfg: ServerConfig = Depends(get_config),
) -> TextureOut:
    """Whether the backfill's fills sit systematically off the diffuse around
    their holes: the Pilot's texture_check rule on every punch hole of a
    backfilled stage, with its 3-D rim, against the dataset's punched stage."""
    stage = _resolve_hkl(cfg, volume_id)
    if stage.name != "backfilled":
        raise HTTPException(
            400, f"the fills' texture is measured on a backfilled stage, not {stage.name!r}")
    pair = punched_stage_of(cfg, volume_id)
    if pair is None:
        raise HTTPException(404, f"no punched stage on disk for {volume_id!r}")
    try:
        out = volume_texture(stage.path, pair[1].path, limit=limit, min_sigma=min_sigma,
                             one_way=one_way, min_holes=min_holes, floor=floor)
    except ValueError as exc:  # a limit out of range, or two stages on different grids
        raise HTTPException(422, str(exc)) from exc
    return TextureOut(id=volume_id, punched_id=pair[0], **out)


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
