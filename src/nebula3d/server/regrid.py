# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Regridding a dataset onto its refined UB, as a new dataset.

Shared by ``POST /api/datasets/{id}/regrid`` and the browser bridge
(:func:`nebula3d.webbridge.dataset_regrid_json`), so the two return the same
fields.  FastAPI-free, like the other helpers the bridge reuses.

The new file goes beside the dataset's raw volume, in ``raw/``, where dataset
discovery lists it as a dataset of its own (:mod:`nebula3d.server.datasets`):
its id is its stem's, and its pipeline outputs are named after it, so they
never touch the original dataset's.  See :mod:`nebula3d.analysis.ub_regrid`.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from nebula3d.analysis.ub_refine import UB_TURN, Ops
from nebula3d.analysis.ub_regrid import TARGET_EXISTS, Regridded, regrid_dataset
from nebula3d.server import datasets as _ds
from nebula3d.server.config import ServerConfig
from nebula3d.server.volumes import symmetry_ops_for


def regrid_dataset_out(cfg: ServerConfig, dataset_id: str,
                       cell: tuple[int, int, int] = (1, 1, 1), q_max: float | None = None,
                       symmetrise: bool = False, *,
                       dtype: np.dtype | type | None = None) -> dict:
    """Regrid *dataset_id*'s raw volume onto its refined UB, as a new dataset.

    The operations come as the UB check takes them (:func:`symmetry_ops_for`),
    and the fit is the UB check's (:func:`nebula3d.analysis.ub_refine.check_ub`):
    the turn it reports is the one ``GET /api/volumes/{id}.raw/ub`` gives.  A
    new file whose dataset id is in use already (by another file's stem, or by
    pipeline outputs left without their raw volume, which the new dataset
    would inherit) is refused like an existing one.

    Returns the JSON fields (see :func:`regrid_out`).  Raises ``KeyError`` for
    an unknown dataset, ``FileNotFoundError`` when it has no raw volume, and
    ``ValueError`` when too few peaks are found to fit.
    """
    ds = _ds.find_dataset(cfg, dataset_id)
    if ds is None:
        raise KeyError(f"unknown dataset id {dataset_id!r}")
    raw = ds.raw_path
    if not raw.is_file():
        raise FileNotFoundError(f"dataset {dataset_id!r} has no raw volume to regrid "
                                f"({raw.name} is not in {raw.parent})")
    ops, ops_from = symmetry_ops_for(raw)
    in_use = {d.id: d for d in _ds.discover_datasets(cfg)}

    def taken(target: Path) -> str | None:
        other = in_use.get(_ds._slug(target.stem))
        if other is None:
            return None
        held = (f"by {other.raw_name}" if other.raw_path.is_file()
                else "by pipeline outputs whose raw volume is gone")
        return (f"The new dataset's id {other.id!r} is in use already, {held}: "
                f"{target.name} would be listed under it and inherit its outputs. "
                "Nothing was written.")

    result = regrid_dataset(raw, data_root=cfg.data_root, ops=ops, ops_from=ops_from,
                            cell=cell, q_max=q_max, symmetrise=symmetrise, dtype=dtype,
                            taken=taken)
    return regrid_out(dataset_id, result, ops=ops, ops_from=ops_from)


def regrid_out(dataset_id: str, r: Regridded, *, ops: Ops | None,
               ops_from: str | None) -> dict:
    """The JSON fields of a :class:`~nebula3d.analysis.ub_regrid.Regridded`.

    ``written`` and ``refusal`` (``{code, reason}``, or ``None``) say what
    happened; ``dataset_id`` and ``file`` name the new dataset and its file
    (or the existing one a ``target_exists`` refusal names); ``turn_deg`` is
    the fit's turn and ``turn_threshold_deg`` the 0.05° rule; ``ub_start`` and
    ``ub`` the UB before and after; ``symmetrised`` whether the new file is;
    ``voxels_outside`` the voxels measured before whose Q fell outside the
    old grid, unmeasured now, and ``voxels_outside_share`` their share of
    ``measured_before``.  Fields a refusal came before are ``None``.
    """
    check = r.check
    f = None if check is None else check.refinement.fit
    present = r.written or (r.refusal is not None and r.refusal.code == TARGET_EXISTS
                            and os.path.lexists(r.target))

    def rounded(m: object) -> list:
        return np.round(np.asarray(m, dtype=float), 8).tolist()

    return {
        "id": dataset_id,
        "written": r.written,
        "refusal": (None if r.refusal is None
                    else {"code": r.refusal.code, "reason": r.refusal.reason}),
        "dataset_id": _ds._slug(r.target.stem) if present else None,
        "file": r.target.name if present else None,
        "source_file": r.source.name,
        "refined_on": None if r.refined_on is None else r.refined_on.name,
        "fit": r.fit,
        "operations": None if ops is None else len(ops),
        "operations_from": ops_from,
        "source_symmetrised": r.source_symmetrised,
        "symmetrised": r.symmetrised,
        "turn_deg": None if f is None else float(f.angle_deg),
        "turn_threshold_deg": UB_TURN,
        "axis_uvw": None if f is None else rounded(f.axis_uvw),
        "ub_start": None if f is None else rounded(f.ub_start),
        "ub": None if f is None else rounded(f.ub),
        "cell_start": None if f is None else [float(x) for x in f.cell_start],
        "cell": None if f is None else [float(x) for x in f.cell],
        "rms_start": None if f is None else float(f.rms_start),
        "rms": None if f is None else float(f.rms),
        "n_used": None if f is None else f.n_used,
        "measured_before": r.measured_before,
        "measured_after": r.measured_after,
        "voxels_outside": r.voxels_outside,
        "voxels_outside_share": r.voxels_outside_share,
    }
