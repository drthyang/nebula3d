"""The sample's modulation and what it protects from the punch's search (plan 4.15, P1).

Known answers: k = (1/3, 0, 0) declared as planes protects, bit for bit, the H
planes the search protected before declarations, (0.3333, 0.6667) ± 0.08 r.l.u.
(read by the frozen copy of the old rule below), on a plain grid, a 6/m grid
and a grid with voxels at the circular distance 0.08 itself. A slice's labels
are the mask; the points form's star is closed under the point group, so the
satellites it protects survive the punch shared across the symmetry orbit.
Every k here is a generic example, never a material's.
"""

from __future__ import annotations

import dataclasses
from fractions import Fraction

import numpy as np
import pytest

from nebula3d import modulation
from nebula3d.analysis.bragg import BraggRemover
from nebula3d.core import HKLVolume
from nebula3d.modulation import (
    ALPHA,
    Bunching,
    Modulation,
    detect_commensurate,
    h_planes,
    protected_labels,
    protected_mask,
)
from nebula3d.pipeline import PunchParams, bragg_remover
from nebula3d.symmetry import GridSymmetry, coordinate_forms, parse_symmetry_ops, point_group
from nebula3d.utils import ub_from_lattice
from tests.test_symmetry import _SHAPE, SIX_M, _asymmetric, _hex_volume, _images

THIRDS = Modulation.parse({"k": "1/3, 0, 0", "form": "planes", "half_width": 0.08})
# The decision's generic example of a points declaration.
POINTS = Modulation.parse({"k": "0.2, 0, 1/2", "order": 2})


def _legacy_h_mask(vol, forms, centers, fractions, half_width):
    """The search's H planes before modulations were declared:
    BraggRemover._search_excluded_h_mask as it was, verbatim."""
    half_width = max(float(half_width), 0.0)
    if half_width <= 0 or (not centers and not fractions):
        return np.zeros(vol.shape, dtype=bool)
    h_excluded = np.zeros((1, 1, 1), dtype=bool)
    for form in forms:
        axes = (vol.h_axis[:, None, None], vol.k_axis[None, :, None],
                vol.l_axis[None, None, :])
        h = None
        for c, ax in zip(form, axes):
            if c:
                term = ax if c == 1 else float(c) * ax
                h = term if h is None else h + term
        for h0 in centers or ():
            h_excluded = h_excluded | (np.abs(h - float(h0)) <= half_width)
        if fractions:
            frac = np.mod(h, 1.0)
            for f in fractions:
                f0 = float(f) % 1.0
                d = np.abs(frac - f0)
                d = np.minimum(d, 1.0 - d)
                h_excluded = h_excluded | (d <= half_width)
    return h_excluded


def _old_h_forms(ops):
    """GridSymmetry.h_forms as it was: row 0 of each M⁻¹, first seen first."""
    out = []
    for m in ops:
        f = np.rint(np.linalg.inv(m)[0]).astype(np.int64)
        if not any(np.array_equal(f, g) for g in out):
            out.append(f)
    return out


def _plain_volume(h_axis, k_axis=None, l_axis=None) -> HKLVolume:
    k_axis = np.linspace(-1.0, 1.0, 5) if k_axis is None else k_axis
    l_axis = np.linspace(-1.0, 1.0, 3) if l_axis is None else l_axis
    shape = (h_axis.size, k_axis.size, l_axis.size)
    return HKLVolume(data=np.zeros(shape), sigma=np.ones(shape), mask=np.ones(shape, bool),
                     h_axis=h_axis, k_axis=k_axis, l_axis=l_axis,
                     ub_matrix=ub_from_lattice(4.0, 4.0, 4.0))


