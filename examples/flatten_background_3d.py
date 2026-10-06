"""Flatten the isotropic radial background of a 3D volume — the background step.

Runs after ``examples/backfill_bragg_3d.py`` as step 4 of the pipeline (right
before the ΔPDF FFT).  Sweeps spherical |Q| shells from 0 to Qmax; in each shell
it measures a robust background **floor** (a low percentile that sits below the
diffuse and Bragg-residual high tail), fits the isotropic pedestal
``const + c·F(Q)²`` to those floors — nuclear incoherent plus single-ion
paramagnetic scattering, ``F`` the ion's magnetic form factor — and subtracts the
fitted curve from every voxel.  Both terms are self (single-site) scattering, so
they only touch the ΔPDF at r ≈ 0; isotropic pair correlations, which the
fixed-shape model cannot follow, are kept.

This is the explicit background-removal step and is **ON by default** in
``run_pipeline.py`` (disable with ``FLATTEN=0``).  It replaces the ΔPDF's own
Gaussian ``SUBTRACT_BG`` blur (which defaults off) — use one or the other, never
both: running both subtracts the background twice, and the per-H-plane blur
(σ_H=0) destroys the on-axis H-direction signal the flatten preserves.
Check robustness on your data with ``examples/validate_flatten.py``.

Run::

    PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl \
      python3 examples/flatten_background_3d.py

Env overrides:
    DATA_FILE     backfilled input .h5
    OUT_FILE      output .h5 (default: <stem>_flattened.h5)
    ESTIMATOR     model | floor | snip   (default model: const + c·F(Q)²;
                  floor/snip subtract a free-form curve — for comparison)
    ION           magnetic ion of the model (default Tb3+; none = constant only)
    FIT_Q_MIN, FIT_Q_MAX  |Q| range Å^-1 the model is fitted over (default 0.8, 10)
    FLOOR_PCT     percentile giving each shell's floor (default 25)
    Q_STEP        |Q| shell width Å^-1 (default 0.05)
    SMOOTH        Gaussian sigma Å^-1 smoothing the floor curve (ESTIMATOR=floor;
                  default 0.10)
    SNIP_WIDTH    peak-removal width Å^-1 for ESTIMATOR=snip (default 0.3)
    MIN_COUNT     min valid voxels per shell to estimate a level (default 20)
    Q_MIN, Q_MAX  restrict the swept |Q| range (default data min/max)
    NO_PLOT       1 -> skip the QA PNG
"""
import os
from pathlib import Path

import numpy as np

import nebula3d
from nebula3d.preprocessing import flatten_radial_background

HERE = Path(__file__).resolve().parent
proc = Path("data/processed")

data_file = os.environ.get("DATA_FILE")
if data_file:
    in_path = Path(data_file)
else:
    cands = sorted(proc.glob("*_backfilled*.h5"))
    if not cands:
        raise FileNotFoundError(
            "No backfilled input found in data/processed. Run "
            "`PYTHONPATH=src python3 examples/backfill_bragg_3d.py` first, "
            "or set DATA_FILE=/path/to/*_backfilled.h5."
        )
    in_path = cands[-1]

out_file = os.environ.get("OUT_FILE")
out_path = Path(out_file) if out_file else proc / f"{in_path.stem}_flattened.h5"

estimator = os.environ.get("ESTIMATOR", "model")
ion = os.environ.get("ION", "Tb3+")
fit_q_range = (float(os.environ.get("FIT_Q_MIN", "0.8")),
               float(os.environ.get("FIT_Q_MAX", "10")))
floor_pct = float(os.environ.get("FLOOR_PCT", "25"))
q_step = float(os.environ.get("Q_STEP", "0.05"))
smooth = float(os.environ.get("SMOOTH", "0.10"))
snip_width = float(os.environ.get("SNIP_WIDTH", "0.3"))
min_count = int(os.environ.get("MIN_COUNT", "20"))
q_min = os.environ.get("Q_MIN")
q_max = os.environ.get("Q_MAX")
q_range = (float(q_min), float(q_max)) if q_min and q_max else None


