# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Load and save HKLVolume from/to HDF5 or ASCII files."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume

_PathLike = str | Path


def load(
    path: _PathLike, *, dtype: np.dtype | type | None = np.float64,
    **kwargs: object,
) -> HKLVolume:
    """Load an HKLVolume from *path*.

    Supported formats (auto-detected by extension and file content):
    - ``.nxs`` / ``.h5`` / ``.hdf5``: a Mantid MDHistoWorkspace — a raw Mantid
      file or one NEBULA3D wrote (:func:`save`) — or the legacy nebula3d HDF5
      layout (``/entry/{data, sigma, mask, h_axis, k_axis, l_axis,
      ub_matrix}``): what NEBULA3D wrote before, and what the NeXus Viewer
      hands over
    - ``.txt`` / ``.dat`` / ``.hkl``: whitespace-delimited ASCII (h k l I [sigma])

    ``dtype`` sets the storage precision of ``data``/``sigma`` (float64
    default; the browser build loads float32 to halve its WASM-heap
    footprint; ``None`` preserves the volume's precision — the one NEBULA3D
    recorded when it wrote the file, float64 for a raw Mantid file — used by
    the slice viewers so a float32 artifact is not silently doubled on
    reload).  Axes and UB are always float64.
    """
    path = Path(path)
    ext = path.suffix.lower()
    if ext in {".h5", ".hdf5", ".nxs"}:
        from nebula3d.io.mantid_nxs import is_mantid_nxs, load_mantid_nxs
        if is_mantid_nxs(path):
            _reject_kwargs(kwargs)
            return load_mantid_nxs(path, dtype=dtype)
        entry = _pop_only_kwarg(kwargs, "entry", "/entry")
        return _load_hdf5(path, entry=entry, dtype=dtype)
    if ext in {".txt", ".dat", ".hkl"}:
        _reject_kwargs(kwargs)
        vol = _load_ascii(path)
        if dtype is not None and np.dtype(dtype) != vol.data.dtype:
            vol.data = vol.data.astype(dtype)
            vol.sigma = vol.sigma.astype(dtype)
        return vol
    raise ValueError(f"Unrecognised file extension: {ext!r}")


def save(vol: HKLVolume, path: _PathLike, **kwargs: object) -> None:
    """Save *vol* to *path* (format auto-detected by extension).

    ``.h5`` / ``.hdf5`` / ``.nxs`` write the Mantid MDHistoWorkspace layout
    (SaveMD version 2, see :func:`nebula3d.io.mantid_nxs.save_mantid_nxs`):
    Mantid Workbench opens the file with LoadMD whatever its extension, and
    :func:`load` reads it back losslessly.
    """
    path = Path(path)
    ext = path.suffix.lower()
    if ext in {".h5", ".hdf5", ".nxs"}:
        from nebula3d.io.mantid_nxs import save_mantid_nxs
        _reject_kwargs(kwargs)
        save_mantid_nxs(vol, path)
    elif ext in {".txt", ".dat", ".hkl"}:
        _reject_kwargs(kwargs)
        _save_ascii(vol, path)
    else:
        raise ValueError(f"Unrecognised file extension: {ext!r}")


def load_ub_matrix(path: _PathLike) -> NDArray[np.float64]:
    """The UB matrix of an HDF5 volume file, without reading its arrays.

    Either layout (MDHistoWorkspace or legacy ``/entry``); the identity when
    the file records none (NEBULA3D's "unknown").
    """
    import h5py

    from nebula3d.io.mantid_nxs import nebula3d_group, read_ub_matrix

    ub: NDArray[np.float64] | None = None
    with h5py.File(path, "r") as f:
        if "MDHistoWorkspace" in f:
            root = f["MDHistoWorkspace"]
            ub = read_ub_matrix(root, nebula3d_group(root))
        elif "entry/ub_matrix" in f:
            ub = np.array(f["entry/ub_matrix"], dtype=np.float64)
    return ub if ub is not None else np.eye(3, dtype=np.float64)


def _pop_only_kwarg(kwargs: dict[str, object], name: str, default: str) -> str:
    value = kwargs.pop(name, default)
    _reject_kwargs(kwargs)
    return str(value)


