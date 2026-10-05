"""Interactive 3D-ΔPDF viewer — y_K–z_L real-space plane with an x_H slider.

Loads the full 3D-ΔPDF (real-space transform of the cleaned diffuse volume)
and lets you scrub through the **real-space x_H axis**, showing the y_K–z_L
correlation plane at each x_H.  This is the proper 3D transform (every plane
mixes all reciprocal H layers with phase), unlike the per-plane 2D-ΔPDF in
``examples/delta_pdf_plane.py``.  The plane is drawn at the cell's real b–c
angle α (from the file's unit cell, 90° if absent), so on-screen
distances are true Å.

Source: a single ``*_delta_pdf.h5`` in ``data/processed/`` if exactly one is
present (the pipeline output), else ``examples/_delta_pdf.h5`` (the bare
``delta_pdf.py`` default) if it exists, else it is computed on the fly from the
backfilled volume.  Unlike the ortho viewer this one has no ``TEMP`` selector —
set ``PDF_FILE`` to disambiguate when several ``data/processed`` files match.

Run (interactive, on this Mac)::

    PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl \\
      python3 \\
      examples/explore_delta_pdf.py

Controls:
    x_H slider     — scrub the real-space x_H plane (Å)
    |scale| slider — symmetric colour-scale half-range
    "unit cells" checkbox — toggle the light-gray unit-cell gridlines
    Close the window to exit.

Env overrides:
    PDF_FILE    explicit ΔPDF .h5 to load (else: a single data/processed match,
                then examples/_delta_pdf.h5, then computed from PROC_FILE)
    PROC_FILE   backfilled .h5 to transform if no PDF_FILE (auto-detect)
    X_VALUE     initial x_H plane in Å (default: 0.0)
    RMAX        display half-window in Å for K and L axes (default: 25)
    SCALE_MAX   upper |scale| slider multiple of the p99 level (default: 20)
    LAT_A/LAT_B/LAT_C  direct-lattice constants in Å for the unit-cell gridlines
                (default: the ΔPDF file's cell, else the source UB matrix; the
                env override assumes 90° angles)
    INTERP      imshow interpolation (default: bilinear; "nearest" for raw pixels)
    SMOKE       1 → render the initial frame to PNG and exit (no GUI); used
                to verify the script headless.
"""

import os
import sys
from pathlib import Path

import matplotlib

SMOKE = bool(int(os.environ.get("SMOKE", "0")))
matplotlib.use("Agg" if SMOKE else "macosx")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.widgets import CheckButtons, Slider

from nebula3d.analysis.delta_pdf import real_space_radius
from nebula3d.io import load_delta_pdf
from nebula3d.io.hkl_reader import load_ub_matrix
from nebula3d.utils import direct_cell
from nebula3d.visualization.slices import draw_unit_cell, oblique_transform

# ------------------------------------------------------------------
# load or compute the 3D-ΔPDF
# ------------------------------------------------------------------
_pdf_env = os.environ.get("PDF_FILE")
if _pdf_env:
    pdf_file = Path(_pdf_env)
else:
    _cands = sorted(Path("data/processed").glob("*_delta_pdf.h5"))
    pdf_file = _cands[0] if len(_cands) == 1 else Path("examples/_delta_pdf.h5")

if pdf_file.exists():
    print(f"loading ΔPDF {pdf_file.name} ...", flush=True)
    pdf = load_delta_pdf(pdf_file)  # either file layout
    data, x_axis, y_axis, z_axis = pdf.data, pdf.x_axis, pdf.y_axis, pdf.z_axis
    apodization = pdf.logs.get("apodization", "?")
    cell_attrs = pdf.cell
else:
    import nebula3d
    from nebula3d.analysis import compute_delta_pdf

    proc_file = os.environ.get("PROC_FILE")
    if proc_file:
        proc_path = Path(proc_file)
    else:
        cands = sorted(Path("data/processed").glob("*_backfilled.h5"))
        if not cands:
            sys.exit(
                f"{pdf_file} not found and no *_backfilled.h5 in data/processed/.\n"
                "Run examples/delta_pdf.py first to create the ΔPDF cache."
            )
        proc_path = cands[0]
    print(f"{pdf_file.name} not found — computing from {proc_path.name} ...", flush=True)
    vol = nebula3d.load(proc_path)
    dpdf = compute_delta_pdf(vol, apodization="hann", zero_pad=True, subtract_mean=True)
    data, x_axis, y_axis, z_axis = dpdf.data, dpdf.x_axis, dpdf.y_axis, dpdf.z_axis
    apodization = dpdf.apodization

print(f"  ΔPDF shape (x_H,y_K,z_L): {data.shape}", flush=True)

x_value = float(os.environ.get("X_VALUE", "0.0"))
rmax = float(os.environ.get("RMAX", "25.0"))
scale_max = float(os.environ.get("SCALE_MAX", "20.0"))   # |scale| slider headroom


def _resolve_lattice():
    """Direct cell (a, b, c, α, β, γ) in Å and degrees, or None.

    Precedence: env LAT_A/B/C (90°) → the ΔPDF file's cell → source backfilled
    UB (loaded case) → the in-memory volume's UB (computed case).
    """
    ev = [os.environ.get(k) for k in ("LAT_A", "LAT_B", "LAT_C")]
    if all(ev):
        return (*(float(v) for v in ev), 90.0, 90.0, 90.0)
    if pdf_file.exists():
        if cell_attrs is not None:
            return cell_attrs
        src = str(pdf.logs.get("source_file", ""))
        sp = Path("data/processed") / src if src else None
        if sp and sp.exists():
            try:
                return direct_cell(load_ub_matrix(sp))  # metadata only, any layout
            except Exception:
                return None
        return None
    try:                                  # computed on the fly: vol is in scope
        return direct_cell(vol.ub_matrix)
    except Exception:
        return None


