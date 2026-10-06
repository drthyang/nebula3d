# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Reader and writer for Mantid MDHistoWorkspace NeXus files (.nxs).

File layout
-----------
MDHistoWorkspace/data/
    D0, D1, D2          bin-edge arrays  (N+1 values for N bins)
    signal              intensity  shape (n_D2, n_D1, n_D0)
    errors_squared      σ²         same shape
    num_events          float64, same shape (NEBULA3D: 1 = valid, 0 = masked)
    mask                int8, 0 = valid, 1 = masked by Mantid
MDHistoWorkspace/experiment0/sample/oriented_lattice/
    orientation_matrix  UB matrix (3×3), Q = UB @ [h,k,l]ᵀ
    unit_cell_*         lattice parameters (Å, degrees; the ΔPDF files' cell)
MDHistoWorkspace/experiment0/logs/W_MATRIX/value
    projection matrix, 9 values row-major; column j = (h,k,l) direction of Dj
MDHistoWorkspace/nebula3d/      (only in files NEBULA3D wrote)
    what Mantid does not know: the exact bin centres and UB, the in-memory
    dtype, the instrument text, the punch record (see :func:`write_md_histo`)

NEBULA3D writes every volume (:func:`save_mantid_nxs`) and every 3D-ΔPDF in
this layout — the one Mantid Workbench's SaveMD writes (version 2) — so LoadMD
and other NeXus tools open them and the unit cell sits in the standard place.
A file with a ``nebula3d`` group loads back losslessly; any other is a raw
Mantid file, whose masked and NaN voxels are zeroed.

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
``[H,0,0]/[-K,2K,0]/[0,0,L]`` is rejected, because every downstream stage
indexes the grid as h, k, l directly.  (With γ = 120°, a*·(h a* + k b*) ∝
h + k/2, so (−1, 2, 0) is the in-plane direction perpendicular to a*.)
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import permutations
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from numpy.typing import NDArray

from nebula3d._version import __version__
from nebula3d.core import HKLVolume
from nebula3d.utils.reciprocal_space import direct_cell

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

#: NEBULA3D's own group in the entry: what Mantid does not know (exact axes and
#: UB, the in-memory dtype, the instrument text, the punch record).  LoadMD opens
#: only the groups it knows, so it never sees this one.
NEBULA3D_GROUP = "nebula3d"
NEBULA3D_FORMAT_VERSION = 1

# Mantid's SpecialCoordinateSystem: None = 0, QLab = 1, QSample = 2, HKL = 3.
COORDINATE_SYSTEM_NONE = 0
COORDINATE_SYSTEM_HKL = 3

# Run logs every SaveMD file carries; a caller's log may not replace them.
_STANDARD_LOGS = frozenset({"W_MATRIX", "goniometer", "mdhisto_was_modified"})

# Verbatim from a SaveMD file (CORELLI, Mantid 6): Sample.loadNexus parses the
# shape, and the parameter-map description is Mantid's own boilerplate.
_SHAPE_XML = (
    '<type name="userShape">   <goniometer a11="1.000000" a12="0.000000" '
    'a13="0.000000" a21="0.000000" a22="1.000000" a23="0.000000" a31="0.000000" '
    'a32="0.000000" a33="1.000000"/></type>')
_PARAMETER_MAP_DESCRIPTION = (
    "A string representation of the parameter map. The format is either: "
    "|detID:id-value;param-type;param-name;param-value| for a detector or  "
    "|comp-name;param-type;param-name;param-value| for other components.")

# gzip level 1 + byte-shuffle (Mantid writes level 6): ~1.6× faster to write and
# still smaller than the gzip default on float volumes; a standard HDF5 filter
# every reader decodes.  Lossless.
_COMPRESSION: dict[str, object] = {
    "compression": "gzip", "compression_opts": 1, "shuffle": True}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MDDim:
    """One axis of a histogram written by :func:`write_md_histo`.

    ``direction`` is the axis in the frame's basis — (h, k, l) for an HKL
    volume, (a, b, c) for a ΔPDF — i.e. its column of the W_MATRIX log.
    """

    long_name: str
    centers: NDArray[np.float64]
    units: str
    frame: str
    direction: tuple[float, float, float]


def load_mantid_nxs(
    path: _PathLike,
    ub_matrix: NDArray[np.float64] | None = None,
    *,
    dtype: np.dtype | type | None = np.float64,
) -> HKLVolume:
    """Load a Mantid MDHistoWorkspace NeXus file into an HKLVolume.

    Voxels with NaN signal or Mantid mask=1 are zeroed and set mask=False —
    except in a file NEBULA3D wrote (:func:`save_mantid_nxs`), which loads back
    losslessly: the values under the mask are kept, and the exact axes, UB and
    instrument text are restored.

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
        the browser build).  ``None`` restores the precision the volume had
        when NEBULA3D wrote it (on disk it is always float64, as LoadMD
        requires); float64 for any other file.  Axes and UB stay float64.
    """
    path = Path(path)
    try:
        import h5py
    except ImportError as exc:
        raise ImportError("h5py is required to read NeXus files.") from exc

    with h5py.File(path, "r") as f:
        root = _require_md_histo(f)
        extra = nebula3d_group(root)
        _require_content(path, extra, "hkl_volume")
        data_grp = root["data"]
        axes = _parse_dim_axes(data_grp, _read_w_matrix(root), extra)
        ub = _resolve_ub(root, ub_matrix, extra)
        data, sigma, mask = _assemble(data_grp, axes, resolve_dtype(dtype, extra),
                                      keep_masked=extra is not None)
        instrument = (path.stem if extra is None
                      else _as_text(extra.attrs.get("instrument", "")))

    return HKLVolume(
        data=data,
        sigma=sigma,
        mask=mask,
        h_axis=axes["H"][1],
        k_axis=axes["K"][1],
        l_axis=axes["L"][1],
        ub_matrix=ub,
        instrument=instrument,
    )


def save_mantid_nxs(vol: HKLVolume, path: _PathLike) -> None:
    """Write *vol* as a Mantid MDHistoWorkspace NeXus file (SaveMD version 2).

    The arrays keep their stored (H, K, L) order, so D2 = H, D1 = K, D0 = L
    (``[H,0,0]``, ``[0,K,0]``, ``[0,0,L]`` in r.l.u., frame HKL).  Mantid
    Workbench opens the file with LoadMD; :func:`load_mantid_nxs` reads it back
    losslessly.  See :func:`write_md_histo` for what goes where.
    """
    dims = (
        MDDim("[H,0,0]", vol.h_axis, "r.l.u.", "HKL", (1.0, 0.0, 0.0)),
        MDDim("[0,K,0]", vol.k_axis, "r.l.u.", "HKL", (0.0, 1.0, 0.0)),
        MDDim("[0,0,L]", vol.l_axis, "r.l.u.", "HKL", (0.0, 0.0, 1.0)),
    )
    write_md_histo(
        path, vol.data, dims, content="hkl_volume", sigma=vol.sigma,
        valid=vol.mask, ub_matrix=vol.ub_matrix,
        coordinate_system=COORDINATE_SYSTEM_HKL,
        attrs={"instrument": vol.instrument})


def write_md_histo(
    path: _PathLike,
    signal: NDArray[np.floating],
    dims: Sequence[MDDim],
    *,
    content: str,
    sigma: NDArray[np.floating] | None = None,
    valid: NDArray[np.bool_] | None = None,
    ub_matrix: NDArray[np.float64] | None = None,
    coordinate_system: int = COORDINATE_SYSTEM_HKL,
    logs: Mapping[str, float | str] | None = None,
    log_units: Mapping[str, str] | None = None,
    attrs: Mapping[str, str] | None = None,
) -> None:
    """Write a 3-D histogram in the layout Mantid's SaveMD (version 2) writes.

    ``dims`` describe the array axes in their stored order, axis 0 first.
    Mantid's signal is ``(n_D2, n_D1, n_D0)``, so axis 0 becomes D2 and axis 2
    D0 and nothing is transposed.  Each D dataset holds the N+1 bin edges
    around the N centres, with ``long_name``, ``units`` and ``frame``.

    LoadMD accepts only float64 ``signal``, ``errors_squared`` (σ²) and
    ``num_events``, and an int8 ``mask`` (1 = masked), so a float32 volume is
    converted one axis-0 slab at a time — no float64 copy of the whole volume
    is ever allocated (the browser build runs under a 32-bit WASM heap).
    ``num_events`` is 1 for a valid voxel and 0 for a masked one.  Without
    *sigma* the errors are zero and without *valid* nothing is masked; those
    datasets are then left to their fill value, which costs nothing to write.

    A finite, right-handed *ub_matrix* (physics convention, Q = 2π/d) other
    than the identity — NEBULA3D's "unknown" — becomes the oriented lattice:
    ``orientation_matrix`` = UB/2π (Mantid is crystallographic) and the unit
    cell.  Otherwise ``num_oriented_lattice`` is 0.  *logs* become run logs
    (Workbench's Sample Logs): numbers as float64, text as a string, each with
    its *log_units* (blank by default).

    What Mantid does not know goes in ``MDHistoWorkspace/nebula3d``: the
    format and package versions, *content* (``"hkl_volume"``,
    ``"delta_pdf"``), the in-memory dtype, the free-text *attrs*, and the exact
    bin centres and UB — the edges and UB/2π give them back only to float
    rounding, and a pipeline resumed from disk must equal an in-memory one.

    Every string attribute is a scalar variable-length ASCII string and every
    string dataset a fixed-length ASCII string of shape (1,), as Mantid writes
    them; its loader is strict about the HDF5 types.
    """
    import h5py

    path = Path(path)
    if signal.ndim != 3 or len(dims) != 3:
        raise ValueError(
            f"write_md_histo needs a 3-D signal and three dims, got shape "
            f"{signal.shape} and {len(dims)} dims")
    for axis, dim in enumerate(dims):
        if len(dim.centers) != signal.shape[axis]:
            raise ValueError(
                f"dim {dim.long_name!r} has {len(dim.centers)} bin centres but "
                f"signal axis {axis} has {signal.shape[axis]} bins")
    reserved = _STANDARD_LOGS.intersection(logs or {})
    if reserved:
        raise ValueError(f"run log name(s) {sorted(reserved)} are reserved")

    with h5py.File(path, "w") as f:
        _set_text_attrs(
            f, NX_class="NXroot", NeXus_version="4.4.3",
            HDF5_Version=h5py.version.hdf5_version, file_name=path.name,
            file_time=datetime.now().astimezone().isoformat(timespec="seconds"))
        entry = _nx_group(f, "MDHistoWorkspace", "NXentry")
        _set_text_attrs(entry, QConvention="Crystallography")
        entry.attrs.create("SaveMDVersion", np.int32(2))
        entry.create_dataset("coordinate_system",
                             data=np.array([coordinate_system], dtype=np.uint32))
        entry.create_dataset("visual_normalization", data=np.zeros(1, dtype=np.uint32))

        data_grp = _nx_group(entry, "data", "NXdata")
        for axis, dim in enumerate(dims):
            edges = data_grp.create_dataset(f"D{2 - axis}", data=_bin_edges(dim.centers))
            _set_text_attrs(edges, frame=dim.frame, long_name=dim.long_name,
                            units=dim.units)
        _write_volume(data_grp, signal, sigma, valid)

        _write_experiment(entry, dims, _lattice_ub(ub_matrix), logs or {},
                          log_units or {})

        extra = _nx_group(entry, NEBULA3D_GROUP, "NXcollection")
        extra.attrs.create("format_version", np.int32(NEBULA3D_FORMAT_VERSION))
        _set_text_attrs(extra, version=__version__, content=content,
                        dtype=np.dtype(signal.dtype).name, **(attrs or {}))
        for axis, dim in enumerate(dims):
            extra.create_dataset(f"D{2 - axis}_centers",
                                 data=np.asarray(dim.centers, dtype=np.float64))
        if ub_matrix is not None:
            extra.create_dataset("ub_matrix",
                                 data=np.asarray(ub_matrix, dtype=np.float64))


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
# Reading helpers shared with nebula3d.io.delta_pdf_file
# ---------------------------------------------------------------------------


def nebula3d_group(root: h5py.Group) -> h5py.Group | None:
    """The entry's ``nebula3d`` group (a file NEBULA3D wrote), else None."""
    import h5py

    grp = root.get(NEBULA3D_GROUP)
    return grp if isinstance(grp, h5py.Group) else None


def resolve_dtype(
    dtype: np.dtype | type | None, extra: h5py.Group | None,
) -> np.dtype:
    """*dtype*, or for None the in-memory dtype NEBULA3D recorded (else float64)."""
    if dtype is not None:
        return np.dtype(dtype)
    stored = _as_text(extra.attrs.get("dtype", "")) if extra is not None else ""
    return np.dtype(stored) if stored in ("float32", "float64") else np.dtype(np.float64)


def dim_centers(
    data_grp: h5py.Group, d_label: str, extra: h5py.Group | None = None,
) -> NDArray[np.float64]:
    """Bin centres of dim *d_label* (``"D0"``…): NEBULA3D's exact copy when the
    file has one that matches the edges, else the edge midpoints."""
    centers = _bin_centers(data_grp[d_label][:].astype(np.float64))
    if extra is None or f"{d_label}_centers" not in extra:
        return centers
    exact = np.asarray(extra[f"{d_label}_centers"][()], dtype=np.float64)
    step = float(np.abs(np.diff(centers)).max()) if centers.size > 1 else 1.0
    if exact.shape == centers.shape and np.allclose(exact, centers, rtol=0.0,
                                                    atol=1e-6 * step):
        return exact
    return centers


def read_signal(
    data_grp: h5py.Group, dtype: np.dtype | type,
) -> NDArray[np.floating]:
    """The ``signal`` dataset in its stored order, read slab by slab in *dtype*."""
    return _read_canonical(data_grp["signal"], (0, 1, 2), dtype)


def read_unit_cell(root: h5py.Group) -> tuple[float, ...] | None:
    """``(a, b, c, α, β, γ)`` from the oriented lattice (Å, degrees), else None."""
    lattice = _oriented_lattice(root)
    names = ("a", "b", "c", "alpha", "beta", "gamma")
    if lattice is None or not all(f"unit_cell_{n}" in lattice for n in names):
        return None
    return tuple(float(np.ravel(lattice[f"unit_cell_{n}"][()])[0]) for n in names)


def read_run_logs(root: h5py.Group) -> dict[str, float | str]:
    """The entry's single-valued run logs (provenance), standard ones excluded.

    Numbers come back as float, text as str (Mantid's blank ``' '`` as ``''``).
    """
    import h5py

    logs: dict[str, float | str] = {}
    run = root.get("experiment0/logs")
    if run is None:
        return logs
    for name, grp in run.items():
        if name in _STANDARD_LOGS or not isinstance(grp, h5py.Group):
            continue
        value = grp.get("value")
        if not isinstance(value, h5py.Dataset) or value.size != 1:
            continue
        raw = value[()].ravel()[0] if value.shape else value[()]
        if isinstance(raw, bytes | str):
            text = _as_text(raw).rstrip("\0")
            logs[name] = "" if text == " " else text
        else:
            logs[name] = float(raw)
    return logs


def read_ub_matrix(
    root: h5py.Group, extra: h5py.Group | None = None,
) -> NDArray[np.float64] | None:
    """The file's UB (physics convention), or None if it records none."""
    lattice = _oriented_lattice(root)
    ub = _read_ub_matrix(lattice) if lattice is not None else None
    exact = _stored_ub(extra)
    if exact is not None and (ub is None or np.allclose(exact, ub, rtol=1e-9, atol=1e-12)):
        return exact
    return ub


# ---------------------------------------------------------------------------
# Private helpers — each does exactly one thing
# ---------------------------------------------------------------------------


def _require_md_histo(f: h5py.File) -> h5py.Group:
    if "MDHistoWorkspace" not in f:
        raise ValueError(f"{f.filename!r} is not a Mantid MDHistoWorkspace file.")
    return f["MDHistoWorkspace"]  # type: ignore[return-value]


def _require_content(path: Path, extra: h5py.Group | None, expected: str) -> None:
    """Refuse a NEBULA3D file that holds something else (a ΔPDF for a volume)."""
    content = _as_text(extra.attrs.get("content", "")) if extra is not None else ""
    if content and content != expected:
        hint = (" — read it with nebula3d.io.load_delta_pdf" if content == "delta_pdf"
                else "")
        raise ValueError(f"{path.name} holds a NEBULA3D {content!r}, "
                         f"not an {expected!r}{hint}.")


def _parse_dim_axes(
    data_grp: h5py.Group,
    w_matrix: NDArray[np.float64] | None = None,
    extra: h5py.Group | None = None,
) -> dict[str, tuple[int, NDArray[np.float64]]]:
    """Return {hkl_char: (file_array_axis, bin_centers)} for H, K, L.

    Mantid stores signal as (n_D2, n_D1, n_D0), so D2 → axis 0,
    D1 → axis 1, D0 → axis 2.  The long_name attribute on each dim spells out
    its (h, k, l) direction ('[0,K,0]' is the plain K axis); the H/K/L it maps
    to is the direction's nonzero component, not the letter in the label.
    In a file NEBULA3D wrote (*extra*), the exact stored centres are used.
    """
    labels: dict[str, str] = {}
    vectors: dict[str, NDArray[np.float64]] = {}
    for d_label in _DIM_TO_FILE_AXIS:
        labels[d_label] = _as_text(data_grp[d_label].attrs["long_name"])
        vectors[d_label] = _projection_vector(labels[d_label])
    _check_projection(Path(data_grp.file.filename).name, labels, vectors, w_matrix)

    result: dict[str, tuple[int, NDArray[np.float64]]] = {}
    for d_label, file_axis in _DIM_TO_FILE_AXIS.items():
        hkl_char = _HKL_LETTERS[int(np.argmax(vectors[d_label]))]
        result[hkl_char] = (file_axis, dim_centers(data_grp, d_label, extra))
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
    extra: h5py.Group | None = None,
) -> NDArray[np.float64]:
    """Pick the UB matrix: explicit override > file value > identity fallback."""
    if override is not None:
        return np.asarray(override, dtype=np.float64)
    ub = read_ub_matrix(root, extra)
    return ub if ub is not None else np.eye(3, dtype=np.float64)


