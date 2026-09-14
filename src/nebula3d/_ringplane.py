# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Per-plane ring-removal core, shared by every execution backend.

This module holds the *pure* per-plane unit of work (`_process_ring_plane`)
and the small pieces it needs — extracted verbatim from ``nebula3d.pipeline``
so that the in-browser ring workers (``nebula3d.ringworker``) can import it
without dragging in the whole pipeline/orchestration module, and so the native
process pool, the serial loop, and the browser worker pool all execute the
exact same code (bit-identical results by construction).

``nebula3d.pipeline`` re-imports every name below, so existing imports,
monkeypatching (``pipeline.RingParams`` …) and pickling keep working.
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass

import numpy as np

from nebula3d.core import HKLVolume
from nebula3d.preprocessing import (
    ParametricRingModel,
    PatchedRadialRingModel,
    azimuthal_sampling_mask,
)

__all__ = [
    "RingParams",
    "RingWorkerContext",
    "_SLICE_CONFIGS",
    "_PlaneResult",
    "_SliceConfig",
    "_assign_plane",
    "_build_ring_model",
    "_plane_slice_coords",
    "_process_ring_plane",
    "_slice_volume",
    "_take_plane",
]


@dataclass
class RingParams:
    """Powder-ring removal.

    ``ring_model='global_v2'`` is the sample-only, coordinate-independent 3D
    fitter. ``'patched'`` and ``'parametric'`` retain the legacy per-slice paths.
    """

    q_min: float = 1.5
    q_max: float = 10.5
    slice_axis: str = "H"          # H fits 0kl/KL slices; K → h0l; L → hk0
    profile_method: str = "median"
    n_fourier: int = 6
    n_patches: int = 36
    q_step: float = 0.02
    texture_q_smooth: float = 0.02
    texture_ridge: float = 0.08
    ring_amp_cap: float = 3.0       # per-shell amplitude ceiling × cross-stack norm
    confirm_rings: bool = True      # confirm real |Q| shells across the stack axis
    # "global_v2" (sample-only global 3D shells) | "patched" (legacy
    # non-parametric per-patch) | "parametric" (legacy separable Ring(|Q|) ×
    # per-shell Fourier texture).
    ring_model: str = "patched"
    ring_width: float = 0.24        # parametric: ring width / rolling window (Å⁻¹)
    ring_eta0: float = 0.5          # parametric peaks: initial pseudo-Voigt Lorentzian frac
    # parametric radial model: "rolling" (continuous Ring(|Q|), thick window swept
    # Qmin→Qmax) | "peaks" (discrete pseudo-Voigt rings)
    ring_radial_mode: str = "rolling"
    ring_roll_step: float = 0.04    # parametric rolling: |Q| spacing of window centres
    # Ring Removal 2.0: empty-scan-free global model. "auto" fits every
    # supported powder shell and labels FCC Al matches; "aluminum" keeps only
    # Al-matched shells; "generic" uses no material prior.
    global_material: str = "auto"
    global_subtraction: str = "conservative"  # conservative | mean | diagnose_only
    global_confidence_z: float = 1.0
    global_angular_lmax: int = 4
    global_min_snr: float = 5.0


@dataclass(frozen=True)
class _SliceConfig:
    axis_name: str
    axis_dim: int
    axis_attr: str
    plane: str


_SLICE_CONFIGS = {
    "H": _SliceConfig("H", 0, "h_axis", "0kl"),
    "K": _SliceConfig("K", 1, "k_axis", "h0l"),
    "L": _SliceConfig("L", 2, "l_axis", "hk0"),
}


def _slice_volume(v: HKLVolume, cfg: _SliceConfig, index: int) -> HKLVolume:
    """Return a 3D one-plane HKLVolume view along ``cfg.axis_dim``."""
    sl = [slice(None), slice(None), slice(None)]
    sl[cfg.axis_dim] = slice(index, index + 1)
    kwargs = {
        "data": v.data[tuple(sl)],
        "sigma": v.sigma[tuple(sl)],
        "mask": v.mask[tuple(sl)],
        cfg.axis_attr: getattr(v, cfg.axis_attr)[index:index + 1],
    }
    return dataclasses.replace(v, **kwargs)


