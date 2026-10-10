"""Phase 3 — the covariance fit: a tilted punch ellipsoid fitted in Q.

With ``integer_optimize_shape`` the integer-node fit returns a full 3×3 HKL
shape matrix following the peak's measured orientation.  The covariance is taken
in Q, from a window sized in Å⁻¹, corrected for the core cut, and the ellipsoid
always contains the resolution ellipsoid of the active punch frame.  The
diagonal H/K/L-radii fit it replaced is gone.  The φ-tail folds in as a rank-1
tangential inflation.
"""

import numpy as np
import pytest

from nebula3d.analysis.bragg import (
    BraggRemover,
    _clip_ellipsoid,
    _core_variance_fraction,
)
from nebula3d.core import HKLVolume
from nebula3d.pipeline import PunchParams, punch_bragg

UB_DIAG = np.diag([1.07979, 0.60344, 0.25464])  # representative |a*|,|b*|,|c*|

def _extent(shape_matrix, u):
    """Half-extent of δᵀAδ ≤ 1 along unit vector u: sqrt(uᵀ A⁻¹ u)."""
    u = np.asarray(u, float)
    u = u / np.linalg.norm(u)
    return float(np.sqrt(u @ np.linalg.inv(shape_matrix) @ u))


def test_fold_phi_tail_inflates_tangent_only():
    """Folding the φ-tail grows the half-extent along the local ring tangent by
    ≈ φ and leaves the orthogonal extents unchanged (a rank-1 modification)."""
    vol = HKLVolume.from_arrays(np.zeros((11, 11, 11)), (-1, 1), (-1, 1), (-1, 1),
                                ub_matrix=UB_DIAG)
    rem = BraggRemover()
    a = np.diag([1 / 0.10**2, 1 / 0.10**2, 1 / 0.10**2])  # isotropic r = 0.10
    # at hkl = (0, 1, 0) the K-L ring tangent is the L direction (diagonal metric)
    phi = 0.06
    a2 = rem._fold_phi_tail(vol, a, (0.0, 1.0, 0.0), phi)

    assert _extent(a2, (0, 0, 1)) == pytest.approx(0.10 + phi, abs=1e-6)  # tangent +φ
    assert _extent(a2, (0, 1, 0)) == pytest.approx(0.10, abs=1e-6)        # radial same
    assert _extent(a2, (1, 0, 0)) == pytest.approx(0.10, abs=1e-6)        # H same


# --------------------------------------------------------------------------- #
# integration through the fit / punch
# --------------------------------------------------------------------------- #

def _gaussian_peak_vol(cov, center=(1.0, 0.0, 0.0), amp=100.0):
    """Flat background with one anisotropic Gaussian Bragg peak."""
    shape = (41, 41, 41)
    h = np.linspace(0.0, 2.0, shape[0])
    k = np.linspace(-1.0, 1.0, shape[1])
    l = np.linspace(-1.0, 1.0, shape[2])
    H, K, L = np.meshgrid(h, k, l, indexing="ij")
    d = np.stack([H - center[0], K - center[1], L - center[2]], axis=-1)
    quad = np.einsum("...i,ij,...j->...", d, np.linalg.inv(cov), d)
    data = 0.5 + amp * np.exp(-0.5 * quad)
    return HKLVolume.from_arrays(data, (0.0, 2.0), (-1.0, 1.0), (-1.0, 1.0),
                                 ub_matrix=UB_DIAG)


def _cov_remover(**kw):
    base = dict(
        mode="integer", min_intensity=10.0, min_prominence=0.5,
        punch_incident_beam=False, intensity_scale=False, margin=0.0,
        phi_tail_hkl=0.0, detect_window_hkl=0.4,
        integer_optimize_position=True, integer_optimize_shape=True,
        punch_frame="q",  # a tiny base: the fit floor never binds
        punch_q_radii=tuple(0.01 * np.linalg.norm(UB_DIAG, axis=0)),
        integer_fit_max_radius_hkl=(2.0, 2.0, 2.0),
    )
    base.update(kw)
    return BraggRemover(**base)