def _assert_the_old_planes(vol, symmetry):
    forms = (_old_h_forms(symmetry.ops) if symmetry is not None else [np.array([1, 0, 0])])
    old = np.broadcast_to(_legacy_h_mask(vol, forms, None, (0.3333, 0.6667), 0.08), vol.shape)
    new = np.broadcast_to(THIRDS.mask(vol, symmetry), vol.shape)
    legacy = BraggRemover(search_exclude_h_fractions=(0.3333, 0.6667),
                          search_exclude_h_half_width=0.08,
                          symmetry_ops=None if symmetry is None else symmetry.ops)
    through = np.broadcast_to(legacy._search_excluded_h_mask(vol), vol.shape)
    declared = BraggRemover(search_protect=THIRDS,
                            symmetry_ops=None if symmetry is None else symmetry.ops)
    searched = np.broadcast_to(declared._search_excluded_mask(vol), vol.shape)
    assert old.any() and not old.all()
    np.testing.assert_array_equal(new, old)
    np.testing.assert_array_equal(through, old)
    np.testing.assert_array_equal(searched, old)
    return old


# ------------------------------------------------------------- the known answers

def test_the_thirds_as_planes_are_the_old_planes_on_a_plain_grid():
    vol = _plain_volume(np.linspace(-4.0, 4.0, 161))
    old = _assert_the_old_planes(vol, None)
    # H = n ± 1/3 ± 0.08 on a 0.05 grid: 0.3, 0.35, 0.4 and 0.6, 0.65, 0.7 of each unit.
    assert int(old[:, 0, 0].sum()) == 6 * 8


def test_the_thirds_as_planes_are_the_old_planes_on_a_six_m_grid():
    vol = _hex_volume()
    gs = GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_M))
    old = _assert_the_old_planes(vol, gs)
    assert _asymmetric(np.array(old), np.ones(_SHAPE, dtype=bool)) == 0


def test_the_thirds_as_planes_are_the_old_planes_at_the_band_edge_itself():
    """H every 1e-4 r.l.u. over three periods, both signs: voxels at 0.3333 ±
    0.08 and 0.6667 ± 0.08, where the circular distance is 0.08 to within a
    rounding, are decided as the old rule decided them. The planes' centres
    are k's exact ±1/3 quantised to 1e-4: unquantised, the edge moves."""
    h = np.round(np.arange(-15000, 15001) * 1e-4, 4)
    vol = _plain_volume(h, np.zeros(1), np.zeros(1))
    d = np.abs(np.mod(h, 1.0) - 0.3333)
    d = np.minimum(d, 1.0 - d)
    assert (np.abs(d - 0.08) < 1e-12).sum() >= 6  # the edge is on the grid, both sides
    old = _assert_the_old_planes(vol, None)
    exact = _legacy_h_mask(vol, [np.array([1, 0, 0])], None, (1 / 3, 2 / 3), 0.08)
    assert not np.array_equal(np.broadcast_to(exact, vol.shape), old)


def test_h_forms_are_the_forms_of_h_in_the_same_order():
    cubic = point_group(parse_symmetry_ops("k,l,h; -h,-k,-l; k,h,l; -h,k,l"))
    tetragonal = point_group(parse_symmetry_ops("-k,h,l; h,k,-l; -h,-k,-l"))
    trigonal = point_group(parse_symmetry_ops("-k,h-k,l; -h,-k,-l"))
    six_m = point_group(parse_symmetry_ops(SIX_M))
    for ops in (cubic, tetragonal, trigonal, six_m):
        old = _old_h_forms(ops)
        new = coordinate_forms(ops, (1, 0, 0))
        assert [f.tolist() for f in new] == [f.tolist() for f in old]
    vol = _hex_volume()
    gs = GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_M))
    assert [f.tolist() for f in gs.h_forms()] == [f.tolist() for f in gs.forms((1, 0, 0))]
    assert [f.tolist() for f in gs.forms((0, 0, 1))] == [[0, 0, 1], [0, 0, -1]]


