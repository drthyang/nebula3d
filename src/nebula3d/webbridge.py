# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""In-browser (Pyodide) bridge: drive the real pipeline + viewers, no server.

This is the backend-less twin of :mod:`nebula3d.server` for the GitHub Pages build.
When the SPA runs under Pyodide there is no FastAPI process, so the React data
layer calls these functions directly instead of ``fetch("/api/...")``.  Each one
mirrors the corresponding API endpoint and returns the *same* payload — a JSON
string for metadata/dataset listings, or the binary slice envelope
(``[uint32 header_len][JSON header][float32 data]``) the viewers already decode —
so the front-end is unchanged apart from where the bytes come from.

The heavy lifting (slicing, ΔPDF, consistency, dataset discovery) is **not**
reimplemented here: it reuses the FastAPI-free helper modules under
:mod:`nebula3d.server` (``volumes``, ``deltapdf``, ``consistency``, ``datasets``,
``params``).  Those import only numpy/scipy/h5py/nebula3d — all available in Pyodide
— which is why :mod:`nebula3d.server` imports ``create_app`` lazily.

Workflow (one dataset per browser session):

    setup()                       → create the virtual workspace
    load_input(name, tmp_path)    → register the user's uploaded volume
    run(stages, params_json, …)   → run_pipeline (streams per-stage progress)
    datasets_json()               → dataset + per-stage status (for the viewers)
    volume_slice / dpdf_slice / consistency_slice → binary envelopes

All file I/O happens in Pyodide's in-memory filesystem; nothing is uploaded.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import struct
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

import numpy as np

import nebula3d
from nebula3d._ringplane import RingWorkerContext, _PlaneResult
from nebula3d.core import HKLVolume
from nebula3d.pipeline import (
    STAGES,
    delta_pdf_transform_config,
    pdf_consistency_check,
    pipeline_paths,
    remove_rings_async,
    ring_stage_pending,
    run_pipeline,
    write_delta_pdf_h5,
)
from nebula3d.preprocessing import write_global_ring_diagnostics
from nebula3d.server import consistency as _cons
from nebula3d.server import datasets as _ds
from nebula3d.server import deltapdf as _dpdf
from nebula3d.server import volumes as _vol
from nebula3d.server.config import ServerConfig
from nebula3d.server.params import build_params

if TYPE_CHECKING:
    from nebula3d.server.schemas import PipelineRunRequest

__all__ = [
    "setup",
    "inspect_input",
    "load_input",
    "make_demo_input",
    "run",
    "run_async",
    "datasets_json",
    "volume_meta_json",
    "volume_slice",
    "dpdf_meta_json",
    "dpdf_slice",
    "consistency_meta_json",
    "consistency_slice",
    "bragg_profile_json",
    "save_dpdf",
]

# In-browser memory budget.  Pyodide runs in a 32-bit-WASM heap whose hard
# ceiling is 4 GB (Pyodide ≥ 0.27; MAXIMUM_MEMORY=4GB, and there is no wasm64
# Pyodide build), so the whole float64 reduction must fit inside it (see the
# memory-ceiling notes in docs/web.md, "In-browser run").
#
# Low-memory mode (``NEBULA3D_LOW_MEMORY`` — always on here; see
# ``nebula3d.core.low_memory``) trades a little recompute for a smaller peak,
# every part of it verified byte-for-byte identical to the exact path on real
# data: the ring stage drops the full-3-D |Q|/φ caches (per-plane 2-D
# recompute), the flatten stage subtracts in place, and the unused per-voxel
# ``sigma`` is freed before the ΔPDF / back-FFT stages (which read only data +
# mask).  On a real 401×501×151 volume (30.3 M voxels) the whole reduction then
# peaks at ~2.3 GB; the binding stage is the back-FFT consistency check at
# ~75 B/voxel, with the radial flatten / ring removal close behind.
#
# The browser always computes in float32 storage precision
# (``PipelineParams.precision="float32"``): volume arrays halve, the FFT runs
# float32→complex64, while axes/UB, every |Q|-derived decision, all 1-D
# profile fits/solves, and every large reduction stay float64 (see the
# mixed-precision rules in ``nebula3d.pipeline.PipelineParams.precision`` and
# ``tests/test_float32_equivalence.py``, which tolerance-gates the results
# against the float64 reference).  Native runs keep float64 by default.
#
# 40 B/voxel is the float32 worst-stage figure, measured on the real 48.4
# M-voxel TbTi3Bi4 volume (scripts/measure_stage_peaks.py, low-memory, after
# the streaming-metrics fixes): binding stage = backfill at 42.4 B/voxel
# INCLUDING the ~5 B/voxel interpreter baseline (which dilutes at scale), so
# 40 carries a small margin net of overhead.  float arrays halve vs float64;
# the bool mask and int32 shell indices do not.  Volumes whose estimated peak
# exceeds the budget are refused at load with a clear message rather than
# allowed to crash mid-pipeline with a numpy ``MemoryError``.  Native
# ``nebula3d-web`` has no such limit; this gate lives only here.
_PIPELINE_PEAK_BYTES_PER_VOXEL = 40
# 4 GB WASM ceiling minus the Pyodide runtime + packages (~0.5 GB) and headroom
# for growth fragmentation (wasm memory never shrinks) → 80 M voxels pass the
# gate in float32 (e.g. a 401×401×401 volume = 64.5 M voxels ≈ 2.6 GB
# estimated peak; 501³ = 125.8 M is still refused).
_BROWSER_PEAK_BUDGET_BYTES = 3_200_000_000
#: Storage precision every browser run uses (overridable per-run via a
#: ``"precision"`` key in ``params_json`` — a debugging/validation lever).
_BROWSER_PRECISION = "float32"


# ---------------------------------------------------------------------------
# Session state (one workspace / one loaded dataset per browser tab)
# ---------------------------------------------------------------------------
class _State:
    cfg: ServerConfig | None = None
    input: Path | None = None
    dataset_id: str | None = None


_S = _State()


