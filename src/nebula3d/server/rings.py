# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The ring removal's record for the API.

The ring stage writes its diagnostics beside the ring-removed volume
(``*_ringremoved_diagnostics.json``). Of them the console reads what the
pooled model's confirmation could not judge on the grid: the shells it
detected and did not subtract, how many, what the grid needs, and the notice
the run log gives them (:func:`nebula3d.pipeline.unconfirmed_rings_notice`).
The run log holds it for one session's run; the record holds it for as long
as the output it describes, so the Pilot's ring check and the report say it
too.

FastAPI-free, like :mod:`nebula3d.server.consistency`: the router
(:mod:`nebula3d.server.routers.rings`) and the browser bridge
(:func:`nebula3d.webbridge.ring_diagnostics_json`) serve the same payload.
"""

from __future__ import annotations

import json
from typing import Any

from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import artifact_path, find_dataset


def _unconfirmed(record: object) -> dict[str, Any] | None:
    """The diagnostics' ``unconfirmed_at_grid``, its fields only, or None (none, or not one)."""
    if not isinstance(record, dict):
        return None
    try:
        return {"count": int(record["count"]), "needs": str(record["needs"]),
                "notice": str(record["notice"]),
                "q_centers": [float(q) for q in record.get("q_centers", [])]}
    except (KeyError, TypeError, ValueError):
        return None


def saved_ring_diagnostics(cfg: ServerConfig, dataset_id: str) -> dict[str, Any] | None:
    """The ring stage's record of a dataset, from its diagnostics: their
    ``status`` and ``unconfirmed_at_grid``, the shells it detected and could
    not confirm as powder rings on its grid (``count``, ``needs``, ``notice``,
    ``q_centers``), which it did not subtract; None where it left none.

    ``None`` for an unknown dataset. ``has_diagnostics`` is false when the
    stage wrote none (a model that writes none, or no run), or when they are
    older than the ring-removed volume (a later run of a model that writes
    none), since they then describe a removal that no longer exists. Raises
    ``ValueError`` for diagnostics that are not JSON.
    """
    ds = find_dataset(cfg, dataset_id)
    if ds is None:
        return None
    path = artifact_path(cfg, ds, "ring_diagnostics_json")
    volume = artifact_path(cfg, ds, "ringremoved")
    data: object = None
    if path.exists() and not (
        volume.exists() and volume.stat().st_mtime > path.stat().st_mtime
    ):
        data = json.loads(path.read_text(encoding="utf-8"))
    record = data if isinstance(data, dict) else {}
    status = record.get("status")
    return {
        "dataset_id": dataset_id,
        "diagnostics_path": str(path),
        "has_diagnostics": isinstance(data, dict),
        "status": status if isinstance(status, str) else None,
        "unconfirmed_at_grid": _unconfirmed(record.get("unconfirmed_at_grid")),
    }
