# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""2D slice views through an HKLVolume.

Each slice is defined by which two axes are displayed (the *plane*) and the
coordinate value at which the third axis is cut.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, NamedTuple

import numpy as np
from numpy.typing import NDArray

from nebula3d.analysis.delta_pdf import DeltaPDF, section_geometry
from nebula3d.core import HKLVolume

if TYPE_CHECKING:
    from matplotlib.axes import Axes
    from matplotlib.lines import Line2D
    from matplotlib.transforms import Transform

# plane key → (fixed_axis_attr, array_dim, y_axis_attr, x_axis_attr,
#              y_label, x_label, transpose)
# The two-letter key reads as (horizontal, vertical): e.g. "kl" puts K on the
# x-axis and L on the y-axis, while "lk" is its transpose (L horizontal, K
# vertical).  `transpose` is True when the (row=y, col=x) order needed for
# display is the reverse of np.take's natural axis order, so the slice array
# must be transposed.
_PLANE: dict[str, tuple[str, int, str, str, str, str, bool]] = {
    # fixed H (array axis 0); natural remaining order is (K, L)
    "kl": ("h_axis", 0, "l_axis", "k_axis", "L (r.l.u.)", "K (r.l.u.)", True),
    "lk": ("h_axis", 0, "k_axis", "l_axis", "K (r.l.u.)", "L (r.l.u.)", False),
    # fixed K (array axis 1); natural remaining order is (H, L)
    "hl": ("k_axis", 1, "l_axis", "h_axis", "L (r.l.u.)", "H (r.l.u.)", True),
    "lh": ("k_axis", 1, "h_axis", "l_axis", "H (r.l.u.)", "L (r.l.u.)", False),
    # fixed L (array axis 2); natural remaining order is (H, K)
    "hk": ("l_axis", 2, "k_axis", "h_axis", "K (r.l.u.)", "H (r.l.u.)", True),
    "kh": ("l_axis", 2, "h_axis", "k_axis", "H (r.l.u.)", "K (r.l.u.)", False),
}
# Mantid-style names for the three principal (non-transposed) planes.
_ALIASES: dict[str, str] = {
    "0kl": "kl", "h0l": "hl", "hk0": "hk",
}

_PLANE_DPDF: dict[str, tuple[str, int, str, str, str, str, bool]] = {
    # fixed X (array axis 0); natural remaining order is (Y, Z)
    "yz": ("x_axis", 0, "z_axis", "y_axis", "Z (Å)", "Y (Å)", True),
    "zy": ("x_axis", 0, "y_axis", "z_axis", "Y (Å)", "Z (Å)", False),
    # fixed Y (array axis 1); natural remaining order is (X, Z)
    "xz": ("y_axis", 1, "z_axis", "x_axis", "Z (Å)", "X (Å)", True),
    "zx": ("y_axis", 1, "x_axis", "z_axis", "X (Å)", "Z (Å)", False),
    # fixed Z (array axis 2); natural remaining order is (X, Y)
    "xy": ("z_axis", 2, "y_axis", "x_axis", "Y (Å)", "X (Å)", True),
    "yx": ("z_axis", 2, "x_axis", "y_axis", "X (Å)", "Y (Å)", False),
}


def _format_cut_value(value: float, precision: int, zero_tol: float = 1e-4) -> str:
    """Format a slice coordinate, snapping near-zero cuts to 0.

    Grid planes that should sit at the origin carry float round-off (e.g.
    9.5e-07); any |value| below *zero_tol* is well under the real cut spacing,
    so it is shown as a clean ``0`` rather than scientific-notation noise.
    """
    value = 0.0 if abs(value) < zero_tol else value
    return f"{value:.{precision}g}"


class SliceData(NamedTuple):
    """2D slice extracted from an HKLVolume or a 3D-ΔPDF.

    The last three fields describe a section whose axes are not perpendicular
    (see :func:`nebula3d.analysis.delta_pdf.section_geometry`); ``None`` means
    a plain orthogonal slice.
    """

    data:      NDArray[np.float64]  # shape (n_y, n_x); NaN where masked
    y_axis:    NDArray[np.float64]  # bin-centre coordinates along rows
    x_axis:    NDArray[np.float64]  # bin-centre coordinates along columns
    y_label:   str                  # e.g. "K (r.l.u.)"
    x_label:   str                  # e.g. "L (r.l.u.)"
    cut_label: str                  # e.g. "H = 0.020 r.l.u."
    axes_angle: float | None = None  # angle between the x and y axes (deg)
    r_center: tuple[float, float] | None = None  # drawn point nearest the origin
    r_perp: float | None = None      # section plane's distance from the origin


