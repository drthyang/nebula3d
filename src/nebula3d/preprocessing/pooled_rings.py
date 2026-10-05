# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Stack-pooled sector powder-ring removal (``RingParams.ring_model="pooled"``).

Why another model
-----------------
On the CORELLI TbTi3Bi4 volumes a powder ring is not a sphere whose only
direction dependence is its amplitude.  Its radial position and width wander
with direction: at H=0 the 4.39 Å⁻¹ Al line peaks anywhere from 4.30 to
4.51 Å⁻¹ depending on the azimuth, more than its own FWHM, and the *mmm*
symmetrisation overlays several such copies, so along some directions a ring
is a multi-peaked band 0.25 Å⁻¹ wide.  At a fixed |Q| the ring intensity traces
smooth curved loci over the sphere.  A model that ties each ring to one radial
line shape (``parametric``, ``global_v2``), or smooths the azimuthal pattern of
every |Q| bin with a few damped harmonics (``patched``), subtracts the ring at
the wrong |Q|: a bright arc is left beside a dark one along every ring, and the
azimuthally averaged removal fraction cannot see it because the two cancel.

What it does
------------
No radial line shape is assumed.  The ring is read off the data in small
solid-angle cells, and the volume's own stack of planes supplies the statistics
a single plane lacks:

1. **Per plane (pass 1):** the median radial profile of every azimuthal sector
   (``n_sectors``, default 72 × 5°) on |Q| bins of ``q_step`` (never finer than
   half the voxel |Q| spacing), and the all-azimuth profile used to confirm the
   ring shells across the stack.
2. **Shells:** the rings present across the stack (the logic of
   :func:`~nebula3d.preprocessing.radial_background.confirm_ring_shells_across_h`,
   whose relative cut keeps every ring above 6 % of the strongest; here a ring
   must also rise ``min_snr`` × the profile noise).  A weaker
   ring is added only if it rises ``min_snr`` × the profile noise *and* sits on
   an FCC-Al powder line (``al_prior``; lattice parameter fitted from the strong
   rings): the sample environment's Al lines are the usual weak rings, while a
   weak sharp maximum of the diffuse itself must not be taken for one.
3. **Pooling (pass 2):** each plane's sector profile is replaced by the weighted
   median of the sector profiles in a small solid angle of the ring sphere
   around it: the planes whose direction at that |Q| lies within ±``pool_deg``
   (so the stack window widens with |Q|) and ±``pool_sectors`` neighbouring
   sectors, weighted by voxel count × a triangle kernel.  A Bragg peak fills
   one sector over a few planes, a minority of that neighbourhood, so the median
   rejects it; a ring is present throughout and survives.  Where the grid is too
   coarse for that solid angle to hold ``pool_target_count`` voxels (low |Q|, a
   coarse grid), it is widened in both directions until it does.
4. **Ring excess:** a SNIP baseline under each pooled sector profile, with one
   window per ring *cluster* (rings closer than their widths share a window, so
   a close doublet is not half-clipped), the same windows on every plane.  The
   excess is kept only inside the confirmed shells, through a flat-topped
   envelope ``envelope_scale`` × FWHM wide (room for the direction-dependent
   position), and capped at ``amp_cap`` × the shell's across-stack amplitude.
5. **Subtract:** the sector excess, interpolated bilinearly over (φ, |Q|) at
   every voxel of the plane.

