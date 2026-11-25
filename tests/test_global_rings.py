"""Tests for sample-only global 3D powder-ring inference."""

import numpy as np

from nebula3d.core import HKLVolume
from nebula3d.preprocessing.global_rings import (
    GlobalRingConfig,
    aluminum_fcc_lines,
    fit_global_rings,
)
from nebula3d.preprocessing.parametric_ring import _pseudo_voigt


def _global_ring_volume(*, with_ring=True, ring_q=None, seed=4):
    rng = np.random.default_rng(seed)
    n = 41
    axes = np.linspace(-3.2, 3.2, n)
    ub = np.eye(3)
    shape = (n, n, n)
    base = HKLVolume.from_arrays(
        np.ones(shape), (axes[0], axes[-1]), (axes[0], axes[-1]),
        (axes[0], axes[-1]), ub_matrix=ub)
    H, K, L = base.hkl_grid()
    q = base.q_magnitude()
    uq = np.maximum(q, 1e-12)
    ux, uy, uz = H / uq, K / uq, L / uq

    # Broad anisotropic sample diffuse scattering, not radially narrow.
    diffuse = 1.2 + 0.12 * np.cos(0.8 * H) * np.cos(0.6 * K) + 0.05 * uz
    ring = np.zeros(shape)
    q111 = aluminum_fcc_lines(q_min=2.5, q_max=2.9)[0].q
    q_ring = q111 if ring_q is None else float(ring_q)
    if with_ring:
        texture = 2.2 * (1.0 + 0.35 * (ux * ux - uy * uy) + 0.2 * uz)
        ring = texture * _pseudo_voigt(q, q_ring, 0.10, 0.5)
    data = diffuse + ring + rng.normal(0.0, 0.015, shape)

    # Sparse crystal Bragg peaks should remain outliers, not enter the smooth
    # spherical texture field.
    bragg_positions = [(8, 20, 35), (33, 20, 8), (20, 34, 12)]
    for pos in bragg_positions:
        data[pos] += 80.0
    sigma = np.full(shape, 0.015)
    vol = HKLVolume.from_arrays(
        data, (axes[0], axes[-1]), (axes[0], axes[-1]),
        (axes[0], axes[-1]), sigma=sigma, ub_matrix=ub)
    return vol, q, ring, diffuse, bragg_positions, q_ring


def _config(**overrides):
    base = dict(
        q_min=2.1, q_max=3.3, q_step=0.025, max_fwhm=0.20,
        min_snr=3.0, material="aluminum", angular_lmax=2,
        angular_ridge=0.02, angular_mu_bins=8, angular_phi_bins=16,
        min_angular_bin_count=4, subtraction="mean")
    base.update(overrides)
    return GlobalRingConfig(**base)


def test_aluminum_fcc_line_positions_and_selection_rule():
    lines = aluminum_fcc_lines(a=4.0494, q_min=2.0, q_max=4.5)
    assert [line.family for line in lines[:3]] == ["111", "200", "220"]
    assert abs(lines[0].q - 2.687) < 0.005
    assert abs(lines[1].q - 3.103) < 0.005


def test_global_al_model_suppresses_ring_and_preserves_diffuse_and_bragg():
    vol, q, ring, diffuse, bragg_positions, q111 = _global_ring_volume()
    result = fit_global_rings(vol, _config())

    assert result.diagnostics.n_fitted_shells >= 1
    assert any(s.material == "aluminum" for s in result.diagnostics.shells)
    assert result.diagnostics.fitted_al_lattice_a is not None
    assert abs(result.diagnostics.fitted_al_lattice_a - 4.0494) < 0.08

    on = (np.abs(q - q111) < 0.04) & (ring > 0.5)
    before_err = float(np.median(np.abs(vol.data[on] - diffuse[on])))
    after_err = float(np.median(np.abs(result.cleaned.data[on] - diffuse[on])))
    assert after_err < 0.35 * before_err

    off = (q > 2.15) & (q < 2.35)
    assert float(np.median(np.abs(result.subtracted[off]))) < 1e-8

    for pos in bragg_positions:
        assert result.cleaned.data[pos] > 70.0