def extract_slice(
    vol: HKLVolume,
    plane: str = "kl",
    value: float = 0.0,
    interp: bool = False,
) -> SliceData:
    """Extract a 2D slice along the fixed axis at *value*.

    Parameters
    ----------
    vol : HKLVolume
    plane : str
        Which two axes to show, read as ``(horizontal, vertical)``:
        ``'kl'``, ``'lk'``, ``'hl'``, ``'lh'``, ``'hk'``, ``'kh'``.  The two
        orderings of a pair are transposes of each other (``'kl'`` puts K on
        the x-axis and L on the y-axis; ``'lk'`` swaps them).  Mantid-style
        aliases ``'0kl'``, ``'h0l'``, ``'hk0'`` map to the principal planes.
        The remaining (fixed) axis is the one cut at *value* — e.g. any of
        ``'hk'``/``'kh'`` fixes L, so ``value=0.3333`` is the L = 0.3333 plane.
    value : float
        Coordinate of the cut along the fixed axis (r.l.u.).
    interp : bool
        If False (default), snap to the nearest grid plane. If True, linearly
        interpolate between the two bracketing planes so an off-grid cut such
        as L = 0.3333 is honoured exactly (NaN-aware: where one bracketing
        plane is masked, the other is used). Out-of-range values clamp to the
        first/last plane.
    """
    key = _ALIASES.get(plane.lower(), plane.lower())
    if key not in _PLANE:
        valid = list(_PLANE) + list(_ALIASES)
        raise ValueError(f"plane must be one of {valid}; got {plane!r}")

    fixed_attr, array_dim, y_attr, x_attr, y_label, x_label, transpose = _PLANE[key]
    fixed_axis: NDArray[np.float64] = getattr(vol, fixed_attr)
    masked: NDArray[np.floating] = vol.masked_data()

    if interp:
        data_2d, actual = _interp_plane(masked, fixed_axis, float(value), array_dim)
    else:
        idx = int(np.argmin(np.abs(fixed_axis - value)))
        actual = float(fixed_axis[idx])
        data_2d = np.take(masked, idx, axis=array_dim)

    # np.take leaves the two non-fixed axes in natural order; for a transposed
    # plane (e.g. "lk") swap them so rows/cols match the requested (y, x).
    if transpose:
        data_2d = data_2d.T

    y_axis: NDArray[np.float64] = getattr(vol, y_attr)
    x_axis: NDArray[np.float64] = getattr(vol, x_attr)
    fixed_name = fixed_attr[0].upper()  # 'H', 'K', or 'L'

    return SliceData(
        data=data_2d,
        y_axis=y_axis,
        x_axis=x_axis,
        y_label=y_label,
        x_label=x_label,
        cut_label=f"{fixed_name} = {_format_cut_value(actual, 4)} r.l.u.",
    )


def extract_slice_dpdf(
    vol: DeltaPDF,
    plane: str = "xy",
    value: float = 0.0,
    interp: bool = False,
) -> SliceData:
    """Extract a 2D slice from a 3D-Delta PDF along the fixed axis at *value*.
    
    Parameters
    ----------
    vol : DeltaPDF
    plane : str
        Which two axes to show: ``'xy'``, ``'yx'``, ``'yz'``, ``'zy'``, ``'xz'``, ``'zx'``.
    value : float
        Coordinate of the cut along the fixed axis (Å).
    interp : bool
        If False (default), snap to the nearest grid plane. If True, linearly
        interpolate between the two bracketing planes.

    The section keeps the ΔPDF's oblique grid; ``axes_angle``, ``r_center`` and
    ``r_perp`` on the result say how to draw it at the cell's real angle and
    where true distances sit in it.
    """
    key = plane.lower()
    if key not in _PLANE_DPDF:
        raise ValueError(f"plane must be one of {list(_PLANE_DPDF)}; got {plane!r}")

    fixed_attr, array_dim, y_attr, x_attr, y_label, x_label, transpose = _PLANE_DPDF[key]
    fixed_axis: NDArray[np.float64] = getattr(vol, fixed_attr)
    data: NDArray[np.floating] = vol.data

    if interp:
        data_2d, actual = _interp_plane(data, fixed_axis, float(value), array_dim)
    else:
        idx = int(np.argmin(np.abs(fixed_axis - value)))
        actual = float(fixed_axis[idx])
        data_2d = np.take(data, idx, axis=array_dim)

    if transpose:
        data_2d = data_2d.T

    y_axis: NDArray[np.float64] = getattr(vol, y_attr)
    x_axis: NDArray[np.float64] = getattr(vol, x_attr)
    fixed_name = fixed_attr[0].upper()  # 'X', 'Y', or 'Z'
    angle, center, perp = section_geometry(
        vol.cell_angles, x_attr[0], y_attr[0], actual)

    return SliceData(
        data=data_2d,
        y_axis=y_axis,
        x_axis=x_axis,
        y_label=y_label,
        x_label=x_label,
        cut_label=f"{fixed_name} = {_format_cut_value(actual, 2)} Å",
        axes_angle=angle,
        r_center=center,
        r_perp=perp,
    )


