# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Isotropic radial-background flattening: a fitted ``const + c·F(Q)²`` pedestal.

Motivation
----------
After ring removal, Bragg punching, and backfilling, the volume still carries a
smooth, isotropic radial pedestal.  Left in, it does not fall to zero at the box
faces, and the ΔPDF transform turns that step into the cross along the axes.

Physics of the default model
----------------------------
The elastic intensity is a sum over site pairs; each pair lands in the ΔPDF at
its separation vector.  The self terms (a site with itself) have r = 0 and
carry no correlation information.  They are the pedestal:

* **const** — nuclear incoherent scattering (spin + isotope): uncorrelated,
  elastic, flat in |Q| (apart from the Debye–Waller fall-off, not modelled);
* **c·F(Q)²** — single-ion paramagnetic scattering,
  ``(2/3)(γr₀/2)² g²J(J+1) F(Q)²`` for isotropic fluctuations: the shape of
  the ion's magnetic form factor
  (:func:`~nebula3d.preprocessing.form_factor.magnetic_form_factor`, dipole
  approximation) and nothing else.

Both vary on a scale of ≳1 Å⁻¹, so in real space they sit at r ≲ 1–2 Å and
cannot reach a pair vector.  The flatten measures each thin |Q| shell's
**floor** (a low percentile, below the diffuse and the Bragg-residual tail),
fits ``const + c·F(Q)²`` to those floor levels by least squares over
``fit_q_range``, and subtracts the fitted curve at each voxel's exact |Q|.

What the model does *not* remove is the point.  Spin (or displacive)
correlations at distance r add a shell-averaged ``sin(Qr)/(Qr)`` term with
period 2π/r (about 2.1 Å⁻¹ for r = 3 Å).  The earlier free-form floor, smoothed
at 0.1 Å⁻¹, followed those oscillations and subtracted them, carving spherical
shells at the near-neighbour distances into the ΔPDF; a two-term model of fixed
shape cannot follow them.  Its limits: for anisotropic (Ising-like) moments
the self term is ``F²(1 − (Q̂·ê)²)``, and only its shell average is removed;
and a smooth background that is not F²-shaped (multiple scattering, sample
environment) stays in.

A third term, ``b·Q²`` (``q2_term=True``), takes the smooth rise of the
inelastic background: thermal diffuse scattering (multiphonon, with
neutrons), whose leading |Q| dependence is the Debye–Waller exponent
2W ∝ Q², and with X-rays Compton scattering, which also starts out as Q².
It too varies only on the scale of the whole
|Q| range, so it cannot follow a correlation's oscillation; on a warm or
light-element sample the floor can otherwise climb several-fold across the
coverage, leaving a pedestal that steps down at the coverage edge.  Q² is only
the leading term — the true rise saturates as ``1 − e^(−2W)`` — so past the
end of ``fit_q_range`` the term is held at its value there instead of
extrapolated (on a measured volume the extrapolation over-subtracted the
partial shells at the coverage edge).

Estimator
---------
``'model'`` (default) is the fit above.  With the default ``ion=None`` it fits
a constant only (a non-magnetic sample); name the magnetic ion to add the
``c·F(Q)²`` term.  ``'floor'`` subtracts the smoothed per-shell floor itself
and ``'snip'`` the SNIP baseline of the per-shell median profile — both are
free-form, so both remove some isotropic diffuse signal (kept for comparison).
The shell ``median`` and ``mode`` estimators were removed: they include the
diffuse signal itself.

Validation
----------
``examples/validate_flatten.py`` is a real-data QA for this stage: (1)
**isotropy** — is the level we subtract really azimuthally flat? and (2)
**feature preservation / over-subtraction**.  The subtraction is a function of
|Q| alone, so it cannot create or distort anisotropic structure (regression:
``test_radial_flatten.py``).
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy.ndimage import gaussian_filter1d

from nebula3d.core import HKLVolume, low_memory, q_bin_indices, q_magnitude_from_axes
from nebula3d.preprocessing.form_factor import ion_key, magnetic_form_factor
from nebula3d.preprocessing.radial_background import _estimate_baseline, _fill_nan_1d

#: H planes per |Q| slab (one float64 slab is the only |Q| ever resident).
_SLAB = 16

ESTIMATORS = ("model", "floor", "snip")


