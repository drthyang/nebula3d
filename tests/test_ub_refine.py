"""Refining the UB from the Bragg peaks' centres (analysis.ub_refine).

Synthetic hexagonal crystals indexed with a UB that is off: by a rotation, by
the cell, or both.  The fits recover what was put in, the volume refinement
finds the displaced peaks and regridding puts them back on their nodes, and a
symmetrised volume refuses the orientation fit but still gives the cell.
"""

import numpy as np
import pytest
from scipy.spatial.transform import Rotation

from nebula3d.analysis.ub_refine import (
    SYMMETRISED,
    _commutant,
    _metric_basis,
    cell_parameters,
    fit_ub,
    measure_centres,
    refine_ub,
    regrid,
    symmetry_break,
)
from nebula3d.core import HKLVolume
from nebula3d.symmetry import GridSymmetry, _group_closure, parse_symmetry_ops

SIX_MMM = parse_symmetry_ops("h,k,l; h+k,-h,l; k,h,l; h,k,-l")


def _hex_ub(a: float, c: float) -> np.ndarray:
    """UB (2π included) of a hexagonal cell, a* along x."""
    astar = 4 * np.pi / (np.sqrt(3) * a)
    return np.array([[astar, astar / 2, 0.0],
                     [0.0, astar * np.sqrt(3) / 2, 0.0],
                     [0.0, 0.0, 2 * np.pi / c]])


UB = _hex_ub(4.0, 5.0)


def _rot(axis, deg: float) -> np.ndarray:
    axis = np.asarray(axis, float)
    return Rotation.from_rotvec(np.radians(deg) * axis / np.linalg.norm(axis)).as_matrix()


def _nodes(q_max: float, n: int = 6) -> np.ndarray:
    r = np.arange(-n, n + 1)
    g = np.array(np.meshgrid(r, r, r, indexing="ij")).reshape(3, -1).T
    q = np.linalg.norm(g @ UB.T, axis=1)
    return g[(q > 0) & (q <= q_max)]


def _centres(ub_true: np.ndarray, g: np.ndarray, noise: float = 0.0, seed: int = 0):
    """Where the peaks of nodes *g* of a crystal with *ub_true* sit in the HKL
    of UB, with Gaussian scatter (Å⁻¹) on top."""
    q = g @ ub_true.T + np.random.default_rng(seed).normal(0.0, noise, (len(g), 3))
    return q @ np.linalg.inv(UB).T


def _crystal(ub_true: np.ndarray, *, half: float = 4.0, step: float = 0.1,
             sigma_q: float = 0.15, seed: int = 1) -> HKLVolume:
    """A volume indexed with UB whose Bragg peaks sit at the nodes of *ub_true*:
    Gaussian peaks (height 500, σ in Q) on a flat background of 10 ± 0.5."""
    n = int(round(2 * half / step)) + 1
    vol = HKLVolume.from_arrays(np.zeros((n, n, n)), (-half, half), (-half, half),
                                (-half, half), ub_matrix=UB)
    vol.data[...] = 10.0 + np.random.default_rng(seed).normal(0.0, 0.5, vol.shape)
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    inv = np.linalg.inv(UB)
    r = np.arange(-int(half), int(half) + 1)
    for g in np.array(np.meshgrid(r, r, r, indexing="ij")).reshape(3, -1).T:
        if not g.any():
            continue
        c = inv @ ub_true @ g  # where the peak lands in the volume's HKL
        box = tuple(slice(max(0, int(np.searchsorted(ax, x)) - 4),
                          int(np.searchsorted(ax, x)) + 5) for ax, x in zip(axes, c))
        grids = np.meshgrid(*(ax[b] - x for ax, b, x in zip(axes, box, c)), indexing="ij")
        d = np.stack(grids, axis=-1) @ UB.T
        vol.data[box] += 500.0 * np.exp(-(d ** 2).sum(axis=-1) / (2 * sigma_q ** 2))
    vol.sigma[...] = np.sqrt(np.abs(vol.data))
    return vol


