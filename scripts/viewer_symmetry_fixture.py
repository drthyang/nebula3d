#!/usr/bin/env python
"""Pin the NeXus Viewer's symmetry averaging in a test fixture.

Writes ``tests/fixtures/viewer_symmetry_average.json``: what the viewer's own
code (``js/export.js`` ``symmetrizeForExport``, ``js/symmetry.js``, ``js/nexus.js``)
makes of the inputs ``tests/test_symmetry_average.py`` builds (``viewer_case``),
saved as NEBULA3D writes volumes; the viewer's Laue presets and their closed
groups in its order; and its ``metricChange`` on the test's cells.  The
averaged values and the mask go in as base64 bytes, so the test compares them
bit for bit.  Needs node and a checkout of the viewer with its node_modules:

    NEXUS_VIEWER=../neutron-nexus-viewer python scripts/viewer_symmetry_fixture.py

Run it from the repository root, with ``src`` on ``PYTHONPATH``.
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import nebula3d  # noqa: E402
from tests.test_symmetry_average import (  # noqa: E402
    METRIC_CELLS,
    VIEWER_CASES,
    viewer_case,
)

HARNESS = ROOT / "scripts" / "viewer_symmetry_average.mjs"
OUT = ROOT / "tests" / "fixtures" / "viewer_symmetry_average.json"


def node(*args: str) -> str:
    return subprocess.run(["node", str(HARNESS), *args], check=True, capture_output=True,
                          text=True, cwd=ROOT).stdout


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def main() -> None:
    fixture: dict = {"presets": json.loads(node("presets")), "cases": {},
                     "metric": json.loads(node("metric", json.dumps(
                         [[list(cell), laue] for cell, laue in METRIC_CELLS])))}
    with tempfile.TemporaryDirectory() as tmp:
        for name, grid, laue in VIEWER_CASES:
            src = Path(tmp) / f"{grid}.nxs"
            if not src.exists():
                nebula3d.save(viewer_case(grid), src)
            out = Path(tmp) / name
            node("average", str(src), laue, str(out))
            meta = json.loads((out / "meta.json").read_text())
            if meta["padded"]:
                raise SystemExit(f"{name}: the viewer padded the grid; the cases need grids "
                                 "symmetric about 0")
            fixture["cases"][name] = {
                "grid": grid, "laue": laue, "shape": meta["shape"], "ops": meta["ops"],
                "stats": meta["stats"], "metric": meta["metric"],
                "data": b64(out / "data.f32"), "valid": b64(out / "valid.u8"),
                "sigma": b64(out / "sigma.f32"),
            }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KiB)")
    np.seterr(all="ignore")


if __name__ == "__main__":
    main()
