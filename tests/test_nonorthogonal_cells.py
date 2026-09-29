"""Non-orthogonal cells: the Mantid projection guard, metric-correct stages, and
the ΔPDF's real-space geometry.

nebula3d works on the crystal's own H, K, L grid and carries the cell metric in
the UB matrix, so a hexagonal (γ = 120°) or monoclinic (β ≠ 90°) volume needs no
special handling — provided every stage computes |Q| and in-plane angles through
UB instead of assuming a*, b*, c* are orthogonal.  These tests pin that, and the
loader contract that rejects projected (non-H/K/L) Mantid grids rather than
loading them with silently wrong |Q|.

The 3D-ΔPDF stays on the FFT's native grid, indexed along a, b, c (oblique for
these cells); its true distances and the real angle each section is drawn at
come from the cell angles (``real_space_radius`` / ``section_geometry``).
"""

import h5py
import numpy as np
import pytest

from nebula3d.analysis.delta_pdf import (
    compute_delta_pdf,
    real_space_radius,
    section_geometry,
)
from nebula3d.core import HKLVolume, q_magnitude_from_axes
from nebula3d.io.mantid_nxs import load_mantid_nxs
from nebula3d.pipeline import (
    DeltaPdfParams,
    RingParams,
    consistency_reconstruction,
    remove_rings,
    write_delta_pdf_h5,
)
from nebula3d.utils import direct_cell, ub_from_lattice
from nebula3d.visualization.slices import extract_slice_dpdf, read_cell_attrs

CELLS = {
    "hexagonal": (8.0, 8.0, 10.0, 90.0, 90.0, 120.0),
    "monoclinic": (8.0, 9.0, 10.0, 90.0, 110.0, 90.0),
}


def _ub_from_cell(a, b, c, alpha, beta, gamma, rot_seed=3):
    """Physics-convention UB (columns a*, b*, c*; Q = 2π/d) in a random orientation."""
    al, be, ga = np.radians([alpha, beta, gamma])
    cx = c * np.cos(be)
    cy = c * (np.cos(al) - np.cos(be) * np.cos(ga)) / np.sin(ga)
    direct = np.column_stack([
        [a, 0.0, 0.0],
        [b * np.cos(ga), b * np.sin(ga), 0.0],
        [cx, cy, np.sqrt(c * c - cx * cx - cy * cy)],
    ])
    rot, _ = np.linalg.qr(np.random.default_rng(rot_seed).standard_normal((3, 3)))
    return rot @ (2 * np.pi * np.linalg.inv(direct).T)


def _grid_volume(ub, h, k, l_):
    shape = (h.size, k.size, l_.size)
    return HKLVolume(data=np.zeros(shape), sigma=np.ones(shape),
                     mask=np.ones(shape, dtype=bool),
                     h_axis=h, k_axis=k, l_axis=l_, ub_matrix=ub)


# ---------------------------------------------------------------------------
# loader: Mantid projection guard
# ---------------------------------------------------------------------------
_CORELLI_LABELS = ("[0,K,0]", "[0,0,L]", "[H,0,0]")      # D0, D1, D2 as MDNorm wrote them
_CORELLI_W = np.array([[0, 0, 1], [1, 0, 0], [0, 1, 0]])  # columns = D0, D1, D2 directions


def _write_mdhisto(path, labels, *, w_matrix=None, orientation=None, n=(5, 6, 4)):
    """Minimal MDHistoWorkspace: D0..D2 with the given long_names, n = (n_D0, n_D1, n_D2).

    Returns the file-order signal and each dim's bin centres.
    """
    signal = np.arange(n[2] * n[1] * n[0], dtype=np.float64).reshape(n[2], n[1], n[0])
    centres = []
    with h5py.File(path, "w") as f:
        root = f.create_group("MDHistoWorkspace")
        data = root.create_group("data")
        for i, (label, size) in enumerate(zip(labels, n)):
            edges = np.linspace(-i - 1.0, i + 1.0, size + 1)
            ds = data.create_dataset(f"D{i}", data=edges)
            ds.attrs["long_name"] = label
            centres.append((edges[:-1] + edges[1:]) / 2)
        data.create_dataset("signal", data=signal)
        data.create_dataset("errors_squared", data=np.ones_like(signal))
        data.create_dataset("mask", data=np.zeros(signal.shape, dtype=np.int8))
        if orientation is not None:
            root.create_dataset("experiment0/sample/oriented_lattice/orientation_matrix",
                                data=orientation)
        if w_matrix is not None:
            root.create_dataset("experiment0/logs/W_MATRIX/value",
                                data=np.asarray(w_matrix, dtype=np.float64).ravel())
    return signal, centres