def plot_slice(
    vol: HKLVolume,
    plane: str = "kl",
    value: float = 0.0,
    ax: Axes | None = None,
    cmap: str = "hot",
    percentile: float = 99.5,
    vmin: float | None = None,
    vmax: float | None = None,
    log_scale: bool = False,
    interp: bool = False,
    title: str | None = None,
) -> Axes:
    """Plot a 2D intensity slice.

    Parameters
    ----------
    vol : HKLVolume
    plane : str
        See :func:`extract_slice`.
    value : float
        Coordinate of the cut along the fixed axis (r.l.u.).  E.g.
        ``plot_slice(vol, "hk", 0.3333)`` is the L = 0.3333 plane.
    ax : Axes, optional
        Existing axes to draw into; a new figure is created if *None*.
    cmap : str
        Matplotlib colormap name.
    percentile : float
        Upper percentile used to clip the colour scale (default 99.5).
        The lower clip is the symmetric percentile (``100 - percentile``).
    vmin, vmax : float, optional
        Override the percentile-derived colour limits.  When ``log_scale`` is
        True these are interpreted on the log₁₀ scale.  Either may be given
        alone (the other stays auto).
    log_scale : bool
        If True, plot ``log10(max(I, floor))`` where floor is 1 % of the
        maximum valid intensity.
    interp : bool
        Linearly interpolate to an off-grid cut instead of snapping to the
        nearest grid plane.  See :func:`extract_slice`.
    title : str, optional
        Axes title; defaults to the cut label (e.g. "H = 0 r.l.u.").

    Returns
    -------
    matplotlib.axes.Axes
    """
    import matplotlib.pyplot as plt

    sl = extract_slice(vol, plane=plane, value=value, interp=interp)
    display = sl.data.copy()

    if log_scale:
        valid_max = float(np.nanmax(display)) if np.any(np.isfinite(display)) else 1.0
        floor = max(valid_max * 0.01, 1e-6)
        display = np.where(np.isfinite(display), np.log10(np.maximum(display, floor)), np.nan)

    auto_vmin, auto_vmax = _percentile_clim(display, percentile)
    v0 = vmin if vmin is not None else auto_vmin
    v1 = vmax if vmax is not None else auto_vmax

    if ax is None:
        _, ax = plt.subplots(figsize=(7, 5))

    extent = _imshow_extent(sl.x_axis, sl.y_axis)
    img = ax.imshow(
        display,
        origin="lower",
        extent=extent,
        aspect="auto",
        cmap=cmap,
        vmin=v0,
        vmax=v1,
        interpolation="nearest",
    )
    # grey out masked/empty voxels
    img.set_cmap(img.cmap.with_extremes(bad="0.85"))

    plt.colorbar(img, ax=ax, fraction=0.046, pad=0.04,
                 label="log₁₀(I)" if log_scale else "Intensity (arb.)")
    ax.set_xlabel(sl.x_label)
    ax.set_ylabel(sl.y_label)
    ax.set_title(title or sl.cut_label)
    return ax


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _interp_plane(
    data: NDArray[np.floating],
    axis_coords: NDArray[np.floating],
    value: float,
    array_dim: int,
) -> tuple[NDArray[np.float64], float]:
    """Linearly interpolate the 3D *data* to a plane at *value* along *array_dim*.

    Assumes ascending *axis_coords* (bin centres).  Out-of-range values clamp
    to the first/last plane.  NaN-aware: where exactly one bracketing plane is
    finite, that value is used (no NaN bleed across the masked boundary).
    """
    n = len(axis_coords)
    if value <= axis_coords[0]:
        return np.take(data, 0, axis=array_dim), float(axis_coords[0])
    if value >= axis_coords[-1]:
        return np.take(data, n - 1, axis=array_dim), float(axis_coords[-1])

    i1 = int(np.searchsorted(axis_coords, value))  # first coord >= value
    i0 = i1 - 1
    c0, c1 = float(axis_coords[i0]), float(axis_coords[i1])
    w = (value - c0) / (c1 - c0) if c1 != c0 else 0.0

    p0 = np.take(data, i0, axis=array_dim).astype(np.float64)
    p1 = np.take(data, i1, axis=array_dim).astype(np.float64)
    out = (1.0 - w) * p0 + w * p1

    only0 = np.isfinite(p0) & ~np.isfinite(p1)
    only1 = ~np.isfinite(p0) & np.isfinite(p1)
    out[only0] = p0[only0]
    out[only1] = p1[only1]
    return out, float(value)


