# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Whether a shell in |Q| is a powder ring: does it rise in every direction?

A powder ring is a sphere in reciprocal space. At its |Q| it stands above the
diffuse beside it in every direction, by an amount texture can vary but not
remove. The crystal's own scattering at the same |Q|, its short-range-order
maxima, the thermal diffuse round its Bragg nodes or the nodes themselves,
rises in some directions and not in others. Comparing planes cannot tell them
apart where symmetry makes the planes equivalent (on a cubic crystal hk0, h0l
and 0kl; on a hexagonal or tetragonal one h0l and 0kl), because the crystal's
own scattering then shows on all of them. Directions over the whole sphere can.

The sphere is cut into ``n_cos`` × ``n_phi`` cells of equal solid angle (bands
in cos θ by sectors in φ, in Cartesian Q). In each cell, the radial profile is
the median of each |Q| bin, robust to a Bragg peak in the cell. The shell's
height there is that profile's mean excess over the shell's core (± 0.75 ×
its FWHM), above a line through the flanks on either side. The mean over the
core, not its peak, so a ring whose |Q| wanders with direction (within the
FWHM of the all-direction profile, which that wandering widens) still counts.
A flank skips the bins of another shell's core, reaching further out for clean
ones; a shell with no clean flank on one side is not judged. The shell is a
powder ring when its median height over the cells is
positive, and at least ``height_share`` of it in at least
``direction_share`` of the cells. Its isotropy is the height in the cell at
the (1 − ``direction_share``) quantile over the median height.

On the synthetic volumes (docs/algorithms/powder_rings.md), with the
default 128 cells, rings read an isotropy of 0.33 to 0.96: aluminium's
textured lines 0.35 (the weakest) to 0.90, a ring three times stronger one way
than another whose |Q| wanders with direction 0.33. Every shell of the
crystals' own diffuse reads −0.14 or less, one on a volume whose HKL origin
is shifted included. The default, 0.15 of the median height in 90 % of the
directions, sits in that gap (to confirm with the user). Coarser cells, or a
wider core, average the diffuse's maxima into the shell (on 32 cells it read
up to 0.9, with a 0.29 Å⁻¹ core 0.21), so both stay small.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume, low_memory


@dataclass(frozen=True)
class IsotropyConfig:
    """How :func:`shell_isotropy` cuts the sphere and what a ring must reach.

    ``direction_share`` and ``height_share`` are the rule: a ring rises by at
    least ``height_share`` of its median height in at least ``direction_share``
    of the direction cells (to confirm with the user). ``core_scale`` × FWHM is
    the core's half-width, and each flank is ``flank_scale`` × FWHM of clean
    bins beyond it, after a gap of ``gap_scale`` × FWHM, found within
    ``flank_reach`` flank widths. The FWHM is taken no wider than ``fwhm_cap``
    (Å⁻¹): a broader core sums a crystal's maxima at neighbouring |Q| in
    different directions into what reads as a ring, while a ring's own
    verdict hardly changes.
    A cell counts where every bin of its profile has ``min_voxels``, and a
    shell is judged on ``min_cells`` cells or more. Past ``max_voxels`` in the
    shells' windows (an eighth of the volume's voxels in low-memory mode, the
    browser), a fixed random subset of that many is read: a median per cell
    and bin needs no more.
    """

    n_cos: int = 8
    n_phi: int = 16
    direction_share: float = 0.9
    height_share: float = 0.15
    core_scale: float = 0.75
    gap_scale: float = 0.25
    flank_scale: float = 0.5
    flank_reach: float = 3.0
    fwhm_cap: float = 0.16
    q_step: float = 0.02
    min_voxels: int = 5
    min_cells: int = 16
    max_voxels: int = 6_000_000

    def __post_init__(self) -> None:
        if self.n_cos < 2 or self.n_phi < 4:
            raise ValueError("n_cos must be at least 2 and n_phi at least 4")
        if not 0.0 < self.direction_share < 1.0 or not 0.0 < self.height_share <= 1.0:
            raise ValueError("direction_share must be in (0, 1) and height_share in (0, 1]")
        if min(self.core_scale, self.flank_scale, self.q_step) <= 0 or self.gap_scale < 0:
            raise ValueError("core_scale, flank_scale and q_step must be positive, gap_scale ≥ 0")


