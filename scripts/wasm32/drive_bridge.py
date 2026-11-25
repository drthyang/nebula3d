# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""Run by run_bridge.mjs inside Pyodide: the bridge's stages and analysis calls
on the synthetic demo volume, one line per call (OK/FAIL, seconds, heap)."""

import json
import os
import time
import traceback
from collections.abc import Callable
from typing import TypeVar

import pyodide_js  # type: ignore[import-not-found]

from nebula3d import webbridge as wb

N = int(os.environ.get("NEB_N", "161"))
PARAMS = os.environ.get("NEB_PARAMS", "{}")
MIN = os.environ.get("NEB_ENDPOINTS") == "min"

#: The analysis calls made on each stage's volume (the stages they apply to).
PLAN = {
    "raw": [] if MIN else ["coverage", "ub_check", "ring_survey", "shell_floors",
                           "laue_compare", "bragg_sense"],
    "backfilled": ["texture"],
    "flattened": ["bragg_sense", "shell_floors", "coverage"]
                 + ([] if MIN else ["laue_compare"]),
}
CALLS = {
    "coverage": wb.volume_coverage_json,
    "ub_check": wb.volume_ub_check_json,
    "ring_survey": wb.volume_ring_survey_json,
    "shell_floors": wb.volume_shell_floors_json,
    "laue_compare": wb.volume_laue_compare_json,
    "bragg_sense": wb.volume_bragg_sense_json,
    "texture": wb.volume_texture_json,
}

T = TypeVar("T")
lines: list[str] = []


def heap() -> str:
    return f"{pyodide_js._module.HEAP8.length / 2**30:.2f} GiB"


def step(name: str, fn: Callable[[], T]) -> T | None:
    t = time.time()
    try:
        out = fn()
        lines.append(f"OK   {name} {time.time() - t:.1f}s heap {heap()}")
        return out
    except Exception:
        lines.append(f"FAIL {name} {time.time() - t:.1f}s heap {heap()}\n"
                     + traceback.format_exc()[-1500:])
        return None


wb.setup("/work")
ds = step(f"make_demo_input({N})", lambda: wb.make_demo_input(N))
for stage in wb.STAGES:
    step(f"run {stage}", lambda: wb.run(stage, PARAMS, True))

listed = json.loads(wb.dataset_json(ds))["stages"]
hkl = [f"{ds}.{s['name']}" for s in listed if s.get("kind") == "hkl" and s.get("exists")]
pdf = [f"{ds}.{s['name']}" for s in listed if s.get("kind") == "delta_pdf" and s.get("exists")]
cuts3 = json.dumps([["hk", 0.0, False], ["kl", 0.0, False], ["hl", 0.0, False]])
cuts2 = json.dumps([["hk", 0.0], ["kl", 0.0], ["hl", 0.0]])
for v in hkl:
    step(f"{v} slices", lambda: wb.volume_slices(v, cuts3))
    for call in PLAN.get(v.rsplit(".", 1)[-1], []):
        step(f"{v} {call}", lambda: CALLS[call](v))
for v in pdf:
    step(f"{v} dpdf_slices", lambda: wb.dpdf_slices(v, cuts2))
    step(f"{v} dpdf_features", lambda: wb.dpdf_features_json(v))
step("bragg_profile", lambda: wb.bragg_profile_json(ds))
step("ring_diagnostics", lambda: wb.ring_diagnostics_json(ds))
step("consistency_check", lambda: wb.consistency_check_json(ds))
step("regrid", lambda: wb.dataset_regrid_json(ds))
lines.append(f"peak heap {heap()}")
"\n".join(lines)
