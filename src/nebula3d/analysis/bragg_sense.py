# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The Bragg peaks' shapes, sensed before a run, and the punch settings they ask for.

The integer punch cuts each Bragg node to a footprint: its own measured width
(``punch_footprint="own"``, the default), the dataset's shared profile, or the
fitted ellipsoid, which the covariance fit tilts to follow the peak and, unless
``integer_fit_unconstrained``, floors at the resolution ellipsoid and caps at
``max_radius_scale`` times it. Which footprint leaves least of the peaks
depends on their shape: a doublet, a streak or a tilted peak leaves its excess
at the rim of an axis-aligned hole, and peaks that broaden with |Q| outgrow any
fixed reach.

:func:`sense_bragg` reads a few principal sections of the raw volume (0kl, h0l
and hk0 through 0 and 1, as the run loads it), takes the strong nodes on them,
and measures each peak in two dimensions: its tilt and elongation (the moments
of its core, as the punch's fit takes them), its lobes, its width, whether the
fit's cap binds, and the share of its excess each footprint would leave
(modelled with the run's own punch settings). Seconds on a large volume. It
punches nothing and writes nothing.

The rule (:func:`_prediction`): its limits are set conservatively (see THY-43)
and named with each number they compare:

- dropping the fit's constraints is worth it when the cap binds on
  ``CAP_SHARE`` of the peaks and unconstrained leaves less (``DROP_GAIN`` of
  the median, or ``DROP_RES_GAIN`` fewer peaks with a ``RES_SIGMA``σ
  residual), punching at most ``DROP_AREA_MAX`` times what the constrained fit
  does;
- the fitted ellipsoid (unconstrained where that is worth it) instead of
  ``own`` when it leaves at least ``FOOTPRINT_GAIN`` less of the median peak,
  or no more when ``SHAPE_SHARE`` of the peaks are tilted and elongated or
  have more than one lobe, punching at most ``AREA_MAX`` times what ``own``
  does: never a footprint that leaves more than the default;
- a |Q|-dependent reach flagged when what ``own`` leaves rises by
  ``QDEP_RISE`` from the lowest |Q| quarter of the peaks to the highest and
  reaches ``QDEP_HIGH`` there: no footprint setting follows it, so it is
  said, not set;
- a symmetry asked to be declared when the file declares none and every axis
  mirror maps each section onto itself to ``MIRROR_EXACT`` of its spread (the
  data were symmetrised already: unsymmetrised data's mirrors differ by their
  counting noise), on an orthorhombic cell, where mmm is the class they make;
  on a cell that takes a higher one, compare_laue_classes tells them apart.

:func:`sense_lines` gives NEBULA Pilot the few lines it reads.
"""

from __future__ import annotations

import math
import time
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume

if TYPE_CHECKING:
    from nebula3d.pipeline import PunchParams

__all__ = [
    "AREA_MAX",
    "CAP_SHARE",
    "CUTS",
    "DROP_AREA_MAX",
    "DROP_GAIN",
    "DROP_RES_GAIN",
    "FOOTPRINT_GAIN",
    "MIRROR_EXACT",
    "QDEP_HIGH",
    "QDEP_RISE",
    "SHAPE_SHARE",
    "VERSION",
    "Z_MIN",
    "sense_bragg",
    "sense_lines",
]

#: The record's version.
VERSION = 1
#: The principal sections read: (plane, the cut along its fixed axis, r.l.u.).
CUTS: tuple[tuple[str, float], ...] = (
    ("0kl", 0.0),
    ("h0l", 0.0),
    ("hk0", 0.0),
    ("0kl", 1.0),
    ("h0l", 1.0),
    ("hk0", 1.0),
)
#: (x, y, fixed) axes of each plane, as indices into H K L.
_AXES = {"0kl": (1, 2, 0), "h0l": (0, 2, 1), "hk0": (0, 1, 2)}

# --- which nodes are read
#: A node's peak must clear its background ring by this many robust σ: only
#: strong peaks show their shape above the noise.
Z_MIN = 30.0
#: Nodes below this |Q| (Å⁻¹) are the direct beam's neighbourhood.
Q_MIN = 1.0
#: The share of a node's window that must be measured.
WINDOW_MEASURED = 0.95
#: The background ring about a node, |ΔQ| in Å⁻¹ (past the punch's reach).
BG_RING = (0.30, 0.42)
#: Where a node's peak may sit, |ΔQ| ≤ this from the node (Å⁻¹).
PEAK_NEAR = 0.12
#: The disk a footprint is judged over: the peak and its tails (Å⁻¹).
CORE_DISK = 0.30
#: A lobe: a local maximum within this |ΔQ| of the node (Å⁻¹, the punch
#: check's Bragg reach) of at least LOBE_FRACTION of the peak.
LOBE_REACH = 0.25
LOBE_FRACTION = 0.25
#: Tilted: the core's long axis this far (degrees) off the section's axes, and
#: elongated: its long axis this many times its short one.
TILT_DEG = 15.0
ELONGATED = 1.5
#: A residual this many σ above the background counts as a peak left.
RES_SIGMA = 8.0
#: The share of the strongest nodes per plane whose widths are the plane's reference.
REF_STRONGEST = 40

# --- the rule (set conservatively; see THY-43)
#: The ellipsoid's gain in the median left-over share (2 points), or
FOOTPRINT_GAIN = 0.02
#: the share of peaks tilted-and-elongated plus those with several lobes,
SHAPE_SHARE = 0.30
#: at most this many times the area ``own`` punches.
AREA_MAX = 1.6
#: Drop the constraints when the cap binds on this share of the peaks,
CAP_SHARE = 0.25
#: and unconstrained leaves this much less (median share), or
DROP_GAIN = 0.005
#: this share fewer peaks with a RES_SIGMA residual,
DROP_RES_GAIN = 0.05
#: punching at most this many times the constrained fit's area.
DROP_AREA_MAX = 1.25
#: |Q|-dependent reach: own's median left-over share rises this much from the
#: lowest |Q| quarter of the strong peaks to the highest,
QDEP_RISE = 0.03
#: and reaches at least this there.
QDEP_HIGH = 0.10
#: The mirrors hold "exactly" (the data symmetrised already) when the median
#: |difference| they make is at most this share of a section's robust spread.
MIRROR_EXACT = 1e-3
#: The sensed peaks kept for the Highlights, strongest first.
HIGHLIGHTS_MAX = 60
#: The |Q| bins of the left-over share (Å⁻¹).
_Q_BINS = ((0.0, 3.0), (3.0, 5.0), (5.0, 7.0), (7.0, 9.0), (9.0, 14.0))
#: The footprints compared.
FOOTPRINTS = ("own", "ellipsoid", "ellipsoid_unc")


def _section(
    vol: HKLVolume, plane: str, value: float
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], float] | None:
    """The plane nearest *value* (rows y, columns x), masked voxels NaN, and
    where it lies; None outside the grid."""
    ax, ay, af = _AXES[plane]
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    fixed = np.asarray(axes[af], dtype=float)
    step = abs(float(fixed[1] - fixed[0])) if fixed.size > 1 else 1.0
    i = int(np.argmin(np.abs(fixed - value)))
    if abs(float(fixed[i]) - value) > 0.5 * step + 1e-9:
        return None
    index: list[Any] = [slice(None)] * 3
    index[af] = i
    data = np.asarray(vol.data[tuple(index)], dtype=np.float64)
    mask = np.asarray(vol.mask[tuple(index)], dtype=bool)
    a = np.where(mask & np.isfinite(data), data, np.nan)
    # The remaining axes are (ax, ay) in H K L order: rows y, columns x.
    return (
        a.T,
        np.asarray(axes[ax], dtype=float),
        np.asarray(axes[ay], dtype=float),
        float(fixed[i]),
    )


def _core_kappa(frac: float) -> float:
    """The variance a 2-D Gaussian keeps when cut at *frac* of its peak, over its own."""
    from scipy.special import gammainc

    x = -math.log(max(min(frac, 1.0 - 1e-12), 1e-12))
    return float(gammainc(2.0, x) / gammainc(1.0, x))


def _line_fwhm(w: NDArray[np.float64], iy: int, ix: int, dy: int, dx: int, n: int = 5) -> float:
    """FWHM (voxels) of the line through (iy, ix) along (dy, dx), its ends as
    the base; NaN unmeasured."""
    pts = []
    for k in range(-n, n + 1):
        y, x = iy + k * dy, ix + k * dx
        pts.append(w[y, x] if 0 <= y < w.shape[0] and 0 <= x < w.shape[1] else np.nan)
    line = np.asarray(pts)
    if not (np.isfinite(line[0]) and np.isfinite(line[-1]) and np.isfinite(line[n])):
        return float("nan")
    base, top = 0.5 * (line[0] + line[-1]), line[n]
    if not top > base:
        return float("nan")
    half = base + 0.5 * (top - base)
    lo = n
    while lo > 0 and np.isfinite(line[lo - 1]) and line[lo - 1] > half:
        lo -= 1
    hi = n
    while hi < 2 * n and np.isfinite(line[hi + 1]) and line[hi + 1] > half:
        hi += 1
    left = (
        lo - 1 + (half - line[lo - 1]) / (line[lo] - line[lo - 1])
        if lo > 0 and line[lo] > line[lo - 1]
        else lo - 0.5
    )
    right = (
        hi + (line[hi] - half) / (line[hi] - line[hi + 1])
        if hi < 2 * n and line[hi] > line[hi + 1]
        else hi + 0.5
    )
    return float(right - left)


def _inside(radius: NDArray[np.float64], d: NDArray[np.float64]) -> NDArray[np.bool_]:
    """Whether each offset of *d* (…, 2) lies in the ellipse ``xᵀ radius⁻¹ x ≤ 1``."""
    inv = np.linalg.inv(radius)
    return np.einsum("...i,ij,...j->...", d, inv, d) <= 1.0


def _frame_floor(
    vol: HKLVolume, node: NDArray[np.float64], basis: NDArray[np.float64], radii: Sequence[float]
) -> NDArray[np.float64] | None:
    """The resolution ellipsoid's section by the plane (radius matrix, plane Q), at *node*."""
    from nebula3d.analysis.bragg import BraggRemover

    frame = BraggRemover._spherical_frame(vol, (float(node[0]), float(node[1]), float(node[2])))
    if frame is None:
        return None
    shape = sum(np.outer(v, v) / float(r) ** 2 for v, r in zip(frame, radii))
    return np.asarray(np.linalg.inv(basis.T @ shape @ basis), dtype=np.float64)


def _peaks(
    vol: HKLVolume, punch: PunchParams, cuts: Sequence[tuple[str, float]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The strong nodes on each section, measured; and the sections read."""
    from scipy import ndimage
    from scipy.linalg import eigh

    from nebula3d.analysis.bragg import _clip_ellipsoid

    ub = np.asarray(vol.ub_matrix, dtype=float)
    radii = tuple(punch.punch_spherical_radii or (0.097, 0.072, 0.115))
    cap2 = float(punch.max_radius_scale) ** 2
    frac = float(punch.integer_fit_threshold_frac)
    kappa = _core_kappa(frac)
    nsig = float(punch.integer_fit_radius_n_sigma)
    cell = tuple(int(c) for c in getattr(punch, "supercell", (1, 1, 1)))
    peaks: list[dict[str, Any]] = []
    read: list[dict[str, Any]] = []
    for plane, cut in cuts:
        sec = _section(vol, plane, cut)
        if sec is None:
            continue
        a, xa, ya, at = sec
        ax, ay, af = _AXES[plane]
        read.append({"plane": plane, "cut": round(at, 4)})
        # The nodes lie at the cut asked for; the plane read is the grid's
        # nearest, within half a voxel.
        at = float(cut)
        if xa.size < 3 or ya.size < 3:
            continue
        sx, sy = float(xa[1] - xa[0]), float(ya[1] - ya[0])
        pm = ub[:, [ax, ay]]
        basis, _ = np.linalg.qr(pm)
        m = basis.T @ pm  # r.l.u. offsets (dx, dy) -> plane Q
        qx, qy = (
            float(np.linalg.norm(ub[:, ax])) * abs(sx),
            float(np.linalg.norm(ub[:, ay])) * abs(sy),
        )
        read[-1]["voxel_q"] = round(max(qx, qy), 4)
        # A voxel wider than the resolution ellipsoid's largest radius cannot
        # show a peak's shape, nor a footprint's edge.
        if max(qx, qy) > max(radii):
            continue
        hx, hy = int(math.ceil(BG_RING[1] / qx)) + 1, int(math.ceil(BG_RING[1] / qy)) + 1
        gx, gy = np.meshgrid(np.arange(-hx, hx + 1) * sx, np.arange(-hy, hy + 1) * sy)
        dq = np.stack([gx, gy], -1) @ m.T
        d = np.linalg.norm(dq, axis=-1)
        ring = (d >= BG_RING[0]) & (d <= BG_RING[1])
        near = d <= PEAK_NEAR
        lobe_zone = d <= LOBE_REACH
        lo_x, hi_x = sorted((float(xa[0]), float(xa[-1])))
        lo_y, hi_y = sorted((float(ya[0]), float(ya[-1])))
        # The nodes of the punch's parent lattice on this section.
        if abs(at / cell[af] - round(at / cell[af])) > 1e-6:
            continue
        for nx in range(
            math.ceil(lo_x / cell[ax]) * cell[ax],
            math.floor(hi_x / cell[ax]) * cell[ax] + 1,
            cell[ax],
        ):
            for ny in range(
                math.ceil(lo_y / cell[ay]) * cell[ay],
                math.floor(hi_y / cell[ay]) * cell[ay] + 1,
                cell[ay],
            ):
                hkl = np.zeros(3)
                hkl[ax], hkl[ay], hkl[af] = nx, ny, at
                q = float(np.linalg.norm(ub @ hkl))
                if q < Q_MIN:
                    continue
                ix, iy = int(np.argmin(np.abs(xa - nx))), int(np.argmin(np.abs(ya - ny)))
                if iy - hy < 0 or ix - hx < 0 or iy + hy >= a.shape[0] or ix + hx >= a.shape[1]:
                    continue
                w = a[iy - hy : iy + hy + 1, ix - hx : ix + hx + 1]
                fin = np.isfinite(w)
                if fin.mean() < WINDOW_MEASURED or not (fin & ring).sum() >= 8:
                    continue
                bgv = w[fin & ring]
                bg = float(np.median(bgv))
                noise = float(1.4826 * np.median(np.abs(bgv - bg)))
                if not noise > 0 or not (fin & near).any():
                    continue
                j = int(np.argmax(np.where(fin & near, w, -np.inf)))
                py, px = (int(c) for c in np.unravel_index(j, w.shape))
                amp = float(w[py, px] - bg)
                if amp / noise < Z_MIN:
                    continue
                # A peak of its own, not a neighbour's tail reaching the node's disk.
                if not w[py, px] >= np.nanmax(w[py - 1 : py + 2, px - 1 : px + 2]):
                    continue
                ex = np.where(fin, w - bg, 0.0)
                lab, _ = ndimage.label(ex >= frac * amp, structure=np.ones((3, 3)))
                core = lab == lab[py, px]
                wt = np.where(core, ex, 0.0)
                wsum = float(wt.sum())
                cx, cy = float((wt * gx).sum() / wsum), float((wt * gy).sum() / wsum)
                cov = (
                    np.cov(np.vstack([gx[core] - cx, gy[core] - cy]), aweights=wt[core], bias=True)
                    / kappa
                )
                sq = m @ cov @ m.T
                lam, u = np.linalg.eigh(sq)
                pad = 0.5 * np.sqrt(((u.T @ (m * np.array([sx, sy]))) ** 2).sum(axis=1))
                r = nsig * np.sqrt(np.clip(lam, 0.0, None)) + pad
                unc = (u * r**2) @ u.T
                floor = _frame_floor(vol, hkl, basis, radii)
                if floor is None:
                    continue
                con = _clip_ellipsoid(
                    _clip_ellipsoid(unc, cap2 * floor, upper=True), floor, upper=False
                )
                # The fit reaches past its cap on some axis: the generalized
                # eigenvalues of (unc, cap) above 1.
                cap_binds = bool(np.max(eigh(unc, cap2 * floor, eigvals_only=True)) > 1.0 + 1e-9)
                fw = (_line_fwhm(w, py, px, 0, 1) * abs(sx), _line_fwhm(w, py, px, 1, 0) * abs(sy))
                dc = np.stack([gx - cx, gy - cy], -1) @ m.T
                lobes = int(
                    (
                        (ex == ndimage.maximum_filter(ex, size=3))
                        & (ex >= LOBE_FRACTION * amp)
                        & lobe_zone
                    ).sum()
                )
                # A core of a voxel or two is unresolved on this grid: its
                # footprints are compared, its shape is not measured.
                resolved = int(core.sum()) >= 3 and float(lam[0]) > 1e-12 * max(
                    float(lam[1]), 1e-300
                )
                elong = float(math.sqrt(lam[1] / lam[0])) if resolved else 1.0
                major = u[:, 1]
                ang = math.degrees(math.atan2(abs(major[1]), abs(major[0]))) if resolved else 0.0
                peaks.append(
                    {
                        "plane": plane,
                        "cut": at,
                        "hkl": [float(c) for c in hkl],
                        "q": q,
                        "amp": amp,
                        "z": amp / noise,
                        "noise": noise,
                        "bg": bg,
                        "w": w,
                        "ex": ex,
                        "dc": dc,
                        "gx": gx - cx,
                        "gy": gy - cy,
                        "fw": fw,
                        "unc": unc,
                        "con": con,
                        "lobes": lobes,
                        "elong": elong,
                        "tilt": min(ang, 90.0 - ang),
                        "cap_binds": cap_binds,
                        "resolved": resolved,
                        "qper": (
                            float(np.linalg.norm(ub[:, ax])),
                            float(np.linalg.norm(ub[:, ay])),
                        ),
                        "centre": (cx, cy),
                        "m": m,
                        "step": (abs(sx), abs(sy)),
                        # The resolution section's half extent along x and y (r.l.u.):
                        # the own footprint's width where none is measured.
                        "floor_w": (
                            math.sqrt(floor[0, 0]) / float(np.linalg.norm(ub[:, ax])),
                            math.sqrt(floor[1, 1]) / float(np.linalg.norm(ub[:, ay])),
                        ),
                    }
                )
    return peaks, read


def _left(p: dict[str, Any], hole: NDArray[np.bool_]) -> tuple[float, float, int]:
    """What a footprint leaves of a peak: the share of its excess in the core
    disk, the largest residual (σ), its area (voxels)."""
    core = (np.linalg.norm(p["dc"], axis=-1) <= CORE_DISK) & np.isfinite(p["w"])
    e = np.clip(p["ex"], 0.0, None)
    left = core & ~hole
    share = float(e[left].sum() / max(float(e[core].sum()), 1e-12))
    worst = float((p["w"][left].max() - p["bg"]) / p["noise"]) if left.any() else 0.0
    return share, worst, int(hole.sum())


def _footprints(
    peaks: list[dict[str, Any]], punch: PunchParams
) -> dict[str, list[tuple[float, float, float, int]]]:
    """Each footprint's (|Q|, share left, worst residual σ, area) on every
    peak, with the run's punch settings."""
    margin = float(punch.margin)
    scale_max = float(punch.max_radius_scale)
    level_n = float(punch.profile_n_sigma)
    cap_q = float(punch.profile_max_radius_q)
    ref: dict[str, NDArray[np.float64]] = {}
    for plane in _AXES:
        strong = sorted((p for p in peaks if p["plane"] == plane), key=lambda p: -p["amp"])[
            :REF_STRONGEST
        ]
        fws = np.array([p["fw"] for p in strong], dtype=float)
        if len(strong) >= 5 and np.isfinite(fws).any(axis=0).all():
            ref[plane] = np.nanmedian(fws, axis=0)
    iref = float(np.median([p["amp"] for p in peaks])) if peaks else 1.0
    out: dict[str, list[tuple[float, float, float, int]]] = {f: [] for f in FOOTPRINTS}
    for p in peaks:
        qper = np.array(p["qper"])
        fw = np.array(p["fw"], dtype=float)
        if np.all(np.isfinite(fw)):
            # As the punch: the line-cut FWHM, at least the plane's reference
            # width (the strongest peaks', at least half a voxel), as a Gaussian
            # punched to profile_n_sigma × the noise, at least half its width,
            # capped at profile_max_radius_q, plus the margin.
            width = np.maximum(
                fw,
                np.maximum(
                    np.nan_to_num(ref.get(p["plane"], np.zeros(2)), nan=0.0),
                    0.5 * np.array(p["step"]),
                ),
            )
            sig = width / 2.3548
            level = level_n * p["noise"]
            reach = (
                sig * math.sqrt(2.0 * math.log(p["amp"] / level))
                if p["amp"] > level
                else 0.5 * width
            )
            rad = (
                np.minimum(np.maximum(reach, 0.5 * width), np.maximum(cap_q / qper, 0.5 * width))
                + margin / qper
            )
        else:
            # A width it cannot measure: the profile footprint, floored at the resolution.
            rad = np.array(p["floor_w"]) + margin / qper
        rad = np.maximum(rad, 1e-9)
        own = (p["gx"] / rad[0]) ** 2 + (p["gy"] / rad[1]) ** 2 <= 1.0
        out["own"].append((p["q"], *_left(p, own)))
        s = float(np.clip((p["amp"] / iref) ** (1.0 / 3.0), 1.0, scale_max))
        for name, mr in (("ellipsoid", p["con"]), ("ellipsoid_unc", p["unc"])):
            lam, u = np.linalg.eigh(mr)
            r = np.sqrt(np.clip(lam, 0.0, None)) * s + margin
            out[name].append((p["q"], *_left(p, _inside((u * r**2) @ u.T, p["dc"]))))
    return out


def _summary(rows: list[tuple[float, float, float, int]]) -> dict[str, Any]:
    a = np.array(rows, dtype=float)
    q, left, worst, area = a[:, 0], a[:, 1], a[:, 2], a[:, 3]
    by_q: dict[str, float | None] = {}
    for lo, hi in _Q_BINS:
        sel = (q >= lo) & (q < hi)
        by_q[f"{lo:g}-{hi:g}"] = float(np.median(left[sel])) if sel.sum() >= 5 else None
    slope = float(np.polyfit(q, left, 1)[0]) if len(q) >= 3 and np.ptp(q) > 0 else 0.0
    high = q >= np.quantile(q, 0.75) if len(q) >= 8 else np.zeros_like(q, dtype=bool)
    low = q <= np.quantile(q, 0.25) if len(q) >= 8 else np.zeros_like(q, dtype=bool)
    return {
        "median_left": float(np.median(left)),
        "share_residual": float((worst > RES_SIGMA).mean()),
        "mean_area": float(area.mean()),
        "left_by_q": by_q,
        "left_slope_per_q": slope,
        "left_high_q": float(np.median(left[high])) if high.any() else None,
        "left_low_q": float(np.median(left[low])) if low.any() else None,
    }


def _width_trend(peaks: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The peaks' width (geometric mean of the in-plane FWHMs, Å⁻¹) in the
    lowest and highest |Q| quarters."""
    rows = []
    for p in peaks:
        fw = np.array(p["fw"], dtype=float) * np.array(p["qper"])
        if np.all(np.isfinite(fw)) and np.all(fw > 0):
            rows.append((p["q"], float(np.sqrt(fw[0] * fw[1]))))
    if len(rows) < 8:
        return None
    a = np.array(rows)
    lo_q, hi_q = np.quantile(a[:, 0], [0.25, 0.75])
    low, high = a[a[:, 0] <= lo_q], a[a[:, 0] >= hi_q]
    w_lo, w_hi = float(np.median(low[:, 1])), float(np.median(high[:, 1]))
    return {
        "low": [round(float(np.median(low[:, 0])), 2), round(w_lo, 4)],
        "high": [round(float(np.median(high[:, 0])), 2), round(w_hi, 4)],
        "ratio": round(w_hi / w_lo, 2) if w_lo > 0 else None,
    }


def _prediction(summary: dict[str, dict[str, Any]], evidence: dict[str, Any]) -> dict[str, Any]:
    """The rule: the footprint, the fit's constraints and the |Q| flag, each
    with the numbers it compared.

    The constraints are weighed first: dropping them is worth it when the cap
    binds on CAP_SHARE of the peaks and the unconstrained fit leaves less
    without punching DROP_AREA_MAX times more than the constrained one. The
    ellipsoid is then judged as it would run (unconstrained where dropping is
    worth it): it must leave FOOTPRINT_GAIN less than own, or, on peaks
    SHAPE_SHARE of which are tilted or have several lobes, no more than own;
    and punch at most AREA_MAX times own's area. Never a footprint that leaves
    more of the peaks than the default.
    """
    own, ell, unc = summary["own"], summary["ellipsoid"], summary["ellipsoid_unc"]
    shape = evidence["multi_lobe_share"] + evidence["tilted_elongated_share"]
    drop_gain = ell["median_left"] - unc["median_left"]
    res_gain = ell["share_residual"] - unc["share_residual"]
    drop_area = unc["mean_area"] / max(ell["mean_area"], 1e-12)
    drop_ok = bool(
        evidence["cap_binds_share"] >= CAP_SHARE
        and (drop_gain >= DROP_GAIN or res_gain >= DROP_RES_GAIN)
        and drop_area <= DROP_AREA_MAX
    )
    best = unc if drop_ok else ell
    gain = own["median_left"] - best["median_left"]
    area = best["mean_area"] / max(own["mean_area"], 1e-12)
    footprint = (
        "ellipsoid"
        if (gain >= FOOTPRINT_GAIN or (shape >= SHAPE_SHARE and gain >= 0.0)) and area <= AREA_MAX
        else "own"
    )
    drop = bool(footprint == "ellipsoid" and drop_ok)
    high, low = own["left_high_q"], own["left_low_q"]
    rise = high - low if high is not None and low is not None else 0.0
    qdep = bool(rise >= QDEP_RISE and high is not None and high >= QDEP_HIGH)
    return {
        "footprint": footprint,
        "drop_fit_constraints": drop,
        "q_dependent_reach": qdep,
        "compared": {
            "ellipsoid_gain": round(gain, 4),
            "shape_share": round(shape, 3),
            "ellipsoid_area": round(area, 2),
            "cap_binds_share": round(evidence["cap_binds_share"], 3),
            "drop_gain": round(drop_gain, 4),
            "drop_residual_gain": round(res_gain, 3),
            "drop_area": round(drop_area, 2),
            "own_rise": round(rise, 3),
            "own_high_q": None if high is None else round(high, 3),
        },
    }


def _mirrors(vol: HKLVolume, cuts: Sequence[tuple[str, float]]) -> dict[str, Any]:
    """How far each section's in-plane axis mirrors (x → −x, y → −y) move it: the
    median |difference| over the section's robust spread (1.4826·MAD), the worst
    of every mirror tested. Data symmetrised already differ by rounding (0 on
    the synthetic tests' symmetrised volumes); unsymmetrised ones by their
    counting noise (0.13 to 0.18 on the synthetic dev cases)."""
    worst = 0.0
    tested = 0
    for plane, cut in cuts:
        sec = _section(vol, plane, cut)
        if sec is None:
            continue
        a, xa, ya, _ = sec
        for axis, coords in ((1, xa), (0, ya)):
            if coords.size < 3:
                continue
            # The voxels whose mirror image is on the grid.
            idx = np.array([int(np.argmin(np.abs(coords + c))) for c in coords])
            ok = np.abs(coords[idx] + coords) <= 0.25 * abs(float(coords[1] - coords[0]))
            keep = np.nonzero(ok)[0]
            if keep.size < 3:
                continue
            img = np.take(a, idx[keep], axis=axis)
            own = np.take(a, keep, axis=axis)
            both = np.isfinite(img) & np.isfinite(own)
            if both.sum() < 100:
                continue
            vals = own[both]
            spread = float(1.4826 * np.median(np.abs(vals - np.median(vals))))
            if not spread > 0:
                continue
            worst = max(worst, float(np.median(np.abs(img[both] - vals))) / spread)
            tested += 1
    return {"tested": tested, "worst_share": worst}


_SWAPS = (
    ((0, 1, 0), (1, 0, 0), (0, 0, 1)),
    ((1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((0, 0, 1), (0, 1, 0), (1, 0, 0)),
)


def _declarable(vol: HKLVolume) -> str | None:
    """The class the axis mirrors make, when the cell takes no higher one: mmm on
    an orthorhombic metric (mmm a symmetry of the lattice, by the symmetry
    average's own METRIC_TOLERANCE, and no swap of two axes one); else None,
    for compare_laue_classes to tell apart."""
    from nebula3d.symmetry import METRIC_TOLERANCE, laue_group, metric_change

    ub = np.asarray(vol.ub_matrix, dtype=float)
    if metric_change(laue_group("mmm").ops, ub) > METRIC_TOLERANCE:
        return None
    if any(metric_change([np.array(m)], ub) <= METRIC_TOLERANCE for m in _SWAPS):
        return None
    return "mmm"


def sense_bragg(
    vol: HKLVolume, punch: PunchParams, *, declared: bool, cuts: Sequence[tuple[str, float]] = CUTS
) -> dict[str, Any]:
    """The Bragg peaks' shapes on a few raw sections, and the settings they ask for.

    *vol* is the raw volume as the run loads it; *punch* the run's
    :class:`~nebula3d.pipeline.PunchParams` (its resolution radii, margin, caps
    and fit settings model each footprint); *declared* whether the file
    declares the symmetry its data were symmetrised with. Returns the record:
    the sections read, the evidence, each footprint's summary, the |Q| trend of
    the widths, the prediction (the rule, with the numbers it compared), the
    mirrors, and the strongest flagged peaks for the Highlights.
    """
    t0 = time.perf_counter()
    peaks, read = _peaks(vol, punch, cuts)
    # Every field, filled as far as the sensing judged.
    record: dict[str, Any] = {"version": VERSION, "sections": read, "n_nodes": len(peaks),
                              "not_judged": None, "evidence": None, "footprints": None,
                              "width_q": None, "prediction": None, "flagged": []}
    mirrors = _mirrors(vol, cuts)
    symmetrised = bool(mirrors["tested"] >= 3 and mirrors["worst_share"] <= MIRROR_EXACT)
    record["mirrors"] = {
        **mirrors,
        "worst_share": float(f"{mirrors['worst_share']:.3g}"),
        "exact": symmetrised,
        "declared": bool(declared),
        "declare": _declarable(vol) if symmetrised and not declared else None,
    }
    coarse = [r["voxel_q"] for r in read if "voxel_q" in r]
    if coarse and min(coarse) > max(punch.punch_spherical_radii or (0.115,)):
        record["not_judged"] = (
            f"grid too coarse: a voxel spans {min(coarse):.3g} Å⁻¹, past the resolution "
            f"ellipsoid's largest radius ({max(punch.punch_spherical_radii or (0.115,)):g} Å⁻¹)"
        )
        record["seconds"] = round(time.perf_counter() - t0, 2)
        return record
    if len(peaks) < 8:
        record["not_judged"] = (
            f"{len(peaks)} strong nodes (z ≥ {Z_MIN:g}) on the sections read: too few to "
            "judge the peaks' shape"
        )
        record["seconds"] = round(time.perf_counter() - t0, 2)
        return record
    tilted = [(p["tilt"] >= TILT_DEG) and (p["elong"] >= ELONGATED) for p in peaks]
    multi = [p["lobes"] >= 2 for p in peaks]
    evidence = {
        "tilted_elongated_share": float(np.mean(tilted)),
        "multi_lobe_share": float(np.mean(multi)),
        "cap_binds_share": float(np.mean([p["cap_binds"] for p in peaks])),
        "median_elongation": float(np.median([p["elong"] for p in peaks])),
        "resolved_share": float(np.mean([p["resolved"] for p in peaks])),
    }
    rows = _footprints(peaks, punch)
    summary = {name: _summary(r) for name, r in rows.items()}
    area0 = summary["own"]["mean_area"]
    for name in summary:
        summary[name]["area_vs_own"] = summary[name]["mean_area"] / max(area0, 1e-12)
    record.update(
        evidence={k: round(v, 3) for k, v in evidence.items()},
        footprints={
            name: {
                "median_left": round(s["median_left"], 4),
                "share_residual": round(s["share_residual"], 3),
                "area_vs_own": round(s["area_vs_own"], 2),
                "left_by_q": {
                    k: (None if v is None else round(v, 4)) for k, v in s["left_by_q"].items()
                },
                "left_low_q": None if s["left_low_q"] is None else round(s["left_low_q"], 4),
                "left_high_q": None if s["left_high_q"] is None else round(s["left_high_q"], 4),
            }
            for name, s in summary.items()
        },
        width_q=_width_trend(peaks),
        prediction=_prediction(summary, evidence),
    )
    flagged = []
    for p, t, mu in sorted(zip(peaks, tilted, multi), key=lambda x: -x[0]["z"]):
        if not (t or mu):
            continue
        # The unconstrained fit's ellipse in the section's r.l.u.: its principal
        # widths and directions there (orthonormal in H K L components), the
        # cut's own axis a voxel thin, as a fitted Bragg footprint is drawn.
        minv = np.linalg.inv(p["m"])
        lam, u = np.linalg.eigh(minv @ p["unc"] @ minv.T)
        ax, ay, af = _AXES[p["plane"]]
        dirs, widths = [], []
        for k in (1, 0):  # the long axis first
            v3 = [0.0, 0.0, 0.0]
            v3[ax], v3[ay] = float(u[0, k]), float(u[1, k])
            dirs.append([round(c, 4) for c in v3])
            widths.append(round(math.sqrt(max(float(lam[k]), 0.0)), 4))
        thin = [0.0, 0.0, 0.0]
        thin[af] = 1.0
        dirs.append(thin)
        widths.append(round(min(p["step"]), 4))
        hkl = list(p["hkl"])
        hkl[ax] += p["centre"][0]
        hkl[ay] += p["centre"][1]
        flagged.append(
            {
                "plane": p["plane"],
                "cut": p["cut"],
                "hkl": [round(c, 4) for c in hkl],
                "tilted": bool(t),
                "lobes": int(p["lobes"]),
                "elongation": round(p["elong"], 2),
                "tilt_deg": round(p["tilt"], 1),
                "z": round(p["z"]),
                "dirs": dirs,
                "widths": widths,
            }
        )
        if len(flagged) >= HIGHLIGHTS_MAX:
            break
    record["flagged"] = flagged
    record["seconds"] = round(time.perf_counter() - t0, 2)
    return record


def _pct(x: float | None) -> str:
    return "–" if x is None else f"{100 * x:.1f} %"


def sense_lines(record: dict[str, Any]) -> dict[str, str]:
    """The record as NEBULA Pilot reads it: a few short lines, each with the numbers it rests on."""
    lines: dict[str, str] = {}
    mir = record.get("mirrors") or {}
    if mir.get("declare"):
        lines["symmetry"] = (
            f"declares none, yet every axis mirror holds to {mir['worst_share']:.1e} of the "
            f"spread: symmetrised already; declaring {mir['declare']} is the user's"
        )
    elif mir.get("exact") and not mir.get("declared"):
        lines["symmetry"] = (
            "declares none, yet every axis mirror holds: symmetrised already; the cell admits a "
            "higher class than mmm: compare_laue_classes"
        )
    if record.get("not_judged"):
        lines["shape"] = str(record["not_judged"])
        return lines
    ev, fp, pr = record["evidence"], record["footprints"], record["prediction"]
    c = pr["compared"]
    lines["shape"] = (
        f"{record['n_nodes']} strong nodes on {len(record['sections'])} sections: "
        f"{_pct(ev['tilted_elongated_share'])} tilted and elongated, "
        f"{_pct(ev['multi_lobe_share'])} with several lobes; the fit's cap binds on "
        f"{_pct(ev['cap_binds_share'])}"
    )
    lines["left"] = "median share each footprint leaves: " + ", ".join(
        f"{name} {_pct(fp[name]['median_left'])}"
        + ("" if name == "own" else f" ({fp[name]['area_vs_own']:g}× own's area)")
        for name in FOOTPRINTS
    )
    unc = " unconstrained" if pr["drop_fit_constraints"] else ""
    lines["footprint"] = (
        f"punchFootprint {pr['footprint']}" + ("" if pr["footprint"] != "own" else " (keep)")
        + f": the ellipsoid{unc} leaves {abs(100 * c['ellipsoid_gain']):.1f} points "
        f"{'less' if c['ellipsoid_gain'] >= 0 else 'more'} than own; "
        f"tilted + lobed {_pct(c['shape_share'])}; {c['ellipsoid_area']:g}× own's area"
    )
    if pr["footprint"] == "ellipsoid":
        keep = "true" if pr["drop_fit_constraints"] else "false (keep)"
        lines["constraints"] = (
            f"punchFitUnconstrained {keep}: the cap binds on {_pct(c['cap_binds_share'])}; "
            f"unconstrained leaves {abs(100 * c['drop_gain']):.1f} points "
            f"{'less' if c['drop_gain'] >= 0 else 'more'}, "
            f"{c['drop_area']:g}× the constrained area"
        )
    wq = record.get("width_q")
    own = fp["own"]
    if pr["q_dependent_reach"]:
        lines["q"] = (
            f"own leaves {_pct(own['left_low_q'])} in the lowest |Q| quarter, "
            f"{_pct(own['left_high_q'])} in the highest"
            + (f" (core FWHM {wq['low'][1]:g} → {wq['high'][1]:g} Å⁻¹)" if wq else "")
            + ": a reach growing with |Q|, which no setting follows"
        )
    return lines
