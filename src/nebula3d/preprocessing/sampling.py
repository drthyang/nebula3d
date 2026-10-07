# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Azimuthal sampling-density mask for symmetrised volumes.

A symmetrised HKL volume can be densely measured along some azimuthal directions
and sparsely along others.  In the under-sampled azimuthal sectors each (|Q|, φ)
cell holds only a handful of measurements, and those values are unreliable — on
real data they show up as bright radial "spokes" well above the true powder-ring
/ diffuse level.  They are a data-quality artefact, not signal, and powder-ring
removal correctly leaves them untouched (they are not azimuthally-smooth rings),
so they survive into the residual.

:func:`azimuthal_sampling_mask` flags those voxels so they can be dropped and
reconstructed by the downstream backfill, the same way ring/Bragg holes are.

The threshold is **relative to each |Q|-shell's own sampling**: the natural
number of grid points in a (|Q|, φ) cell grows with the ring circumference
(∝ |Q|), so a fixed absolute cut would wrongly delete the whole low-|Q| annulus
(few points per cell everywhere) as a "pixelised empty ring".  Comparing instead
to the typical cell occupancy *within the same shell* drops only sectors that are
anomalously sparse for their radius.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from nebula3d.core import HKLVolume
from nebula3d.preprocessing.radial_background import _azimuthal_angle
from nebula3d.symmetry import GridSymmetry


def trim_coverage_edge(vol: HKLVolume, voxels: int = 1, *,
                       symmetry: GridSymmetry | None = None) -> int:
    """Unmeasure the outer *voxels* layers of the measured coverage, in place.

    A measured voxel next to unmeasured space is only partly covered by the
    detectors, so its normalisation is tiny and its value unreliable.  On a
    TOPAZ volume (Fe3Ge2, 401³, 73 % unmeasured) the measured voxels touching an
    unmeasured one reach p99 ≈ 4,000 and a maximum of 5.5·10⁷, while a voxel
    further in they already match the interior (p99 ≈ 38 against 34).  Trimmed
    voxels become unmeasured exactly as the loader leaves them: masked, with
    data and sigma zeroed.  The volume's own faces are not an edge.  Returns
    the number of voxels trimmed.

    With the *symmetry* the data were symmetrised with, a voxel is trimmed
    when any equivalent voxel is.  The 3×3×3 neighbourhood is not invariant
    under operations that mix the grid axes (on Fe3Ge2's 6/m grid 15 % of the
    trimmed voxels kept a measured partner), and an equivalent voxel can see
    the coverage edge where this one meets the volume's face.
    """
    if voxels <= 0 or vol.mask.all():
        return 0
    edge = ndimage.binary_dilation(~vol.mask, structure=np.ones((3, 3, 3), dtype=bool),
                                   iterations=int(voxels))
    edge &= vol.mask
    if symmetry is not None:
        edge = symmetry.orbit_any(edge) & vol.mask
    vol.mask[edge] = False
    vol.data[edge] = 0.0
    vol.sigma[edge] = 0.0
    return int(edge.sum())


def azimuthal_sampling_mask(
    vol: HKLVolume,
    plane: str = "hk0",
    n_q_bins: int = 90,
    n_phi_bins: int = 72,
    min_count_frac: float = 0.25,
    min_count: int = 1,
    q_range: tuple[float, float] | None = None,
    q: NDArray[np.floating] | None = None,
    phi: NDArray[np.float64] | None = None,
) -> NDArray[np.bool_]:
    """Keep-mask that drops voxels in azimuthally under-sampled (|Q|, φ) cells.

    Parameters
    ----------
    vol : HKLVolume
    plane : str
        Reference plane defining φ (see :class:`PatchedRadialRingModel`).
    n_q_bins, n_phi_bins : int
        Resolution of the (|Q|, φ) sampling-density histogram.
    min_count_frac : float
        A (|Q|, φ) cell is dropped if its valid-voxel count is below this
        fraction of the *median populated-cell count in the same |Q| shell*.
        This is scale-aware: a uniformly low-occupancy shell (e.g. small-|Q|
        rings) is kept, only sectors anomalously sparse for their radius are
        dropped.  Default 0.25.
    min_count : int
        Absolute floor: cells with fewer valid voxels than this are always
        dropped (genuinely unusable).  Default 1 (effectively off) — keep it low
        so it does not fight the relative threshold at small |Q|, where every
        cell legitimately holds only a few voxels.
    q_range : (q_min, q_max), optional
        Restrict the histogram/mask to this |Q| range.  Voxels outside it keep
        their current mask state.
    q, phi : arrays, optional
        Precomputed per-voxel |Q| (Å⁻¹) and in-plane azimuth (rad).  Both are
        pure functions of the plane geometry, so a caller that already has them
        (e.g. the per-plane :func:`~nebula3d.pipeline.remove_rings` driver) can
        pass them in to skip rebuilding the meshgrid here.  Computed internally,
        identically, when ``None``.

    Returns
    -------
    keep : bool array, shape ``vol.shape``
        ``vol.mask`` with under-sampled cells additionally set False.  Already
        masked / invalid voxels stay masked.
    """
    if q is None:
        q = vol.q_magnitude()
    if phi is None:
        phi = _azimuthal_angle(vol, plane)
    valid = vol.mask & np.isfinite(vol.data)

    if q_range is None:
        q_range = (float(q[valid].min()), float(q[valid].max()))
    q0, q1 = q_range

    q_edges = np.linspace(q0, q1, n_q_bins + 1)
    phi_edges = np.linspace(-np.pi, np.pi, n_phi_bins + 1)

    # Count valid voxels per (|Q|, φ) cell.
    counts, _, _ = np.histogram2d(
        q[valid], phi[valid], bins=(q_edges, phi_edges)
    )

    # Per-shell reference = median occupancy over the populated φ-cells, so the
    # threshold scales with the shell's own sampling density.
    shell_thresh = np.zeros(n_q_bins)
    for b in range(n_q_bins):
        populated = counts[b][counts[b] > 0]
        if populated.size:
            shell_thresh[b] = max(min_count, min_count_frac * np.median(populated))

    # Look up each valid voxel's cell count and its shell threshold.
    qi = np.clip(np.digitize(q[valid], q_edges) - 1, 0, n_q_bins - 1)
    pi = np.clip(np.digitize(phi[valid], phi_edges) - 1, 0, n_phi_bins - 1)
    in_range = (q[valid] >= q0) & (q[valid] <= q1)
    cell_count = counts[qi, pi]

    keep = vol.mask.copy()
    drop_flat = in_range & (cell_count < shell_thresh[qi])
    keep[valid] = ~drop_flat
    return keep
