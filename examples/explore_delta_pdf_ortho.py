"""Interactive 3D-PDF / 3D-ΔPDF orthoslice viewer — all three real-space planes at once.

The plot title labels the kind (3D-PDF when the file carries a ``kind`` log from
``pdf_3d.py``, else 3D-ΔPDF) and the source label parsed from the filename.

Shows the three lattice-plane cuts through the real-space ΔPDF volume:

    x_H–y_K  (at z_L = cut)      a–b plane, drawn at γ
    x_H–z_L  (at y_K = cut)      a–c plane, drawn at β
    y_K–z_L  (at x_H = cut)      b–c plane, drawn at α

Each section is drawn at the cell's real angle (a hexagonal a–b plane shows its
120°), so distances on screen are true Å; for a 90° cell nothing changes.  The
angles come from the file's unit cell (90° if absent).

Sliders move each cut position, and a global contrast control scales colour.  Each
panel auto-scales to its own robust level (so the three very different
magnitudes stay readable), and the contrast slider multiplies all three.

Source: a ``*_delta_pdf.h5`` in ``data/processed/`` (written by
``run_pipeline.py``, or by ``delta_pdf.py`` with ``OUT_FILE`` pointed there).
With several outputs present, set ``MATCH`` to pick one by filename substring, or
``PDF_FILE`` for an explicit file.  (A bare ``delta_pdf.py`` run defaults to
``examples/_delta_pdf.h5``, which this viewer does NOT auto-load.)

Run (interactive, on this Mac)::

    PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl RMAX=50 \\
      python3 \\
      examples/explore_delta_pdf_ortho.py

Controls:
    x_H / y_K / z_L sliders — move each orthogonal cut (Å)
    contrast slider         — multiply the per-panel colour scale
    "unit cells" checkbox   — toggle the light-gray unit-cell gridlines
    Close the window to exit.

Env overrides:
    PDF_FILE  explicit ΔPDF .h5 to load (overrides the data/processed glob)
    MATCH     filename substring used when data/processed/ holds several
              *_delta_pdf.h5 files (the viewer exits asking for this if ambiguous)
    RMAX      display half-window in Å for all axes (default: 50)
    PERCENTILE per-panel colour-scale percentile at r>3 Å (default: 98)
    CONTRAST_MIN / CONTRAST_MAX  range of the contrast-× slider that scales the
              per-panel colour limits (defaults 0.1 .. 20; raise CONTRAST_MAX to
              push the colour scale even larger / further de-saturate)
    LAT_A / LAT_B / LAT_C  direct-lattice constants in Å for the unit-cell
              gridlines (default: read from the ΔPDF file's cell, else the source
              UB matrix; the env override assumes 90° angles)
    SMOKE     1 → render the initial frame to PNG and exit (no GUI).
"""
import os
import re
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

_pdf_env = os.environ.get("PDF_FILE")
_match = os.environ.get("MATCH", "")
if _pdf_env:
    pdf_file = Path(_pdf_env)
    if not pdf_file.exists():
        sys.exit(f"PDF_FILE={pdf_file} not found.")
else:
    _cands = sorted(Path("data/processed").glob("*_delta_pdf.h5"))
    if _match:
        _cands = [p for p in _cands if _match in p.name]
    if not _cands:
        sys.exit(
            "No matching *_delta_pdf.h5 in data/processed/.\n"
            "Set MATCH=<filename-substring>, or PDF_FILE=/path/to/file.h5."
        )
    if len(_cands) > 1:
        names = "\n  ".join(p.name for p in _cands)
        sys.exit(
            f"Multiple ΔPDF files — set MATCH=<filename-substring> to pick one:\n  {names}"
        )
    pdf_file = _cands[0]

print(f"loading {pdf_file.name} ...", flush=True)
pdf = load_delta_pdf(pdf_file)  # either file layout
data = pdf.data
x = pdf.x_axis      # x_H (Å)
y = pdf.y_axis      # y_K (Å)
z = pdf.z_axis      # z_L (Å)
apod = pdf.logs.get("apodization", "?")
_kind_attr = str(pdf.logs.get("kind", ""))
_source = str(pdf.logs.get("source_file", ""))

# Correct label from the file: 3D-PDF (total scattering, Bragg kept; pdf_3d.py
# stamps a "kind" log) vs 3D-ΔPDF (Bragg removed; delta_pdf.py, no such log).
KIND = "3D-PDF" if "3D-PDF" in _kind_attr else "3D-ΔPDF"
# Optional condition label parsed from the source filename, else "".
_m = re.search(r"(\d+)\s*K", _source or pdf_file.name)
LABEL = f"{_m.group(1)} K" if _m else ""
print(f"  {KIND}{(' — ' + LABEL) if LABEL else ''}"
      f"  shape (x_H,y_K,z_L): {data.shape}  apod={apod}", flush=True)

