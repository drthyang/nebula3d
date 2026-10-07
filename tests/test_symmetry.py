"""Declared Laue symmetry: grid permutations, and the decisions made invariant.

A volume symmetrised over 6/m holds the same value at every equivalent voxel,
so its coverage-edge trim and Bragg punch must be the same there too.  Their
index-space windows and 3×3×3 neighbourhoods are not invariant under the
hexagonal 6-fold, which mixes H and K; on Fe3Ge2 (6/m) 22 % of the punched
voxels had an unpunched 60° partner and 15 % of the trimmed ones a kept
partner.  The reference orbits here are built from the group's generators
directly, not with ``nebula3d.symmetry``.
"""

import dataclasses

import h5py
import numpy as np
import pytest

from nebula3d.analysis.bragg import BraggRemover
from nebula3d.core import HKLVolume
from nebula3d.pipeline import PipelineParams, PunchParams, load_input, punch_bragg
from nebula3d.preprocessing.sampling import trim_coverage_edge
from nebula3d.symmetry import GridSymmetry, parse_symmetry_ops, read_symmetry_ops
from nebula3d.utils import ub_from_lattice

# The 6/m operations as the NeXus Viewer writes them (Fe3Ge2 90 K file).
SIX_M = ("h,k,l; h+k,-h,l; -h,-k,-l; k,-h-k,l; -h-k,h,-l; -k,h+k,-l; "
         "-h,-k,l; h,k,-l; -h-k,h,l; h+k,-h,-l; -k,h+k,l; k,-h-k,-l")


def _six_m_ops():
    """6/m from its generators: the 6-fold (h, k, l) → (h+k, −h, l) and m ⊥ c."""
    six = np.array([[1, 1, 0], [-1, 0, 0], [0, 0, 1]])
    mirror = np.diag([1, 1, -1])
    return [np.linalg.matrix_power(six, n) @ m
            for n in range(6) for m in (np.eye(3, dtype=int), mirror)]


def _images(shape, op):
    """Flat index of each voxel's image under *op* (HKL matrix) on a grid
    centred on 0 with equal steps; −1 where the image is off the grid."""
    c = (np.array(shape) - 1) // 2
    idx = np.indices(shape).reshape(3, -1) - c[:, None]
    t = op @ idx + c[:, None]
    ok = np.all((t >= 0) & (t < np.array(shape)[:, None]), axis=0)
    return np.where(ok, np.ravel_multi_index(np.where(ok, t, 0), shape), -1)


def _asymmetric(flag, valid, ops=None):
    """Voxels of *flag* with a valid image under some operation that is not flagged."""
    shape = flag.shape
    flag, valid = flag.ravel(), valid.ravel()
    bad = np.zeros(flag.size, dtype=bool)
    for op in ops or _six_m_ops():
        img = _images(shape, op)
        on = img >= 0
        partner_valid = np.zeros_like(valid)
        partner_valid[on] = valid[img[on]]
        partner_flag = np.zeros_like(flag)
        partner_flag[on] = flag[img[on]]
        bad |= flag & partner_valid & ~partner_flag
    return int(bad.sum())


_SHAPE = (61, 61, 41)  # H, K ∈ [−3, 3], L ∈ [−2, 2], step 0.1