def _oriented_lattice(root: h5py.Group) -> h5py.Group | None:
    """The sample's oriented lattice, if it has one with an orientation matrix."""
    sample = root.get("experiment0/sample")
    if sample is None or "oriented_lattice" not in sample:
        return None
    if ("num_oriented_lattice" in sample
            and int(np.ravel(sample["num_oriented_lattice"][()])[0]) == 0):
        return None
    lattice = sample["oriented_lattice"]
    return lattice if "orientation_matrix" in lattice else None


def _read_ub_matrix(lattice_grp: h5py.Group) -> NDArray[np.float64]:
    """Read the orientation matrix and scale to the physics (2π) convention."""
    return lattice_grp["orientation_matrix"][:].astype(np.float64) * _TWO_PI


def _stored_ub(extra: h5py.Group | None) -> NDArray[np.float64] | None:
    """NEBULA3D's exact copy of the UB (UB/2π·2π is not always bit-exact).

    Used when it agrees with the oriented lattice, or alone when Mantid could
    not store one (see :func:`_lattice_ub`).
    """
    if extra is None or "ub_matrix" not in extra:
        return None
    ub = np.asarray(extra["ub_matrix"][()], dtype=np.float64)
    return ub if ub.shape == (3, 3) else None


def _assemble(
    data_grp: h5py.Group,
    axes: dict[str, tuple[int, NDArray[np.float64]]],
    dtype: np.dtype | type = np.float64,
    *,
    keep_masked: bool = False,
) -> tuple[NDArray[np.floating], NDArray[np.floating], NDArray[np.bool_]]:
    """Read signal/σ²/mask and permute to canonical (H, K, L) axis order.

    Each array is read slab by slab straight into its canonical (H, K, L)
    buffer in *dtype* (see :func:`_read_canonical`), and the validity mask is
    applied **in place**: peak memory stays near the three output arrays plus
    one file slab — never a whole float64 volume beside a float32 one, which
    matters under the browser's 32-bit-WASM heap (see :mod:`nebula3d.webbridge`).

    σ = sqrt(max(σ², 0)) is taken in float64 before the cast; for a file
    NEBULA3D wrote that gives back the stored σ exactly (σ² of a float32 is
    exact in float64, and sqrt(fl(σ²)) = σ in binary floating point).  With
    *keep_masked* (a NEBULA3D file) the values under the mask are kept as
    stored; otherwise NaN or masked voxels are zeroed and set invalid.
    """
    perm = (axes["H"][0], axes["K"][0], axes["L"][0])

    sig = _read_canonical(data_grp["signal"], perm, dtype)
    sigma = _read_canonical(data_grp["errors_squared"], perm, dtype, _sqrt_nonneg)
    valid = _read_canonical(data_grp["mask"], perm, np.bool_, _unmasked)
    if keep_masked:
        return sig, sigma, valid

    valid &= np.isfinite(sig)
    # zero out invalid voxels so downstream code never sees NaN (in place)
    invalid = ~valid
    sig[invalid] = 0.0
    sigma[invalid] = 0.0

    return sig, sigma, valid


