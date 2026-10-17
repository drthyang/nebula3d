# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The strongest features of a 3D-ΔPDF: where they are, their sign and size.

A pair correlation shows in the ΔPDF as an extremum at its interatomic vector:
positive where such pairs are more common than in the average structure,
negative where they are rarer. This module lists the local extrema of the
volume (not of a section, which can miss a feature off its plane) that stand
out from the volume's own spread, so that an answer can name each feature's
vector and sign from a measurement instead of reading them off a figure.

- **Size.** In units of the robust σ (1.4826 × the median absolute deviation)
  of the ΔPDF outside the origin's disk: most of the volume is ripple and noise
  around a few compact features, so σ is the floor they stand on.
- **The origin's disk** (the self-correlation and the smooth background terms,
  no pair correlation) is left out, with the share of the half-width the
  ΔPDF page and its contrast tool leave out (``ORIGIN_EXCLUDED`` in
  ``web/src/components/dpdfLevels.ts``).
- **One per ± pair.** The ΔPDF of a real I(Q) is centrosymmetric, ΔPDF(r) =
  ΔPDF(−r): each extremum is listed once, in the half with its first non-zero
  index offset positive.
- **Position** to a fraction of a voxel: a parabola through each axis's three
  voxels.
- **Groups.** Extrema of one sign, one length (within half a voxel) and one
  size (within 5 %) are listed together: on a crystal they are copies under its
  point symmetry, though the grouping does not use the symmetry and two
  different correlations can share a length.

How large a feature must be to interpret it, and what it means, is the
user's to decide (the delta-pdf-interpretation skill); the threshold here only
bounds the list.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from nebula3d.analysis.delta_pdf import real_space_radius

__all__ = ["DpdfFeatures", "FeatureGroup", "ORIGIN_EXCLUDED", "strongest_features"]

#: The origin's disk left out, as a share of the volume's largest half-width.
ORIGIN_EXCLUDED = 0.05

#: Extrema whose sizes differ by less than this share are grouped (with equal sign and length).
GROUP_SIZE_TOLERANCE = 0.05

#: The robust σ is taken over every voxel of a volume up to this many, and over
#: a regular subsample of about this many of a larger one (a 405³ ΔPDF: every
#: third voxel along each axis), which pins a median to a fraction of a per cent.
SIGMA_VOXELS = 8_000_000

Vector = tuple[float, float, float]


@dataclass(frozen=True)
class FeatureGroup:
    """Extrema of one sign, length and size: the copies of one correlation, most likely."""

    sign: int  # +1 or −1
    length: float  # |r| (Å)
    size_sigma: float  # the largest |ΔPDF| in the group, in robust σ
    value: float  # the ΔPDF there (signed)
    n: int  # how many extrema (one per ± pair) the group holds
    vectors: tuple[Vector, ...]  # (x, y, z) along a, b, c (Å), strongest first
    sizes_sigma: tuple[float, ...]  # each vector's |ΔPDF| in σ


@dataclass(frozen=True)
class DpdfFeatures:
    """:func:`strongest_features`' result."""

    sigma: float  # robust σ of the ΔPDF outside the origin's disk
    min_sigma: float  # the listing threshold, in σ
    origin_radius: float  # the origin's disk, Å
    n_extrema: int  # extrema above the threshold, one per ± pair
    groups: tuple[FeatureGroup, ...]  # the strongest first


def _robust_sigma(values: NDArray[np.floating]) -> float:
    centre = float(np.median(values))
    return 1.4826 * float(np.median(np.abs(values - centre)))


def _refine(data: NDArray[np.floating], idx: NDArray[np.integer]) -> NDArray[np.float64]:
    """Sub-voxel offsets of the extremum at *idx*: a parabola through each axis's
    three voxels (0 on an edge voxel), clipped to half a voxel."""
    out = np.zeros(3)
    for ax in range(3):
        if idx[ax] == 0 or idx[ax] == data.shape[ax] - 1:
            continue
        lo, hi = idx.copy(), idx.copy()
        lo[ax] -= 1
        hi[ax] += 1
        f_lo, f_0, f_hi = float(data[tuple(lo)]), float(data[tuple(idx)]), float(data[tuple(hi)])
        curv = f_lo - 2.0 * f_0 + f_hi
        if curv != 0.0:
            out[ax] = float(np.clip(0.5 * (f_lo - f_hi) / curv, -0.5, 0.5))
    return out