RMAX = float(os.environ.get("RMAX", "50.0"))
PCT = float(os.environ.get("PERCENTILE", "98.0"))
CMIN = float(os.environ.get("CONTRAST_MIN", "0.1"))
CMAX = float(os.environ.get("CONTRAST_MAX", "20.0"))


def _lattice():
    """Direct cell (a, b, c, α, β, γ) in Å and degrees, or None.

    Order of precedence: the ΔPDF file's cell → env LAT_A/LAT_B/LAT_C (90°)
    → the source backfilled file's UB matrix (cheap metadata read).
    """
    if pdf.cell is not None:
        return pdf.cell
    ev = [os.environ.get(k) for k in ("LAT_A", "LAT_B", "LAT_C")]
    if all(ev):
        return (*(float(v) for v in ev), 90.0, 90.0, 90.0)
    if _source:
        sp = Path("data/processed") / _source
        if sp.exists():
            try:
                return direct_cell(load_ub_matrix(sp))
            except Exception:
                pass
    return None

# Direct cell: unit-cell spacings (x_H↔a, y_K↔b, z_L↔c) and each plane's real
# angle (x_H–y_K at γ, x_H–z_L at β, y_K–z_L at α).
lat = _lattice()
alpha, beta, gamma = lat[3:] if lat is not None else (90.0, 90.0, 90.0)
panel_angles = [gamma, beta, alpha]
if lat is not None:
    print(f"  cell: a={lat[0]:.3f} b={lat[1]:.3f} c={lat[2]:.3f} Å  "
          f"α={alpha:.2f} β={beta:.2f} γ={gamma:.2f}°", flush=True)
else:
    print("  unit-cell grid: lattice unknown (set LAT_A/LAT_B/LAT_C to enable)",
          flush=True)

# Crop of the native (oblique) axes that fills the ±RMAX display square: a
# section at angle θ needs v up to RMAX/sin θ and h up to RMAX·(1 + |cot θ|).
_reach = max(max(1.0 + abs(np.cos(np.radians(t))) / np.sin(np.radians(t)),
                 1.0 / np.sin(np.radians(t))) for t in panel_angles)
CROP = RMAX * _reach
mx, my, mz = np.abs(x) <= CROP, np.abs(y) <= CROP, np.abs(z) <= CROP
xw, yw, zw = x[mx], y[my], z[mz]


def nidx(ax, v):
    return int(np.argmin(np.abs(ax - v)))


def pvmax(slc, a1, a2, angle):
    """p<PCT> of |ΔPDF| over the displayed ±RMAX square at true in-plane
    r > 3 Å, for a section whose axes meet at ``angle``."""
    h, v = a1[:, None], a2[None, :]
    r = real_space_radius(h, v, 0.0, (90.0, 90.0, angle))
    cos_t = 0.0 if angle == 90.0 else np.cos(np.radians(angle))
    sin_t = 1.0 if angle == 90.0 else np.sin(np.radians(angle))
    shown = (np.abs(h + v * cos_t) <= RMAX) & (np.abs(v * sin_t) <= RMAX)
    sel = np.abs(slc[(r > 3.0) & shown])
    return float(np.percentile(sel, PCT)) if sel.size else 1.0


# central indices
ix0, iy0, iz0 = nidx(x, 0.0), nidx(y, 0.0), nidx(z, 0.0)

# slices (windowed)
def s_xy(iz):   # x_H–y_K at z=iz
    return data[np.ix_(mx, my, [iz])][:, :, 0]
def s_xz(iy):   # x_H–z_L at y=iy
    return data[np.ix_(mx, [iy], mz)][:, 0, :]
def s_yz(ix):   # y_K–z_L at x=ix
    return data[np.ix_([ix], my, mz)][0, :, :]

fig, axes = plt.subplots(1, 3, figsize=(20, 7.4))
try:  # name the OS window so several viewers are distinguishable
    fig.canvas.manager.set_window_title(f"{KIND} {LABEL}".strip())
except Exception:
    pass
plt.subplots_adjust(left=0.05, right=0.99, bottom=0.24, top=0.90, wspace=0.28)



def _vertical_label(xl, yl, angle):
    """At a non-right angle the vertical screen axis is ⟂ to the horizontal one."""
    if abs(angle - 90.0) < 1e-6:
        return yl
    return f"⊥ {xl.split()[0]} (Å);  {yl.split()[0]} axis at {angle:.1f}°"