def _require_cfg() -> ServerConfig:
    if _S.cfg is None:
        setup()
    assert _S.cfg is not None
    return _S.cfg


def setup(workdir: str = "/work") -> str:
    """Create the virtual workspace (``raw/`` + ``processed/``); return its root.

    Idempotent: re-calling keeps any already-loaded input but ensures the dirs
    exist and resets the config.  Also shrinks the server-side slice caches:
    natively they keep whole float64 volumes warm for snappy sliders, but in
    the 4 GB WASM heap that residency would stack on top of the pipeline's own
    peak (a full dataset's cache alone can exceed the heap at full resolution).
    """
    # Low-memory mode: the pipeline drops volume-sized caches that only trade
    # memory for a little recompute (the full-3D ring-coordinate grids and the
    # unused sigma under the ΔPDF/back-FFT transforms).  In the 4 GB WASM heap
    # the peak, not the CPU, is what caps the volume size — so this is always on
    # in the browser bridge.  See nebula3d.pipeline._low_memory / _drop_sigma.
    os.environ["NEBULA3D_LOW_MEMORY"] = "1"

    root = Path(workdir)
    (root / "raw").mkdir(parents=True, exist_ok=True)
    (root / "processed").mkdir(parents=True, exist_ok=True)
    _S.cfg = ServerConfig(data_root=root)
    _vol.set_cache_max(2)
    _dpdf.set_cache_max(1)
    _cons.set_cache_max(1)
    return str(root)


def _clear_caches() -> None:
    _vol.clear_cache()
    _dpdf.clear_cache()
    _cons.clear_cache()


def _release_other_caches(keep: str) -> None:
    """Free the slice/volume caches for views other than *keep* (they're now
    off-screen).

    The three viewers — cleanup slices (``vol``), ΔPDF (``dpdf``), and the
    back-FFT consistency check (``cons``) — are mutually exclusive on screen, so
    when the UI enters one the others' volume-sized caches (up to four volumes
    for a cached reconstruction) are dead weight.  Releasing them here keeps the
    WASM heap's high-water mark to the active view's working set instead of the
    accumulated caches — the headroom the heavy back-FFT round trip needs on a
    large volume.  The cost is a reload of a view's data when the user switches
    back to it, which happens behind that view transition's existing loading
    state (never during slider scrubbing of the active view, whose cache is
    kept).  Called only from the per-view *metadata* entry points (once on view
    entry), never from the per-slice ones.
    """
    if keep != "vol":
        _vol.clear_cache()
    if keep != "dpdf":
        _dpdf.clear_cache()
    if keep != "cons":
        _cons.clear_cache()


def _safe_stem(name: str) -> str:
    """Filename → a clean stem for the raw ``.nxs`` (drops the extension)."""
    stem = Path(name).name
    # Strip a known volume extension; keep the rest verbatim so condition labels
    # survive for dataset grouping / display.
    for ext in (".nxs", ".hdf5", ".h5", ".txt", ".dat", ".hkl"):
        if stem.lower().endswith(ext):
            stem = stem[: -len(ext)]
            break
    stem = stem.strip() or "volume"
    return stem


def _peek_voxel_count(path: Path) -> tuple[tuple[int, ...], int]:
    """Signal-grid shape + voxel count from HDF5 *metadata* only (no array read).

    Handles both supported layouts — Mantid ``MDHistoWorkspace/data/signal`` and
    nebula3d ``entry/data``.  Reading ``Dataset.shape`` never loads the data, so this
    is safe to call on a volume too large to fit in memory.  Returns ``((), 0)``
    for an unrecognised file (callers then skip the size gate).
    """
    import h5py

    with h5py.File(path, "r") as f:
        if "MDHistoWorkspace" in f:
            shape = tuple(f["MDHistoWorkspace/data/signal"].shape)
        elif "entry" in f and "data" in f["entry"]:
            shape = tuple(f["entry/data"].shape)
        else:
            return (), 0
    n = 1
    for s in shape:
        n *= int(s)
    return shape, n


def inspect_input(name: str, tmp_path: str) -> str:
    """Pre-flight memory estimate for an uploaded volume (metadata only).

    Reads just the signal-grid shape — never the arrays — so it cannot itself run
    out of memory, then estimates the full-pipeline peak and compares it to the
    browser budget.  Returns JSON ``{shape, n_voxels, est_peak_mb, ok, message}``;
    the engine refuses to load when ``ok`` is false, surfacing *message* instead
    of letting the reduction crash with an opaque numpy ``MemoryError``.
    """
    shape, n = _peek_voxel_count(Path(tmp_path))
    est_peak = n * _PIPELINE_PEAK_BYTES_PER_VOXEL
    ok = n == 0 or est_peak <= _BROWSER_PEAK_BUDGET_BYTES
    budget_voxels = _BROWSER_PEAK_BUDGET_BYTES // _PIPELINE_PEAK_BYTES_PER_VOXEL

    message = ""
    if not ok:
        dims = "×".join(str(s) for s in shape)
        message = (
            f"“{Path(name).name}” is {dims} ({n / 1e6:.1f} M voxels). Reducing it "
            f"would need roughly {est_peak / 1e9:.1f} GB of browser memory — more "
            f"than the in-browser engine can hold (it targets volumes up to about "
            f"{budget_voxels / 1e6:.0f} M voxels in its float32 compute mode). "
            f"For full-resolution data this large, run the native build, which has "
            f"no memory limit and opens the same interface:\n"
            f'    pip install "nebula3d[web]"  &&  nebula3d-web'
        )
    return _json({
        "shape": list(shape),
        "n_voxels": n,
        "est_peak_mb": est_peak / 1e6,
        "ok": ok,
        "message": message,
        # The storage precision this browser session will compute in (native
        # runs default to float64; the ceiling above is the float32 one).
        "precision": _BROWSER_PRECISION,
        "ceiling_voxels": int(budget_voxels),
    })


