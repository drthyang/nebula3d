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
powder ring when its median height over the cells is positive, and at least
``height_share`` of it in at least ``direction_share`` of the cells; when in
the typical cell it stands ``min_snr`` times its flanks' scatter above them;
and when at least ``curve_share`` of the height stays above a quadratic
through the same flanks. A smooth hump under the shell, or the curve of a
falling background, reads as a height in every direction above a line, but
not above the curve; a ring stands above both. Its isotropy is the height in
the cell at the (1 − ``direction_share``) quantile over the median height.

On the synthetic volumes (docs/algorithms/powder_rings.md), with the
default 128 cells, rings read an isotropy of 0.33 to 0.96: aluminium's
textured lines 0.35 (the weakest) to 0.90, a ring three times stronger one way
than another whose |Q| wanders with direction 0.33. Every shell of the
crystals' own diffuse reads −0.14 or less, one on a volume whose HKL origin
is shifted included. The default, 0.15 of the median height in 90 % of the
directions, sits in that gap (to confirm with the user). Coarser cells, or a
wider core, average the diffuse's maxima into the shell (on 32 cells it read
up to 0.9, with a 0.29 Å⁻¹ core 0.21), so both stay small. Above the curve,
rings keep 0.35 of their height or more (the wandering ring the least), an
empty shell on a broad hump 0.15 or less: ``curve_share`` is 0.25 (to confirm
with the user).

Resolution
----------
A grid too coarse for the test cannot tell a ring from the crystal's own
scattering: the test then says why ("grid too coarse: …") and judges nothing.
Two limits, each from the rule's own constants.

- **Across a ring.**  The profile's |Q| bins are ``q_step``, never finer than
  half a voxel: finer bins share the voxels' spread in |Q| over the
  directions, and starve. The narrowest FWHM the test measures is
  :data:`SAMPLES_PER_FWHM` (two) bins: two samples across a peak, the Nyquist
  rate, below which a ring falls between the samples and is not told from
  its flanks. The widest is ``fwhm_cap``: a broader core sums the crystal's
  maxima at neighbouring |Q| in different directions into what reads as a
  ring. So the grid lets the rule judge a ring only when 2 × ``q_step`` ≤
  ``fwhm_cap``: one voxel or more across the widest ring the rule judges
  (:func:`grid_too_coarse`). A third sample, the usual count to measure a
  peak's height, is not needed: the test takes no peak's height but the
  core's mean excess, an integral over ±0.75 FWHM, which the ring's place on
  the bins moves by about a fifth at two samples (a Gaussian's: 0.51 to 0.65
  of its peak) and a sixth at three, far inside the 0.15 of the median height
  the rule asks of 90 % of the directions. Powder rings are narrower than a
  voxel on such grids anyway (aluminium's lines from the sample can, a few
  hundredths of an Å⁻¹): they are measured at the two-bin floor, whatever
  the grid.
- **Over the directions.**  A cell's profile counts only where every |Q| bin
  holds ``min_voxels`` voxels, a median's floor. The rule speaks for
  ``direction_share`` of the directions, so the grid must give at least that
  share of the cells the shell reaches ``min_voxels`` voxels in every bin of
  its profile; else the cells it measures are those the lattice happens to
  fill, along its own directions, where the crystal's scattering gathers
  too. The grid's voxels are counted, the mask aside (unmeasured space is
  coverage, not resolution), and scaled by the share low-memory mode reads;
  of a shell inside the box's inscribed sphere (:func:`inscribed_q`) only,
  as past it a face cuts cells short, while a cell's bins hold more voxels
  the further out the shell lies.

On the validation's dev crystal (a = 3.9 Å, ±4 r.l.u.), the 81-point grid
puts 0.99 voxels across 0.16 Å⁻¹, under one; at 1.75 Å⁻¹ it fills 16 of the 128
cells. The 161-point grid puts 1.99 voxels across it and fills 90 % of the
cells or more from 1.2 Å⁻¹ out.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume, low_memory
from nebula3d.utils.counting import bincount

#: The |Q| bins across a ring's FWHM the test needs: two samples across a
#: peak, the Nyquist rate (the module docstring, *Resolution*). The narrowest
#: FWHM it measures, and with ``fwhm_cap`` the grid's limit.
SAMPLES_PER_FWHM = 2

