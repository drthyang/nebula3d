#!/usr/bin/env python
"""Per-stage peak-RSS profile of the full reduction — the memory twin of
``scripts/profile_pipeline.py``.

Runs each pipeline stage in sequence with default params (respecting
``NEBULA3D_LOW_MEMORY``), sampling process RSS from a background thread, and
prints a per-stage peak table in bytes and B/voxel — the numbers behind the
browser admission gate (``webbridge._PIPELINE_PEAK_BYTES_PER_VOXEL``) and the
ROADMAP per-stage figures.  Optionally writes the table as JSON.

    NEBULA3D_LOW_MEMORY=1 python scripts/measure_stage_peaks.py raw.nxs [out.json]

Residency mirrors ``run_pipeline``'s in-memory pass-through: each stage's input
volume is dropped as soon as the stage returns, and the consistency check
consumes the ΔPDF (``consume_dpdf=True``) exactly as the browser path does.

Sampling uses ``psutil`` when available (true per-stage peaks); without it the
script falls back to ``resource.getrusage`` ru_maxrss, which is a *cumulative*
high-water mark — later stages then only report peaks when they exceed every
earlier stage's (still enough to identify the binding stage).
"""

from __future__ import annotations

import functools
import json
import os
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

import numpy as np

import nebula3d
from nebula3d.analysis.delta_pdf import compute_delta_pdf
from nebula3d.pipeline import (
    DeltaPdfParams,
    backfill,
    flatten,
    pdf_consistency_check,
    punch_bragg,
    remove_rings,
)

_T = TypeVar("_T")

_SAMPLE_S = 0.02

try:
    import psutil

    _PROC = psutil.Process()

    def _rss() -> int:
        return int(_PROC.memory_info().rss)

    _CUMULATIVE = False
except ImportError:  # pragma: no cover - depends on env
    import resource

    def _rss() -> int:
        ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports bytes, Linux kilobytes.
        return int(ru if sys.platform == "darwin" else ru * 1024)

    _CUMULATIVE = True


class _Sampler:
    """Background RSS sampler; peak() is the max seen since the last reset."""

    def __init__(self) -> None:
        self._peak = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.is_set():
            self._peak = max(self._peak, _rss())
            time.sleep(_SAMPLE_S)

    def reset(self) -> None:
        self._peak = _rss()

    def peak(self) -> int:
        self._peak = max(self._peak, _rss())
        return self._peak

    def stop(self) -> None:
        self._stop.set()
        self._thread.join()


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    path = Path(sys.argv[1])
    out_json = Path(sys.argv[2]) if len(sys.argv) > 2 else None

    sampler = _Sampler()
    peaks: dict[str, int] = {}
    times: dict[str, float] = {}

    def staged(label: str, fn: Callable[[], _T]) -> _T:
        sampler.reset()
        t0 = time.perf_counter()
        out = fn()
        times[label] = time.perf_counter() - t0
        peaks[label] = sampler.peak()
        print(f"  {label:<18} peak {peaks[label]/1e9:7.2f} GB   {times[label]:8.2f} s")
        return out

    # functools.partial (not lambdas) so each stage's input volume can be
    # released with `del` without pyflakes seeing a deferred use-after-del.
    # NEBULA3D_MEASURE_DTYPE=float32 measures the reduced-precision mode
    # (the browser default); anything else measures float64.
    dtype = (np.float32 if os.environ.get("NEBULA3D_MEASURE_DTYPE") == "float32"
             else np.float64)
    print(f"Loading {path.name} …  (cumulative-watermark fallback: {_CUMULATIVE}, "
          f"dtype: {np.dtype(dtype).name})")
    vol = staged("load", functools.partial(nebula3d.load, path, dtype=dtype))
    n_vox = int(vol.data.size)
    print(f"  grid {vol.data.shape}  ({n_vox/1e6:.1f} M voxels)\n")

    v1 = staged("rings", functools.partial(remove_rings, vol))
    del vol
    v2 = staged("punch", functools.partial(punch_bragg, v1))
    del v1
    v3 = staged("backfill", functools.partial(backfill, v2))
    del v2
    v4 = staged("flatten", functools.partial(flatten, v3))
    del v3
    dpdf = staged("pdf", functools.partial(compute_delta_pdf, v4))
    metrics = staged(
        "pdf_check",
        functools.partial(pdf_consistency_check, v4, dpdf, DeltaPdfParams(),
                          consume_dpdf=True),
    )
    sampler.stop()

    print(f"\n  consistency r = {metrics['pearson_r']:.5f}")
    print(f"\n  {'stage':<12}{'peak GB':>10}{'B/voxel':>10}")
    table = {}
    for k, v in peaks.items():
        table[k] = {"peak_bytes": v, "bytes_per_voxel": v / n_vox,
                    "seconds": times[k]}
        print(f"  {k:<12}{v/1e9:>10.2f}{v/n_vox:>10.1f}")
    binding = max(peaks, key=lambda k: peaks[k])
    print(f"\n  binding stage: {binding} "
          f"({peaks[binding]/1e9:.2f} GB, {peaks[binding]/n_vox:.1f} B/voxel)")

    if out_json is not None:
        out_json.write_text(json.dumps({
            "input": str(path), "voxels": n_vox, "cumulative": _CUMULATIVE,
            "stages": table, "binding_stage": binding,
        }, indent=2))
        print(f"  wrote {out_json}")


if __name__ == "__main__":
    main()