@dataclass
class RadialFlattenResult:
    """Result of :func:`flatten_radial_background`.

    Attributes
    ----------
    volume : HKLVolume
        The flattened volume (``data`` minus the radial background; ``mask`` and
        ``sigma`` unchanged).
    q_grid : (Q,)
        Shell centres (Å⁻¹).
    bg_curve : (Q,)
        The smooth, continuous background level subtracted at each shell — the
        curve actually interpolated and removed.
    raw_levels : (Q,)
        Per-shell level *before* the along-|Q| smoothing (diagnostic).  NaN for
        shells with fewer than ``min_count`` valid voxels.
    counts : (Q,)
        Number of valid voxels in each shell.
    estimator : str
        The estimator used (see module docstring).
    model_coef : (const, c), optional
        ``estimator='model'``: the fitted pedestal ``const + c·F(Q)²`` (``c`` is
        0 without an ion).
    model_q2 : float, optional
        ``estimator='model'`` with ``q2_term``: the fitted ``b`` of ``b·Q²``.
    model_q2_cap : float, optional
        The |Q| past which ``b·Q²`` is held at its value (the fit range's end;
        None when the fit had no upper end).
    model_r2 : float, optional
        ``estimator='model'``: R² of the fit over the fitted shells.
    ion : str, optional
        ``estimator='model'``: the magnetic ion whose ``F(Q)`` was used.
    """

    volume: HKLVolume
    q_grid: NDArray[np.float64]
    bg_curve: NDArray[np.float64]
    raw_levels: NDArray[np.float64]
    counts: NDArray[np.int_]
    estimator: str
    model_coef: tuple[float, float] | None = None
    model_r2: float | None = None
    ion: str | None = None
    model_q2: float | None = None
    model_q2_cap: float | None = None