def strongest_features(
    data: NDArray[np.floating],
    x_axis: NDArray[np.floating],
    y_axis: NDArray[np.floating],
    z_axis: NDArray[np.floating],
    cell_angles: tuple[float, float, float] = (90.0, 90.0, 90.0),
    *,
    min_sigma: float = 5.0,
    limit: int = 12,
    max_vectors: int = 24,
) -> DpdfFeatures:
    """The ΔPDF's extrema above *min_sigma* robust σ outside the origin's disk,
    grouped by sign, length and size, the *limit* strongest groups (each with at
    most *max_vectors* of its vectors). *data* is indexed ``[ix, iy, iz]`` on
    the oblique axes along a, b, c (Å), with the origin on index n//2 of each.
    """
    if min_sigma <= 0:
        raise ValueError("min_sigma must be positive")
    if limit < 1:
        raise ValueError("limit must be at least 1")
    # The volume in its own precision, and nothing volume-sized in float64: a
    # measured ΔPDF (405³) must fit the browser build's 4 GB heap.
    d = np.asarray(data)
    if not np.isfinite(d).all():
        d = np.where(np.isfinite(d), d, 0)
    axes = [np.asarray(a, dtype=np.float64) for a in (x_axis, y_axis, z_axis)]
    half = max(max(abs(float(a[0])), abs(float(a[-1]))) for a in axes)
    origin_radius = ORIGIN_EXCLUDED * half
    # σ outside the origin's disk, from every voxel up to SIGMA_VOXELS of them,
    # else from a regular subsample of about that many.
    step = max(1, int(np.ceil((d.size / SIGMA_VOXELS) ** (1 / 3))))
    sub = d[::step, ::step, ::step]
    r_sub = real_space_radius(axes[0][::step][:, None, None], axes[1][::step][None, :, None],
                              axes[2][::step][None, None, :], cell_angles)
    values = sub[r_sub >= origin_radius].astype(np.float64)
    if not values.size:
        return DpdfFeatures(sigma=float("nan"), min_sigma=min_sigma, origin_radius=origin_radius,
                            n_extrema=0, groups=())
    sigma = _robust_sigma(values)
    del values, r_sub, sub
    if not sigma > 0:
        return DpdfFeatures(sigma=sigma, min_sigma=min_sigma, origin_radius=origin_radius,
                            n_extrema=0, groups=())
    level = min_sigma * sigma
    origin = np.array([n // 2 for n in d.shape])
    steps = np.array([float(a[1] - a[0]) if a.size > 1 else 1.0 for a in axes])
    found: list[tuple[float, int, Vector, float]] = []  # (|value|, sign, vector, length)
    for sign, extremum in ((1, ndimage.maximum_filter), (-1, ndimage.minimum_filter)):
        mask = extremum(d, size=3, mode="nearest") == d
        mask &= (d >= level) if sign > 0 else (d <= -level)
        for idx in np.argwhere(mask):
            offset = tuple(int(i) for i in idx - origin)
            if offset <= (0, 0, 0):  # the −r copy of one listed in the other half
                continue
            at = tuple(float(axes[a][idx[a]]) for a in range(3))
            if float(real_space_radius(at[0], at[1], at[2], cell_angles)) < origin_radius:
                continue
            shift = _refine(d, idx)
            vec = tuple(float(at[a] + shift[a] * steps[a]) for a in range(3))
            length = float(real_space_radius(vec[0], vec[1], vec[2], cell_angles))
            found.append((abs(float(d[tuple(idx)])), sign, vec, length))  # type: ignore[arg-type]
        del mask
    found.sort(key=lambda f: -f[0])
    tol_length = 0.5 * float(np.min(np.abs(steps)))
    groups: list[dict] = []
    for size, sign, vec, length in found:
        for g in groups:
            if (g["sign"] == sign and abs(g["length"] - length) <= tol_length
                    and abs(g["size"] - size) <= GROUP_SIZE_TOLERANCE * g["size"]):
                g["members"].append((vec, size))
                break
        else:
            groups.append({"sign": sign, "length": length, "size": size, "members": [(vec, size)]})
    out = tuple(
        FeatureGroup(
            sign=g["sign"], length=g["length"], size_sigma=g["size"] / sigma,
            value=g["sign"] * g["size"], n=len(g["members"]),
            vectors=tuple(m[0] for m in g["members"][:max_vectors]),
            sizes_sigma=tuple(m[1] / sigma for m in g["members"][:max_vectors]),
        )
        for g in groups[:limit]
    )
    return DpdfFeatures(sigma=sigma, min_sigma=min_sigma, origin_radius=origin_radius,
                        n_extrema=len(found), groups=out)