#: How every reason the grid gives for judging nothing opens, on either limit
#: (the module docstring, *Resolution*): :func:`grid_too_coarse`, and a shell
#: whose direction cells the grid cannot fill.
GRID_TOO_COARSE = "grid too coarse"


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
    ``min_snr`` is the noise floor: the median over cells of the height over
    its noise (the flanks' scatter about their line, over the core's mean).
    ``curve_share`` of the height must stay above a quadratic through the
    flanks, where each side has two bins or more.
    A cell counts where every bin of its profile has ``min_voxels``, and a
    shell is judged on ``min_cells`` cells or more, where the grid gives
    ``direction_share`` of the cells it reaches that many voxels a bin, and
    only on a grid with :data:`SAMPLES_PER_FWHM` bins across ``fwhm_cap``
    (the module docstring, *Resolution*). Past ``max_voxels`` in the
    shells' windows (an eighth of the volume's voxels in low-memory mode, the
    browser), a fixed random subset of that many is read: a median per cell
    and bin needs no more. Each shell still keeps about ``sample_per_bin``
    voxels per direction cell and |Q| bin, all of them when it has fewer, so
    the budget thins only the shells that have plenty: a small one near
    |Q| = 0 would otherwise lose most of its cells.
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
    sample_per_bin: int = 32
    min_snr: float = 3.0
    curve_share: float = 0.25
    al_min_snr: float = 2.0
    al_width_ratio: float = 2.0

    def __post_init__(self) -> None:
        if self.n_cos < 2 or self.n_phi < 4:
            raise ValueError("n_cos must be at least 2 and n_phi at least 4")
        if not 0.0 < self.direction_share < 1.0 or not 0.0 < self.height_share <= 1.0:
            raise ValueError("direction_share must be in (0, 1) and height_share in (0, 1]")
        if self.al_min_snr < 0 or self.al_width_ratio <= 0:
            raise ValueError("al_min_snr must be 0 or more and al_width_ratio positive")
        if min(self.core_scale, self.flank_scale, self.q_step) <= 0 or self.gap_scale < 0:
            raise ValueError("core_scale, flank_scale and q_step must be positive, gap_scale ≥ 0")
        if self.sample_per_bin < 0:
            raise ValueError("sample_per_bin must be 0 or more")


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
    snr: float = float("nan")  # median over cells of the height over its noise
    beyond_curve: float = float("nan")  # the share of the height left above a quadratic baseline
    rule: str = "strict"      # "strict", or "al": the Al lines' rule (judge_al_lines)
    # A cluster's lines: (|Q|, median amplitude, isotropy of the amplitude).
    members: tuple[tuple[float, float, float], ...] = ()
    # The criteria a judged shell failed: "height", "isotropy", "snr", "curve",
    # and "line" (a line of a cluster that does not rise on its own).
    fails: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        def r(x: float, n: int = 4) -> float | None:
            return None if not np.isfinite(x) else float(round(x, n))
        out: dict[str, object] = {
            "q_center": r(self.q_center), "fwhm": r(self.fwhm), "n_cells": self.n_cells,
            "median_height": r(self.median_height, 6),
            "relative_height": r(self.relative_height),
            "isotropy": r(self.isotropy, 3), "snr": r(self.snr, 1),
            "beyond_curve": r(self.beyond_curve, 2),
            "is_ring": self.is_ring, "not_judged": self.not_judged or None}
        if self.fails:
            out["fails"] = list(self.fails)
        if self.rule != "strict":
            out["rule"] = self.rule
        if self.members:
            out["lines"] = [{"q": r(q), "amplitude": r(a, 6), "isotropy": r(i, 3)}
                            for q, a, i in self.members]
        return out


def voxel_q_step(vol: HKLVolume) -> float:
    """The grid's finest step in Q (Å⁻¹): each axis's step through the UB."""
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    steps = [abs(float(a[1] - a[0])) if np.size(a) > 1 else np.inf for a in axes]
    return float(min(np.linalg.norm(ub[:, i]) * steps[i] for i in range(3)))


def profile_step(vol: HKLVolume, config: IsotropyConfig | None = None) -> float:
    """The |Q| bin of the shells' profiles (Å⁻¹): ``q_step``, never finer than
    half a voxel (:func:`voxel_q_step`)."""
    cfg = config or IsotropyConfig()
    return max(cfg.q_step, 0.5 * voxel_q_step(vol))


def inscribed_q(vol: HKLVolume) -> float:
    """The largest |Q| (Å⁻¹) whose whole sphere lies in the grid's box: the
    distance from the origin to the nearest of its faces (0 with the origin
    outside the box). Within it every direction cell of a shell holds its
    full share of the grid's voxels, so a cell the grid leaves short is the
    grid's doing, not the box's."""
    ub_inv = np.linalg.inv(np.asarray(vol.ub_matrix, dtype=np.float64))
    out = np.inf
    for i, axis in enumerate((vol.h_axis, vol.k_axis, vol.l_axis)):
        lo, hi = float(np.min(axis)), float(np.max(axis))
        if not lo <= 0.0 <= hi:
            return 0.0
        # The face h_i = c is the plane r_i · Q = c, r_i the i-th row of UB⁻¹.
        out = min(out, min(-lo, hi) / float(np.linalg.norm(ub_inv[i])))
    return float(out)


def grid_too_coarse(vol: HKLVolume, config: IsotropyConfig | None = None) -> str:
    """Why the grid of *vol* is too coarse to judge any ring, or ``""``.

    The narrowest FWHM the test measures, :data:`SAMPLES_PER_FWHM` of its |Q|
    bins (:func:`profile_step`), must not pass the widest the rule takes,
    ``fwhm_cap``: one voxel or more across it (the module docstring,
    *Resolution*). The reason gives both in voxels.
    """
    cfg = config or IsotropyConfig()
    voxel = voxel_q_step(vol)
    floor = SAMPLES_PER_FWHM * profile_step(vol, cfg)
    if not np.isfinite(voxel) or floor <= cfg.fwhm_cap:
        return ""
    return (f"{GRID_TOO_COARSE}: {cfg.fwhm_cap / voxel:.2g} voxels across a ring's width "
            f"(at most {cfg.fwhm_cap:g} Å⁻¹), under {floor / voxel:.2g}")


