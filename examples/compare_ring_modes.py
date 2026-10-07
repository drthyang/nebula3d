"""Side-by-side comparison of the ring-removal models on one volume.

One column per model, all on the same slice:

    top row     data | cleaned (model 1) | cleaned (model 2) | ...
    bottom row  leftover radial profile | removed ring (model 1) | ...

The top row shares one colour scale (vmin/vmax sliders, linear/log₁₀), the
removed-ring row another ("removed max").  Every image panel shares its axes,
so zooming one zooms all, and the zoom is kept while you scrub the plane
slider.  The bottom-left panel is the all-azimuth median radial profile of each
cleaned plane (data in grey, confirmed ring shells as faint lines): a leftover
ring is a bump, an over-subtraction a dip.

Each model's cleaned volume is computed once with the pipeline's own path
(``pipeline.load_input`` → ``pipeline.remove_rings`` with that model's default
``RingParams``) and cached as float32 under ``data/processed/ring_modes/``, so
later launches open at once.  A cache made with different parameters is
recomputed; ``FORCE=1`` recomputes regardless (e.g. after changing the code).

Run::

    TEMP=<T> PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl \\
      python3 examples/compare_ring_modes.py

Env:
    TEMP        <T>: picks data/raw/*_<T>_*_cc.nxs (default: the one
                data/raw/*_cc.nxs, when there is exactly one)
    DATA_FILE   raw input instead of TEMP
    MODELS      comma-separated (default pooled,patched,parametric,global_v2);
                "parametric:peaks" selects the parametric peaks mode
    VIEW_AXIS   H | K | L initial slice orientation (default H)
    H_VALUE / K_VALUE / L_VALUE  initial cut (default 0.3333 for H, else 0)
    SLIDER_MIN, SLIDER_MAX       vmin/vmax slider travel (default 0 … 1)
    FORCE=1     recompute every model;  SMOKE=1 render one frame headless
"""
import os

import matplotlib

SMOKE = os.environ.get("SMOKE", "0") == "1"
matplotlib.use("Agg" if SMOKE else "macosx")

import dataclasses
import json
import time
from pathlib import Path

import h5py
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import Normalize
from matplotlib.widgets import RadioButtons, Slider

from nebula3d import pipeline
from nebula3d.preprocessing.radial_background import _stack_plane_q_magnitude
from nebula3d.visualization.slices import _PLANE, _imshow_extent

RAW_DIR = Path("data/raw")
CACHE = Path("data/processed/ring_modes")
MODELS = [m.strip() for m in os.environ.get(
    "MODELS", "pooled,patched,parametric,global_v2").split(",") if m.strip()]
FORCE = os.environ.get("FORCE", "0") == "1"
VIEW_AXIS = os.environ.get("VIEW_AXIS", "H").strip().upper()
KEYS = {"H": "kl", "K": "hl", "L": "hk"}          # _PLANE keys (display orientation)
STACK = {"kl": ("0kl", 0), "hl": ("h0l", 1), "hk": ("hk0", 2)}
VIEW_VALUE = float(os.environ.get(f"{VIEW_AXIS}_VALUE",
                                  "0.3333" if VIEW_AXIS == "H" else "0.0"))
SLIDER_MIN = float(os.environ.get("SLIDER_MIN", "0.0"))
SLIDER_MAX = float(os.environ.get("SLIDER_MAX", "1.0"))
COLORS = ["#0b7f8a", "#d9822b", "#7a4fb5", "#c23b4a", "#4a8c2a", "#8a6d1f"]


def _raw_path() -> Path:
    if os.environ.get("DATA_FILE"):
        return Path(os.environ["DATA_FILE"])
    temp = os.environ.get("TEMP", "").strip()
    pattern = f"*_{temp}_*_cc.nxs" if temp else "*_cc.nxs"
    cands = sorted(p for p in RAW_DIR.glob(pattern))
    if len(cands) != 1:
        what = f"TEMP={temp}" if temp else "TEMP unset"
        raise SystemExit(f"{what}: expected one data/raw/{pattern}, "
                         f"found {len(cands)}; set TEMP or DATA_FILE")
    return cands[0]


def _ring_params(model: str) -> pipeline.RingParams:
    name, _, mode = model.partition(":")
    p = pipeline.RingParams(ring_model=name)
    return dataclasses.replace(p, ring_radial_mode=mode) if mode else p


