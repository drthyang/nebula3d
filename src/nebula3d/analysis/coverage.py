# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Where the measured data begin and end in |Q|.

A voxel holds counts when it is measured (``mask``), finite and non-zero.  Per
spherical |Q| shell, :func:`q_coverage` takes the share of the box's voxels that
hold counts: inside the measured region nearly all of them do, past it nearly
none.  The |Q| where that share first rises through one half (above the beam
stop) and where it last falls through one half are the data's Qmin and Qmax
edges, the limits the ΔPDF's |Q| band should respect.

The box can end before the counts do: ``box_q`` is the radius of the largest
sphere inside it, the nearest face in Q.  A spherical band reaching past
``box_q`` is cut by the box along that face's direction, while the counts may
run further in others (an ellipsoid window inscribed in the box uses them).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume

#: Share of a shell's voxels that must hold counts for it to count as measured.
HALF = 0.5
#: ... and to count as fully measured.
FULL = 0.95


@dataclass(frozen=True)
class QCoverage:
    """The share of voxels holding counts per |Q| shell, and the edges."""

    q: NDArray[np.float64]  # shell centres (Å⁻¹)
    counted: NDArray[np.float64]  # share of the shell's voxels holding counts
    n_voxels: NDArray[np.int64]  # the shell's voxels inside the box
    q_min_edge: float | None  # first rise through HALF (None: measured from 0)
    q_max_edge: float | None  # last fall through HALF (None: measured to the corner)
    full_q_min: float | None  # first shell ≥ FULL
    full_q_max: float | None  # last shell ≥ FULL
    box_q: float  # largest sphere inside the box
    box_corner_q: float  # farthest box corner


def box_extent_q(vol: HKLVolume) -> tuple[float, float]:
    """``(box_q, box_corner_q)``: the nearest face and the farthest corner in Q.

    The face ``h_i = f`` is the plane ``(UB⁻¹ Q)_i = f``; its distance from the
    origin is ``|f| / ‖row_i(UB⁻¹)‖`` (a non-orthogonal cell included).
    """
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    inv = np.linalg.inv(ub)
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    faces = [abs(float(f)) / float(np.linalg.norm(inv[i]))
             for i, ax in enumerate(axes) for f in (ax[0], ax[-1])]
    corners = np.array([[hv, kv, lv] for hv in (axes[0][0], axes[0][-1])
                        for kv in (axes[1][0], axes[1][-1])
                        for lv in (axes[2][0], axes[2][-1])], dtype=np.float64)
    corner_q = float(np.max(np.linalg.norm(corners @ ub.T, axis=1)))
    return float(min(faces)), corner_q


def _crossing(q: NDArray[np.float64], s: NDArray[np.float64], level: float,
              rising: bool) -> float | None:
    """The |Q| where ``s`` first rises (or last falls) through ``level``,
    interpolated between shell centres; None when it never crosses."""
    above = s >= level
    if not above.any():
        return None
    if rising:
        k = int(np.argmax(above))
        if k == 0:
            return None
        j = k - 1
    else:
        k = int(len(s) - 1 - np.argmax(above[::-1]))
        if k == len(s) - 1:
            return None
        j = k + 1
    t = (level - s[j]) / (s[k] - s[j])
    return float(q[j] + t * (q[k] - q[j]))


def q_coverage(vol: HKLVolume, q_step: float = 0.1, min_voxels: int = 50) -> QCoverage:
    """The share of voxels holding counts per |Q| shell of ``q_step`` (Å⁻¹).

    Shells with fewer than ``min_voxels`` voxels in the box are left out.  The
    volume is walked one L plane at a time, so no full-size |Q| array is made.
    """
    if q_step <= 0:
        raise ValueError("q_step must be positive")
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    hh, kk = np.meshgrid(np.asarray(vol.h_axis, float), np.asarray(vol.k_axis, float),
                         indexing="ij")
    hk = ub[:, 0, None, None] * hh + ub[:, 1, None, None] * kk  # (3, nh, nk)
    _box_q, corner_q = box_extent_q(vol)
    nbins = int(np.ceil(corner_q / q_step)) + 1
    total = np.zeros(nbins, dtype=np.int64)
    counted = np.zeros(nbins, dtype=np.int64)
    data, mask = vol.data, vol.mask
    for il, lv in enumerate(np.asarray(vol.l_axis, float)):
        qv = hk + ub[:, 2, None, None] * lv
        bins = np.minimum((np.sqrt((qv * qv).sum(axis=0)) / q_step).astype(np.int64),
                          nbins - 1).ravel()
        d = np.asarray(data[:, :, il])
        held = (np.asarray(mask[:, :, il], dtype=bool) & np.isfinite(d) & (d != 0)).ravel()
        total += np.bincount(bins, minlength=nbins)
        counted += np.bincount(bins, weights=held, minlength=nbins).astype(np.int64)
    keep = total >= min_voxels
    q = ((np.arange(nbins)[keep] + 0.5) * q_step).astype(np.float64)
    share = (counted[keep] / total[keep]).astype(np.float64)
    return QCoverage(
        q=q, counted=share, n_voxels=total[keep],
        q_min_edge=_crossing(q, share, HALF, rising=True),
        q_max_edge=_crossing(q, share, HALF, rising=False),
        full_q_min=(float(q[np.argmax(share >= FULL)]) if (share >= FULL).any() else None),
        full_q_max=(float(q[len(share) - 1 - np.argmax((share >= FULL)[::-1])])
                    if (share >= FULL).any() else None),
        box_q=_box_q, box_corner_q=corner_q,
    )