def _percentile_clim(
    data: NDArray[np.float64],
    pct: float,
) -> tuple[float, float]:
    valid = data[np.isfinite(data)]
    if valid.size == 0:
        return 0.0, 1.0
    lo = float(np.percentile(valid, 100.0 - pct))
    hi = float(np.percentile(valid, pct))
    return lo, hi


def _imshow_extent(
    x_axis: NDArray[np.float64],
    y_axis: NDArray[np.float64],
) -> tuple[float, float, float, float]:
    """Return [x_min, x_max, y_min, y_max] with half-bin margins."""
    dx = float(x_axis[1] - x_axis[0]) if len(x_axis) > 1 else 1.0
    dy = float(y_axis[1] - y_axis[0]) if len(y_axis) > 1 else 1.0
    return (
        float(x_axis[0])  - dx / 2,
        float(x_axis[-1]) + dx / 2,
        float(y_axis[0])  - dy / 2,
        float(y_axis[-1]) + dy / 2,
    )


# ---------------------------------------------------------------------------
# Oblique real-space sections (matplotlib)
# ---------------------------------------------------------------------------
_CELL_ATTRS = ("lat_a", "lat_b", "lat_c", "lat_alpha", "lat_beta", "lat_gamma")


def read_cell_attrs(
    attrs: Mapping[str, object],
) -> tuple[float, float, float, float, float, float] | None:
    """``(a, b, c, α, β, γ)`` from ΔPDF-file attrs, or ``None`` without a/b/c.

    Angles default to 90° for files written before the cell angles were stored.
    """
    if not all(k in attrs for k in _CELL_ATTRS[:3]):
        return None
    return tuple(  # type: ignore[return-value]
        float(attrs[k]) if k in attrs else 90.0  # type: ignore[arg-type]
        for k in _CELL_ATTRS)


def oblique_transform(ax: Axes, axes_angle: float) -> Transform:
    """Data transform that draws a section's oblique ``(h, v)`` coordinates at
    their real angle θ: ``X = h + v·cos θ``, ``Y = v·sin θ`` (true Å).

    Pass it as ``transform=`` to ``imshow``/``plot`` with the slice's own
    extent/coordinates, then set the axes limits in true Å.  For θ = 90° it is
    the plain data transform.
    """
    from matplotlib.transforms import Affine2D

    cos_t = 0.0 if abs(axes_angle - 90.0) < 1e-9 else float(np.cos(np.radians(axes_angle)))
    sin_t = 1.0 if cos_t == 0.0 else float(np.sin(np.radians(axes_angle)))
    skew = Affine2D(np.array([[1.0, cos_t, 0.0], [0.0, sin_t, 0.0], [0.0, 0.0, 1.0]]))
    return skew + ax.transData


def draw_unit_cell(
    ax: Axes,
    h_extent: tuple[float, float],
    v_extent: tuple[float, float],
    h_spacing: float | None,
    v_spacing: float | None,
    axes_angle: float = 90.0,
    **line_kw: object,
) -> list[Line2D]:
    """Light-gray unit-cell lines at multiples of the lattice spacings over an
    oblique section, drawn at its real angle (see :func:`oblique_transform`).

    Lines of constant ``h`` run along the vertical axis's direction; lines of
    constant ``v`` are horizontal.  Returns the lines (e.g. to toggle them).
    """
    tr = oblique_transform(ax, axes_angle)
    kw: dict[str, object] = {"color": "0.6", "lw": 0.6, "alpha": 0.7, "zorder": 3}
    kw.update(line_kw)
    lines: list[Line2D] = []
    (h0, h1), (v0, v1) = h_extent, v_extent
    if h_spacing and h_spacing > 0:
        for n in range(int(np.ceil(h0 / h_spacing)), int(np.floor(h1 / h_spacing)) + 1):
            lines += ax.plot([n * h_spacing] * 2, [v0, v1], transform=tr, **kw)  # type: ignore[arg-type]
    if v_spacing and v_spacing > 0:
        for m in range(int(np.ceil(v0 / v_spacing)), int(np.floor(v1 / v_spacing)) + 1):
            lines += ax.plot([h0, h1], [m * v_spacing] * 2, transform=tr, **kw)  # type: ignore[arg-type]
    return lines