def flatten_radial_background(
    vol: HKLVolume,
    *,
    q_step: float = 0.05,
    estimator: str = "model",
    floor_percentile: float = 25.0,
    snip_width: float = 0.3,
    smooth: float = 0.10,
    min_count: int = 20,
    q_range: tuple[float, float] | None = None,
    clip_negative: bool = False,
    ion: str | None = None,
    fit_q_range: tuple[float, float] | None = (0.8, 10.0),
    q2_term: bool = False,
) -> RadialFlattenResult:
    """Subtract a smooth, continuous isotropic radial background from *vol*.

    Parameters
    ----------
    q_step : float
        Spherical-shell width (Å⁻¹).  A few times finer than the scale of the
        background drift; the along-|Q| smoothing controls noise, so a fine step
        is safe (default 0.05).
    estimator : {'model', 'floor', 'snip'}
        What is subtracted (see module docstring).  ``'model'`` (default): the
        ``const + c·F(Q)²`` pedestal fitted to the per-shell floors.
        ``'floor'``: the smoothed per-shell floor itself.
    floor_percentile : float
        Percentile giving each shell's floor, for ``'model'`` and ``'floor'``
        (default 25).
    snip_width : float
        Peak-removal width (Å⁻¹) for ``estimator='snip'`` (default 0.3).
    smooth : float
        σ (Å⁻¹) of the Gaussian smoothing the per-shell levels into a continuous
        ``bg(|Q|)`` for ``'floor'`` (default 0.10).  Set 0 to disable (not for
        ``snip``, which smooths internally; unused by ``'model'``, which is
        smooth by construction).
    min_count : int
        Shells with fewer valid voxels get no level (NaN): ``'model'`` leaves
        them out of the fit, the free-form estimators interpolate them from
        their neighbours (default 20).
    q_range : (float, float), optional
        Restrict the swept |Q| range (Å⁻¹).  ``None`` sweeps the full data range.
    clip_negative : bool
        If True, clamp the flattened data at 0 (default False — negative
        residuals below the background are meaningful and kept).
    ion : str or None
        ``estimator='model'``: the magnetic ion whose form factor shapes the
        paramagnetic term (e.g. ``'Mn2+'``; see
        :data:`~nebula3d.preprocessing.form_factor.IONS`).  ``None`` (default)
        or ``'none'`` fits a constant only.
    fit_q_range : (float, float), optional
        ``estimator='model'``: |Q| range (Å⁻¹) of the shells the model is fitted
        to (default 0.8–10, clear of the beam stop and the sparse high-|Q|
        corners).  ``None`` fits every shell with a level.
    q2_term : bool
        ``estimator='model'``: also fit ``b·Q²`` (an inelastic background
        rising with |Q|; see the module docstring).  Default False.
    """
    if estimator not in ESTIMATORS:
        raise ValueError(f"Unknown estimator {estimator!r}; choose one of {ESTIMATORS}.")
    ion = ion_key(ion) if estimator == "model" else None

    data = vol.data
    valid = vol.mask & np.isfinite(data)
    if not valid.any():
        empty = np.zeros(0, dtype=np.float64)
        return RadialFlattenResult(
            volume=vol, q_grid=empty, bg_curve=empty,
            raw_levels=empty, counts=np.zeros(0, dtype=int), estimator=estimator,
        )

    # |Q| is computed one H-slab at a time (range, bins, then the subtraction
    # below): the full float64 grid, held through the digitize/clip temporaries
    # and the interpolated background, was ~5 volumes — this stage's peak in
    # the browser's WASM heap.  Elementwise arithmetic and exact min/max, so
    # every value is identical to the whole-volume form.
    def q_slab(lo: int) -> NDArray[np.floating]:
        return q_magnitude_from_axes(vol.h_axis[lo:lo + _SLAB], vol.k_axis,
                                     vol.l_axis, vol.ub_matrix)

    qs = max(float(q_step), 1e-12)
    if q_range is None:
        q0, q1 = np.inf, -np.inf
        for lo in range(0, data.shape[0], _SLAB):
            v = valid[lo:lo + _SLAB]
            if v.any():
                qv = q_slab(lo)[v]
                q0, q1 = min(q0, float(qv.min())), max(q1, float(qv.max()))
    else:
        q0, q1 = float(q_range[0]), float(q_range[1])
    edges = np.arange(q0, q1 + qs, qs)
    if edges.size < 2:
        # numpy's shape-typed stubs (which differ across the supported numpy
        # versions) infer `edges` as 1-D from np.arange, so the generic-shape
        # np.array fallback trips [assignment].  Behaviour is identical; the
        # config disables unused-ignore, so this is safe on every version.
        edges = np.array([q0, q0 + qs])  # type: ignore[assignment]
    q_grid = 0.5 * (edges[:-1] + edges[1:])
    nb = q_grid.size
    # int32 indices: the shell count is tiny, and the full-volume index array
    # is half the size of numpy's default int64.
    bin_idx = q_bin_indices(vol.h_axis, vol.k_axis, vol.l_axis, vol.ub_matrix,
                            edges, slab=_SLAB)
    bin_idx -= 1
    np.clip(bin_idx, 0, nb - 1, out=bin_idx)

    # Per-shell level from the *valid* voxels (sorted-segment scan, like the
    # q_shell backfill lookup), so each shell is touched once.  Prompt frees:
    # each flattened array covers most of the volume, so the gather runs in
    # storage precision and is widened to float64 (exact) only after the sort
    # permutation is freed.
    flat_b = bin_idx[valid]
    del bin_idx  # full-volume index array no longer needed
    order = np.argsort(flat_b, kind="stable")
    sb = flat_b[order]
    del flat_b
    gathered = data[valid][order]
    del order
    si = gathered.astype(np.float64, copy=False)
    del gathered
    bounds = np.searchsorted(sb, np.arange(nb + 1))
    del sb

    raw = np.full(nb, np.nan)
    counts = np.zeros(nb, dtype=int)
    median_profile = estimator == "snip"
    for b in range(nb):
        seg = si[bounds[b]:bounds[b + 1]]
        counts[b] = seg.size
        if seg.size < min_count:
            continue
        raw[b] = (
            float(np.median(seg)) if median_profile
            else _shell_level(seg, estimator, floor_percentile)
        )

    model_coef: tuple[float, float] | None = None
    model_r2: float | None = None
    q2 = 0.0
    q2_cap = fit_q_range[1] if (q2_term and fit_q_range is not None) else None
    if estimator == "model":
        model_coef, q2, model_r2 = _fit_pedestal(q_grid, raw, ion, fit_q_range, q2_term)
        bg_curve = _pedestal(q_grid, model_coef, ion, q2, q2_cap)
    elif estimator == "snip":
        # SNIP baseline of the median radial profile: the floor under broad humps.
        bg_curve = _estimate_baseline(_fill_nan_1d(raw), qs, snip_width, smooth)
    elif smooth > 0:
        bg_curve = gaussian_filter1d(_fill_nan_1d(raw), smooth / qs, mode="nearest")
    else:
        bg_curve = _fill_nan_1d(raw)

    # Subtract the smooth curve at each voxel's exact |Q| (continuous, no shell
    # step), leaving NaN/masked voxels untouched.  Masked ``where=`` ops instead
    # of fancy indexing: boolean indexing materialises compressed copies of
    # data/bg_at (up to 3 extra volume-sized arrays on mostly-finite data).
    # In low-memory mode subtract in place over the (disposable) input instead of
    # allocating a second full volume — the pipeline hands this stage a fresh
    # volume and discards it afterwards.  Same arithmetic, bit-identical output.
    # The model is evaluated exactly at each |Q| (no clamp outside the swept
    # range); the free-form curves are interpolated.
    data_out = data if low_memory() else data.copy()
    for lo in range(0, data.shape[0], _SLAB):
        sl = slice(lo, lo + _SLAB)
        bg_at = (
            _pedestal(q_slab(lo), model_coef, ion, q2, q2_cap) if model_coef is not None
            else np.interp(q_slab(lo), q_grid, bg_curve,
                           left=float(bg_curve[0]), right=float(bg_curve[-1]))
        )
        finite = np.isfinite(data[sl])
        np.subtract(data[sl], bg_at, out=data_out[sl], where=finite)
        if clip_negative:
            np.maximum(data_out[sl], 0.0, out=data_out[sl], where=finite)

    vol_out = dataclasses.replace(vol, data=data_out)
    return RadialFlattenResult(
        volume=vol_out, q_grid=q_grid, bg_curve=bg_curve,
        raw_levels=raw, counts=counts, estimator=estimator,
        model_coef=model_coef, model_r2=model_r2, ion=ion,
        model_q2=q2 if (estimator == "model" and q2_term) else None,
        model_q2_cap=q2_cap if estimator == "model" else None,
    )


