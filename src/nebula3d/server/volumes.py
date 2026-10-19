# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Volume loading (LRU cached) and 2D-slice extraction for the API.

Slices are extracted with the *same* :func:`nebula3d.visualization.extract_slice`
primitive the matplotlib viewers use, so the web viewer is pixel-for-pixel
consistent with them.  A loaded :class:`~nebula3d.core.HKLVolume` is ~130 MB, so a
small LRU keyed by ``(path, mtime)`` keeps cut-slider scrubbing responsive while
bounding memory.

Wire format for a slice (one request, self-contained):

    [uint32 LE: header_len][JSON header][float32 LE data, ny*nx, C-order]

The JSON header carries the plane's x/y axes, labels, the cut label, and a robust
colour-scale hint; masked voxels are NaN in the float32 payload (drawn grey by the
client).
"""

from __future__ import annotations

import json
import struct
import threading
from collections import OrderedDict
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

import nebula3d
from nebula3d.core import HKLVolume, sigma_note
from nebula3d.utils.reciprocal_space import direct_cell
from nebula3d.visualization import extract_slice
from nebula3d.visualization.slices import _ALIASES, _PLANE, SliceData

if TYPE_CHECKING:
    from nebula3d.analysis.ub_refine import MeanOffset

#: Plane keys accepted by the slice endpoint (principal pairs + Mantid aliases).
PLANES: tuple[str, ...] = tuple(_PLANE.keys()) + tuple(_ALIASES.keys())

# The reciprocal-space viewer displays every cleanup stage of one dataset at
# once (raw → ring-removed → Bragg-punched → backfilled → flattened = up to 5
# HKLVolumes), all sharing one cut slider.  The cache must hold all of them
# simultaneously or each slider move evicts and re-loads whole volumes from
# disk, stalling the panels.  6 keeps a full dataset warm with one slot of
# headroom.  Mind the sizing: each cached HKLVolume holds data + sigma
# (float64) + mask, ≈ 17 bytes/voxel — ~780 MB for a 46 M-voxel volume, so the
# worst case here is several GB.  Fine natively; the browser (WASM) build caps
# this via set_cache_max() from nebula3d.webbridge.setup().
_CACHE_MAX = 6
_cache: OrderedDict[tuple[str, float], HKLVolume] = OrderedDict()
_lock = threading.Lock()


def set_cache_max(n: int) -> None:
    """Cap the volume cache (evicting oldest); the browser build shrinks it."""
    global _CACHE_MAX
    with _lock:
        _CACHE_MAX = max(1, int(n))
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)


def load_volume(path: Path) -> HKLVolume:
    """Load an nebula3d/Mantid volume, caching by ``(path, mtime)``."""
    key = (str(path), path.stat().st_mtime)
    with _lock:
        vol = _cache.get(key)
        if vol is not None:
            _cache.move_to_end(key)
            return vol
    # dtype=None: keep the artifact's stored precision (float32 stage
    # files from a float32 run must not double in the viewer cache).
    vol = nebula3d.load(path, dtype=None)  # heavy I/O outside the lock
    with _lock:
        _cache[key] = vol
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return vol


_ring_cache: dict[tuple, dict] = {}


def clear_cache() -> None:
    with _lock:
        _cache.clear()
        _ring_cache.clear()


_CELL_KEYS = ("a", "b", "c", "alpha", "beta", "gamma")


def lattice_parameters(vol: HKLVolume) -> dict[str, float | None]:
    """Direct cell ``a/b/c`` (Å) and ``alpha/beta/gamma`` (degrees) from the UB
    matrix; every value ``None`` if the UB is singular."""
    try:
        cell = direct_cell(vol.ub_matrix)
    except np.linalg.LinAlgError:
        return dict.fromkeys(_CELL_KEYS)
    return {k: float(v) for k, v in zip(_CELL_KEYS, cell)}


def declared_symmetry(path: Path) -> tuple[str | None, list[list[list[int]]] | None]:
    """The point group a file says its data were symmetrised with (the
    ``symmetry`` and ``symmetry_ops`` attributes of a NeXus Viewer export, see
    :func:`nebula3d.io.hkl_reader.declared_attrs`), or ``(None, None)``."""
    from nebula3d.io.hkl_reader import declared_attrs
    from nebula3d.symmetry import read_symmetry_ops

    label = None
    try:
        import h5py

        with h5py.File(path, "r") as f:
            attrs = declared_attrs(f)
            raw = attrs.get("symmetry") if attrs is not None else None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        label = str(raw) if raw else None
        ops = read_symmetry_ops(path)
    except (OSError, ValueError):
        return None, None
    return label, ([np.asarray(op, dtype=int).tolist() for op in ops] if ops else None)


def volume_meta(path: Path) -> dict:
    """Compact metadata for a volume: shape, axis ranges, lattice, the
    symmetry its file declares, and whether its σ came with the data."""
    vol = load_volume(path)
    symmetry, symmetry_ops = declared_symmetry(path)
    return {
        "shape": [int(n) for n in vol.data.shape],
        "h_range": [float(vol.h_axis[0]), float(vol.h_axis[-1])],
        "k_range": [float(vol.k_axis[0]), float(vol.k_axis[-1])],
        "l_range": [float(vol.l_axis[0]), float(vol.l_axis[-1])],
        "lattice": lattice_parameters(vol),
        "ub_matrix": np.asarray(vol.ub_matrix, dtype=float).tolist(),
        "planes": list(PLANES),
        "symmetry": symmetry,
        "symmetry_ops": symmetry_ops,
        "sigma": "estimated" if vol.sigma_estimated else "measured",
        "sigma_note": sigma_note(vol),
    }


def _robust_max(arr: np.ndarray) -> float:
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return 1.0
    return float(np.percentile(np.abs(finite), 99)) or 1.0


def pack_slice(sd: SliceData) -> bytes:
    """Pack a :class:`~nebula3d.visualization.slices.SliceData` into the wire format."""
    data = np.ascontiguousarray(sd.data, dtype="<f4")  # masked voxels are NaN
    header = {
        "ny": int(data.shape[0]),
        "nx": int(data.shape[1]),
        "x_axis": np.asarray(sd.x_axis, dtype=float).tolist(),
        "y_axis": np.asarray(sd.y_axis, dtype=float).tolist(),
        "x_label": sd.x_label,
        "y_label": sd.y_label,
        "cut_label": sd.cut_label,
        "robust_max": _robust_max(data),
    }
    if sd.axes_angle is not None:  # a section drawn at a non-right angle (ΔPDF)
        header["axes_angle"] = float(sd.axes_angle)
        header["r_center"] = [float(v) for v in (sd.r_center or (0.0, 0.0))]
        header["r_perp"] = float(sd.r_perp or 0.0)
    hb = json.dumps(header).encode("utf-8")
    return struct.pack("<I", len(hb)) + hb + data.tobytes()


_coverage_cache: dict[tuple[str, float], dict] = {}


def volume_coverage(path: Path) -> dict:
    """The share of voxels holding counts per |Q| shell, and where the counts
    begin and end (:func:`nebula3d.analysis.coverage.q_coverage`), cached by
    ``(path, mtime)``."""
    from nebula3d.analysis.coverage import q_coverage

    key = (str(path), path.stat().st_mtime)
    with _lock:
        hit = _coverage_cache.get(key)
    if hit is not None:
        return hit
    c = q_coverage(load_volume(path))
    out = {
        "q": [round(float(x), 4) for x in c.q],
        "counted": [round(float(x), 4) for x in c.counted],
        "q_min_edge": c.q_min_edge, "q_max_edge": c.q_max_edge,
        "full_q_min": c.full_q_min, "full_q_max": c.full_q_max,
        "box_q": c.box_q, "box_corner_q": c.box_corner_q,
    }
    with _lock:
        _coverage_cache.clear()  # one volume's worth: they are small, but unbounded otherwise
        _coverage_cache[key] = out
    return out


_ub_cache: dict[tuple, dict] = {}


def symmetry_ops_for(path: Path) -> tuple[tuple[np.ndarray, ...] | None, str | None]:
    """The symmetry operations *path* declares, else those of a symmetrised
    export in the same folder that names *path* as its source (the NeXus
    Viewer's ``source_file``, see :func:`nebula3d.io.hkl_reader.declared_attrs`),
    with the name of the file they came from; ``(None, None)`` when neither
    declares any."""
    import h5py

    from nebula3d.io.hkl_reader import declared_attrs
    from nebula3d.symmetry import read_symmetry_ops

    ops = read_symmetry_ops(path)
    if ops is not None:
        return ops, path.name
    for other in sorted(path.parent.iterdir()):
        if other == path or other.suffix.lower() not in {".nxs", ".h5", ".hdf5"}:
            continue
        try:
            with h5py.File(other, "r") as f:
                attrs = declared_attrs(f)
                source = attrs.get("source_file") if attrs is not None else None
        except OSError:
            continue
        if isinstance(source, bytes):
            source = source.decode("utf-8")
        if source == path.name:
            ops = read_symmetry_ops(other)
            if ops is not None:
                return ops, other.name
    return None, None


def voxel_q(vol: HKLVolume) -> float:
    """The volume's finest grid step in Q (Å⁻¹): each axis's step through the UB."""
    ub = np.asarray(vol.ub_matrix, dtype=float)
    steps = [float(a[1] - a[0]) for a in (vol.h_axis, vol.k_axis, vol.l_axis)]
    return float(min(np.linalg.norm(ub[:, i]) * abs(steps[i]) for i in range(3)))


def volume_ub_check(path: Path, cell: tuple[int, int, int] = (1, 1, 1),
                    q_max: float | None = None) -> dict:
    """Whether the volume's UB puts its Bragg peaks on their nodes
    (:mod:`nebula3d.analysis.ub_refine`), cached by ``(path, mtime, cell, q_max)``.

    The refinement is :func:`~nebula3d.analysis.ub_refine.check_ub`'s, on a
    copy: the coverage edge trimmed first, one voxel layer (the pipeline's
    ``edge_trim`` default), as its voxels can sit orders of magnitude above
    the interior and pass for peaks; then :func:`~nebula3d.analysis.ub_refine.
    auto_fit`'s fit: only the changes that commute with the declared
    operations on a volume symmetrised under them, else the rotation and the
    cell together.  An unsymmetrised volume takes its operations from its
    symmetrised export (:func:`symmetry_ops_for`), to constrain the cell.
    The regrid (:mod:`nebula3d.server.regrid`) refines the same way.
    ``radial`` gives the peaks' offsets along Q relative to |Q| per |Q| band
    and direction.
    """
    from nebula3d.analysis.ub_refine import check_ub, mean_offset, radial_offsets

    key = (str(path), path.stat().st_mtime, tuple(cell), q_max)
    with _lock:
        hit = _ub_cache.get(key)
    if hit is not None:
        return hit
    from dataclasses import replace

    cached = load_volume(path)
    vol = replace(cached, data=cached.data.copy(), sigma=cached.sigma.copy(),
                  mask=cached.mask.copy())
    ops, ops_from = symmetry_ops_for(path)
    checked = check_ub(vol, ops, cell=cell, q_max=q_max)
    fit, broken, r = checked.fit, checked.symmetry_break, checked.refinement
    f = r.fit

    def rounded(m: np.ndarray) -> list:
        return np.round(np.asarray(m, dtype=float), 8).tolist()

    out = {
        "fit": fit,
        "cell_nodes": list(cell),
        "operations": None if ops is None else len(ops),
        "operations_from": ops_from,
        "symmetry_break": broken,
        "symmetrised": None if broken is None else fit == "symmetric",
        "passes": [{"q_max": p.q_max, "n_found": p.n_found, "n_used": p.n_used,
                    "rms_start": p.rms_start, "rms": p.rms, "angle_deg": p.angle_deg}
                   for p in r.passes],
        "n_searched": r.centres.n_searched,
        "n_used": f.n_used,
        "n_rejected": f.n_rejected,
        "rms_start": f.rms_start,
        "rms": f.rms,
        "angle_deg": f.angle_deg,
        "axis_uvw": rounded(f.axis_uvw),
        "cell_start": [float(x) for x in f.cell_start],
        "cell": [float(x) for x in f.cell],
        "transform": rounded(f.transform),
        "ub_start": rounded(f.ub_start),
        "ub": rounded(f.ub),
        "radial": [{"q_lo": o.q_lo, "q_hi": o.q_hi if np.isfinite(o.q_hi) else None,
                    "direction": o.direction, "n": o.n, "before": o.before, "after": o.after}
                   for o in radial_offsets(f, r.centres)],
        # The grid's finest step in Q: what an offset is small or large against.
        "voxel_q": voxel_q(vol),
        # The centres' mean offset from their nodes (r.l.u.): a shifted HKL
        # origin, which no UB removes, is this vector before and after the fit.
        "mean_offset_rlu": _mean_offset_out(mean_offset(f, r.centres)),
    }
    with _lock:
        _ub_cache.clear()  # one volume's check at a time
        _ub_cache[key] = out
    return out


def _mean_offset_out(m: MeanOffset) -> dict:
    def vec(v: tuple[float, float, float]) -> list[float | None]:
        return [round(x, 6) if np.isfinite(x) else None for x in v]

    return {"before": vec(m.before), "after": vec(m.after),
            "standard_error": vec(m.standard_error), "n": m.n}


def parse_ring_shells(q: str, fwhm: str) -> list[tuple[float, float]]:
    """``"2.45,3.66"``, ``"0.08,0.08"`` → [(2.45, 0.08), (3.66, 0.08)]: finite,
    positive |Q| centres and widths (Å⁻¹), as many of each, at most 64.
    Raises ``ValueError`` otherwise (NaN and infinity included)."""
    import math

    try:
        qs = [float(x) for x in str(q).split(",") if x.strip()]
        ws = [float(x) for x in str(fwhm).split(",") if x.strip()]
    except ValueError as exc:
        raise ValueError(f"q and fwhm must be numbers, not {q!r}, {fwhm!r}") from exc
    if (not qs or len(qs) != len(ws) or len(qs) > 64
            or not all(math.isfinite(v) and v > 0 for v in qs + ws)):
        raise ValueError("q and fwhm must list as many finite, positive numbers, at most 64")
    return list(zip(qs, ws))


def volume_ring_isotropy(path: Path, shells: list[tuple[float, float]]) -> dict:
    """Whether each ``(q_center, fwhm)`` shell of the volume (Å⁻¹) is a powder
    ring: it rises in nearly every direction over the sphere
    (:func:`~nebula3d.preprocessing.ring_isotropy.judge_shells`), cached by
    ``(path, mtime, shells)``. The ring removal subtracts only such shells."""
    from nebula3d.preprocessing.ring_isotropy import IsotropyConfig, judge_shells

    shells = [(round(float(q), 4), round(float(f), 4)) for q, f in shells]
    key = (str(path), path.stat().st_mtime, tuple(shells))
    with _lock:
        hit = _ring_cache.get(key)
    if hit is not None:
        return hit
    cfg = IsotropyConfig()
    out = {
        "rule": {"direction_share": cfg.direction_share, "height_share": cfg.height_share},
        "shells": [r.as_dict() for r in judge_shells(load_volume(path), shells, cfg)],
    }
    with _lock:
        _ring_cache.clear()  # one volume's shells at a time
        _ring_cache[key] = out
    return out


def slice_envelope(path: Path, plane: str, value: float, interp: bool) -> bytes:
    """Extract a 2D slice and pack it into the binary wire format above."""
    vol = load_volume(path)
    sd = extract_slice(vol, plane=plane, value=value, interp=interp)
    return pack_slice(sd)