def _hex_volume(seed=0):
    """An exactly 6/m-symmetric hexagonal volume: diffuse background, Bragg
    peaks at the integer nodes, satellites at H ± 1/3 and every plane
    equivalent to it, and noise.

    Every voxel takes the value its orbit's representative has, and the
    coverage is the voxels whose whole orbit is on the grid and inside a
    sphere, so data and coverage are exactly invariant, as in a symmetrised
    file.
    """
    rng = np.random.default_rng(seed)
    rot, _ = np.linalg.qr(rng.standard_normal((3, 3)))
    ub = rot @ ub_from_lattice(8.03, 8.03, 10.03, 90.0, 90.0, 120.0)
    hk = np.linspace(-3.0, 3.0, _SHAPE[0])
    ll = np.linspace(-2.0, 2.0, _SHAPE[2])
    hkl = np.stack(np.meshgrid(hk, hk, ll, indexing="ij")).reshape(3, -1)
    q = ub @ hkl
    qabs = np.linalg.norm(q, axis=0)
    field = 2.0 + 0.5 * np.cos(2.0 * qabs) + rng.normal(0.0, 0.2, qabs.size)
    ops = _six_m_ops()
    nodes = [np.array([h, k, l], float) for h in range(-3, 4) for k in range(-3, 4)
             for l in range(-2, 3) if (h, k, l) != (0, 0, 0)]
    sats = {tuple(np.round(op @ (n + [1 / 3, 0, 0]), 6)) for n in nodes[::7] for op in ops}
    for centre, amp in ([(n, 60.0 if (n[0] - n[1]) % 3 == 0 else 12.0) for n in nodes]
                        + [(np.array(s), 15.0) for s in sats]):
        d2 = np.sum((q - (ub @ centre)[:, None]) ** 2, axis=0)
        near = d2 < 0.25
        field[near] += amp * np.exp(-0.5 * d2[near] / 0.07**2)
    images = np.stack([_images(_SHAPE, op) for op in ops])
    whole = np.all(images >= 0, axis=0)
    rep = np.where(whole, np.min(np.where(images >= 0, images, field.size), axis=0), 0)
    measured = whole & (qabs[rep] <= 2.6)
    data = np.where(measured, field[rep], 0.0).reshape(_SHAPE)
    mask = measured.reshape(_SHAPE)
    return HKLVolume(data=data, sigma=np.sqrt(np.abs(data)), mask=mask,
                     h_axis=hk.copy(), k_axis=hk.copy(), l_axis=ll, ub_matrix=ub)


def test_parse_symmetry_ops_reads_the_viewer_triplets():
    ops = parse_symmetry_ops(SIX_M)
    assert len(ops) == 12
    np.testing.assert_array_equal(ops[1], [[1, 1, 0], [-1, 0, 0], [0, 0, 1]])
    as_set = {op.tobytes() for op in ops}
    assert as_set == {np.asarray(op, dtype=np.int64).tobytes() for op in _six_m_ops()}
    np.testing.assert_array_equal(parse_symmetry_ops("h-k, k, -l")[0],
                                  [[1, -1, 0], [0, 1, 0], [0, 0, -1]])


@pytest.mark.parametrize("bad", ["h,k", "h,q,l", "h,h,l", "2h-k,k,-l", "",
                                 "h,k,l;;h+x,k,l"])
def test_parse_symmetry_ops_rejects_malformed_operations(bad):
    with pytest.raises(ValueError):
        parse_symmetry_ops(bad)


def test_grid_symmetry_closes_the_group_and_finds_the_h_images():
    vol = _hex_volume()
    # the 6-fold and the mirror generate all of 6/m
    gs = GridSymmetry.for_volume(vol, parse_symmetry_ops("h+k,-h,l; h,k,-l"))
    assert gs.order == 12
    np.testing.assert_array_equal(gs.ops[0], np.eye(3))
    forms = {tuple(f) for f in gs.h_forms()}
    assert gs.h_forms()[0].tolist() == [1, 0, 0]
    # H, K and H+K, each with both signs
    assert forms == {(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (1, 1, 0), (-1, -1, 0)}


def test_orbit_any_is_the_union_of_the_images():
    vol = _hex_volume()
    gs = GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_M))
    seed = np.random.default_rng(1).random(_SHAPE) > 0.995
    got = gs.orbit_any(seed).ravel()
    want = seed.ravel().copy()
    for op in _six_m_ops():
        inv = _images(_SHAPE, np.rint(np.linalg.inv(op)).astype(int))
        on = inv >= 0  # x is flagged when its preimage under some op is
        want[on] |= seed.ravel()[inv[on]]
    np.testing.assert_array_equal(got, want)


def test_orbit_any_general_path_matches_brute_force():
    # The cubic 3-fold mixes L with H and K: the slab path, not the row gather.
    ax = np.linspace(-1.0, 1.0, 11)
    shape = (11, 11, 11)
    vol = HKLVolume(data=np.zeros(shape), sigma=np.ones(shape),
                    mask=np.ones(shape, dtype=bool), h_axis=ax, k_axis=ax.copy(),
                    l_axis=ax.copy(), ub_matrix=ub_from_lattice(5.0, 5.0, 5.0))
    gs = GridSymmetry.for_volume(vol, parse_symmetry_ops("k,l,h"))
    assert gs.order == 3
    seed = np.random.default_rng(2).random(shape) > 0.97
    want = seed.copy()
    for perm in ((1, 2, 0), (2, 0, 1)):
        want |= np.transpose(seed, perm)
    np.testing.assert_array_equal(gs.orbit_any(seed), want)


