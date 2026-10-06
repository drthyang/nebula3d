# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Read and write 3D-ΔPDF files.

A ΔPDF is written as a Mantid MDHistoWorkspace (the SaveMD version 2 layout of
:func:`nebula3d.io.mantid_nxs.write_md_histo`), so Mantid Workbench and other
NeXus tools open it:

MDHistoWorkspace/data/signal
    the ΔPDF ``(na, nb, nc)`` as stored (float64 on disk, as LoadMD requires);
    errors_squared and mask are zero
MDHistoWorkspace/data/D2, D1, D0
    bin edges of x (along a), y (along b), z (along c) in Å, frame
    'General Frame' — oblique coordinates for a non-orthogonal cell
MDHistoWorkspace/experiment0/sample/oriented_lattice
    the source volume's UB and unit cell (where the cell lives)
MDHistoWorkspace/experiment0/logs/<name>/value
    provenance as run logs: q_max, apodization, source_file, transform_config, …
MDHistoWorkspace/nebula3d
    exact axes and UB, and the in-memory dtype

Files written before that keep everything at the root: ``data``, bin-centre
``x_axis``/``y_axis``/``z_axis``, the provenance as attributes, and the direct
cell as ``lat_a/b/c`` (Å) and ``lat_alpha/beta/gamma`` (degrees; absent in the
oldest files, read as 90°).  :func:`load_delta_pdf` reads both layouts.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from numpy.typing import NDArray

from nebula3d.io.mantid_nxs import (
    COORDINATE_SYSTEM_NONE,
    MDDim,
    dim_centers,
    nebula3d_group,
    read_run_logs,
    read_signal,
    read_ub_matrix,
    read_unit_cell,
    resolve_dtype,
    write_md_histo,
)
from nebula3d.utils.reciprocal_space import direct_cell

if TYPE_CHECKING:
    import h5py

_PathLike = str | Path
_Cell = tuple[float, float, float, float, float, float]

_CELL_KEYS = ("a", "b", "c", "alpha", "beta", "gamma")
_LEGACY_CELL_ATTRS = tuple(f"lat_{k}" for k in _CELL_KEYS)

#: Units of the provenance logs NEBULA3D writes (the rest are dimensionless).
LOG_UNITS: dict[str, str] = {
    "q_max": "Angstrom^-1",
    "q_band": "Angstrom^-1",
    "r_band": "Angstrom",
    "crop_hkl": "r.l.u.",
    "subtract_smooth_bg": "r.l.u.",
}


@dataclass
class DeltaPdfFile:
    """What a ΔPDF file holds, in either layout.

    ``data`` is None when read with ``read_data=False``.  ``lattice`` maps
    a/b/c (Å) and alpha/beta/gamma (degrees) to their values, None for any the
    file does not record; ``ub_matrix`` is the source volume's UB (physics
    convention), None when unknown or in a legacy file.  ``logs`` holds the
    provenance: numbers as float, text as str.
    """

    data: NDArray[np.floating] | None
    x_axis: NDArray[np.float64]
    y_axis: NDArray[np.float64]
    z_axis: NDArray[np.float64]
    lattice: dict[str, float | None] = field(
        default_factory=lambda: dict.fromkeys(_CELL_KEYS))
    ub_matrix: NDArray[np.float64] | None = None
    logs: dict[str, float | str] = field(default_factory=dict)

    @property
    def cell(self) -> _Cell | None:
        """``(a, b, c, α, β, γ)``, angles 90° where unknown; None without a/b/c."""
        return _cell(self.lattice)


def save_delta_pdf(
    path: _PathLike,
    data: NDArray[np.floating],
    x_axis: NDArray[np.float64],
    y_axis: NDArray[np.float64],
    z_axis: NDArray[np.float64],
    *,
    ub_matrix: NDArray[np.float64] | None = None,
    logs: Mapping[str, float | str] | None = None,
) -> None:
    """Write a ΔPDF ``(na, nb, nc)`` in the MDHistoWorkspace layout.

    The array keeps its stored order, so D2 = x (along a), D1 = y (along b),
    D0 = z (along c), in Å.  *ub_matrix* is the source volume's (it carries
    the cell); *logs* are the provenance values (see :data:`LOG_UNITS`).
    """
    dims = (
        MDDim("x", x_axis, "Angstrom", "General Frame", (1.0, 0.0, 0.0)),
        MDDim("y", y_axis, "Angstrom", "General Frame", (0.0, 1.0, 0.0)),
        MDDim("z", z_axis, "Angstrom", "General Frame", (0.0, 0.0, 1.0)),
    )
    write_md_histo(
        path, data, dims, content="delta_pdf", ub_matrix=ub_matrix,
        coordinate_system=COORDINATE_SYSTEM_NONE, logs=logs, log_units=LOG_UNITS)


