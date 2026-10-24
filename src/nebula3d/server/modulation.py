# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The sample's modulation for the API (:mod:`nebula3d.modulation`).

Three payloads, FastAPI-free like :mod:`nebula3d.server.rings`, so the router
(:mod:`nebula3d.server.routers.modulation`, and the Bragg profile's
:mod:`nebula3d.server.routers.bragg`) and the browser bridge
(:mod:`nebula3d.webbridge`) serve the same bytes:

- :func:`check_payload`: what a declaration means before a run, its
  description and its positions, or what is wrong with it;
- :func:`labels_envelope`: which protected position each voxel of a slice
  lies in, from the punch's record of the run (the declaration it ran with,
  its cell and its symmetry), never from the settings a form holds now;
- :func:`bragg_profile_payload`: the punch's record, its peaks, the nodes its
  node test left and what its search left alone.
"""

from __future__ import annotations

import json
import struct
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from nebula3d.modulation import Modulation, Position, h_planes, protected_labels
from nebula3d.pipeline import default_modulation
from nebula3d.server.bragg import node_test_out
from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import artifact_path, find_dataset
from nebula3d.symmetry import parse_symmetry_ops, point_group

__all__ = ["bragg_profile_payload", "check_payload", "labels_envelope", "record_out"]


def _group(symmetry_ops: object) -> tuple[NDArray[np.int64], ...] | None:
    """The point group *symmetry_ops* name: operation triplets as text
    (``"h,k,l; -h,-k,-l"``), or HKL matrices as a volume's meta lists them;
    None for none. Raises ``ValueError`` for anything else."""
    if symmetry_ops is None or (isinstance(symmetry_ops, str) and not symmetry_ops.strip()):
        return None
    if isinstance(symmetry_ops, str):
        return point_group(parse_symmetry_ops(symmetry_ops))
    ops = []
    for m in symmetry_ops:  # type: ignore[attr-defined]
        a = np.asarray(m)
        if a.shape != (3, 3) or not np.array_equal(a, np.rint(a)):
            raise ValueError(f"symmetry operation {m!r}: a 3×3 matrix of integers")
        if abs(round(float(np.linalg.det(a)))) != 1:
            raise ValueError(f"symmetry operation {m!r} is not a lattice symmetry")
        ops.append(a.astype(np.int64))
    return point_group(ops) if ops else None


def _cell(cell: object) -> tuple[int, int, int]:
    if cell is None:
        return (1, 1, 1)
    values = list(cell)  # type: ignore[call-overload]
    if len(values) != 3 or any(isinstance(n, bool) or int(n) != n or n < 1 for n in values):
        raise ValueError(f"cell {cell!r}: three positive integers")
    return (int(values[0]), int(values[1]), int(values[2]))


def check_payload(modulation: object, *, cell: Sequence[int] | None = None,
                  symmetry_ops: object = None) -> dict[str, Any]:
    """What a declaration means, before a run.

    *modulation* is what a request's ``modulation`` holds: absent (None), the
    pipeline's default (:func:`nebula3d.pipeline.default_modulation`, which
    declares none; ``default`` true); ``"none"``, nothing declared; else a declaration
    :meth:`Modulation.parse` reads. *cell* is the punch's indexing cell, whose
    parent lattice the satellites repeat on, and *symmetry_ops* the point group
    the data were symmetrised with. ``ok`` false gives the ``error`` that
    stops the declaration, and nothing else.
    """
    try:
        declared = default_modulation() if modulation is None else Modulation.parse(modulation)
        cells = _cell(cell)
        group = _group(symmetry_ops)
        positions = () if declared is None else declared.positions(group, cells)
        description = ("no modulation declared: the punch's search leaves no position alone"
                       if declared is None else declared.describe(group, cells))
    except (ValueError, TypeError) as exc:
        return {"ok": False, "error": str(exc), "default": modulation is None,
                "declared": None, "description": None, "positions": []}
    return {
        "ok": True,
        "error": None,
        "default": modulation is None,
        "declared": None if declared is None else declared.to_json(),
        "description": description,
        "positions": [p.to_json() for p in positions],
    }


def record_out(record: object) -> dict[str, Any] | None:
    """The punch record's ``modulation`` (what its search left alone, and
    the bunching it measured), its fields only, or None (none, or not one)."""
    if not isinstance(record, dict):
        return None
    keys = ("declared", "cell", "symmetry_ops", "legacy", "bunching")
    return {key: record.get(key) for key in keys}


def _recorded_positions(record: dict[str, Any]) -> tuple[Position, ...]:
    """The positions the run's search left alone, from its record: those of
    the declaration and those of the legacy H planes, on its cell and closed
    under its symmetry, as the punch computed them."""
    group = _group(record.get("symmetry_ops"))
    cell = _cell(record.get("cell"))
    declared = Modulation.parse(record.get("declared"))
    out = list(declared.positions(group, cell)) if declared is not None else []
    legacy = record.get("legacy")
    if isinstance(legacy, dict):
        out += h_planes(centres=legacy.get("h_centers"), fractions=legacy.get("h_fractions"),
                        half_width=float(legacy.get("half_width") or 0.0), symmetry=group)
    return tuple(out)


def _pack(header: dict[str, Any], data: NDArray[np.float32]) -> bytes:
    """The slice wire format (:func:`nebula3d.server.volumes.pack_slice`)."""
    hb = json.dumps(header).encode("utf-8")
    return struct.pack("<I", len(hb)) + hb + np.ascontiguousarray(data, dtype="<f4").tobytes()


def labels_envelope(cfg: ServerConfig, dataset_id: str, plane: str, value: float,
                    interp: bool = False) -> bytes | None:
    """Which protected position each voxel of a slice lies in, in the slice
    wire format of the volume viewer's slices, on the grid of the dataset's
    punched stage: ``i`` for ``legend[i - 1]``, 0 for none.

    The positions are the ones the run's search left alone, read from the
    punch's record: its declaration, cell, symmetry and legacy H planes, so a
    slice's labels are the punch's own (:mod:`nebula3d.modulation`), not what
    a form holds now. A record written before the punch recorded them gives
    ``recorded`` false and no labels. None for an unknown dataset; raises
    ``FileNotFoundError`` without a punched stage or its record, and
    ``ValueError`` for an unknown plane.
    """
    from nebula3d.server.volumes import load_volume
    from nebula3d.visualization.slices import _ALIASES, _PLANE, _format_cut_value

    ds = find_dataset(cfg, dataset_id)
    if ds is None:
        return None
    key = _ALIASES.get(plane.lower(), plane.lower())
    if key not in _PLANE:
        raise ValueError(f"plane must be one of {list(_PLANE) + list(_ALIASES)}; got {plane!r}")
    punched = artifact_path(cfg, ds, "braggpunched")
    profile_path = artifact_path(cfg, ds, "bragg_profile_json")
    if not punched.exists() or not profile_path.exists():
        raise FileNotFoundError(f"no punch record for {dataset_id!r}")
    try:
        saved = json.loads(profile_path.read_text(encoding="utf-8"))
    except ValueError as exc:  # not JSON: the server's fault, not the request's
        raise OSError(f"{profile_path.name} is not JSON: {exc}") from exc
    record = record_out(saved.get("modulation") if isinstance(saved, dict) else None)
    positions = () if record is None else _recorded_positions(record)

    vol = load_volume(punched)
    fixed_attr, array_dim, y_attr, x_attr, y_label, x_label, transpose = _PLANE[key]
    fixed = getattr(vol, fixed_attr)
    if interp:
        cut = float(np.clip(float(value), float(fixed.min()), float(fixed.max())))
    else:
        cut = float(fixed[int(np.argmin(np.abs(fixed - float(value))))])
    axes: list[NDArray[np.float64]] = [vol.h_axis, vol.k_axis, vol.l_axis]
    axes[array_dim] = np.array([cut])
    labels = protected_labels(positions, axes[0][:, None, None], axes[1][None, :, None],
                              axes[2][None, None, :])
    plane_labels = np.take(np.broadcast_to(labels, tuple(a.size for a in axes)), 0,
                           axis=array_dim)
    if transpose:
        plane_labels = plane_labels.T
    y_axis, x_axis = getattr(vol, y_attr), getattr(vol, x_attr)
    header = {
        "ny": int(plane_labels.shape[0]),
        "nx": int(plane_labels.shape[1]),
        "x_axis": np.asarray(x_axis, dtype=float).tolist(),
        "y_axis": np.asarray(y_axis, dtype=float).tolist(),
        "x_label": x_label,
        "y_label": y_label,
        "cut_label": f"{fixed_attr[0].upper()} = {_format_cut_value(cut, 4)} r.l.u.",
        "robust_max": float(max(len(positions), 1)),
        "recorded": record is not None,
        "declared": None if record is None else record["declared"],
        "legend": [p.to_json() for p in positions],
    }
    return _pack(header, plane_labels.astype(np.float32))


def bragg_profile_payload(cfg: ServerConfig, dataset_id: str) -> dict[str, Any] | None:
    """The punch's record of a dataset (``GET /api/bragg/{id}/profile``):
    per-peak widths, ``node_test`` (the nodes its node test could not judge)
    and ``modulation`` (what its search left alone, and the bunching it
    measured). ``has_profile`` false when the punch wrote none. None for an
    unknown dataset; raises ``ValueError`` for a record that is not JSON."""
    ds = find_dataset(cfg, dataset_id)
    if ds is None:
        return None
    path = artifact_path(cfg, ds, "bragg_profile_json")
    if not path.exists():
        return {
            "dataset_id": dataset_id, "profile_path": str(path),
            "has_profile": False, "schema_version": 1,
            "width_labels": [], "hkl_width_labels": [], "width_units": {},
            "n_peaks": 0, "fit_covariance": False, "punch_frame": None,
            "peaks": [], "node_test": None, "modulation": None,
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "dataset_id": dataset_id,
        "profile_path": str(path),
        "has_profile": True,
        "schema_version": int(data.get("schema_version", 1)),
        "width_labels": list(data.get("width_labels", [])),
        "hkl_width_labels": list(data.get("hkl_width_labels", [])),
        "width_units": dict(data.get("width_units", {})),
        "n_peaks": int(data.get("n_peaks", 0)),
        "fit_covariance": bool(data.get("fit_covariance", False)),
        "punch_frame": data.get("punch_frame"),
        "peaks": list(data.get("peaks", [])),
        "node_test": node_test_out(data.get("node_test")),
        "modulation": record_out(data.get("modulation")),
    }