def _take_plane(arr: np.ndarray, cfg: _SliceConfig, index: int) -> np.ndarray:
    return np.take(arr, index, axis=cfg.axis_dim)


def _assign_plane(dest: np.ndarray, cfg: _SliceConfig, index: int,
                  plane: np.ndarray) -> None:
    sl: list[slice | int] = [slice(None), slice(None), slice(None)]
    sl[cfg.axis_dim] = index
    dest[tuple(sl)] = plane


# A per-plane ring fit is independent of every other plane, so the stack is
# embarrassingly parallel.  The result tuple is
# ``(ip, data2d, mask2d, skipped, err)``.
_PlaneResult = tuple[int, np.ndarray, "np.ndarray | None", bool, "str | None"]


def _build_ring_model(
    p: RingParams,
    plane: str,
    ring_centers: np.ndarray | None,
    ring_halfwidths: np.ndarray | None,
    ring_ceilings: np.ndarray | None,
) -> PatchedRadialRingModel | ParametricRingModel:
    """Construct the configured ring model (shared by the driver and workers)."""
    if p.ring_model.strip().lower() == "parametric":
        return ParametricRingModel(
            plane=plane, q_step=p.q_step, n_fourier=p.n_fourier,
            profile_method=p.profile_method, texture_ridge=p.texture_ridge,
            ring_width=p.ring_width, eta0=p.ring_eta0,
            radial_mode=p.ring_radial_mode, roll_step=p.ring_roll_step,
            allowed_ring_centers=ring_centers,
            allowed_ring_halfwidths=ring_halfwidths,
            allowed_ring_ceilings=ring_ceilings,
        )
    return PatchedRadialRingModel(
        plane=plane, q_step=p.q_step, n_patches=p.n_patches, n_fourier=p.n_fourier,
        profile_method=p.profile_method, texture_q_smooth=p.texture_q_smooth,
        texture_ridge=p.texture_ridge, allowed_ring_centers=ring_centers,
        allowed_ring_halfwidths=ring_halfwidths, allowed_ring_ceilings=ring_ceilings,
    )


