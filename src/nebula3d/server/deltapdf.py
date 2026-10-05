# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Real-space 3D-ΔPDF loading and orthoslice extraction for the API.

ΔPDF ``.h5`` files (written by :func:`nebula3d.pipeline.write_delta_pdf_h5` /
``examples/delta_pdf.py``) hold different content from an :class:`HKLVolume`:
a signed real-space array indexed ``[ix, iy, iz]`` with axes x_H, y_K, z_L in Å
along a, b, c, plus the direct cell.  :func:`nebula3d.io.load_delta_pdf` reads
both layouts — the Mantid MDHistoWorkspace one (cell in the oriented lattice)
and the legacy root one (cell in ``lat_*`` attrs; files without
``lat_alpha/beta/gamma`` are treated as 90°).

Each slice header carries ``axes_angle`` (the real angle between its two axes:
γ for xy, β for xz, α for yz) plus ``r_center``/``r_perp``, so the client draws
the section at its true shape and can place true-|r| circles on it.

The three orthoslice planes match the matplotlib viewers:

    xy : x_H–y_K  (fix z_L)   — slice_hk0
    xz : x_H–z_L  (fix y_K)   — slice_h0l
    yz : y_K–z_L  (fix x_H)   — slice_0kl

Slices are packed into the same binary envelope as the reciprocal-space slices
(see :mod:`nebula3d.server.volumes`).  Because the ΔPDF is signed, the colour scale
hint is a robust *far-field* level (p98 of ``|ΔPDF|`` at in-plane r > 3 Å) so the
huge near-origin spike does not dominate; the client renders it diverging about 0.
"""

from __future__ import annotations

import json
import struct
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from nebula3d.analysis.delta_pdf import section_geometry
from nebula3d.io.delta_pdf_file import load_delta_pdf

#: Orthoslice plane keys (and the axis each one fixes).
DPDF_PLANES: tuple[str, ...] = ("xy", "xz", "yz")

_CACHE_MAX = 3  # keep several DeltaPDF volumes resident for the comparison viewer
_cache: OrderedDict[tuple[str, float], DeltaPdfData] = OrderedDict()
_lock = threading.Lock()


def set_cache_max(n: int) -> None:
    """Cap the ΔPDF cache (evicting oldest); the browser build shrinks it."""
    global _CACHE_MAX
    with _lock:
        _CACHE_MAX = max(1, int(n))
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)


@dataclass
class DeltaPdfData:
    data: np.ndarray  # (nx, ny, nz)
    x_axis: np.ndarray
    y_axis: np.ndarray
    z_axis: np.ndarray
    lat_a: float | None
    lat_b: float | None
    lat_c: float | None
    q_max: float | None
    lat_alpha: float | None = None
    lat_beta: float | None = None
    lat_gamma: float | None = None

    @property
    def cell_angles(self) -> tuple[float, float, float]:
        """(α, β, γ) in degrees; 90° for any angle the file does not record."""
        return tuple(  # type: ignore[return-value]
            90.0 if v is None else v
            for v in (self.lat_alpha, self.lat_beta, self.lat_gamma))


def load_dpdf(path: Path) -> DeltaPdfData:
    """Load a ΔPDF ``.h5``, caching by ``(path, mtime)``."""
    key = (str(path), path.stat().st_mtime)
    with _lock:
        d = _cache.get(key)
        if d is not None:
            _cache.move_to_end(key)
            return d
    f = load_delta_pdf(path)  # dtype=None: keep the ΔPDF's own precision
    lat = f.lattice
    q_max = f.logs.get("q_max")
    assert f.data is not None
    d = DeltaPdfData(
        data=f.data,
        x_axis=f.x_axis,
        y_axis=f.y_axis,
        z_axis=f.z_axis,
        lat_a=lat["a"],
        lat_b=lat["b"],
        lat_c=lat["c"],
        q_max=float(q_max) if isinstance(q_max, float) else None,
        lat_alpha=lat["alpha"],
        lat_beta=lat["beta"],
        lat_gamma=lat["gamma"],
    )
    with _lock:
        _cache[key] = d
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return d


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def dpdf_meta(path: Path) -> dict:
    d = load_dpdf(path)
    return {
        "shape": [int(n) for n in d.data.shape],
        "x_range": [float(d.x_axis[0]), float(d.x_axis[-1])],
        "y_range": [float(d.y_axis[0]), float(d.y_axis[-1])],
        "z_range": [float(d.z_axis[0]), float(d.z_axis[-1])],
        "lattice": {"a": d.lat_a, "b": d.lat_b, "c": d.lat_c,
                    "alpha": d.lat_alpha, "beta": d.lat_beta, "gamma": d.lat_gamma},
        "q_max": d.q_max,
        "planes": list(DPDF_PLANES),
    }


def _nearest(axis: np.ndarray, value: float) -> int:
    return int(np.argmin(np.abs(axis - value)))


def _robust_far(data2d: np.ndarray, xs: np.ndarray, ys: np.ndarray,
                r_min: float = 3.0, pct: float = 98.0,
                axes_angle: float = 90.0) -> float:
    """p<pct> of |ΔPDF| at in-plane radius > r_min Å (skip near-origin spike).

    The in-plane radius is the true one for axes meeting at ``axes_angle``.
    """
    xg, yg = np.meshgrid(xs, ys, indexing="xy")  # (ny, nx), matching data2d [y, x]
    cos_t = 0.0 if axes_angle == 90.0 else float(np.cos(np.radians(axes_angle)))
    r = np.sqrt(np.maximum(xg**2 + yg**2 + 2.0 * cos_t * xg * yg, 0.0))
    vals = np.abs(data2d[r > r_min])
    vals = vals[np.isfinite(vals)]
    if vals.size == 0:
        vals = np.abs(data2d[np.isfinite(data2d)])
    if vals.size == 0:
        return 1.0
    return float(np.percentile(vals, pct)) or 1.0


def _cut_value(d: DeltaPdfData, plane: str, value: float) -> float:
    """The grid value actually cut along the plane's fixed axis (Å)."""
    fixed = {"xy": d.z_axis, "xz": d.y_axis, "yz": d.x_axis}[plane]
    return float(fixed[_nearest(fixed, value)])