def test_the_legacy_planes_read_the_one_predicate():
    """The legacy centres and fractions (h_planes) through the module's mask
    are the old rule's, centres and fractions together."""
    vol = _plain_volume(np.linspace(-2.0, 2.0, 81))
    planes = h_planes(centres=(-1 / 3, 1 / 2), fractions=(1 / 8,), half_width=0.05)
    old = _legacy_h_mask(vol, [np.array([1, 0, 0])], (-1 / 3, 1 / 2), (1 / 8,), 0.05)
    np.testing.assert_array_equal(np.broadcast_to(protected_mask(planes, vol), vol.shape),
                                  np.broadcast_to(old, vol.shape))
    assert h_planes(fractions=(1 / 8,), half_width=0.0) == ()
    assert h_planes(half_width=0.08) == ()


# ------------------------------------------------------------- positions

def test_the_thirds_are_two_plane_families_and_say_so():
    labels = [p.label for p in THIRDS.positions()]
    assert labels == ["H ≡ 1/3 (mod 1)", "H ≡ 2/3 (mod 1)"]
    assert THIRDS.positions()[0].regions[0][0].centre == 0.3333
    assert THIRDS.positions()[1].regions[0][0].centre == 0.6667
    assert THIRDS.describe() == "k = (1/3, 0, 0), m = 1, as planes: H ≡ ±1/3 (mod 1), ± 0.08 r.l.u."
    six_m = parse_symmetry_ops(SIX_M)
    families = THIRDS.positions(six_m)
    assert len(families) == 6
    assert {p.label for p in families} == {f"{c} ≡ {v} (mod 1)" for c in ("H", "K", "H+K")
                                           for v in ("1/3", "2/3")}
    assert THIRDS.describe(six_m).endswith("with the 12 symmetry operations, 6 plane families")


def test_planes_follow_k_and_the_parent_lattice():
    # k along a diagonal: the planes H + K ≡ ±2/3, t = (1, 1, 0).
    diagonal = Modulation.parse({"k": "1/3, 1/3, 0", "form": "planes"})
    assert [p.label for p in diagonal.positions()] == ["H+K ≡ 1/3 (mod 1)", "H+K ≡ 2/3 (mod 1)"]
    # On a cell doubled along H the parent nodes are at even H: the planes repeat every 2.
    doubled = THIRDS.positions(cell=(2, 1, 1))
    assert [p.label for p in doubled] == ["H ≡ 1/3 (mod 2)", "H ≡ 5/3 (mod 2)"]
    # A declared normal: the planes ⊥ L through the satellites of k = (1/5, 0, 1/2).
    normal = Modulation.parse({"k": "1/5, 0, 1/2", "form": "planes", "normal": "0 0 2"})
    assert normal.normal == (0, 0, 1)
    assert [p.label for p in normal.positions()] == ["L ≡ 1/2 (mod 1)"]
    # m·k on the lattice is left out: there the node test has the say.
    half = Modulation.parse({"k": "1/2, 0, 0", "form": "planes", "order": 2})
    assert [p.label for p in half.positions()] == ["H ≡ 1/2 (mod 1)"]
    assert Modulation.parse({"k": "1, 0, 0", "form": "planes"}).positions() == ()
    assert Modulation.parse({"k": "1, 0, 0"}).describe().endswith("nothing is protected")
    assert [p.label for p in Modulation.parse({"k": "1, 0, 0"}).positions(cell=(2, 1, 1))] == [
        "G + (1, 0, 0)"]


def test_points_are_the_satellites_of_every_order_and_their_star():
    assert [p.label for p in POINTS.positions()] == [
        "G + (1/5, 0, 1/2)", "G + (-1/5, 0, 1/2)", "G + (2/5, 0, 0)", "G + (-2/5, 0, 0)"]
    assert POINTS.positions()[0].regions == ((
        modulation.Band((1, 0, 0), 0.2, 1.0), modulation.Band((0, 1, 0), 0.0, 1.0),
        modulation.Band((0, 0, 1), 0.5, 1.0)),)
    six_m = parse_symmetry_ops(SIX_M)
    star = POINTS.positions(six_m)
    # Six images of each order in the hexagonal plane; ±1/2 along L are one.
    assert len(star) == 12
    vectors = {tuple(Fraction(c) for c in p.vector) for p in star}
    for op in point_group(six_m):
        for v in vectors:
            image = tuple(sum(int(op[i, j]) * v[j] for j in range(3)) for i in range(3))
            assert tuple(_centred(c) for c in image) in vectors
    # The 6-fold shears a box into another shape: those images are regions of their own.
    assert {len(p.regions) for p in star} == {3}


