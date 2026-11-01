# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""A synthetic crystal reduced with a UB that is slightly turned (THY-60).

The upstream reduction indexed the data with a UB off by a small rotation ω:
each Bragg peak then sits at R(ω)·q instead of q, displaced by ω × q across Q,
by |ω|·|Q| (0.087 Å⁻¹ at 10 Å⁻¹ for 0.5°), and runs reduced with slightly
different errors smear it along the same direction.  Here each peak is a
Gaussian at R(ω)·q holding ``1 − smear_weight`` of its intensity, plus a smear
along ω × q, uniform from R((1 − smear)·ω)·q to R((1 + smear)·ω)·q (runs
whose errors spread about ω), holding the rest.  The smear is symmetric about
the displaced centre, so the peak's centroid is R(ω)·q and a fit of the
centres has a known answer.

On a smooth diffuse background with counting-like noise (``sigma`` is the true
per-voxel error).  Optionally:

- ``random_offset``: each peak displaced by a random vector of this RMS size
  (Å⁻¹) instead, with no common rotation (and no smear);
- ``features``: a broad diffuse maximum and a diffuse rod beside chosen nodes,
  along the direction their tails take, which the punch must leave alone;
- ``halo``: thermal-diffuse-like scattering peaked at every node, isotropic,
  growing as |Q|², which is the crystal's own and not a tail.

The components are returned with the volume, so tests can score the punch
against them.  Only synthetic data: never a measured volume.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray
from scipy.spatial.transform import Rotation

from nebula3d.core import HKLVolume


@dataclass
class Crystal:
    """A synthetic misoriented crystal: the volume and its components."""

    vol: HKLVolume
    bragg: NDArray[np.float64]  # the Bragg peaks, noise-free
    diffuse: NDArray[np.float64]  # everything else, noise-free
    features: NDArray[np.float64]  # the protected diffuse features (also in diffuse)
    omega: NDArray[np.float64]  # the rotation vector (radians, Cartesian Q frame)
    nodes: NDArray[np.int64]  # the nodes that hold a peak
    feature_nodes: list[tuple[int, int, int]] = field(default_factory=list)


def orthorhombic_ub(a: float = 4.5, b: float = 4.8, c: float = 5.2) -> NDArray[np.float64]:
    """UB (2π included) of an orthorhombic cell, a* along x."""
    return np.diag([2 * np.pi / a, 2 * np.pi / b, 2 * np.pi / c])