def load_input(name: str, tmp_path: str) -> str:
    """Register an uploaded volume (already written to *tmp_path* in the FS).

    Copies it to ``raw/<stem>.nxs`` (``nebula3d.load`` content-detects Mantid vs
    nebula3d-HDF5, so the ``.nxs`` extension is fine for either) and returns the
    dataset id the viewers will use.  Clears the slice caches so a re-load does
    not serve a previous volume.
    """
    cfg = _require_cfg()
    stem = _safe_stem(name)
    dest = cfg.raw_dir / f"{stem}.nxs"
    shutil.copyfile(tmp_path, dest)
    _S.input = dest
    _S.dataset_id = _ds._slug(stem)
    _clear_caches()
    return _S.dataset_id


def make_demo_input(n: int = 33) -> str:
    """Write a small synthetic **FCC** HKL volume to the workspace; return its id.

    A physically-flavoured demo for when the user has no data, so every pipeline
    stage has realistic structure to act on:

    - **FCC Bragg peaks** at integer (h,k,l) with *unmixed parity* (all even or
      all odd) — the FCC reflection condition; mixed-parity nodes (100, 210, …)
      are systematically absent.  Sharp, with a Debye-Waller-like |Q| falloff.
    - **Diffuse scattering along one axis**: continuous rods running along **L**
      through the in-plane nodes (transverse-narrow, L-extended, modulated so the
      diffuse is strongest between Bragg peaks) — the signature of 1-D
      correlations / planar disorder.
    - a smooth thermal-diffuse background, a faint powder ring, and a bright
      incident-beam spot at the origin, plus a little noise.

    Cubic lattice ``a = 4 Å`` (``ub = (2π/a)·I``) so |Q| is physical.  Kept tiny
    (``n³``) so the full chain runs in seconds under Pyodide.
    """
    import numpy as np

    cfg = _require_cfg()
    extent = 4.0
    a = 4.0  # cubic lattice parameter (Å) → isotropic reciprocal metric
    ub = (2.0 * np.pi / a) * np.eye(3, dtype=np.float64)

    h = np.linspace(-extent, extent, n)
    step = float(h[1] - h[0])
    H, K, L = np.meshgrid(h, h, h, indexing="ij")
    q2 = H**2 + K**2 + L**2  # |hkl|² in r.l.u.

    # Smooth thermal-diffuse background + a Debye-Waller-like high-|Q| falloff
    # shared by the Bragg peaks and the diffuse rods.
    data = 0.6 + 3.0 * np.exp(-q2 / 6.0)
    falloff = np.exp(-0.10 * q2)

    nodes = range(int(np.ceil(-extent)), int(np.floor(extent)) + 1)
    sig_b = max(0.10, 0.9 * step)  # Bragg half-width (r.l.u.)
    for ih in nodes:
        for ik in nodes:
            for il in nodes:
                all_even = (ih % 2 == 0) and (ik % 2 == 0) and (il % 2 == 0)
                all_odd = (ih % 2 != 0) and (ik % 2 != 0) and (il % 2 != 0)
                if not (all_even or all_odd):
                    continue  # FCC systematic absence (mixed parity)
                rn2 = ih * ih + ik * ik + il * il
                amp = 26.0 * np.exp(-0.10 * rn2)
                data += amp * np.exp(
                    -((H - ih) ** 2 + (K - ik) ** 2 + (L - il) ** 2)
                    / (2.0 * sig_b * sig_b)
                )

    # Diffuse rods along L through the in-plane same-parity columns (|h|,|k| ≤ 2),
    # so they thread the FCC nodes.  Narrow in H,K; extended in L; modulated to be
    # brightest midway between Bragg peaks (cos² along L) — 1-D-correlation diffuse.
    sig_t = max(0.16, 1.1 * step)
    l_mod = 0.5 - 0.5 * np.cos(2.0 * np.pi * L)  # 0 at integer L, 1 at half-integer
    for h0 in (-2, -1, 0, 1, 2):
        for k0 in (-2, -1, 0, 1, 2):
            if (h0 % 2) != (k0 % 2):
                continue  # keep columns that pass through FCC nodes
            amp = 3.2 * np.exp(-0.18 * (h0 * h0 + k0 * k0))
            data += amp * l_mod * np.exp(
                -((H - h0) ** 2 + (K - k0) ** 2) / (2.0 * sig_t * sig_t)
            )

    data *= falloff
    data += 1.2 * np.exp(-((np.sqrt(q2) - 3.0) ** 2) / 0.05)  # faint powder ring
    data += 60.0 * np.exp(-q2 / (2.0 * sig_b * sig_b))        # incident beam @ origin

    rng = np.random.default_rng(0)
    data = np.clip(data + 0.02 * rng.standard_normal(data.shape), 0.0, None)

    vol = nebula3d.core.HKLVolume.from_arrays(
        data.astype(np.float64),
        (-extent, extent), (-extent, extent), (-extent, extent),
        ub_matrix=ub,
    )
    dest = cfg.raw_dir / "demo_fcc.nxs"
    nebula3d.save(vol, dest)
    _S.input = dest
    _S.dataset_id = _ds._slug("demo_fcc")
    _clear_caches()
    return _S.dataset_id


# ---------------------------------------------------------------------------
# Run the pipeline
# ---------------------------------------------------------------------------
class _ParamsNS:
    """Attribute view over the params dict; any unset field reads back as None.

    Matches the Pydantic ``StageParamsIn`` (all fields default to ``None``) that
    :func:`build_params` expects, without importing Pydantic.
    """

    def __init__(self, d: dict[str, object]) -> None:
        self.__dict__.update(d)

    def __getattr__(self, _name: str) -> None:  # only for fields not in __dict__
        return None


def _make_request(params_json: str, flatten_enabled: bool) -> PipelineRunRequest:
    """Duck-typed request for :func:`build_params` from a JSON params dict.

    ``build_params`` only does attribute access, so a namespace stands in for the
    Pydantic ``PipelineRunRequest`` (which we cannot import under Pyodide); the
    cast keeps the type checker happy without a runtime Pydantic dependency.
    """
    raw = json.loads(params_json) if params_json else {}
    req = SimpleNamespace(flatten_enabled=bool(flatten_enabled), params=_ParamsNS(raw))
    return cast("PipelineRunRequest", req)


