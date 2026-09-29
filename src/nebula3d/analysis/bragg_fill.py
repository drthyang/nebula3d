# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Backfill Bragg-punched holes — step 5 of the further analysis pipeline.

A punched hole must be filled with the diffuse intensity *surrounding* it (the
3D-ΔPDF "punch-and-fill" convention: NXRefine's Laplace/Matérn fill, Mantid
``DeltaPDF3D``'s convolution fill, KAREN), not with a global background level.
Every punch sits on a reciprocal-lattice node, so a fill rule that is biased at
the nodes repeats that bias on the lattice, and its Fourier transform lands as
spurious ΔPDF features at the lattice vectors — exactly where the real
correlations are.  The |Q|-shell median (``method="q_shell"``) is biased this
way: pair correlations at lattice-vector separations peak or dip *at* the nodes,
and a whole-shell median averages that away.

``method="local"`` (default) fills each hole with the median of its own local
shell; ``method="laplace"`` solves the discrete Laplace equation in each hole so
the fill continues the surrounding diffuse smoothly, with no step at the edge.
Generic TV inpainting remains available as an option, but it can introduce
slice-scale staircase / smoothing artefacts in structured diffuse scattering.
"""

from __future__ import annotations

import dataclasses
import warnings
from collections.abc import Callable, Sequence
from typing import Literal, cast

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage, sparse

from nebula3d.core import HKLVolume, q_magnitude_from_axes
from nebula3d.inpainting.pipeline import Method, fill

BraggFillMethod = Method | Literal["local", "q_shell", "laplace"]

#: Most unknowns one ``method="laplace"`` solve holds.  Caps the solver's
#: working set (~200 B per unknown, so ≲0.4 GB) however many voxels are masked,
#: which keeps the browser build inside its 4 GB WASM heap.  It is also the
#: largest single region the Laplace fill solves: a real Bragg punch plus its
#: gap band is ~10²–10⁵ voxels, so a connected region past this is an
#: unmeasured coverage gap, which gets the ``local`` shell-median fill instead.
LAPLACE_MAX_UNKNOWNS = 2_000_000


def backfill_bragg(
    vol: HKLVolume,
    method: BraggFillMethod = "local",
    laue_class: str = "m3m",
    symmetry_ops: Sequence[NDArray] | None = None,
    tv_lam: float = 0.2,
    tv_iter: int = 300,
    local_radius: int = 2,
    local_min_count: int = 8,
    q_shell_step: float = 0.05,
    q_shell_min_count: int = 20,
    laplace_gap: int = 1,
    direct_beam_fill: bool = True,
    direct_beam_q_gap: float = 0.05,
    direct_beam_q_width: float = 0.15,
    laplace_max_unknowns: int = LAPLACE_MAX_UNKNOWNS,
    report: Callable[[str], None] | None = None,
) -> HKLVolume:
    """Fill Bragg-punched voxels in *vol*.

    ``method="local"`` (default) fills each connected punched region with the
    median of nearby valid voxels in a dilated shell around that region — the
    diffuse level right next to that Bragg peak.  It is robust to Bragg tails
    that leak past the punch edge, but the fill is flat, so it leaves a small
    step at the hole edge.

    ``method="laplace"`` fills the holes with the harmonic interpolant of the
    surrounding valid data (discrete Laplace equation, 6-neighbour stencil —
    the Laplace fill of NXRefine's punch-and-fill).  The fill follows the local
    diffuse gradient smoothly into the hole.  Because it honours its boundary
    exactly, Bragg tails just outside the punch would pull it up, so the
    boundary values are taken ``laplace_gap`` voxels *outside* the punch: that
    band is solved together with the hole and then discarded, i.e. its measured
    values are kept and only punched voxels change.  The holes are solved in
    batches of at most ``laplace_max_unknowns`` unknowns, so memory stays
    bounded; a single masked region larger than that (an unmeasured coverage
    gap, not a Bragg punch) gets the ``local`` fill instead.

    ``method="q_shell"`` fills ordinary Bragg components from the robust radial
    background level at the same ``|Q|`` as each punched voxel.  Kept for
    comparison only: a whole-shell median ignores the diffuse structure at the
    lattice nodes, and that node-periodic bias Fourier-transforms into spurious
    ΔPDF features at the lattice vectors (see the module docstring).
    Components whose ``|Q|`` bins are too sparsely sampled fall back to the
    local-shell median.

    TV/symmetry methods are retained for explicit comparisons.

    The **direct beam** (the punched hole at the origin) is filled differently
    from ordinary Bragg holes: a generic dilated shell around that large,
    elongated hole straddles the over-subtracted halo that hugs the beam, so the
    fill is biased.  Instead the whole beam region is filled with the diffuse
    background measured in a thin ``|Q|`` shell *just outside* it
    (``|Q| > beam edge``), which is the physically meaningful low-|Q| diffuse
    level.  Controlled by ``direct_beam_fill`` / ``direct_beam_q_gap`` /
    ``direct_beam_q_width``; it falls back to the generic local fill when no
    clean outside shell is available (e.g. tiny synthetic volumes).

    Parameters
    ----------
    vol:
        Volume after Bragg punching (``vol.mask`` marks valid voxels).
    method:
        Inpainting strategy. Default ``"local"``.
    laue_class:
        Crystal Laue class for symmetry filling.
    tv_lam:
        TV regularisation weight (higher than for Al backfill).
    tv_iter:
        Maximum TV iterations.
    local_radius:
        Number of binary-dilation iterations used to form the local shell around
        each punched component.
    local_min_count:
        Minimum valid shell voxels required before using the local shell median.
        Components with fewer fall back to the global valid-data median.
    q_shell_step:
        Radial ``|Q|`` bin width (Å⁻¹) for ``method="q_shell"``.
    q_shell_min_count:
        Minimum valid samples in a radial bin before it can be used for
        ``method="q_shell"``.
    laplace_gap:
        For ``method="laplace"``: how many voxels outside the punch the
        Dirichlet boundary sits (default 1).  0 uses the voxels adjacent to the
        hole — best when the punch fully clears the Bragg tails.
    direct_beam_fill:
        If True (default), fill the origin hole from the ``|Q|``-just-outside
        diffuse background instead of the generic dilated shell.
    direct_beam_q_gap:
        Å⁻¹ offset from the beam's outer ``|Q|`` edge to the start of the
        sampling shell — pushes the sample past the beam halo / over-subtraction
        trough that hugs the direct beam.
    direct_beam_q_width:
        Å⁻¹ thickness of the ``|Q|`` shell sampled for the direct-beam fill.
    laplace_max_unknowns:
        For ``method="laplace"``: most unknowns per CG solve, and the largest
        connected region Laplace-filled (see :data:`LAPLACE_MAX_UNKNOWNS`).
    report:
        Receives notes about the fill (oversized regions, CG not converging);
        they are raised as ``RuntimeWarning`` when it is None.

    Returns
    -------
    HKLVolume with Bragg holes filled.
    """
    if method == "laplace":
        return _laplace_fill(
            vol, gap=laplace_gap, direct_beam_fill=direct_beam_fill,
            db_q_gap=direct_beam_q_gap, db_q_width=direct_beam_q_width,
            db_min_count=local_min_count, local_radius=local_radius,
            max_unknowns=laplace_max_unknowns, report=report,
        )
    if method in {"local", "q_shell"}:
        return _local_background_fill(
            vol, radius=local_radius, min_count=local_min_count,
            q_shell_fill=(method == "q_shell"), q_shell_step=q_shell_step,
            q_shell_min_count=q_shell_min_count,
            direct_beam_fill=direct_beam_fill,
            db_q_gap=direct_beam_q_gap, db_q_width=direct_beam_q_width,
        )
    return fill(
        vol,
        method=cast(Method, method),
        laue_class=laue_class,
        symmetry_ops=list(symmetry_ops) if symmetry_ops else None,
        tv_lam=tv_lam,
        tv_iter=tv_iter,
    )


def _local_background_fill(
    vol: HKLVolume,
    radius: int = 2,
    min_count: int = 8,
    q_shell_fill: bool = False,
    q_shell_step: float = 0.05,
    q_shell_min_count: int = 20,
    direct_beam_fill: bool = True,
    db_q_gap: float = 0.05,
    db_q_width: float = 0.15,
) -> HKLVolume:
    """Fill each punched connected component from its local valid shell."""
    holes = (~vol.mask) & np.isfinite(vol.data)
    if not holes.any():
        return dataclasses.replace(vol, mask=np.ones(vol.shape, dtype=bool))

    valid = vol.mask & np.isfinite(vol.data)
    # Fill-value statistics in float64 regardless of storage precision
    # (astype is a no-op on float64 input).
    global_vals = vol.data[valid].astype(np.float64, copy=False)
    n_valid = global_vals.size
    global_fill = float(np.median(global_vals)) if n_valid else 0.0
    del global_vals  # compressed copy of most of the volume
    global_sigma = (float(np.median(vol.sigma[valid].astype(np.float64,
                                                            copy=False)))
                    if n_valid else 1.0)
    q_lookup = (
        _radial_background_lookup(vol, valid, q_step=q_shell_step,
                                  min_count=q_shell_min_count)
        if q_shell_fill else None
    )
    # Copy for the fill AFTER building the |Q| lookup: the lookup transiently
    # needs several volume-sized arrays, and allocating the output copies
    # first would stack the two peaks.
    data = vol.data.copy()
    sigma = vol.sigma.copy()

    # Direct beam first: fill the origin hole (and its interior) from the diffuse
    # background just outside it in |Q|, then exclude it from the generic loop.
    resolved: NDArray[np.bool_] = np.zeros(vol.shape, dtype=bool)
    if direct_beam_fill:
        resolved = _fill_direct_beam(
            vol, data, sigma, holes, valid, global_sigma,
            q_gap=db_q_gap, q_width=db_q_width, min_count=min_count,
        )

    _shell_fill_components(
        data, sigma, holes & ~resolved, valid, radius=radius,
        min_count=min_count, global_fill=global_fill,
        global_sigma=global_sigma, q_lookup=q_lookup,
    )
    return dataclasses.replace(vol, data=data, sigma=sigma,
                               mask=np.ones(vol.shape, dtype=bool))


def _shell_fill_components(
    data: NDArray,
    sigma: NDArray,
    targets: NDArray[np.bool_],
    valid: NDArray[np.bool_],
    *,
    radius: int,
    min_count: int,
    global_fill: float,
    global_sigma: float,
    q_lookup: _QShellLookup | None = None,
) -> None:
    """Fill each connected component of *targets* in place, from its valid shell.

    The ``local`` fill (and ``q_shell``'s per-component fallback): the median
    of the valid voxels in a ``radius``-voxel dilated shell around the
    component, or the global median when that shell is too sparse.
    """
    labels, _ = ndimage.label(targets, structure=np.ones((3, 3, 3), dtype=bool))
    objects = ndimage.find_objects(labels)
    structure = np.ones((3, 3, 3), dtype=bool)
    pad = max(int(radius) + 1, 1)

    for lbl, obj in enumerate(objects, start=1):
        if obj is None:
            continue
        slices = []
        for s, n in zip(obj, data.shape):
            slices.append(slice(max(0, s.start - pad), min(n, s.stop + pad)))
        region = cast(tuple[slice, slice, slice], tuple(slices))
        comp = labels[region] == lbl
        data_region = data[region]
        sigma_region = sigma[region]
        filled_by_q = False
        if q_lookup is not None:
            q_fill, q_sig = _q_shell_component_values(q_lookup, region, comp)
            if q_fill is not None and q_sig is not None:
                data_region[comp] = q_fill
                sigma_region[comp] = np.maximum(q_sig, global_sigma)
                filled_by_q = True
        if not filled_by_q:
            shell = ndimage.binary_dilation(
                comp, structure=structure, iterations=max(int(radius), 1)
            ) & ~comp
            shell_valid = shell & valid[region]
            if int(shell_valid.sum()) >= min_count:
                vals = data[region][shell_valid].astype(np.float64, copy=False)
                fill_val = float(np.median(vals))
                fill_sig = float(np.std(vals)) if vals.size > 1 else global_sigma
            else:
                fill_val = global_fill
                fill_sig = global_sigma

            data_region[comp] = fill_val
            sigma_region[comp] = max(fill_sig, global_sigma)
        data[region] = data_region
        sigma[region] = sigma_region


def _laplace_fill(
    vol: HKLVolume,
    gap: int = 1,
    direct_beam_fill: bool = True,
    db_q_gap: float = 0.05,
    db_q_width: float = 0.15,
    db_min_count: int = 8,
    local_radius: int = 2,
    max_unknowns: int = LAPLACE_MAX_UNKNOWNS,
    report: Callable[[str], None] | None = None,
) -> HKLVolume:
    """Fill every punched hole with the harmonic interpolant of its surroundings.

    Each unknown voxel satisfies ``deg·u_i − Σ u_j = Σ y_k`` over its
    in-volume 6-neighbours, where ``u_j`` are other unknowns and ``y_k`` known
    valid voxels (Dirichlet).  Neighbours that are neither (unmeasured voxels)
    are dropped from the stencil (Neumann).  Separate holes are independent
    blocks of this block-diagonal SPD system: whole blocks are packed into
    batches of at most ``max_unknowns`` unknowns, and each batch is solved by
    Jacobi-preconditioned CG.  The solver's memory is therefore bounded by the
    batch, not by how many voxels were punched.

    A single block larger than ``max_unknowns`` is not a Bragg punch but an
    unmeasured region (the loader zeroes and masks those, so they arrive here
    as holes); its holes get the ``local`` shell-median fill instead.
    """
    holes = (~vol.mask) & np.isfinite(vol.data)
    if not holes.any():
        return dataclasses.replace(vol, mask=np.ones(vol.shape, dtype=bool))

    valid = vol.mask & np.isfinite(vol.data)
    global_vals = vol.data[valid].astype(np.float64, copy=False)
    global_fill = float(np.median(global_vals)) if global_vals.size else 0.0
    global_sigma = (float(np.median(vol.sigma[valid].astype(np.float64,
                                                            copy=False)))
                    if global_vals.size else 1.0)
    del global_vals
    data = vol.data.copy()
    sigma = vol.sigma.copy()

    resolved: NDArray[np.bool_] = np.zeros(vol.shape, dtype=bool)
    if direct_beam_fill:
        resolved = _fill_direct_beam(
            vol, data, sigma, holes, valid, global_sigma,
            q_gap=db_q_gap, q_width=db_q_width, min_count=db_min_count,
        )
    remaining = holes & ~resolved
    out_mask = np.ones(vol.shape, dtype=bool)
    if not remaining.any():
        return dataclasses.replace(vol, data=data, sigma=sigma, mask=out_mask)

    # Unknowns = the holes plus a ``gap``-voxel band of valid data around them;
    # the band is solved (so the boundary sits past any Bragg tail) and then
    # discarded — only punched voxels are written.
    cross = ndimage.generate_binary_structure(3, 1)
    unknown = remaining.copy()
    if gap > 0:
        unknown |= (ndimage.binary_dilation(remaining, structure=cross,
                                            iterations=int(gap))
                    & valid & ~resolved)
    known = (valid & ~unknown).reshape(-1)
    # The stencil's connected blocks are the 6-connected components of the
    # unknowns; labels come out in raster order of each block's first voxel.
    labels, n_comp = ndimage.label(unknown, structure=cross)
    del unknown
    idx = np.flatnonzero(labels)  # sorted → searchsorted neighbour lookup
    comp = labels.reshape(-1)[idx] - 1
    del labels
    sizes = np.bincount(comp, minlength=n_comp)

    oversized = sizes > max_unknowns
    if oversized.any():
        drop = oversized[comp]
        big = np.zeros(data.size, dtype=bool)
        big[idx[drop]] = True
        big = big.reshape(vol.shape) & remaining
        _shell_fill_components(
            data, sigma, big, valid, radius=local_radius,
            min_count=db_min_count, global_fill=global_fill,
            global_sigma=global_sigma,
        )
        _note(report, (
            f"laplace backfill: {int(oversized.sum())} masked region(s) larger "
            f"than {max_unknowns:,} voxels ({int(big.sum()):,} voxels in all — "
            f"unmeasured coverage, not Bragg punches) filled with their local "
            f"shell median instead"))
        del big
        idx, comp = idx[~drop], comp[~drop]
        sizes[oversized] = 0

    flat = data.reshape(-1)
    sigma_flat = sigma.reshape(-1)
    todo = remaining.reshape(-1)
    cum = np.cumsum(sizes)
    all_converged = True
    lo = 0
    while lo < n_comp:  # greedy packing of whole blocks, in label order
        base = int(cum[lo - 1]) if lo else 0
        hi = max(int(np.searchsorted(cum, base + max_unknowns, side="right")),
                 lo + 1)
        sel = (comp >= lo) & (comp < hi)
        lo = hi
        if not sel.any():  # only oversized blocks in this range
            continue
        b_idx = idx[sel]
        u, u_sig, converged = _laplace_solve_batch(
            b_idx, comp[sel], flat, known, vol.shape, global_fill)
        all_converged &= converged
        write = todo[b_idx]
        flat[b_idx[write]] = u[write]
        sigma_flat[b_idx[write]] = np.maximum(u_sig[write], global_sigma)
    if not all_converged:
        _note(report, "laplace backfill: CG did not reach tolerance")
    return dataclasses.replace(vol, data=data, sigma=sigma, mask=out_mask)


def _laplace_solve_batch(
    idx: NDArray[np.intp],
    comp: NDArray[np.integer],
    flat: NDArray,
    known: NDArray[np.bool_],
    shape: tuple[int, ...],
    global_fill: float,
) -> tuple[NDArray[np.float64], NDArray[np.float64], bool]:
    """Solve the Laplace blocks of one batch; return ``(u, sigma, converged)``.

    *idx* are the batch's unknowns as sorted flat indices and *comp* their
    block ids — whole blocks only, so every unknown neighbour is in the batch.
    """
    m = idx.size
    itype = np.int32 if 7 * m < np.iinfo(np.int32).max else np.int64
    strides = (shape[1] * shape[2], shape[2], 1)
    deg = np.zeros(m)
    rhs = np.zeros(m)
    rhs_sq = np.zeros(m)
    n_links = np.zeros(m)
    # nbr[axis, side]: batch position of the unknown neighbour, -1 if none.
    nbr = np.full((3, 2, m), -1, dtype=itype)
    for axis in range(3):
        coord = (idx // strides[axis]) % shape[axis]
        for side, step in enumerate((-1, 1)):
            inside = coord > 0 if step < 0 else coord < shape[axis] - 1
            src = np.flatnonzero(inside)
            nb = idx[src] + step * strides[axis]
            pos = np.minimum(np.searchsorted(idx, nb), m - 1)
            is_u = idx[pos] == nb
            is_k = ~is_u & known[nb]
            y = flat[nb[is_k]].astype(np.float64, copy=False)
            # each src appears once per direction, so fancy += is exact
            deg[src[is_u | is_k]] += 1.0
            ks = src[is_k]
            rhs[ks] += y
            rhs_sq[ks] += y * y
            n_links[ks] += 1.0
            nbr[axis, side, src[is_u]] = pos[is_u]
        del coord

    # Per connected hole: the Dirichlet data's mean seeds CG, its spread sets
    # sigma.  A hole with no measured neighbour at all ("orphan", e.g. walled
    # in by unmeasured voxels) has a singular block — give it the global median.
    lc = comp - comp.min()  # a batch holds a contiguous range of block ids
    k = int(lc.max()) + 1
    c_links = np.bincount(lc, weights=n_links, minlength=k)
    c_n = np.maximum(c_links, 1.0)
    c_mean = np.bincount(lc, weights=rhs, minlength=k) / c_n
    c_var = np.bincount(lc, weights=rhs_sq, minlength=k) / c_n - c_mean ** 2
    c_sig = np.sqrt(np.maximum(c_var, 0.0))
    del rhs_sq, n_links
    solvable = c_links[lc] > 0

    # Laplacian as CSR, built in place (no COO / adjacency intermediates).
    # Entries go in ascending column order — neighbours at −stride₀, −stride₁,
    # −1, the diagonal, then +1, +stride₁, +stride₀ — the canonical layout.
    has = nbr >= 0
    indptr: NDArray[np.signedinteger] = np.zeros(m + 1, dtype=itype)
    np.cumsum(has.sum(axis=(0, 1), dtype=itype) + 1, out=indptr[1:])
    indices = np.empty(int(indptr[-1]), dtype=itype)
    vals = np.empty(indices.size)
    head = indptr[:-1].copy()  # next free slot of each row
    for slot in ((0, 0), (1, 0), (2, 0), None, (2, 1), (1, 1), (0, 1)):
        if slot is None:
            indices[head] = np.arange(m, dtype=itype)
            vals[head] = deg
            head += 1
            continue
        rows = np.flatnonzero(has[slot])
        at = head[rows]
        indices[at] = nbr[slot][rows]
        vals[at] = -1.0
        head[rows] += 1
    del has, nbr, head
    lap = sparse.csr_matrix((vals, indices, indptr), shape=(m, m))

    u = np.full(m, global_fill)
    converged = True
    if not solvable.all():  # rare — skip the sub-matrix copies otherwise
        lap = lap[solvable][:, solvable]
    if solvable.any():
        u[solvable], converged = _pcg(lap, rhs[solvable], c_mean[lc[solvable]],
                                      1.0 / deg[solvable])
    return u, c_sig[lc], converged


def _note(report: Callable[[str], None] | None, message: str) -> None:
    """Send a backfill note to *report* (the pipeline log), else warn."""
    if report is not None:
        report(message)
    else:
        warnings.warn(message, RuntimeWarning, stacklevel=3)


def _pcg(
    a: sparse.csr_matrix,
    b: NDArray[np.float64],
    x0: NDArray[np.float64],
    dinv: NDArray[np.float64],
    rtol: float = 1e-10,
    maxiter: int = 10_000,
) -> tuple[NDArray[np.float64], bool]:
    """Jacobi-preconditioned conjugate gradient for the SPD Laplace system.

    Hand-rolled rather than ``scipy.sparse.linalg.cg`` because that function's
    tolerance keyword changed (``tol`` → ``rtol``) inside our scipy>=1.10 range.
    """
    x = x0.copy()
    r = b - a @ x
    z = dinv * r
    p = z.copy()
    rz = float(r @ z)
    tol = rtol * (float(np.linalg.norm(b)) or 1.0)
    for _ in range(maxiter):
        if float(np.linalg.norm(r)) <= tol:
            return x, True
        ap = a @ p
        alpha = rz / float(p @ ap)
        x += alpha * p
        r -= alpha * ap
        z = dinv * r
        rz_new = float(r @ z)
        p = z + (rz_new / rz) * p
        rz = rz_new
    return x, float(np.linalg.norm(r)) <= tol


@dataclasses.dataclass(frozen=True)
class _QShellLookup:
    """Precomputed robust radial background used by ``method="q_shell"``.

    Holds only the (int32) shell index per voxel plus the tiny per-shell
    tables — not the full-volume float64 |Q| array, which is transient in
    :func:`_radial_background_lookup`.
    """

    bin_idx: NDArray[np.int32]
    levels: NDArray[np.float64]
    sigmas: NDArray[np.float64]
    counts: NDArray[np.int_]


def _radial_background_lookup(
    vol: HKLVolume,
    valid: NDArray[np.bool_],
    q_step: float,
    min_count: int,
) -> _QShellLookup:
    """Build per-|Q| robust background levels from currently valid voxels."""
    q = vol.q_magnitude()
    if not valid.any():
        zeros = np.zeros(1, dtype=float)
        return _QShellLookup(
            bin_idx=np.zeros(vol.shape, dtype=np.int32),
            levels=zeros,
            sigmas=zeros,
            counts=np.zeros(1, dtype=int),
        )
    qs = max(float(q_step), 1e-12)
    qv = q[valid]
    edges = np.arange(float(qv.min()), float(qv.max()) + qs, qs)
    nb = max(len(edges) - 1, 1)
    # int32 indices: the shell count is tiny, and the full-volume index array
    # is half the size of numpy's default int64.
    bin_idx = np.clip(np.digitize(q, edges) - 1, 0, nb - 1).astype(
        np.int32, copy=False)
    del q  # full-volume float64 no longer needed

    # Sorted-segment scan with prompt frees: the flattened arrays cover most of
    # the volume each, so dropping each one as soon as it is consumed keeps the
    # peak at ~2 simultaneous copies instead of 5.
    flat_b = bin_idx[valid]
    order = np.argsort(flat_b, kind="stable")
    sb = flat_b[order]
    del flat_b
    si = vol.data[valid][order]
    del order
    bounds = np.searchsorted(sb, np.arange(nb + 1))
    del sb
    levels = np.full(nb, np.nan)
    sigmas = np.full(nb, np.nan)
    counts = np.zeros(nb, dtype=int)
    for b in range(nb):
        # Shell statistics in float64 regardless of storage precision
        # (astype is a no-op on float64 input).
        seg = si[bounds[b]:bounds[b + 1]].astype(np.float64, copy=False)
        counts[b] = int(seg.size)
        if seg.size < min_count:
            continue
        levels[b] = float(np.median(seg))
        sigmas[b] = float(np.std(seg)) if seg.size > 1 else 0.0
    return _QShellLookup(bin_idx=bin_idx, levels=levels, sigmas=sigmas, counts=counts)


def _q_shell_component_values(
    lookup: _QShellLookup,
    region: tuple[slice, slice, slice],
    comp: NDArray[np.bool_],
) -> tuple[NDArray[np.float64] | None, NDArray[np.float64] | None]:
    """Return per-voxel radial background values for a punched component."""
    bins = lookup.bin_idx[region][comp]
    if bins.size == 0:
        return None, None
    vals = lookup.levels[bins]
    sig = lookup.sigmas[bins]
    if np.isfinite(vals).sum() < bins.size:
        return None, None
    sig = np.where(np.isfinite(sig), sig, 0.0)
    return vals.astype(float, copy=False), sig.astype(float, copy=False)


def _fill_direct_beam(
    vol: HKLVolume,
    data: NDArray,
    sigma: NDArray,
    holes: NDArray[np.bool_],
    valid: NDArray[np.bool_],
    global_sigma: float,
    q_gap: float,
    q_width: float,
    min_count: int,
) -> NDArray[np.bool_]:
    """Fill the origin (direct-beam) region from the |Q|-just-outside background.

    The beam region is the origin-connected blob of *punched holes* **and**
    *originally-unmeasured* voxels (the direct beam casts a detector shadow at
    |Q|≈0 that reads as unmeasured, not as a punched hole).  Both are filled so
    the centre is not left as a pit.  The blob is capped at the first ``|Q|`` gap
    in its voxels, so a punch that bridges toward a low-|Q| Bragg node (e.g.
    ``(0,0,2)``) does not drag that node into the beam region.  The fill value is
    the median diffuse level in a thin shell just outside that ``|Q|`` edge.

    Returns a boolean mask of the voxels resolved here (empty if no direct-beam
    region is found or no clean outside shell is available — the caller's generic
    per-component fill then handles those holes instead).
    """
    resolved = np.zeros(vol.shape, dtype=bool)
    nh, nk, nl = vol.shape

    ih = int(np.argmin(np.abs(vol.h_axis)))
    ik = int(np.argmin(np.abs(vol.k_axis)))
    il = int(np.argmin(np.abs(vol.l_axis)))

    # The direct beam is punched holes ∪ the unmeasured detector shadow at |Q|≈0.
    beam_like = holes | ~vol.mask
    structure = np.ones((3, 3, 3), dtype=bool)
    labels, _ = ndimage.label(beam_like, structure=structure)
    lbl = int(labels[ih, ik, il])
    if lbl == 0:
        box = (slice(max(0, ih - 2), min(nh, ih + 3)),
               slice(max(0, ik - 2), min(nk, ik + 3)),
               slice(max(0, il - 2), min(nl, il + 3)))
        nz = labels[box][labels[box] > 0]
        if nz.size == 0:
            return resolved  # no direct-beam region → generic fill handles all
        lbl = int(np.bincount(nz).argmax())

    obj = ndimage.find_objects(labels, max_label=lbl)[lbl - 1]
    if obj is None:
        return resolved
    pad = 6  # room for the outside |Q| shell beyond the beam edge
    region = cast(
        tuple[slice, slice, slice],
        tuple(slice(max(0, s.start - pad), min(n, s.stop + pad)) for s, n in zip(obj, vol.shape)),
    )

    comp_box = labels[region] == lbl
    q_box = _q_in_region(vol, region)

    # Outer |Q| edge of the beam = the first gap in the component's sorted |Q|.
    # Everything past that gap (a bridged Bragg node) is excluded from the beam.
    # The gap threshold adapts to the local |Q| sampling so it is not fooled by
    # the coarse spacing of a sparsely-sampled grid.
    qc = np.sort(q_box[comp_box])
    q_beam = float(qc[-1])
    if qc.size > 1:
        dqs = np.diff(qc)
        pos = dqs[dqs > 1e-9]
        step = float(np.median(pos)) if pos.size else 0.0
        brk = np.where(dqs > max(q_gap, 5.0 * step))[0]
        if brk.size:
            q_beam = float(qc[brk[0]])
    # Fill ONLY the actual beam footprint — the connected punched holes plus the
    # unmeasured central shadow they enclose — capped at the |Q| gap.
    # ``binary_fill_holes`` adds the enclosed interior (the central detector
    # shadow, which ``punch_only`` flips to a "valid" 0 so it is neither a hole nor
    # in the component); capping by ``q_beam`` drops a bridged Bragg node.
    # NB: do NOT fill the whole |Q| ball ``q_box <= q_beam`` — the lattice is very
    # anisotropic, so a ball isotropic in Å⁻¹ bleeds many rlu along the fine axis
    # and across H into the origin column of neighbouring planes (e.g. the H=0.333
    # diffuse).  The component is confined to small |H| (~0.15 rlu punch), so this
    # cannot reach other H planes.
    solid_box = ndimage.binary_fill_holes(comp_box) & (q_box <= q_beam)

    valid_box = valid[region]
    shell = valid_box & (q_box > q_beam + q_gap) & (q_box <= q_beam + q_gap + q_width)
    if int(shell.sum()) < min_count:
        return resolved  # no clean outside shell → fall back to generic fill

    vals = data[region][shell].astype(np.float64, copy=False)
    fill_val = float(np.median(vals))
    fill_sig = float(np.std(vals)) if vals.size > 1 else global_sigma

    data_region = data[region]
    sigma_region = sigma[region]
    data_region[solid_box] = fill_val
    sigma_region[solid_box] = max(fill_sig, global_sigma)
    data[region] = data_region
    sigma[region] = sigma_region

    resolved[region] = solid_box
    return resolved


def _q_in_region(vol: HKLVolume, region: tuple[slice, slice, slice]) -> NDArray:
    """|Q| (Å⁻¹) for a sub-box, built from the axes (cheap — no full-grid pass)."""
    return q_magnitude_from_axes(
        vol.h_axis[region[0]], vol.k_axis[region[1]], vol.l_axis[region[2]],
        vol.ub_matrix,
    )