def _plane_slice_coords(
    q_full: np.ndarray | None, phi_full: np.ndarray | None, axis_dim: int, ip: int,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    # low-memory mode passes no precomputed grids — the model recomputes the
    # (cheap, 2-D) per-plane coordinates itself, bit-for-bit identically.
    if q_full is None or phi_full is None:
        return None, None
    sl: list[slice | int] = [slice(None), slice(None), slice(None)]
    sl[axis_dim] = slice(ip, ip + 1)
    return q_full[tuple(sl)], phi_full[tuple(sl)]


def _process_ring_plane(
    ip: int, vol: HKLVolume, cfg: _SliceConfig, p: RingParams, min_voxels: int,
    q_range: tuple[float, float], ring_centers: np.ndarray | None,
    ring_halfwidths: np.ndarray | None, ring_ceilings: np.ndarray | None,
    q_full: np.ndarray | None, phi_full: np.ndarray | None,
) -> _PlaneResult:
    """Fit + subtract powder rings on a single plane; return ``(ip, data2d,
    mask2d, skipped, err)``.  Pure and deterministic, so it gives identical
    output whether called in-process or in a pool worker.

    The per-plane model always computes in float64 (a plane is 2-D — the
    upcast is cheap) and the corrected plane is cast back to the volume's
    storage precision on return; both are no-ops on the float64 path.  This
    keeps the fits' robust statistics/solves at full precision in float32
    mode, and makes the native-f32 and browser-worker paths agree exactly
    (both compute the identical f64 plane, rounded once on store).
    """
    out_dtype = vol.data.dtype
    sl = _slice_volume(vol, cfg, ip)
    if out_dtype != np.float64:
        sl = dataclasses.replace(
            sl,
            data=sl.data.astype(np.float64),
            # sigma is proven inert for the ring output; a broadcast zero
            # avoids upcasting a full plane nobody reads.
            sigma=np.broadcast_to(np.float64(0.0), sl.data.shape),
        )
    valid = sl.mask & np.isfinite(sl.data)
    if int(valid.sum()) < min_voxels:
        return (ip, _take_plane(sl.data, cfg, 0).astype(out_dtype, copy=False),
                None, True, None)

    q_plane, phi_plane = _plane_slice_coords(q_full, phi_full, cfg.axis_dim, ip)
    keep = azimuthal_sampling_mask(sl, plane=cfg.plane, min_count_frac=0.25,
                                   q_range=q_range, q=q_plane, phi=phi_plane)
    src = dataclasses.replace(sl, mask=keep)
    out_mask_2d = _take_plane(keep, cfg, 0)

    model = _build_ring_model(p, cfg.plane, ring_centers, ring_halfwidths,
                              ring_ceilings)
    try:
        model.fit(src, q_range=q_range, q_mag=q_plane, phi=phi_plane)
        _, I_ring = model.subtract(src, q_mag=q_plane, phi=phi_plane)
    except Exception as exc:  # noqa: BLE001 - a bad plane must not sink the run
        return (ip, _take_plane(sl.data, cfg, 0).astype(out_dtype, copy=False),
                out_mask_2d, True, str(exc))

    I_ring2d = _take_plane(I_ring, cfg, 0)
    sl_data2d = _take_plane(sl.data, cfg, 0)
    return (ip, (sl_data2d - I_ring2d).astype(out_dtype, copy=False),
            out_mask_2d, False, None)


# ---------------------------------------------------------------------------
# Worker context — everything a detached plane worker needs besides the plane
# ---------------------------------------------------------------------------
@dataclass
class RingWorkerContext:
    """The per-run shared state a ring worker needs to process any plane.

    Everything except the plane data itself: the scalar parameters (exact-JSON
    round-trippable), the two in-plane axes + UB (the stack-axis *value* for a
    given plane travels with the plane), and the confirmed-shell arrays.  Built
    once per run by the driver, broadcast once per worker.
    """

    params: RingParams
    slice_axis: str
    q_range: tuple[float, float]
    min_voxels: int
    axis_a: np.ndarray            # first in-plane axis (volume order)
    axis_b: np.ndarray            # second in-plane axis (volume order)
    ub_matrix: np.ndarray         # (3, 3)
    ring_centers: np.ndarray | None = None
    ring_halfwidths: np.ndarray | None = None
    ring_ceilings: np.ndarray | None = None

    def scalars_json(self) -> str:
        """All non-array context as JSON (Python float repr round-trips f64
        exactly, so the worker reconstructs bit-identical parameters)."""
        return json.dumps({
            "params": dataclasses.asdict(self.params),
            "slice_axis": self.slice_axis,
            "q_range": list(self.q_range),
            "min_voxels": int(self.min_voxels),
        })

    @classmethod
    def from_parts(
        cls,
        scalars_json: str,
        axis_a: np.ndarray,
        axis_b: np.ndarray,
        ub_matrix: np.ndarray,
        ring_centers: np.ndarray | None,
        ring_halfwidths: np.ndarray | None,
        ring_ceilings: np.ndarray | None,
    ) -> RingWorkerContext:
        s = json.loads(scalars_json)
        return cls(
            params=RingParams(**s["params"]),
            slice_axis=str(s["slice_axis"]),
            q_range=(float(s["q_range"][0]), float(s["q_range"][1])),
            min_voxels=int(s["min_voxels"]),
            axis_a=np.asarray(axis_a, dtype=np.float64),
            axis_b=np.asarray(axis_b, dtype=np.float64),
            ub_matrix=np.asarray(ub_matrix, dtype=np.float64).reshape(3, 3),
            ring_centers=None if ring_centers is None
            else np.asarray(ring_centers, dtype=np.float64),
            ring_halfwidths=None if ring_halfwidths is None
            else np.asarray(ring_halfwidths, dtype=np.float64),
            ring_ceilings=None if ring_ceilings is None
            else np.asarray(ring_ceilings, dtype=np.float64),
        )

