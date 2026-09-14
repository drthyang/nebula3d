# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Core data structure for a 3D HKL intensity volume."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray


def low_memory() -> bool:
    """Whether to favour a smaller memory peak over speed.

    Enabled by ``NEBULA3D_LOW_MEMORY=1`` (set by ``nebula3d.webbridge.setup`` for
    the in-browser Pyodide build, whose 4 GB WASM heap makes the peak — not the
    CPU — the binding constraint).  In this mode the pipeline stages drop
    volume-sized caches that only trade memory for a little recompute and write
    their output in place over the (disposable) freshly-loaded input, instead of
    copying it.  Off by default, so the native path is unchanged.
    """
    return os.environ.get("NEBULA3D_LOW_MEMORY") == "1"


def q_magnitude_from_axes(
    h_axis: NDArray[np.float64],
    k_axis: NDArray[np.float64],
    l_axis: NDArray[np.float64],
    ub_matrix: NDArray[np.float64],
    *,
    out_dtype: np.dtype | type | None = None,
) -> NDArray[np.floating]:
    """|Q| in Å^-1 on the (nh, nk, nl) grid spanned by three 1-D axes.

    Accumulates |Q|² from broadcast 1-D axes instead of materialising the full
    (nh, nk, nl) meshgrid and the (..., 3) Cartesian stack: peak memory is
    2 volume-sized arrays instead of ~10, which is what lets full-resolution
    volumes run inside the browser's WASM heap (see docs/web.md).

    The arithmetic is ALWAYS float64 (axes/UB are float64; every |Q|-derived
    decision — bin edges, band masks, thresholds — must not depend on the
    volume's storage precision).  ``out_dtype`` only downcasts the *stored*
    result (float32 mode halves the resident grid); ``None`` keeps float64 —
    bit-identical to the historical behaviour.
    """
    h = np.asarray(h_axis, dtype=np.float64)[:, None, None]
    k = np.asarray(k_axis, dtype=np.float64)[None, :, None]
    l_ = np.asarray(l_axis, dtype=np.float64)[None, None, :]
    ub = np.asarray(ub_matrix, dtype=np.float64)
    q2: NDArray[np.float64] | None = None
    for row in ub:
        qc = row[0] * h + row[1] * k   # (nh, nk, 1) — small
        qc = qc + row[2] * l_          # one full-volume array per component
        np.square(qc, out=qc)
        q2 = qc if q2 is None else np.add(q2, qc, out=q2)
    assert q2 is not None
    q = np.sqrt(q2, out=q2)
    if out_dtype is not None and np.dtype(out_dtype) != q.dtype:
        return q.astype(out_dtype)
    return q


def q_bin_indices(
    h_axis: NDArray[np.float64],
    k_axis: NDArray[np.float64],
    l_axis: NDArray[np.float64],
    ub_matrix: NDArray[np.float64],
    edges: NDArray[np.float64],
    *,
    slab: int = 16,
) -> NDArray[np.int32]:
    """``np.digitize(|Q|, edges)`` computed per H-slab in float64, stored int32.

    The single source of |Q|-bin decisions for every stage that shell-bins the
    volume: the |Q| arithmetic (and therefore which side of a bin edge every
    voxel lands on) is always float64 regardless of the volume's storage dtype,
    so a float32 run can never flip a bin assignment — and the full float64 |Q|
    grid never needs to be resident (peak extra memory is one f64 slab).

    Bit-identical to ``np.digitize(q_magnitude_from_axes(...), edges)``: the
    accumulation is elementwise (no cross-element reduction), so slab
    boundaries cannot change any value.
    """
    edges64 = np.asarray(edges, dtype=np.float64)
    nh = int(np.asarray(h_axis).size)
    out = np.empty((nh, int(np.asarray(k_axis).size),
                    int(np.asarray(l_axis).size)), dtype=np.int32)
    for lo in range(0, nh, max(1, int(slab))):
        hi = min(nh, lo + max(1, int(slab)))
        q_slab = q_magnitude_from_axes(
            np.asarray(h_axis)[lo:hi], k_axis, l_axis, ub_matrix)
        out[lo:hi] = np.digitize(q_slab, edges64).astype(np.int32)
    return out