def _centred(c: Fraction) -> Fraction:
    c = c % 1
    return c - 1 if c > Fraction(1, 2) else c


# ------------------------------------------------------------- labels, nearest, the mask

@pytest.mark.parametrize("declared", [THIRDS, POINTS], ids=["planes", "points"])
def test_labels_are_the_mask_on_a_six_m_grid(declared):
    vol = _hex_volume()
    gs = GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_M))
    mask = np.broadcast_to(declared.mask(vol, gs), vol.shape)
    hh, kk, ll = np.meshgrid(vol.h_axis, vol.k_axis, vol.l_axis, indexing="ij")
    labels = declared.labels(hh, kk, ll, gs)
    assert labels.dtype == np.int32 and labels.shape == vol.shape
    np.testing.assert_array_equal(labels > 0, mask)
    assert set(np.unique(labels)) == set(range(len(declared.positions(gs)) + 1))
    # The mask is closed under the group, so the punch shared across each orbit
    # never punches a protected voxel through an unprotected equivalent.
    assert _asymmetric(np.array(mask), np.ones(_SHAPE, dtype=bool)) == 0
    # A slice's labels are the volume's: L = 0.5 is a grid plane.
    il = int(np.argmin(np.abs(vol.l_axis - 0.5)))
    cut = declared.labels(vol.h_axis[:, None], vol.k_axis[None, :], vol.l_axis[il], gs)
    np.testing.assert_array_equal(cut, labels[:, :, il])
    # nearest() agrees with the labels, voxel by voxel, at a sample of voxels.
    rng = np.random.default_rng(5)
    for i, j, k in zip(*(rng.integers(0, n, 300) for n in vol.shape)):
        near = declared.nearest((vol.h_axis[i], vol.k_axis[j], vol.l_axis[k]), gs)
        assert near is not None
        assert near.inside == (labels[i, j, k] > 0)
        if labels[i, j, k]:
            assert near.distance <= declared.half_width


def test_nearest_names_the_position_and_the_distance():
    near = THIRDS.nearest((2.3, 0.0, 0.0))
    assert near.position.label == "H ≡ 1/3 (mod 1)" and near.inside
    assert near.distance == pytest.approx(0.0333, abs=1e-12)
    far = THIRDS.nearest((2.5, 0.0, 0.0))
    assert not far.inside and far.distance == pytest.approx(0.1667, abs=1e-12)
    point = POINTS.nearest((-0.79, 3.0, 2.5))  # G + (1/5, 0, 1/2) at G = (-1, 3, 2)
    assert point.position.label == "G + (1/5, 0, 1/2)" and point.inside
    assert point.distance == pytest.approx(0.01, abs=1e-12)
    assert protected_labels((), 0.3, 0.0, 0.0) == 0