def _load_or_compute(raw_path: Path, vol, pp: pipeline.PipelineParams) -> dict:
    """Return {model: (data f32, mask, attrs)}, computing what the cache lacks."""
    CACHE.mkdir(parents=True, exist_ok=True)
    out = {}
    for model in MODELS:
        rp = _ring_params(model)
        params = json.dumps({"rings": dataclasses.asdict(rp), "edge_trim": pp.edge_trim},
                            sort_keys=True)
        path = CACHE / f"{raw_path.stem}__{model.replace(':', '-')}.h5"
        if path.exists() and not FORCE:
            with h5py.File(path, "r") as f:
                if f.attrs.get("params") == params:
                    print(f"  {model:18s} cached ({f.attrs['seconds']:.0f} s to compute)",
                          flush=True)
                    out[model] = (f["data"][()], f["mask"][()], dict(f.attrs))
                    continue
        print(f"  {model:18s} computing ...", flush=True)
        t0 = time.time()
        cleaned = pipeline.remove_rings(vol, rp)
        secs = time.time() - t0
        diag = getattr(cleaned, "_ring_diagnostics", None) or {}
        shells = [float(s["q_center"]) for s in diag.get("shells", [])]
        data = cleaned.data.astype(np.float32)
        attrs = {"model": model, "params": params, "seconds": secs,
                 "shells": json.dumps(shells)}
        chunks = (1,) + data.shape[1:]
        with h5py.File(path, "w") as f:
            f.create_dataset("data", data=data, chunks=chunks, compression="lzf")
            f.create_dataset("mask", data=cleaned.mask, chunks=chunks, compression="lzf")
            f.attrs.update(attrs)
        print(f"  {model:18s} done in {secs:.0f} s", flush=True)
        out[model] = (data, cleaned.mask, attrs)
        del cleaned
    return out


raw_path = _raw_path()
pp = pipeline.PipelineParams()
print(f"loading {raw_path.name}", flush=True)
vol = pipeline.load_input(raw_path, pp)
results = _load_or_compute(raw_path, vol, pp)
raw_data = vol.data.astype(np.float32)
raw_mask = vol.mask & np.isfinite(vol.data)
shells = next((json.loads(a["shells"]) for _, _, a in results.values()
               if json.loads(a.get("shells", "[]"))), [])

state = {"key": KEYS.get(VIEW_AXIS, "kl"), "log": False, "top": []}


def plane(arr: np.ndarray, key: str, idx: int) -> np.ndarray:
    a = np.take(arr, idx, axis=_PLANE[key][1])
    return a.T if _PLANE[key][6] else a


def axes_of(key: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, str, str]:
    fixed, _, y_attr, x_attr, y_lab, x_lab, _ = _PLANE[key]
    return (getattr(vol, fixed), getattr(vol, x_attr), getattr(vol, y_attr), x_lab, y_lab)


