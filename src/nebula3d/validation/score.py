# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Scoring a run's outputs against a case's planted truth.

A run, by any arm, leaves the pipeline's outputs in a processed folder. This
scores them, the same way for every arm:

- **features**: each planted pair correlation, in the run's 3D-ΔPDF, against
  the truth (arm D): the crystal's own noise-free diffuse scattering put
  through the *same* transform (the run's settings, read from the ΔPDF's
  provenance, and the run's measured support). So the score is what the
  reduction lost or added, not what the transform's resolution does to any
  data;
- **window**: the share of the ΔPDF window's weight on unmeasured space;
- **rings left** and **diffuse kept**: at each powder ring the case put in,
  and on the crystal's own diffuse shell;
- **pedestal**: a |Q|-dependent background left by the flatten.

The tolerances are fixed here, before any model run, with the reason for
each. Nothing reads which arm made the outputs.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from ..analysis.delta_pdf import DeltaPDF
from ..core import HKLVolume
from ..io import DeltaPdfFile, load_delta_pdf
from ..io.hkl_reader import load
from ..pipeline import DeltaPdfParams, delta_pdf
from .cases import Built, orbit, planted_intensity, ring_qs

__all__ = ["TOLERANCES", "Tolerance", "score_outputs", "truth_dpdf"]


@dataclass(frozen=True)
class Tolerance:
    value: float
    why: str


#: Every pass/fail limit, and why. Changing one after a run invalidates the
#: runs scored before it (the docs list these values with the results).
TOLERANCES: Mapping[str, Tolerance] = {
    "amplitude_low": Tolerance(
        0.8,
        "A planted correlation must keep at least 80 % of its amplitude: a 20 % loss is the size "
        "of a Warren–Cowley parameter's change between neighbouring shells in a weakly ordered "
        "alloy, and would change a model fitted to it.",
    ),
    "amplitude_high": Tolerance(
        1.25, "…and gain at most 25 % (1/0.8, symmetric in the logarithm)."
    ),
    "position_voxels": Tolerance(
        0.25,
        "A peak's centre may move by a quarter of the ΔPDF's voxel (about 0.12 Å here): below "
        "that a shift cannot be told from the sub-voxel interpolation's own error; beyond it, it "
        "would read as a different bond length.",
    ),
    "open_weight": Tolerance(
        1e-3,
        "At most 1e-3 of the ΔPDF window's weight on unmeasured space: the limit the backend's "
        "own coverage-shrunk window keeps (qmax_coverage, tune_pipeline's outOfBounds).",
    ),
    "ring_left": Tolerance(
        0.15,
        "At most 15 % of a powder ring's contrast left after the removal: the bound the ring "
        "stage's own test holds (tests/test_faults.py). Provisional: the reduction-qc interview "
        "is to confirm it.",
    ),
    "shell_kept": Tolerance(
        0.85,
        "At least 85 % of the crystal's own diffuse shell kept: the same 15 % bound, the other "
        "way.",
    ),
    "pedestal_span": Tolerance(
        0.25,
        "A |Q|-dependent background left over 3.5 Å⁻¹ to the coverage edge may span at most a "
        "quarter of the crystal's diffuse level there; a larger slope biases any model fitted to "
        "the diffuse intensities. Provisional, as the flatten check's own span limit is.",
    ),
}

# The outer shells over which the pedestal is judged: past the demo
# background's low-|Q| rise and broad hump, which the default flatten keeps by
# design (it fits a constant), out to just inside the coverage.
PEDESTAL_Q_MIN = 3.5
SHELL_STEP = 0.1  # Å⁻¹


def _params_from(config: str) -> DeltaPdfParams:
    """The DeltaPdfParams a ΔPDF's ``transform_config`` stamp records."""
    kv = dict(part.split("=", 1) for part in config.split(";") if "=" in part)

    def tup(s: str) -> tuple[float, ...] | None:
        return tuple(float(x) for x in s.split(",")) if s else None

    bg = tup(kv.get("subtract_bg", ""))
    return DeltaPdfParams(
        apodization=kv.get("apodize", "gaussian"),
        gaussian_sigma=float(kv.get("gaussian_sigma", 0.4)),
        zero_pad=kv.get("zero_pad", "1") == "1",
        subtract_mean=kv.get("subtract_mean", "1") == "1",
        crop_hkl=tup(kv.get("crop_hkl", "")),  # type: ignore[arg-type]
        q_band=tup(kv.get("q_band", "")),  # type: ignore[arg-type]
        subtract_smooth_bg=(bg[0] if bg and len(bg) == 1 else bg),  # type: ignore[arg-type]
        window_shape=kv.get("window_shape", "auto"),
        window_support=kv.get("window_support", "1") == "1",
    )


def truth_dpdf(
    built: Built, support: NDArray[np.bool_], params: DeltaPdfParams, planted_only: bool = False
) -> DeltaPDF:
    """Arm D: the truth's ΔPDF through the run's transform, on the run's support
    (with *planted_only*, the planted correlations' share of it: the transform
    is linear)."""
    t = built.truth
    values = planted_intensity(t, built.case.crystal) if planted_only else t.data
    data = np.where(support, values, 0.0)
    return delta_pdf(replace(t, data=data, mask=support.copy()), params)


def _locate(
    data: NDArray[np.floating],
    axes: tuple[NDArray[np.float64], ...],
    r: NDArray[np.float64],
    sign: float,
    reach: float,
) -> tuple[float, NDArray[np.float64]]:
    """The extremum of *sign* within *reach* (Å) of *r*: its value and its
    position, refined along each axis by a parabola through three voxels."""
    idx = []
    for ax, c in zip(axes, r):
        step = float(ax[1] - ax[0])
        lo = max(int(math.floor((c - reach - ax[0]) / step)), 0)
        hi = min(int(math.ceil((c + reach - ax[0]) / step)) + 1, ax.size)
        idx.append(np.arange(lo, hi))
    block = sign * np.asarray(data[np.ix_(*idx)], dtype=np.float64)
    at = np.unravel_index(int(np.argmax(block)), block.shape)
    centre = [int(idx[d][at[d]]) for d in range(3)]
    pos = np.empty(3)
    for d, ax in enumerate(axes):
        i = centre[d]
        pos[d] = ax[i]
        if 0 < i < ax.size - 1:
            sl = list(centre)
            vals = []
            for j in (i - 1, i, i + 1):
                sl[d] = j
                vals.append(sign * float(data[tuple(sl)]))
            den = vals[0] - 2.0 * vals[1] + vals[2]
            if den < 0:
                pos[d] = ax[i] + 0.5 * (vals[0] - vals[2]) / den * float(ax[1] - ax[0])
    return float(data[tuple(centre)]), pos


def _value_at(
    data: NDArray[np.floating], axes: tuple[NDArray[np.float64], ...], r: NDArray[np.float64]
) -> float:
    """*data* at the voxel nearest *r*."""
    return float(data[tuple(int(np.argmin(np.abs(ax - c))) for ax, c in zip(axes, r))])


def _features(
    run: DeltaPdfFile, truth: DeltaPDF, planted: DeltaPDF, built: Built, resolved: list[bool]
) -> list[dict[str, Any]]:
    """Each planted orbit: the run's value at the truth's extremum against the
    truth's, as a share of the planted correlation's own value there (the
    crystal's own correlations overlap some vectors; dividing by the sum would
    magnify a small error where they cancel), and how far the extremum moved."""
    a = built.case.crystal.a
    axes_r = (np.asarray(run.x_axis), np.asarray(run.y_axis), np.asarray(run.z_axis))
    axes_t = (np.asarray(truth.x_axis), np.asarray(truth.y_axis), np.asarray(truth.z_axis))
    voxel = float(max(ax[1] - ax[0] for ax in axes_t))
    out = []
    if run.data is None:
        raise ValueError("the run's ΔPDF was read without its data")
    for p, judged in zip(built.case.crystal.planted, resolved):
        sign = 1.0 if p.amplitude > 0 else -1.0
        ratios, shifts, analytic = [], [], []
        for v in orbit(p.vector):
            r0 = a * np.asarray(v, dtype=np.float64)  # cubic: x, y, z along a, b, c
            t_val, t_pos = _locate(truth.data, axes_t, r0, sign, 0.75 * voxel)
            r_val, r_pos = _locate(run.data, axes_r, t_pos, sign, 0.75 * voxel)
            p_val = _value_at(planted.data, axes_t, t_pos)
            ratios.append(1.0 + (r_val - t_val) / p_val if p_val else float("nan"))
            shifts.append(float(np.linalg.norm(r_pos - t_pos)))
            analytic.append(float(np.linalg.norm(t_pos - r0)))
        ratio = float(np.median(ratios))
        shift = float(np.median(shifts))
        ok_amp = TOLERANCES["amplitude_low"].value <= ratio <= TOLERANCES["amplitude_high"].value
        ok_pos = shift <= TOLERANCES["position_voxels"].value * voxel
        out.append(
            {
                "vector": list(p.vector),
                "sign": "+" if sign > 0 else "−",
                "distance_A": round(a * float(np.linalg.norm(p.vector)), 3),
                "vectors": len(ratios),
                "amplitude_ratio": round(ratio, 4),
                "amplitude_ratio_range": [
                    round(float(np.nanmin(ratios)), 4),
                    round(float(np.nanmax(ratios)), 4),
                ],
                "position_error_A": round(shift, 4),
                "truth_vs_planted_A": round(float(np.median(analytic)), 4),
                "voxel_A": round(voxel, 4),
                "judged": judged,
                "pass": bool(ok_amp and ok_pos) if judged else None,
            }
        )
    return out


def _shell_contrast(
    diff: NDArray[np.floating],
    q: NDArray[np.float64],
    q0: float,
    width: float,
    ok: NDArray[np.bool_],
) -> float:
    """The mean of *diff* on the shell |Q − q0| ≤ 1.5 width over its flanks, 3–6 widths out."""
    core = ok & (np.abs(q - q0) <= 1.5 * width)
    flank = ok & (np.abs(q - q0) >= 3.0 * width) & (np.abs(q - q0) <= 6.0 * width)
    if core.sum() < 20 or flank.sum() < 20:
        return float("nan")
    return float(diff[core].mean() - diff[flank].mean())


def _ring_width(built: Built) -> float:
    f = built.case.fault
    return float(f["width"]) if "width" in f else 0.03  # Al lines: σ 0.022 Å⁻¹ plus the voxel


def resolved_features(built: Built) -> list[bool]:
    """Which planted correlations the case's data can resolve at all: the
    truth, through the default transform on the raw volume's measured support,
    has its extremum within the position tolerance of the planted vector. A
    coverage cut coarsens the ΔPDF's resolution until a weak correlation merges
    with its neighbours; no reduction can recover it, so no arm is judged on
    it. Fixed per case, whatever an arm's settings."""
    if "resolved" not in built.notes:
        support = np.asarray(built.raw.mask, dtype=bool)
        params = DeltaPdfParams()
        truth = truth_dpdf(built, support, params)
        axes = (np.asarray(truth.x_axis), np.asarray(truth.y_axis), np.asarray(truth.z_axis))
        voxel = float(max(ax[1] - ax[0] for ax in axes))
        flags = []
        for p in built.case.crystal.planted:
            sign = 1.0 if p.amplitude > 0 else -1.0
            moved = [
                float(
                    np.linalg.norm(
                        _locate(
                            truth.data,
                            axes,
                            built.case.crystal.a * np.asarray(v),
                            sign,
                            0.75 * voxel,
                        )[1]
                        - built.case.crystal.a * np.asarray(v)
                    )
                )
                for v in orbit(p.vector)
            ]
            flags.append(float(np.median(moved)) <= TOLERANCES["position_voxels"].value * voxel)
        built.notes["resolved"] = flags
    return list(built.notes["resolved"])


def score_outputs(
    built: Built, delta_pdf_path: str | Path, pdf_input_path: str | Path
) -> dict[str, Any]:
    """Score one run's outputs (its ΔPDF and the volume it was made from) on *built*'s truth."""
    run = load_delta_pdf(delta_pdf_path)
    logs = run.logs
    params = _params_from(str(logs.get("transform_config", "")))
    out_vol: HKLVolume = load(pdf_input_path)
    support = np.asarray(out_vol.mask, dtype=bool)
    truth = truth_dpdf(built, support, params)
    features = _features(
        run,
        truth,
        truth_dpdf(built, support, params, planted_only=True),
        built,
        resolved_features(built),
    )

    result: dict[str, Any] = {
        "case": built.case.id,
        "transform": str(logs.get("transform_config", "")),
        "features": features,
    }
    criteria: dict[str, bool] = {}
    if any(f["judged"] for f in features):
        criteria["features"] = all(f["pass"] for f in features if f["judged"])

    open_w = logs.get("window_open_weight")
    result["window_open_weight"] = None if open_w is None else float(open_w)
    criteria["window"] = open_w is None or float(open_w) <= TOLERANCES["open_weight"].value

    # Fidelity over 3–12 Å, against the truth's own spread there: reported, not judged.
    xr = np.asarray(run.x_axis)
    rr = np.sqrt(
        xr[:, None, None] ** 2
        + np.asarray(run.y_axis)[None, :, None] ** 2
        + np.asarray(run.z_axis)[None, None, :] ** 2
    )
    band = (rr >= 3.0) & (rr <= 12.0)
    if run.data is not None and truth.data.shape == run.data.shape:
        t = np.asarray(truth.data)[band]
        result["dpdf_rms_error"] = round(
            float(np.sqrt(np.mean((np.asarray(run.data)[band] - t) ** 2)) / np.sqrt(np.mean(t**2))),
            4,
        )

    q = out_vol.q_magnitude().astype(np.float64)
    data = np.asarray(out_vol.data, dtype=np.float64)
    ok = support & np.isfinite(data)
    diff = data - built.truth.data
    width = _ring_width(built)
    qs = ring_qs(built)
    if built.rings is not None and qs:
        contrasts = [(q0, _shell_contrast(built.rings, q, q0, width, ok)) for q0 in qs]
        strongest = max((c for _, c in contrasts if np.isfinite(c)), default=0.0)
        rings = []
        for q0, injected in contrasts:
            if not np.isfinite(injected) or injected < 0.2 * strongest:
                continue  # outside the coverage, or too weak to judge
            left = _shell_contrast(diff, q, q0, width, ok) / injected
            rings.append({"q": round(q0, 3), "left": round(left, 4)})
        result["rings"] = rings
        criteria["rings_removed"] = bool(rings) and all(
            abs(r["left"]) <= TOLERANCES["ring_left"].value for r in rings
        )
    if built.shell is not None:
        s = built.case.fault.get("shell", built.case.fault)
        injected = _shell_contrast(built.shell, q, float(s["q"]), float(s["width"]), ok)
        kept = 1.0 + _shell_contrast(diff, q, float(s["q"]), float(s["width"]), ok) / injected
        result["shell_kept"] = round(kept, 4)
        criteria["diffuse_kept"] = kept >= TOLERANCES["shell_kept"].value

    # The pedestal: per |Q| shell the median of output − truth, over the outer shells.
    measured_q = q[ok]
    q_hi = float(np.quantile(measured_q, 0.98)) if measured_q.size else 0.0
    box_face = float(min(abs(q[0, :, :]).min(), abs(q[:, 0, :]).min(), abs(q[:, :, 0]).min()))
    q_hi = min(q_hi, box_face) - 0.2
    edges = np.arange(PEDESTAL_Q_MIN, q_hi + 1e-9, SHELL_STEP)
    meds, levels = [], []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = ok & (q >= lo) & (q < hi)
        if sel.sum() >= 200:
            meds.append(float(np.median(diff[sel])))
            levels.append(float(np.median(built.truth.data[sel])))
    if len(meds) >= 5:
        span = (max(meds) - min(meds)) / float(np.median(levels))
        result["pedestal_span"] = round(span, 4)
        result["pedestal_q"] = [PEDESTAL_Q_MIN, round(q_hi, 2)]
        criteria["pedestal"] = span <= TOLERANCES["pedestal_span"].value
    result["criteria"] = criteria
    result["pass"] = all(criteria.values())
    return result
