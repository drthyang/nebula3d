# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""Write the synthetic demo volume at a realistic size, for the native console.

The demo crystal (nebula3d.demo, simulated and not measured data) on an
``n`` x ``n`` grid over +-4 r.l.u. in H and K, with ``nl`` L planes about
L = 0 (the same step), saved where ``nebula3d-web --data-root`` reads raw
volumes. The default is 401 x 401 x 301, the size of a measured volume the
console must handle (scripts/pilot_memory_check.mjs runs on it):

    PYTHONPATH=src python scripts/demo/synthetic_volume.py <data-root> [n] [nl]

Building takes a few seconds; writing the file (float64 on disk, as the
Mantid layout requires) takes a few minutes at the default size.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np

import nebula3d
from nebula3d.core import HKLVolume
from nebula3d.demo import DemoModel, demo_volume


def main() -> None:
    root = Path(sys.argv[1])
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 401
    nl = int(sys.argv[3]) if len(sys.argv) > 3 else 301
    if nl > n or (n - nl) % 2:
        raise SystemExit("nl must be at most n and differ from it by an even number")
    full = demo_volume(n, dtype=np.float32)
    lo = (n - nl) // 2
    step = 8.0 / (n - 1)
    half_l = step * (nl - 1) / 2
    data = np.ascontiguousarray(full.data[:, :, lo:lo + nl])
    sigma = np.ascontiguousarray(full.sigma[:, :, lo:lo + nl])
    del full
    rs = 2 * math.pi / DemoModel().a
    vol = HKLVolume.from_arrays(data, (-4.0, 4.0), (-4.0, 4.0), (-half_l, half_l),
                                sigma=sigma, ub_matrix=rs * np.eye(3))
    raw = root / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    (root / "processed").mkdir(exist_ok=True)
    dest = raw / f"synthetic_rocksalt_{n}x{n}x{nl}.nxs"
    nebula3d.save(vol, dest)
    print(dest)


if __name__ == "__main__":
    main()