def _read_canonical(
    ds: h5py.Dataset,
    perm: tuple[int, int, int],
    dtype: np.dtype | type,
    transform: Callable[[np.ndarray], np.ndarray] | None = None,
) -> np.ndarray:
    """Read *ds* into a new C-ordered array whose axis i is file axis perm[i].

    Reads one block of whole axis-0 slabs at a time (a chunk's worth, so no
    chunk is decompressed twice) and casts it into the output through a
    transposed view of the same memory: no file-order or float64 copy of the
    whole volume is ever made.
    """
    out = np.empty(tuple(ds.shape[p] for p in perm), dtype=dtype)
    view = out.transpose(np.argsort(perm))  # the same memory in file axis order
    step = ds.chunks[0] if ds.chunks else 1
    for start in range(0, ds.shape[0], step):
        block = ds[start:start + step]
        view[start:start + step] = block if transform is None else transform(block)
    return out


def _sqrt_nonneg(err2: np.ndarray) -> np.ndarray:
    """σ from σ², in the file's float64."""
    return np.sqrt(np.maximum(err2, 0.0))


def _unmasked(mask: np.ndarray) -> np.ndarray:
    return mask == 0


# ---------------------------------------------------------------------------
# Writer helpers
# ---------------------------------------------------------------------------


def _bin_edges(centers: NDArray[np.float64]) -> NDArray[np.float64]:
    """N+1 bin edges around N centres: the midpoints, the outer edges half a
    step out (±0.5 around a single bin)."""
    c = np.asarray(centers, dtype=np.float64)
    if c.size == 1:
        return np.array([c[0] - 0.5, c[0] + 0.5])
    mid = 0.5 * (c[:-1] + c[1:])
    return np.concatenate(([c[0] - (mid[0] - c[0])], mid, [c[-1] + (c[-1] - mid[-1])]))


