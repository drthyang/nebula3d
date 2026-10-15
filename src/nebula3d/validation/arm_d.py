# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Arm D: the planted truth.

The case's own noise-free diffuse scattering, on the support its raw volume
measures, through the default 3D-ΔPDF transform, scored like any other arm. It
is the reference the others are held to, and a check on the scorer: it must
pass every criterion on every case (a coverage cut leaves it a ΔPDF whose
unresolvable features no arm is judged on, :func:`.score.resolved_features`).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np

from ..io.hkl_reader import save
from ..pipeline import DeltaPdfParams, delta_pdf, write_delta_pdf_h5
from .cases import Built, Case, build
from .score import score_outputs

__all__ = ["run_arm_d", "run_case_d"]


def run_case_d(
    case: Case, root: Path, *, n: int = 161, built: Built | None = None
) -> dict[str, Any]:
    built = built or build(case, n)
    root.mkdir(parents=True, exist_ok=True)
    vol = replace(
        built.truth, data=built.truth.data, mask=np.asarray(built.raw.mask, dtype=bool).copy()
    )
    src = root / f"{case.id}--D_flattened.h5"
    save(vol, src)
    params = DeltaPdfParams()
    out = root / f"{case.id}--D_delta_pdf.h5"
    write_delta_pdf_h5(delta_pdf(vol, params), vol, params, src.name, out)
    scored = score_outputs(built, out, src)
    return {
        "case": case.id,
        "family": case.family,
        "split": case.split,
        "arm": "D",
        "summary": scored,
        "pass": scored["pass"],
    }


def run_arm_d(cases: Sequence[Case], root: Path, *, n: int = 161) -> list[dict[str, Any]]:
    return [run_case_d(c, root, n=n) for c in cases]