def _star_volume():
    """Exactly 6/m-symmetric data (as _hex_volume builds them: every voxel
    takes its orbit's value, the coverage whole orbits inside a sphere) of a
    noisy flat diffuse level, with a one-voxel satellite at every G ± m·R·k of
    POINTS: a peak the search finds, with no flank to find instead when its
    voxel is protected. Returns the volume, its group on the grid, the
    satellites' voxels and those of ±m·k alone."""
    rng = np.random.default_rng(0)
    rot, _ = np.linalg.qr(rng.standard_normal((3, 3)))
    ub = rot @ ub_from_lattice(8.0, 8.0, 10.0, 90.0, 90.0, 120.0)
    hk, ll = np.linspace(-3.0, 3.0, _SHAPE[0]), np.linspace(-2.0, 2.0, _SHAPE[2])
    hkl = np.stack(np.meshgrid(hk, hk, ll, indexing="ij")).reshape(3, -1)
    qabs = np.linalg.norm(ub @ hkl, axis=0)
    field = 2.0 + rng.normal(0.0, 0.2, qabs.size)
    ops = point_group(parse_symmetry_ops(SIX_M))
    images = np.stack([_images(_SHAPE, op) for op in ops])
    whole = np.all(images >= 0, axis=0)
    rep = np.where(whole, np.min(np.where(images >= 0, images, field.size), axis=0), 0)
    measured = (whole & (qabs[rep] <= 2.6)).reshape(_SHAPE)
    data = np.where(measured.ravel(), field[rep], 0.0).reshape(_SHAPE)
    vol = HKLVolume(data=data, sigma=np.full(_SHAPE, 0.2), mask=measured, h_axis=hk,
                    k_axis=hk.copy(), l_axis=ll, ub_matrix=ub)
    gs = GridSymmetry.for_volume(vol, ops)
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    own = {tuple(Fraction(c) for c in p.vector) for p in POINTS.positions()}
    planted, alone = [], []
    for node in np.ndindex(13, 13, 5):
        for p in POINTS.positions(gs):
            s = tuple(Fraction(c) for c in p.vector)
            at = (node[0] - 6 + s[0], node[1] - 6 + s[1], node[2] - 2 + s[2])
            idx = tuple(int(np.argmin(np.abs(a - float(x)))) for a, x in zip(axes, at))
            on_grid = all(abs(a[i] - float(x)) < 1e-9 for a, i, x in zip(axes, idx, at))
            if on_grid and measured[idx] and idx not in planted:
                planted.append(idx)
                alone += [idx] if s in own else []
                vol.data[idx] += 30.0
    return vol, gs, planted, alone


def test_the_points_star_survives_the_punch_shared_across_the_orbit(monkeypatch):
    """Sharp satellites at every G ± m·R·k of the decision's generic points
    example (k = (1/5, 0, 1/2), order 2), on exactly 6/m data with the 6/m
    declared: the punch shares each decision across the orbit
    (_symmetric_keep), and the declared star leaves every satellite unpunched.
    Without the star (the positions of ±m·k alone) the search punches the
    other images and the shared punch takes the declared ones with them;
    without a declaration they are all punched."""
    vol, gs, planted, declared_alone = _star_volume()
    measured = vol.mask & np.isfinite(vol.data)
    assert _asymmetric(vol.data > 20, measured) == 0  # the satellites are symmetric
    remover = dataclasses.replace(bragg_remover(PunchParams(search_exclude_h_fractions=None)),
                                  symmetry_ops=gs.ops)

    def punched(declared, idx):
        keep = dataclasses.replace(remover, search_protect=declared).build_mask(vol)
        return sum(not keep[i] for i in idx)

    assert len(planted) > 200
    assert punched(None, planted) > 0.9 * len(planted)
    assert punched(POINTS, planted) == 0
    monkeypatch.setattr(modulation, "_group", lambda symmetry: (np.eye(3, dtype=np.int64),))
    modulation._positions.cache_clear()
    try:
        assert punched(POINTS, declared_alone) > 0.5 * len(declared_alone)
    finally:
        modulation._positions.cache_clear()


# ------------------------------------------------------------- reading a declaration