def test_grid_symmetry_rejects_a_grid_the_operations_do_not_map():
    vol = _hex_volume()
    vol = HKLVolume(data=vol.data, sigma=vol.sigma, mask=vol.mask,
                    h_axis=vol.h_axis, k_axis=2.0 * vol.k_axis, l_axis=vol.l_axis,
                    ub_matrix=vol.ub_matrix)
    with pytest.raises(ValueError, match="does not map"):
        GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_M))


def test_edge_trim_is_symmetric_with_the_declared_symmetry():
    base = _hex_volume()
    assert _asymmetric(base.mask, np.ones(_SHAPE, dtype=bool)) == 0  # the harness
    measured = base.mask.copy()

    plain = _hex_volume()
    trim_coverage_edge(plain, 1)
    # the 3×3×3 cube is not 6-fold invariant on a hexagonal grid
    assert _asymmetric(measured & ~plain.mask, measured) > 0

    sym = _hex_volume()
    n = trim_coverage_edge(sym, 1, symmetry=GridSymmetry.for_volume(
        sym, parse_symmetry_ops(SIX_M)))
    trimmed = measured & ~sym.mask
    assert n == int(trimmed.sum()) > int((measured & ~plain.mask).sum())
    assert _asymmetric(trimmed, measured) == 0
    assert not (measured & ~plain.mask & ~trimmed).any()  # contains the plain trim


def test_punch_mask_is_symmetric_with_the_declared_symmetry():
    # Regression (Fe3Ge2 6/m, 2026-10-07): with the default PunchParams (its
    # H-only guard and thirds exclusion included) the punch of exactly
    # symmetric data was not symmetric; with the declared operations it is.
    vol = _hex_volume()
    gs = GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_M))
    measured = vol.mask & np.isfinite(vol.data)

    plain = measured & ~punch_bragg(vol, PunchParams()).mask
    assert _asymmetric(plain, measured) > 0

    out = punch_bragg(vol, PunchParams(), symmetry=gs)
    punched = measured & ~out.mask
    assert punched.sum() > 1000
    assert _asymmetric(punched, measured) == 0
    np.testing.assert_array_equal(getattr(out, "_punched"), punched)


def _near_third(x, half_width):
    f = np.mod(x, 1.0)
    return (np.abs(f - 1 / 3) <= half_width) | (np.abs(f - 2 / 3) <= half_width)


def test_search_exclusion_protects_every_plane_equivalent_to_a_protected_one():
    # search_exclude_h_fractions protects H = n ± 1/3.  With 6/m declared the
    # K and H+K thirds planes hold the same data and are protected too.
    vol = _hex_volume()
    plain = BraggRemover(search_exclude_h_fractions=(1 / 3, 2 / 3),
                         search_exclude_h_half_width=0.05)
    sym = dataclasses.replace(plain, symmetry_ops=parse_symmetry_ops(SIX_M))
    hh, kk = np.meshgrid(vol.h_axis, vol.k_axis, indexing="ij")
    got_plain = np.broadcast_to(plain._search_excluded_h_mask(vol), _SHAPE)
    got_sym = np.broadcast_to(sym._search_excluded_h_mask(vol), _SHAPE)
    np.testing.assert_array_equal(got_plain[:, :, 0], _near_third(hh, 0.05))
    np.testing.assert_array_equal(
        got_sym[:, :, 0],
        _near_third(hh, 0.05) | _near_third(kk, 0.05) | _near_third(hh + kk, 0.05))
    assert (got_sym == got_sym[:, :, :1]).all()
    assert _asymmetric(np.array(got_sym), np.ones(_SHAPE, dtype=bool)) == 0


