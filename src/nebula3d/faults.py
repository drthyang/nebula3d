# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Faults to inject into a volume, so that the checks are tested on a known answer.

Each function takes an :class:`HKLVolume` and returns a new one with one fault
of a kind a real reduction suffers:

- :func:`misorient`: the UB slightly turned. Every Bragg peak sits beside its
  node by the angle times |Q|, and ``ub_check`` should find the angle.
- :func:`shift_origin`: the HKL origin offset. Every peak moves by the same
  vector, so its offset relative to |Q| falls with |Q|: ``ub_check``'s radial
  offsets should say that no UB explains it.
- :func:`cut_coverage`: counts that end at a |Q| inside the box. The raw
  counts' upper edge (``qmax_coverage``) should find it.
- :func:`add_rings`: powder rings left in the data. The ring assessment
  should find them.

The held-out eval datasets are built from the synthetic demo volume
(:mod:`nebula3d.demo`) with these (``examples/make_eval_volumes.py``); nothing
here reads measured data.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from .analysis.ub_refine import regrid
from .core import HKLVolume


def rotation(axis: Sequence[float], angle_deg: float) -> NDArray[np.float64]:
    """The rotation by *angle_deg* about the Cartesian *axis* (Rodrigues)."""
    u = np.asarray(axis, dtype=np.float64)
    u = u / np.linalg.norm(u)
    t = np.radians(angle_deg)
    k = np.array([[0.0, -u[2], u[1]], [u[2], 0.0, -u[0]], [-u[1], u[0], 0.0]])
    return np.eye(3) + np.sin(t) * k + (1.0 - np.cos(t)) * (k @ k)


def _unmeasured(vol: HKLVolume, measured: NDArray[np.bool_]) -> HKLVolume:
    """*vol* with every voxel outside *measured* unmeasured, as the loader leaves it:
    masked, with data and σ zero."""
    mask = vol.mask & measured
    data = np.where(mask, vol.data, 0).astype(vol.data.dtype, copy=False)
    sigma = np.where(mask, vol.sigma, 0).astype(vol.sigma.dtype, copy=False)
    return replace(vol, data=data, sigma=sigma, mask=mask)


def misorient(vol: HKLVolume, angle_deg: float,
              axis: Sequence[float] = (0.0, 0.0, 1.0)) -> HKLVolume:
    """*vol* as if reduced with its UB turned by *angle_deg* about the Cartesian
    *axis*: the data are rotated in Q while the volume keeps its UB, so every
    Bragg peak sits beside its node by the angle times |Q|."""
    turned = regrid(vol, rotation(axis, angle_deg) @ vol.ub_matrix)
    return replace(turned, ub_matrix=np.array(vol.ub_matrix, dtype=np.float64))


def shift_origin(vol: HKLVolume, offset: Sequence[float]) -> HKLVolume:
    """*vol* with every feature moved by *offset* (H, K, L in r.l.u.), as an HKL
    origin set off by that much puts it: interpolated linearly, and what comes
    in from outside the box unmeasured."""
    steps = np.array([a[1] - a[0] for a in (vol.h_axis, vol.k_axis, vol.l_axis)])
    voxels = np.asarray(offset, dtype=np.float64) / steps

    def move(a: NDArray[np.floating]) -> NDArray[np.floating]:
        return ndimage.shift(a.astype(np.float64), voxels, order=1, mode="constant", cval=0.0)

    measured = move(vol.mask.astype(np.float64)) > 0.999
    moved = replace(vol, data=move(vol.data).astype(vol.data.dtype),
                    sigma=move(vol.sigma).astype(vol.sigma.dtype), mask=np.ones_like(vol.mask))
    return _unmeasured(moved, measured)


def cut_coverage(vol: HKLVolume, q_max: float) -> HKLVolume:
    """*vol* with no counts past *q_max* (Å⁻¹): the coverage ends inside the box."""
    return _unmeasured(vol, vol.q_magnitude() <= q_max)


def add_rings(vol: HKLVolume, q_rings: Sequence[float], amplitude: float,
              width: float = 0.03) -> HKLVolume:
    """*vol* with an isotropic powder ring at each |Q| in *q_rings* (Å⁻¹): a
    Gaussian shell of *amplitude* (data units) and σ *width* (Å⁻¹), on the
    measured voxels only."""
    q = vol.q_magnitude()
    rings = sum(np.exp(-0.5 * ((q - q0) / width) ** 2) for q0 in q_rings)
    data = np.where(vol.mask, vol.data + amplitude * rings, vol.data).astype(vol.data.dtype)
    return replace(vol, data=data)