def _apply_browser_precision(params: object, params_json: str) -> None:
    """Browser storage-precision policy: always float32, unless the caller
    explicitly pinned ``"precision"`` in *params_json* (the debug/validation
    lever used to compare the two modes on the same session)."""
    explicit = None
    try:
        explicit = (json.loads(params_json) if params_json else {}).get("precision")
    except (ValueError, AttributeError):
        explicit = None
    params.precision = (  # type: ignore[attr-defined]
        explicit if explicit in ("float64", "float32") else _BROWSER_PRECISION)


def run(
    stages_csv: str,
    params_json: str,
    flatten_enabled: bool,
    force: bool = False,
    force_from: str | None = None,
    progress: Callable[[str, str, float | None, str], None] | None = None,
) -> str:
    """Run the selected pipeline *stages* on the loaded input; return datasets JSON.

    *stages_csv* is a comma-separated subset of :data:`nebula3d.pipeline.STAGES`
    (empty = all), so the JS caller can drive the pipeline one stage at a time
    and repaint between stages.  *params_json* is the curated ``StageParamsIn``
    override dict; *progress* is an optional JS callback
    ``progress(stage, status, fraction, message)`` streamed during the run.
    """
    cfg = _require_cfg()
    if _S.input is None:
        raise RuntimeError("no input loaded; call load_input() first")
    # Free any volumes the slice viewers have cached: the pipeline needs the
    # whole WASM heap for its own peak, and stale cache entries for outputs
    # this run will overwrite are useless anyway.
    _clear_caches()
    stages = tuple(s for s in (stages_csv.split(",") if stages_csv else [])
                   if s) or STAGES
    params = build_params(_make_request(params_json, flatten_enabled))
    params.pdf_check_figure = False  # browser: no matplotlib, nothing reads the PNG
    _apply_browser_precision(params, params_json)

    cb = None
    if progress is not None:
        def cb(stage: str, status: str, fraction: float | None, message: str) -> None:
            progress(stage, status, fraction, message)  # type: ignore[misc]

    run_pipeline(
        _S.input, params, proc_dir=cfg.processed_dir, stages=stages,
        force=bool(force), force_from=force_from, progress=cb,
    )
    return datasets_json()


# ---------------------------------------------------------------------------
# Async run — parallel ring removal over the browser worker pool
# ---------------------------------------------------------------------------
def _ring_pool_js() -> object | None:
    """The ring-worker pool the JS layer installs on the worker global scope
    (``self.nebulaRingPool``); ``None`` natively or when not installed."""
    try:
        import js  # type: ignore[import-not-found]  # noqa: PLC0415 - Pyodide-only
    except ImportError:
        return None
    return getattr(js, "nebulaRingPool", None)


class _JsPlaneExecutor:
    """`nebula3d.pipeline.PlaneExecutor` over the JS ring-worker pool.

    Plane payloads cross the FFI as JS ``Uint8Array``s (created Python-side via
    ``pyodide.ffi.to_js`` so no PyProxy lingers on the JS side); results come
    back as plain JS objects whose typed arrays are copied into numpy on
    receipt.  Any worker/messaging failure marks the plane infrastructurally
    failed — the driver recomputes it in-process, so the run never breaks.
    """

    def __init__(self, pool: object,
                 progress: Callable[[str, str, float | None, str], None] | None
                 = None) -> None:
        self._pool = pool
        self._progress = progress
        self._reported: set[str] = set()

    def workers(self) -> int:
        try:
            return int(self._pool.readyCount())  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 - a broken pool is just "no workers"
            return 0

    def _report_infra(self, message: str) -> None:
        """Surface each distinct worker-infrastructure failure once (the plane
        itself is recomputed in-process, but a silent discard would hide e.g. a
        protocol mismatch behind a mysteriously serial run)."""
        if self._progress is None or message in self._reported:
            return
        self._reported.add(message)
        self._progress("rings", "progress", None,
                       f"ring worker degraded ({message}); affected planes "
                       "recomputed in-process")

    async def run(
        self,
        context: RingWorkerContext,
        n_planes: int,
        get_task: Callable[[int], tuple[float, np.ndarray, np.ndarray]],
        apply_result: Callable[[_PlaneResult], None],
    ) -> list[int]:
        import asyncio  # noqa: PLC0415

        from pyodide.ffi import to_js  # type: ignore[import-not-found]  # noqa: PLC0415

        pool = self._pool

        def _u8(buf: bytes | None) -> object | None:
            return None if buf is None else to_js(buf)

        pool.beginStage(  # type: ignore[attr-defined]
            context.scalars_json(),
            _u8(np.ascontiguousarray(context.axis_a, dtype=np.float64).tobytes()),
            _u8(np.ascontiguousarray(context.axis_b, dtype=np.float64).tobytes()),
            _u8(np.ascontiguousarray(context.ub_matrix, dtype=np.float64).tobytes()),
            _u8(None if context.ring_centers is None
                else np.ascontiguousarray(context.ring_centers,
                                          dtype=np.float64).tobytes()),
            _u8(None if context.ring_halfwidths is None
                else np.ascontiguousarray(context.ring_halfwidths,
                                          dtype=np.float64).tobytes()),
            _u8(None if context.ring_ceilings is None
                else np.ascontiguousarray(context.ring_ceilings,
                                          dtype=np.float64).tobytes()),
        )

        failed: list[int] = []
        # Bound in-flight planes so transient JS-side buffers stay a few MB.
        sem = asyncio.Semaphore(max(2, 2 * self.workers()))

        async def one(ip: int) -> None:
            async with sem:
                # EVERYTHING per-plane sits inside the try: a MemoryError while
                # extracting the plane (the very heap-pressure regime this
                # feature targets) must fail one plane — not escape the task,
                # abort the whole gather, and orphan in-flight workers.
                try:
                    sv, d2, m2 = get_task(ip)
                    shape = (int(d2.shape[0]), int(d2.shape[1]))
                    res = await pool.submitPlane(  # type: ignore[attr-defined]
                        ip, float(sv), shape[0], shape[1],
                        # The wire format is explicitly little-endian float64 —
                        # normalise here so a future dtype change upstream can
                        # never silently corrupt the byte protocol.
                        _u8(np.ascontiguousarray(d2, dtype="<f8").tobytes()),
                        _u8(np.ascontiguousarray(m2).astype(np.uint8).tobytes()))
                    if not bool(res.ok):
                        msg = getattr(res, "message", None)
                        if msg:
                            self._report_infra(str(msg))
                        failed.append(ip)
                        return
                    data_2d = np.frombuffer(
                        bytes(res.data.to_py()), dtype="<f8").reshape(shape)
                    mask_js = getattr(res, "mask", None)
                    mask_2d = (None if mask_js is None else np.frombuffer(
                        bytes(mask_js.to_py()), dtype=np.uint8)
                        .reshape(shape).astype(bool))
                    err = getattr(res, "err", None)
                    apply_result((ip, data_2d, mask_2d, bool(res.skipped),
                                  None if err is None else str(err)))
                except Exception as exc:  # noqa: BLE001 - failure → recompute
                    self._report_infra(str(exc))
                    failed.append(ip)

        try:
            await asyncio.gather(*(one(ip) for ip in range(n_planes)))
        finally:
            try:
                pool.endStage()  # type: ignore[attr-defined]
            except Exception:  # noqa: BLE001 - teardown is best-effort
                pass
        return failed


