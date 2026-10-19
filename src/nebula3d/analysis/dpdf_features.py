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
- **Groups, by the declared symmetry.** When the point group the data were
  symmetrised with is declared (the raw file's ``symmetry_ops``, which the
  server passes on), extrema of one sign that are images of one another under
  it are one group: the copies of one correlation. The group is listed under
  its strongest extremum, with the orbit's multiplicity (its distinct vectors,
  one per ± pair), the extrema found on it, and their largest and mean size.
  Sizes are not compared, since on data that were not symmetrised the copies
  differ. The operations act on (h, k, l), and on the ΔPDF's fractional
  coordinates u = (x/a, y/b, z/c) as their transposes: ΔI(M·h) = ΔI(h) for
  each M of the group makes ΔPDF(Mᵀ·u) = Σ ΔI(h) cos 2π h·Mᵀu =
  Σ ΔI(M·h) cos 2π (M·h)·u = ΔPDF(u). On a cubic, tetragonal or orthorhombic
  cell Mᵀ is M⁻¹, itself in the group; on a hexagonal one it is not: the
  6-fold (h, k, l) → (h + k, −h, l) is (u, v, w) → (u − v, u, w). The
  inversion is added (r and −r are one feature). An image is compared along
  a, b, c with the cell's angles, in units of the grid's steps: the extremum
  of its sign nearest to an image of a stronger one joins that one's group
  when it lies within ``SYMMETRY_TOLERANCE`` (one voxel). Operations that
  change the recorded cell's lengths or angles, or a file that records no
  cell, leave the grouping below, and ``grouped_by`` says why.
- **Groups, by sign, length and size,** with no symmetry declared: extrema of
  one sign, one length (within half a voxel) and one size (within 5 %) are
  listed together. On a crystal they are copies under its point symmetry,
  though this grouping does not use the symmetry and two different
  correlations can share a length.

Either way the groups are listed by their strongest extremum, and the limit
counts groups, not extrema.

How large a feature must be to interpret it, and what it means, is the
user's to decide (the delta-pdf-interpretation skill); the threshold here only
bounds the list.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy import ndimage

from nebula3d.analysis.delta_pdf import real_space_radius
from nebula3d.symmetry import _group_closure, _triplet

__all__ = ["DpdfFeatures", "FeatureGroup", "ORIGIN_EXCLUDED", "strongest_features"]

#: The origin's disk left out, as a share of the volume's largest half-width.
ORIGIN_EXCLUDED = 0.05

#: Extrema whose sizes differ by less than this share are grouped (with equal sign and length).
GROUP_SIZE_TOLERANCE = 0.05

#: With a declared symmetry, the extremum nearest to an image of a stronger one
#: of its sign is a copy of it when it is this close, in voxels: the offset
#: along a, b, c in units of the grid's steps, its length taken with the
#: cell's angles. Two extrema of one sign are at least two voxels apart along
#: some axis (a 3 × 3 × 3 neighbourhood holds one of them), and both positions
#: are refined to a fraction of a voxel: on constructed peaks 0.3 to 0.6 Å wide
#: on 0.25 Å voxels, a copy lay a median 0.15 voxel (cubic) and 0.23 voxel
#: (hexagonal) from the image of its group's strongest, at most 0.61 and 0.74
#: (the per-axis parabola is biased on an oblique grid).
SYMMETRY_TOLERANCE = 1.0

#: How far a declared operation may change the recorded cell's metric G
#: (relative to √(G_ii·G_jj)) and still be applied: a refined cell is not
#: exactly symmetric. The lattice symmetry the ΔPDF's window follows allows
#: the same (``_LATTICE_TOL`` in ``nebula3d.analysis.delta_pdf``).
METRIC_TOLERANCE = 0.05

#: ``grouped_by`` with no symmetry declared.
BY_SHAPE = "sign, length and size (no symmetry declared)"

#: The robust σ is taken over every voxel of a volume up to this many, and over
#: a regular subsample of about this many of a larger one (a 405³ ΔPDF: every
#: third voxel along each axis), which pins a median to a fraction of a per cent.
SIGMA_VOXELS = 8_000_000

Vector = tuple[float, float, float]
_Found = tuple[float, int, Vector, float]  # (|value|, sign, vector, length)


@dataclass(frozen=True)
class FeatureGroup:
    """The copies of one correlation: extrema of one sign that are images of
    one another under the declared symmetry, or, with none declared, extrema of
    one sign, length and size."""

    sign: int  # +1 or −1
    length: float  # |r| of the strongest (Å)
    size_sigma: float  # the largest |ΔPDF| in the group, in robust σ
    value: float  # the ΔPDF there (signed)
    n: int  # how many extrema (one per ± pair) the group holds
    vectors: tuple[Vector, ...]  # (x, y, z) along a, b, c (Å), strongest (the representative) first
    sizes_sigma: tuple[float, ...]  # each vector's |ΔPDF| in σ
    mean_size_sigma: float = float("nan")  # the mean |ΔPDF| of the n extrema, in σ
    # With a declared symmetry, the orbit's distinct vectors, one per ± pair
    # (n is fewer when some are below the threshold or outside the volume); None without.
    multiplicity: int | None = None