def test_diagonal_fit_is_gone():
    with pytest.raises(TypeError):
        BraggRemover(integer_fit_covariance=False)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        PunchParams(integer_fit_covariance=False)  # type: ignore[call-arg]


def test_covariance_fit_records_a_shape_matrix():
    """The integer shape fit yields a 3×3 shape matrix."""
    cov = np.diag([0.06**2, 0.06**2, 0.06**2])
    vol = _gaussian_peak_vol(cov)
    rec = next(r for r in _cov_remover()._detect_peak_records(vol)
               if abs(r.center_hkl[0] - 1.0) < 0.2)
    assert rec.shape_hkl is not None and rec.shape_hkl.shape == (3, 3)


def test_position_only_fit_moves_the_centre_and_keeps_the_frame_punch():
    """Without the shape fit, the core's centroid is still the punch centre,
    and the punch is the punch-frame ellipsoid."""
    cov = np.diag([0.06**2, 0.06**2, 0.06**2])
    vol = _gaussian_peak_vol(cov, center=(1.013, 0.0, 0.0))
    rec = next(r for r in _cov_remover(integer_optimize_shape=False)
               ._detect_peak_records(vol) if abs(r.center_hkl[0] - 1.0) < 0.2)
    assert rec.shape_hkl is None
    assert rec.center_hkl[0] == pytest.approx(1.013, abs=0.005)


def test_covariance_punch_follows_tilted_peak():
    """A peak elongated along the K=L diagonal is punched further along (0,1,1)
    than along the orthogonal (0,1,-1) — the tilt the diagonal fit cannot see."""
    # long axis = rot[:,1] = (0, 1, 1)/√2 (put the large variance on that axis)
    c, s = np.cos(np.pi / 4), np.sin(np.pi / 4)
    rot = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    cov = rot @ np.diag([0.05**2, 0.18**2, 0.05**2]) @ rot.T
    vol = _gaussian_peak_vol(cov)
    keep = _cov_remover().build_mask(vol)
    punched = ~keep

    ih = int(np.argmin(np.abs(vol.h_axis - 1.0)))

    def _ray(dk, dl):
        n = 0
        for t in np.arange(-0.6, 0.6, 0.02):
            ik = int(np.argmin(np.abs(vol.k_axis - t * dk)))
            il = int(np.argmin(np.abs(vol.l_axis - t * dl)))
            n += int(punched[ih, ik, il])
        return n

    c2, s2 = 1 / np.sqrt(2), 1 / np.sqrt(2)
    assert _ray(c2, s2) > _ray(c2, -s2)   # long diagonal punched further


def test_q_mode_is_adaptive_not_fixed():
    """Q-mode with the per-peak fit on enlarges a broad peak beyond the fixed Q
    resolution floor — i.e. it modulates the Q base, it is not a fixed shape.
    (Phase-4 integration: Q-mode now carries the adaptive coverage.)"""
    cov = np.diag([0.16**2, 0.10**2, 0.10**2])  # broad along H
    vol = _gaussian_peak_vol(cov)
    qr = dict(mode="integer", min_intensity=10.0, min_prominence=0.5,
              punch_incident_beam=False, intensity_scale=False, margin=0.0,
              phi_tail_hkl=0.0, integer_optimize_position=True,
              punch_frame="q", punch_q_radii=(0.05, 0.05, 0.05))
    fixed = BraggRemover(integer_optimize_shape=False, **qr).build_mask(vol)
    fitted = BraggRemover(integer_optimize_shape=True, **qr).build_mask(vol)
    assert int((~fitted).sum()) > int((~fixed).sum())  # fit grows beyond the floor


# --------------------------------------------------------------------------- #
# The fit in Q: cut correction, floor/ceiling, tilt, window, isolation
# --------------------------------------------------------------------------- #

def _rand_spd(rng, scale=1.0):
    x = rng.normal(size=(3, 3))
    return scale * (x @ x.T + 0.3 * np.eye(3))


def _angle_deg(u, v):
    return float(np.degrees(np.arccos(min(1.0, abs(float(u @ v))))))