def test_parse_reads_strings_mappings_and_its_own_json():
    assert Modulation.parse(None) is None
    for none in ("", "none", " Off ", {"k": ""}, {"k": "none", "order": "2"}, {"k": []}):
        assert Modulation.parse(none) is None
    one = Modulation.parse("1/3, 0, 0")
    assert one.k == ((Fraction(1, 3), Fraction(0), Fraction(0)),)
    assert one.form == "points" and one.order == 1 and one.half_width == 0.08
    assert Modulation.parse("(1/3 0 0)") == one == Modulation.parse([Fraction(1, 3), 0, 0])
    assert Modulation.parse({"k": "1/3,0,0", "order": "", "form": "", "half_width": ""}) == one
    two = Modulation.parse({"k": "1/3,0,0; 0,0,1/2", "order": "2", "form": "Planes",
                            "half_width": "0.05"})
    assert two.k[1] == (0, 0, Fraction(1, 2)) and two.order == 2 and two.form == "planes"
    assert two.half_width == 0.05
    assert Modulation.parse(two.to_json()) == two
    assert Modulation.parse(two) is two
    assert THIRDS.to_json() == {"k": [["1/3", "0", "0"]], "order": 1, "form": "planes",
                                "half_width": 0.08, "normal": None}
    # A decimal is the simplest fraction within half the quantum of it.
    assert Modulation.parse("0.3333, 0, 0") == one
    assert Modulation.parse([1 / 3, 0, 0]) == one
    assert POINTS.k == ((Fraction(1, 5), Fraction(0), Fraction(1, 2)),)
    assert Modulation.parse("0.12345, 0, 0").k[0][0] == Fraction(10, 81)
    assert Modulation.parse({"k": [[1, 0, 0], [0, "1/4", 0]]}).k[1][1] == Fraction(1, 4)


@pytest.mark.parametrize("bad, says", [
    ("1/3, 0", "three components"),
    ("1/3, x, 0", "a fraction such as 1/3"),
    ("1/0, 0, 0", "a fraction such as 1/3"),
    ("0, 0, 0", "no modulation"),
    ({"k": "1/3,0,0", "order": 0}, "order 0"),
    ({"k": "1/3,0,0", "order": 7}, "order 7"),
    ({"k": "1/3,0,0", "order": "1.5"}, "a whole number"),
    ({"k": "1/3,0,0", "form": "rods"}, "choose 'points' or 'planes'"),
    ({"k": "1/3,0,0", "half_width": 0}, "between 0 and 0.5"),
    ({"k": "1/3,0,0", "half_width": "0.5"}, "between 0 and 0.5"),
    ({"k": "1/3,0,0", "half_width": "nan"}, "a finite number"),
    ({"k": "1/3,0,0", "normal": "0 0 0"}, "must not be (0, 0, 0)"),
    ({"k": "1/3,0,0", "normal": "1 0"}, "three integers"),
    ({"k": "1/3,0,0", "width": 3}, "unknown modulation field"),
    (42, "cannot read a modulation"),
])
def test_parse_says_what_is_wrong(bad, says):
    with pytest.raises(ValueError, match=re_escape(says)):
        Modulation.parse(bad)


def re_escape(text: str) -> str:
    import re

    return re.escape(text)


def test_the_cell_must_be_three_positive_integers():
    with pytest.raises(ValueError, match="three positive integers"):
        THIRDS.positions(cell=(0, 1, 1))
    with pytest.raises(ValueError, match="three positive integers"):
        THIRDS.mask(_plain_volume(np.linspace(-1, 1, 5)), cell=(1, 1))


# ------------------------------------------------------------- the bunching test

AX = np.linspace(-4.0, 4.0, 161)  # a step of 0.05 r.l.u.: denominators 2 to 9 resolved


def _voxel(x):
    return tuple(float(AX[np.argmin(np.abs(AX - v))]) for v in x)


def _random_peaks(rng, n):
    return [_voxel(rng.uniform(-4.0, 4.0, 3)) for _ in range(n)]


def _family(rng, nodes, k):
    k = np.asarray(k, dtype=float)
    out = []
    for _ in range(nodes):
        g = rng.integers(-3, 4, 3).astype(float)
        out += [_voxel(g + k), _voxel(g - k)]
    return out


def test_bunching_fires_on_a_planted_thirds_family():
    rng = np.random.default_rng(3)
    peaks = _family(rng, 15, (1 / 3, 0, 0)) + _random_peaks(rng, 30)
    found = detect_commensurate(peaks, (AX, AX, AX))
    assert isinstance(found, Bunching)
    assert (found.coordinate, found.denominator, found.period) == ("H", 3, 1)
    assert [v for v, _n in found.values] == ["1/3", "2/3"]
    assert found.where() == "H ≡ ±1/3 (mod 1)"
    assert found.hits >= 30 and found.peaks == 60
    assert found.tests == 3 * 8  # H, K, L × denominators 2 to 9
    assert found.p_value <= ALPHA / found.tests
    assert found.half_width == pytest.approx(0.05)
    record = found.to_json()
    assert record["where"] == "H ≡ ±1/3 (mod 1)" and record["denominator"] == 3
    assert record["expected"] == pytest.approx(found.peaks * found.p0, abs=1e-3)