@dataclass(frozen=True)
class DpdfFeatures:
    """:func:`strongest_features`' result."""

    sigma: float  # robust σ of the ΔPDF outside the origin's disk
    min_sigma: float  # the listing threshold, in σ
    origin_radius: float  # the origin's disk, Å
    n_extrema: int  # extrema above the threshold, one per ± pair
    groups: tuple[FeatureGroup, ...]  # the strongest first
    grouped_by: str = BY_SHAPE  # "declared symmetry (…)" or "sign, length and size (…)"


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


def _metric(lengths: Sequence[float], angles: Sequence[float]) -> NDArray[np.float64]:
    """The direct cell's metric tensor G (Å²): ``G_ij = a_i·a_j``."""
    a = np.asarray(lengths, dtype=np.float64)
    ca, cb, cg = np.cos(np.radians(np.asarray(angles, dtype=np.float64)))
    return np.array([[1.0, cg, cb], [cg, 1.0, ca], [cb, ca, 1.0]]) * np.outer(a, a)


@dataclass(frozen=True)
class _Grouping:
    """How the extrema are grouped: by *ops* (the declared point group with the
    inversion, as the matrices that act on fractional coordinates, Mᵀ for each
    M on (h, k, l)) on a cell of *lengths*, or, with *ops* None, by sign,
    length and size; *text* says which, and why."""

    text: str
    ops: NDArray[np.int64] | None = None
    lengths: tuple[float, ...] = ()


def _grouping(
    ops: Sequence[ArrayLike] | None,
    label: str | None,
    cell_lengths: Sequence[float | None] | None,
    cell_angles: tuple[float, float, float],
) -> _Grouping:
    """The declared symmetry, when it can be applied to the recorded cell."""
    if ops is None or len(ops) == 0:
        if label:
            return _Grouping(f"sign, length and size (the symmetry {label} is named, "
                             "but no operations are declared)")
        return _Grouping(BY_SHAPE)
    declared = tuple(np.asarray(m, dtype=np.int64).reshape(3, 3) for m in ops)
    name = label or "; ".join(_triplet(m) for m in declared)

    def not_applied(why: str) -> _Grouping:
        return _Grouping(
            f"sign, length and size (the declared symmetry {name} is not applied: {why})")

    try:
        group = _group_closure(declared + (-np.eye(3, dtype=np.int64),))
    except ValueError:
        return not_applied("its operations generate no crystallographic point group")
    lengths = tuple(float(c) for c in (cell_lengths or ()) if c is not None)
    if len(lengths) != 3 or not all(np.isfinite(c) and c > 0 for c in lengths):
        return not_applied("the ΔPDF file records no cell")
    metric = _metric(lengths, cell_angles)
    scale = np.sqrt(np.outer(np.diag(metric), np.diag(metric)))
    for m in group:
        r = m.T.astype(np.float64)
        if float((np.abs(r.T @ metric @ r - metric) / scale).max()) > METRIC_TOLERANCE:
            cell = ", ".join(f"{x:.4g}" for x in (*lengths, *cell_angles))
            return not_applied(f"{_triplet(m)} changes the cell the ΔPDF records ({cell})")
    return _Grouping(f"declared symmetry ({name}: {len(group)} operations, r ≡ −r)",
                     np.stack([m.T for m in group]), lengths)


def _by_shape(found: list[_Found], sigma: float, tol_length: float, limit: int,
              max_vectors: int) -> tuple[FeatureGroup, ...]:
    """Extrema of one sign, one length (within *tol_length*) and one size
    (within ``GROUP_SIZE_TOLERANCE``), strongest first."""
    groups: list[dict] = []
    for size, sign, vec, length in found:
        for g in groups:
            if (g["sign"] == sign and abs(g["length"] - length) <= tol_length
                    and abs(g["size"] - size) <= GROUP_SIZE_TOLERANCE * g["size"]):
                g["members"].append((vec, size))
                break
        else:
            groups.append({"sign": sign, "length": length, "size": size, "members": [(vec, size)]})
    return tuple(
        FeatureGroup(
            sign=g["sign"], length=g["length"], size_sigma=g["size"] / sigma,
            value=g["sign"] * g["size"], n=len(g["members"]),
            vectors=tuple(m[0] for m in g["members"][:max_vectors]),
            sizes_sigma=tuple(m[1] / sigma for m in g["members"][:max_vectors]),
            mean_size_sigma=float(np.mean([m[1] for m in g["members"]])) / sigma,
        )
        for g in groups[:limit]
    )