async def run_async(
    stages_csv: str,
    params_json: str,
    flatten_enabled: bool,
    force: bool = False,
    force_from: str | None = None,
    progress: Callable[[str, str, float | None, str], None] | None = None,
) -> str:
    """Async twin of :func:`run` that fans the ring stage out over the browser
    ring-worker pool when one is available (bit-identical results either way).

    Everything else — parameter handling, resume/force semantics, artifacts,
    progress events — matches :func:`run` exactly: when the pool is absent,
    empty, the ring model is a global one, or the ring stage would be skipped
    anyway (`ring_stage_pending` is the shared gate), this delegates to the
    very same single ``run_pipeline`` call ``run`` makes.
    """
    cfg = _require_cfg()
    if _S.input is None:
        raise RuntimeError("no input loaded; call load_input() first")
    # Validate up front, exactly like run_pipeline does at its top — the
    # out-of-band ring stage must not burn minutes of compute before a bad
    # force_from raises in the trailing run_pipeline call.
    if force_from is not None and force_from not in STAGES:
        raise ValueError(f"force_from={force_from!r}; choose one of {STAGES}")
    _clear_caches()
    stages = tuple(s for s in (stages_csv.split(",") if stages_csv else [])
                   if s) or STAGES
    params = build_params(_make_request(params_json, flatten_enabled))
    params.pdf_check_figure = False  # browser: no matplotlib, nothing reads the PNG
    _apply_browser_precision(params, params_json)

    cb = None
    if progress is not None:
        def cb(stage: str, status: str, fraction: float | None, message: str) -> None:
            progress(stage, status, fraction, message)  # type: ignore[misc]

    executor = None
    pool = _ring_pool_js()
    if (
        pool is not None
        and params.rings.ring_model.strip().lower() in {"patched", "parametric"}
        and ring_stage_pending(_S.input, params, proc_dir=cfg.processed_dir,
                               stages=stages, force=bool(force),
                               force_from=force_from)
    ):
        candidate = _JsPlaneExecutor(pool, progress=cb)
        if candidate.workers() > 0:
            executor = candidate

    # WebGPU ΔPDF core: split pdf/pdf_check out of the CPU run when the GPU
    # is usable (float32 storage only — the GPU path is f32 end to end).
    gpu = _gpu_js()
    split_pdf = (
        gpu is not None
        and params.precision == "float32"
        and any(st in stages for st in ("pdf", "pdf_check"))
        and await _gpu_usable(gpu)
    )
    cpu_stages = (tuple(st for st in stages if st not in ("pdf", "pdf_check"))
                  if split_pdf else stages)

    if executor is None:
        run_pipeline(
            _S.input, params, proc_dir=cfg.processed_dir, stages=cpu_stages,
            force=bool(force), force_from=force_from, progress=cb,
        )
    else:
        # Ring stage out-of-band (mirrors run_pipeline's stage-1 block: save
        # the artifact + optional diagnostics sidecar), then the remaining CPU
        # stages in one call with the ring output handed over in memory.
        paths = pipeline_paths(_S.input, proc_dir=cfg.processed_dir,
                               flatten_enabled=params.flatten_enabled)
        paths.delta_pdf.parent.mkdir(parents=True, exist_ok=True)
        vol = nebula3d.load(paths.input, dtype=params.np_dtype())
        out = await remove_rings_async(vol, params.rings, progress=cb,
                                       plane_executor=executor)
        del vol
        nebula3d.save(out, paths.ringremoved)
        ring_diagnostics = getattr(out, "_ring_diagnostics", None)
        if ring_diagnostics is not None:
            write_global_ring_diagnostics(
                ring_diagnostics, paths.ring_diagnostics_json)
        run_pipeline(
            _S.input, params, proc_dir=cfg.processed_dir,
            stages=tuple(st for st in cpu_stages if st != "rings"),
            force=bool(force), force_from=force_from, progress=cb,
            carry_in=(paths.ringremoved, out),
        )

    if split_pdf:
        done = False
        try:
            done = await _run_pdf_stages_gpu(
                params, stages, bool(force), force_from, cb, gpu)
        except Exception as exc:  # noqa: BLE001 - GPU must never fail the run
            _cb_emit(cb, "pdf", "progress", None,
                     f"WebGPU ΔPDF failed ({exc}); recomputing with the CPU FFT")
        if not done:
            run_pipeline(
                _S.input, params, proc_dir=cfg.processed_dir,
                stages=tuple(st for st in stages if st in ("pdf", "pdf_check")),
                force=bool(force), force_from=force_from, progress=cb,
            )
    return datasets_json()


