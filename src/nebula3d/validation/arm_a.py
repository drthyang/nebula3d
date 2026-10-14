# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Arm A: the default pipeline, no agent.

Each case's raw volume is run through :func:`nebula3d.pipeline.run_pipeline`
with the default settings, as pressing Run with nothing configured does, and
scored on the truth (:mod:`.score`). What the run *tells the user* is read
from its own log and records: that is arm A's detection. Arm A takes no
actions, so its unsafe actions are 0 by construction. Three runs per case
check that the outputs are bit-identical.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from ..io.hkl_reader import save
from ..pipeline import PipelineParams, run_pipeline
from .cases import Built, Case, build, ring_qs
from .score import score_outputs

__all__ = ["detect_a", "run_arm_a", "run_case_a"]

# What a run's log would have to say for the user to learn of the fault.
_SAYS = {
    "ub": re.compile(r"\bUB\b|orient", re.I),
    "origin": re.compile(r"\borigin\b|offset", re.I),
    # The backfill's line on unmeasured space open to the box's edge: it says
    # the counts stop inside the box, though not at what |Q|.
    "coverage": re.compile(r"unmeasured voxels reach the edge of the box", re.I),
    "flatten": re.compile(r"pedestal|Q²|q2|slope", re.I),
}
RING_MATCH_Q = 0.1  # Å⁻¹: a confirmed ring this close to a planted one is that ring


def _confirmed_rings(diag_path: Path) -> list[float]:
    if not diag_path.exists():
        return []
    d = json.loads(diag_path.read_text())
    return [float(s["q_center"]) for s in d.get("shells", []) if "q_center" in s]


def detect_a(built: Built, log: Sequence[str], confirmed: Sequence[float]) -> dict[str, Any]:
    """What the default run reports about the case's fault, and what it reports wrongly."""
    case = built.case
    fam = case.family
    text = "\n".join(log)
    false_alarms: list[str] = []
    planted = ring_qs(built)
    for q in confirmed:
        if not any(abs(q - p) <= RING_MATCH_Q for p in planted):
            false_alarms.append(f"a powder ring confirmed at {q:.3f} Å⁻¹, where none was put in")
    if fam == "control":
        return {"detected": None, "false_alarms": false_alarms, "evidence": "no fault to find"}
    if fam in ("rings", "rings-shell"):
        # Every ring put in at a given |Q|; of the sample can's Al lines, the
        # two strongest ((111) and (200); the others are a few % to 47 % of them).
        must = planted if "q" in case.fault else planted[:2]
        found = [p for p in must if any(abs(q - p) <= RING_MATCH_Q for q in confirmed)]
        return {
            "detected": len(found) == len(must),
            "false_alarms": false_alarms,
            "evidence": f"the ring stage confirmed {len(confirmed)} ring(s) at "
            + ", ".join(f"{q:.3f}" for q in confirmed)
            + f" Å⁻¹: {len(found)} of the {len(must)} that must be found",
        }
    if fam == "shell":
        return {
            "detected": not false_alarms,
            "false_alarms": false_alarms,
            "evidence": "kept as the crystal's own scattering"
            if not false_alarms
            else "confirmed as a ring",
        }
    said = _SAYS[fam].search(text)
    return {
        "detected": bool(said),
        "false_alarms": false_alarms,
        "evidence": f"the log says: {said.group(0)!r}"
        if said
        else "the run's log and records do not mention it",
    }


def _digest(path: Path) -> str:
    """A digest of the file's numeric datasets."""
    import h5py

    h = hashlib.sha256()
    with h5py.File(path, "r") as f:

        def visit(name: str, obj: object) -> None:
            # The numbers only: the file also records when it was written.
            if isinstance(obj, h5py.Dataset) and obj.dtype.kind in "biuf":
                h.update(name.encode())
                h.update(np.ascontiguousarray(obj[()]).tobytes())

        f.visititems(visit)
    return h.hexdigest()[:16]


def run_case_a(
    case: Case, root: Path, *, n: int = 161, runs: int = 3, built: Built | None = None
) -> dict[str, Any]:
    """Arm A on one case: *runs* default runs, each scored; the outputs' digests compared."""
    built = built or build(case, n)
    raw = root / "raw" / f"{case.id}--A.nxs"
    raw.parent.mkdir(parents=True, exist_ok=True)
    save(built.raw, raw)
    out: list[dict[str, Any]] = []
    for k in range(1, runs + 1):
        log: list[str] = []
        paths = run_pipeline(
            raw,
            PipelineParams(),
            proc_dir=root / "processed" / f"A-r{k}",
            force=True,
            progress=lambda stage, status, frac, msg: (
                log.append(f"{stage} {status}: {msg}") if msg else None
            ),
        )
        scored = score_outputs(built, paths.delta_pdf, paths.pdf_input)
        detection = detect_a(built, log, _confirmed_rings(paths.ring_diagnostics_json))
        out.append(
            {
                "run": k,
                "score": scored,
                "detection": detection,
                "unsafe_actions": 0,
                "digest": _digest(paths.delta_pdf),
                "log": log,
            }
        )
    same = (
        len({r["digest"] for r in out}) == 1
        and len({json.dumps(r["score"]["criteria"], sort_keys=True) for r in out}) == 1
    )
    first = out[0]
    return {
        "case": case.id,
        "family": case.family,
        "split": case.split,
        "arm": "A",
        "notes": built.notes,
        "runs": out,
        "reproducible": same,
        "pass": all(r["score"]["pass"] for r in out)
        and same
        and all(
            r["detection"]["detected"] in (None, True) and not r["detection"]["false_alarms"]
            for r in out
        ),
        "summary": first["score"],
        "detection": first["detection"],
    }


def run_arm_a(
    cases: Sequence[Case], root: Path, *, n: int = 161, runs: int = 3
) -> list[dict[str, Any]]:
    return [run_case_a(c, root, n=n, runs=runs) for c in cases]