def test_bunching_needs_three_hits_and_leaves_out_the_declared_and_the_nodes():
    rng = np.random.default_rng(4)
    pair = [_voxel((1 + 1 / 3, 0, 0)), _voxel((1 - 1 / 3, 0, 0))]
    assert detect_commensurate(pair, (AX, AX, AX)) is None
    family = _family(rng, 15, (1 / 3, 0, 0)) + _random_peaks(rng, 30)
    assert detect_commensurate(family, (AX, AX, AX), declared=THIRDS) is None
    elsewhere = Modulation.parse("0, 0, 1/2")  # declared, but not where the family is
    assert detect_commensurate(family, (AX, AX, AX), declared=elsewhere) is not None
    # Peaks within a grid step of a node on all three axes are a Bragg peak's wings.
    wings = [_voxel(np.array(rng.integers(-3, 4, 3), float) + [0.05, 0.0, -0.05])
             for _ in range(40)]
    assert detect_commensurate(wings, (AX, AX, AX)) is None
    # Peaks outside the voxels the search could find one in are left out too.
    eligible = np.ones((AX.size, AX.size, AX.size), dtype=bool)
    eligible[AX > 0] = False
    full = detect_commensurate(family, (AX, AX, AX))
    half = detect_commensurate(family, (AX, AX, AX), eligible=eligible)
    assert half is None or half.peaks <= sum(p[0] <= 0 for p in family) < full.peaks


def _orbits(nodes):
    """The 6/m images of the satellites G + (1/3, 0, 0) at *nodes*, each
    snapped to the 0.05 r.l.u. grid (the images of a snapped satellite are the
    snapped images: each component is n ± 1/3 or n)."""
    six_m = point_group(parse_symmetry_ops(SIX_M))
    ax = np.linspace(-3.0, 3.0, 121)
    peaks = []
    for node in nodes:
        x = np.asarray(node, dtype=float) + [1 / 3, 0, 0]
        for op in six_m:
            peaks.append(tuple(float(ax[np.argmin(np.abs(ax - v))]) for v in op @ x))
    return peaks, (ax, ax, ax), six_m


def test_on_symmetrised_data_each_orbit_counts_once():
    """The twelve images of a satellite are one hit, not twelve: 3 orbits (36
    peaks) are no evidence, though counted peak by peak they would be; those
    of every node within one of the origin are."""
    peaks, axes, six_m = _orbits([(0, 0, 0), (1, 0, 0), (0, 1, 0)])
    assert len(peaks) == 36
    assert detect_commensurate(peaks, axes) is not None  # counted peak by peak
    assert detect_commensurate(peaks, axes, six_m) is None
    peaks, axes, six_m = _orbits([tuple(i - 1 for i in n) for n in np.ndindex(3, 3, 3)])
    found = detect_commensurate(peaks, axes, six_m)
    distinct = len({min(tuple(round(float(v), 4) + 0.0 for v in op @ np.asarray(p))
                        for op in six_m) for p in peaks})
    assert distinct >= 14
    assert found is not None and found.peaks == found.hits == distinct
    assert found.coordinate == "H" and set(found.equivalents) == {"K", "H+K"}
    assert found.tests == 2 * 8  # H (with K and H+K) and L × denominators 2 to 9


def test_bunching_seldom_fires_on_peaks_at_random():
    """The null: peaks off the lattice where chance puts them. Family-wise at
    1.35e-3 (one-sided 3σ), Bonferroni over the tests: over 400 runs of 40
    peaks it fires at most a few times (expected under 0.6)."""
    rng = np.random.default_rng(7)
    ax = np.linspace(-2.0, 2.0, 41)  # 0.1 a step: denominators 2 to 4
    fired = 0
    for _ in range(400):
        peaks = [tuple(float(ax[i]) for i in rng.integers(0, ax.size, 3)) for _ in range(40)]
        fired += detect_commensurate(peaks, (ax, ax, ax)) is not None
    assert fired <= 3


