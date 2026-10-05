# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Quality metrics for the Bragg punch and backfill — diagnostic only.

Nothing here changes a punch or a fill.  Two sets of metrics:

* **Real data**, where the truth is unknown.  The punch stage keeps the original
  data under each hole (only the mask changes) and records the holes, so:

  - :func:`hole_census` — how many holes, how big, how many merged;
  - :func:`hole_rings` + :func:`summarise_rings` — per hole, the intensity in
    shells *outside* it by distance in Å⁻¹ (Bragg tails leaking past the punch
    show as excess in the first shell) and the fill against those shells;
  - :func:`detection_significance` — every detected peak scored with the
    punch's own significance measure (``BraggRemover._peak_significance``).

* **Ground truth**, on a synthetic volume whose components are known
  (:func:`nebula3d.demo.demo_volume`): :func:`score_against_truth` scores the
  punch (Bragg left behind, diffuse removed, false detections) and the fill
  (bias inside the holes, and the 3D-ΔPDF error at the lattice vectors, where a
  node-periodic fill error lands).
"""

from __future__ import annotations

import dataclasses
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from nebula3d.analysis.bragg import BraggRemover
from nebula3d.core import HKLVolume

#: Ring edges (Å⁻¹) outside each hole: ~one voxel per ring on CORELLI grids,
#: the last ring is the local reference level.
RING_EDGES_Q: tuple[float, ...] = (0.0, 0.04, 0.08, 0.12, 0.16, 0.22, 0.30)
#: Brightness bins (hole peak above the reference, in noise units).
BRIGHTNESS_BINS: tuple[tuple[float, float], ...] = (
    (-np.inf, 30.0), (30.0, 100.0), (100.0, 1000.0), (1000.0, np.inf))


def q_voxel_size(vol: HKLVolume) -> tuple[float, float, float]:
    """Å⁻¹ per voxel along each grid axis (exact for orthogonal cells)."""
    steps = [abs(float(a[1] - a[0])) if a.size > 1 else 1.0
             for a in (vol.h_axis, vol.k_axis, vol.l_axis)]
    norms = np.linalg.norm(vol.ub_matrix, axis=0)
    return (float(norms[0] * steps[0]), float(norms[1] * steps[1]),
            float(norms[2] * steps[2]))


def hole_census(
    vol: HKLVolume,
    punched: NDArray[np.bool_],
    *,
    large: Sequence[int] = (2_000, 10_000),
    top: int = 5,
) -> dict:
    """Connected punch holes (26-connectivity): count, sizes, merging.

    ``large`` are the hole sizes (voxels) whose share of the punched voxels is
    reported — merged holes are filled as one region by a flat fill.  ``top``
    lists the largest holes with their centre (axis coordinates).
    """
    labels, n = ndimage.label(punched, structure=np.ones((3, 3, 3), dtype=bool))
    sizes = np.bincount(labels.ravel(), minlength=n + 1)[1:]
    total = int(sizes.sum())
    out: dict = {"n_holes": int(n), "punched_voxels": total,
                 "punched_fraction": float(punched.mean()) if punched.size else 0.0}
    if n == 0:
        return out
    out["size_percentiles"] = {str(p): float(v) for p, v in
                               zip((50, 90, 99, 100),
                                   np.percentile(sizes, [50, 90, 99, 100]))}
    out["share_in_holes_over"] = {str(s): float(sizes[sizes > s].sum() / total)
                                  for s in large}
    biggest = np.argsort(sizes)[::-1][:top]
    centres = ndimage.center_of_mass(punched, labels, index=biggest + 1)
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    out["largest"] = [
        {"voxels": int(sizes[b]),
         "centre": [float(np.interp(c, np.arange(a.size), a)) for c, a in zip(cm, axes)]}
        for b, cm in zip(biggest, centres)]
    return out


@dataclass(frozen=True)
class HoleRings:
    """Per-hole shells outside the punch (see :func:`hole_rings`).

    Arrays are per hole (axis 0) and per ring (axis 1).  The outermost ring is
    the hole's reference level; ``noise`` is its robust scatter (1.4826·MAD).
    """

    edges_q: NDArray[np.float64]
    size: NDArray[np.int64]
    peak: NDArray[np.float64]
    inside_sum: NDArray[np.float64]
    median: NDArray[np.float64]
    p90: NDArray[np.float64]
    count: NDArray[np.int64]
    noise: NDArray[np.float64]
    fill: NDArray[np.float64] | None

    @property
    def reference(self) -> NDArray[np.float64]:
        return self.median[:, -1]

    def excess(self) -> NDArray[np.float64]:
        """Ring medians above the reference, in noise units."""
        return (self.median - self.reference[:, None]) / self.noise[:, None]


def hole_rings(
    vol: HKLVolume,
    punched: NDArray[np.bool_],
    filled: NDArray[np.floating] | None = None,
    *,
    edges_q: Sequence[float] = RING_EDGES_Q,
    min_count: int = 5,
) -> HoleRings:
    """Shells of measured voxels outside every punch hole, by distance in Å⁻¹.

    *vol* is the punched volume: ``vol.data`` still holds the original values
    under the holes, ``vol.mask`` excludes them.  Every valid voxel within
    ``edges_q[-1]`` of a hole is assigned to its nearest hole (Euclidean
    distance with per-axis Å⁻¹ spacing, exact for orthogonal cells) and to a
    ring.  *filled* (the backfilled data) adds each hole's median fill.

    Peak memory is a few volume-sized arrays (the distance transform and its
    indices); this is a native QA tool, not for the browser.
    """
    edges = np.asarray(edges_q, dtype=np.float64)
    nb = edges.size - 1
    labels, n = ndimage.label(punched, structure=np.ones((3, 3, 3), dtype=bool))
    index = np.arange(1, n + 1)
    size = np.bincount(labels.ravel(), minlength=n + 1)[1:].astype(np.int64)
    data = vol.data
    peak = np.asarray(ndimage.maximum(np.where(punched, data, -np.inf), labels, index),
                      dtype=np.float64)
    inside_sum = np.asarray(ndimage.sum(np.where(punched, data, 0.0), labels, index),
                            dtype=np.float64)

    dist, ind = ndimage.distance_transform_edt(
        ~punched, sampling=q_voxel_size(vol), return_indices=True)
    near = labels[ind[0], ind[1], ind[2]]
    del ind
    valid = vol.mask & np.isfinite(data) & ~punched
    sel = valid & (dist > 0) & (dist <= edges[-1])
    ring = np.digitize(dist[sel], edges) - 1
    del dist
    key = near[sel].astype(np.int64) * nb + ring
    del near
    vals = data[sel].astype(np.float64)
    order = np.argsort(key, kind="stable")
    key, vals = key[order], vals[order]
    bounds = np.searchsorted(key, np.arange((n + 1) * nb + 1))
    median = np.full((n + 1) * nb, np.nan)
    p90 = np.full((n + 1) * nb, np.nan)
    mad = np.full((n + 1) * nb, np.nan)
    count = np.zeros((n + 1) * nb, dtype=np.int64)
    for k in range(nb, (n + 1) * nb):  # label 0 (outside every hole) skipped
        seg = vals[bounds[k]:bounds[k + 1]]
        count[k] = seg.size
        if seg.size >= min_count:
            m = float(np.median(seg))
            median[k] = m
            p90[k] = float(np.percentile(seg, 90))
            mad[k] = 1.4826 * float(np.median(np.abs(seg - m)))
    shape = (n + 1, nb)
    median, p90, mad = median.reshape(shape)[1:], p90.reshape(shape)[1:], mad.reshape(shape)[1:]
    count = count.reshape(shape)[1:]
    noise = np.maximum(mad[:, -1], np.finfo(np.float64).tiny)
    fill = (np.asarray(ndimage.median(filled, labels, index), dtype=np.float64)
            if filled is not None else None)
    return HoleRings(edges_q=edges, size=size, peak=peak, inside_sum=inside_sum,
                     median=median, p90=p90, count=count, noise=noise, fill=fill)


def summarise_rings(
    rings: HoleRings,
    bins: Sequence[tuple[float, float]] = BRIGHTNESS_BINS,
) -> dict:
    """Leakage and fill step by hole brightness, in noise units.

    Per bin of hole peak (above the reference, in noise units): median ring
    excess per ring; the median 90th-percentile excess of the first ring and
    the fraction of holes where it tops 3σ (a tail leaking on one side, which
    a ring median hides); the fill minus the first ring and minus the
    reference.  ``outside_over_inside`` compares, for holes brighter than 100σ,
    the excess in the first two rings with the excess punched out.
    """
    ex = rings.excess()
    ok = np.isfinite(ex).all(axis=1)
    ref, noise = rings.reference, rings.noise
    peak_z = (rings.peak - ref) / noise
    p90_z = (rings.p90[:, 0] - ref) / noise
    step_ring1 = step_ref = None
    if rings.fill is not None:
        step_ring1 = (rings.fill - rings.median[:, 0]) / noise
        step_ref = (rings.fill - ref) / noise

    def row(sel: NDArray[np.bool_]) -> dict:
        r = {"n_holes": int(sel.sum()),
             "ring_excess_median": [float(v) for v in np.median(ex[sel], axis=0)],
             "ring1_p90_excess_median": float(np.median(p90_z[sel])),
             "frac_ring1_p90_over_3sigma": float(np.mean(p90_z[sel] > 3.0))}
        if step_ring1 is not None and step_ref is not None:
            r["fill_minus_ring1"] = float(np.median(step_ring1[sel]))
            r["fill_minus_reference"] = float(np.median(step_ref[sel]))
        return r

    out: dict = {"ring_centres_q": [float(v) for v in
                                    0.5 * (rings.edges_q[1:] + rings.edges_q[:-1])],
                 "n_holes": int(ok.sum()), "bins": []}
    for lo, hi in bins:
        sel = ok & (peak_z >= lo) & (peak_z < hi)
        if sel.sum():
            out["bins"].append({"peak_over_noise": [lo, hi], **row(sel)})
    if ok.any():
        out["all"] = row(ok)
    strong = ok & (peak_z >= 100.0)
    if strong.any():
        inside = rings.inside_sum[strong] - ref[strong] * rings.size[strong]
        near = (rings.median[strong, :2] - ref[strong, None]) * rings.count[strong, :2]
        out["outside_over_inside"] = float(np.nansum(near) / np.nansum(inside))
    return out


def detection_significance(
    vol: HKLVolume,
    centers_hkl: Sequence[Sequence[float]],
    remover: BraggRemover | None = None,
) -> NDArray[np.float64]:
    """The punch's significance ``z`` at each peak centre (nearest voxel).

    The same measure as the ``min_significance`` gate: the detection window's
    median as background, its robust scatter where ``sigma`` is unusable.
    *vol* should be the volume the peaks were detected on (for saved outputs,
    the punched file with its holes put back into the mask).
    """
    r = remover or BraggRemover()
    out = np.full(len(centers_hkl), np.nan)
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    for j, c in enumerate(centers_hkl):
        idx = tuple(int(np.argmin(np.abs(a - float(v)))) for a, v in zip(axes, c))
        stats = r._window_stats(vol, idx)  # type: ignore[arg-type]  # noqa: SLF001
        if stats is not None:
            out[j] = r._peak_significance(vol, idx, *stats)  # type: ignore[arg-type]  # noqa: SLF001
    return out


def lattice_points(shape: Sequence[int], axes: Sequence[NDArray[np.float64]],
                   *, include_origin: bool = False) -> tuple[NDArray[np.intp], ...]:
    """Indices of the grid points nearest every integer (u, v, w) in range.

    *axes* are fractional real-space axes (``compute_delta_pdf(...,
    real_space_angstrom=False)``); the points are the conventional cell's
    lattice vectors, where a node-periodic error in reciprocal space lands.
    """
    picks = []
    for a in axes:
        ints = np.arange(np.ceil(a.min()), np.floor(a.max()) + 1)
        picks.append([int(np.argmin(np.abs(a - v))) for v in ints])
    grid = np.array(np.meshgrid(*picks, indexing="ij")).reshape(3, -1)
    if not include_origin:
        origin = [int(np.argmin(np.abs(a))) for a in axes]
        grid = grid[:, ~np.all(grid == np.array(origin)[:, None], axis=0)]
    return tuple(grid)


def score_against_truth(
    vol_in: HKLVolume,
    punched: NDArray[np.bool_],
    filled: HKLVolume,
    *,
    bragg: NDArray[np.floating],
    diffuse: NDArray[np.floating],
    beam: NDArray[np.floating] | None = None,
    peaks: Sequence | None = None,
    delta_pdf: bool = True,
    pdf_kwargs: dict | None = None,
) -> dict:
    """Score a punch + fill against a volume's known components.

    *vol_in* is the punch input (diffuse + Bragg + beam + noise), *bragg*,
    *diffuse* and *beam* the noise-free components, *punched* the punch's
    holes and *filled* the backfilled volume.  ``σ`` is ``vol_in.sigma``.

    - ``bragg_left``: share of the Bragg intensity outside the holes;
      ``leak_voxels``: unpunched voxels whose Bragg part exceeds 3σ.
    - ``collateral``: share of punched voxels whose Bragg part is under 1σ
      (diffuse removed for nothing); the incident beam's region is left out.
    - ``false_detections``: detected peaks (records with ``ih, ik, il``) whose
      centre carries less than 3σ of Bragg.
    - ``fill_bias`` / ``fill_rms``: filled − diffuse over the holes, relative
      to the mean diffuse there (signed: negative = under-fill).
    - ΔPDF (``delta_pdf=True``): the error against an oracle that equals the
      diffuse truth inside the holes and the input minus Bragg and beam
      outside (the same noise), relative RMS over the map and at the lattice
      vectors (see :func:`lattice_points`), and at the origin.
    """
    sigma = np.asarray(vol_in.sigma, dtype=np.float64)
    bragg = np.asarray(bragg, dtype=np.float64)
    diffuse = np.asarray(diffuse, dtype=np.float64)
    beam_arr = (np.zeros_like(bragg) if beam is None
                else np.asarray(beam, dtype=np.float64))
    measured = vol_in.mask & np.isfinite(vol_in.data)
    beam_region = beam_arr > 3.0 * sigma
    total = float(bragg[measured].sum())
    left = measured & ~punched
    out: dict = {
        "punched_voxels": int(punched.sum()),
        "bragg_left": float(bragg[left].sum() / total) if total > 0 else 0.0,
        "leak_voxels": int((left & (bragg > 3.0 * sigma)).sum()),
    }
    holes = punched & ~beam_region
    out["collateral"] = (float(np.mean(bragg[holes] < sigma[holes]))
                         if holes.any() else 0.0)
    if peaks is not None:
        false = [p for p in peaks
                 if bragg[p.ih, p.ik, p.il] < 3.0 * sigma[p.ih, p.ik, p.il]]
        out["detections"] = len(peaks)
        out["false_detections"] = len(false)
    f = np.asarray(filled.data, dtype=np.float64)
    if holes.any():
        err = f[holes] - diffuse[holes]
        level = float(np.mean(diffuse[holes])) or 1.0
        out["fill_bias"] = float(np.mean(err) / level)
        out["fill_rms"] = float(np.sqrt(np.mean(err * err)) / level)
    if delta_pdf:
        from nebula3d.analysis.delta_pdf import compute_delta_pdf

        kw = {"apodization": "gaussian", "gaussian_sigma": 0.4, **(pdf_kwargs or {}),
              "real_space_angstrom": False}
        data_in = np.asarray(vol_in.data, dtype=np.float64)
        oracle = np.where(punched, diffuse, data_in - bragg - beam_arr)
        ones = np.ones(vol_in.shape, dtype=bool)
        got = compute_delta_pdf(dataclasses.replace(filled, mask=ones), **kw)
        ref = compute_delta_pdf(dataclasses.replace(vol_in, data=oracle, mask=ones), **kw)
        d = got.data - ref.data
        axes = (ref.x_axis, ref.y_axis, ref.z_axis)
        pts = lattice_points(ref.data.shape, axes)
        origin = tuple(int(np.argmin(np.abs(a))) for a in axes)
        rms = lambda a: float(np.sqrt(np.mean(np.square(a))))  # noqa: E731
        out["pdf_rel_rms"] = rms(d) / (rms(ref.data) or 1.0)
        out["pdf_lattice_rel_rms"] = rms(d[pts]) / (rms(ref.data[pts]) or 1.0)
        out["pdf_origin_rel"] = float(abs(d[origin]) / (abs(ref.data[origin]) or 1.0))
    return out