def misoriented_crystal(
    omega_deg: float = 0.5,
    axis: tuple[float, float, float] = (0.2, -0.3, 1.0),
    *,
    ub: NDArray[np.float64] | None = None,
    h: tuple[float, float] = (2.55, 9.45),
    k: tuple[float, float] = (-2.45, 2.45),
    l: tuple[float, float] = (-1.45, 1.45),  # noqa: E741
    step: float = 0.035,
    height: float = 300.0,
    sigma_q: float = 0.035,
    smear: float = 2.0,
    smear_weight: float = 0.3,
    level: float = 1.0,
    counts: float = 400.0,
    random_offset: float | None = None,
    features: bool = False,
    halo: float = 0.0,
    seed: int = 0,
) -> Crystal:
    """The crystal on a grid over *h*, *k*, *l* (r.l.u., step *step*).

    *height* is a peak's height at |Q| = 0 before its structure factor (a
    random 0.3–1 per node) and a Debye–Waller falloff; *sigma_q* its
    Gaussian width (Å⁻¹).  The background is *level* with a gentle
    modulation; the noise is Gaussian with σ² = I / *counts* + 0.01².
    """
    ub = orthorhombic_ub() if ub is None else np.asarray(ub, dtype=np.float64)
    rng = np.random.default_rng(seed)
    axes = [np.arange(lo, hi + 0.5 * step, step) for lo, hi in (h, k, l)]
    shape = tuple(a.size for a in axes)
    hh, kk, ll = np.meshgrid(*axes, indexing="ij")
    q = np.stack([hh, kk, ll], axis=-1) @ ub.T
    qabs = np.linalg.norm(q, axis=-1)
    diffuse = level * (1.0 + 0.15 * np.cos(np.pi * hh) * np.cos(np.pi * kk)
                       + 0.1 * np.cos(2 * np.pi * ll / 3.0))
    axis_v = np.asarray(axis, dtype=np.float64)
    omega = np.radians(omega_deg) * axis_v / np.linalg.norm(axis_v)
    inv = np.linalg.inv(ub)
    lo = np.array([a[0] for a in axes])
    hi = np.array([a[-1] for a in axes])
    ranges = [np.arange(int(np.ceil(a[0])), int(np.floor(a[-1])) + 1) for a in axes]
    nodes = np.array(np.meshgrid(*ranges, indexing="ij")).reshape(3, -1).T
    keep = np.all((nodes >= lo + 0.3) & (nodes <= hi - 0.3), axis=1)
    nodes = nodes[keep]
    bragg = np.zeros(shape)
    feat = np.zeros(shape)
    b_iso = 0.25  # Å²: exp(-B Q²/(8π²)) Debye–Waller
    strength = rng.uniform(0.3, 1.0, len(nodes))
    reach = 5.0 * sigma_q + 3.0 * np.linalg.norm(omega) * float(qabs.max())
    half = reach * np.linalg.norm(inv, axis=1)  # HKL half-width of the box

    def add(centre_q: NDArray[np.float64], amp: float) -> None:
        c = inv @ centre_q
        box = tuple(slice(max(0, int(np.floor((ci - hw - a[0]) / step))),
                          min(a.size, int(np.ceil((ci + hw - a[0]) / step)) + 1))
                    for ci, hw, a in zip(c, half, axes))
        d = q[box] - centre_q
        bragg[box] += amp * np.exp(-0.5 * np.sum(d * d, axis=-1) / sigma_q ** 2)

    for g, s in zip(nodes, strength):
        q0 = ub @ g
        amp = height * float(s) * float(np.exp(-b_iso * (q0 @ q0) / (8 * np.pi ** 2)))
        if random_offset is not None:
            add(q0 + rng.normal(0.0, random_offset / np.sqrt(3.0), 3), amp)
            continue
        main = Rotation.from_rotvec(omega).apply(q0)
        add(main, amp * (1.0 - smear_weight))
        if smear_weight > 0 and smear > 0:
            ts = np.linspace(1.0 - smear, 1.0 + smear, 21)
            for t in ts:
                add(Rotation.from_rotvec(t * omega).apply(q0), amp * smear_weight / ts.size)

    feature_nodes: list[tuple[int, int, int]] = []
    if features:
        # Beside two high-|Q| nodes, along the way their tails run (ω × q̂):
        # a broad maximum 0.30 Å⁻¹ out on one side of the first, and a rod
        # along c* crossing that direction 0.25 Å⁻¹ out from the second.
        order = np.argsort(-np.linalg.norm(nodes @ ub.T, axis=1))
        picks = [nodes[order[2]], nodes[order[7]]]
        for kind, g in zip(("maximum", "rod"), picks):
            q0 = ub @ g
            u = np.cross(omega, q0)
            u = u / np.linalg.norm(u) if np.linalg.norm(u) > 0 else np.array([0.0, 1.0, 0.0])
            if kind == "maximum":
                c = q0 + 0.30 * u
                feat += 1.5 * level * np.exp(-0.5 * np.sum((q - c) ** 2, axis=-1) / 0.08 ** 2)
            else:
                c = q0 + 0.25 * u
                cstar = ub[:, 2] / np.linalg.norm(ub[:, 2])
                d = q - c
                perp = d - (d @ cstar)[..., None] * cstar
                feat += 1.5 * level * np.exp(-0.5 * np.sum(perp ** 2, axis=-1) / 0.04 ** 2)
            feature_nodes.append((int(g[0]), int(g[1]), int(g[2])))
    if halo > 0:
        # Lorentzian in |δq| (0.05 Å⁻¹ wide), cut at 0.5 Å⁻¹ from the node.
        hw = 0.5 * np.linalg.norm(inv, axis=1)
        for g in nodes:
            q0 = ub @ g
            box = tuple(slice(max(0, int(np.floor((gi - w - a[0]) / step))),
                              min(a.size, int(np.ceil((gi + w - a[0]) / step)) + 1))
                        for gi, w, a in zip(g, hw, axes))
            r2 = np.sum((q[box] - q0) ** 2, axis=-1)
            diffuse[box] += halo * float(q0 @ q0) / 100.0 / (1.0 + r2 / 0.05 ** 2)

    diffuse = diffuse + feat
    truth = diffuse + bragg
    sigma = np.sqrt(np.clip(truth, 0.0, None) / counts + 0.01 ** 2)
    data = truth + rng.normal(0.0, 1.0, shape) * sigma
    vol = HKLVolume.from_arrays(data, h, k, l, sigma=sigma, ub_matrix=ub)
    # from_arrays spaces the axes over the ranges: put them on the grid built.
    vol.h_axis, vol.k_axis, vol.l_axis = (a.astype(np.float64) for a in axes)
    return Crystal(vol=vol, bragg=bragg, diffuse=diffuse, features=feat, omega=omega,
                   nodes=nodes, feature_nodes=feature_nodes)