def profile(q2: np.ndarray, d2: np.ndarray, m2: np.ndarray, edges: np.ndarray) -> np.ndarray:
    ok = m2 & np.isfinite(d2) & (q2 >= edges[0]) & (q2 < edges[-1])
    b = np.digitize(q2[ok], edges) - 1
    v = d2[ok]
    order = np.lexsort((v, b))
    b, v = b[order], v[order]
    n = np.bincount(b, minlength=edges.size - 1)
    start = np.zeros_like(n)
    np.cumsum(n[:-1], out=start[1:])
    out = np.full(edges.size - 1, np.nan)
    nz = np.nonzero(n >= 5)[0]
    out[nz] = 0.5 * (v[start[nz] + (n[nz] - 1) // 2] + v[start[nz] + n[nz] // 2])
    return out


# ------------------------------------------------------------------ figure
n_cols = 1 + len(MODELS)
fig = plt.figure(figsize=(min(4.0 * n_cols, 24), 10.2))
gs = fig.add_gridspec(2, n_cols, left=0.05, right=0.985, top=0.93, bottom=0.27,
                      hspace=0.28, wspace=0.12)
ax0 = fig.add_subplot(gs[0, 0])
img_axes = [ax0] + [fig.add_subplot(gs[0, c], sharex=ax0, sharey=ax0)
                    for c in range(1, n_cols)]
rem_axes = [fig.add_subplot(gs[1, c], sharex=ax0, sharey=ax0) for c in range(1, n_cols)]
ax_prof = fig.add_subplot(gs[1, 0])

fixed_axis, x_ax, y_ax, x_lab, y_lab = axes_of(state["key"])
idx0 = int(np.argmin(np.abs(fixed_axis - VIEW_VALUE)))
extent = _imshow_extent(x_ax, y_ax)
cmap_top = plt.get_cmap("viridis").with_extremes(bad="0.55")
cmap_rem = plt.get_cmap("magma").with_extremes(bad="0.55")
top_imgs, rem_imgs = [], []
for c, ax in enumerate(img_axes):
    im = ax.imshow(np.zeros((y_ax.size, x_ax.size)), origin="lower", extent=extent,
                   aspect="auto", cmap=cmap_top, vmin=0.0, vmax=0.3,
                   interpolation="nearest")
    top_imgs.append(im)
    if c == 0:
        ax.set_title("data")
    else:
        m = MODELS[c - 1]
        tag = " (default)" if m == "pooled" else ""
        ax.set_title(f"{m}{tag}  ·  {results[m][2]['seconds']:.0f} s",
                     color=COLORS[(c - 1) % len(COLORS)])
    ax.tick_params(labelleft=(c == 0))
for c, ax in enumerate(rem_axes):
    im = ax.imshow(np.zeros((y_ax.size, x_ax.size)), origin="lower", extent=extent,
                   aspect="auto", cmap=cmap_rem, vmin=0.0, vmax=0.3,
                   interpolation="nearest")
    rem_imgs.append(im)
    ax.set_title(f"removed by {MODELS[c]}", color=COLORS[c % len(COLORS)], fontsize=10)
    ax.tick_params(labelleft=(c == 0))
for ax in img_axes[:1] + rem_axes[:1]:
    ax.set_ylabel(y_lab)
for ax in rem_axes:
    ax.set_xlabel(x_lab)

edges = np.arange(1.5, 10.5 + 0.02, 0.02)
qc = 0.5 * (edges[:-1] + edges[1:])
(raw_line,) = ax_prof.plot(qc, np.zeros_like(qc), color="0.6", lw=0.8, label="data")
prof_lines = [ax_prof.plot(qc, np.zeros_like(qc), color=COLORS[i % len(COLORS)], lw=1.0,
                           label=m)[0] for i, m in enumerate(MODELS)]
for q0 in shells:
    ax_prof.axvline(q0, color="0.8", lw=0.6, zorder=0)
ax_prof.set_xlabel("|Q| (Å⁻¹)")
ax_prof.set_title("all-azimuth median, this plane", fontsize=10)
ax_prof.legend(fontsize=8, loc="upper right")


def show_top() -> None:
    for im, a in zip(top_imgs, state["top"]):
        im.set_data(np.log10(np.clip(a, 1e-3, None)) if state["log"] else a)


def redraw(idx: int, reset_view: bool = False) -> None:
    key = state["key"]
    fixed_axis, x_ax, y_ax, x_lab, y_lab = axes_of(key)
    raw2 = plane(raw_data, key, idx)
    rmask2 = plane(raw_mask, key, idx)
    top = [np.where(rmask2, raw2, np.nan)]
    plane_name, stack_axis = STACK[key]
    q2 = _stack_plane_q_magnitude(vol, plane_name, stack_axis, idx)
    q2 = q2.T if _PLANE[key][6] else q2
    raw_line.set_ydata(profile(q2, raw2, rmask2, edges))
    tops = []
    for c, m in enumerate(MODELS):
        d, msk, _ = results[m]
        d2 = plane(d, key, idx)
        m2 = plane(msk, key, idx)
        top.append(np.where(m2, d2, np.nan))
        rem_imgs[c].set_data(np.where(rmask2, raw2 - d2, np.nan))
        prof = profile(q2, d2, m2, edges)
        prof_lines[c].set_ydata(prof)
        tops.append(prof[np.isfinite(prof)])
    state["top"] = top
    show_top()
    allp = np.concatenate(tops) if tops else np.array([0.0, 1.0])
    if allp.size:
        lo, hi = np.percentile(allp, [1, 99.5])
        pad = 0.25 * (hi - lo + 1e-6)
        ax_prof.set_ylim(lo - pad, hi + pad)
    q_ok = np.isfinite(raw_line.get_ydata())
    if q_ok.any():
        ax_prof.set_xlim(qc[q_ok].min(), qc[q_ok].max())
    if reset_view:
        ext = _imshow_extent(x_ax, y_ax)
        for im in top_imgs + rem_imgs:
            im.set_extent(ext)
        ax0.set_xlim(ext[0], ext[1])
        ax0.set_ylim(ext[2], ext[3])
        for ax in img_axes[:1] + rem_axes[:1]:
            ax.set_ylabel(y_lab)
        for ax in rem_axes:
            ax.set_xlabel(x_lab)
    name = _PLANE[key][0][0].upper()
    fig.suptitle(f"{raw_path.stem.split('_(')[0]}  ·  {name} = {fixed_axis[idx]:+.4g} r.l.u.",
                 fontsize=13)
    fig.canvas.draw_idle()


# ---------------------------------------------------------------- controls
slx, slw = 0.30, 0.52
s_val = Slider(fig.add_axes((slx, 0.185, slw, 0.025), facecolor="#e8eef7"),
               f"{VIEW_AXIS} plane", float(fixed_axis.min()), float(fixed_axis.max()),
               valinit=float(fixed_axis[idx0]), color="#3a6ea5")
s_vmin = Slider(fig.add_axes((slx, 0.135, slw, 0.022)), "vmin", SLIDER_MIN, SLIDER_MAX,
                valinit=max(SLIDER_MIN, 0.0))
s_vmax = Slider(fig.add_axes((slx, 0.100, slw, 0.022)), "vmax", SLIDER_MIN, SLIDER_MAX,
                valinit=min(SLIDER_MAX, 0.3))
s_rem = Slider(fig.add_axes((slx, 0.050, slw, 0.022)), "removed max", 0.0, SLIDER_MAX,
               valinit=min(SLIDER_MAX, 0.3), color="#a34a2b")
r_axis = RadioButtons(fig.add_axes((0.05, 0.10, 0.07, 0.11)), ("H", "K", "L"),
                      active=("H", "K", "L").index(VIEW_AXIS))
r_mode = RadioButtons(fig.add_axes((0.14, 0.10, 0.08, 0.08)), ("linear", "log₁₀"), active=0)


def apply_clim(_=None) -> None:
    a, b = sorted((s_vmin.val, s_vmax.val))
    if state["log"]:
        a, b = np.log10(max(a, 1e-3)), np.log10(max(b, 2e-3))
    for im in top_imgs:
        im.set_norm(Normalize(a, b))
    for im in rem_imgs:
        im.set_clim(0.0, max(s_rem.val, 1e-6))
    fig.canvas.draw_idle()


def on_mode(label) -> None:
    state["log"] = label == "log₁₀"
    show_top()
    apply_clim()


def current_index(val: float) -> int:
    fixed_axis = axes_of(state["key"])[0]
    return int(np.argmin(np.abs(fixed_axis - val)))


def on_value(val: float) -> None:
    redraw(current_index(val))
    apply_clim()


def on_axis(label) -> None:
    state["key"] = KEYS[label]
    fixed_axis = axes_of(state["key"])[0]
    s_val.valmin, s_val.valmax = float(fixed_axis.min()), float(fixed_axis.max())
    s_val.ax.set_xlim(s_val.valmin, s_val.valmax)
    s_val.label.set_text(f"{label} plane")
    start = 0.0 if fixed_axis.min() <= 0.0 <= fixed_axis.max() else float(fixed_axis[0])
    s_val.eventson = False
    s_val.set_val(start)
    s_val.eventson = True
    redraw(current_index(start), reset_view=True)
    apply_clim()


s_val.on_changed(on_value)
for s in (s_vmin, s_vmax, s_rem):
    s.on_changed(apply_clim)
r_mode.on_clicked(on_mode)
r_axis.on_clicked(on_axis)
fig._ring_mode_widgets = (s_val, s_vmin, s_vmax, s_rem, r_axis, r_mode)  # keep alive

redraw(idx0, reset_view=True)
apply_clim()
print("Drag the plane slider, zoom any panel (all follow), set the colour scales; "
      "close the window to exit.", flush=True)
if SMOKE:
    out = Path("examples") / "_compare_ring_modes_smoke.png"
    fig.savefig(out, dpi=60)
    print(f"[SMOKE] saved {out}")
else:
    plt.show()