# ---------------------------------------------------------------------------
# WebGPU ΔPDF backend (the FFT core runs on the GPU; everything else CPU)
# ---------------------------------------------------------------------------
#: Appended to the transform_config stamp so CPU- and GPU-computed ΔPDFs never
#: masquerade as each other in the stale-cache guard (the GPU pads to strict
#: 5-smooth lengths and computes the FFT in f32).
_GPU_FFT_TOKEN = ";fft=webgpu-f32-p5"


def _five_smooth(n: int) -> int:
    """Smallest 5-smooth integer ≥ n (the GPU line kernel's radix set)."""
    m = max(1, int(n))
    while True:
        k = m
        for f in (2, 3, 5):
            while k % f == 0:
                k //= f
        if k == 1:
            return m
        m += 1


def _gpu_js() -> object | None:
    """The GPU backend the JS layer installs (``self.nebulaGpu``); None natively."""
    try:
        import js  # type: ignore[import-not-found]  # noqa: PLC0415 - Pyodide-only
    except ImportError:
        return None
    return getattr(js, "nebulaGpu", None)


async def _gpu_usable(gpu: object) -> bool:
    try:
        if bool(gpu.available()):  # type: ignore[attr-defined]
            return True
        status = await gpu.init()  # type: ignore[attr-defined]
        return bool(getattr(status, "available", False))
    except Exception:  # noqa: BLE001 - any GPU trouble is just "not usable"
        return False


async def _gpu_forward(gpu: object, plan: object) -> np.ndarray | None:
    """Run the forward FFT core on the GPU; returns the padded real volume.

    The complex intermediates never touch the wasm heap — only the compact
    input (float32) goes up and the padded real result (float32) comes back.
    """
    from pyodide.ffi import create_proxy, to_js  # type: ignore[import-not-found]  # noqa: PLC0415

    data32 = np.ascontiguousarray(plan.data, dtype=np.float32)  # type: ignore[attr-defined]
    plan.data = np.empty((0, 0, 0), dtype=np.float32)  # type: ignore[attr-defined]
    padded = [int(x) for x in plan.padded_shape]  # type: ignore[attr-defined]
    lo = [int(pw[0]) for pw in plan.pad_width]  # type: ignore[attr-defined]
    out = np.zeros(tuple(padded), dtype=np.float32)
    dp, op = create_proxy(data32), create_proxy(out)
    try:
        ok = await gpu.forwardDpdf(  # type: ignore[attr-defined]
            dp, op, to_js([int(x) for x in data32.shape]), to_js(padded),
            to_js(lo))
    finally:
        dp.destroy()
        op.destroy()
    if not bool(ok):
        plan.data = data32  # type: ignore[attr-defined]  # restore for CPU retry
        return None
    return out


async def _gpu_inverse(gpu: object, dpdf: object) -> HKLVolume | None:
    """Run the inverse FFT core on the GPU; returns the reconstruction.

    Consumes ``dpdf.data`` (the padded ΔPDF) once uploaded — the CPU fallback
    path recomputes the ΔPDF from disk if the GPU refuses mid-way.
    """
    from pyodide.ffi import create_proxy, to_js  # type: ignore[import-not-found]  # noqa: PLC0415

    from nebula3d.analysis.delta_pdf import _finish_inverse  # noqa: PLC0415

    padded = [int(x) for x in dpdf.data.shape]  # type: ignore[attr-defined]
    crop_lo = [int(pw[0]) for pw in dpdf.pad_width]  # type: ignore[attr-defined]
    out_shape = [int(x) for x in dpdf.cropped_shape]  # type: ignore[attr-defined]
    data32 = np.ascontiguousarray(dpdf.data, dtype=np.float32)  # type: ignore[attr-defined]
    dpdf.data = np.empty((0, 0, 0), dtype=np.float32)  # type: ignore[attr-defined]
    out = np.zeros(tuple(out_shape), dtype=np.float32)
    dp, op = create_proxy(data32), create_proxy(out)
    try:
        ok = await gpu.inverseDpdf(  # type: ignore[attr-defined]
            dp, op, to_js(padded), to_js(crop_lo), to_js(out_shape))
    finally:
        dp.destroy()
        op.destroy()
    if not bool(ok):
        return None
    del data32
    prep = out + dpdf.subtracted_mean  # type: ignore[attr-defined]
    return _finish_inverse(dpdf, prep, deapodize=True,  # type: ignore[arg-type]
                           add_back_smooth_bg=True, window_floor=1e-3)


def _cb_emit(cb: object, stage: str, status: str, fraction: float | None,
             message: str) -> None:
    if cb is not None:
        cb(stage, status, fraction, message)  # type: ignore[operator]