@dataclass(frozen=True)
class ShellIsotropy:
    """One shell's heights over the sphere, and the verdict."""

    q_center: float
    fwhm: float
    n_cells: int              # direction cells with data
    median_height: float      # data units; NaN when not judged
    relative_height: float    # the median height over the flanks' median level
    isotropy: float           # the low-quantile height over the median height
    is_ring: bool
    not_judged: str = ""      # why no verdict could be reached, if none was

    def as_dict(self) -> dict[str, object]:
        def r(x: float, n: int = 4) -> float | None:
            return None if not np.isfinite(x) else float(round(x, n))
        return {"q_center": r(self.q_center), "fwhm": r(self.fwhm), "n_cells": self.n_cells,
                "median_height": r(self.median_height, 6),
                "relative_height": r(self.relative_height),
                "isotropy": r(self.isotropy, 3), "is_ring": self.is_ring,
                "not_judged": self.not_judged or None}


def voxel_q_step(vol: HKLVolume) -> float:
    """The grid's finest step in Q (Å⁻¹): each axis's step through the UB."""
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    steps = [abs(float(a[1] - a[0])) if np.size(a) > 1 else np.inf for a in axes]
    return float(min(np.linalg.norm(ub[:, i]) * steps[i] for i in range(3)))


def shell_isotropy(
    vol: HKLVolume,
    shells: Sequence[tuple[float, float]],
    config: IsotropyConfig | None = None,
    *,
    others: Sequence[tuple[float, float]] = (),
    keep_apart: bool = True,
    slab: int | None = None,
) -> list[ShellIsotropy]:
    """Judge each ``(q_center, fwhm)`` shell of ``vol`` (Å⁻¹): a powder ring or not.

    The cores of ``others`` (more ``(q_center, fwhm)`` candidates) are kept out
    of each shell's flanks, and those of the other shells too unless
    ``keep_apart`` is False. One pass over the volume in slabs of ``slab`` H
    planes, reading only the voxels inside a shell's window; masked and
    non-finite voxels are left out. :func:`judge_shells` is the usual entry.
    """
    cfg = config or IsotropyConfig()
    if not shells:
        return []
    lean = low_memory()
    n_h = int(np.size(vol.h_axis))
    # Each slab's float64 |Q| arrays stay a small share of the volume.
    slab = slab or (1 if lean else max(1, min(16, n_h // 32)))
    max_voxels = min(cfg.max_voxels, vol.data.size // 8) if lean else cfg.max_voxels
    q_step = max(cfg.q_step, 0.5 * voxel_q_step(vol))
    n_cells = cfg.n_cos * cfg.n_phi

    def reach(fwhm: float) -> tuple[float, float, float, float]:
        fwhm = max(min(float(fwhm), cfg.fwhm_cap), 2.0 * q_step)
        return (fwhm, max(cfg.core_scale * fwhm, q_step), cfg.gap_scale * fwhm,
                max(cfg.flank_scale * fwhm, 2.0 * q_step))

    def extent(fwhm: float) -> float:
        """How far a candidate reaches either side, by its own width (not capped)."""
        fwhm = max(float(fwhm), 2.0 * q_step)
        return max(cfg.core_scale * fwhm, q_step) + cfg.gap_scale * fwhm

    # Every candidate's core and gap, kept out of the other shells' flanks.
    apart = [*shells, *others] if keep_apart else list(others)
    keep_out = [(float(q), extent(f)) for q, f in apart]
    # Each shell's bins: the core in the middle, a flank on either side, the
    # first clean bins outward from the gap (another shell's core is skipped).
    layouts = []
    for q0, fwhm_in in shells:
        q0 = float(q0)
        fwhm, core, gap, flank = reach(fwhm_in)
        lo = q0 - core - gap - cfg.flank_reach * flank
        n_bins = int(np.ceil((2.0 * (core + gap + cfg.flank_reach * flank)) / q_step))
        centres = lo + (np.arange(n_bins) + 0.5) * q_step
        d = np.abs(centres - q0)
        clean = d > core + gap
        for q1, half in keep_out:
            if abs(q1 - q0) > 1e-9:
                clean &= np.abs(centres - q1) > half
        role = np.where(d <= core, 1, -1)  # 1 core, 0 flank, −1 unused
        n_flank = max(2, int(round(flank / q_step)))
        for side in (centres < q0, centres > q0):
            picks = np.nonzero(side & clean)[0]
            picks = picks[np.argsort(d[picks])][:n_flank]
            role[picks] = 0
        layouts.append((q0, fwhm, lo, n_bins, centres, role))
    offsets = np.cumsum([0] + [lay[3] for lay in layouts])
    total_bins = int(offsets[-1])
    q_lo = min(lay[2] for lay in layouts)
    q_hi = max(lay[2] + lay[3] * q_step for lay in layouts)
    # The voxels the windows hold, by geometry (an upper bound past the box):
    # past the budget, each is read with probability keep_share.
    axes_steps = [abs(float(a[1] - a[0])) if np.size(a) > 1 else 1.0
                  for a in (vol.h_axis, vol.k_axis, vol.l_axis)]
    ub_det = abs(float(np.linalg.det(np.asarray(vol.ub_matrix, dtype=np.float64))))
    voxel_volume = ub_det * float(np.prod(axes_steps))
    shell_volume = sum(4.0 / 3.0 * np.pi * (max(lay[2] + lay[3] * q_step, 0.0) ** 3
                                           - max(lay[2], 0.0) ** 3) for lay in layouts)
    expected = shell_volume / max(voxel_volume, 1e-30)
    keep_share = min(1.0, max_voxels / max(expected, 1.0))

    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    h = np.asarray(vol.h_axis, dtype=np.float64)
    k = np.asarray(vol.k_axis, dtype=np.float64)[None, :, None]
    l_ = np.asarray(vol.l_axis, dtype=np.float64)[None, None, :]
    keys: list[NDArray[np.int32]] = []
    vals: list[NDArray[np.float32]] = []
    for i0 in range(0, h.size, slab):
        hh = h[i0:i0 + slab][:, None, None]
        qx = ub[0, 0] * hh + ub[0, 1] * k + ub[0, 2] * l_
        qy = ub[1, 0] * hh + ub[1, 1] * k + ub[1, 2] * l_
        qz = ub[2, 0] * hh + ub[2, 1] * k + ub[2, 2] * l_
        q = np.sqrt(qx * qx + qy * qy + qz * qz)
        data = vol.data[i0:i0 + slab]
        ok = vol.mask[i0:i0 + slab] & np.isfinite(data) & (q >= q_lo) & (q < q_hi)
        if keep_share < 1.0:
            ok &= np.random.default_rng(i0).random(ok.shape) < keep_share
        if not ok.any():
            continue
        q_ok, qz_ok = q[ok], qz[ok]
        cos = np.clip(qz_ok / q_ok, -1.0, 1.0)
        band = np.minimum(((cos + 1.0) * 0.5 * cfg.n_cos).astype(np.int64), cfg.n_cos - 1)
        phi = np.arctan2(qy[ok], qx[ok])
        sector = np.minimum(((phi + np.pi) / (2.0 * np.pi) * cfg.n_phi).astype(np.int64),
                            cfg.n_phi - 1)
        cell = (band * cfg.n_phi + sector).astype(np.int32)
        v = data[ok].astype(np.float32)
        for s, (_q0, _f, lo, n_bins, _c, _r) in enumerate(layouts):
            b = np.floor((q_ok - lo) / q_step).astype(np.int32)
            inside = (b >= 0) & (b < n_bins)
            if inside.any():
                keys.append(cell[inside] * np.int32(total_bins) + np.int32(offsets[s]) + b[inside])
                vals.append(v[inside])
    if not keys:
        return [ShellIsotropy(lay[0], lay[1], 0, np.nan, np.nan, np.nan, False,
                              "no measured voxels") for lay in layouts]
    key = np.concatenate(keys)
    val = np.concatenate(vals)
    del keys, vals
    count = np.bincount(key, minlength=n_cells * total_bins)
    order = np.lexsort((val, key))
    sorted_vals = val[order]
    starts = np.zeros_like(count)
    np.cumsum(count[:-1], out=starts[1:])
    median = np.full(count.size, np.nan)
    nz = np.nonzero(count >= cfg.min_voxels)[0]
    median[nz] = 0.5 * (sorted_vals[starts[nz] + (count[nz] - 1) // 2]
                        + sorted_vals[starts[nz] + count[nz] // 2])
    median = median.reshape(n_cells, total_bins)

    out: list[ShellIsotropy] = []
    for s, (q0, fwhm, _lo, n_bins, centres, role) in enumerate(layouts):
        prof = median[:, offsets[s]:offsets[s] + n_bins]
        flank = role == 0
        x_flank = centres[flank] - q0
        x_core = centres[role == 1] - q0
        good = np.isfinite(prof[:, role >= 0]).all(axis=1)
        # A line through both flanks: a slope read from one side only would
        # pass for a height in every direction.
        if not ((x_flank < 0).any() and (x_flank > 0).any()):
            out.append(ShellIsotropy(q0, fwhm, 0, np.nan, np.nan, np.nan, False,
                                     "no clean flank on one side"))
            continue
        heights, levels = [], []
        for c in np.nonzero(good)[0]:
            slope, icept = np.polyfit(x_flank, prof[c, flank], 1)
            heights.append(float(np.mean(prof[c, role == 1] - (icept + slope * x_core))))
            levels.append(float(icept))
        out.append(_verdict(q0, fwhm, np.asarray(heights), np.asarray(levels), cfg))
    return out


def judge_shells(
    vol: HKLVolume,
    shells: Sequence[tuple[float, float]],
    config: IsotropyConfig | None = None,
    *,
    rings: Sequence[tuple[float, float]] = (),
    others: Sequence[tuple[float, float]] = (),
) -> list[ShellIsotropy]:
    """:func:`shell_isotropy` of every candidate, its flanks clear of the other
    candidates, of ``rings`` (shells already confirmed) and of ``others`` (more
    shells found, judged or not).

    A shell those leave without a clean flank is judged again with its flanks
    clear of the confirmed rings only, so a broad diffuse candidate beside a
    ring cannot keep the ring from being judged.
    """
    first = shell_isotropy(vol, shells, config, others=[*rings, *others])
    retry = [i for i, r in enumerate(first) if r.not_judged == "no clean flank on one side"]
    if not retry:
        return first
    confirmed = [*rings, *[(r.q_center, r.fwhm) for r in first if r.is_ring]]
    again = shell_isotropy(vol, [shells[i] for i in retry], config, others=confirmed,
                           keep_apart=False)
    for i, r in zip(retry, again):
        first[i] = r
    return first


def _verdict(q0: float, fwhm: float, heights: NDArray[np.float64], levels: NDArray[np.float64],
             cfg: IsotropyConfig) -> ShellIsotropy:
    n = int(heights.size)
    if n < cfg.min_cells:
        return ShellIsotropy(q0, fwhm, n, np.nan, np.nan, np.nan, False,
                             f"measured in {n} direction cells, under {cfg.min_cells}")
    med = float(np.median(heights))
    low = float(np.quantile(heights, 1.0 - cfg.direction_share))
    level = float(np.median(levels))
    rel = med / level if level > 0 else np.nan
    iso = low / med if med > 0 else np.nan
    return ShellIsotropy(q0, fwhm, n, med, rel, iso,
                         bool(med > 0 and low >= cfg.height_share * med))


__all__ = ["IsotropyConfig", "ShellIsotropy", "judge_shells", "shell_isotropy", "voxel_q_step"]