def test_the_grid_decides_the_denominators():
    coarse = np.linspace(-2.0, 2.0, 9)  # 0.5 a step: no fraction is resolved
    peaks = [(0.5, 0.0, 0.0), (1.5, 0.5, 0.0), (-0.5, 1.0, 1.5), (0.5, -1.0, 0.5)]
    assert detect_commensurate(peaks, (coarse, coarse, coarse)) is None


def test_the_fraction_named_is_the_one_the_hits_sit_on():
    """On a 0.05 grid, satellites at ±2/5 sit on voxels, which also lie
    within one grid step of ±3/8 and ±1/3. Fractions on the grid hold three
    voxels of a band, others two, so the smallest tail would name 3/8: the
    fraction named is the one the hits sit nearest, the others recorded."""
    rng = np.random.default_rng(6)
    found = detect_commensurate(_family(rng, 25, (2 / 5, 0, 0)), (AX, AX, AX))
    assert found is not None and found.where() == "H ≡ ±2/5 (mod 1)"
    assert found.mean_distance == pytest.approx(0.0, abs=1e-9)
    assert "H ≡ ±3/8 (mod 1)" in found.others
    assert found.to_json()["others"] == list(found.others)
    assert "; the grid also fits H ≡ ±" in found.describe()


def test_the_flank_of_a_declared_satellite_is_no_evidence():
    """With a satellite's own voxels protected, the search can find the voxel
    beside it: peaks within one grid step of a declared position are left
    out with the position itself."""
    rng = np.random.default_rng(9)
    fifth = Modulation.parse({"k": "1/5, 0, 0", "form": "planes"})
    flanks = _family(rng, 25, (0.3, 0, 0))  # H ≡ ±0.3: 0.1 from ±1/5, beyond its ±0.08
    assert detect_commensurate(flanks, (AX, AX, AX)) is not None
    assert detect_commensurate(flanks, (AX, AX, AX), declared=fifth) is None
    farther = _family(rng, 25, (0.35, 0, 0))  # two steps out: not a flank
    assert detect_commensurate(farther, (AX, AX, AX), declared=fifth) is not None


def test_the_log_line_says_none_of_the_words_arm_a_reads():
    """Arm A reads the run log for what it says of the faults it planted
    (validation/arm_a.py's _SAYS); the bunching line must not trip them."""
    from nebula3d.validation.arm_a import _SAYS

    found = Bunching(coordinate="H", equivalents=("K", "H+K"), period=1, denominator=3,
                     values=(("1/3", 4), ("2/3", 3)), hits=7, peaks=9, p0=0.13,
                     p_value=3.1e-6, alpha=ALPHA, tests=16, half_width=0.05,
                     centres=((1.35, 0.0, 0.0),))
    line = found.describe()
    assert line == (
        "sharp peaks off the lattice bunch at H ≡ ±1/3 (mod 1) (and the equivalent K, H+K): "
        "7 of 9 lie within 0.05 r.l.u. of it, where chance puts 1.2 (binomial tail 3.1e-06, "
        "under 0.00135 over 16 tests); no modulation is declared there, so the search "
        "punched them")
    for family, says in _SAYS.items():
        assert not says.search(line), family
    for denominator, values in ((2, (("1/2", 5),)), (7, (("2/7", 3), ("5/7", 2)))):
        other = dataclasses.replace(found, denominator=denominator, values=values,
                                    coordinate="L", equivalents=(), period=2,
                                    others=("L ≡ ±1/4 (mod 2)", "L ≡ ±2/9 (mod 2)"))
        assert "; the grid also fits L ≡ ±1/4 (mod 2), L ≡ ±2/9 (mod 2);" in other.describe()
        assert not any(says.search(other.describe()) for says in _SAYS.values())