async def _run_pdf_stages_gpu(
    params: object, stages: tuple[str, ...], force: bool,
    force_from: str | None, cb: object, gpu: object,
) -> bool:
    """pdf + pdf_check with the GPU FFT core (mirrors run_pipeline's blocks).

    Returns False whenever the GPU cannot serve this volume — the caller then
    runs the same stages through the normal CPU ``run_pipeline`` path.
    """
    from nebula3d.analysis.delta_pdf import (  # noqa: PLC0415
        DeltaPDF,
        _finish_forward,
        _prepare_forward,
    )
    from nebula3d.core import low_memory  # noqa: PLC0415
    from nebula3d.pipeline import _drop_sigma, _pdf_is_current  # noqa: PLC0415

    cfg = _require_cfg()
    assert _S.input is not None
    paths = pipeline_paths(_S.input, proc_dir=cfg.processed_dir,
                           flatten_enabled=params.flatten_enabled)  # type: ignore[attr-defined]
    p = params.delta_pdf  # type: ignore[attr-defined]

    def forced(stage: str) -> bool:
        if force:
            return True
        if force_from is not None and force_from in STAGES:
            return STAGES.index(stage) >= STAGES.index(force_from)
        return False

    pdf_input = paths.pdf_input
    if not pdf_input.exists():
        return False  # pass-through subtleties → CPU path resolves them
    gpu_cfg = delta_pdf_transform_config(p) + _GPU_FFT_TOKEN

    async def forward_dpdf(vol: HKLVolume) -> DeltaPDF | None:
        plan = _prepare_forward(
            vol, apodization=p.apodization, gaussian_sigma=p.gaussian_sigma,
            zero_pad=p.zero_pad, subtract_mean=p.subtract_mean,
            real_space_angstrom=True, crop_hkl=p.crop_hkl, q_band=p.q_band,
            subtract_smooth_bg=p.subtract_smooth_bg, fast_len=_five_smooth)
        padded_real = await _gpu_forward(gpu, plan)
        if padded_real is None:
            return None
        return _finish_forward(plan, padded_real)

    dpdf: DeltaPDF | None = None
    pdf_vol: HKLVolume | None = None
    if "pdf" in stages:
        is_current = _pdf_is_current(paths.delta_pdf, pdf_input.name, gpu_cfg)
        if is_current and not forced("pdf"):
            _cb_emit(cb, "pdf", "skip", None,
                     f"{paths.delta_pdf.name} is current")
        else:
            if paths.delta_pdf.exists() and not is_current:
                _cb_emit(cb, "pdf", "progress", None,
                         f"{paths.delta_pdf.name} stale — recomputing")
            _cb_emit(cb, "pdf", "start", None,
                     f"3D-ΔPDF FFT (apodize={p.apodization}) [WebGPU]")
            pdf_vol = nebula3d.load(pdf_input, dtype=params.np_dtype())  # type: ignore[attr-defined]
            dpdf = await forward_dpdf(pdf_vol)
            if dpdf is None:
                return False
            write_delta_pdf_h5(dpdf, pdf_vol, p, pdf_input.name,
                               paths.delta_pdf, transform_config=gpu_cfg)
            _cb_emit(cb, "pdf", "done", 1.0,
                     f"ΔPDF complete (|Q|max {dpdf.q_max:.2f} Å⁻¹, "
                     f"shape {dpdf.data.shape}) [WebGPU]")
            if low_memory():
                pdf_vol = _drop_sigma(pdf_vol)

    if "pdf_check" in stages and params.pdf_check_enabled:  # type: ignore[attr-defined]
        # The browser writes no figure (see below), so only the JSON counts.
        outputs_exist = paths.pdf_check_json.exists()
        if dpdf is None and outputs_exist and not forced("pdf_check"):
            _cb_emit(cb, "pdf_check", "skip", None,
                     f"{paths.pdf_check_json.name} exists")
            return True
        _cb_emit(cb, "pdf_check", "start", None,
                 "back-FFT round-trip consistency check [WebGPU]")
        if pdf_vol is None:
            pdf_vol = nebula3d.load(pdf_input, dtype=params.np_dtype())  # type: ignore[attr-defined]
            if low_memory():
                pdf_vol = _drop_sigma(pdf_vol)
        if dpdf is None:
            dpdf = await forward_dpdf(pdf_vol)
            if dpdf is None:
                return False
        recon = await _gpu_inverse(gpu, dpdf)
        if recon is None:
            return False
        # figure_path=None: the PNG is a native-only artifact (nothing in the
        # web app reads it) and rendering it would drag matplotlib (~9 MB of
        # wheels) into the Pyodide boot.
        metrics = pdf_consistency_check(
            pdf_vol, dpdf, p, figure_path=None, recon=recon)
        paths.pdf_check_json.parent.mkdir(parents=True, exist_ok=True)
        paths.pdf_check_json.write_text(json.dumps(metrics, indent=2))
        _cb_emit(cb, "pdf_check", "done", 1.0,
                 f"back-FFT vs data: r={metrics['pearson_r']:.5f}, "
                 f"normalised RMS={metrics['normalized_rms']:.3e}")
    elif "pdf_check" in stages:
        _cb_emit(cb, "pdf_check", "skip", None, "consistency check disabled")
    return True



# ---------------------------------------------------------------------------
# JSON helpers (sanitise non-finite floats so JSON.parse in the browser is happy)
# ---------------------------------------------------------------------------
def _finite(obj: object) -> object:
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _finite(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finite(v) for v in obj]
    return obj


def _json(obj: object) -> str:
    return json.dumps(_finite(obj))


# ---------------------------------------------------------------------------
# Datasets
# ---------------------------------------------------------------------------
def datasets_json() -> str:
    """List discovered datasets + per-stage status (mirrors GET /api/datasets)."""
    cfg = _require_cfg()
    out = []
    for ds in _ds.discover_datasets(cfg):
        stages = [
            {"name": s.name, "exists": s.exists, "kind": s.kind,
             "volume_id": f"{ds.id}.{s.name}"}
            for s in ds.stages
        ]
        out.append({
            "id": ds.id, "temperature": ds.temperature, "raw_name": ds.raw_name,
            "stem": ds.stem, "stages": stages,
        })
    return _json(out)


def bragg_profile_json(dataset_id: str) -> str:
    """Per-peak Bragg punch metadata (mirrors GET /api/bragg/{id}/profile).

    The punch stage writes ``*_profile.json`` next to its output volume — in
    the browser that is the Pyodide virtual FS — so this only re-reads a small
    JSON file.  The ``has_profile: false`` shape matches the native
    ``BraggProfileOut`` defaults so the viewer's empty states are identical.
    """
    cfg = _require_cfg()
    ds = _ds.find_dataset(cfg, dataset_id)
    if ds is None:
        raise KeyError(f"unknown dataset id {dataset_id!r}")
    path = pipeline_paths(ds.raw_path, proc_dir=cfg.processed_dir).bragg_profile_json
    if not path.exists():
        return _json({
            "dataset_id": dataset_id, "profile_path": str(path),
            "has_profile": False, "schema_version": 1,
            "width_labels": [], "hkl_width_labels": [], "width_units": {},
            "n_peaks": 0, "fit_covariance": False, "punch_frame": None,
            "peaks": [],
        })
    data = json.loads(path.read_text(encoding="utf-8"))
    return _json({
        "dataset_id": dataset_id,
        "profile_path": str(path),
        "has_profile": True,
        "schema_version": int(data.get("schema_version", 1)),
        "width_labels": list(data.get("width_labels", [])),
        "hkl_width_labels": list(data.get("hkl_width_labels", [])),
        "width_units": dict(data.get("width_units", {})),
        "n_peaks": int(data.get("n_peaks", 0)),
        "fit_covariance": bool(data.get("fit_covariance", False)),
        "punch_frame": data.get("punch_frame"),
        "peaks": list(data.get("peaks", [])),
    })