def _by_symmetry(found: list[_Found], sigma: float, ops: NDArray[np.int64],
                 cell_lengths: Sequence[float], steps: NDArray[np.float64],
                 cell_angles: tuple[float, float, float], limit: int,
                 max_vectors: int) -> tuple[FeatureGroup, ...]:
    """Extrema of one sign that are images of one another under *ops* (on
    fractional coordinates), each group under its strongest, strongest first."""
    vec = np.array([f[2] for f in found], dtype=np.float64).reshape(-1, 3)
    sign = np.array([f[1] for f in found], dtype=np.int64)
    size = np.array([f[0] for f in found], dtype=np.float64)
    cell = np.asarray(cell_lengths, dtype=np.float64)
    step = np.abs(steps)

    def voxels(delta: NDArray[np.float64]) -> NDArray[np.float64]:
        """The length of offsets along a, b, c (Å, last axis) in voxels."""
        d = delta / step
        return real_space_radius(d[..., 0], d[..., 1], d[..., 2], cell_angles)

    owner = np.full(len(found), -1, dtype=np.int64)
    out: list[FeatureGroup] = []
    for i in range(len(found)):
        if owner[i] >= 0:
            continue
        if len(out) == limit:
            break
        images = (ops @ (vec[i] / cell)) * cell  # (operations, 3), Å along a, b, c
        free = np.flatnonzero((owner < 0) & (sign == sign[i]))
        dist = voxels(vec[free, None, :] - images[None, :, :])  # (free, operations)
        nearest = dist.argmin(axis=0)  # each image takes the extremum nearest to it
        hit = dist[nearest, np.arange(len(images))] <= SYMMETRY_TOLERANCE
        members = np.unique(free[nearest[hit]])  # i among them (the identity), strongest first
        owner[members] = len(out)
        shown = members[:max_vectors]
        out.append(FeatureGroup(
            sign=int(sign[i]), length=found[i][3], size_sigma=float(size[i]) / sigma,
            value=float(sign[i] * size[i]), n=int(members.size),
            vectors=tuple(found[j][2] for j in shown),
            sizes_sigma=tuple(float(size[j]) / sigma for j in shown),
            mean_size_sigma=float(size[members].mean()) / sigma,
            multiplicity=_multiplicity(images, voxels),
        ))
    return tuple(out)


def _multiplicity(images: NDArray[np.float64],
                  voxels: Callable[[NDArray[np.float64]], NDArray[np.float64]]) -> int:
    """How many of *images* are distinct, counting r and −r once: those within
    ``SYMMETRY_TOLERANCE`` of one another are one (a vector on a mirror or an
    axis has fewer distinct images than the group has operations)."""
    same = ((voxels(images[:, None, :] - images[None, :, :]) <= SYMMETRY_TOLERANCE)
            | (voxels(images[:, None, :] + images[None, :, :]) <= SYMMETRY_TOLERANCE))
    kept: list[int] = []
    for i in range(len(images)):
        if not same[i, kept].any():
            kept.append(i)
    return len(kept)


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
    symmetry_ops: Sequence[ArrayLike] | None = None,
    symmetry_label: str | None = None,
    cell_lengths: Sequence[float | None] | None = None,
) -> DpdfFeatures:
    """The ΔPDF's extrema above *min_sigma* robust σ outside the origin's disk,
    grouped, the *limit* strongest groups (each with at most *max_vectors* of
    its vectors). *data* is indexed ``[ix, iy, iz]`` on the oblique axes along
    a, b, c (Å), with the origin on index n//2 of each.

    With *symmetry_ops*, the point group the data were symmetrised with (its
    matrices on (h, k, l), as :func:`nebula3d.symmetry.parse_symmetry_ops`
    reads them), and the cell's *cell_lengths* (a, b, c in Å), the extrema
    that are images of one another under it are grouped; *symmetry_label*
    names it in ``grouped_by``. Without, they are grouped by sign, length and
    size.
    """
    if min_sigma <= 0:
        raise ValueError("min_sigma must be positive")
    if limit < 1:
        raise ValueError("limit must be at least 1")
    grouping = _grouping(symmetry_ops, symmetry_label, cell_lengths, cell_angles)
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
                            n_extrema=0, groups=(), grouped_by=grouping.text)
    sigma = _robust_sigma(values)
    del values, r_sub, sub
    if not sigma > 0:
        return DpdfFeatures(sigma=sigma, min_sigma=min_sigma, origin_radius=origin_radius,
                            n_extrema=0, groups=(), grouped_by=grouping.text)
    level = min_sigma * sigma
    origin = np.array([n // 2 for n in d.shape])
    steps = np.array([float(a[1] - a[0]) if a.size > 1 else 1.0 for a in axes])
    found: list[_Found] = []
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
    if grouping.ops is None:
        groups = _by_shape(found, sigma, 0.5 * float(np.min(np.abs(steps))), limit, max_vectors)
    else:
        groups = _by_symmetry(found, sigma, grouping.ops, grouping.lengths, steps, cell_angles,
                              limit, max_vectors)
    return DpdfFeatures(sigma=sigma, min_sigma=min_sigma, origin_radius=origin_radius,
                        n_extrema=len(found), groups=groups, grouped_by=grouping.text)