def test_core_variance_fraction_matches_a_sampled_gaussian():
    """κ(frac) is the excess-weighted second moment of the cut core of a 3-D
    Gaussian (σ = 1), so dividing by it recovers σ²."""
    x = np.linspace(-6, 6, 241)
    X, Y, Z = np.meshgrid(x, x, x, indexing="ij")
    g = np.exp(-0.5 * (X**2 + Y**2 + Z**2))
    for frac in (0.2, 0.35, 0.6):
        w = np.where(g >= frac, g, 0.0)
        sampled = float((w * X**2).sum() / w.sum())
        assert _core_variance_fraction(frac) == pytest.approx(sampled, rel=0.01)
    assert _core_variance_fraction(0.35) == pytest.approx(0.3679, abs=1e-4)
    assert _core_variance_fraction(0.0) == 1.0
    assert _core_variance_fraction(1.0) == 1.0


def test_clip_ellipsoid_floor_contains_both_and_ceiling_lies_inside_both():
    rng = np.random.default_rng(3)
    for _ in range(20):
        m, ref = _rand_spd(rng), _rand_spd(rng)
        lo = _clip_ellipsoid(m, ref, upper=False)
        hi = _clip_ellipsoid(m, ref, upper=True)
        for big, small in ((lo, ref), (lo, m), (ref, hi), (m, hi)):
            assert np.linalg.eigvalsh(big - small).min() > -1e-9
    m, ref = _rand_spd(rng), _rand_spd(rng)
    grown = ref + m  # already contains ref → a floor leaves it alone
    np.testing.assert_allclose(_clip_ellipsoid(grown, ref, upper=False), grown,
                               rtol=1e-9, atol=1e-12)


def test_clip_ellipsoid_is_the_same_in_any_linear_frame():
    """Clipping in HKL and in Q (``x_Q = UB·x_hkl``) gives the same ellipsoid."""
    rng = np.random.default_rng(4)
    t = rng.normal(size=(3, 3)) + 2 * np.eye(3)
    m, ref = _rand_spd(rng), _rand_spd(rng)
    for upper in (False, True):
        direct = _clip_ellipsoid(t @ m @ t.T, t @ ref @ t.T, upper=upper)
        mapped = t @ _clip_ellipsoid(m, ref, upper=upper) @ t.T
        np.testing.assert_allclose(direct, mapped, rtol=1e-8, atol=1e-12)


def _q_peak_vol(peaks, l_half=0.6, noise=0.0, seed=0):
    """Fine grid about node (1, 0, 0) on the anisotropic UB_DIAG metric, with
    Gaussian peaks given in Q: ``peaks = [(center_hkl, cov_q, amp), ...]``."""
    nl = int(round(2 * l_half / 0.02)) + 1
    shape = (61, 61, nl)
    vol = HKLVolume.from_arrays(np.zeros(shape), (0.7, 1.3), (-0.3, 0.3),
                                (-l_half, l_half), ub_matrix=UB_DIAG)
    H, K, L = vol.hkl_grid()
    hkl = np.stack([H, K, L], axis=-1)
    data = 0.5 + noise * np.random.default_rng(seed).standard_normal(shape)
    for center, cov_q, amp in peaks:
        dq = (hkl - np.asarray(center, float)) @ UB_DIAG.T
        quad = np.einsum("...i,ij,...j->...", dq, np.linalg.inv(cov_q), dq)
        data = data + amp * np.exp(-0.5 * quad)
    vol.data[...] = data
    return vol


def _fit_remover(**kw):
    base = dict(mode="integer", min_intensity=10.0, min_prominence=0.5,
                punch_incident_beam=False, intensity_scale=False, margin=0.0,
                integer_optimize_position=True, integer_optimize_shape=True)
    base.update(kw)
    return BraggRemover(**base)


def _node_record(rem, vol):
    return next(r for r in rem._detect_peak_records(vol)
                if r.source_node_hkl == (1, 0, 0))


