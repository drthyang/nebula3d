# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Reader for Mantid MDHistoWorkspace NeXus files (.nxs).

File layout
-----------
MDHistoWorkspace/data/
    D0, D1, D2          bin-edge arrays  (N+1 values for N bins)
    signal              intensity  shape (n_D2, n_D1, n_D0)
    errors_squared      σ²         same shape
    mask                int8, 0 = valid, 1 = masked by Mantid
MDHistoWorkspace/experiment0/sample/oriented_lattice/
    orientation_matrix  UB matrix (3×3), Q = UB @ [h,k,l]ᵀ
    unit_cell_*         lattice parameters (provenance only)
MDHistoWorkspace/experiment0/logs/W_MATRIX/value
    projection matrix, 9 values row-major; column j = (h,k,l) direction of Dj

Convention note
---------------
Mantid stores a *crystallographic* orientation matrix (|b*| = 1/d, no 2π).
nebula3d uses the *physics* convention everywhere (Q = 2π/d, see
``ub_from_lattice`` and ``al_ring_q_positions``), so the stored matrix is
scaled by 2π on read to keep |Q| consistent across the package.

Projection note
---------------
Only volumes binned on the crystal's own H, K, L axes (in any order) load.
Non-orthogonal *cells* (hexagonal, monoclinic, …) are fine: the UB matrix
carries the metric.  A *projected* grid such as the orthogonal hexagonal cut
``[H,0,0]/[K,2K,0]/[0,0,L]`` is rejected, because every downstream stage
indexes the grid as h, k, l directly.
"""

from __future__ import annotations

import re
from itertools import permutations
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume

if TYPE_CHECKING:
    import h5py

_PathLike = str | Path

_HKL_LETTERS = ("H", "K", "L")

# One component of a Mantid axis label: "0", "H", "-K", "2K", "-0.5L", "0.333H".
_LABEL_COMPONENT = re.compile(
    r"(?P<sign>[+-]?)(?P<coef>(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?(?P<var>[A-Za-z]*)")

# signal has shape (n_D2, n_D1, n_D0), so the array axis for each label is:
_DIM_TO_FILE_AXIS: dict[str, int] = {"D0": 2, "D1": 1, "D2": 0}

# Mantid's orientation_matrix is crystallographic (|b*| = 1/d); nebula3d works in
# the physics convention (Q = 2π/d), so scale the stored matrix on read.
_TWO_PI: float = 2.0 * np.pi


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_mantid_nxs(
    path: _PathLike,
    ub_matrix: NDArray[np.float64] | None = None,
    *,
    dtype: np.dtype | type = np.float64,
) -> HKLVolume:
    """Load a Mantid MDHistoWorkspace NeXus file into an HKLVolume.

    Voxels with NaN signal or Mantid mask=1 are zeroed and set mask=False.

    Parameters
    ----------
    path
        Path to the ``.nxs`` file.
    ub_matrix
        Optional 3×3 UB matrix (physics convention, Q = 2π/d) to use instead
        of the one stored in the file.  Background/empty-can scans often lack
        an ``experiment0`` group; pass the paired data volume's
        ``ub_matrix`` so both share a consistent |Q| scale.
    dtype
        Storage precision for ``data``/``sigma`` (float64 default; float32 in
        the browser build).  Axes and UB stay float64.
    """
    path = Path(path)
    try:
        import h5py
    except ImportError as exc:
        raise ImportError("h5py is required to read NeXus files.") from exc

    with h5py.File(path, "r") as f:
        root = _require_md_histo(f)
        data_grp = root["data"]
        axes = _parse_dim_axes(data_grp, _read_w_matrix(root))
        ub = _resolve_ub(root, ub_matrix)
        data, sigma, mask = _assemble(data_grp, axes, dtype)

    return HKLVolume(
        data=data,
        sigma=sigma,
        mask=mask,
        h_axis=axes["H"][1],
        k_axis=axes["K"][1],
        l_axis=axes["L"][1],
        ub_matrix=ub,
        instrument=path.stem,
    )


def is_mantid_nxs(path: _PathLike) -> bool:
    """Return True if *path* is a Mantid MDHistoWorkspace NeXus file."""
    try:
        import h5py
    except ImportError:
        return False
    try:
        with h5py.File(path, "r") as f:
            return "MDHistoWorkspace" in f
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Private helpers — each does exactly one thing
# ---------------------------------------------------------------------------


def _require_md_histo(f: h5py.File) -> h5py.Group:
    if "MDHistoWorkspace" not in f:
        raise ValueError(f"{f.filename!r} is not a Mantid MDHistoWorkspace file.")
    return f["MDHistoWorkspace"]  # type: ignore[return-value]


def _parse_dim_axes(
    data_grp: h5py.Group,
    w_matrix: NDArray[np.float64] | None = None,
) -> dict[str, tuple[int, NDArray[np.float64]]]:
    """Return {hkl_char: (file_array_axis, bin_centers)} for H, K, L.

    Mantid stores signal as (n_D2, n_D1, n_D0), so D2 → axis 0,
    D1 → axis 1, D0 → axis 2.  The long_name attribute on each dim spells out
    its (h, k, l) direction ('[0,K,0]' is the plain K axis); the H/K/L it maps
    to is the direction's nonzero component, not the letter in the label.
    """
    labels: dict[str, str] = {}
    vectors: dict[str, NDArray[np.float64]] = {}
    for d_label in _DIM_TO_FILE_AXIS:
        labels[d_label] = _as_text(data_grp[d_label].attrs["long_name"])
        vectors[d_label] = _projection_vector(labels[d_label])
    _check_projection(Path(data_grp.file.filename).name, labels, vectors, w_matrix)

    result: dict[str, tuple[int, NDArray[np.float64]]] = {}
    for d_label, file_axis in _DIM_TO_FILE_AXIS.items():
        edges: NDArray[np.float64] = data_grp[d_label][:].astype(np.float64)
        hkl_char = _HKL_LETTERS[int(np.argmax(vectors[d_label]))]
        result[hkl_char] = (file_axis, _bin_centers(edges))
    return result


def _as_text(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode()
    return str(value)


def _projection_vector(long_name: str) -> NDArray[np.float64]:
    """The (h, k, l) direction of one dim, read from its Mantid long_name.

    Mantid writes the direction component by component: '[0,K,0]' is
    (0, 1, 0), '[K,2K,0]' is (1, 2, 0), '[-0.5H,H,0]' is (-0.5, 1, 0).  A bare
    'H', 'K' or 'L' is read as that plain axis.
    """
    text = long_name.strip()
    bracket = re.search(r"\[([^\[\]]*)\]", text)
    if bracket is None:
        if text.upper() in _HKL_LETTERS:
            return np.eye(3)[_HKL_LETTERS.index(text.upper())]
        raise ValueError(f"Cannot identify H/K/L component in dim long_name {long_name!r}")

    parts = bracket.group(1).split(",")
    comps = [c for c in map(_label_component, parts) if c is not None]
    if len(parts) == len(comps) == 3:
        vec = np.array([value for _, value in comps], dtype=np.float64)
        if len({name for name, _ in comps if name}) == 1 and np.any(vec):
            return vec
    raise ValueError(
        f"Cannot read an (h, k, l) direction from dim long_name {long_name!r}")


def _label_component(part: str) -> tuple[str, float] | None:
    """('K', 2.0) for '2K', ('', 0.0) for '0'; None if unreadable or a constant offset."""
    m = _LABEL_COMPONENT.fullmatch(part.strip())
    if m is None or not (m["coef"] or m["var"]):
        return None
    coef = float(m["coef"]) if m["coef"] else 1.0
    if not m["var"]:
        return ("", 0.0) if coef == 0.0 else None
    return m["var"].upper(), -coef if m["sign"] == "-" else coef


def _read_w_matrix(root: h5py.Group) -> NDArray[np.float64] | None:
    """Projection matrix from the W_MATRIX run log (column j = direction of Dj)."""
    try:
        values = np.asarray(root["experiment0/logs/W_MATRIX/value"][()], dtype=np.float64)
    except KeyError:
        return None
    return values.reshape(3, 3) if values.size == 9 else None


def _check_projection(
    filename: str,
    labels: dict[str, str],
    vectors: dict[str, NDArray[np.float64]],
    w_matrix: NDArray[np.float64] | None,
) -> None:
    """Accept only plain H, K, L axes, cross-checked against the W_MATRIX log.

    Every downstream stage indexes the grid as h, k, l directly (integer-node
    Bragg punch, H/K/L planes, the ΔPDF's a/b/c axes), so a projected grid would
    load with |Q| and every node position silently wrong.  If the labels and
    W_MATRIX disagree, refuse rather than guess which one describes the data.
    """
    for d_label, vec in vectors.items():
        if not np.allclose(np.sort(vec), (0.0, 0.0, 1.0)):
            direction = ", ".join(f"{v:g}" for v in vec)
            raise ValueError(
                f"{filename}: dim {d_label} ({labels[d_label]!r}) is binned along "
                f"(h, k, l) = ({direction}), not a single H, K or L axis.  nebula3d "
                "needs the volume on the crystal's own H, K, L axes (non-orthogonal "
                "cells such as hexagonal or monoclinic are fine there: the UB matrix "
                "carries the metric).  Rebin in Mantid with projections "
                "u=[1,0,0], v=[0,1,0], w=[0,0,1].")

    proj = np.column_stack([vectors[d] for d in _DIM_TO_FILE_AXIS])
    if not np.allclose(np.abs(np.linalg.det(proj)), 1.0):
        raise ValueError(
            f"{filename}: dims {list(labels.values())} do not span H, K and L.")

    if w_matrix is not None and not any(
        np.allclose(proj[:, list(perm)], w_matrix, atol=1e-3)
        for perm in permutations(range(3))
    ):
        columns = ", ".join(
            "(" + ", ".join(f"{v:g}" for v in w_matrix[:, j]) + ")" for j in range(3))
        raise ValueError(
            f"{filename}: the dim labels {list(labels.values())} describe plain "
            f"H, K, L axes, but the W_MATRIX log has projection columns {columns}.  "
            "Refusing to guess which one describes the data; rebin in Mantid with "
            "projections u=[1,0,0], v=[0,1,0], w=[0,0,1].")


def _bin_centers(edges: NDArray[np.float64]) -> NDArray[np.float64]:
    return (edges[:-1] + edges[1:]) * 0.5


def _resolve_ub(
    root: h5py.Group,
    override: NDArray[np.float64] | None,
) -> NDArray[np.float64]:
    """Pick the UB matrix: explicit override > file value > identity fallback."""
    if override is not None:
        return np.asarray(override, dtype=np.float64)
    if "experiment0" in root:
        return _read_ub_matrix(root["experiment0/sample/oriented_lattice"])
    return np.eye(3, dtype=np.float64)


def _read_ub_matrix(lattice_grp: h5py.Group) -> NDArray[np.float64]:
    """Read the orientation matrix and scale to the physics (2π) convention."""
    return lattice_grp["orientation_matrix"][:].astype(np.float64) * _TWO_PI


def _assemble(
    data_grp: h5py.Group,
    axes: dict[str, tuple[int, NDArray[np.float64]]],
    dtype: np.dtype | type = np.float64,
) -> tuple[NDArray[np.floating], NDArray[np.floating], NDArray[np.bool_]]:
    """Read signal/σ²/mask and permute to canonical (H, K, L) axis order.

    Reads and transposes one array at a time, rebinding each variable so the
    file-order temporary is released as soon as its canonical copy exists, and
    computes σ and applies the validity mask **in place**.  Peak memory stays
    near two volume-sized arrays instead of the six-plus a naive
    read-all-then-``np.where`` version holds — which matters under the browser's
    32-bit-WASM heap (see :mod:`nebula3d.webbridge`), where a ~48 M-voxel volume
    otherwise overflows on load.
    """
    perm = (axes["H"][0], axes["K"][0], axes["L"][0])

    # astype(copy=False): no redundant copy when the file dtype already matches.
    sig = data_grp["signal"][:].astype(dtype, copy=False)
    sig = np.ascontiguousarray(np.transpose(sig, perm))
    err2 = data_grp["errors_squared"][:].astype(dtype, copy=False)
    err2 = np.ascontiguousarray(np.transpose(err2, perm))
    fmask = data_grp["mask"][:].astype(np.int8, copy=False)
    fmask = np.ascontiguousarray(np.transpose(fmask, perm))

    valid: NDArray[np.bool_] = np.isfinite(sig) & (fmask == 0)
    del fmask

    # σ = sqrt(max(σ², 0)), reusing the err2 buffer to avoid a fresh allocation.
    np.maximum(err2, 0.0, out=err2)
    np.sqrt(err2, out=err2)
    sigma = err2

    # zero out invalid voxels so downstream code never sees NaN (in place)
    invalid = ~valid
    sig[invalid] = 0.0
    sigma[invalid] = 0.0

    return sig, sigma, valid