def load_delta_pdf(
    path: _PathLike,
    *,
    dtype: np.dtype | type | None = None,
    read_data: bool = True,
) -> DeltaPdfFile:
    """Read a ΔPDF file written in either layout.

    ``dtype=None`` keeps the ΔPDF's own precision (the in-memory dtype NEBULA3D
    recorded; the stored one in a legacy file).  ``read_data=False`` reads only
    the axes, cell and provenance — cheap on a multi-GB file.
    """
    import h5py

    path = Path(path)
    with h5py.File(path, "r") as f:
        if "MDHistoWorkspace" in f:
            return _load_md_histo(path, f["MDHistoWorkspace"], dtype, read_data)
        return _load_legacy(f, dtype, read_data)


def cell_from_legacy_attrs(attrs: Mapping[str, object]) -> _Cell | None:
    """``(a, b, c, α, β, γ)`` from a legacy ΔPDF file's ``lat_*`` attributes,
    or ``None`` without a/b/c; angles 90° where absent (the oldest files)."""
    return _cell(_legacy_lattice(attrs))


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _cell(lattice: Mapping[str, float | None]) -> _Cell | None:
    if any(lattice.get(k) is None for k in _CELL_KEYS[:3]):
        return None
    values = (lattice.get(k) for k in _CELL_KEYS)
    return tuple(90.0 if v is None else float(v) for v in values)  # type: ignore[return-value]


def _load_md_histo(
    path: Path, root: h5py.Group, dtype: np.dtype | type | None, read_data: bool,
) -> DeltaPdfFile:
    extra = nebula3d_group(root)
    content = str(extra.attrs.get("content", "")) if extra is not None else ""
    if content and content != "delta_pdf":
        raise ValueError(f"{path.name} holds a NEBULA3D {content!r}, not a ΔPDF — "
                         "read it with nebula3d.load")
    data_grp = root["data"]
    ub = read_ub_matrix(root, extra)
    cell: tuple[float, ...] | None = read_unit_cell(root)
    if cell is None and ub is not None and not np.array_equal(ub, np.eye(3)):
        try:  # a UB Mantid could not store (left-handed): the exact copy only
            cell = direct_cell(ub)
        except np.linalg.LinAlgError:
            cell = None
    return DeltaPdfFile(
        data=(read_signal(data_grp, resolve_dtype(dtype, extra)) if read_data
              else None),
        x_axis=dim_centers(data_grp, "D2", extra),
        y_axis=dim_centers(data_grp, "D1", extra),
        z_axis=dim_centers(data_grp, "D0", extra),
        lattice=(dict(zip(_CELL_KEYS, cell)) if cell is not None
                 else dict.fromkeys(_CELL_KEYS)),
        ub_matrix=None if ub is None or np.array_equal(ub, np.eye(3)) else ub,
        logs=read_run_logs(root),
    )


def _load_legacy(
    f: h5py.File, dtype: np.dtype | type | None, read_data: bool,
) -> DeltaPdfFile:
    attrs = f.attrs
    logs: dict[str, float | str] = {}
    for key, value in attrs.items():
        if key in _LEGACY_CELL_ATTRS:
            continue
        if isinstance(value, bytes | str):
            logs[key] = value.decode() if isinstance(value, bytes) else value
        elif np.ndim(value) == 0:
            logs[key] = float(value)
    return DeltaPdfFile(
        data=np.asarray(f["data"][()], dtype=dtype) if read_data else None,
        x_axis=np.asarray(f["x_axis"][()], dtype=np.float64),
        y_axis=np.asarray(f["y_axis"][()], dtype=np.float64),
        z_axis=np.asarray(f["z_axis"][()], dtype=np.float64),
        lattice=_legacy_lattice(attrs),
        logs=logs,
    )


def _legacy_lattice(attrs: Mapping[str, object]) -> dict[str, float | None]:
    return {k: (float(attrs[a]) if a in attrs else None)  # type: ignore[arg-type]
            for k, a in zip(_CELL_KEYS, _LEGACY_CELL_ATTRS)}