def _symmetrised(vol: HKLVolume) -> HKLVolume:
    sym = GridSymmetry.for_volume(vol, SIX_MMM)
    sym.orbit_mean(vol.data, vol.mask.copy())
    return vol


def _rms_from_nodes(vol: HKLVolume, **kw) -> float:
    c = measure_centres(vol, **kw)
    d = (c.hkl - c.nodes) @ np.asarray(vol.ub_matrix).T
    return float(np.sqrt(np.mean(np.sum(d ** 2, axis=1))))


def test_cell_parameters_of_a_hexagonal_ub():
    assert cell_parameters(UB) == pytest.approx((4.0, 4.0, 5.0, 90.0, 90.0, 120.0))


def test_metric_basis_counts_the_free_cell_parameters():
    identity = (np.eye(3, dtype=np.int64),)
    cubic = parse_symmetry_ops("h,k,l; k,l,h; -k,h,l; h,k,-l")
    assert len(_metric_basis(identity)) == 6
    assert len(_metric_basis(_group_closure(SIX_MMM))) == 2  # a and c
    assert len(_metric_basis(_group_closure(cubic))) == 1
    # What survives symmetrising: every change without operations; the scales of
    # the hk plane and of l under 6/mmm; one scale under m-3m.
    assert len(_commutant(identity)) == 9
    six = _commutant(_group_closure(SIX_MMM))
    assert len(six) == 2
    for d in six:
        assert np.allclose(d[:2, 2], 0) and np.allclose(d[2, :2], 0)
        assert np.allclose(d[:2, :2], d[0, 0] * np.eye(2))
    assert len(_commutant(_group_closure(cubic))) == 1


def test_the_symmetric_fit_without_operations_is_the_free_ub():
    g = _nodes(8.0)
    true = UB @ np.array([[1.003, 0.002, -0.001], [0.0, 0.998, 0.004], [0.001, 0.0, 1.002]])
    f = fit_ub(_centres(true, g), g, UB, fit="symmetric")
    assert np.allclose(f.ub, true, atol=1e-12)
    assert np.allclose(f.transform, np.linalg.inv(UB) @ true)


def test_fit_recovers_a_rotation():
    rot = _rot([1, 2, 3], 0.9)
    g = _nodes(8.0)
    f = fit_ub(_centres(rot @ UB, g, noise=0.005), g, UB)
    assert f.angle_deg == pytest.approx(0.9, abs=0.01)
    assert np.allclose(f.rotation, rot, atol=2e-4)
    assert f.cell == pytest.approx(f.cell_start)
    assert f.rms < 0.01 < f.rms_start
    # The axis as a real-space direction: Q-space [1 2 3] is UBᵀ·n/2π in the cell.
    n = np.array([1, 2, 3]) / np.linalg.norm([1, 2, 3])
    uvw = UB.T @ n
    assert np.allclose(f.axis_uvw, uvw / uvw[np.argmax(np.abs(uvw))], atol=0.02)


def test_fit_recovers_a_hexagonal_cell_and_keeps_the_orientation():
    g = _nodes(8.0)
    f = fit_ub(_centres(_hex_ub(4.04, 4.95), g, noise=0.003), g, UB,
               fit="lattice", ops=SIX_MMM)
    assert f.cell == pytest.approx((4.04, 4.04, 4.95, 90.0, 90.0, 120.0), abs=2e-3)
    assert f.angle_deg == pytest.approx(0.0, abs=1e-6)
    assert f.rms < 0.006 < f.rms_start


def test_fit_both_recovers_rotation_and_cell():
    rot = _rot([0, 1, 1], 1.2)
    g = _nodes(8.0)
    f = fit_ub(_centres(rot @ _hex_ub(4.04, 4.95), g, noise=0.003), g, UB,
               fit="both", ops=SIX_MMM)
    assert f.angle_deg == pytest.approx(1.2, abs=0.01)
    assert f.cell == pytest.approx((4.04, 4.04, 4.95, 90.0, 90.0, 120.0), abs=2e-3)
    assert np.allclose(f.ub, rot @ _hex_ub(4.04, 4.95), atol=1e-3)


