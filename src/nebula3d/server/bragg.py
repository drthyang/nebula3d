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
(:func:`nebula3d.webbridge.bragg_profile_json`) serve the same fields. So is
:func:`volume_bragg_sense`, the pre-run sensing of a raw volume's Bragg peaks
(POST /api/volumes/{id}/bragg-sense, the bridge's ``volume_bragg_sense_json``).
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from nebula3d.pipeline import PipelineParams


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


# The pre-run Bragg sensing's record (analysis.bragg_sense), small: one
# volume's at a time, keyed by the file, its mtime and every setting it reads.
_sense_cache: dict[tuple, dict[str, Any]] = {}


def volume_bragg_sense(path: Path, params: PipelineParams) -> dict[str, Any]:
    """The raw volume's Bragg peaks sensed before a run
    (:func:`nebula3d.analysis.bragg_sense.sense_bragg`): the volume loaded as
    the run loads it (*params*, a :class:`~nebula3d.pipeline.PipelineParams`:
    its edge trim and precision), each footprint modelled with its punch
    settings, and whether the file declares a symmetry (its operations, or a
    class declared for it beside it). Returns the record with ``lines``, its few
    lines for NEBULA Pilot (:func:`~nebula3d.analysis.bragg_sense.sense_lines`)."""
    import dataclasses

    from nebula3d.analysis.bragg_sense import sense_bragg, sense_lines
    from nebula3d.pipeline import load_input
    from nebula3d.server.volumes import declared_for
    from nebula3d.symmetry import read_symmetry_ops

    punch = params.punch
    key = (str(path), path.stat().st_mtime, int(params.edge_trim), str(params.precision),
           tuple(sorted((k, repr(v)) for k, v in dataclasses.asdict(punch).items())))
    hit = _sense_cache.get(key)
    if hit is not None:
        return hit
    declared = read_symmetry_ops(path) is not None or declared_for(path) is not None
    vol = load_input(path, params)
    record = sense_bragg(vol, punch, declared=declared)
    del vol
    out = {**record, "lines": sense_lines(record)}
    _sense_cache.clear()
    _sense_cache[key] = out
    return out