Neighbouring planes share most of their pooled data, so the subtracted ring is
continuous along the stack axis: no plane-to-plane jitter reaches the ΔPDF FFT.
The azimuthally under-sampled "spoke" voxels are masked as the per-plane models
mask them (:func:`~nebula3d.preprocessing.sampling.azimuthal_sampling_mask`), for
the downstream backfill.
"""

from __future__ import annotations

import dataclasses
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray
from scipy.ndimage import gaussian_filter1d

from nebula3d.core import HKLVolume, low_memory
from nebula3d.preprocessing.global_rings import (
    GlobalRingConfig,
    _match_aluminum,
    aluminum_fcc_lines,
)
from nebula3d.preprocessing.radial_background import (
    _azimuthal_angle,
    _confirm_shells_from_plane_profiles,
    _robust_radial_profile,
    _snip_baseline,
    _stack_plane_q_magnitude,
)
from nebula3d.preprocessing.sampling import azimuthal_sampling_mask

# plane → (stack axis, stack-axis attribute, the two in-plane axis indices)
_PLANES: dict[str, tuple[int, str, tuple[int, int]]] = {
    "0kl": (0, "h_axis", (1, 2)),
    "h0l": (1, "k_axis", (0, 2)),
    "hk0": (2, "l_axis", (0, 1)),
}

# Planes with fewer valid voxels are left untouched (as the per-plane models do).
_MIN_PLANE_VOXELS = 200
# Voxels a |Q| bin needs on one plane to enter the across-stack shell profile.
_MIN_VOXELS_PER_BIN = 8
# Stack-pooling bands: the |Q| bins are split into this many groups, each read
# with the plane window of its largest |Q| (the window grows with |Q|).
_N_POOL_BANDS = 6

ProgressFn = Callable[[float, str], None]


@dataclass(frozen=True)
class PooledRingConfig:
    """Configuration for :func:`fit_pooled_rings`.

    ``plane`` names the stack: ``"0kl"`` stacks H planes, ``"h0l"`` K planes,
    ``"hk0"`` L planes.  ``pool_deg`` is the half-width of the stack pooling as
    an angle on the ring sphere (exact at the equator of the stack axis, a
    difference in cos θ elsewhere).  ``pool_target_count`` is the number of
    voxels the pooling solid angle should hold, by geometry; where it would
    hold fewer, it widens.  ``min_snr`` and ``al_prior`` govern weak rings
    (see the module docstring).
    """

    plane: str = "0kl"
    q_min: float = 1.5
    q_max: float = 10.5
    q_step: float = 0.02
    n_sectors: int = 72
    pool_deg: float = 5.0
    pool_sectors: int = 1
    min_pooled_count: float = 6.0
    pool_target_count: float = 12.0
    max_fwhm: float = 0.24
    min_snr: float = 6.0
    al_prior: bool = True
    envelope_scale: float = 1.5
    amp_cap: float = 8.0
    window_scale: float = 3.0
    window_cap_frac: float = 0.9
    baseline_smooth: float = 0.06
    sampling_min_count_frac: float = 0.25

    def __post_init__(self) -> None:
        if self.plane not in _PLANES:
            raise ValueError(f"plane must be one of {sorted(_PLANES)}; got {self.plane!r}")
        if self.q_max <= self.q_min:
            raise ValueError("q_max must be greater than q_min")
        if self.q_step <= 0 or self.max_fwhm <= 0:
            raise ValueError("q_step and max_fwhm must be positive")
        if self.n_sectors < 8:
            raise ValueError("n_sectors must be at least 8")
        if self.pool_deg <= 0:
            raise ValueError("pool_deg must be positive")
        if self.pool_sectors < 0 or 2 * self.pool_sectors + 1 > self.n_sectors:
            raise ValueError("pool_sectors must be ≥ 0 and smaller than n_sectors / 2")
        if self.envelope_scale <= 0:
            raise ValueError("envelope_scale must be positive")
        if self.amp_cap < 0:
            raise ValueError("amp_cap must be non-negative (0 disables the cap)")
        if self.pool_target_count <= 0 or self.min_pooled_count < 0:
            raise ValueError("pool_target_count must be positive, min_pooled_count ≥ 0")


@dataclass
class PooledRingResult:
    """Cleaned volume + a JSON-ready summary of the fit."""

    cleaned: HKLVolume
    diagnostics: dict[str, object] = field(default_factory=dict)
    ring: NDArray[np.floating] | None = None


def fit_pooled_rings(
    vol: HKLVolume,
    config: PooledRingConfig | None = None,
    *,
    progress: ProgressFn | None = None,
    return_ring: bool = False,
) -> PooledRingResult:
    """Fit and subtract the powder rings of ``vol`` (see the module docstring).

    The cleaned volume keeps the input's storage precision and ``sigma``; its
    mask additionally drops the azimuthally under-sampled voxels.  Planes with
    too few valid voxels are left as they are.  ``return_ring=True`` also
    returns the subtracted ring intensity (one more volume of memory).  In
    low-memory mode (:func:`nebula3d.core.low_memory`) the cleaned data is
    written over ``vol.data``.
    """
    cfg = config or PooledRingConfig()
    t_start = time.perf_counter()
    axis, axis_attr, _ = _PLANES[cfg.plane]
    n_planes = int(vol.data.shape[axis])
    axis_values = np.asarray(getattr(vol, axis_attr), dtype=np.float64)

    # |Q| bins no finer than half the voxel |Q| spacing: on a coarse grid finer
    # bins only starve the (sector, bin) cells.  Laid out as
    # confirm_ring_shells_across_h lays out its bins.
    q_step = max(cfg.q_step, 0.5 * _voxel_q_spacing(vol))
    edges = np.arange(cfg.q_min, cfg.q_max + q_step, q_step)
    q_grid = 0.5 * (edges[:-1] + edges[1:])
    n_bins = q_grid.size
    n_sec = cfg.n_sectors

    # ---- pass 1: per-plane sector profiles + all-azimuth shell profiles ----
    sector_med = np.full((n_planes, n_sec, n_bins), np.nan, dtype=np.float32)
    sector_cnt = np.zeros((n_planes, n_sec, n_bins), dtype=np.float32)
    shell_prof = np.full((n_planes, n_bins), np.nan)
    shell_cnt = np.zeros((n_planes, n_bins))
    out_mask = vol.mask.copy()
    fitted = np.zeros(n_planes, dtype=bool)
    abs_total = 0.0          # Σ|I| over valid voxels, for the removed fraction
    for i in range(n_planes):
        q2, phi2, data2, valid2 = _plane_inputs(vol, cfg.plane, axis, i)
        abs_total += float(np.abs(data2[valid2]).sum())
        if int(valid2.sum()) < _MIN_PLANE_VOXELS:
            continue
        prof, cnt = _robust_radial_profile(
            q2[valid2], data2[valid2], edges, (10.0, 80.0), _MIN_VOXELS_PER_BIN, "median")
        shell_prof[i], shell_cnt[i] = prof, cnt
        keep2 = _sampling_keep(vol, cfg, axis, i, q2, phi2)
        fit2 = keep2 & np.isfinite(data2)
        sector_med[i], sector_cnt[i] = _sector_profiles(
            q2[fit2], phi2[fit2], data2[fit2], edges, n_sec)
        _put_plane(out_mask, axis, i, keep2)
        fitted[i] = True
        if progress is not None and (i + 1) % 30 == 0:
            progress(0.4 * (i + 1) / n_planes, f"sector profiles {i + 1}/{n_planes}")
    t_pass1 = time.perf_counter() - t_start

    centers, fwhm, amps, origin, al_a = _detect_shells(
        q_grid, shell_prof, shell_cnt, q_step, cfg)
    del shell_prof, shell_cnt

    diagnostics: dict[str, object] = {
        "algorithm": "pooled",
        "schema_version": 1,
        "plane": cfg.plane,
        "config": dataclasses.asdict(cfg),
        "n_planes": n_planes,
        "n_planes_fitted": int(fitted.sum()),
        "q_step": q_step,
        "al_lattice_a": al_a,
        "shells": [
            {"q_center": float(c), "fwhm": float(f), "amplitude": float(a),
             "envelope_halfwidth": float(cfg.envelope_scale * f), "detection": o}
            for c, f, a, o in zip(centers, fwhm, amps, origin)
        ],
    }
    # Pass 2 reads each plane's raw data only while correcting that plane (the
    # neighbours enter through the pass-1 profiles), so in low-memory mode (the
    # browser) the output overwrites the disposable input, as the flatten does.
    res_data = vol.data if low_memory() else vol.data.copy()
    ring_out = np.zeros_like(vol.data) if return_ring else None
    if centers.size == 0:
        diagnostics["status"] = "no_rings"
        diagnostics["removed_fraction"] = 0.0
        diagnostics["timing_s"] = {"pass1": t_pass1, "total": time.perf_counter() - t_start}
        cleaned = dataclasses.replace(vol, data=res_data, mask=out_mask)
        return PooledRingResult(cleaned=cleaned, diagnostics=diagnostics, ring=ring_out)

    # ---- radial quantities shared by every plane ----
    windows = _cluster_windows(q_grid, centers, fwhm, q_step, cfg.max_fwhm,
                               cfg.window_scale, cfg.window_cap_frac)
    n_iter = np.maximum(3, np.round(windows / (2.0 * q_step)).astype(int))
    halfwidths = cfg.envelope_scale * fwhm
    envelope = _shell_envelope(q_grid, centers, halfwidths, q_step)
    ceiling = (_shell_ceiling(q_grid, centers, halfwidths, cfg.amp_cap * amps, q_step)
               if cfg.amp_cap > 0 else np.full(n_bins, np.inf))

    # Polar coordinate of a plane's voxels: Q·n̂ = (stack index) · d, with n̂ the
    # plane normal — so plane j sits Δ(Q·n̂)/|Q| = |a_j − a_i|·|d|/|Q| from
    # plane i on the ring sphere (Δcos θ; Δθ at the equator).
    d_stack = _stack_normal_component(vol, cfg.plane)
    kappa = np.deg2rad(cfg.pool_deg)
    reach = kappa * q_grid / max(abs(d_stack), 1e-12)          # stack-axis units
    # Expected voxels in the pooling solid angle, by geometry: a plane meets the
    # 3D shell [q, q+dq] in an annulus of area 2π·q·dq whatever its offset, so a
    # sector cell holds 2π·q·dq / (voxel area · n_sec); the triangle-weighted
    # planes sum to reach/Δ and the sectors to pool_sectors + 1.  Where that
    # falls short of the target, widen both directions by the same factor.
    step = float(np.median(np.abs(np.diff(axis_values)))) if n_planes > 1 else 1.0
    per_cell = 2.0 * np.pi * q_grid * q_step / (_in_plane_voxel_area(vol, cfg.plane) * n_sec)
    expected = per_cell * np.maximum(reach / max(step, 1e-12), 1.0) * (cfg.pool_sectors + 1)
    widen = np.maximum(1.0, np.sqrt(cfg.pool_target_count / np.maximum(expected, 1e-12)))
    reach = reach * widen
    half_sectors = np.minimum(
        np.ceil((cfg.pool_sectors + 1) * widen - 1.0 - 1e-9).astype(int), (n_sec - 1) // 2)
    bands = _pool_bands(half_sectors, n_bins)
    diagnostics["pool_widened_below_q"] = (
        float(q_grid[widen > 1.0].max()) if np.any(widen > 1.0) else None)

    # ---- pass 2: pool, ring excess, subtract ----
    removed = 0.0
    for i in range(n_planes):
        if not fitted[i]:
            continue
        pooled = np.full((n_sec, n_bins), np.nan, dtype=np.float32)
        weight = np.zeros((n_sec, n_bins), dtype=np.float32)
        dist = np.abs(axis_values - axis_values[i])
        for b0, b1 in bands:
            planes = np.nonzero(dist < reach[b1 - 1])[0]
            tri = np.clip(1.0 - dist[planes, None] / reach[None, b0:b1], 0.0, None)
            w = sector_cnt[planes, :, b0:b1] * tri[:, None, :].astype(np.float32)
            v = sector_med[planes, :, b0:b1]
            ns = int(half_sectors[b0])
            if ns:
                shifts = range(-ns, ns + 1)
                v = np.concatenate([np.roll(v, sh, axis=1) for sh in shifts])
                w = np.concatenate([np.roll(w, sh, axis=1)
                                    * np.float32(1.0 - abs(sh) / (ns + 1.0)) for sh in shifts])
            pooled[:, b0:b1], weight[:, b0:b1] = _weighted_median(v, w)
        pooled[weight < cfg.min_pooled_count] = np.nan
        excess = _sector_excess(pooled.astype(np.float64), n_iter, envelope, ceiling,
                                cfg.baseline_smooth / q_step)
        q2, phi2, data2, valid2 = _plane_inputs(vol, cfg.plane, axis, i)
        ring2 = _evaluate(excess, q2, phi2, q_grid, q_step)
        # Every measured voxel is corrected, the spoke voxels the sampling mask
        # drops included (as the per-plane models do); masked voxels are left.
        ring2 = np.where(np.take(vol.mask, i, axis=axis), ring2, 0.0)
        removed += float(ring2[valid2].sum())
        _put_plane(res_data, axis, i, (data2 - ring2).astype(vol.data.dtype, copy=False))
        if ring_out is not None:
            _put_plane(ring_out, axis, i, ring2.astype(vol.data.dtype, copy=False))
        if progress is not None and (i + 1) % 30 == 0:
            progress(0.4 + 0.6 * (i + 1) / n_planes, f"pooled subtraction {i + 1}/{n_planes}")

    diagnostics["status"] = "fitted"
    diagnostics["removed_fraction"] = removed / abs_total if abs_total > 0 else 0.0
    diagnostics["timing_s"] = {"pass1": t_pass1, "total": time.perf_counter() - t_start}
    cleaned = dataclasses.replace(vol, data=res_data, mask=out_mask)
    return PooledRingResult(cleaned=cleaned, diagnostics=diagnostics, ring=ring_out)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _plane_view(vol: HKLVolume, axis: int, index: int) -> HKLVolume:
    sl: list[slice] = [slice(None)] * 3
    sl[axis] = slice(index, index + 1)
    attr = ("h_axis", "k_axis", "l_axis")[axis]
    return dataclasses.replace(
        vol, data=vol.data[tuple(sl)], sigma=vol.sigma[tuple(sl)],
        mask=vol.mask[tuple(sl)], **{attr: getattr(vol, attr)[index:index + 1]})


def _plane_inputs(
    vol: HKLVolume, plane: str, axis: int, index: int,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], NDArray[np.bool_]]:
    """2-D |Q|, azimuth, float64 data and validity (mask & finite) of one plane."""
    q2 = _stack_plane_q_magnitude(vol, plane, axis, index)
    phi2 = np.take(_azimuthal_angle(_plane_view(vol, axis, index), plane), 0, axis=axis)
    data2 = np.take(vol.data, index, axis=axis).astype(np.float64)
    valid2 = np.take(vol.mask, index, axis=axis) & np.isfinite(data2)
    return q2, np.broadcast_to(phi2, q2.shape), data2, valid2


def _sampling_keep(
    vol: HKLVolume, cfg: PooledRingConfig, axis: int, index: int,
    q2: NDArray[np.float64], phi2: NDArray[np.float64],
) -> NDArray[np.bool_]:
    one = _plane_view(vol, axis, index)
    keep = azimuthal_sampling_mask(
        one, plane=cfg.plane, min_count_frac=cfg.sampling_min_count_frac,
        q_range=(cfg.q_min, cfg.q_max), q=np.expand_dims(q2, axis),
        phi=np.expand_dims(phi2, axis))
    return np.take(keep, 0, axis=axis)


def _put_plane(dest: NDArray, axis: int, index: int, plane: NDArray) -> None:
    sl: list[slice | int] = [slice(None)] * 3
    sl[axis] = index
    dest[tuple(sl)] = plane


def _sector_profiles(
    q: NDArray[np.float64], phi: NDArray[np.float64], data: NDArray[np.float64],
    edges: NDArray[np.float64], n_sec: int,
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    """Median and voxel count per (azimuthal sector, |Q| bin) — one sort."""
    n_bins = edges.size - 1
    qi = np.digitize(q, edges) - 1
    si = np.floor((phi + np.pi) / (2.0 * np.pi) * n_sec).astype(np.intp) % n_sec
    ok = (qi >= 0) & (qi < n_bins)
    key = si[ok] * n_bins + qi[ok]
    vals = data[ok]
    n = np.bincount(key, minlength=n_sec * n_bins)
    sorted_vals = vals[np.lexsort((vals, key))]
    starts = np.zeros_like(n)
    np.cumsum(n[:-1], out=starts[1:])
    med = np.full(n_sec * n_bins, np.nan)
    nz = np.nonzero(n > 0)[0]
    med[nz] = 0.5 * (sorted_vals[starts[nz] + (n[nz] - 1) // 2]
                     + sorted_vals[starts[nz] + n[nz] // 2])
    return (med.reshape(n_sec, n_bins).astype(np.float32),
            n.reshape(n_sec, n_bins).astype(np.float32))


def _weighted_median(
    values: NDArray[np.float32], weights: NDArray[np.float32],
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    """Weighted median along axis 0 (NaN where the total weight is 0)."""
    weights = np.where(np.isfinite(values), weights, np.float32(0.0))
    v = np.where(weights > 0, values, np.float32(np.inf))
    order = np.argsort(v, axis=0)
    vs = np.take_along_axis(v, order, axis=0)
    cw = np.cumsum(np.take_along_axis(weights, order, axis=0), axis=0)
    total = cw[-1]
    k = np.minimum(np.sum(cw < 0.5 * total, axis=0), values.shape[0] - 1)
    out = np.take_along_axis(vs, k[None], axis=0)[0]
    out[total <= 0] = np.nan
    return out, total


def _sector_excess(
    pooled: NDArray[np.float64],
    n_iter: NDArray[np.int_],
    envelope: NDArray[np.float64],
    ceiling: NDArray[np.float64],
    smooth_bins: float,
) -> NDArray[np.float64]:
    """Ring excess (sectors × bins) of the pooled profiles.

    Unsupported cells are filled from the neighbouring *sectors* at the same
    |Q| first — a ring is continuous in φ, while interpolating along |Q| across
    an empty ring bin would erase the ring there — and only bins no sector
    supports from the neighbouring bins; those bins subtract nothing.
    """
    n_sec, n_bins = pooled.shape
    finite = np.isfinite(pooled)
    filled = pooled.copy()
    sec = np.arange(n_sec)
    bins_ok = finite.any(axis=0)
    if not bins_ok.any():
        return np.zeros_like(pooled)
    for b in np.nonzero(bins_ok & ~finite.all(axis=0))[0]:
        ok = finite[:, b]
        filled[~ok, b] = np.interp(sec[~ok], sec[ok], pooled[ok, b], period=n_sec)
    if not bins_ok.all():
        idx = np.arange(n_bins)
        for s in range(n_sec):
            filled[s, ~bins_ok] = np.interp(idx[~bins_ok], idx[bins_ok], filled[s, bins_ok])
    base = _snip_baseline(filled, n_iter)
    if smooth_bins > 0:
        base = gaussian_filter1d(base, smooth_bins, axis=-1, mode="nearest")
    excess = np.maximum(0.0, filled - np.minimum(base, filled)) * envelope
    excess = np.minimum(excess, ceiling)
    excess[:, ~bins_ok] = 0.0
    return excess


def _evaluate(
    excess: NDArray[np.float64], q: NDArray[np.float64], phi: NDArray[np.float64],
    q_grid: NDArray[np.float64], q_step: float,
) -> NDArray[np.float64]:
    """Bilinear (periodic φ × |Q|) interpolation of the sector excess at voxels."""
    n_sec, n_bins = excess.shape
    f = (phi + np.pi) / (2.0 * np.pi) * n_sec - 0.5
    s0f = np.floor(f)
    t = f - s0f
    s0 = s0f.astype(np.intp) % n_sec
    s1 = (s0 + 1) % n_sec
    pos = (q - q_grid[0]) / q_step
    b0f = np.floor(pos)
    u = np.clip(pos - b0f, 0.0, 1.0)
    b0 = np.clip(b0f, 0, n_bins - 1).astype(np.intp)
    b1 = np.minimum(b0 + 1, n_bins - 1)
    ring = ((1.0 - t) * ((1.0 - u) * excess[s0, b0] + u * excess[s0, b1])
            + t * ((1.0 - u) * excess[s1, b0] + u * excess[s1, b1]))
    inside = (q >= q_grid[0]) & (q <= q_grid[-1])
    return np.where(inside, ring, 0.0)


def _pool_bands(half_sectors: NDArray[np.int_], n_bins: int) -> list[tuple[int, int]]:
    """Contiguous bin ranges sharing one sector half-width, each further split so
    no range spans more than ~1/``_N_POOL_BANDS`` of the bins (the plane window
    of a range is that of its largest |Q|)."""
    out: list[tuple[int, int]] = []
    chunk = max(1, -(-n_bins // _N_POOL_BANDS))
    start = 0
    for b in range(1, n_bins + 1):
        if b == n_bins or half_sectors[b] != half_sectors[start] or b - start >= chunk:
            out.append((start, b))
            start = b
    return out


def _voxel_q_spacing(vol: HKLVolume) -> float:
    """Cube root of the voxel volume in Å⁻³ — the grid's |Q| sampling step."""
    steps = [float(np.median(np.abs(np.diff(ax)))) if ax.size > 1 else 0.0
             for ax in (vol.h_axis, vol.k_axis, vol.l_axis)]
    if min(steps) <= 0:
        return 0.0
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    return float(abs(np.linalg.det(ub)) * steps[0] * steps[1] * steps[2]) ** (1.0 / 3.0)


