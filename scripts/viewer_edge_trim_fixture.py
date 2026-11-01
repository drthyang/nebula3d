#!/usr/bin/env python
"""Pin the NeXus Viewer's coverage-edge erosion in a test fixture.

Writes ``tests/fixtures/viewer_edge_trim.json``: what the viewer's own code
(``js/mask.js`` ``edgeMask``, after ``js/nexus.js`` loads the file) keeps of
the inputs ``tests/test_edge_trim.py`` builds (``EDGE_CASES``), saved as
NEBULA3D writes volumes, for erosion radii 0 to 3: the voxels it keeps
(finite, unmasked, not within r voxels of an unmeasured one) as zlib-packed
bytes in base64, and its counts.  The test compares NEBULA3D's edge trim with
them bit for bit.  Needs node and a checkout of the viewer with its
node_modules:

    NEXUS_VIEWER=../neutron-nexus-viewer python scripts/viewer_edge_trim_fixture.py

Run it from the repository root, with ``src`` on ``PYTHONPATH``.
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import nebula3d  # noqa: E402
from tests.test_edge_trim import EDGE_CASES, RADII, edge_case  # noqa: E402

HARNESS = ROOT / "scripts" / "viewer_edge_trim.mjs"
OUT = ROOT / "tests" / "fixtures" / "viewer_edge_trim.json"


def main() -> None:
    fixture: dict = {"radii": list(RADII), "cases": {}}
    with tempfile.TemporaryDirectory() as tmp:
        for name in EDGE_CASES:
            src = Path(tmp) / f"{name}.nxs"
            nebula3d.save(edge_case(name), src)
            out = Path(tmp) / name
            subprocess.run(["node", str(HARNESS), str(src), str(out), *map(str, RADII)],
                           check=True, capture_output=True, text=True, cwd=ROOT)
            meta = json.loads((out / "meta.json").read_text())
            case = {"shape": meta["shape"], "stats": meta["stats"], "valid": {}}
            for r in RADII:
                valid = np.fromfile(out / f"valid_{r}.u8", dtype=np.uint8)
                case["valid"][str(r)] = base64.b64encode(
                    zlib.compress(np.packbits(valid).tobytes(), 9)).decode("ascii")
            fixture["cases"][name] = case
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KiB)")


if __name__ == "__main__":
    main()