def test_global_model_leaves_clean_negative_control_unchanged():
    vol, *_ = _global_ring_volume(with_ring=False)
    result = fit_global_rings(vol, _config())
    assert result.diagnostics.n_fitted_shells == 0
    assert np.count_nonzero(result.subtracted) == 0
    assert np.array_equal(result.cleaned.data, vol.data)


def test_generic_default_snr_leaves_clean_negative_control_unchanged():
    vol, *_ = _global_ring_volume(with_ring=False)
    result = fit_global_rings(vol, _config(material="generic", min_snr=5.0))
    assert result.diagnostics.n_fitted_shells == 0
    assert np.count_nonzero(result.subtracted) == 0


def test_auto_mode_keeps_supported_non_aluminum_shell_as_generic():
    vol, *_ = _global_ring_volume(ring_q=2.45)
    result = fit_global_rings(vol, _config(material="auto", min_snr=3.0))
    assert result.diagnostics.n_fitted_shells >= 1
    shell = min(result.diagnostics.shells, key=lambda s: abs(s.q_center - 2.45))
    assert abs(shell.q_center - 2.45) < 0.06
    assert shell.material == "generic"


def test_conservative_subtraction_never_exceeds_mean_model():
    vol, *_ = _global_ring_volume()
    mean = fit_global_rings(vol, _config(subtraction="mean"))
    conservative = fit_global_rings(
        vol, _config(subtraction="conservative", confidence_z=1.0))
    assert np.all(conservative.subtracted <= mean.ring_mean + 1e-12)
    assert np.all(conservative.subtracted >= 0.0)
    assert np.any(conservative.subtracted < mean.ring_mean)
    assert np.all(conservative.cleaned.sigma >= vol.sigma)


def test_diagnose_only_fits_but_does_not_modify_intensity():
    vol, *_ = _global_ring_volume()
    result = fit_global_rings(vol, _config(subtraction="diagnose_only"))
    assert result.diagnostics.n_fitted_shells >= 1
    assert np.any(result.ring_mean > 0)
    assert np.count_nonzero(result.subtracted) == 0
    assert np.array_equal(result.cleaned.data, vol.data)


def test_row_quadratic_form_matches_the_three_operand_einsum(monkeypatch):
    """The chunked b·C·b (WASM's iterator stays under 2**31) gives the old einsum's numbers."""
    from nebula3d.preprocessing import global_rings as gr

    rng = np.random.default_rng(3)
    basis = rng.normal(size=(1001, 9))
    a = rng.normal(size=(9, 9))
    covariance = a @ a.T
    expected = np.einsum("ij,jk,ik->i", basis, covariance, basis)
    monkeypatch.setattr(gr, "_QUAD_FORM_CHUNK", 64)  # 16 chunks, the last one short
    got = gr._row_quadratic_form(basis, covariance)
    np.testing.assert_allclose(got, expected, rtol=1e-12, atol=1e-12)
    np.testing.assert_allclose(gr._row_quadratic_form(basis[:0], covariance), np.empty(0))


# The old forms of the two helpers THY-51 made leaner (2026-11-25), kept here
# as the reference the new ones must equal bit for bit.
def _old_real_spherical_basis(directions, lmax):
    from scipy.special import gammaln, lpmv

    z = np.clip(directions[:, 2], -1.0, 1.0)
    phi = np.arctan2(directions[:, 1], directions[:, 0])
    cols, degrees = [], []
    for ell in range(lmax + 1):
        for m in range(-ell, ell + 1):
            am = abs(m)
            log_norm = 0.5 * (
                np.log((2.0 * ell + 1.0) / (4.0 * np.pi))
                + gammaln(ell - am + 1.0) - gammaln(ell + am + 1.0))
            col = np.exp(log_norm) * lpmv(am, ell, z)
            if m < 0:
                col = np.sqrt(2.0) * col * np.sin(am * phi)
            elif m > 0:
                col = np.sqrt(2.0) * col * np.cos(am * phi)
            cols.append(np.asarray(col, dtype=np.float64))
            degrees.append(float(ell))
    return np.column_stack(cols), np.asarray(degrees)


