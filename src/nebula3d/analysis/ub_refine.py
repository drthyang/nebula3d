# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Refining the UB matrix from where the Bragg peaks sit.

A UB slightly off puts each Bragg peak beside its node: a rotation error by
the angle times |Q| across Q (0.25 Å⁻¹ at 16 Å⁻¹ for 0.9°), a cell error by
the relative error times |Q| along it.  :func:`measure_centres` finds each
node's peak and its centre; :func:`fit_ub` finds the UB that puts the centres
back on their nodes; :func:`refine_ub` does both from the low-|Q| peaks
outward, since far out a peak can sit too far from its node to be found
before a first fit has moved the search.  The fits:

- ``"orientation"``: a rotation of the lattice, the cell kept (Kabsch's
  solution of Wahba's problem);
- ``"lattice"``: the cell, with the parameters the symmetry operations leave
  free (a and c for a hexagonal cell), the orientation kept;
- ``"both"``: the rotation and the cell together;
- ``"symmetric"``: the changes UB·D that commute with the operations
  (M·D = D·M for each): the scales of the hk plane and of l for 6/mmm, and
  without operations any change at all, the free nine-parameter UB.

Symmetrising hides what does not commute with the operations.  A rotation
turns each node's orbit partners by the rotation's conjugates, so the node
holds a ring centred on itself (its centroid inward by about half the squared
angle, 1e-4 of |Q| for 0.9°), and the orientation can only be refined from
unsymmetrised data; :func:`symmetry_break` tells the two apart.  What commutes
survives: a cell error that keeps the symmetry moves the equivalent nodes
alike, and the symmetrised peaks stay sharp, as far off their nodes as before.
A symmetrised volume takes the ``"symmetric"`` fit, in its own HKL, where the
symmetrising was done: the other fits work in Q, and through a UB whose cell
lacks the symmetry (a free refinement's, off by a few parts in a thousand)
they would read the averaging itself as a distortion.

:func:`regrid` resamples a volume onto a refined UB's HKL grid, which puts
the peaks on their nodes; symmetrising afterwards stacks the copies instead
of spreading them into rings.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume
from nebula3d.symmetry import GridSymmetry, _group_closure

FITS = ("orientation", "lattice", "both", "symmetric")

#: A volume differing from its images under the operations by less than this
#: (relative RMS, :func:`symmetry_break`) counts as symmetrised.
SYMMETRISED = 1e-4

#: The centring window's σ, in voxels (the cube root of a voxel's volume in Q).
#: A window narrower than the peak's sampling lets the voxel grid pull the
#: centre; one and a half voxels keeps the error of a peak 0.6 voxel wide (σ)
#: under 0.01 voxel.
WINDOW_VOXELS = 1.5

#: Distances from the nodes below this (Å⁻¹) are never rejected as outliers.
_RESIDUAL_FLOOR = 1e-4

_TWO_PI = 2.0 * np.pi

Ops = tuple[NDArray[np.int64], ...]
Cell = tuple[float, float, float, float, float, float]


@dataclass(frozen=True)
class Centres:
    """The Bragg peaks :func:`measure_centres` found, one row per node."""

    nodes: NDArray[np.int64]  # (n, 3) the nodes
    hkl: NDArray[np.float64]  # (n, 3) the peaks' centres, in the volume's HKL
    excess: NDArray[np.float64]  # (n,) the peak's height over the local background
    significance: NDArray[np.float64]  # (n,) that height in robust local noise sigmas
    n_searched: int  # nodes searched: in the |Q| range, their shell inside the box


@dataclass(frozen=True)
class UBFit:
    """A refined UB, and how close it brings the peaks to their nodes."""

    ub: NDArray[np.float64]  # the refined UB (Q = UB·hkl, 2π included)
    ub_start: NDArray[np.float64]  # the UB the centres were measured with
    fit: str  # one of FITS
    transform: NDArray[np.float64]  # UB_start⁻¹·UB: node h sits at transform·h in the start HKL
    rotation: NDArray[np.float64]  # the orientation's change, a rotation in Q
    angle_deg: float  # its angle
    axis_uvw: NDArray[np.float64]  # its axis as a real-space direction, largest |component| 1
    cell_start: Cell  # a, b, c (Å), α, β, γ (°) of ub_start
    cell: Cell  # ... of the refined UB
    used: NDArray[np.bool_]  # the centres the fit kept
    residual: NDArray[np.float64]  # |Q_centre − UB·node| per centre, refined UB (Å⁻¹)
    rms_start: float  # RMS of that distance over the centres kept, with ub_start
    rms: float  # ... with the refined UB

    @property
    def n_used(self) -> int:
        return int(self.used.sum())

    @property
    def n_rejected(self) -> int:
        return int((~self.used).sum())


@dataclass(frozen=True)
class RefinePass:
    """One pass of :func:`refine_ub`: the peaks out to ``q_max`` and the fit."""

    q_max: float
    n_found: int
    n_used: int
    rms_start: float
    rms: float
    angle_deg: float


@dataclass(frozen=True)
class RadialOffset:
    """The peaks' median offset along Q from their nodes, relative to |Q|, in
    one |Q| band and one direction class (see :func:`radial_offsets`)."""

    q_lo: float
    q_hi: float
    direction: str  # "in-plane", "oblique" or "near the third axis"
    n: int
    before: float  # with the start UB
    after: float  # with the refined UB


@dataclass(frozen=True)
class Refinement:
    """:func:`refine_ub`'s result: the last pass's fit and centres, every pass,
    and how far the volume is from symmetric under the operations given."""

    fit: UBFit
    centres: Centres
    passes: tuple[RefinePass, ...]
    symmetry_break: float | None  # None without operations


def cell_parameters(ub: NDArray[np.floating]) -> Cell:
    """a, b, c (Å) and α, β, γ (°) of the cell *ub* describes (2π included)."""
    ub = np.asarray(ub, dtype=np.float64)
    g = _TWO_PI ** 2 * np.linalg.inv(ub.T @ ub)
    a, b, c = (float(x) for x in np.sqrt(np.diag(g)))

    def angle(cos_num: float, x: float, y: float) -> float:
        return float(np.degrees(np.arccos(np.clip(cos_num / (x * y), -1.0, 1.0))))

    return (a, b, c, angle(float(g[1, 2]), b, c), angle(float(g[0, 2]), a, c),
            angle(float(g[0, 1]), a, b))


def symmetry_break(vol: HKLVolume, ops: Ops, *, n_sample: int = 200_000,
                   seed: int = 0) -> float:
    """How far *vol* is from symmetric under *ops*: the RMS difference between
    measured voxels and their measured images, relative to the voxels' RMS.

    Taken over *n_sample* random voxels, so a full volume costs little.  A
    symmetrised volume gives rounding error (below :data:`SYMMETRISED`); a
    measured one, its noise and whatever breaks the symmetry.  NaN when no
    voxel and image are both measured.  Raises ``ValueError`` when *ops* do
    not map the grid onto itself (see :meth:`GridSymmetry.for_volume`).
    """
    sym = GridSymmetry.for_volume(vol, ops)
    shape = np.asarray(vol.shape)
    valid = np.asarray(vol.mask, dtype=bool) & np.isfinite(vol.data)
    rng = np.random.default_rng(seed)
    idx = np.stack(np.unravel_index(rng.integers(0, vol.data.size, n_sample), vol.shape),
                   axis=1)
    idx = idx[valid[idx[:, 0], idx[:, 1], idx[:, 2]]]
    own = np.asarray(vol.data[idx[:, 0], idx[:, 1], idx[:, 2]], dtype=np.float64)
    diff2 = total2 = 0.0
    for r, t in sym.index_ops[1:]:
        img = idx @ r.T + t
        both = np.all((img >= 0) & (img < shape), axis=1)
        both[both] = valid[img[both, 0], img[both, 1], img[both, 2]]
        other = np.asarray(vol.data[img[both, 0], img[both, 1], img[both, 2]],
                           dtype=np.float64)
        diff2 += float(np.sum((own[both] - other) ** 2))
        total2 += float(np.sum(own[both] ** 2))
    return float(np.sqrt(diff2 / total2)) if total2 > 0 else float("nan")


def measure_centres(
    vol: HKLVolume,
    *,
    ub: NDArray[np.floating] | None = None,
    cell: tuple[int, int, int] = (1, 1, 1),
    q_min: float = 0.0,
    q_max: float | None = None,
    reach: float = 0.25,
    min_significance: float = 10.0,
) -> Centres:
    """Each Bragg node's peak and its centre.

    The nodes are the integer HKL that are multiples of *cell* (``(2, 2, 2)``
    for a volume indexed on a doubled cell whose odd nodes hold no Bragg
    peaks), with |Q| between *q_min* and *q_max*.  Each node's peak is the
    brightest measured voxel within *reach* (Å⁻¹) of where *ub* puts the node
    (the volume's own UB by default); the shell out to twice *reach* gives
    the local background and noise (median and 1.4826·MAD).  The peak counts
    when it stands *min_significance* noise sigmas above the background, and
    the box must hold the shell and the centring window.

    The centre is a windowed centroid (SExtractor's windowed positions): the
    background-subtracted centroid under a Gaussian window, isotropic in Q and
    :data:`WINDOW_VOXELS` voxels wide, moved onto the centroid until it stops
    moving.  A centroid of the voxels above a threshold exaggerates a peak's
    offset from the voxel it peaks in (by a third, on a peak a voxel or two
    wide), and the offsets grow steadily across the lattice when the cell is
    off, so the fit would inherit the error; the window's does not.
    """
    if reach <= 0:
        raise ValueError("reach must be positive")
    ub_vol = np.asarray(vol.ub_matrix, dtype=np.float64)
    ub_pred = ub_vol if ub is None else np.asarray(ub, dtype=np.float64)
    inv_vol = np.linalg.inv(ub_vol)
    to_vol = inv_vol @ ub_pred  # node → where it is predicted, in the volume's HKL
    axes = [np.asarray(a, dtype=np.float64) for a in (vol.h_axis, vol.k_axis, vol.l_axis)]
    start = np.array([a[0] for a in axes])
    step = np.array([(a[-1] - a[0]) / (a.size - 1) if a.size > 1 else 1.0 for a in axes])
    stop = np.array([a[-1] for a in axes])
    width = WINDOW_VOXELS * abs(float(np.linalg.det(ub_vol * step[None, :]))) ** (1 / 3)
    outer = max(2.0 * reach, reach + 3.0 * width)  # the box's reach from the prediction
    half = outer * np.linalg.norm(inv_vol, axis=1)  # ... along each HKL axis

    # Candidate nodes: every multiple of the cell whose prediction can fall in the box.
    corners = np.array(np.meshgrid(*zip(start, stop), indexing="ij")).reshape(3, -1).T
    g_corners = corners @ np.linalg.inv(to_vol).T
    ranges = [np.arange(int(np.ceil(g_corners[:, i].min() / cell[i])) * cell[i],
                        int(np.floor(g_corners[:, i].max() / cell[i])) * cell[i] + 1, cell[i])
              for i in range(3)]
    nodes = np.array(np.meshgrid(*ranges, indexing="ij")).reshape(3, -1).T
    predicted = nodes @ to_vol.T
    q_node = np.linalg.norm(nodes @ ub_pred.T, axis=1)
    keep = (np.all((predicted - half >= start) & (predicted + half <= stop), axis=1)
            & (q_node > 0) & (q_node >= q_min)
            & (q_node <= (np.inf if q_max is None else q_max)))
    nodes, predicted = nodes[keep], predicted[keep]

    found_nodes, found_hkl, found_excess, found_z = [], [], [], []
    for node, centre in zip(nodes, predicted):
        lo = np.ceil((centre - half - start) / step - 1e-9).astype(int)
        hi = np.floor((centre + half - start) / step + 1e-9).astype(int) + 1
        box = (slice(int(lo[0]), int(hi[0])), slice(int(lo[1]), int(hi[1])),
               slice(int(lo[2]), int(hi[2])))
        sub = np.asarray(vol.data[box], dtype=np.float64)
        coords = [axes[i][box[i]] - centre[i] for i in range(3)]
        qv = np.stack(np.meshgrid(*coords, indexing="ij"), axis=-1) @ ub_vol.T
        dist = np.linalg.norm(qv, axis=-1)
        measured = np.asarray(vol.mask[box], dtype=bool) & np.isfinite(sub)
        inner = measured & (dist <= reach)
        shell = measured & (dist > reach) & (dist <= 2.0 * reach)
        if not inner.any() or int(shell.sum()) < 7:
            continue
        vals = sub[shell]
        bg = float(np.median(vals))
        noise = 1.4826 * float(np.median(np.abs(vals - bg)))
        top = np.unravel_index(int(np.argmax(np.where(inner, sub, -np.inf))), sub.shape)
        excess = float(sub[top]) - bg
        z = excess / noise if noise > 0 else (np.inf if excess > 0 else 0.0)
        if excess <= 0 or z < min_significance:
            continue
        found = _windowed_centre(qv[measured], sub[measured] - bg, qv[top], width, reach)
        if found is None:
            continue
        found_nodes.append(node)
        found_hkl.append(centre + inv_vol @ found)
        found_excess.append(excess)
        found_z.append(z)
    return Centres(
        nodes=np.array(found_nodes, dtype=np.int64).reshape(-1, 3),
        hkl=np.array(found_hkl, dtype=np.float64).reshape(-1, 3),
        excess=np.array(found_excess, dtype=np.float64),
        significance=np.array(found_z, dtype=np.float64),
        n_searched=len(nodes),
    )


def _windowed_centre(q: NDArray[np.float64], excess: NDArray[np.float64],
                     start: NDArray[np.float64], width: float,
                     reach: float) -> NDArray[np.float64] | None:
    """The fixed point of the centroid of *excess* at *q* under a Gaussian
    window of σ *width* centred on it, from *start*; the window is cut at
    three σ.  None when the window's weight is not positive, or the centre
    moves more than *reach* from *start* or does not settle."""
    x = np.asarray(start, dtype=np.float64).copy()
    for _round in range(100):
        d = q - x
        r2 = np.sum(d * d, axis=1)
        near = r2 <= 9.0 * width * width
        w = excess[near] * np.exp(-r2[near] / (2.0 * width * width))
        total = float(w.sum())
        if total <= 0:
            return None
        shift = (w[:, None] * d[near]).sum(axis=0) / total
        x = x + shift
        if float(np.linalg.norm(x - start)) > reach:
            return None
        if float(np.linalg.norm(shift)) < 1e-6 * width:
            return x
    return None


def fit_ub(
    centres_hkl: NDArray[np.floating],
    nodes: NDArray[np.integer],
    ub: NDArray[np.floating],
    *,
    fit: str = "orientation",
    ops: Ops | None = None,
    weights: NDArray[np.floating] | None = None,
    reject: float = 3.0,
    keep_within: float = _RESIDUAL_FLOOR,
) -> UBFit:
    """The UB that best puts the peak centres on their nodes.

    *centres_hkl* are measured in the HKL of *ub*, so each lies at
    Q = UB·centre; the fit minimises Σ w·|Q − UB′·node|² over the UB′ that
    *fit* allows (see the module docstring).  The cell keeps the metric *ops*
    leave invariant, triclinic without them; the ``"symmetric"`` fit is a
    linear least-squares fit of D.  A centre farther from its node
    than *reject* times the median distance, and than *keep_within* (Å⁻¹), is
    left out and the fit repeated, up to five times: a peak taken for the
    wrong node, or ring residue.  (*keep_within* keeps a model that misses
    some directions by a little from dropping them as outliers.)
    """
    if fit not in FITS:
        raise ValueError(f"fit must be one of {FITS}, not {fit!r}")
    ub0 = np.asarray(ub, dtype=np.float64)
    h = np.asarray(nodes, dtype=np.float64).reshape(-1, 3)
    q = np.asarray(centres_hkl, dtype=np.float64).reshape(-1, 3) @ ub0.T
    w = np.ones(len(h)) if weights is None else np.asarray(weights, dtype=np.float64)
    group = _group(ops)
    basis = _commutant(group) if fit == "symmetric" else _metric_basis(group)
    n_params = (len(basis) if fit == "symmetric"
                else (0 if fit == "lattice" else 3) + (0 if fit == "orientation" else len(basis)))
    need = max(3, n_params)
    if len(h) < need:
        raise ValueError(f"{len(h)} peak centres: the {fit} fit needs at least {need}")

    def solve(sel: NDArray[np.bool_]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        new = _solve(fit, q[sel], h[sel], w[sel], ub0, group, basis)
        return new, np.linalg.norm(q - h @ new.T, axis=1)

    used = np.ones(len(h), dtype=bool)
    for _round in range(5):
        ub_fit, residual = solve(used)
        kept = residual <= max(reject * float(np.median(residual[used])), keep_within)
        if int(kept.sum()) < need or np.array_equal(kept, used):
            break
        used = kept
    else:
        ub_fit, residual = solve(used)

    rotation = _orientation(ub_fit) @ _orientation(ub0).T
    angle, axis = _angle_axis(rotation)
    uvw = ub0.T @ axis / _TWO_PI
    if np.abs(uvw).max() > 0:
        uvw = uvw / uvw[np.argmax(np.abs(uvw))]
    start_residual = np.linalg.norm(q - h @ ub0.T, axis=1)
    return UBFit(
        ub=ub_fit, ub_start=ub0, fit=fit, transform=np.linalg.inv(ub0) @ ub_fit,
        rotation=rotation, angle_deg=angle,
        axis_uvw=uvw, cell_start=cell_parameters(ub0), cell=cell_parameters(ub_fit),
        used=used, residual=residual,
        rms_start=float(np.sqrt(np.mean(start_residual[used] ** 2))),
        rms=float(np.sqrt(np.mean(residual[used] ** 2))),
    )


#: |Q| bands (Å⁻¹) for :func:`radial_offsets`.
OFFSET_BANDS = ((0.0, 4.0), (4.0, 8.0), (8.0, 12.0), (12.0, 16.0), (16.0, float("inf")))

#: Direction classes for :func:`radial_offsets`: cos² of a node's angle from
#: the third reciprocal axis (c* for a hexagonal or tetragonal cell).
OFFSET_DIRECTIONS = (("in-plane", 0.0, 0.05), ("oblique", 0.05, 0.7),
                     ("near the third axis", 0.7, 1.0 + 1e-9))


def auto_fit(vol: HKLVolume, ops: Ops | None) -> tuple[str, float | None]:
    """The fit a UB check takes, and the volume's :func:`symmetry_break`:
    ``"symmetric"`` on a volume symmetrised under *ops*, else ``"both"`` (the
    cell constrained by *ops*, triclinic without them)."""
    broken = None if ops is None else symmetry_break(vol, ops)
    return ("symmetric" if broken is not None and broken < SYMMETRISED else "both"), broken


def radial_offsets(fit: UBFit, centres: Centres, *, min_peaks: int = 3) -> list[RadialOffset]:
    """The peaks' offset along Q from their nodes relative to |Q| (median), per
    |Q| band (:data:`OFFSET_BANDS`) and direction (:data:`OFFSET_DIRECTIONS`),
    with the start UB and the refined one, over the centres the fit kept.

    A UB maps HKL to Q linearly, so a UB error gives a relative offset that
    depends on direction but is the same at every |Q| along it: one that
    changes with |Q| is not a UB error, and refining the UB only averages it.
    Classes with fewer than *min_peaks* peaks are left out.
    """
    q_obs = centres.hkl @ fit.ub_start.T
    axis = fit.ub[:, 2] / np.linalg.norm(fit.ub[:, 2])
    rel, cos2, qn = {}, None, None
    for key, ub in (("before", fit.ub_start), ("after", fit.ub)):
        q_node = centres.nodes @ ub.T
        norm = np.linalg.norm(q_node, axis=1)
        rel[key] = np.sum((q_obs - q_node) * q_node, axis=1) / norm ** 2
        if key == "after":
            qn, cos2 = norm, (q_node @ axis / norm) ** 2
    assert qn is not None and cos2 is not None
    out = []
    for lo, hi in OFFSET_BANDS:
        for name, a, b in OFFSET_DIRECTIONS:
            sel = fit.used & (qn >= lo) & (qn < hi) & (cos2 >= a) & (cos2 < b)
            if int(sel.sum()) >= min_peaks:
                out.append(RadialOffset(q_lo=lo, q_hi=hi, direction=name, n=int(sel.sum()),
                                        before=float(np.median(rel["before"][sel])),
                                        after=float(np.median(rel["after"][sel]))))
    return out


def refine_ub(
    vol: HKLVolume,
    *,
    fit: str = "orientation",
    ops: Ops | None = None,
    cell: tuple[int, int, int] = (1, 1, 1),
    q_min: float = 0.0,
    q_max: float | None = None,
    reach: float = 0.25,
    min_significance: float = 10.0,
    passes: int = 3,
    reject: float = 3.0,
) -> Refinement:
    """Measure the Bragg peaks' centres and fit the UB, from low |Q| outward.

    Pass *i* of *passes* measures the nodes out to (i + 1)/*passes* of the
    |Q| limit (*q_max*, or the box's farthest corner) where the previous
    pass's UB predicts them, and fits again; the first pass searches around
    the volume's own UB.  Every fit is reported against the volume's UB, and
    keeps every centre within half a voxel of its node (``keep_within``).

    *ops* constrain the fit (see :func:`fit_ub`) and are checked against the
    data: a volume symmetrised under them takes only the ``"symmetric"`` fit
    (see the module docstring), and any other raises ``ValueError``.  The
    other arguments are :func:`measure_centres`'s and :func:`fit_ub`'s.
    """
    from nebula3d.analysis.coverage import box_extent_q

    if fit not in FITS:
        raise ValueError(f"fit must be one of {FITS}, not {fit!r}")
    if passes < 1:
        raise ValueError("passes must be at least 1")
    broken = None if ops is None else symmetry_break(vol, ops)
    if fit != "symmetric" and broken is not None and broken < SYMMETRISED:
        raise ValueError(
            f"this volume is symmetrised under the {len(_group(ops))} operations given "
            f"(it differs from its images by {broken:.1e}): it shows only the UB changes "
            "that commute with them, and a misorientation as rings around the nodes rather "
            "than shifts.  Fit 'symmetric' on it, and the orientation on the unsymmetrised "
            "volume.")
    top = box_extent_q(vol)[1] if q_max is None else float(q_max)
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    step = np.array([(float(a[-1]) - float(a[0])) / (a.size - 1) if a.size > 1 else 1.0
                     for a in (vol.h_axis, vol.k_axis, vol.l_axis)])
    half_voxel = 0.5 * abs(float(np.linalg.det(ub * step[None, :]))) ** (1 / 3)
    history: list[RefinePass] = []
    result: UBFit | None = None
    centres: Centres | None = None
    for i in range(passes):
        limit = top * (i + 1) / passes
        centres = measure_centres(vol, ub=ub, cell=cell, q_min=q_min, q_max=limit,
                                  reach=reach, min_significance=min_significance)
        result = fit_ub(centres.hkl, centres.nodes, vol.ub_matrix, fit=fit, ops=ops,
                        reject=reject, keep_within=half_voxel)
        ub = result.ub
        history.append(RefinePass(q_max=limit, n_found=len(centres.nodes),
                                  n_used=result.n_used, rms_start=result.rms_start,
                                  rms=result.rms, angle_deg=result.angle_deg))
    assert result is not None and centres is not None
    return Refinement(fit=result, centres=centres, passes=tuple(history),
                      symmetry_break=broken)


def regrid(vol: HKLVolume, ub: NDArray[np.floating], *, chunk: int = 8) -> HKLVolume:
    """*vol* resampled onto the HKL grid of *ub*.

    The new volume's voxel at h holds what *vol* measured at the same Q, at
    UB_vol⁻¹·UB·h in *vol*'s HKL, interpolated trilinearly: no ringing beside
    sharp peaks and no negative lobes, but a peak a voxel wide loses height
    and gains width where its centre falls between voxels.  A voxel counts as
    measured when every voxel it is interpolated from does; the others are left
    as the loader leaves unmeasured space, masked with data and σ zero.  σ is
    interpolated like the data, which overstates it a little (interpolating
    averages the neighbours' noise).  Same axes and dtype; the UB becomes
    *ub*.  Worked through *chunk* H planes at a time, each from the input
    sub-box it needs.

    Trim the coverage edge first (:func:`nebula3d.preprocessing.sampling.
    trim_coverage_edge`): its voxels, barely covered by the detectors, can sit
    orders of magnitude above the interior, and interpolation and symmetrising
    carry them inward, where no later trim reaches them.
    """
    from scipy import ndimage

    ub_new = np.asarray(ub, dtype=np.float64)
    axes = [np.asarray(a, dtype=np.float64) for a in (vol.h_axis, vol.k_axis, vol.l_axis)]
    start = np.array([a[0] for a in axes])
    step = np.array([(a[-1] - a[0]) / (a.size - 1) if a.size > 1 else 1.0 for a in axes])
    shape = np.array(vol.shape)
    t = np.linalg.inv(np.asarray(vol.ub_matrix, dtype=np.float64)) @ ub_new
    matrix = t * step[None, :] / step[:, None]  # S⁻¹·T·S: output index → input index
    offset = ((t - np.eye(3)) @ start) / step  # S⁻¹·(T − I)·a₀

    dtype = vol.data.dtype
    data = np.zeros(vol.shape, dtype=dtype)
    sigma = np.zeros(vol.shape, dtype=vol.sigma.dtype)
    mask = np.zeros(vol.shape, dtype=bool)
    for j0 in range(0, int(shape[0]), max(1, chunk)):
        j1 = min(int(shape[0]), j0 + max(1, chunk))
        corners = np.array([[j, k, m] for j in (j0, j1 - 1) for k in (0, shape[1] - 1)
                            for m in (0, shape[2] - 1)], dtype=np.float64)
        src = corners @ matrix.T + offset
        lo = np.clip(np.floor(src.min(axis=0)).astype(int) - 1, 0, shape)
        hi = np.clip(np.ceil(src.max(axis=0)).astype(int) + 2, 0, shape)
        if np.any(hi <= lo):
            continue
        box = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))
        sub = np.asarray(vol.data[box], dtype=np.float64)
        valid = np.asarray(vol.mask[box], dtype=bool) & np.isfinite(sub)
        sub_sigma = np.asarray(vol.sigma[box], dtype=np.float64)
        valid &= np.isfinite(sub_sigma)
        local_offset = matrix @ np.array([j0, 0.0, 0.0]) + offset - lo
        out_shape = (j1 - j0, int(shape[1]), int(shape[2]))

        def resample(values: NDArray[np.float64]) -> NDArray[np.float64]:
            return ndimage.affine_transform(
                values, matrix, offset=local_offset, output_shape=out_shape,
                order=1, mode="constant", cval=0.0, prefilter=False)

        weight = resample(valid.astype(np.float64))
        ok = weight >= 1.0 - 1e-6
        value = resample(np.where(valid, sub, 0.0))
        err = resample(np.where(valid, sub_sigma, 0.0))
        data[j0:j1] = np.where(ok, value, 0.0).astype(dtype)
        sigma[j0:j1] = np.where(ok, err, 0.0).astype(vol.sigma.dtype)
        mask[j0:j1] = ok
    return HKLVolume(data=data, sigma=sigma, mask=mask, h_axis=axes[0].copy(),
                     k_axis=axes[1].copy(), l_axis=axes[2].copy(), ub_matrix=ub_new,
                     instrument=vol.instrument)


def _group(ops: Ops | None) -> Ops:
    """The group *ops* generate; the identity alone without them."""
    if not ops:
        return (np.eye(3, dtype=np.int64),)
    return _group_closure(tuple(np.asarray(m, dtype=np.int64) for m in ops))


def _average(g: NDArray[np.float64], group: Ops) -> NDArray[np.float64]:
    """The metric *g* averaged over *group*: Mᵀ·g·M is how an operation M
    acting on HKL sees it, so the average is the nearest invariant metric."""
    return np.asarray(sum(m.T @ g @ m for m in group), dtype=np.float64) / len(group)


def _metric_basis(group: Ops) -> NDArray[np.float64]:
    """An orthonormal basis (k, 3, 3) of the metrics *group* leaves invariant:
    6 for a triclinic cell, 2 for a hexagonal one, 1 for a cubic one."""
    pairs = ((0, 0), (1, 1), (2, 2), (0, 1), (0, 2), (1, 2))
    images = []
    for i, j in pairs:
        e = np.zeros((3, 3))
        e[i, j] = e[j, i] = 1.0
        images.append(_average(e, group).ravel())
    _u, s, vt = np.linalg.svd(np.array(images))
    k = int(np.sum(s > 1e-9 * s[0]))
    return vt[:k].reshape(k, 3, 3)


def _commutant(group: Ops) -> NDArray[np.float64]:
    """An orthonormal basis (k, 3, 3) of the matrices D with M·D = D·M for
    every M in *group*: 9 for the identity alone, 2 for 6/mmm, 1 for m-3m."""
    eye = np.eye(3)
    # Row-major vec: vec(M·D) = (M ⊗ I)·vec(D), vec(D·M) = (I ⊗ Mᵀ)·vec(D).
    a = np.vstack([np.kron(m, eye) - np.kron(eye, m.T) for m in group])
    _u, s, vt = np.linalg.svd(a)
    rank = int(np.sum(s > 1e-9 * max(float(s[0]), 1.0)))
    return vt[rank:].reshape(-1, 3, 3)


def _orientation(ub: NDArray[np.float64]) -> NDArray[np.float64]:
    """U of UB = U·B, B upper triangular with a positive diagonal (Busing &
    Levy's B, the cell alone)."""
    b = np.linalg.cholesky(ub.T @ ub).T
    return np.asarray(ub @ np.linalg.inv(b), dtype=np.float64)


def _kabsch(a: NDArray[np.float64], b: NDArray[np.float64],
            w: NDArray[np.float64]) -> NDArray[np.float64]:
    """The proper rotation R minimising Σ w·|a − R·b|²."""
    u, _s, vt = np.linalg.svd((b * w[:, None]).T @ a)
    d = float(np.sign(np.linalg.det(vt.T @ u.T))) or 1.0
    return np.asarray(vt.T @ np.diag([1.0, 1.0, d]) @ u.T, dtype=np.float64)


def _angle_axis(r: NDArray[np.float64]) -> tuple[float, NDArray[np.float64]]:
    """The angle (°) and unit axis of rotation *r*; a zero axis for no rotation."""
    angle = float(np.degrees(np.arccos(np.clip((np.trace(r) - 1.0) / 2.0, -1.0, 1.0))))
    v = np.array([r[2, 1] - r[1, 2], r[0, 2] - r[2, 0], r[1, 0] - r[0, 1]])
    n = float(np.linalg.norm(v))
    return angle, (v / n if n > 1e-12 else np.zeros(3))


def _solve(fit: str, q: NDArray[np.float64], h: NDArray[np.float64], w: NDArray[np.float64],
           ub0: NDArray[np.float64], group: Ops,
           basis: NDArray[np.float64]) -> NDArray[np.float64]:
    """The UB of the kind *fit* allows closest to Q ≈ UB·h, from *ub0*;
    *basis* is the commutant for ``"symmetric"``, else the invariant metrics."""
    if fit == "orientation":
        return _kabsch(q, h @ ub0.T, w) @ ub0
    if fit == "symmetric":  # Q = UB0·D·h, linear in D's coordinates
        sw = np.repeat(np.sqrt(w), 3)
        design = np.stack([(h @ (ub0 @ e).T).ravel() for e in basis], axis=1)
        coef, *_ = np.linalg.lstsq(design * sw[:, None], q.ravel() * sw, rcond=None)
        return np.asarray(ub0 @ np.tensordot(coef, basis, axes=1), dtype=np.float64)
    from scipy.optimize import least_squares
    from scipy.spatial.transform import Rotation

    u0 = _orientation(ub0)
    p0 = basis.reshape(len(basis), 9) @ _average(ub0.T @ ub0, group).ravel()
    rotate = fit == "both"
    sw = np.sqrt(w)[:, None]

    def model(x: NDArray[np.float64]) -> NDArray[np.float64]:
        omega, p = (x[:3], x[3:]) if rotate else (np.zeros(3), x)
        b = np.linalg.cholesky(np.tensordot(p, basis, axes=1)).T
        return np.asarray(Rotation.from_rotvec(omega).as_matrix() @ u0 @ b,
                          dtype=np.float64)

    def residuals(x: NDArray[np.float64]) -> NDArray[np.float64]:
        try:
            m = model(x)
        except np.linalg.LinAlgError:  # not a metric: no cell
            return np.full(q.size, 1e3)
        return np.asarray((sw * (h @ m.T - q)).ravel(), dtype=np.float64)

    x0 = np.concatenate([np.zeros(3), p0]) if rotate else p0
    out = least_squares(residuals, x0, x_scale="jac", xtol=1e-12, ftol=1e-12, gtol=1e-12)
    return model(out.x)