def _q_cov_of(vol, cov_hkl):
    return UB_DIAG @ cov_hkl @ UB_DIAG.T


def test_measured_covariance_is_the_peaks_own_not_the_cut_cores():
    """The 35 % core of a Gaussian has 0.61× its width; the fit reports σ."""
    sigma_q = 0.03
    vol = _q_peak_vol([((1.0, 0.0, 0.0), sigma_q**2 * np.eye(3), 100.0)])
    cov = _fit_remover().measure_peak_covariance(vol, (1.0, 0.0, 0.0))
    widths = np.sqrt(np.linalg.eigvalsh(_q_cov_of(vol, cov)))
    np.testing.assert_allclose(widths, sigma_q, rtol=0.05)


def _tilted_cov_q(major, sig=(0.06, 0.02, 0.02)):
    u = np.asarray(major, float) / np.linalg.norm(major)
    v = np.cross(u, [0.0, 0.0, 1.0])
    v /= np.linalg.norm(v)
    w = np.cross(u, v)
    r = np.column_stack([u, v, w])
    return u, r @ np.diag(np.square(sig)) @ r.T


def test_fit_follows_a_tilt_in_q_on_an_anisotropic_metric():
    """A peak whose long axis is (1, 1, 1) in Q — 55° from every axis — is
    punched along that axis.  |a*|:|c*| ≈ 4 here, so the HKL eigenvector of the
    same covariance points elsewhere: the axes must be taken in Q."""
    u, cov_q = _tilted_cov_q((1.0, 1.0, 1.0))
    vol = _q_peak_vol([((1.0, 0.0, 0.0), cov_q, 100.0)])
    rem = _fit_remover(integer_fit_unconstrained=True)
    rec = _node_record(rem, vol)
    assert rec.shape_hkl is not None
    ub_inv = np.linalg.inv(UB_DIAG)
    lam, vecs = np.linalg.eigh(ub_inv.T @ rec.shape_hkl @ ub_inv)  # A in Q
    assert _angle_deg(vecs[:, 0], u) < 3.0  # longest punch axis = peak's

    cov_hkl = rem.measure_peak_covariance(vol, rec.center_hkl)
    v_hkl = np.linalg.eigh(cov_hkl)[1][:, -1]
    q_dir = UB_DIAG @ v_hkl
    assert _angle_deg(q_dir / np.linalg.norm(q_dir), u) > 5.0  # ~7° here


def test_wider_peak_contains_the_floor_and_reaches_its_own_extent():
    """With the resolution floor on, the punch contains the spherical-frame
    ellipsoid and still reaches 2.5σ (+ half a voxel) along the peak's axis."""
    u, cov_q = _tilted_cov_q((1.0, 1.0, 1.0), sig=(0.08, 0.02, 0.02))
    vol = _q_peak_vol([((1.0, 0.0, 0.0), cov_q, 100.0)])
    rem = _fit_remover()
    rec = _node_record(rem, vol)
    floor = np.linalg.inv(rem._spherical_shape_matrix(vol, rec.center_hkl))
    punch = np.linalg.inv(rec.shape_hkl)
    assert np.linalg.eigvalsh(punch - floor).min() > -1e-12  # contains the floor
    m_q = UB_DIAG @ punch @ UB_DIAG.T
    assert float(np.sqrt(u @ m_q @ u)) >= 2.5 * 0.08 * 0.95


def test_resolution_limited_peak_gets_exactly_the_resolution_ellipsoid():
    vol = _q_peak_vol([((1.0, 0.0, 0.0), 0.012**2 * np.eye(3), 100.0)])
    rem = _fit_remover()
    rec = _node_record(rem, vol)
    np.testing.assert_allclose(
        rec.shape_hkl, rem._spherical_shape_matrix(vol, rec.center_hkl),
        rtol=1e-9, atol=1e-9)