@pytest.mark.parametrize("with_w", [True, False])
def test_loader_maps_permuted_axes_and_keeps_hexagonal_metric(tmp_path, with_w):
    ub = _ub_from_cell(*CELLS["hexagonal"])
    path = tmp_path / "hex.nxs"
    signal, (d0, d1, d2) = _write_mdhisto(
        path, _CORELLI_LABELS, orientation=ub / (2 * np.pi),
        w_matrix=_CORELLI_W if with_w else None)

    vol = load_mantid_nxs(path)

    # signal is (n_D2, n_D1, n_D0) = (H, L, K) → canonical (H, K, L)
    assert np.array_equal(vol.data, signal.transpose(0, 2, 1))
    assert np.array_equal(vol.h_axis, d2)
    assert np.array_equal(vol.k_axis, d0)
    assert np.array_equal(vol.l_axis, d1)
    np.testing.assert_allclose(vol.ub_matrix, ub, rtol=1e-12)

    # γ* = 60°: |a* − b*| = |a*| and |a* + b*| = √3·|a*| — the file's metric, not
    # an orthogonalised one, reaches |Q|.
    a_star = np.linalg.norm(ub[:, 0])
    one = np.array([1.0])
    q_minus = q_magnitude_from_axes(one, -one, np.zeros(1), vol.ub_matrix).item()
    q_plus = q_magnitude_from_axes(one, one, np.zeros(1), vol.ub_matrix).item()
    assert q_minus == pytest.approx(a_star, rel=1e-12)
    assert q_plus == pytest.approx(np.sqrt(3) * a_star, rel=1e-12)


@pytest.mark.parametrize(("labels", "match"), [
    (("[H,0,0]", "[-K,2K,0]", "[0,0,L]"), "Rebin in Mantid"),  # orthogonal hexagonal cut
    (("[H,H,0]", "[H,-H,0]", "[0,0,L]"), "Rebin in Mantid"),   # MDNorm diagonal pair
    (("[-H,0,0]", "[0,K,0]", "[0,0,L]"), "Rebin in Mantid"),   # reversed axis
    (("[2H,0,0]", "[0,K,0]", "[0,0,L]"), "Rebin in Mantid"),   # rescaled axis
    (("[H,0,0]", "[H,0,0]", "[0,0,L]"), "do not span"),
    (("[H,0,0]", "[0,K,0]", "Qx"), "Cannot identify"),
])
def test_loader_rejects_grids_not_on_plain_hkl_axes(tmp_path, labels, match):
    path = tmp_path / "projected.nxs"
    _write_mdhisto(path, labels)
    with pytest.raises(ValueError, match=match):
        load_mantid_nxs(path)


def test_loader_rejects_labels_that_contradict_w_matrix(tmp_path):
    path = tmp_path / "stale_labels.nxs"
    _write_mdhisto(path, ("[H,0,0]", "[0,K,0]", "[0,0,L]"),
                   w_matrix=np.array([[1, 1, 0], [0, 2, 0], [0, 0, 1]]))
    with pytest.raises(ValueError, match="W_MATRIX"):
        load_mantid_nxs(path)


# ---------------------------------------------------------------------------
# stages: metric-correct on hexagonal and monoclinic cells
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("slice_axis", ["H", "L"])
@pytest.mark.parametrize("cell", sorted(CELLS))
def test_ring_removal_on_non_orthogonal_cell(cell, slice_axis):
    """A powder ring (isotropic in Cartesian |Q|) is removed as well as on an
    orthogonal cell.  Each per-plane fit needs the true 3-D |Q|: with the metric
    orthogonalised (UB → diag of column norms) the ring is left at ~80–90 % of
    its height."""
    ub = _ub_from_cell(*CELLS[cell])
    vol = _grid_volume(ub, np.linspace(-2, 2, 41), np.linspace(-2, 2, 41),
                       np.linspace(-3, 3, 61))
    H, K, L = vol.hkl_grid()
    q = np.linalg.norm(np.stack([H, K, L], axis=-1) @ ub.T, axis=-1)  # independent of nebula3d
    q0, sigma_q = 1.2, 0.034
    diffuse = 1.0 + 0.2 * np.cos(np.pi * H) * np.cos(np.pi * K) * np.cos(np.pi * L)
    ring = 3.0 * np.exp(-0.5 * ((q - q0) / sigma_q) ** 2)
    vol.data = diffuse + ring + np.random.default_rng(0).normal(0.0, 0.02, q.shape)

    out = remove_rings(vol, RingParams(
        ring_model="parametric", slice_axis=slice_axis, q_min=0.5, q_max=1.9,
        confirm_rings=False))

    off_ring = (np.abs(q - q0) > 0.25) & (q > 0.6) & (q < 1.9)
    on_ring = np.abs(q - q0) < 0.03
    base = float(np.median(vol.data[off_ring]))
    before = float(np.median(vol.data[on_ring])) - base
    after = float(np.median(out.data[on_ring])) - base
    assert before > 2.5
    assert after < 0.25 * before
    assert np.median(np.abs(out.data - vol.data)[off_ring]) < 0.05