def _in_plane_voxel_area(vol: HKLVolume, plane: str) -> float:
    """Area (Å⁻²) of one voxel's face in the plane."""
    _, _, (i, j) = _PLANES[plane]
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    di = float(np.median(np.abs(np.diff(axes[i])))) if axes[i].size > 1 else 1.0
    dj = float(np.median(np.abs(np.diff(axes[j])))) if axes[j].size > 1 else 1.0
    return float(np.linalg.norm(np.cross(ub[:, i] * di, ub[:, j] * dj))) or 1.0


def _detect_shells(
    q_grid: NDArray[np.float64],
    shell_prof: NDArray[np.float64],
    shell_cnt: NDArray[np.float64],
    q_step: float,
    cfg: PooledRingConfig,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], list[str],
           float | None]:
    """Confirmed ring shells: ``(centers, fwhm, amplitudes, origin, al_a)``.

    Every ring above both the cross-stack relative cut and ``min_snr`` × the
    profile noise (``origin="relative"``), plus weaker rings above the noise cut
    alone that sit within max(2·q_step, 0.02) Å⁻¹ of an FCC-Al line
    (``origin="al_line"``), the lattice parameter ``al_a`` fitted from the
    strong rings that match Al.
    """
    strong = _confirm_shells_from_plane_profiles(
        q_grid, shell_prof, shell_cnt, q_step, cfg.max_fwhm, _MIN_VOXELS_PER_BIN,
        min_snr=cfg.min_snr)
    c, f, a = strong
    origin = ["relative"] * c.size
    if not cfg.al_prior or c.size == 0:
        return c, f, a, origin, None
    gcfg = GlobalRingConfig(q_min=cfg.q_min, q_max=cfg.q_max, material="auto")
    _matches, al_a = _match_aluminum(c, a, gcfg)
    if al_a is None:
        return c, f, a, origin, None
    weak_c, weak_f, weak_a = _confirm_shells_from_plane_profiles(
        q_grid, shell_prof, shell_cnt, q_step, cfg.max_fwhm, _MIN_VOXELS_PER_BIN,
        min_snr=cfg.min_snr, rel_prominence=0.0)
    lines = np.array([ln.q for ln in aluminum_fcc_lines(al_a, cfg.q_max + 0.1,
                                                         max(0.0, cfg.q_min - 0.1))])
    tol = max(2.0 * q_step, 0.02)
    keep = [k for k in range(weak_c.size)
            if not np.any(np.abs(c - weak_c[k]) <= np.maximum(f, q_step))
            and lines.size and np.min(np.abs(lines - weak_c[k])) <= tol]
    if not keep:
        return c, f, a, origin, al_a
    c = np.concatenate([c, weak_c[keep]])
    f = np.concatenate([f, weak_f[keep]])
    a = np.concatenate([a, weak_a[keep]])
    origin = origin + ["al_line"] * len(keep)
    order = np.argsort(c)
    return c[order], f[order], a[order], [origin[k] for k in order], al_a


