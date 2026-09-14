# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Bit-identity of the parallel ring-removal drivers.

The parallel == serial equality is the load-bearing contract of the browser
ring-worker pool: ``_process_ring_plane`` is pure and result application is
order-independent, so any executor that routes planes through
``nebula3d.ringworker`` (the exact module the browser workers run, fed the
exact byte-level payloads the JS protocol ships) must reproduce the serial
driver bit for bit — including the low-memory per-plane coordinate recompute,
worker failures (recomputed in-process), and whole-pool failure (serial
fallback).  The native process pool gets the same equality pinned
(``max_workers=2``), closing a long-standing test gap.
"""

from __future__ import annotations

import asyncio
import random

import numpy as np
import pytest

from nebula3d import ringworker
from nebula3d.core import HKLVolume
from nebula3d.pipeline import RingParams, remove_rings, remove_rings_async

UB = 2.0 * np.pi * np.eye(3)


def _ring_vol_3d(shape=(9, 41, 41), ring_q=3.0, ring_fwhm=0.14, seed=0,
                 slice_axis="H"):
    """3-D volume with a textured powder ring in every stack plane.

    ``shape[0]`` ≥ 8 so ``remove_rings_async`` engages its executor
    (``_MIN_PARALLEL_PLANES``).  For ``slice_axis="K"`` the ring lives in the
    h0l planes instead (stack axis K), exercising the strided (non-contiguous)
    plane layout of the native slicer against the worker's contiguous rebuild.
    """
    from nebula3d.preprocessing.parametric_ring import _pseudo_voigt

    rng = np.random.default_rng(seed)
    if slice_axis == "H":
        full_shape = shape
        ranges = ((-2, 2), (-4, 4), (-4, 4))
    else:  # K stack: planes are (H, L)
        full_shape = (shape[1], shape[0], shape[2])
        ranges = ((-4, 4), (-2, 2), (-4, 4))
    vol = HKLVolume.from_arrays(np.ones(full_shape), *ranges, ub_matrix=UB)
    q = vol.q_magnitude()
    H, K, L = vol.hkl_grid()
    if slice_axis == "H":
        Q = np.stack([np.zeros_like(K), K, L], axis=-1) @ UB.T
        phi = np.arctan2(Q[..., 2], Q[..., 1])
        diffuse = 1.0 + 0.2 * np.cos(np.pi * K) * np.cos(np.pi * L)
    else:
        Q = np.stack([H, np.zeros_like(H), L], axis=-1) @ UB.T
        phi = np.arctan2(Q[..., 2], Q[..., 0])
        diffuse = 1.0 + 0.2 * np.cos(np.pi * H) * np.cos(np.pi * L)
    ring = (1.0 + 0.4 * np.cos(2 * phi)) * 3.0 * _pseudo_voigt(
        q, ring_q, ring_fwhm, 0.5)
    data = diffuse + ring + rng.normal(0, 0.02, full_shape)
    return HKLVolume.from_arrays(data, *ranges, ub_matrix=UB)


class FakeExecutor:
    """PlaneExecutor that routes planes through the real ``ringworker`` module,
    shuffled, over the exact byte-level payloads the browser protocol ships."""

    def __init__(self, n_workers: int = 3, drop_ips: tuple[int, ...] = (),
                 seed: int = 7):
        self._n = n_workers
        self._drop = set(drop_ips)
        self._seed = seed

    def workers(self) -> int:
        return self._n

    async def run(self, context, n_planes, get_task, apply_result):
        def _b(a):
            return None if a is None else np.ascontiguousarray(a).tobytes()

        ringworker.set_context(
            context.scalars_json(),
            _b(context.axis_a), _b(context.axis_b), _b(context.ub_matrix),
            _b(context.ring_centers), _b(context.ring_halfwidths),
            _b(context.ring_ceilings))

        order = list(range(n_planes))
        random.Random(self._seed).shuffle(order)
        failed: list[int] = []
        for ip in order:
            if ip in self._drop:
                failed.append(ip)  # simulate a dead worker: never delivered
                continue
            sv, d2, m2 = get_task(ip)
            r = ringworker.process_plane(
                ip, sv, int(d2.shape[0]), int(d2.shape[1]),
                d2.tobytes(),
                np.ascontiguousarray(m2).astype(np.uint8).tobytes())
            mask = r["mask"]
            apply_result((
                r["ip"], r["data"],
                None if mask is None else np.asarray(mask).astype(bool),
                r["skipped"], r["err"],
            ))
        return failed


class RaisingExecutor:
    def workers(self) -> int:
        return 2

    async def run(self, context, n_planes, get_task, apply_result):
        raise RuntimeError("pool exploded")


def _assert_identical(a: HKLVolume, b: HKLVolume) -> None:
    assert np.array_equal(a.data, b.data)
    assert np.array_equal(a.mask, b.mask)


@pytest.mark.parametrize("lowmem", ["0", "1"])
@pytest.mark.parametrize("ring_model", ["patched", "parametric"])
def test_async_matches_serial(monkeypatch, ring_model, lowmem):
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", lowmem)
    vol = _ring_vol_3d()
    p = RingParams(ring_model=ring_model, slice_axis="H", q_min=1.0, q_max=8.0,
                   confirm_rings=True)
    serial = remove_rings(vol, p)
    parallel = asyncio.run(
        remove_rings_async(vol, p, plane_executor=FakeExecutor()))
    _assert_identical(serial, parallel)


def test_async_matches_serial_k_axis(monkeypatch):
    """K stack axis: the native driver slices *strided* planes; the worker
    rebuilds contiguous ones — values must still match bit for bit."""
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    vol = _ring_vol_3d(slice_axis="K")
    p = RingParams(ring_model="patched", slice_axis="K", q_min=1.0, q_max=8.0,
                   confirm_rings=True)
    serial = remove_rings(vol, p)
    parallel = asyncio.run(
        remove_rings_async(vol, p, plane_executor=FakeExecutor()))
    _assert_identical(serial, parallel)


def test_async_recomputes_failed_planes(monkeypatch):
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    vol = _ring_vol_3d()
    p = RingParams(ring_model="patched", slice_axis="H", q_min=1.0, q_max=8.0,
                   confirm_rings=False)
    serial = remove_rings(vol, p)
    parallel = asyncio.run(remove_rings_async(
        vol, p, plane_executor=FakeExecutor(drop_ips=(0, 3, 8))))
    _assert_identical(serial, parallel)


@pytest.mark.parametrize("executor", [None, FakeExecutor(n_workers=0),
                                      RaisingExecutor()])
def test_async_falls_back_to_serial(monkeypatch, executor):
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    vol = _ring_vol_3d()
    p = RingParams(ring_model="patched", slice_axis="H", q_min=1.0, q_max=8.0,
                   confirm_rings=False)
    serial = remove_rings(vol, p)
    parallel = asyncio.run(
        remove_rings_async(vol, p, plane_executor=executor))
    _assert_identical(serial, parallel)


def test_async_too_few_planes_falls_back(monkeypatch):
    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    vol = _ring_vol_3d(shape=(5, 41, 41))  # below _MIN_PARALLEL_PLANES
    p = RingParams(ring_model="patched", slice_axis="H", q_min=1.0, q_max=8.0,
                   confirm_rings=False)
    serial = remove_rings(vol, p)
    parallel = asyncio.run(
        remove_rings_async(vol, p, plane_executor=FakeExecutor()))
    _assert_identical(serial, parallel)


def test_native_pool_matches_serial():
    """Explicit max_workers engages the process pool on any platform — its
    output must equal the serial loop exactly (closes the historical gap)."""
    vol = _ring_vol_3d()
    p = RingParams(ring_model="patched", slice_axis="H", q_min=1.0, q_max=8.0,
                   confirm_rings=False)
    serial = remove_rings(vol, p, max_workers=1)
    pooled = remove_rings(vol, p, max_workers=2)
    _assert_identical(serial, pooled)


def test_run_pipeline_carry_in_skips_reload(tmp_path, monkeypatch):
    """carry_in seeds the in-memory pass-through: the seeded artifact is never
    re-read from disk by the next stage."""
    import nebula3d
    from nebula3d import pipeline as pl

    vol = _ring_vol_3d(shape=(9, 25, 25))
    raw = tmp_path / "raw.h5"
    nebula3d.save(vol, raw)
    p = pl.PipelineParams()
    p.rings = RingParams(ring_model="patched", slice_axis="H",
                         q_min=1.0, q_max=8.0, confirm_rings=False)

    # Produce the ring artifact out-of-band (what run_async does).
    paths = pl.pipeline_paths(raw, proc_dir=tmp_path / "proc")
    paths.delta_pdf.parent.mkdir(parents=True, exist_ok=True)
    out = remove_rings(vol, p.rings)
    nebula3d.save(out, paths.ringremoved)

    loads: list[str] = []
    real_load = nebula3d.load

    def counting_load(path, *a, **k):
        loads.append(str(path))
        return real_load(path, *a, **k)

    monkeypatch.setattr(nebula3d, "load", counting_load)
    pl.run_pipeline(raw, p, proc_dir=tmp_path / "proc",
                    stages=("punch",), carry_in=(paths.ringremoved, out))
    assert not any(str(paths.ringremoved) in s for s in loads), loads


def test_ringworker_import_is_matplotlib_free():
    """The browser ring workers must boot without matplotlib: nebula3d's
    `visualization` import is lazy (PEP 562), and nothing on the ringworker
    import path may drag it back in.  Fresh interpreter to isolate."""
    import subprocess
    import sys

    code = (
        "import sys; import nebula3d.ringworker; "
        "assert 'matplotlib' not in sys.modules, 'matplotlib got imported'; "
        "import nebula3d; v = nebula3d.visualization; "
        "assert v.__name__ == 'nebula3d.visualization'"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True,
                          text=True)
    assert proc.returncode == 0, proc.stderr
