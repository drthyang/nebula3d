# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Where the measured data begin and end in |Q|.

A voxel is measured when its mask is set and it is finite: what the 3D-ΔPDF's
window support takes as data (the pipeline passes the volume's ``mask`` as
:func:`~nebula3d.analysis.delta_pdf.compute_delta_pdf`'s ``support``).  It holds
counts when it is measured and non-zero.  Per spherical |Q| shell,
:func:`q_coverage` takes the share of the box's voxels that hold counts: inside
the measured region nearly all of them do, past it nearly none.  The |Q| where
that share first rises through one half (above the beam stop) and where it last
falls through one half are the data's Qmin and Qmax edges, the limits the ΔPDF's
|Q| band should respect.

A volume that stores zeros for unmeasured space, unmasked, marks them measured:
there its counts end where its measured voxels do not, and the window's taper
to the coverage, which follows the measured voxels, cannot follow the counts.
So :func:`q_coverage` also gives where the shells stop being fully measured
(``measured_q_max``), beside where they stop fully holding counts
(``full_q_max``).

The box can end before the counts do: ``box_q`` is the distance to its
nearest face in Q.  A spherical band reaching past ``box_q`` is cut by the box
along that face's direction, while the counts may run further in others (an
ellipsoid window inscribed in the box uses them).  A face through the origin,
as a half-space volume (h ≥ 0) has, does not count: the shells there carry on
in the half the volume holds.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume
from nebula3d.utils.counting import bincount

#: Share of a shell's voxels that must hold counts for it to count as measured.
HALF = 0.5
#: ... and to count as fully measured.
FULL = 0.95


@dataclass(frozen=True)
class QCoverage:
    """The share of voxels holding counts per |Q| shell, and the edges."""

    q: NDArray[np.float64]  # shell centres (Å⁻¹)
    counted: NDArray[np.float64]  # share of the shell's voxels holding counts
    measured: NDArray[np.float64]  # share of the shell's voxels measured (mask, finite)
    n_voxels: NDArray[np.int64]  # the shell's voxels inside the box
    q_min_edge: float | None  # first rise through HALF (None: measured from 0)
    q_max_edge: float | None  # last fall through HALF (None: measured to the corner)
    full_q_min: float | None  # first shell ≥ FULL
    full_q_max: float | None  # last shell ≥ FULL
    measured_q_max: float | None  # last shell ≥ FULL measured: where the window's support ends
    box_q: float  # the nearest box face in Q (a face through the origin aside)
    box_corner_q: float  # farthest box corner
    q_step: float  # the shells' width (Å⁻¹): every edge is known to one shell


def box_extent_q(vol: HKLVolume) -> tuple[float, float]:
    """``(box_q, box_corner_q)``: the nearest face and the farthest corner in Q.

    The face ``h_i = f`` is the plane ``(UB⁻¹ Q)_i = f``; its distance from the
    origin is ``|f| / ‖row_i(UB⁻¹)‖`` (a non-orthogonal cell included).  A face
    within half a step of the origin (a half-space volume's) does not count;
    with no other face, ``box_q`` is 0.
    """
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    inv = np.linalg.inv(ub)
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    steps = [abs(float(ax[1]) - float(ax[0])) if len(ax) > 1 else 0.0 for ax in axes]
    faces = [abs(float(f)) / float(np.linalg.norm(inv[i]))
             for i, ax in enumerate(axes) for f in (ax[0], ax[-1])
             if abs(float(f)) > 0.5 * steps[i] + 1e-12]
    corners = np.array([[hv, kv, lv] for hv in (axes[0][0], axes[0][-1])
                        for kv in (axes[1][0], axes[1][-1])
                        for lv in (axes[2][0], axes[2][-1])], dtype=np.float64)
    corner_q = float(np.max(np.linalg.norm(corners @ ub.T, axis=1)))
    return (float(min(faces)) if faces else 0.0), corner_q


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


def _last_full(q: NDArray[np.float64], s: NDArray[np.float64]) -> float | None:
    """The centre of the last shell whose share is ``FULL`` or more; None if none is."""
    full = s >= FULL
    return float(q[len(s) - 1 - np.argmax(full[::-1])]) if full.any() else None


def q_coverage(vol: HKLVolume, q_step: float = 0.1, min_voxels: int = 50) -> QCoverage:
    """The share of voxels holding counts per |Q| shell of ``q_step`` (Å⁻¹), and
    the share measured.

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
    measured = np.zeros(nbins, dtype=np.int64)
    data, mask = vol.data, vol.mask
    for il, lv in enumerate(np.asarray(vol.l_axis, float)):
        qv = hk + ub[:, 2, None, None] * lv
        bins = np.minimum((np.sqrt((qv * qv).sum(axis=0)) / q_step).astype(np.int64),
                          nbins - 1).ravel()
        d = np.asarray(data[:, :, il])
        seen = np.asarray(mask[:, :, il], dtype=bool) & np.isfinite(d)
        held = (seen & (d != 0)).ravel()
        total += bincount(bins, minlength=nbins)
        counted += bincount(bins, weights=held, minlength=nbins).astype(np.int64)
        measured += bincount(bins, weights=seen.ravel(), minlength=nbins).astype(np.int64)
    keep = total >= min_voxels
    q = ((np.arange(nbins)[keep] + 0.5) * q_step).astype(np.float64)
    share = (counted[keep] / total[keep]).astype(np.float64)
    seen_share = (measured[keep] / total[keep]).astype(np.float64)
    return QCoverage(
        q=q, counted=share, measured=seen_share, n_voxels=total[keep],
        q_min_edge=_crossing(q, share, HALF, rising=True),
        q_max_edge=_crossing(q, share, HALF, rising=False),
        full_q_min=(float(q[np.argmax(share >= FULL)]) if (share >= FULL).any() else None),
        full_q_max=_last_full(q, share),
        measured_q_max=_last_full(q, seen_share),
        box_q=_box_q, box_corner_q=corner_q, q_step=float(q_step),
    )