def _resolve(volume_id: str, kind: str) -> _ds.StageStatus:
    cfg = _require_cfg()
    stage = _ds.resolve_volume(cfg, volume_id)
    if stage is None:
        raise KeyError(f"unknown volume id {volume_id!r}")
    if not stage.path.exists():
        raise FileNotFoundError(f"stage output not found for {volume_id!r}")
    if stage.kind != kind:
        raise ValueError(f"{volume_id!r} is a {stage.kind} volume, expected {kind}")
    return stage


# ---------------------------------------------------------------------------
# Reciprocal-space (HKL) volumes
# ---------------------------------------------------------------------------
def volume_meta_json(volume_id: str) -> str:
    """Metadata for an HKL stage (mirrors GET /api/volumes/{id}/meta)."""
    _release_other_caches("vol")  # entering the cleanup view: drop ΔPDF/consistency
    stage = _resolve(volume_id, "hkl")
    m = _vol.volume_meta(stage.path)
    m.update(id=volume_id, stage=stage.name, kind=stage.kind)
    return _json(m)


def volume_slice(volume_id: str, plane: str, value: float, interp: bool = False
                 ) -> bytes:
    """Binary slice envelope of an HKL stage (mirrors /api/volumes/{id}/slice)."""
    stage = _resolve(volume_id, "hkl")
    return _vol.slice_envelope(stage.path, plane=plane, value=float(value),
                               interp=bool(interp))


# ---------------------------------------------------------------------------
# Real-space ΔPDF
# ---------------------------------------------------------------------------
def dpdf_meta_json(volume_id: str) -> str:
    """Metadata for a ΔPDF stage (mirrors GET /api/deltapdf/{id}/meta)."""
    _release_other_caches("dpdf")  # entering the ΔPDF view: drop cleanup/consistency
    stage = _resolve(volume_id, "delta_pdf")
    m = _dpdf.dpdf_meta(stage.path)
    m["id"] = volume_id
    return _json(m)


def dpdf_slice(volume_id: str, plane: str, value: float) -> bytes:
    """Binary slice envelope of a ΔPDF stage (mirrors /api/deltapdf/{id}/slice)."""
    stage = _resolve(volume_id, "delta_pdf")
    return _dpdf.dpdf_slice_envelope(stage.path, plane=plane, value=float(value))


# ---------------------------------------------------------------------------
# Back-FFT consistency check
# ---------------------------------------------------------------------------
def _band(lo: float | None, hi: float | None) -> tuple[float, float] | None:
    return (float(lo), float(hi)) if lo is not None and hi is not None else None


def _pdf_input(dataset_id: str) -> Path:
    cfg = _require_cfg()
    path = _cons.pdf_input_path(cfg, dataset_id)
    if path is None:
        raise FileNotFoundError(
            f"no ΔPDF-input volume (flattened/backfilled) for {dataset_id!r}")
    return path


def consistency_meta_json(
    dataset_id: str,
    q_min: float | None = None,
    q_max: float | None = None,
    r_min: float | None = None,
    r_max: float | None = None,
) -> str:
    """Consistency grid + agreement metrics (mirrors /api/consistency/{id}/meta)."""
    path = _pdf_input(dataset_id)
    # The back-FFT round trip is the heaviest interactive computation (a forward
    # AND inverse 3-D FFT plus its comparison volumes).  Free the off-screen
    # views' caches first — the ΔPDF cache and the cleanup slice volumes are not
    # needed here, and in the 4 GB WASM heap (which never shrinks after a
    # pipeline run) that headroom is what keeps the round trip from OOM-ing.  The
    # reconstruction reloads its one input volume behind the FFT it is about to
    # run; the consistency cache itself is kept (the reconstruction manages its
    # own eviction).
    _release_other_caches("cons")
    meta = _cons.consistency_meta(path, _band(q_min, q_max), _band(r_min, r_max))
    return _json(meta)


def consistency_slice(
    dataset_id: str,
    panel: str,
    plane: str,
    value: float,
    q_min: float | None = None,
    q_max: float | None = None,
    r_min: float | None = None,
    r_max: float | None = None,
) -> bytes:
    """Binary slice envelope of one comparison panel (data/recon/residual/dpdf)."""
    path = _pdf_input(dataset_id)
    return _cons.consistency_slice_envelope(
        path, _band(q_min, q_max), _band(r_min, r_max),
        panel=panel, plane=plane, value=float(value))


def save_dpdf(
    dataset_id: str,
    q_min: float | None = None,
    q_max: float | None = None,
    r_min: float | None = None,
    r_max: float | None = None,
) -> bytes:
    """Band-limited ΔPDF ``.h5`` as a download envelope
    (``[uint32 LE header_len][JSON {"filename"}][h5 bytes]``).

    Mirrors POST /api/consistency/{id}/save, but the browser build has no disk
    to save to: the file is written to the virtual FS, read back, unlinked (to
    reclaim MEMFS space and keep dataset discovery clean), and handed to JS,
    which turns it into a browser download.
    """
    cfg = _require_cfg()
    path = _pdf_input(dataset_id)
    out = _cons.save_reconstruction(
        path, _band(q_min, q_max), _band(r_min, r_max), cfg.processed_dir)
    payload = out.read_bytes()
    out.unlink()
    header = json.dumps({"filename": out.name}).encode("utf-8")
    return struct.pack("<I", len(header)) + header + payload
