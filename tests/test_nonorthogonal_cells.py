"""Non-orthogonal cells: the Mantid projection guard and metric-correct stages.

nebula3d works on the crystal's own H, K, L grid and carries the cell metric in
the UB matrix, so a hexagonal (γ = 120°) or monoclinic (β ≠ 90°) volume needs no
special handling — provided every stage computes |Q| and in-plane angles through
UB instead of assuming a*, b*, c* are orthogonal.  These tests pin that, and the
loader contract that rejects projected (non-H/K/L) Mantid grids rather than
loading them with silently wrong |Q|.
"""

import h5py
import numpy as np
import pytest

from nebula3d.analysis.delta_pdf import compute_delta_pdf
from nebula3d.core import HKLVolume, q_magnitude_from_axes
from nebula3d.io.mantid_nxs import load_mantid_nxs
from nebula3d.pipeline import RingParams, remove_rings

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
    (("[H,0,0]", "[K,2K,0]", "[0,0,L]"), "Rebin in Mantid"),   # orthogonal hexagonal cut
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