def _shell_medians(values, q, edges, valid):
    """Per-shell median of *values* (QA only) on the same edges as the flatten."""
    grid_n = edges.size - 1
    bi = np.clip(np.digitize(q, edges) - 1, 0, grid_n - 1)[valid]
    vv = values[valid].astype(np.float64)
    order = np.argsort(bi, kind="stable")
    sb, sv = bi[order], vv[order]
    bounds = np.searchsorted(sb, np.arange(grid_n + 1))
    out = np.full(grid_n, np.nan)
    for b in range(grid_n):
        seg = sv[bounds[b]:bounds[b + 1]]
        if seg.size >= min_count:
            out[b] = float(np.median(seg))
    return out


print(f"loading {in_path}", flush=True)
vol = nebula3d.load(in_path)
print(f"volume {vol.shape}; estimator={estimator} ion={ion} fit_q_range={fit_q_range} "
      f"floor_pct={floor_pct} q_step={q_step} smooth={smooth} min_count={min_count} "
      f"q_range={q_range}", flush=True)

res = flatten_radial_background(
    vol, q_step=q_step, estimator=estimator, floor_percentile=floor_pct,
    snip_width=snip_width, smooth=smooth, min_count=min_count, q_range=q_range,
    ion=ion, fit_q_range=fit_q_range,
)
if res.model_coef is not None:
    print(f"model: const={res.model_coef[0]:.4g}  c={res.model_coef[1]:.4g} "
          f"(·F(Q)², ion={res.ion})  R²={res.model_r2}", flush=True)

# Flatness QA: the spread of the per-shell median across |Q| should collapse —
# that is exactly "the background is now flat and continuous".
q = vol.q_magnitude()
valid = vol.mask & np.isfinite(vol.data)
edges = np.concatenate([
    res.q_grid - 0.5 * q_step, res.q_grid[-1:] + 0.5 * q_step
]) if res.q_grid.size else np.array([0.0, q_step])
before = _shell_medians(vol.data, q, edges, valid)
after = _shell_medians(res.volume.data, q, edges, valid)
print(f"bg(|Q|): min={np.nanmin(res.bg_curve):.4g} max={np.nanmax(res.bg_curve):.4g}",
      flush=True)
print(f"shell-median spread (flatness): before={np.nanstd(before):.4g} "
      f"-> after={np.nanstd(after):.4g}", flush=True)

print(f"saving -> {out_path}", flush=True)
nebula3d.save(res.volume, out_path)

if os.environ.get("NO_PLOT", "0") != "1":
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(7, 4.2))
        ax.plot(res.q_grid, before, color="0.5", lw=1.2, label="before (shell median)")
        ax.plot(res.q_grid, res.raw_levels, color="#d9892a", lw=0.8, alpha=0.5,
                label=f"shell floor (p{floor_pct:g})")
        ax.plot(res.q_grid, res.bg_curve, color="#d9892a", lw=1.6,
                label="subtracted bg(|Q|)")
        ax.plot(res.q_grid, after, color="#2e9e6b", lw=1.2, label="after (shell median)")
        ax.axhline(0.0, color="0.8", lw=0.8, zorder=0)
        ax.set_xlabel("|Q| (Å$^{-1}$)")
        ax.set_ylabel("intensity")
        ax.set_title(f"radial background flatten — estimator={estimator}")
        ax.legend(frameon=False, fontsize=9)
        fig.tight_layout()
        png = HERE / "_flatten_background.png"
        fig.savefig(png, dpi=130)
        print(f"QA plot -> {png}", flush=True)
    except Exception as exc:  # noqa: BLE001 - QA plot is best-effort
        print(f"(skipped QA plot: {exc})", flush=True)

print("radial background flatten complete.", flush=True)