def _set_text_attrs(obj: h5py.HLObject, **values: str) -> None:
    """Scalar variable-length ASCII string attributes, as Mantid writes them.

    (h5py's default is UTF-8.)  Text outside ASCII is stored as its UTF-8 bytes.
    """
    import h5py

    vlen_ascii = h5py.string_dtype("ascii")
    for name, text in values.items():
        obj.attrs.create(name, str(text).encode("utf-8"), dtype=vlen_ascii)


def _nx_group(
    parent: h5py.Group, name: str, nx_class: str, version: int | None = None,
) -> h5py.Group:
    """A NeXus group: its NX_class attribute and, if given, an int32 version."""
    grp = parent.create_group(name)
    _set_text_attrs(grp, NX_class=nx_class)
    if version is not None:
        grp.attrs.create("version", np.int32(version))
    return grp


def _text_dataset(grp: h5py.Group, name: str, text: str) -> h5py.Dataset:
    """A string dataset as Mantid's NeXus layer writes one: shape (1,),
    fixed-length null-terminated ASCII exactly as long as the text, and a
    single blank for an empty string (HDF5 has no zero-length string type).

    Written through the low-level API with the file type as the memory type,
    so HDF5 copies the bytes instead of converting (a NULLPAD → NULLTERM
    conversion would drop the last character to make room for a terminator).
    """
    import h5py

    raw = str(text).encode("utf-8") or b" "
    tid = h5py.h5t.C_S1.copy()
    tid.set_size(len(raw))
    tid.set_strpad(h5py.h5t.STR_NULLTERM)
    tid.set_cset(h5py.h5t.CSET_ASCII)
    dsid = h5py.h5d.create(grp.id, name.encode(), tid, h5py.h5s.create_simple((1,)))
    dsid.write(h5py.h5s.ALL, h5py.h5s.ALL, np.array([raw], dtype=f"S{len(raw)}"),
               mtype=tid)
    return grp[name]