def dpdf_slice_envelope(path: Path, plane: str, value: float) -> bytes:
    """Extract one orthoslice and pack it into the binary slice envelope."""
    d = load_dpdf(path)
    if plane == "xy":  # x_H–y_K, fix z_L
        iz = _nearest(d.z_axis, value)
        data2d = np.ascontiguousarray(d.data[:, :, iz].T, dtype="<f4")
        xs, ys, xl, yl = d.x_axis, d.y_axis, "x_H (Å)", "y_K (Å)"
        cut = f"z_L = {float(d.z_axis[iz]):.3g} Å"
    elif plane == "xz":  # x_H–z_L, fix y_K
        iy = _nearest(d.y_axis, value)
        data2d = np.ascontiguousarray(d.data[:, iy, :].T, dtype="<f4")
        xs, ys, xl, yl = d.x_axis, d.z_axis, "x_H (Å)", "z_L (Å)"
        cut = f"y_K = {float(d.y_axis[iy]):.3g} Å"
    elif plane == "yz":  # y_K–z_L, fix x_H
        ix = _nearest(d.x_axis, value)
        data2d = np.ascontiguousarray(d.data[ix, :, :].T, dtype="<f4")
        xs, ys, xl, yl = d.y_axis, d.z_axis, "y_K (Å)", "z_L (Å)"
        cut = f"x_H = {float(d.x_axis[ix]):.3g} Å"
    else:
        raise ValueError(f"unknown ΔPDF plane {plane!r}")

    angle, center, perp = section_geometry(
        d.cell_angles, plane[0], plane[1], _cut_value(d, plane, value))
    header = {
        "ny": int(data2d.shape[0]),
        "nx": int(data2d.shape[1]),
        "x_axis": np.asarray(xs, dtype=float).tolist(),
        "y_axis": np.asarray(ys, dtype=float).tolist(),
        "x_label": xl,
        "y_label": yl,
        "cut_label": cut,
        "robust_max": _robust_far(data2d, xs, ys, axes_angle=angle),
        "axes_angle": angle,
        "r_center": list(center),
        "r_perp": perp,
    }
    hb = json.dumps(header).encode("utf-8")
    return struct.pack("<I", len(hb)) + hb + data2d.tobytes()