def _old_robust_radial_profile(q, I, edges, percentiles, min_per_bin, method="trimmed_mean"):
    from nebula3d.preprocessing.radial_background import _robust_bin_stat
    from nebula3d.utils.counting import bincount

    n_bins = len(edges) - 1
    out = np.full(n_bins, np.nan)
    lo_p, hi_p = percentiles
    bin_idx = np.digitize(q, edges) - 1
    valid = (bin_idx >= 0) & (bin_idx < n_bins)
    bi = bin_idx[valid]
    Iv = I[valid]
    if method == "median":
        n = bincount(bi, minlength=n_bins)
        counts = n.astype(np.float64)
        order = np.lexsort((Iv, bi))
        I_sorted = Iv[order]
        starts = np.zeros(n_bins, dtype=np.intp)
        np.cumsum(n[:-1], out=starts[1:])
        nz = np.nonzero(n > 0)[0]
        lo_i = starts[nz] + (n[nz] - 1) // 2
        hi_i = starts[nz] + n[nz] // 2
        out[nz] = 0.5 * (I_sorted[lo_i] + I_sorted[hi_i])
        return out, counts
    counts = np.zeros(n_bins)
    order = np.argsort(bi, kind="stable")
    bi_sorted = bi[order]
    I_sorted = Iv[order]
    starts = np.searchsorted(bi_sorted, np.arange(n_bins), side="left")
    ends = np.searchsorted(bi_sorted, np.arange(n_bins), side="right")
    for b in range(n_bins):
        sel = I_sorted[starts[b]:ends[b]]
        counts[b] = sel.size
        if sel.size >= min_per_bin:
            out[b] = _robust_bin_stat(sel, lo_p, hi_p, method)
        elif sel.size > 0:
            out[b] = float(np.median(sel))
    return out, counts


def test_the_spherical_basis_written_in_place_is_the_stacked_one():
    from nebula3d.preprocessing.global_rings import _real_spherical_basis

    rng = np.random.default_rng(7)
    d = rng.normal(size=(2003, 3))
    d /= np.linalg.norm(d, axis=1)[:, None]
    for lmax in (0, 2, 4, 6):
        got, deg = _real_spherical_basis(d, lmax)
        want, want_deg = _old_real_spherical_basis(d, lmax)
        np.testing.assert_array_equal(got, want)
        np.testing.assert_array_equal(deg, want_deg)
        assert got.dtype == want.dtype and got.flags.c_contiguous
    assert _real_spherical_basis(d[:0], 2)[0].shape == (0, 9)


def test_the_radial_profile_without_copies_is_the_old_one():
    """All values in range (no copies now) and some out of range (copies), each
    estimator, float32 and float64: the same numbers as before."""
    from nebula3d.preprocessing.radial_background import _robust_radial_profile

    rng = np.random.default_rng(11)
    edges = np.linspace(1.0, 5.0, 41)
    for dtype in (np.float32, np.float64):
        for spread in ((1.0, 5.0 - 1e-9), (0.5, 5.5)):
            q = rng.uniform(*spread, size=20_000)
            values = rng.gamma(2.0, size=q.size).astype(dtype)
            for method in ("median", "trimmed_mean", "huber"):
                got = _robust_radial_profile(q, values, edges, (10.0, 80.0), 3, method)
                want = _old_robust_radial_profile(q, values, edges, (10.0, 80.0), 3, method)
                for g, w in zip(got, want):
                    np.testing.assert_array_equal(g, w)


def test_the_global_fit_is_the_old_one(monkeypatch):
    """The whole fit with the old helpers swapped back in: identical outputs."""
    from nebula3d.preprocessing import global_rings as gr

    vol, *_ = _global_ring_volume()
    for subtraction in ("mean", "conservative"):
        cfg = _config(subtraction=subtraction)
        new = fit_global_rings(vol, cfg)
        with monkeypatch.context() as m:
            m.setattr(gr, "_real_spherical_basis", _old_real_spherical_basis)
            m.setattr(gr, "_robust_radial_profile", _old_robust_radial_profile)
            old = fit_global_rings(vol, cfg)
        assert new.diagnostics.n_fitted_shells > 0
        for a in ("ring_mean", "ring_sigma", "subtracted"):
            np.testing.assert_array_equal(getattr(new, a), getattr(old, a))
        np.testing.assert_array_equal(new.cleaned.data, old.cleaned.data)
        np.testing.assert_array_equal(new.cleaned.sigma, old.cleaned.sigma)
        assert new.diagnostics.to_dict() == old.diagnostics.to_dict()