def _int32_dataset(grp: h5py.Group, name: str, value: int) -> None:
    grp.create_dataset(name, data=np.array([value], dtype=np.int32))


def _float_dataset(grp: h5py.Group, name: str, value: float) -> None:
    grp.create_dataset(name, data=np.array([value], dtype=np.float64))


def _write_volume(
    grp: h5py.Group,
    signal: NDArray[np.floating],
    sigma: NDArray[np.floating] | None,
    valid: NDArray[np.bool_] | None,
) -> None:
    """signal, errors_squared, num_events (float64) and mask (int8), slab by slab.

    Chunked one axis-0 slab per chunk like SaveMD's.  errors_squared, mask and
    num_events have fill values 0, 0 and 1, so they are written only when there
    is a σ or a masked voxel.
    """
    shape = signal.shape
    layout: dict[str, object] = {
        "shape": shape, "chunks": (1, shape[1], shape[2]), **_COMPRESSION}
    sig_ds = grp.create_dataset("signal", dtype="<f8", **layout)
    _set_text_attrs(sig_ds, axes="D2:D1:D0")
    sig_ds.attrs.create("signal", np.int32(1))
    err_ds = grp.create_dataset("errors_squared", dtype="<f8", fillvalue=0.0, **layout)
    events_ds = grp.create_dataset("num_events", dtype="<f8", fillvalue=1.0, **layout)
    mask_ds = grp.create_dataset("mask", dtype="i1", fillvalue=0, **layout)

    masked = valid is not None and not bool(np.all(valid))
    for i in range(shape[0]):
        sig_ds[i] = signal[i]  # HDF5 converts float32 → float64 exactly
        if sigma is not None:
            s = np.asarray(sigma[i], dtype=np.float64)
            err_ds[i] = s * s  # exact for a float32 σ
        if masked and valid is not None:
            ok = np.asarray(valid[i], dtype=np.bool_)
            mask_ds[i] = (~ok).astype(np.int8)
            events_ds[i] = ok.astype(np.float64)