@dataclass
class HKLVolume:
    """3D reciprocal-space intensity grid in fractional HKL coordinates.

    Attributes
    ----------
    data:
        Shape (nh, nk, nl) intensity array.
    sigma:
        Shape (nh, nk, nl) standard-deviation array (same units as data).
    mask:
        Boolean array; True = voxel is valid (not masked).
    h_axis, k_axis, l_axis:
        1D coordinate arrays giving the h, k, l value of each voxel centre.
    ub_matrix:
        (3, 3) UB matrix in Å^-1 (columns = reciprocal-lattice vectors).
    instrument:
        Free-text instrument name for provenance.
    """

    data: NDArray[np.floating]
    sigma: NDArray[np.floating]
    mask: NDArray[np.bool_]
    h_axis: NDArray[np.float64]
    k_axis: NDArray[np.float64]
    l_axis: NDArray[np.float64]
    ub_matrix: NDArray[np.float64] = field(
        default_factory=lambda: np.eye(3, dtype=np.float64)
    )
    instrument: str = ""

    @property
    def dtype(self) -> np.dtype:
        """Storage precision of the volume (``data``'s dtype).

        float64 everywhere by default; the browser build stores volumes in
        float32 (halving the WASM-heap footprint) while axes/UB and every
        |Q|-derived decision stay float64 — see docs/web.md.
        """
        return self.data.dtype

    # ------------------------------------------------------------------
    # Convenience constructors
    # ------------------------------------------------------------------

    @classmethod
    def from_arrays(
        cls,
        data: NDArray[np.floating],
        h_range: tuple[float, float],
        k_range: tuple[float, float],
        l_range: tuple[float, float],
        sigma: NDArray[np.floating] | None = None,
        ub_matrix: NDArray[np.float64] | None = None,
        dtype: np.dtype | type | None = None,
    ) -> HKLVolume:
        nh, nk, nl = data.shape
        h_axis = np.linspace(h_range[0], h_range[1], nh).astype(np.float64)
        k_axis = np.linspace(k_range[0], k_range[1], nk).astype(np.float64)
        l_axis = np.linspace(l_range[0], l_range[1], nl).astype(np.float64)
        if dtype is not None:
            # Storage precision only — axes/UB stay float64 unconditionally.
            data = data.astype(dtype, copy=False)
            if sigma is not None:
                sigma = sigma.astype(dtype, copy=False)
        if sigma is None:
            sigma = np.sqrt(np.abs(data))
        mask = np.ones(data.shape, dtype=bool)
        ub = ub_matrix if ub_matrix is not None else np.eye(3, dtype=np.float64)
        return cls(
            data=data,
            sigma=sigma,
            mask=mask,
            h_axis=h_axis,
            k_axis=k_axis,
            l_axis=l_axis,
            ub_matrix=ub,
        )

    # ------------------------------------------------------------------
    # Coordinate helpers
    # ------------------------------------------------------------------

    def hkl_grid(self) -> tuple[NDArray, NDArray, NDArray]:
        """Return (H, K, L) meshgrid arrays of shape (nh, nk, nl)."""
        H, K, L = np.meshgrid(self.h_axis, self.k_axis, self.l_axis, indexing="ij")
        return H, K, L

    def q_magnitude(
        self, *, out_dtype: np.dtype | type | None = None,
    ) -> NDArray[np.floating]:
        """Return |Q| in Å^-1 for every voxel, shape (nh, nk, nl).

        Memory-lean: see :func:`q_magnitude_from_axes` (2 volume-sized arrays
        peak instead of the ~10 a meshgrid + (..., 3) stack would allocate).
        Arithmetic is always float64; ``out_dtype`` downcasts only the stored
        result (default: float64, unchanged).
        """
        return q_magnitude_from_axes(
            self.h_axis, self.k_axis, self.l_axis, self.ub_matrix,
            out_dtype=out_dtype)

    @property
    def shape(self) -> tuple[int, int, int]:
        return self.data.shape  # type: ignore[return-value]

    def apply_mask(self, new_mask: NDArray[np.bool_]) -> None:
        """Update mask in place; existing False voxels remain masked."""
        self.mask &= new_mask

    def masked_data(self) -> NDArray[np.floating]:
        """Return data with masked voxels set to NaN."""
        out = self.data.copy()
        out[~self.mask] = np.nan
        return out