def grid_needs(vol: HKLVolume, config: IsotropyConfig | None = None) -> str:
    """What the grid of *vol* must give the test to judge a ring, in words, from
    the rule's own constants (the module docstring, *Resolution*).

    Where the grid is too coarse to judge any ring (:func:`grid_too_coarse`):
    the narrowest FWHM the test measures in voxels, :data:`SAMPLES_PER_FWHM`
    |Q| bins of half a voxel, across ``fwhm_cap`` ("1 voxel across 0.16 Å⁻¹",
    the number its reason says the grid is under). Else, what a shell whose
    direction cells the grid cannot fill lacks: ``direction_share`` of the
    cells with ``min_voxels`` voxels in each |Q| bin of its profile.
    """
    cfg = config or IsotropyConfig()
    if grid_too_coarse(vol, cfg):
        need = f"{SAMPLES_PER_FWHM * profile_step(vol, cfg) / voxel_q_step(vol):.2g}"
        return f"{need} voxel{'' if need == '1' else 's'} across {cfg.fwhm_cap:g} Å⁻¹"
    return (f"{100 * cfg.direction_share:g} % of the direction cells with {cfg.min_voxels} "
            f"voxels in each |Q| bin")


@dataclass(frozen=True)
class _Layout:
    """One judged window in |Q|: a shell, or a cluster of Al lines judged as one."""

    q0: float                     # the centre reported (a cluster's: its lines' mean)
    fwhm: float                   # the width its core is cut by (capped)
    lo: float                     # the first bin's lower edge (Å⁻¹)
    n_bins: int
    centres: NDArray[np.float64]
    role: NDArray[np.int_]        # 1 core, 0 flank, −1 unused
    lines: tuple[float, ...] = ()  # a cluster's lines, each with its own amplitude
    aligned: bool = False         # binned in each direction cell's Al frame


def _reach(fwhm: float, cfg: IsotropyConfig, q_step: float) -> tuple[float, float, float, float]:
    """The capped FWHM, and the core's half-width, the gap and a flank's width it gives."""
    fwhm = max(min(float(fwhm), cfg.fwhm_cap), SAMPLES_PER_FWHM * q_step)
    return (fwhm, max(cfg.core_scale * fwhm, q_step), cfg.gap_scale * fwhm,
            max(cfg.flank_scale * fwhm, 2.0 * q_step))


def _extent(fwhm: float, cfg: IsotropyConfig, q_step: float) -> float:
    """How far a candidate reaches either side, by its own width (not capped)."""
    fwhm = max(float(fwhm), SAMPLES_PER_FWHM * q_step)
    return max(cfg.core_scale * fwhm, q_step) + cfg.gap_scale * fwhm


def _layout(lines: Sequence[float], fwhm_in: float, cfg: IsotropyConfig, q_step: float,
            keep_out: Sequence[tuple[float, float]], own: Sequence[float], *,
            aligned: bool = False) -> _Layout:
    """The bins of a shell at ``lines[0]``, or of a cluster of lines judged as one:
    the core in the middle (every line's), a flank on either side, the first
    clean bins outward from the gap past the outermost lines (the core and gap
    of every ``keep_out`` but the ``own`` centres skipped)."""
    lines = tuple(float(x) for x in lines)
    fwhm, core, gap, flank = _reach(fwhm_in, cfg, q_step)
    lo_edge, hi_edge = min(lines), max(lines)
    lo = lo_edge - core - gap - cfg.flank_reach * flank
    span = 2.0 * (core + gap + cfg.flank_reach * flank)
    if hi_edge > lo_edge:
        span = span + (hi_edge - lo_edge)
    n_bins = int(np.ceil(span / q_step))
    centres = lo + (np.arange(n_bins) + 0.5) * q_step
    d = (np.abs(centres - lo_edge) if len(lines) == 1
         else np.min(np.abs(centres[None, :] - np.asarray(lines)[:, None]), axis=0))
    clean = d > core + gap
    for q1, half in keep_out:
        if all(abs(q1 - o) > 1e-9 for o in own):
            clean &= np.abs(centres - q1) > half
    role = np.where(d <= core, 1, -1)
    n_flank = max(2, int(round(flank / q_step)))
    for side, dist in ((centres < lo_edge, lo_edge - centres),
                       (centres > hi_edge, centres - hi_edge)):
        picks = np.nonzero(side & clean)[0]
        picks = picks[np.argsort(dist[picks])][:n_flank]
        role[picks] = 0
    return _Layout(float(np.mean(lines)) if len(lines) > 1 else lo_edge, fwhm, lo, n_bins,
                   centres, role, lines if len(lines) > 1 else (), aligned)


@dataclass
class _CellMedians:
    median: NDArray[np.float64]   # (cells, bins): each cell's median per |Q| bin
    grid: NDArray[np.int64]       # (cells, bins): the grid's voxels there, measured or not
    keeps: list[float]            # the share of each window's voxels read
    offsets: NDArray[np.int_]     # each window's first bin


