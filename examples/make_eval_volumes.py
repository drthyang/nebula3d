#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""Write the held-out eval volumes: synthetic, never tuned on, one fault each.

From a variant of the demo crystal (nebula3d.demo) that no eval was written
on, this writes into DATA_ROOT/raw:

- heldout-rocksalt.nxs: the variant, clean;
- heldout-misoriented.nxs: its UB turned by 0.6° about [1 1 0];
- heldout-shifted.nxs: its HKL origin off by (0.03, 0.02, 0) r.l.u.;
- heldout-coverage.nxs: no counts past 70 % of the box's inscribed |Q|;
- heldout-rings.nxs: powder rings at 2.45 and 3.65 Å⁻¹, where no Al ring is.

Each fault's size is the known answer the held-out scenarios grade against
(web/src/llm/evals/heldout.ts). Usage:

    DATA_ROOT=/path/to/root python examples/make_eval_volumes.py
"""

import os
from pathlib import Path

import numpy as np

import nebula3d
from nebula3d import faults
from nebula3d.analysis.coverage import q_coverage
from nebula3d.demo import DemoModel, demo_volume

#: The faults' sizes: the scenarios' known answers.
MISORIENT_DEG = 0.6
MISORIENT_AXIS = (1.0, 1.0, 0.0)
ORIGIN_OFFSET = (0.03, 0.02, 0.0)
COVERAGE_FRACTION = 0.7
RING_Q = (2.45, 3.65)


def main() -> None:
    root = Path(os.environ.get("DATA_ROOT", "data-eval"))
    raw = root / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    (root / "processed").mkdir(exist_ok=True)
    # A variant of the demo crystal: another cell, stronger order, another seed.
    model = DemoModel(a=3.9, sro_amp=0.09, ring_amp=0.0)
    base = demo_volume(161, seed=7, model=model, dtype=np.float32)
    q_cut = COVERAGE_FRACTION * q_coverage(base).box_q
    volumes = {
        "heldout-rocksalt": base,
        "heldout-misoriented": faults.misorient(base, MISORIENT_DEG, MISORIENT_AXIS),
        "heldout-shifted": faults.shift_origin(base, ORIGIN_OFFSET),
        "heldout-coverage": faults.cut_coverage(base, q_cut),
        "heldout-rings": faults.add_rings(base, RING_Q, amplitude=0.6, width=0.03),
    }
    for name, vol in volumes.items():
        nebula3d.save(vol, raw / f"{name}.nxs")
        print(f"{raw / name}.nxs")
    print(f"coverage cut at {q_cut:.3f} Å⁻¹")


if __name__ == "__main__":
    main()
