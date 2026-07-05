# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Fill masked ring-shell voxels by radial interpolation.

Why radial interpolation is the right approach
-----------------------------------------------
After ring detection and masking, each masked voxel sits inside a thin
|Q| shell.  The nearest uncontaminated voxels in 3D HKL space are almost
always at the same angular position (same h/k/l direction) but at
slightly different |Q| — just inside or just outside the ring shell.

Interpolating across the shell in the |Q| direction:
  * Makes **no assumption** about the diffuse signal shape — the fill is
    purely based on the observed values at neighbouring |Q|.
  * Naturally gives C¹ continuity at the shell boundaries: the
    interpolant matches both the value and the slope of the uncontaminated
    data at the inner and outer shell edges.
  * Is physically motivated: the diffuse signal varies smoothly in |Q|,
    and the ring shell is thin relative to that scale.

Algorithm (per masked voxel)
-----------------------------
For a masked voxel at angular position Ω and |Q| = q₀:

    1. Collect the k nearest valid voxels in 3D HKL space.
    2. Among those, use only voxels outside the ring shell (|Q| < q_lo
       or |Q| > q_hi), i.e. "uncontaminated neighbours".
    3. Fit a weighted linear interpolation (or median for robustness)
       in |Q| to estimate I at q₀.
    4. The weights are inversely proportional to the 3D HKL distance.

The filled voxel's σ is set to the local scatter of the contributing
neighbours, inflated by an uncertainty_scale factor to flag it as
estimated.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import KDTree

from nebula3d.core import HKLVolume, low_memory
from nebula3d.preprocessing.powder_rings import RingShell

# NOTE: this ring-workflow fill (``backfill_ring_shells``) is *not* the default
# Bragg pipeline's backfill — that is ``nebula3d.analysis.backfill_bragg``
# (``method="q_shell"``), which is connected-component / ``ndimage``-based and
# builds no tree.  This function is kept for the ring/aluminium workflow and its
# tests.
#
# Here a KD-tree over *all* valid voxels is by far the largest allocation on real
# (mostly-valid) volumes — scipy's cKDTree node structure plus the float64
# coordinate copy runs ~90-120 B per valid voxel, so a ~50 M-voxel volume needs
# several GB for the tree alone, which does not fit the browser's 4 GB WASM heap.
# In low-memory mode, once the estimated tree footprint exceeds this budget, the
# fill is done in H-slabs: each slab builds a *local* tree over only the valid
# voxels in its H-band (+ a halo wide enough to contain every masked voxel's
# nearest neighbours), so peak memory is bounded by one band, not the whole
# volume.  The interpolation is unchanged (same |Q|-radial weighting,
# same neighbour distances); only which of several *exactly equidistant* grid
# neighbours a tie resolves to can differ between the global and per-slab trees,
# a change confined to the filled estimates at unmeasured (punched) voxels and
# below ~1e-5 relative in the resulting ΔPDF.  Above the budget the global tree
# cannot be built at all, so a slab is the difference between a full-precision
# result and none.  Smaller volumes always take the single-tree (bit-identical)
# path.
_BACKFILL_TREE_BUDGET_BYTES = 500_000_000
_BACKFILL_BYTES_PER_VALID_VOXEL = 120
# Halo (in H planes) added on each side of a slab's band.  A masked voxel's
# nearest ~n_neighbors×4 grid neighbours sit within ~3 planes (fewer in H when
# the H axis is coarser than K/L, which stretches its normalised step); 8 is
# ample headroom even where a thin ring shell pushes the clean neighbours
# outward, while staying small next to a slab so the halo does not dominate the
# band's memory.
_BACKFILL_HALO = 8


