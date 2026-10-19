# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The ΔPDF's strongest features (docs/pilot-review.md, finding 1): pair
correlations put into I(Q) at known vectors and signs come out of the
transform at those vectors, with those signs, strongest first.

With a declared point group, the copies of one correlation are one entry: on
constructed ΔPDFs whose peaks sit on the orbits of a group, built by rotating
Cartesian vectors (not with the operations the module is given), each orbit
is one entry of its multiplicity, in a cubic and in a hexagonal cell."""

from __future__ import annotations

import itertools
from pathlib import Path

import h5py
import numpy as np
import pytest

from nebula3d.analysis.delta_pdf import compute_delta_pdf, real_space_radius
from nebula3d.analysis.dpdf_features import BY_SHAPE, strongest_features
from nebula3d.core import HKLVolume
from nebula3d.io import save_delta_pdf
from nebula3d.pipeline import pipeline_paths
from nebula3d.symmetry import parse_symmetry_ops
from nebula3d.utils import ub_from_lattice

A = 4.0
# (vector in lattice units, amplitude): a correlation at ±r adds 2·amp·cos(2π h·r) to I(Q).
PLANTED = [((1.5, 0.0, 0.0), 0.5), ((0.5, 1.0, 0.0), -0.3)]


def _transform(seed: int = 0, noise: float = 0.02):
    step = 0.1
    ax = (np.arange(81) - 40) * step  # ±4 r.l.u., Q = 0 on index 40
    h, k, l = np.meshgrid(ax, ax, ax, indexing="ij")
    data = 1.0 + noise * np.random.default_rng(seed).standard_normal(h.shape)
    for (u, v, w), amp in PLANTED:
        data = data + 2 * amp * np.cos(2 * np.pi * (h * u + k * v + l * w))
    vol = HKLVolume(data=data, sigma=np.zeros_like(data), mask=np.ones(data.shape, dtype=bool),
                    h_axis=ax, k_axis=ax, l_axis=ax,
                    ub_matrix=ub_from_lattice(A, A, A, 90.0, 90.0, 90.0))
    return compute_delta_pdf(vol, real_space_angstrom=True)


def test_planted_correlations_come_out_at_their_vectors_with_their_signs():
    d = _transform()
    f = strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, d.cell_angles, min_sigma=5)
    assert f.sigma > 0 and f.origin_radius == pytest.approx(0.05 * 20.0, rel=0.05)
    top = f.groups[:2]
    assert [g.sign for g in top] == [1, -1]  # the stronger first
    for g, ((u, v, w), _amp) in zip(top, PLANTED):
        assert g.n == 1  # one per ± pair
        x, y, z = g.vectors[0]
        # The listed copy is in the half with the first non-zero index offset positive.
        # Within a fifth of a voxel (0.125 r.l.u.).
        assert (x / A, y / A, z / A) == pytest.approx((u, v, w), abs=0.02)
        assert g.length == pytest.approx(A * np.sqrt(u * u + v * v + w * w), abs=0.05)
    # Its sizes compare as the amplitudes put in (the Gaussian window broadens both alike).
    assert top[0].size_sigma / top[1].size_sigma == pytest.approx(0.5 / 0.3, rel=0.1)
    assert top[0].size_sigma > 50 * 5  # far above the listing threshold


def test_the_origin_is_left_out_and_the_threshold_bounds_the_list():
    d = _transform()
    f = strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, min_sigma=5)
    assert all(g.length >= f.origin_radius for g in f.groups)
    high = strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, min_sigma=1e6)
    assert high.n_extrema == 0 and high.groups == ()
    assert len(strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, limit=1).groups) == 1
    with pytest.raises(ValueError):
        strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis, min_sigma=0)


def test_symmetric_copies_are_one_entry():
    """The same correlation along a, b and c (a cubic crystal's ⟨1 0 0⟩ orbit):
    one sign, length and size, listed as one entry of three vectors."""
    step = 0.1
    ax = (np.arange(81) - 40) * step
    h, k, l = np.meshgrid(ax, ax, ax, indexing="ij")
    data = 1.0 + 0.4 * (np.cos(2 * np.pi * h) + np.cos(2 * np.pi * k) + np.cos(2 * np.pi * l))
    vol = HKLVolume(data=data, sigma=np.zeros_like(data), mask=np.ones(data.shape, dtype=bool),
                    h_axis=ax, k_axis=ax, l_axis=ax,
                    ub_matrix=ub_from_lattice(A, A, A, 90.0, 90.0, 90.0))
    d = compute_delta_pdf(vol, real_space_angstrom=True)
    g = strongest_features(d.data, d.x_axis, d.y_axis, d.z_axis).groups[0]
    assert g.sign == 1 and g.n == 3 and g.length == pytest.approx(A, abs=0.05)
    units = sorted(tuple(round(abs(c) / A, 2) for c in v) for v in g.vectors)
    assert units == [(0.0, 0.0, 1.0), (0.0, 1.0, 0.0), (1.0, 0.0, 0.0)]


def test_a_large_volume_takes_sigma_from_a_subsample_and_unmeasured_voxels_count_as_zero():
    """Past SIGMA_VOXELS the σ comes from a regular subsample (a measured 405³
    ΔPDF must fit the browser's heap); a NaN voxel is no extremum."""
    n = 211  # 9.4 M voxels: every second voxel along each axis
    rng = np.random.default_rng(1)
    data = rng.standard_normal((n, n, n)).astype(np.float32)
    data[0, 0, :5] = np.nan
    ax = (np.arange(n) - n // 2) * 0.25
    f = strongest_features(data, ax, ax, ax, min_sigma=5.5)
    assert f.sigma == pytest.approx(1.0, rel=0.01)  # unit Gaussian noise
    assert all(g.size_sigma >= 5.5 for g in f.groups)
    assert all(np.isfinite(v).all() for g in f.groups for v in g.vectors)


# ------------------------------------------------- grouping by the declared symmetry

#: The operations as a file declares them, on (h, k, l). m-3m from its
#: generators: the 4-fold ∥ c, the 3-fold ∥ [111] and the mirror ⊥ c.
M3M = "-k,h,l; k,l,h; h,k,-l"
#: 6/mmm as tests/test_server.py declares it: the 6-fold, a mirror ∥ c, the mirror ⊥ c.
SIX_MMM = "h,k,l; h+k,-h,l; k,h,l; h,k,-l"
#: −3: the 3-fold ∥ c and the inversion.
BAR3 = "k,-h-k,l; -h,-k,-l"

STEP = 0.25  # Å per voxel along a, b and c


def _rot_z(degrees):
    t = np.radians(degrees)
    return np.array([[np.cos(t), -np.sin(t), 0.0], [np.sin(t), np.cos(t), 0.0], [0.0, 0.0, 1.0]])


#: Cartesian isometries (x along a, y in the a–b plane). The cube's 48: every
#: signed permutation of the axes.
CUBE = [np.diag(s)[list(p)] for p in itertools.permutations(range(3))
        for s in itertools.product((1.0, -1.0), repeat=3)]
#: 6/mmm about c: the six rotations, the mirror containing a, the mirror ⊥ c.
HEXAGON = [_rot_z(60 * n) @ np.diag(m) @ np.diag(z) for n in range(6)
           for m in ((1, 1, 1), (1, -1, 1)) for z in ((1, 1, 1), (1, 1, -1))]


def _basis(cell, angles):
    """The cell's edges a, b, c as the columns of a Cartesian matrix."""
    a, b, c = cell
    al, be, ga = np.radians(angles)
    cy = (np.cos(al) - np.cos(be) * np.cos(ga)) / np.sin(ga)
    cz = np.sqrt(1.0 - np.cos(be) ** 2 - cy ** 2)
    return np.array([[a, b * np.cos(ga), c * np.cos(be)],
                     [0.0, b * np.sin(ga), c * cy],
                     [0.0, 0.0, c * cz]])


def _orbit(u, cell, angles, isometries):
    """The images of the fractional vector *u* under Cartesian *isometries*,
    as fractions of a, b, c: one of each ± pair."""
    basis = _basis(cell, angles)
    out: list[np.ndarray] = []
    for m in isometries:
        v = np.linalg.solve(basis, m @ basis @ np.asarray(u, dtype=float))
        if not any(np.allclose(v, s * w, atol=1e-9) for w in out for s in (1, -1)):
            out.append(v)
    return out


def _peaks(peaks, cell=(A, A, A), angles=(90.0, 90.0, 90.0), *, n=81, width=0.3,
           noise=1.0, seed=0):
    """A constructed ΔPDF: a Gaussian of each peak's amplitude at each fractional
    vector u and at −u (a centrosymmetric ΔPDF), its width a true distance in
    the cell's metric, on n³ voxels of STEP Å along a, b, c with the origin on
    the centre one, over Gaussian noise of σ *noise*."""
    ax = (np.arange(n) - n // 2) * STEP
    data = noise * np.random.default_rng(seed).standard_normal((n, n, n))
    reach = int(np.ceil(4 * width / STEP))
    for u, amp in peaks:
        for s in (1.0, -1.0):
            centre = s * np.asarray(u, dtype=float) * np.asarray(cell, dtype=float)
            at = np.rint(centre / STEP).astype(int) + n // 2
            sl = tuple(slice(max(i - reach, 0), min(i + reach + 1, n)) for i in at)
            r = real_space_radius(ax[sl[0]][:, None, None] - centre[0],
                                  ax[sl[1]][None, :, None] - centre[1],
                                  ax[sl[2]][None, None, :] - centre[2], angles)
            data[sl] += amp * np.exp(-0.5 * (r / width) ** 2)
    return data, ax


def _features(data, ax, cell=(A, A, A), angles=(90.0, 90.0, 90.0), ops=None, **kw):
    """The features of a constructed ΔPDF; *ops* as a file declares them (text)
    or as matrices on (h, k, l)."""
    kw.setdefault("min_sigma", 8.0)
    kw.setdefault("limit", 30)
    return strongest_features(
        data, ax, ax, ax, angles, cell_lengths=cell,
        symmetry_ops=parse_symmetry_ops(ops) if isinstance(ops, str) else ops, **kw)


def _fractions(g, cell=(A, A, A)):
    return [np.asarray(v) / np.asarray(cell) for v in g.vectors]


def _same_vectors(found, expected, cell=(A, A, A), angles=(90.0, 90.0, 90.0), tol=0.2):
    """Whether *found* and *expected* are one set of fractional vectors, each up
    to its sign, within *tol* Å. The default, 0.8 voxel, takes the refinement's
    error on an oblique grid (up to 0.6 voxel); the copies here lie 1.4 Å apart
    or more."""
    basis = _basis(cell, angles)
    left = [np.asarray(v, dtype=float) for v in expected]
    for v in found:
        hit = next((i for i, w in enumerate(left) for s in (1, -1)
                    if np.linalg.norm(basis @ (np.asarray(v) - s * w)) <= tol), None)
        if hit is None:
            return False
        left.pop(hit)
    return not left


def test_each_orbit_of_a_declared_cubic_group_is_one_entry_of_its_multiplicity():
    """Peaks on three m-3m orbits, each copy 0.85 to 1.15 of its orbit's size
    (data not symmetrised): a general position (48 vectors, 24 per ± pair),
    ⟨1 1 0⟩ (6) and a negative ⟨½ ½ ½⟩ (4). With m-3m declared, each orbit is
    one entry, of its multiplicity; by sign, length and size they split."""
    rng = np.random.default_rng(3)
    orbits = [((0.25, 0.5, 0.75), 60.0), ((1.0, 1.0, 0.0), 40.0), ((0.5, 0.5, 0.5), -30.0)]
    copies = {u: _orbit(u, (A, A, A), (90.0, 90.0, 90.0), CUBE) for u, _ in orbits}
    assert [len(c) for c in copies.values()] == [24, 6, 4]  # one per ± pair
    data, ax = _peaks([(v, amp * rng.uniform(0.85, 1.15)) for u, amp in orbits
                       for v in copies[u]])

    f = _features(data, ax, ops=M3M)
    assert f.grouped_by == "declared symmetry (-k,h,l; k,l,h; h,k,-l: 48 operations, r ≡ −r)"
    assert [(g.sign, g.n, g.multiplicity) for g in f.groups] == [(1, 24, 24), (1, 6, 6), (-1, 4, 4)]
    for g, (u, amp) in zip(f.groups, orbits):
        assert _same_vectors(_fractions(g), copies[u])
        assert g.length == pytest.approx(A * np.linalg.norm(u), abs=0.05)
        # The strongest copy leads; the mean is over every copy.
        assert g.size_sigma == max(g.sizes_sigma) == g.sizes_sigma[0]
        assert min(g.sizes_sigma) < g.mean_size_sigma < g.size_sigma
        assert g.mean_size_sigma == pytest.approx(abs(amp), rel=0.08)
    # The limit counts entries, not copies: the strongest entry keeps all 24.
    (top,) = _features(data, ax, ops=M3M, limit=1).groups
    assert top.n == 24 and len(top.vectors) == 24
    assert len(_features(data, ax, ops=M3M, limit=1, max_vectors=4).groups[0].vectors) == 4

    # By sign, length and size (5 %) the unequal copies of each orbit split.
    plain = _features(data, ax)
    assert plain.grouped_by == BY_SHAPE
    assert len(plain.groups) > 3 and all(g.multiplicity is None for g in plain.groups)
    assert sum(g.n for g in plain.groups) == f.n_extrema == plain.n_extrema == 34


@pytest.mark.parametrize("declared,groups", [(SIX_MMM, [12, 3]), (BAR3, [3, 3, 3, 3, 3])])
def test_hexagonal_orbits_group_in_the_real_space_basis(declared, groups):
    """A hexagonal cell (γ = 120°): the operations act on (h, k, l), and on the
    ΔPDF's fractional coordinates as their transposes, which on this cell are
    not the same matrices; a three-fold mixes x and y. Peaks on the 6/mmm orbit
    of a general vector (24, 12 per ± pair) and on ⟨1 0 0⟩ (a, b, a + b). With
    6/mmm declared each orbit is one entry; with −3 the general orbit is four
    of its orbits, three vectors each, and ⟨1 0 0⟩ still one."""
    cell, angles = (A, A, 5.0), (90.0, 90.0, 120.0)
    general = _orbit((0.6, 0.2, 0.4), cell, angles, HEXAGON)
    axial = _orbit((1.0, 0.0, 0.0), cell, angles, HEXAGON)
    assert (len(general), len(axial)) == (12, 3)
    assert _same_vectors(axial, [(1, 0, 0), (0, 1, 0), (1, 1, 0)], cell, angles)
    data, ax = _peaks([(v, 50.0) for v in general] + [(v, 30.0) for v in axial], cell, angles)

    f = _features(data, ax, cell, angles, ops=declared)
    assert f.grouped_by.startswith("declared symmetry (")
    assert sorted((g.n for g in f.groups), reverse=True) == groups
    assert all(g.n == g.multiplicity and g.sign == 1 for g in f.groups)
    found = [v for g in f.groups for v in _fractions(g, cell)]
    assert _same_vectors(found, general + axial, cell, angles)
    weak = f.groups[-1]  # ⟨1 0 0⟩, the weaker orbit, is one entry under either group
    assert _same_vectors(_fractions(weak, cell), axial, cell, angles)
    assert weak.length == pytest.approx(A, abs=0.05)
    # The same matrices acting on u untransposed are no symmetry of this cell:
    # (u, v, w) → (u + v, −u, w) takes a to a − b, √3 times longer.
    wrong = [m.T for m in parse_symmetry_ops(declared)]
    assert "is not applied" in _features(data, ax, cell, angles, ops=wrong).grouped_by


def test_a_near_miss_stays_apart_and_an_offset_within_a_voxel_joins():
    """⟨1 1 0⟩ with one copy 0.4 voxel off its place (it joins) and one two
    voxels off (no image: an entry of its own), both moved across the vector,
    along its zero component. By sign, length and size all six are one entry:
    the near miss's length is within half a voxel, its size within 5 %."""
    copies = _orbit((1.0, 1.0, 0.0), (A, A, A), (90.0, 90.0, 90.0), CUBE)
    moved = [np.asarray(v, dtype=float) for v in copies]
    for i, voxels in ((1, 0.4), (2, 2.0)):
        moved[i][int(np.argmin(np.abs(moved[i])))] += voxels * STEP / A
    peaks = [(v, 39.0 if i == 2 else 40.0) for i, v in enumerate(moved)]
    data, ax = _peaks(peaks, noise=0.05, width=0.5)

    f = _features(data, ax, ops=M3M, min_sigma=50.0)
    # The near miss's own orbit: (1, ⅛, 1) has 24 images, 12 per ± pair.
    assert [(g.n, g.multiplicity) for g in f.groups] == [(5, 6), (1, 12)]
    assert _same_vectors(_fractions(f.groups[1]), [moved[2]], tol=0.1)
    assert _same_vectors(_fractions(f.groups[0]), [moved[i] for i in (0, 1, 3, 4, 5)], tol=0.1)
    plain = _features(data, ax, min_sigma=50.0)
    assert [g.n for g in plain.groups] == [6]


def test_positive_and_negative_extrema_never_merge():
    """+⟨1 0 0⟩ along a and b, −⟨1 0 0⟩ along c: images of one another under
    m-3m, and two entries, one per sign."""
    data, ax = _peaks([((1, 0, 0), 50.0), ((0, 1, 0), 50.0), ((0, 0, 1), -40.0)])
    f = _features(data, ax, ops=M3M)
    assert [(g.sign, g.n, g.multiplicity) for g in f.groups] == [(1, 2, 3), (-1, 1, 3)]
    assert _same_vectors(_fractions(f.groups[1]), [(0, 0, 1)])


def test_without_a_declared_symmetry_the_grouping_is_by_sign_length_and_size():
    """Today's grouping, pinned, against the declared one. On the grid, with
    sizes 2 % apart: ⟨3/2 0 0⟩ and ⟨1 1 ½⟩, different correlations of one
    length (1.5 a), are one entry of 15 by sign, length and size and two under
    m-3m; one ⟨1 0 0⟩ copy 10 % smaller is an entry of its own by size (5 %),
    one with the other two under m-3m."""
    peaks = ([(v, 30.0) for v in _orbit((1.5, 0, 0), (A, A, A), (90.0,) * 3, CUBE)]
             + [(v, 29.4) for v in _orbit((1, 1, 0.5), (A, A, A), (90.0,) * 3, CUBE)]
             + [((1, 0, 0), 60.0), ((0, 1, 0), 60.0), ((0, 0, 1), 54.0)])
    data, ax = _peaks(peaks, noise=0.01)

    plain = _features(data, ax, min_sigma=50.0)
    assert plain.grouped_by == BY_SHAPE
    assert [(g.n, round(g.length, 3)) for g in plain.groups] == [(2, 4.0), (1, 4.0), (15, 6.0)]
    assert all(g.multiplicity is None for g in plain.groups)
    assert plain.groups[0].mean_size_sigma == pytest.approx(plain.groups[0].size_sigma, rel=1e-3)
    # The same call without the cell, or with symmetry_ops=None, is the same list.
    assert strongest_features(data, ax, ax, ax, min_sigma=50.0, limit=30) == plain
    assert strongest_features(data, ax, ax, ax, min_sigma=50.0, limit=30,
                              symmetry_ops=None, cell_lengths=(A, A, A)) == plain

    declared = _features(data, ax, ops=M3M, min_sigma=50.0)
    assert [(g.n, g.multiplicity) for g in declared.groups] == [(3, 3), (3, 3), (12, 12)]
    assert _same_vectors(_fractions(declared.groups[1]), [(1.5, 0, 0), (0, 1.5, 0), (0, 0, 1.5)])


def test_a_declared_symmetry_that_cannot_be_applied_is_named_and_not_used():
    """No cell recorded; hexagonal operations on a cell recorded at 90° (a ΔPDF
    file written before the angles were stored reads as 90°); operations that
    generate no point group; a symmetry named without operations. Each leaves
    the grouping by sign, length and size, and says why."""
    data, ax = _peaks([((1, 0, 0), 50.0), ((0, 1, 0), 50.0), ((1, 1, 0), 50.0)])
    plain = _features(data, ax)

    def grouped(**kw):
        f = strongest_features(data, ax, ax, ax, min_sigma=8.0, limit=30, **kw)
        assert f.groups == plain.groups
        return f.grouped_by

    six = parse_symmetry_ops(SIX_MMM)
    assert grouped(symmetry_ops=six, symmetry_label="6/mmm") == (
        "sign, length and size (the declared symmetry 6/mmm is not applied: "
        "the ΔPDF file records no cell)")
    assert grouped(symmetry_ops=six, symmetry_label="6/mmm", cell_lengths=(A, A, 5.0)) == (
        "sign, length and size (the declared symmetry 6/mmm is not applied: "
        "h+k,-h,l changes the cell the ΔPDF records (4, 4, 5, 90, 90, 90))")
    assert grouped(symmetry_ops=parse_symmetry_ops("h+k,k,l"), cell_lengths=(A, A, A)) == (
        "sign, length and size (the declared symmetry h+k,k,l is not applied: "
        "its operations generate no crystallographic point group)")
    assert grouped(symmetry_label="6/m") == (
        "sign, length and size (the symmetry 6/m is named, but no operations are declared)")


def write_declared_dataset(root: Path, stem: str, symmetry: tuple[str, str] | None) -> None:
    """A data root of one dataset: a raw file (the NeXus Viewer's legacy layout)
    that declares *symmetry* (its label and operations; None: nothing), and a
    ΔPDF of a cubic cell (a = 4 Å) with peaks on two m-3m orbits, unequal
    copies, a positive general one and a negative ⟨1 0 0⟩."""
    (root / "raw").mkdir(parents=True, exist_ok=True)
    (root / "processed").mkdir(parents=True, exist_ok=True)
    paths = pipeline_paths(root / "raw" / f"{stem}.nxs", proc_dir=root / "processed")
    n, cubic = 9, (90.0, 90.0, 90.0)
    with h5py.File(paths.input, "w") as f:
        entry = f.create_group("entry")
        for name in ("h_axis", "k_axis", "l_axis"):
            entry[name] = np.linspace(-2.0, 2.0, n)
        entry["data"] = np.ones((n, n, n))
        entry["ub_matrix"] = ub_from_lattice(A, A, A, *cubic)
        if symmetry is not None:
            entry.attrs["symmetry"], entry.attrs["symmetry_ops"] = symmetry
    rng = np.random.default_rng(7)
    data, ax = _peaks([(v, 60.0 * rng.uniform(0.9, 1.1))
                       for v in _orbit((0.25, 0.5, 0.75), (A, A, A), cubic, CUBE)]
                      + [(v, -40.0 * rng.uniform(0.9, 1.1))
                         for v in _orbit((1, 0, 0), (A, A, A), cubic, CUBE)], n=61)
    save_delta_pdf(paths.delta_pdf, data, ax, ax, ax, ub_matrix=ub_from_lattice(A, A, A, *cubic),
                   logs={"q_max": 12.0})