def _cell_medians(vol: HKLVolume, windows: Sequence[tuple[float, int, bool]],
                  cfg: IsotropyConfig, *, slab: int | None = None,
                  cell_scale: NDArray[np.float64] | None = None) -> _CellMedians | None:
    """The median of every direction cell and |Q| bin of each ``(lo, n_bins,
    aligned)`` window, in one pass over the volume in slabs of ``slab`` H
    planes, reading only the voxels inside a window; masked and non-finite
    voxels are left out. An aligned window bins each voxel's |Q| in its cell's
    Al frame, |Q| / (1 + ``cell_scale[cell]``) (:func:`al_cell_scales`). None
    when no window holds a measured voxel."""
    lean = low_memory()
    n_h = int(np.size(vol.h_axis))
    # Each slab's float64 |Q| arrays stay a small share of the volume.
    slab = slab or (1 if lean else max(1, min(16, n_h // 32)))
    max_voxels = min(cfg.max_voxels, vol.data.size // 8) if lean else cfg.max_voxels
    q_step = profile_step(vol, cfg)
    n_cells = cfg.n_cos * cfg.n_phi
    offsets = np.cumsum([0] + [w[1] for w in windows])
    total_bins = int(offsets[-1])
    any_aligned = any(w[2] for w in windows)
    scale = (np.zeros(n_cells) if cell_scale is None
             else np.asarray(cell_scale, dtype=np.float64))
    s_lo, s_hi = ((min(0.0, float(scale.min())), max(0.0, float(scale.max())))
                  if any_aligned else (0.0, 0.0))
    # An aligned window's |Q| range in the lab frame: its Al-frame range times
    # (1 + scale), over every cell's scale.
    q_lo = min(min(w[0] * (1.0 + s_lo), w[0] * (1.0 + s_hi)) if w[2] else w[0] for w in windows)
    q_hi = max(max((w[0] + w[1] * q_step) * (1.0 + s_lo), (w[0] + w[1] * q_step) * (1.0 + s_hi))
               if w[2] else w[0] + w[1] * q_step for w in windows)
    # The voxels each window holds, by geometry (an upper bound past the box):
    # past the budget, each is read with probability keep_share, raised for a
    # window that would keep fewer than sample_per_bin per cell and bin.
    axes_steps = [abs(float(a[1] - a[0])) if np.size(a) > 1 else 1.0
                  for a in (vol.h_axis, vol.k_axis, vol.l_axis)]
    ub_det = abs(float(np.linalg.det(np.asarray(vol.ub_matrix, dtype=np.float64))))
    voxel_volume = max(ub_det * float(np.prod(axes_steps)), 1e-30)
    expected = [4.0 / 3.0 * np.pi * (max(w[0] + w[1] * q_step, 0.0) ** 3
                                     - max(w[0], 0.0) ** 3) / voxel_volume
                for w in windows]
    keep_share = min(1.0, max_voxels / max(sum(expected), 1.0))
    keeps = [min(1.0, max(keep_share, n_cells * w[1] * cfg.sample_per_bin / max(e, 1.0)))
             for w, e in zip(windows, expected)]

    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    h = np.asarray(vol.h_axis, dtype=np.float64)
    k = np.asarray(vol.k_axis, dtype=np.float64)[None, :, None]
    l_ = np.asarray(vol.l_axis, dtype=np.float64)[None, None, :]
    keys: list[NDArray[np.int32]] = []
    vals: list[NDArray[np.float32]] = []
    # The grid's own voxels in each cell and bin, measured or not: what the
    # grid can give a cell, apart from what the coverage leaves (Resolution).
    grid = np.zeros(n_cells * total_bins, dtype=np.int64)
    for i0 in range(0, h.size, slab):
        hh = h[i0:i0 + slab][:, None, None]
        qx = ub[0, 0] * hh + ub[0, 1] * k + ub[0, 2] * l_
        qy = ub[1, 0] * hh + ub[1, 1] * k + ub[1, 2] * l_
        qz = ub[2, 0] * hh + ub[2, 1] * k + ub[2, 2] * l_
        q = np.sqrt(qx * qx + qy * qy + qz * qz)
        window = (q >= q_lo) & (q < q_hi)
        if not window.any():
            continue
        data = vol.data[i0:i0 + slab]
        ok = vol.mask[i0:i0 + slab] & np.isfinite(data) & window
        q_w, qz_w = q[window], qz[window]
        cos = np.clip(np.divide(qz_w, q_w, out=np.zeros_like(q_w), where=q_w > 0), -1.0, 1.0)
        band = np.minimum(((cos + 1.0) * 0.5 * cfg.n_cos).astype(np.int64), cfg.n_cos - 1)
        phi = np.arctan2(qy[window], qx[window])
        sector = np.minimum(((phi + np.pi) / (2.0 * np.pi) * cfg.n_phi).astype(np.int64),
                            cfg.n_phi - 1)
        cell_w = (band * cfg.n_phi + sector).astype(np.int32)
        q_al = q_w / (1.0 + scale[cell_w]) if any_aligned else q_w
        measured = ok[window]
        read = bool(measured.any())
        draw = (np.random.default_rng(i0).random(ok.shape)[ok]
                if read and min(keeps) < 1.0 else None)
        cell = cell_w[measured]
        v = data[ok].astype(np.float32)
        grid_keys = []
        for s, (lo, n_bins, aligned) in enumerate(windows):
            b = np.floor(((q_al if aligned else q_w) - lo) / q_step).astype(np.int32)
            inside = (b >= 0) & (b < n_bins)
            grid_keys.append(cell_w[inside] * np.int32(total_bins) + np.int32(offsets[s])
                             + b[inside])
            if not read:
                continue
            b = b[measured]
            inside = (b >= 0) & (b < n_bins)
            if draw is not None and keeps[s] < 1.0:
                inside &= draw < keeps[s]
            if inside.any():
                keys.append(cell[inside] * np.int32(total_bins) + np.int32(offsets[s]) + b[inside])
                vals.append(v[inside])
        grid += bincount(np.concatenate(grid_keys), minlength=grid.size)
    if not keys:
        return None
    key = np.concatenate(keys)
    val = np.concatenate(vals)
    del keys, vals
    count = bincount(key, minlength=n_cells * total_bins)
    order = np.lexsort((val, key))
    sorted_vals = val[order]
    starts = np.zeros_like(count)
    np.cumsum(count[:-1], out=starts[1:])
    median_flat = np.full(count.size, np.nan)
    nz = np.nonzero(count >= cfg.min_voxels)[0]
    median_flat[nz] = 0.5 * (sorted_vals[starts[nz] + (count[nz] - 1) // 2]
                             + sorted_vals[starts[nz] + count[nz] // 2])
    return _CellMedians(median_flat.reshape(n_cells, total_bins),
                        grid.reshape(n_cells, total_bins), keeps, offsets)


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

    On a grid too coarse for the test (:func:`grid_too_coarse`) no shell is
    judged, and a shell is not judged where the grid fills too few of its
    direction cells (the module docstring, *Resolution*): ``not_judged`` says
    why, starting "grid too coarse".
    """
    cfg = config or IsotropyConfig()
    if not shells:
        return []
    q_step = profile_step(vol, cfg)
    coarse = grid_too_coarse(vol, cfg)
    if coarse:
        return [ShellIsotropy(float(q0), _reach(f, cfg, q_step)[0], 0, np.nan, np.nan, np.nan,
                              False, coarse) for q0, f in shells]
    # Every candidate's core and gap, kept out of the other shells' flanks.
    apart = [*shells, *others] if keep_apart else list(others)
    keep_out = [(float(q), _extent(f, cfg, q_step)) for q, f in apart]
    layouts = [_layout((float(q0),), f, cfg, q_step, keep_out, (float(q0),)) for q0, f in shells]
    return _judge_layouts(vol, layouts, cfg, slab=slab)


def _judge_layouts(vol: HKLVolume, layouts: Sequence[_Layout], cfg: IsotropyConfig, *,
                   slab: int | None = None, cell_scale: NDArray[np.float64] | None = None,
                   rule: str = "strict") -> list[ShellIsotropy]:
    """Each layout's verdict, by the strict rule or the Al lines' (``rule="al"``:
    the noise floor ``al_min_snr``, and every line of a cluster rising on its
    own)."""
    q_step = profile_step(vol, cfg)
    cells = _cell_medians(vol, [(lay.lo, lay.n_bins, lay.aligned) for lay in layouts], cfg,
                          slab=slab, cell_scale=cell_scale)
    if cells is None:
        return [ShellIsotropy(lay.q0, lay.fwhm, 0, np.nan, np.nan, np.nan, False,
                              "no measured voxels", rule=rule) for lay in layouts]
    min_snr = cfg.al_min_snr if rule == "al" else cfg.min_snr
    q_box = inscribed_q(vol)
    out: list[ShellIsotropy] = []
    for s, lay in enumerate(layouts):
        q0, fwhm, centres, role = lay.q0, lay.fwhm, lay.centres, lay.role
        span = slice(int(cells.offsets[s]), int(cells.offsets[s]) + lay.n_bins)
        prof = cells.median[:, span]
        flank = role == 0
        x_flank = centres[flank] - q0
        x_core = centres[role == 1] - q0
        good = np.isfinite(prof[:, role >= 0]).all(axis=1)
        # A line through both flanks: a slope read from one side only would
        # pass for a height in every direction.
        if not ((x_flank < 0).any() and (x_flank > 0).any()):
            out.append(ShellIsotropy(q0, fwhm, 0, np.nan, np.nan, np.nan, False,
                                     "no clean flank on one side", rule=rule))
            continue
        # The cells the grid fills: of those the shell's window reaches in
        # every bin of its profile, the ones it gives min_voxels in each (as
        # low-memory mode reads them). The rule speaks for direction_share of
        # the directions; fewer, and the cells left are those the lattice
        # happens to fill, along its own directions (Resolution). Asked of a
        # window inside the box's inscribed sphere only, where no face cuts a
        # cell short: further out a cell has more voxels a bin, not fewer.
        voxels = cells.grid[:, span][:, role >= 0]
        reached = int(np.count_nonzero((voxels > 0).all(axis=1)))
        filled = int(np.count_nonzero((voxels * cells.keeps[s] >= cfg.min_voxels).all(axis=1)))
        inside_box = lay.lo + lay.n_bins * q_step <= q_box
        if inside_box and reached and filled < cfg.direction_share * reached:
            out.append(ShellIsotropy(
                q0, fwhm, int(np.count_nonzero(good)), np.nan, np.nan, np.nan, False,
                f"{GRID_TOO_COARSE}: {filled} of the {reached} direction cells get "
                f"{cfg.min_voxels} voxels in each |Q| bin, under {100 * cfg.direction_share:g} %",
                rule=rule))
            continue
        # A line through the flanks gives each cell's height, which a ring whose
        # |Q| wanders with direction keeps. A quadratic through the same flanks
        # gives the height left once their curvature is taken out: a smooth hump
        # under the shell, or a falling background, reads as a height in every
        # direction above a line, but not above the curve.
        curved = x_flank.size >= 4
        heights, levels, snrs, beyond_curve, excess = [], [], [], [], []
        for c in np.nonzero(good)[0]:
            y_flank = prof[c, flank]
            line = np.polyfit(x_flank, y_flank, 1)
            above_line = prof[c, role == 1] - np.polyval(line, x_core)
            height = float(np.mean(above_line))
            resid = y_flank - np.polyval(line, x_flank)
            scatter = float(np.sqrt(np.sum(resid ** 2) / max(x_flank.size - 2, 1)))
            heights.append(height)
            levels.append(float(np.polyval(line, 0.0)))
            snrs.append(height / (scatter / np.sqrt(x_core.size)) if scatter > 0 else np.inf)
            excess.append(above_line)
            if curved:
                quad = np.polyfit(x_flank, y_flank, 2)
                beyond_curve.append(float(np.mean(prof[c, role == 1] - np.polyval(quad, x_core))))
        amplitudes = None
        if lay.lines and excess:
            # A cluster's lines, each its own amplitude in every cell: the
            # excess over the core fitted as one peak of the cluster's width
            # at each line (least squares, all cells at once).
            sigma = fwhm / (2.0 * np.sqrt(2.0 * np.log(2.0)))
            peaks = np.exp(-0.5 * ((x_core[:, None] + q0 - np.asarray(lay.lines)[None, :])
                                   / sigma) ** 2)
            amplitudes = np.linalg.lstsq(peaks, np.asarray(excess).T, rcond=None)[0].T
        out.append(_verdict(q0, fwhm, np.asarray(heights), np.asarray(levels), np.asarray(snrs),
                            np.asarray(beyond_curve) if curved else None, cfg,
                            min_snr=min_snr, rule=rule,
                            amplitudes=amplitudes, lines=lay.lines))
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


# ---------------------------------------------------------------------------
# The Al lines' test (the module docstring, *Al lines*)
# ---------------------------------------------------------------------------

#: The largest |scale| :func:`al_cell_scales` searches: an Al line at |Q| is
#: looked for within ± AL_MAX_SCALE × |Q| of its place in every direction cell.
AL_MAX_SCALE = 0.02

#: The signal-to-noise a ring's matched peak needs in a cell for its place
#: there to count towards the cell's scale.
_SCALE_MIN_SNR = 3.0

#: The rings a cell needs placed for a scale of its own: with two, a weighted
#: median is one of them, and a misplaced one goes unseen.
_SCALE_MIN_RINGS = 3


@dataclass(frozen=True)
class CellScales:
    """Each direction cell's Al frame: the Al lines there peak at Q_line × (1 + scale)."""

    scale: NDArray[np.float64]  # per direction cell; 0 where not measured
    n_cells: int                # cells whose scale was measured (0: no frame, the lab's)
    n_rings: int                # the rings it was read from
    p95: float                  # the 95th percentile of |scale| over those cells
    reliability: float = 0.0    # the share of the scales' spread that is the cells' own

    def as_dict(self) -> dict[str, object]:
        return {"rings": self.n_rings, "cells": self.n_cells,
                "scale_p95": float(round(self.p95, 5)),
                "reliability": float(round(self.reliability, 3))}


def al_cell_scales(
    vol: HKLVolume,
    rings: Sequence[tuple[float, float]],
    config: IsotropyConfig | None = None,
    *,
    max_scale: float = AL_MAX_SCALE,
    slab: int | None = None,
) -> CellScales:
    """Where the confirmed Al rings ``(q_line, fwhm)`` peak in each direction
    cell, as one scale per cell: the lines there sit at q_line × (1 + scale).

    In every cell, each ring's excess over a line through the outer bins of
    its window is matched with a peak of its FWHM (capped at ``fwhm_cap``)
    placed every quarter bin within ± ``max_scale`` × q_line; the best place,
    refined by a parabola, counts where it stands :data:`_SCALE_MIN_SNR` times
    the outer bins' scatter above them and inside the search. The cell's scale
    is the weighted median of the places over q_line, each weighted by its
    precision, (q_line × SNR / FWHM)²; a cell with fewer than
    :data:`_SCALE_MIN_RINGS` rings placed keeps scale 0 (not aligned). Each
    scale is then shrunk towards 0 by its error, as far as the scales' spread
    over the cells is error rather than the cells' own (``reliability``, the
    share that is their own): from noise, no frame at all (``n_cells`` 0).
    Pass rings clear of other lines by more than the search reaches.
    """
    cfg = config or IsotropyConfig()
    n_cells = cfg.n_cos * cfg.n_phi
    scale = np.zeros(n_cells)
    if len(rings) < _SCALE_MIN_RINGS or grid_too_coarse(vol, cfg):
        return CellScales(scale, 0, 0, 0.0)
    q_step = profile_step(vol, cfg)
    windows = []
    for q, f in rings:
        w = max(min(float(f), cfg.fwhm_cap), SAMPLES_PER_FWHM * q_step)
        half = max_scale * float(q) + 2.0 * w
        windows.append((float(q) - half, int(np.ceil(2.0 * half / q_step)), False))
    cells = _cell_medians(vol, windows, cfg, slab=slab)
    if cells is None:
        return CellScales(scale, 0, 0, 0.0)
    places = np.full((n_cells, len(rings)), np.nan)
    weights = np.zeros((n_cells, len(rings)))
    for j, ((q, f), (lo, n_bins, _al)) in enumerate(zip(rings, windows)):
        q = float(q)
        w = max(min(float(f), cfg.fwhm_cap), SAMPLES_PER_FWHM * q_step)
        reach = max_scale * q
        x = lo + (np.arange(n_bins) + 0.5) * q_step - q
        outer = np.abs(x) > reach + w
        if (x[outer] < 0).sum() < 2 or (x[outer] > 0).sum() < 2:
            continue
        prof = cells.median[:, int(cells.offsets[j]):int(cells.offsets[j]) + n_bins]
        good = np.nonzero(np.isfinite(prof).all(axis=1))[0]
        if good.size == 0:
            continue
        y = prof[good]
        design = np.vstack([x[outer], np.ones(int(outer.sum()))]).T
        line = np.linalg.lstsq(design, y[:, outer].T, rcond=None)[0]
        excess = y - (np.outer(line[0], x) + line[1][:, None])
        scatter = np.sqrt(np.sum(excess[:, outer] ** 2, axis=1) / max(int(outer.sum()) - 2, 1))
        step = 0.25 * q_step
        shifts = np.arange(-reach, reach + 0.5 * step, step)
        sigma = w / (2.0 * np.sqrt(2.0 * np.log(2.0)))
        peaks = np.exp(-0.5 * ((x[None, :] - shifts[:, None]) / sigma) ** 2)
        peaks /= np.sqrt(np.sum(peaks ** 2, axis=1, keepdims=True))
        score = excess @ peaks.T                         # (cells, shifts)
        best = np.argmax(score, axis=1)
        inner = (best > 0) & (best < shifts.size - 1)
        rows = np.arange(good.size)
        b = np.clip(best, 1, shifts.size - 2)
        s0, s1, s2 = score[rows, b - 1], score[rows, b], score[rows, b + 1]
        curv = s0 - 2.0 * s1 + s2
        frac = np.where(curv < 0, 0.5 * (s0 - s2) / np.where(curv < 0, curv, -1.0), 0.0)
        place = (shifts[b] + np.clip(frac, -0.5, 0.5) * step) / q
        snr = np.divide(score[rows, best], scatter, out=np.zeros(good.size), where=scatter > 0)
        keep = inner & (snr >= _SCALE_MIN_SNR)
        places[good[keep], j] = place[keep]
        weights[good[keep], j] = (q * np.minimum(snr[keep], 30.0) / w) ** 2
    # Each cell's scale and its error: the precision of its places (the
    # matched peak's, about 0.6 FWHM / SNR, over q_line), or their scatter
    # about the scale, whichever is the larger.
    n_placed = np.isfinite(places).sum(axis=1)
    measured = n_placed >= _SCALE_MIN_RINGS
    error2 = np.full(n_cells, np.inf)
    for c in np.nonzero(measured)[0]:
        ok = np.isfinite(places[c])
        p, wt = places[c, ok], weights[c, ok]
        scale[c] = _weighted_median(p, wt)
        n_eff = wt.sum() ** 2 / np.sum(wt ** 2)
        scatter2 = float(np.sum(wt * (p - scale[c]) ** 2) / wt.sum()) / max(n_eff - 1.0, 1.0)
        error2[c] = max(0.36 / float(wt.sum()), scatter2)
    if not measured.any():
        return CellScales(np.zeros(n_cells), 0, len(rings), 0.0, 0.0)
    # How much of the scales' spread over the cells is the cells' own, not
    # their error (robust variances), and each cell's scale shrunk towards 0
    # by its error accordingly: a frame read from noise aligns nothing.
    spread = float((1.4826 * np.median(np.abs(scale[measured] - np.median(scale[measured])))) ** 2)
    signal = max(spread - float(np.median(error2[measured])), 0.0)
    shrunk = np.where(measured, scale * signal / (signal + np.where(measured, error2, 1.0)), 0.0)
    if signal <= 0.0:
        return CellScales(np.zeros(n_cells), 0, len(rings), 0.0, 0.0)
    shrunk = np.clip(shrunk, -max_scale, max_scale)
    p95 = float(np.quantile(np.abs(shrunk[measured]), 0.95))
    return CellScales(shrunk, int(measured.sum()), len(rings), p95, signal / spread)


def _weighted_median(values: NDArray[np.float64], weights: NDArray[np.float64]) -> float:
    order = np.argsort(values)
    cw = np.cumsum(weights[order])
    return float(values[order][int(np.searchsorted(cw, 0.5 * cw[-1]))])


@dataclass(frozen=True)
class AlCluster:
    """Al lines judged as one shell: one line, or a doublet whose cores touch."""

    lines: tuple[float, ...]     # the lines' |Q| at the fitted lattice (Å⁻¹)
    fwhm: float                  # the Al lines' width there (Å⁻¹)
    own: tuple[float, ...] = ()  # its candidates' own centres, not kept out of its flanks


def judge_al_lines(
    vol: HKLVolume,
    clusters: Sequence[AlCluster],
    config: IsotropyConfig | None = None,
    *,
    cell_scale: NDArray[np.float64] | None = None,
    others: Sequence[tuple[float, float]] = (),
    slab: int | None = None,
) -> list[ShellIsotropy]:
    """Judge each cluster of Al lines as one shell, by the Al lines' rule (the
    module docstring, *Al lines*): in each direction cell's Al frame
    (``cell_scale``, :func:`al_cell_scales`; none, the lab frame), its core
    every line's ± ``core_scale`` × the Al width, its flanks outside the
    cluster, clear of the cores of ``others``; it rises by ``height_share`` of
    its median height in ``direction_share`` of the measured cells, at
    ``al_min_snr`` and above the curve, and so does every line of a doublet,
    on its own amplitude."""
    cfg = config or IsotropyConfig()
    if not clusters:
        return []
    q_step = profile_step(vol, cfg)
    coarse = grid_too_coarse(vol, cfg)
    if coarse:
        return [ShellIsotropy(float(np.mean(c.lines)), _reach(c.fwhm, cfg, q_step)[0], 0, np.nan,
                              np.nan, np.nan, False, coarse, rule="al") for c in clusters]
    keep_out = [(float(q), _extent(f, cfg, q_step)) for q, f in others]
    aligned = cell_scale is not None
    layouts = [_layout(c.lines, c.fwhm, cfg, q_step, keep_out, (*c.lines, *c.own),
                       aligned=aligned) for c in clusters]
    return _judge_layouts(vol, layouts, cfg, slab=slab, cell_scale=cell_scale, rule="al")


def _verdict(q0: float, fwhm: float, heights: NDArray[np.float64], levels: NDArray[np.float64],
             snrs: NDArray[np.float64], beyond_curve: NDArray[np.float64] | None,
             cfg: IsotropyConfig, *, min_snr: float | None = None,
             rule: str = "strict", amplitudes: NDArray[np.float64] | None = None,
             lines: tuple[float, ...] = ()) -> ShellIsotropy:
    share = cfg.direction_share
    min_snr = cfg.min_snr if min_snr is None else min_snr
    n = int(heights.size)
    if n < cfg.min_cells:
        return ShellIsotropy(q0, fwhm, n, np.nan, np.nan, np.nan, False,
                             f"measured in {n} direction cells, under {cfg.min_cells}", rule=rule)
    med = float(np.median(heights))
    low = float(np.quantile(heights, 1.0 - share))
    level = float(np.median(levels))
    rel = med / level if level > 0 else np.nan
    iso = low / med if med > 0 else np.nan
    # The noise floor: in the typical direction the shell stands min_snr times
    # its flanks' scatter (over the core's mean) above them. And the curvature:
    # a curve_share of that height stays above a quadratic through the flanks.
    snr = float(np.median(snrs))
    curve = float(np.median(beyond_curve)) / med if beyond_curve is not None and med > 0 else np.nan
    fails = [code for code, failed in (
        ("height", not med > 0), ("isotropy", med > 0 and not low >= cfg.height_share * med),
        ("snr", not snr >= min_snr), ("curve", curve < cfg.curve_share)) if failed]
    members: list[tuple[float, float, float]] = []
    if amplitudes is not None:
        # Every line of a cluster rises on its own amplitude, as the cluster does.
        for line, amp in zip(lines, amplitudes.T):
            m = float(np.median(amp))
            lo = float(np.quantile(amp, 1.0 - share))
            members.append((line, m, lo / m if m > 0 else np.nan))
            if not (m > 0 and lo >= cfg.height_share * m) and "line" not in fails:
                fails.append("line")
    return ShellIsotropy(q0, fwhm, n, med, rel, iso, not fails, snr=snr, beyond_curve=curve,
                         rule=rule, members=tuple(members), fails=tuple(fails))


__all__ = ["AL_MAX_SCALE", "GRID_TOO_COARSE", "SAMPLES_PER_FWHM", "AlCluster", "CellScales",
           "IsotropyConfig", "ShellIsotropy", "al_cell_scales", "grid_needs", "grid_too_coarse",
           "inscribed_q", "judge_al_lines", "judge_shells", "profile_step", "shell_isotropy",
           "voxel_q_step"]