def test_integer_h_guard_holds_along_every_direction_equivalent_to_h():
    # The guard keeps an integer punch within ±w of its node's H plane; with
    # 6/m declared, of the equivalent K and H+K planes too: a hexagonal prism.
    vol = _hex_volume()
    w = 0.12
    plain = BraggRemover(integer_h_guard_hkl=w)
    sym = dataclasses.replace(plain, symmetry_ops=parse_symmetry_ops(SIX_M))
    node = (1, 1, 0)
    ic = tuple(int(np.argmin(np.abs(a - v))) for a, v in
               zip((vol.h_axis, vol.k_axis, vol.l_axis), node))
    hh, kk, ll = np.meshgrid(vol.h_axis, vol.k_axis, vol.l_axis, indexing="ij")
    ball = (hh - 1) ** 2 + (kk - 1) ** 2 + ll**2 <= 0.45**2  # inside the radii below
    guard = ((1.0, 1.0, 0.0), w)
    radii = (0.5, 0.5, 0.5)
    got_plain = ~plain._punch_one(vol, np.ones(_SHAPE, dtype=bool), ic, radii, 0.0,
                                  center_hkl=(1.0, 1.0, 0.0), h_guard=guard)
    got_sym = ~sym._punch_one(vol, np.ones(_SHAPE, dtype=bool), ic, radii, 0.0,
                              center_hkl=(1.0, 1.0, 0.0), h_guard=guard)
    in_h = np.abs(hh - 1) <= w
    prism = in_h & (np.abs(kk - 1) <= w) & (np.abs(hh + kk - 2) <= w)
    np.testing.assert_array_equal(got_plain & ball, ball & in_h)
    np.testing.assert_array_equal(got_sym & ball, ball & prism)
    assert (got_plain & ~in_h).sum() == 0 and (got_sym & ~prism).sum() == 0


def test_symmetry_off_leaves_the_punch_unchanged():
    vol = _hex_volume()
    measured = vol.mask & np.isfinite(vol.data)
    a = measured & ~punch_bragg(vol, PunchParams()).mask
    b = measured & ~punch_bragg(vol, PunchParams(), symmetry=None).mask
    np.testing.assert_array_equal(a, b)


def _write_viewer_file(path, vol, symmetry_ops):
    """The legacy /entry layout the NeXus Viewer hands over."""
    with h5py.File(path, "w") as f:
        e = f.create_group("entry")
        e.create_dataset("data", data=vol.data.astype(np.float32))
        e.create_dataset("mask", data=vol.mask.astype(np.uint8))
        for name in ("h_axis", "k_axis", "l_axis"):
            e.create_dataset(name, data=getattr(vol, name))
        e.create_dataset("ub_matrix", data=vol.ub_matrix)
        if symmetry_ops is not None:
            e.attrs["symmetry"] = "6/m"
            e.attrs["symmetry_ops"] = symmetry_ops


def test_load_input_trims_symmetrically_with_the_declared_symmetry(tmp_path):
    vol = _hex_volume()
    path = tmp_path / "hex_sym6m.nxs"
    _write_viewer_file(path, vol, SIX_M)
    assert len(read_symmetry_ops(path)) == 12

    events = []
    auto = load_input(path, PipelineParams(), progress=lambda *a: events.append(a))
    assert _asymmetric(vol.mask & ~auto.mask, vol.mask) == 0
    assert any("shared across 12 symmetry operations" in str(e[3]) for e in events)

    off = load_input(path, PipelineParams(symmetry=None))
    assert _asymmetric(vol.mask & ~off.mask, vol.mask) > 0

    explicit = load_input(path, PipelineParams(symmetry="h+k,-h,l; h,k,-l"))
    np.testing.assert_array_equal(explicit.mask, auto.mask)


def test_load_input_without_a_declared_symmetry_trims_as_before(tmp_path):
    vol = _hex_volume()
    path = tmp_path / "hex.nxs"
    _write_viewer_file(path, vol, None)
    assert read_symmetry_ops(path) is None
    got = load_input(path, PipelineParams())
    want = _hex_volume()
    trim_coverage_edge(want, 1)
    np.testing.assert_array_equal(got.mask, want.mask)


def test_auto_symmetry_that_does_not_fit_the_grid_is_reported_not_fatal(tmp_path):
    vol = _hex_volume()
    vol = HKLVolume(data=vol.data, sigma=vol.sigma, mask=vol.mask,
                    h_axis=vol.h_axis, k_axis=2.0 * vol.k_axis, l_axis=vol.l_axis,
                    ub_matrix=vol.ub_matrix)
    path = tmp_path / "stretched.nxs"
    _write_viewer_file(path, vol, SIX_M)
    events = []
    load_input(path, PipelineParams(), progress=lambda *a: events.append(a))
    assert any("ignoring the symmetry" in str(e[3]) for e in events)
    with pytest.raises(ValueError, match="does not map"):
        load_input(path, PipelineParams(symmetry=SIX_M))
