# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Bragg peak profile review endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from nebula3d.server.config import ServerConfig
from nebula3d.server.deps import etag_matches, get_config
from nebula3d.server.modulation import bragg_profile_etag, bragg_profile_payload
from nebula3d.server.schemas import BraggProfileOut

router = APIRouter(prefix="/api/bragg", tags=["bragg"])


@router.get("/{dataset_id}/profile", response_model=BraggProfileOut)
def profile(
    dataset_id: str,
    request: Request,
    response: Response,
    cfg: ServerConfig = Depends(get_config),
) -> BraggProfileOut | Response:
    """Return per-peak Bragg punch width metadata for one dataset, the nodes
    the punch's node test could not judge (``node_test``), if any, and what
    its search left alone (``modulation``).

    It carries an ETag (:func:`~nebula3d.server.modulation.bragg_profile_etag`):
    asked again with it in If-None-Match, it answers 304 with no body while
    the record stands, so the console reads a large record once."""
    tag = bragg_profile_etag(cfg, dataset_id)
    if tag is None:
        raise HTTPException(404, f"unknown dataset id {dataset_id!r}")
    headers = {"ETag": tag, "Cache-Control": "no-cache"}
    if etag_matches(request, tag):
        return Response(status_code=304, headers=headers)
    try:
        out = bragg_profile_payload(cfg, dataset_id)
    except (OSError, ValueError) as exc:
        raise HTTPException(500, f"could not read the Bragg profile: {exc}") from exc
    if out is None:
        raise HTTPException(404, f"unknown dataset id {dataset_id!r}")
    response.headers.update(headers)
    return BraggProfileOut(**out)