@pytest.mark.parametrize(("cell", "frac"), [
    ("hexagonal", (1, 1, 0)),
    ("hexagonal", (1, -1, 0)),
    ("monoclinic", (1, 0, 1)),
])
def test_delta_pdf_peak_sits_at_fractional_position(cell, frac):
    """cos 2π(h·u + k·v + l·w) transforms to a pair of peaks at ±(u, v, w) in
    fractional direct-lattice coordinates on any cell: the HKL↔uvw FFT pairing
    is metric-free, so the ΔPDF grid is indexed along a, b, c."""
    ub = _ub_from_cell(*CELLS[cell])
    axis = np.linspace(-3, 3, 61)
    vol = _grid_volume(ub, axis, axis.copy(), axis.copy())
    H, K, L = vol.hkl_grid()
    vol.data = np.cos(2 * np.pi * (frac[0] * H + frac[1] * K + frac[2] * L))

    dpdf = compute_delta_pdf(vol, apodization="gaussian", gaussian_sigma=0.4)

    lengths = np.linalg.norm(2 * np.pi * np.linalg.inv(ub).T, axis=0)  # |a|, |b|, |c|
    frac_axes = [ax / n for ax, n in zip((dpdf.x_axis, dpdf.y_axis, dpdf.z_axis), lengths)]
    peak = np.array([ax[i] for ax, i in
                     zip(frac_axes, np.unravel_index(np.argmax(dpdf.data), dpdf.data.shape))])
    step = max(float(ax[1] - ax[0]) for ax in frac_axes)
    target = np.asarray(frac, dtype=float)
    assert min(np.abs(peak - target).max(), np.abs(peak + target).max()) <= step


# ---------------------------------------------------------------------------
# ΔPDF real-space geometry
# ---------------------------------------------------------------------------
TRICLINIC = (4.5, 5.0, 6.0, 75.0, 100.0, 115.0)
ALL_CELLS = [(6.0, 7.0, 8.0, 90.0, 90.0, 90.0), *CELLS.values(), TRICLINIC]


def _unit_axes(ub):
    """Unit direct-axis vectors â, b̂, ĉ (columns), straight from the UB."""
    direct = 2 * np.pi * np.linalg.inv(ub).T
    return direct / np.linalg.norm(direct, axis=0)


@pytest.mark.parametrize("cell", ALL_CELLS)
def test_ub_from_lattice_round_trips_through_direct_cell(cell):
    ub = ub_from_lattice(*cell)
    assert np.allclose(ub[1:, 0], 0.0) and abs(ub[2, 1]) < 1e-12  # Busing–Levy frame
    np.testing.assert_allclose(direct_cell(ub), cell, rtol=1e-12)
    rot = np.linalg.qr(np.random.default_rng(1).standard_normal((3, 3)))[0]
    np.testing.assert_allclose(direct_cell(rot @ ub), cell, rtol=1e-12)  # U drops out


@pytest.mark.parametrize("cell", ALL_CELLS)
def test_real_space_radius_is_the_true_distance(cell):
    ub = _ub_from_cell(*cell)
    xyz = np.random.default_rng(2).normal(0.0, 6.0, (500, 3))  # oblique coords, Å
    true = np.linalg.norm(xyz @ _unit_axes(ub).T, axis=1)
    got = real_space_radius(xyz[:, 0], xyz[:, 1], xyz[:, 2], direct_cell(ub)[3:])
    np.testing.assert_allclose(got, true, rtol=1e-12)


def test_real_space_radius_is_bit_identical_for_right_angles():
    ax = np.linspace(-9.0, 9.0, 11)
    got = real_space_radius(ax[:, None, None], ax[None, :, None], ax[None, None, :])
    assert np.array_equal(got, np.sqrt(ax[:, None, None] ** 2 + ax[None, :, None] ** 2
                                       + ax[None, None, :] ** 2))


@pytest.mark.parametrize("cell", ALL_CELLS)
@pytest.mark.parametrize(("horizontal", "vertical"), [("x", "y"), ("x", "z"), ("y", "z"),
                                                      ("z", "x")])
