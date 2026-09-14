# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Ring-plane worker entry point for the in-browser worker pool.

Each browser ring worker is a slim Pyodide interpreter that imports only this
module (numpy/scipy + the ring-model code via :mod:`nebula3d._ringplane`; no
matplotlib).  The JS layer (``web/src/workers/ringWorker.ts``) feeds it raw
plane buffers; this module rebuilds the exact one-plane volume the native
driver's ``_slice_volume`` would have produced and calls the *same*
``_process_ring_plane`` — so the result is bit-identical to the serial path.

Deliberately FFI-free (plain buffers/bytes in, numpy arrays out) so the native
pytest suite drives the very same code the browser runs
(``tests/test_ring_parallel.py``).
"""

from __future__ import annotations

import numpy as np

from nebula3d._ringplane import (
    _SLICE_CONFIGS,
    RingWorkerContext,
    _process_ring_plane,
)
from nebula3d.core import HKLVolume

__all__ = ["set_context", "process_plane"]

_CTX: RingWorkerContext | None = None


def _coerce(x: object) -> object:
    """Duck-typed JsProxy → Python buffer (no pyodide import; native no-op)."""
    to_py = getattr(x, "to_py", None)
    return to_py() if callable(to_py) else x


def _as_f64(buf: object) -> np.ndarray:
    """Little-endian float64 view of any bytes-like buffer (copy-free)."""
    return np.frombuffer(memoryview(buf), dtype="<f8")  # type: ignore[arg-type]


def set_context(
    scalars_json: str,
    axis_a: object,
    axis_b: object,
    ub_matrix: object,
    ring_centers: object = None,
    ring_halfwidths: object = None,
    ring_ceilings: object = None,
) -> None:
    """Install the per-run shared context (broadcast once per worker).

    Array arguments are bytes-like float64 buffers (or ndarrays in native
    tests); scalars arrive as the exact-round-trip JSON produced by
    :meth:`RingWorkerContext.scalars_json`.
    """
    global _CTX

    def _arr(x: object) -> np.ndarray | None:
        x = _coerce(x)
        if x is None:
            return None
        if isinstance(x, np.ndarray):
            return np.asarray(x, dtype=np.float64)
        return _as_f64(x).copy()  # own the memory beyond the message lifetime

    axis_a_arr = _arr(axis_a)
    axis_b_arr = _arr(axis_b)
    ub_arr = _arr(ub_matrix)
    assert axis_a_arr is not None and axis_b_arr is not None and ub_arr is not None
    _CTX = RingWorkerContext.from_parts(
        scalars_json,
        axis_a_arr,
        axis_b_arr,
        ub_arr.reshape(3, 3),
        _arr(ring_centers),
        _arr(ring_halfwidths),
        _arr(ring_ceilings),
    )


def _one_plane_volume(
    ctx: RingWorkerContext, stack_value: float,
    data_2d: np.ndarray, mask_2d: np.ndarray,
) -> HKLVolume:
    """Rebuild exactly the 3-D one-plane volume ``_slice_volume`` would return.

    The stack axis collapses to ``[stack_value]`` (the exact float64 of
    ``axis[ip]``); sigma is a broadcast zero — proven to have no effect on the
    ring output (``snr_mask_threshold`` is never set by ``_build_ring_model``),
    which is what lets the plane payload exclude it.
    """
    cfg = _SLICE_CONFIGS[ctx.slice_axis]
    data3 = np.expand_dims(data_2d, axis=cfg.axis_dim)
    mask3 = np.expand_dims(mask_2d, axis=cfg.axis_dim)
    stack = np.asarray([stack_value], dtype=np.float64)
    in_plane = [a for a in ("h_axis", "k_axis", "l_axis") if a != cfg.axis_attr]
    axes: dict[str, np.ndarray] = {
        cfg.axis_attr: stack,
        in_plane[0]: ctx.axis_a,
        in_plane[1]: ctx.axis_b,
    }
    return HKLVolume(
        data=data3,
        sigma=np.broadcast_to(np.float64(0.0), data3.shape),
        mask=mask3,
        h_axis=axes["h_axis"],
        k_axis=axes["k_axis"],
        l_axis=axes["l_axis"],
        ub_matrix=ctx.ub_matrix,
    )


def process_plane(
    ip: int,
    stack_value: float,
    n0: int,
    n1: int,
    data_buf: object,
    mask_buf: object,
) -> dict[str, object]:
    """Ring-fit one plane; return the corrected plane (+ replacement mask).

    ``data_buf``/``mask_buf`` are the raw little-endian buffers of the 2-D
    float64 plane and its uint8 mask, shaped ``(n0, n1)``.  Returns
    ``{"ip", "skipped", "err", "data", "mask"}`` with ``data`` a float64
    ``(n0, n1)`` ndarray and ``mask`` a uint8 ndarray or ``None`` — matching
    ``_PlaneResult`` exactly, just re-keyed for the message layer.
    """
    if _CTX is None:
        raise RuntimeError("ring worker context not set (call set_context first)")
    ctx = _CTX
    cfg = _SLICE_CONFIGS[ctx.slice_axis]

    data_buf = _coerce(data_buf)
    mask_buf = _coerce(mask_buf)
    if isinstance(data_buf, np.ndarray):
        data_2d = np.ascontiguousarray(data_buf, dtype=np.float64).reshape(n0, n1)
    else:
        data_2d = _as_f64(data_buf).reshape(n0, n1)
    if isinstance(mask_buf, np.ndarray):
        mask_2d = np.ascontiguousarray(mask_buf).astype(np.bool_).reshape(n0, n1)
    else:
        mask_2d = (np.frombuffer(memoryview(mask_buf), dtype=np.uint8)  # type: ignore[arg-type]
                   .reshape(n0, n1).astype(np.bool_))

    vol1 = _one_plane_volume(ctx, stack_value, data_2d, mask_2d)
    _ip0, out_2d, out_mask_2d, skipped, err = _process_ring_plane(
        0, vol1, cfg, ctx.params, ctx.min_voxels, ctx.q_range,
        ctx.ring_centers, ctx.ring_halfwidths, ctx.ring_ceilings, None, None)

    return {
        "ip": int(ip),
        "skipped": bool(skipped),
        "err": err,
        "data": np.ascontiguousarray(out_2d, dtype=np.float64),
        "mask": (None if out_mask_2d is None
                 else np.ascontiguousarray(out_mask_2d).astype(np.uint8)),
    }
