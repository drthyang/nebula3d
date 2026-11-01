# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The Bragg punch's record for the API.

The punch stage writes its record beside the punched volume
(``*_braggpunched_profile.json``): the peaks it punched and, where its node
test could not judge every node it examined, ``node_test``: how many nodes,
the grid against the limit the node test's background shell needs, and the
notice its run log ends on (:func:`nebula3d.pipeline.node_test_notice`). The
run log holds it for one session's run; the record holds it for as long as
the output it describes.

FastAPI-free, like :mod:`nebula3d.server.rings`: the router
(:mod:`nebula3d.server.routers.bragg`) and the browser bridge
(:func:`nebula3d.webbridge.bragg_profile_json`) serve the same fields.
"""

from __future__ import annotations

from typing import Any


def node_test_out(record: object) -> dict[str, Any] | None:
    """The punch record's ``node_test``, its fields only, or None (none, or not one)."""
    if not isinstance(record, dict):
        return None
    try:
        notice = record.get("notice")
        return {"examined": int(record["examined"]), "under_floor": int(record["under_floor"]),
                "min_voxels": int(record["min_voxels"]), "voxel_q": float(record["voxel_q"]),
                "needs_q": float(record["needs_q"]),
                "left_to_search": bool(record["left_to_search"]),
                "notice": None if notice is None else str(notice)}
    except (KeyError, TypeError, ValueError):
        return None


def misorientation_out(record: object) -> dict[str, Any] | None:
    """The punch record's ``misorientation`` (THY-60), or None (none, or not one)."""
    if not isinstance(record, dict) or not isinstance(record.get("status"), str):
        return None
    return dict(record)


def tail_sweep_out(record: object) -> dict[str, Any] | None:
    """The punch record's ``tail_sweep`` (THY-60), or None (none, or not one)."""
    if (not isinstance(record, dict) or not isinstance(record.get("setting"), str)
            or not isinstance(record.get("ran"), bool)):
        return None
    return dict(record)