def _stack_normal_component(vol: HKLVolume, plane: str) -> float:
    """(UB · ê_stack) · n̂ — the |Q| component normal to the plane per unit of
    the stack index (|a*| for an orthogonal cell)."""
    axis, _, (i, j) = _PLANES[plane]
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    normal = np.cross(ub[:, i], ub[:, j])
    normal /= np.linalg.norm(normal) + 1e-15
    return float(ub[:, axis] @ normal)


def _cluster_windows(
    q_grid: NDArray[np.float64],
    centers: NDArray[np.float64],
    fwhm: NDArray[np.float64],
    q_step: float,
    base_width: float,
    scale: float,
    cap_frac: float,
) -> NDArray[np.float64]:
    """Per-|Q|-bin SNIP window, one per ring *cluster*.

    Rings whose ±FWHM spans touch (within half a FWHM) form a cluster.  Its
    window is ``scale`` × half the cluster span (``scale`` × FWHM for a lone
    ring, as the per-plane adaptive window), capped at ``cap_frac`` × the
    distance to the neighbouring cluster and floored at ¾ of the span.  The
    per-ring window of the per-plane models is capped at the distance to the
    *nearest ring*, so the broad member of a close doublet (6.79/6.97 Å⁻¹ here)
    got a window narrower than itself and SNIP left half of it in the baseline.
    """
    out = np.full(q_grid.size, float(base_width))
    if centers.size == 0:
        return out
    order = np.argsort(centers)
    c, f = centers[order], fwhm[order]
    lo, hi = c - f, c + f
    groups: list[list[int]] = [[0]]
    for k in range(1, c.size):
        if lo[k] <= hi[groups[-1][-1]] + 0.5 * f[k]:
            groups[-1].append(k)
        else:
            groups.append([k])
    g_lo = np.array([lo[g].min() for g in groups])
    g_hi = np.array([hi[g].max() for g in groups])
    g_c = 0.5 * (g_lo + g_hi)
    span = g_hi - g_lo
    win = scale * 0.5 * span
    if g_c.size > 1:
        gap = np.full(g_c.size, np.inf)
        step = np.diff(g_c)
        gap[:-1] = np.minimum(gap[:-1], step)
        gap[1:] = np.minimum(gap[1:], step)
        win = np.minimum(win, cap_frac * gap)
    win = np.maximum(win, np.maximum(np.maximum(0.75 * span, 0.5 * base_width),
                                     4.0 * q_step))
    nearest = np.argmin(np.abs(q_grid[:, None] - g_c[None, :]), axis=1)
    return win[nearest]