def test_outliers_are_left_out():
    rot = _rot([1, 0, 0], 0.7)
    g = _nodes(8.0)
    centres = _centres(rot @ UB, g, noise=0.004)
    centres[:3] += 0.3  # three peaks taken for the wrong node
    f = fit_ub(centres, g, UB)
    assert not f.used[:3].any()
    assert f.n_rejected >= 3
    assert f.angle_deg == pytest.approx(0.7, abs=0.01)


def test_too_few_centres_is_an_error():
    g = _nodes(3.0)[:2]
    with pytest.raises(ValueError, match="needs at least 3"):
        fit_ub(_centres(UB, g), g, UB)
    with pytest.raises(ValueError, match="fit must be one of"):
        fit_ub(_centres(UB, _nodes(3.0)), _nodes(3.0), UB, fit="cell")


def test_regrid_onto_the_same_ub_changes_nothing():
    vol = _crystal(UB, half=2.0)
    vol.mask[:3] = False
    out = regrid(vol, vol.ub_matrix)
    assert np.array_equal(out.mask, vol.mask)
    assert np.allclose(out.data[out.mask], vol.data[vol.mask])


def test_refine_finds_a_misorientation_and_regridding_puts_the_peaks_back():
    rot = _rot([1, 2, 3], 1.5)
    vol = _crystal(rot @ UB)
    r = refine_ub(vol, fit="orientation")
    assert [p.q_max for p in r.passes] == pytest.approx(
        [r.passes[-1].q_max / 3, 2 * r.passes[-1].q_max / 3, r.passes[-1].q_max])
    assert r.passes[0].n_found < r.passes[-1].n_found
    assert r.fit.angle_deg == pytest.approx(1.5, abs=0.01)
    assert np.allclose(r.fit.rotation, rot, atol=2e-4)
    assert r.fit.rms < 0.005 < 0.1 < r.fit.rms_start

    before = _rms_from_nodes(vol)
    after = _rms_from_nodes(regrid(vol, r.fit.ub))
    assert after < 0.01 < 0.1 < before


def test_a_symmetrised_volume_hides_the_rotation_but_not_the_cell():
    rot = _rot([1, 2, 3], 0.5)
    raw = _crystal(rot @ _hex_ub(4.04, 4.95))
    assert symmetry_break(raw, SIX_MMM) > 1e-2
    sym = _symmetrised(_crystal(rot @ _hex_ub(4.04, 4.95)))
    assert symmetry_break(sym, SIX_MMM) < SYMMETRISED

    for fit in ("orientation", "lattice", "both"):
        with pytest.raises(ValueError, match="symmetrised under the 24 operations"):
            refine_ub(sym, fit=fit, ops=SIX_MMM)
    r = refine_ub(sym, fit="symmetric", ops=SIX_MMM)
    assert r.symmetry_break is not None and r.symmetry_break < SYMMETRISED
    assert r.fit.cell == pytest.approx((4.04, 4.04, 4.95, 90.0, 90.0, 120.0), abs=1e-3)
    # The peaks sit at h·4/4.04, k·4/4.04, l·5/4.95 in the volume's HKL.
    assert np.allclose(r.fit.transform, np.diag([4 / 4.04, 4 / 4.04, 5 / 4.95]), atol=2e-4)


def test_peaks_between_voxels_are_centred_without_exaggerating_their_offset():
    """With the cell 1 % off, the peaks drift steadily off the voxels the nodes
    sit on; a centroid of the voxels above half height put them a third
    farther off still, which the fit took for a cell 1.3 % off."""
    true = _hex_ub(4.04, 4.95)
    c = measure_centres(_crystal(true))
    truth = c.nodes @ (np.linalg.inv(UB) @ true).T
    assert len(c.nodes) > 300
    assert np.abs(c.hkl - truth).max() < 2e-3  # r.l.u.; the grid step is 0.1