def _backfill_n_slabs(n_valid: int, nh: int) -> int:
    """H-slab count that keeps each slab's local KD-tree within the budget.

    ``1`` (the whole volume in one band) reproduces the global-tree result
    bit-for-bit; only larger counts trade tie-breaking for a bounded peak.
    """
    if not low_memory():
        return 1
    est = n_valid * _BACKFILL_BYTES_PER_VALID_VOXEL
    slabs = -(-est // _BACKFILL_TREE_BUDGET_BYTES)  # ceil division
    return int(max(1, min(slabs, nh)))


def _fill_from_tree(
    query_pts: NDArray[np.int64], norm: NDArray[np.float64], k: int,
    tree: KDTree, q_cand: NDArray[np.float64], i_cand: NDArray[np.float64],
    sig_cand: NDArray[np.float64], ring_lo: NDArray[np.float64],
    ring_hi: NDArray[np.float64], uncertainty_scale: float, chunk: int,
    data_out: NDArray[np.float64], sigma_out: NDArray[np.float64],
    mask_out: NDArray[np.bool_],
) -> NDArray[np.bool_]:
    """Query k-NN for *query_pts* against *tree* and write the weighted |Q|-radial
    fill into the output arrays.  ``tree`` and the ``*_cand`` arrays share one
    point order (a global valid set, or one H-band's valid set).  Returns the
    per-query ``ok`` mask (≥2 uncontaminated neighbours → filled)."""
    ok = np.zeros(len(query_pts), dtype=bool)
    for start in range(0, len(query_pts), chunk):
        block = query_pts[start:start + chunk]
        dists, nn = tree.query(block / norm, k=k, workers=-1)   # (c, k)
        if k == 1:                                              # SciPy drops the k axis
            dists = dists[:, None]
            nn = nn[:, None]

        q_nn = q_cand[nn]            # (c, k)
        i_nn = i_cand[nn]
        sig_nn = sig_cand[nn]

        # Neighbours inside any ring shell are contaminated; keep the rest.
        contaminated = np.zeros_like(q_nn, dtype=bool)
        for lo, hi in zip(ring_lo, ring_hi):
            contaminated |= (q_nn >= lo) & (q_nn <= hi)
        clean = ~contaminated
        enough = clean.sum(axis=1) >= 2     # (c,)

        # Weighted interpolation in |Q|: weight = 1 / (HKL distance × σ²),
        # restricted to clean neighbours.
        weights = np.where(clean, 1.0 / (dists + 1e-6) / (sig_nn**2 + 1e-30), 0.0)
        wsum = weights.sum(axis=1, keepdims=True)
        wnorm = weights / np.where(wsum > 0, wsum, 1.0)

        vals = (wnorm * i_nn).sum(axis=1)
        sigs = np.sqrt((wnorm**2 * sig_nn**2).sum(axis=1)) * uncertainty_scale

        rows = block[enough]
        data_out[rows[:, 0], rows[:, 1], rows[:, 2]] = vals[enough]
        sigma_out[rows[:, 0], rows[:, 1], rows[:, 2]] = sigs[enough]
        mask_out[rows[:, 0], rows[:, 1], rows[:, 2]] = True
        ok[start:start + len(block)] = enough
    return ok


def backfill_ring_shells(
    vol: HKLVolume,
    rings: list[RingShell],
    n_neighbors: int = 12,
    uncertainty_scale: float = 2.0,
    fallback_tv: bool = True,
    tv_lam: float = 0.08,
    tv_iter: int = 300,
) -> HKLVolume:
    """Fill masked ring-shell voxels by radial interpolation.

    Parameters
    ----------
    vol : HKLVolume
        Volume after ring masking (``vol.mask`` marks valid voxels).
    rings : list[RingShell]
        The rings that were masked.  Used to identify which neighbours
        are "uncontaminated" (outside the ring |Q| range).
    n_neighbors : int
        Number of nearest valid 3D-HKL neighbours to consider per
        masked voxel.  Among these, only uncontaminated ones are used.
    uncertainty_scale : float
        Filled voxels get σ = ``uncertainty_scale`` × local neighbour σ,
        flagging them as estimated in downstream analysis.
    fallback_tv : bool
        If True, voxels that could not be filled by radial interpolation
        (too few uncontaminated neighbours) are filled by TV inpainting.
    tv_lam : float
        TV regularisation weight for the fallback.
    tv_iter : int
        TV iteration limit for the fallback.

    Returns
    -------
    HKLVolume
        Filled volume.  Mask is all-True.  Filled voxels carry inflated σ.
    """
    import dataclasses

    # The output overwrites the input at masked voxels only (valid voxels are
    # read, then left untouched), so in low-memory mode we fill the input arrays
    # in place instead of copying them — the pipeline hands this stage a fresh,
    # disposable volume.  ``mask_out`` stays a copy (a cheap bool array, and the
    # loop reads ``vol.mask`` unchanged while writing filled voxels).
    if low_memory():
        data_out, sigma_out = vol.data, vol.sigma
    else:
        data_out = vol.data.copy()
        sigma_out = vol.sigma.copy()
    mask_out = vol.mask.copy()

    masked_idx = np.argwhere(~vol.mask)
    if len(masked_idx) == 0:
        return vol

    # |Q| is needed both per masked voxel and per neighbour; compute it ONCE
    # (q_magnitude rebuilds a full meshgrid + matmul + norm, so calling it per
    # voxel inside the loop dominates the runtime on real-size volumes).
    q_all = vol.q_magnitude()

    norm = np.array(vol.shape, dtype=float)
    n_valid = int(vol.mask.sum())
    k = min(n_neighbors * 4, n_valid)          # query extra, filter below
    ring_lo = np.array([r.q_lo for r in rings], dtype=float)
    ring_hi = np.array([r.q_hi for r in rings], dtype=float)
    # Chunking bounds the (chunk, k) neighbour arrays; scipy uses all cores.
    chunk = 200_000

    n_slabs = _backfill_n_slabs(n_valid, vol.shape[0])

    if n_slabs <= 1:
        # One KD-tree over all valid voxels — the exact, bit-identical path.
        # Keep the build's live set minimal: free the int64 index array before
        # the tree allocates its own float64 coordinate copy, and defer the 1-D
        # valid arrays until after the build.  Boolean indexing returns fresh
        # copies, independent of data_out even when it aliases vol.data (in-place
        # low-memory fill); the fill writes only masked voxels, disjoint from the
        # valid set, and ``nn`` indexes these in ``argwhere(mask)`` C-order.
        valid_idx = np.argwhere(vol.mask)
        coords = valid_idx / norm
        del valid_idx
        tree = KDTree(coords)
        q_valid = q_all[vol.mask]
        I_valid = vol.data[vol.mask]
        sig_valid = vol.sigma[vol.mask]
        del q_all
        fill_ok = _fill_from_tree(
            masked_idx, norm, k, tree, q_valid, I_valid, sig_valid,
            ring_lo, ring_hi, uncertainty_scale, chunk,
            data_out, sigma_out, mask_out)
    else:
        # Memory-bounded H-slab fill: a local tree per H-band keeps peak memory
        # to one band instead of the whole volume.  Each masked voxel is filled
        # by the slab that owns its H plane, against valid voxels in that slab's
        # band ± a halo wide enough to hold its nearest neighbours.
        hm = masked_idx[:, 0]
        edges = np.linspace(0, vol.shape[0], n_slabs + 1).astype(int)
        fill_ok = np.zeros(len(masked_idx), dtype=bool)
        for s in range(n_slabs):
            h0, h1 = int(edges[s]), int(edges[s + 1])
            sel = (hm >= h0) & (hm < h1)
            if not np.any(sel):
                continue
            b0 = max(0, h0 - _BACKFILL_HALO)
            b1 = min(vol.shape[0], h1 + _BACKFILL_HALO)
            band_mask = vol.mask[b0:b1]
            cand = np.argwhere(band_mask)          # (local i, j, l) within band
            if len(cand) == 0:
                continue
            cand[:, 0] += b0                        # → absolute H index
            tree = KDTree(cand / norm)
            kk = min(k, len(cand))
            q_c = q_all[b0:b1][band_mask]
            i_c = vol.data[b0:b1][band_mask]
            sig_c = vol.sigma[b0:b1][band_mask]
            ok = _fill_from_tree(
                masked_idx[sel], norm, kk, tree, q_c, i_c, sig_c,
                ring_lo, ring_hi, uncertainty_scale, chunk,
                data_out, sigma_out, mask_out)
            fill_ok[sel] = ok
            del tree, cand, q_c, i_c, sig_c
        del q_all

    unfilled = masked_idx[~fill_ok]   # (U, 3); too few clean neighbours

    # Fallback: TV inpainting for voxels with too few clean neighbours
    if len(unfilled) and fallback_tv:
        from nebula3d.inpainting.tv_inpainting import tv_inpaint
        data_out = tv_inpaint(data_out, mask_out, lam=tv_lam, max_iter=tv_iter)
        ih, ik, il = unfilled[:, 0], unfilled[:, 1], unfilled[:, 2]
        mask_out[ih, ik, il] = True
        for h, kk, ll in unfilled:
            sigma_out[h, kk, ll] = float(sigma_out[max(0, h-1):h+2,
                                                   max(0, kk-1):kk+2,
                                                   max(0, ll-1):ll+2].mean()) * uncertainty_scale
    elif len(unfilled):
        # leave masked for caller to handle
        mask_out[unfilled[:, 0], unfilled[:, 1], unfilled[:, 2]] = False

    return dataclasses.replace(vol, data=data_out, sigma=sigma_out,
                               mask=np.ones(vol.shape, dtype=bool))