def _shell_envelope(
    q_grid: NDArray[np.float64], centers: NDArray[np.float64],
    halfwidths: NDArray[np.float64], q_step: float,
) -> NDArray[np.float64]:
    """1 within ±halfwidth of a shell, a raised-cosine taper to 0 over the next
    halfwidth, max over shells (as ``PatchedRadialRingModel``'s envelope)."""
    env = np.zeros_like(q_grid, dtype=np.float64)
    for c, w in zip(centers, halfwidths):
        w = max(float(w), q_step)
        d = np.abs(q_grid - float(c))
        bump = np.where(d <= w, 1.0, np.where(
            d <= 2.0 * w, 0.5 * (1.0 + np.cos(np.pi * (d - w) / w)), 0.0))
        env = np.maximum(env, bump)
    return env


def _shell_ceiling(
    q_grid: NDArray[np.float64], centers: NDArray[np.float64],
    halfwidths: NDArray[np.float64], caps: NDArray[np.float64], q_step: float,
) -> NDArray[np.float64]:
    """Per-bin cap on the excess inside each shell's envelope support (∞ outside)."""
    out = np.full(q_grid.shape, np.inf)
    for c, w, cap in zip(centers, halfwidths, caps):
        inside = np.abs(q_grid - float(c)) <= 2.0 * max(float(w), q_step)
        out[inside] = np.minimum(out[inside], float(cap))
    return out


__all__ = ["PooledRingConfig", "PooledRingResult", "fit_pooled_rings"]
