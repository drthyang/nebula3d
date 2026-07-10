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