def test_section_geometry_places_true_distances(cell, horizontal, vertical):
    """A point drawn at (X, Y) = (h + v·cos θ, v·sin θ) on the section at `cut`
    along the third axis satisfies |r|² = (X − cx)² + (Y − cy)² + d²."""
    ub = _ub_from_cell(*cell)
    units = dict(zip("xyz", _unit_axes(ub).T))
    fixed = next(a for a in "xyz" if a not in (horizontal, vertical))
    rng = np.random.default_rng(3)
    for cut in (-4.2, 0.0, 3.1):
        angle, (cx, cy), perp = section_geometry(direct_cell(ub)[3:], horizontal,
                                                 vertical, cut)
        assert angle == pytest.approx(np.degrees(np.arccos(
            units[horizontal] @ units[vertical])), abs=1e-9)
        h, v = rng.normal(0.0, 6.0, (2, 200))
        t = np.radians(angle)
        X, Y = h + v * np.cos(t), v * np.sin(t)
        true = np.linalg.norm(np.outer(h, units[horizontal]) + np.outer(v, units[vertical])
                              + cut * units[fixed], axis=1)
        np.testing.assert_allclose(np.sqrt((X - cx) ** 2 + (Y - cy) ** 2 + perp**2),
                                   true, rtol=1e-12)


def _hex_dpdf(frac=(1, 1, 0)):
    """ΔPDF of cos 2π(h·u + k·v + l·w) on the hexagonal cell (a = b = 8 Å)."""
    ub = _ub_from_cell(*CELLS["hexagonal"])
    axis = np.linspace(-3, 3, 61)
    vol = _grid_volume(ub, axis, axis.copy(), axis.copy())
    H, K, L = vol.hkl_grid()
    vol.data = np.cos(2 * np.pi * (frac[0] * H + frac[1] * K + frac[2] * L))
    return vol, compute_delta_pdf(vol, apodization="gaussian", gaussian_sigma=0.4)


def test_delta_pdf_knows_its_cell_and_true_peak_distance():
    """The (1,1,0) peak sits at oblique (8, 8) Å, which is |a + b| = 8 Å away on a
    120° cell — not the 11.3 Å a right angle would give."""
    _, dpdf = _hex_dpdf()
    assert dpdf.cell_angles == pytest.approx((90.0, 90.0, 120.0))
    ix, iy, iz = np.unravel_index(np.argmax(dpdf.data), dpdf.data.shape)
    r = float(real_space_radius(dpdf.x_axis[ix], dpdf.y_axis[iy], dpdf.z_axis[iz],
                                dpdf.cell_angles))
    step = float(dpdf.x_axis[1] - dpdf.x_axis[0])
    assert abs(r - 8.0) <= step


def test_extract_slice_dpdf_carries_each_sections_angle():
    _, dpdf = _hex_dpdf()
    xy = extract_slice_dpdf(dpdf, plane="xy", value=0.0)
    assert xy.axes_angle == pytest.approx(120.0)
    assert xy.r_center == pytest.approx((0.0, 0.0)) and xy.r_perp == pytest.approx(0.0)
    assert extract_slice_dpdf(dpdf, plane="xz", value=0.0).axes_angle == 90.0
    assert extract_slice_dpdf(dpdf, plane="zy", value=2.0).axes_angle == 90.0


def test_delta_pdf_file_stores_the_cell_and_reads_back(tmp_path):
    vol, dpdf = _hex_dpdf()
    path = tmp_path / "hex_delta_pdf.h5"
    write_delta_pdf_h5(dpdf, vol, DeltaPdfParams(), source_name="synthetic", out_path=path)
    with h5py.File(path, "r") as fh:
        assert read_cell_attrs(fh.attrs) == pytest.approx((8.0, 8.0, 10.0, 90.0, 90.0, 120.0))
    # files written before the angles were stored read as 90°
    assert read_cell_attrs({"lat_a": 4.0, "lat_b": 5.0, "lat_c": 6.0}) == (
        4.0, 5.0, 6.0, 90.0, 90.0, 90.0)
    assert read_cell_attrs({}) is None


def test_consistency_r_band_selects_by_true_distance():
    """An r band of 7–9 Å keeps the hexagonal a + b pair (|r| = 8 Å), which a
    right-angle radius (11.3 Å) would have zeroed; r_data_max is the farthest
    true corner distance."""
    vol, full = _hex_dpdf()
    res = consistency_reconstruction(vol, DeltaPdfParams(), r_band=(7.0, 9.0))
    dpdf = res["dpdf"]
    ix, iy, iz = np.unravel_index(np.argmax(full.data), full.data.shape)
    assert dpdf.data[ix, iy, iz] == full.data[ix, iy, iz]
    kept = np.argwhere(dpdf.data != 0)
    r = real_space_radius(dpdf.x_axis[kept[:, 0]], dpdf.y_axis[kept[:, 1]],
                          dpdf.z_axis[kept[:, 2]], dpdf.cell_angles)
    assert r.min() >= 7.0 and r.max() <= 9.0
    corners = np.array([[x, y, z] for x in dpdf.x_axis[[0, -1]]
                        for y in dpdf.y_axis[[0, -1]] for z in dpdf.z_axis[[0, -1]]])
    true_max = np.linalg.norm(corners @ _unit_axes(vol.ub_matrix).T, axis=1).max()
    assert res["metrics"]["r_data_max"] == pytest.approx(true_max, rel=1e-12)