def _pedestal(
    q: NDArray[np.floating], coef: tuple[float, float], ion: str | None, q2: float = 0.0,
    q2_cap: float | None = None,
) -> NDArray[np.float64]:
    """``const + c·F(Q)² + b·Q²`` at *q* (no F² term without an ion), with
    ``Q`` in the last term held at *q2_cap* beyond it."""
    const, c = coef
    out = np.full(np.shape(q), const, dtype=np.float64)
    if ion is not None:
        out = out + c * magnetic_form_factor(q, ion) ** 2
    if q2:
        qq = np.asarray(q, dtype=np.float64)
        if q2_cap is not None:
            qq = np.minimum(qq, q2_cap)
        out = out + q2 * np.square(qq)
    return out


def _fit_pedestal(
    q_grid: NDArray[np.float64],
    levels: NDArray[np.float64],
    ion: str | None,
    fit_q_range: tuple[float, float] | None,
    q2_term: bool = False,
) -> tuple[tuple[float, float], float, float | None]:
    """Least-squares ``const + c·F(Q)² (+ b·Q²)`` through the per-shell floor
    *levels*.

    Fits the shells inside *fit_q_range*, or every shell with a level if fewer
    than two lie there.  Unconstrained: an over-subtracted empty can leaves a
    negative constant, which must come out too.  Returns ``((const, c), b, R²)``
    (``c`` 0 without an ion, ``b`` 0 without *q2_term*).
    """
    cols = [np.ones_like(q_grid)]
    if ion is not None:
        cols.append(magnetic_form_factor(q_grid, ion) ** 2)
    if q2_term:
        cols.append(np.square(q_grid))
    x = np.column_stack(cols)
    sel = np.isfinite(levels)
    if fit_q_range is not None:
        lo, hi = fit_q_range
        in_range = sel & (q_grid >= lo) & (q_grid <= hi)
        if in_range.sum() >= 2:
            sel = in_range
    if sel.sum() < x.shape[1]:
        # Too few shells to fit (a tiny volume): fall back to their mean level.
        const = float(np.mean(levels[sel])) if sel.any() else 0.0
        return (const, 0.0), 0.0, None
    y = levels[sel]
    coef, *_ = np.linalg.lstsq(x[sel], y, rcond=None)
    resid = y - x[sel] @ coef
    var = float(np.var(y))
    r2 = 1.0 - float(np.var(resid)) / var if var > 0 else None
    c = float(coef[1]) if ion is not None else 0.0
    b = float(coef[-1]) if q2_term else 0.0
    return (float(coef[0]), c), b, r2


def _shell_level(
    vals: NDArray[np.float64], estimator: str, floor_percentile: float
) -> float:
    """Robust per-shell background level for the non-profile estimators."""
    if estimator in ("model", "floor"):
        return float(np.percentile(vals, floor_percentile))
    raise ValueError(f"Unknown estimator: {estimator!r}")