def test_fit_window_is_sized_in_q_not_rlu():
    """A peak 0.2 r.l.u. wide along c* (|c*| = 0.25 Å⁻¹) is measured in full,
    where the ±0.2 r.l.u. detection window would truncate it."""
    cov_q = np.diag([0.02**2, 0.02**2, 0.05**2])
    vol = _q_peak_vol([((1.0, 0.0, 0.0), cov_q, 100.0)], l_half=1.5)
    sig = _fit_remover(detect_window_hkl=0.2).measure_peak_sigmas(vol, (1.0, 0.0, 0.0))
    assert sig[2] == pytest.approx(0.05 / UB_DIAG[2, 2], rel=0.05)


def test_neighbouring_satellite_is_not_averaged_in():
    """A satellite 0.4 r.l.u. away along L (0.1 Å⁻¹), at 60 % of the peak,
    lies inside the fit window but is not connected to the core."""
    iso = 0.02**2 * np.eye(3)
    alone = _q_peak_vol([((1.0, 0.0, 0.0), iso, 100.0)])
    paired = _q_peak_vol([((1.0, 0.0, 0.0), iso, 100.0),
                          ((1.0, 0.0, 0.4), iso, 60.0)])
    rem = _fit_remover()
    a = rem.measure_peak_covariance(alone, (1.0, 0.0, 0.0))
    b = rem.measure_peak_covariance(paired, (1.0, 0.0, 0.0))
    np.testing.assert_allclose(b, a, rtol=0.02, atol=1e-8)
    assert abs(_node_record(rem, paired).center_hkl[2]) < 0.01


def test_peak_too_weak_for_its_noise_gets_the_resolution_ellipsoid():
    """When the core cut does not clear 3 noise sigmas, the shape is not
    measured, and the punch falls back to the resolution ellipsoid."""
    vol = _q_peak_vol([((1.0, 0.0, 0.0), 0.03**2 * np.eye(3), 0.5)],
                      noise=0.1, seed=7)
    rem = _fit_remover(min_intensity=0.0, min_prominence=0.0)
    idx = tuple(int(np.argmin(np.abs(a - x))) for a, x in
                zip((vol.h_axis, vol.k_axis, vol.l_axis), (1.0, 0.0, 0.0)))
    _, shape = rem._fit_integer_peak(vol, idx, 0.5)
    assert shape is None
    strong = _fit_remover(min_intensity=0.0, min_prominence=0.0)._fit_integer_peak(
        _q_peak_vol([((1.0, 0.0, 0.0), 0.03**2 * np.eye(3), 5.0)], noise=0.1, seed=7),
        idx, 0.5)
    assert strong[1] is not None


def test_margin_grows_each_principal_radius_in_q():
    """The Å⁻¹ margin adds to the principal radii taken in Q, also for a
    tilted ellipsoid on an anisotropic metric."""
    u, _ = _tilted_cov_q((1.0, 1.0, 1.0))
    v = np.cross(u, [0.0, 0.0, 1.0])
    v /= np.linalg.norm(v)
    w = np.cross(u, v)
    r_mat = np.column_stack([u, v, w])
    radii = np.array([0.15, 0.08, 0.05])
    a_q = r_mat @ np.diag(1 / radii**2) @ r_mat.T
    vol = _q_peak_vol([])
    a = BraggRemover._inflate_q_isotropic(vol, UB_DIAG.T @ a_q @ UB_DIAG, 0.02)
    ub_inv = np.linalg.inv(UB_DIAG)
    m_q = np.linalg.inv(ub_inv.T @ a @ ub_inv)
    for axis, r in zip(r_mat.T, radii):
        assert float(np.sqrt(axis @ m_q @ axis)) == pytest.approx(r + 0.02, rel=1e-9)


def test_pipeline_ellipsoid_footprint_punches_fitted_tilted_ellipsoids():
    assert PunchParams().integer_optimize_shape is True
    _, cov_q = _tilted_cov_q((1.0, 1.0, 1.0))
    vol = _q_peak_vol([((1.0, 0.0, 0.0), cov_q, 100.0)])
    out = punch_bragg(vol, PunchParams(mode="integer", punch_footprint="ellipsoid"))
    kinds = {p["fit_kind"] for p in out._bragg_profile["peaks"]}
    assert kinds == {"tilted"}