def _lattice_ub(ub: NDArray[np.float64] | None) -> NDArray[np.float64] | None:
    """*ub* if Mantid can store it as an oriented lattice, else None.

    The identity is NEBULA3D's "unknown"; a non-finite or singular UB has no
    cell, and Mantid's OrientedLattice.setUB refuses det(UB) ≤ 0.
    """
    if ub is None:
        return None
    ub = np.asarray(ub, dtype=np.float64)
    if (ub.shape != (3, 3) or not np.all(np.isfinite(ub))
            or np.array_equal(ub, np.eye(3)) or not np.linalg.det(ub) > 0):
        return None
    return ub


def _write_experiment(
    entry: h5py.Group,
    dims: Sequence[MDDim],
    ub: NDArray[np.float64] | None,
    logs: Mapping[str, float | str],
    log_units: Mapping[str, str],
) -> None:
    """experiment0: blank instrument, run logs and sample, as SaveMD writes them.

    The instrument name stays blank like Mantid's own for a binned workspace —
    LoadMD would try to load an instrument definition by that name.
    """
    exp = _nx_group(entry, "experiment0", "NXgroup", version=1)

    inst = _nx_group(exp, "instrument", "NXinstrument", version=1)
    _text_dataset(inst, "name", "")
    xml = _nx_group(inst, "instrument_xml", "NXnote")
    _text_dataset(xml, "data", "")
    _text_dataset(xml, "description", "XML contents of the instrument IDF file.")
    _text_dataset(xml, "type", "text/xml")
    pmap = _nx_group(inst, "instrument_parameter_map", "NXnote", version=1)
    _text_dataset(pmap, "author", "")
    _text_dataset(pmap, "data", "")
    _text_dataset(pmap, "date",
                  datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f000"))
    _text_dataset(pmap, "description", _PARAMETER_MAP_DESCRIPTION)
    _text_dataset(pmap, "type", "text/plain")

    run = _nx_group(exp, "logs", "NXgroup", version=1)
    # column j = direction of Dj; dims[axis] is D(2 - axis)
    w_matrix = np.column_stack([np.asarray(dims[2 - j].direction, dtype=np.float64)
                                for j in range(3)])
    _write_log(run, "W_MATRIX", w_matrix.ravel())
    goniometer = _nx_group(run, "goniometer", "NXpositioner", version=1)
    _int32_dataset(goniometer, "num_axes", 0)
    goniometer.create_dataset("rotation_matrix", data=np.eye(3).ravel())
    _write_log(run, "mdhisto_was_modified", "1")
    for name, value in logs.items():
        _write_log(run, name, value, log_units.get(name, ""))

    sample = _nx_group(exp, "sample", "NXsample", version=1)
    _set_text_attrs(sample, name=" ", shape_xml=_SHAPE_XML)
    sample.attrs.create("name_empty", np.int32(1))
    for geom in ("geom_height", "geom_thickness", "geom_width"):
        _float_dataset(sample, geom, 0.0)
    _int32_dataset(sample, "geom_id", 0)
    material = _nx_group(sample, "material", "NXdata", version=2)
    _set_text_attrs(material, formulaStyle="empty", name=" ")
    for key, value in (("number_density", 0.0), ("packing_fraction", 1.0),
                       ("pressure", 0.0), ("temperature", 0.0)):
        _float_dataset(material, key, value)
    _int32_dataset(sample, "num_other_samples", 0)
    _int32_dataset(sample, "num_oriented_lattice", 0 if ub is None else 1)
    if ub is not None:
        _write_oriented_lattice(sample, ub)


def _write_log(
    run: h5py.Group, name: str, value: float | str | NDArray[np.float64],
    units: str = "",
) -> None:
    """One NXlog run log: a ``value`` dataset (float64, or a string) with units."""
    log = _nx_group(run, name, "NXlog")
    if isinstance(value, str):
        ds = _text_dataset(log, "value", value)
    else:
        ds = log.create_dataset(
            "value", data=np.atleast_1d(np.asarray(value, dtype=np.float64)))
    _set_text_attrs(ds, units=units or " ")


def _write_oriented_lattice(sample: h5py.Group, ub: NDArray[np.float64]) -> None:
    """The NXcrystal SaveMD writes: UB/2π (crystallographic) and the cell."""
    lattice = _nx_group(sample, "oriented_lattice", "NXcrystal")
    _int32_dataset(lattice, "cross_term", 0)
    _int32_dataset(lattice, "maximum_order", 0)
    lattice.create_dataset("modulated_hkl_error", data=np.zeros((3, 3)))
    lattice.create_dataset("modulated_orientation_matrix", data=np.zeros((3, 3)))
    lattice.create_dataset("orientation_matrix", data=ub / _TWO_PI)
    for name, value in zip(("a", "b", "c", "alpha", "beta", "gamma"), direct_cell(ub)):
        _float_dataset(lattice, f"unit_cell_{name}", value)
        _float_dataset(lattice, f"unit_cell_{name}_error", 0.0)
