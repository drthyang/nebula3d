# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Candidate Laue classes compared by R_int, for the Configure page and the Pilot.

The FastAPI-free half of ``POST /api/volumes/{id}/laue-compare`` and of the
browser's ``webbridge.volume_laue_compare_json``: the volume read as the
symmetry average (pipeline stage 0) would read it — the raw input, its
coverage edge trimmed by the run's ``edge_trim`` (:func:`nebula3d.pipeline.load_input`)
— then :func:`nebula3d.analysis.laue_compare.compare_laue_classes` with the
run's punch cell and punch footprint.  Results are cached by the file, its
mtime and every setting that changes them, so the Pilot's call after the
page's own (or the page's again) costs nothing.  A long comparison reports its
progress under a token the client polls (:func:`progress_of`).
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from nebula3d.analysis.laue_compare import bragg_radius_from_punch, compare_laue_classes
from nebula3d.pipeline import PipelineParams, declared_group, load_input

ProgressFn = Callable[[float, str], None]

_CACHE_MAX = 8
_cache: OrderedDict[tuple, dict[str, Any]] = OrderedDict()
_progress: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


class SymmetrizedInputError(ValueError):
    """The volume declares a symmetry it was averaged over: its equivalents
    agree by construction, and R_int cannot show which class the sample has."""


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def _key(path: Path, params: PipelineParams, extra: Sequence[str]) -> tuple:
    node, origin, _ = bragg_radius_from_punch(params.punch)
    return (str(path), path.stat().st_mtime, int(params.edge_trim), str(params.precision),
            tuple(int(x) for x in params.punch.supercell), round(node, 9), round(origin, 9),
            tuple(str(x).strip() for x in extra if str(x).strip()))


def set_progress(token: str | None, fraction: float | None, message: str,
                 *, running: bool = True) -> None:
    """Record a comparison's progress under *token* (none: not recorded)."""
    if not token:
        return
    with _lock:
        _progress[token] = {"fraction": fraction, "message": message, "running": running}


def progress_of(token: str) -> dict[str, Any]:
    """The progress recorded under *token*: ``{fraction, message, running}``;
    not running when there is none (finished, or never started)."""
    with _lock:
        return dict(_progress.get(token) or {"fraction": None, "message": "", "running": False})


def drop_progress(token: str | None) -> None:
    if token:
        with _lock:
            _progress.pop(token, None)


def laue_compare(path: Path, params: PipelineParams, *, extra: Sequence[str] = (),
                 progress: ProgressFn | None = None) -> dict[str, Any]:
    """Compare the candidate Laue classes of the raw volume *path* by R_int.

    *params* are the run's settings: its ``edge_trim`` (the raw input is
    trimmed as stage 0 trims it), its precision and its punch (the Bragg
    nodes' cell and the neighbourhood the diffuse reading leaves out).
    *extra* adds classes beyond the presets (the user's custom generators).
    Raises :class:`SymmetrizedInputError` for a volume that declares the
    symmetry it was averaged over.  The payload is
    :meth:`~nebula3d.analysis.laue_compare.LaueComparison.to_dict` with the
    file's name and the edge trim.
    """
    path = Path(path)
    declared = declared_group(path)
    if declared is not None:
        label, order = declared
        raise SymmetrizedInputError(
            f"{path.name} declares {label} ({order} operations): it is symmetrized already, so "
            "its equivalent voxels agree by construction and R_int cannot show which class the "
            "sample has. Compare the classes on the unsymmetrized volume.")
    key = _key(path, params, extra)
    with _lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
    if hit is not None:
        if progress is not None:
            progress(1.0, "done")
        return hit
    if progress is not None:
        progress(0.0, "reading the raw volume")
    vol = load_input(path, params, stage="symmetry_average")
    cmp = compare_laue_classes(vol, cell=params.punch.supercell, punch=params.punch,
                               extra=extra, progress=progress)
    del vol
    out = {"volume": path.name, "edge_trim": int(params.edge_trim), **cmp.to_dict()}
    with _lock:
        _cache[key] = out
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return out
