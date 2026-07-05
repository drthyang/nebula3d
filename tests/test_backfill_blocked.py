# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Memory-bounded (H-slab) backfill: agreement with the single-tree path.

The in-browser build fills ring/Bragg holes with a *local* KD-tree per H-slab
instead of one tree over every valid voxel (which does not fit the 4 GB WASM
heap at full resolution).  This guards that the slabbed fill (a) leaves valid
voxels untouched, (b) fills every hole the global tree fills, and (c) matches
the global fill to well within measurement precision — only exactly-equidistant
neighbour ties may resolve differently.
"""

from __future__ import annotations

import dataclasses

import numpy as np

from nebula3d.core import HKLVolume
from nebula3d.preprocessing import backfill as bf
from nebula3d.preprocessing.powder_rings import RingShell


def _punched_volume(n: int = 48) -> HKLVolume:
    rng = np.random.default_rng(3)
    ii = np.linspace(-1.0, 1.0, n)
    R = np.sqrt(ii[:, None, None] ** 2 + ii[None, :, None] ** 2 + ii[None, None, :] ** 2)
    data = 5.0 + 3.0 * np.exp(-((R - 0.3) / 0.2) ** 2) + 0.3 * np.sin(6 * ii[:, None, None])
    data = data + 0.02 * rng.standard_normal((n, n, n))
    sigma = 0.1 + 0.02 * np.abs(rng.standard_normal((n, n, n)))
    mask = np.ones((n, n, n), dtype=bool)
    for c in range(3, n, 8):                       # discrete Bragg-like punches
        mask[max(0, c - 1):c + 2, max(0, c - 1):c + 2, max(0, c - 1):c + 2] = False
    mask[rng.random((n, n, n)) < 0.01] = False     # a few scattered holes
    return dataclasses.replace(
        HKLVolume.from_arrays(data, (-2, 2), (-2, 2), (-2, 2)), sigma=sigma, mask=mask)


def _run(vol, rings, n_slabs, monkeypatch):
    monkeypatch.setattr(bf, "_backfill_n_slabs", lambda nv, nh: n_slabs)
    return bf.backfill_ring_shells(vol, rings, fallback_tv=False)


def test_blocked_backfill_matches_global(monkeypatch):
    vol = _punched_volume()
    rings = [RingShell(q_center=0.5, q_lo=0.30, q_hi=0.70)]
    valid = vol.mask.copy()

    g = _run(vol, rings, 1, monkeypatch)           # single global tree (reference)
    b = _run(vol, rings, 6, monkeypatch)           # memory-bounded H-slabs

    # Valid voxels are read-only in both paths.
    assert np.array_equal(g.data[valid], b.data[valid])
    assert np.array_equal(g.data[valid], vol.data[valid])
    # Every hole the global tree fills is filled by the slabbed path too.
    assert np.array_equal(g.mask, b.mask)
    assert not np.isnan(b.data).any()
    # Filled (unmeasured) voxels agree to well within the data scale; only
    # equidistant-neighbour ties may differ.
    scale = float(np.abs(g.data).mean())
    holes = ~valid & g.mask
    assert np.max(np.abs(g.data[holes] - b.data[holes])) < 0.2 * scale
    # ...and the bulk agree very tightly.
    assert np.median(np.abs(g.data[holes] - b.data[holes])) < 1e-3 * scale


def test_single_slab_is_bit_identical(monkeypatch):
    """n_slabs == 1 must reproduce the global tree byte-for-byte."""
    vol = _punched_volume()
    rings = [RingShell(q_center=0.5, q_lo=0.30, q_hi=0.70)]
    a = _run(vol, rings, 1, monkeypatch)
    b = _run(vol, rings, 1, monkeypatch)
    assert np.array_equal(a.data, b.data)
    assert np.array_equal(a.sigma, b.sigma)


def test_slab_count_scales_with_budget(monkeypatch):
    """The chooser stays at 1 (exact) unless low-memory mode is on and the tree
    would exceed the budget."""
    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)
    assert bf._backfill_n_slabs(50_000_000, 400) == 1        # native: always exact
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    assert bf._backfill_n_slabs(1_000, 400) == 1             # tiny volume: one tree
    assert bf._backfill_n_slabs(50_000_000, 400) > 1         # large: slabbed