lat = _resolve_lattice()
cell_angles = lat[3:] if lat is not None else (90.0, 90.0, 90.0)
alpha = cell_angles[0]  # the y_K–z_L (b–c) plane's real angle

# ------------------------------------------------------------------
# robust colour scale: p99 of |ΔPDF| at true r>3 Å (skip near-origin spike)
# ------------------------------------------------------------------
r = real_space_radius(x_axis[:, None, None], y_axis[None, :, None],
                      z_axis[None, None, :], cell_angles)
vmax0 = float(np.percentile(np.abs(data[r > 3.0]), 99))
del r
print(f"  initial |scale| = {vmax0:.4g}  (p99 at r>3 Å)", flush=True)

# K,L display window: the crop of the native (oblique) axes that fills the
# ±rmax display square — v up to rmax/sin α, h up to rmax·(1 + |cot α|).
_sin, _cos = np.sin(np.radians(alpha)), np.cos(np.radians(alpha))
crop = rmax * max(1.0 + abs(_cos) / _sin, 1.0 / _sin)
ik = np.abs(y_axis) <= crop
il = np.abs(z_axis) <= crop
y_win, z_win = y_axis[ik], z_axis[il]
extent = [y_win[0], y_win[-1], z_win[0], z_win[-1]]


def _plane(ix: int) -> np.ndarray:
    """y_K–z_L slice at x_H index ix, trimmed to the display window."""
    return data[ix][np.ix_(ik, il)]


def _nearest_x(val: float) -> int:
    return int(np.argmin(np.abs(x_axis - val)))


# ------------------------------------------------------------------
# figure + controls
# ------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(8.0, 8.6))
fig.subplots_adjust(left=0.11, bottom=0.18, right=0.97, top=0.94)

ix0 = _nearest_x(x_value)
im = ax.imshow(
    _plane(ix0).T,
    origin="lower",
    extent=extent,
    transform=oblique_transform(ax, alpha),
    cmap="RdBu_r",
    vmin=-vmax0, vmax=vmax0,
    aspect="equal",
    interpolation=os.environ.get("INTERP", "bilinear"),
)
ax.set_xlim(-rmax, rmax)
ax.set_ylim(-rmax, rmax)
ax.set_xlabel("y_K (Å)")
ax.set_ylabel("z_L (Å)" if abs(alpha - 90.0) < 1e-6
              else f"⊥ y_K (Å);  z_L axis at {alpha:.1f}°")
title = ax.set_title(f"3D-ΔPDF  y_K–z_L plane   x_H = {x_axis[ix0]:+.2f} Å")
fig.colorbar(im, ax=ax, label="ΔPDF (arb. units)", shrink=0.85)

# light-gray unit-cell gridlines (b along y_K, c along z_L, at the real angle α),
# toggleable
gridlines = []
if lat is not None:
    b_len, c_len = lat[1], lat[2]
    gridlines = draw_unit_cell(ax, (y_win[0], y_win[-1]), (z_win[0], z_win[-1]),
                               b_len, c_len, alpha)
    print(f"  unit-cell grid: b={b_len:.3f} c={c_len:.3f} Å  α={alpha:.2f}° "
          f"({len(gridlines)} lines)", flush=True)
else:
    print("  unit-cell grid: lattice unknown (set LAT_A/LAT_B/LAT_C to enable)",
          flush=True)

# controls: x_H + |scale| sliders (left), unit-cell toggle (right)
axc = "lightgoldenrodyellow"
ax_x = fig.add_axes([0.11, 0.105, 0.60, 0.03], facecolor=axc)
ax_v = fig.add_axes([0.11, 0.055, 0.60, 0.03], facecolor=axc)
s_x = Slider(ax_x, "x_H (Å)", float(x_axis.min()), float(x_axis.max()),
             valinit=float(x_axis[ix0]))
s_v = Slider(ax_v, "|scale|", vmax0 * 0.05, vmax0 * scale_max, valinit=vmax0)

ax_chk = fig.add_axes([0.78, 0.055, 0.17, 0.06])
ax_chk.set_frame_on(False)
chk = CheckButtons(ax_chk, ["unit cells"], [True])


def _toggle_grid(_label):
    vis = chk.get_status()[0]
    for ln in gridlines:
        ln.set_visible(vis)
    fig.canvas.draw_idle()


chk.on_clicked(_toggle_grid)


def _update(_):
    ix = _nearest_x(s_x.val)
    im.set_data(_plane(ix).T)
    im.set_clim(-s_v.val, s_v.val)
    title.set_text(f"3D-ΔPDF  y_K–z_L plane   x_H = {x_axis[ix]:+.2f} Å")
    fig.canvas.draw_idle()


s_x.on_changed(_update)
s_v.on_changed(_update)

if SMOKE:
    out = Path(__file__).parent / "_explore_delta_pdf_smoke.png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    print(f"[SMOKE] saved {out.name}", flush=True)
else:
    print("Drag x_H to scrub real-space planes; |scale| sets the colour range. "
          "Close the window to exit.", flush=True)
    plt.show()