panels = []
specs = [
    (s_xy(iz0), xw, yw, "x_H–y_K  (z_L cut)", "x_H (Å)", "y_K (Å)"),
    (s_xz(iy0), xw, zw, "x_H–z_L  (y_K cut)", "x_H (Å)", "z_L (Å)"),
    (s_yz(ix0), yw, zw, "y_K–z_L  (x_H cut)", "y_K (Å)", "z_L (Å)"),
]
vmaxes = []
for ax, (img, a1, a2, ttl, xl, yl), angle in zip(axes, specs, panel_angles):
    vm = pvmax(img, a1, a2, angle)
    vmaxes.append(vm)
    im = ax.imshow(img.T, origin="lower", aspect="equal",
                   extent=[a1[0], a1[-1], a2[0], a2[-1]],
                   transform=oblique_transform(ax, angle),
                   cmap="RdBu_r", vmin=-vm, vmax=vm, interpolation="bilinear")
    ax.set_xlim(-RMAX, RMAX)
    ax.set_ylim(-RMAX, RMAX)
    ax.set_title(f"{ttl}", fontsize=12)
    ax.set_xlabel(xl)
    ax.set_ylabel(_vertical_label(xl, yl, angle))
    fig.colorbar(im, ax=ax, shrink=0.8)
    panels.append(im)

# --- light-gray unit-cell gridlines (toggleable), at each plane's real angle ---
gridlines = []
if lat is not None:
    a_len, b_len, c_len = lat[:3]
    panel_spacing = [(a_len, b_len), (a_len, c_len), (b_len, c_len)]
    panel_axes = [(xw, yw), (xw, zw), (yw, zw)]
    for ax, (a1, a2), (sx, sy), angle in zip(axes, panel_axes, panel_spacing,
                                             panel_angles):
        gridlines += draw_unit_cell(ax, (a1[0], a1[-1]), (a2[0], a2[-1]),
                                    sx, sy, angle)
    print(f"  unit-cell grid: {len(gridlines)} lines", flush=True)

# controls — cut sliders (left column), contrast + unit-cell toggle (right column)
axc = "lightgoldenrodyellow"
ax_sx = plt.axes([0.09, 0.135, 0.54, 0.028], facecolor=axc)
ax_sy = plt.axes([0.09, 0.090, 0.54, 0.028], facecolor=axc)
ax_sz = plt.axes([0.09, 0.045, 0.54, 0.028], facecolor=axc)
ax_sc = plt.axes([0.76, 0.115, 0.18, 0.028], facecolor=axc)
s_x = Slider(ax_sx, "x_H cut (Å)", float(x.min()), float(x.max()), valinit=0.0)
s_y = Slider(ax_sy, "y_K cut (Å)", float(y.min()), float(y.max()), valinit=0.0)
s_z = Slider(ax_sz, "z_L cut (Å)", float(z.min()), float(z.max()), valinit=0.0)
s_c = Slider(ax_sc, "contrast ×", CMIN, CMAX, valinit=1.0)

# unit-cell gridline on/off toggle (under the contrast slider, frameless)
ax_chk = plt.axes([0.76, 0.04, 0.18, 0.055])
ax_chk.set_frame_on(False)
chk = CheckButtons(ax_chk, ["unit cells"], [True])


def _toggle_grid(_label):
    vis = chk.get_status()[0]
    for ln in gridlines:
        ln.set_visible(vis)
    fig.canvas.draw_idle()


chk.on_clicked(_toggle_grid)


def update(_):
    iz = nidx(z, s_z.val); iy = nidx(y, s_y.val); ix = nidx(x, s_x.val)
    imgs = [s_xy(iz), s_xz(iy), s_yz(ix)]
    a12 = [(xw, yw), (xw, zw), (yw, zw)]
    titles = [f"x_H–y_K  (z_L={z[iz]:+.1f} Å)",
              f"x_H–z_L  (y_K={y[iy]:+.1f} Å)",
              f"y_K–z_L  (x_H={x[ix]:+.1f} Å)"]
    for im, ax, img, (a1, a2), ttl, angle in zip(panels, axes, imgs, a12, titles,
                                                 panel_angles):
        im.set_data(img.T)
        vm = pvmax(img, a1, a2, angle) * s_c.val
        im.set_clim(-vm, vm)
        ax.set_title(ttl, fontsize=12)
    fig.canvas.draw_idle()


for s in (s_x, s_y, s_z, s_c):
    s.on_changed(update)

_temp_seg = f"  {LABEL}" if LABEL else ""
fig.suptitle(f"{KIND} orthoslices{_temp_seg}  (apod={apod})  ±{RMAX:.0f} Å  "
             "— drag x_H/y_K/z_L cuts; contrast scales colour", y=0.97, fontsize=13)

if SMOKE:
    out = Path(__file__).parent / "_explore_delta_pdf_ortho_smoke.png"
    fig.savefig(out, dpi=120, bbox_inches="tight")
    print(f"[SMOKE] saved {out.name}", flush=True)
else:
    print("Drag the cut sliders to move each orthogonal plane; contrast scales "
          "the colour range. Close the window to exit.", flush=True)
    plt.show()