def _reject_kwargs(kwargs: dict[str, object]) -> None:
    if kwargs:
        names = ", ".join(sorted(kwargs))
        raise TypeError(f"Unexpected keyword argument(s): {names}")


# ------------------------------------------------------------------
# HDF5
# ------------------------------------------------------------------


def _load_hdf5(
    path: Path, entry: str = "/entry",
    dtype: np.dtype | type | None = np.float64,
) -> HKLVolume:
    """Read the legacy nebula3d layout: ``data``, ``sigma``, ``mask`` (True =
    valid), bin-centre ``h_axis``/``k_axis``/``l_axis`` and ``ub_matrix``
    (physics convention) under *entry*, plus an ``instrument`` attribute."""
    try:
        import h5py
    except ImportError as exc:
        raise ImportError("h5py is required to read HDF5 files.") from exc

    with h5py.File(path, "r") as f:
        grp = f[entry]
        # dtype=None preserves the stored precision (h5py returns it as-is).
        data = np.array(grp["data"], dtype=dtype)
        sigma = (np.array(grp["sigma"], dtype=dtype) if "sigma" in grp
                 else np.sqrt(np.abs(data)))
        mask = (np.array(grp["mask"], dtype=bool) if "mask" in grp
                else np.ones(data.shape, dtype=bool))
        h_axis = np.array(grp["h_axis"], dtype=np.float64)
        k_axis = np.array(grp["k_axis"], dtype=np.float64)
        l_axis = np.array(grp["l_axis"], dtype=np.float64)
        ub = np.array(grp["ub_matrix"], dtype=np.float64) if "ub_matrix" in grp else np.eye(3)
        instrument = str(grp.attrs.get("instrument", ""))

    return HKLVolume(
        data=data,
        sigma=sigma,
        mask=mask,
        h_axis=h_axis,
        k_axis=k_axis,
        l_axis=l_axis,
        ub_matrix=ub,
        instrument=instrument,
    )


# ------------------------------------------------------------------
# ASCII (h k l I sigma)
# ------------------------------------------------------------------


def _load_ascii(path: Path) -> HKLVolume:
    cols = np.loadtxt(path)
    if cols.ndim != 2 or cols.shape[1] < 4:
        raise ValueError("ASCII file must have at least 4 columns: h k l I [sigma]")

    h, k, l, intensity = cols[:, 0], cols[:, 1], cols[:, 2], cols[:, 3]
    sigma = cols[:, 4] if cols.shape[1] >= 5 else np.sqrt(np.abs(intensity))

    h_vals = np.unique(h)
    k_vals = np.unique(k)
    l_vals = np.unique(l)
    nh, nk, nl = len(h_vals), len(k_vals), len(l_vals)

    h_idx = np.searchsorted(h_vals, h)
    k_idx = np.searchsorted(k_vals, k)
    l_idx = np.searchsorted(l_vals, l)

    data = np.full((nh, nk, nl), np.nan)
    sig = np.full((nh, nk, nl), np.nan)
    data[h_idx, k_idx, l_idx] = intensity
    sig[h_idx, k_idx, l_idx] = sigma

    mask = np.isfinite(data)
    data_filled: NDArray[np.float64] = np.asarray(np.where(mask, data, 0.0), dtype=np.float64)
    sig_filled: NDArray[np.float64] = np.asarray(np.where(mask, sig, 0.0), dtype=np.float64)

    return HKLVolume(
        data=data_filled,
        sigma=sig_filled,
        mask=mask,
        h_axis=h_vals,
        k_axis=k_vals,
        l_axis=l_vals,
    )


def _save_ascii(vol: HKLVolume, path: Path) -> None:
    H, K, L = vol.hkl_grid()
    rows = np.column_stack([
        H.ravel(), K.ravel(), L.ravel(),
        vol.data.ravel(), vol.sigma.ravel(),
        vol.mask.ravel().astype(int),
    ])
    np.savetxt(path, rows, fmt="%10.4f %10.4f %10.4f %14.6e %14.6e %1d",
               header="h k l I sigma valid")
