"""Tests for sample-only global 3D powder-ring inference."""

import json

import numpy as np

from nebula3d.core import HKLVolume
from nebula3d.preprocessing.global_rings import (
    GlobalRingConfig,
    aluminum_fcc_lines,
    fit_global_rings,
    write_global_ring_diagnostics,
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


def _permuted_volume(vol, permutation):
    """Relabel reciprocal axes without changing the physical Q vectors."""
    permutation = tuple(permutation)
    selector = np.eye(3)[list(permutation)]
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    return HKLVolume(
        data=np.transpose(vol.data, permutation),
        sigma=np.transpose(vol.sigma, permutation),
        mask=np.transpose(vol.mask, permutation),
        h_axis=axes[permutation[0]].copy(),
        k_axis=axes[permutation[1]].copy(),
        l_axis=axes[permutation[2]].copy(),
        ub_matrix=vol.ub_matrix @ selector.T,
        instrument=vol.instrument,
    )


def _overlapping_al_volume(seed=12):
    """Two broadened neighboring Al lines whose profiles overlap strongly."""
    rng = np.random.default_rng(seed)
    n = 61
    axes = np.linspace(-4.5, 4.5, n)
    shape = (n, n, n)
    base = HKLVolume.from_arrays(
        np.ones(shape), (axes[0], axes[-1]), (axes[0], axes[-1]),
        (axes[0], axes[-1]), ub_matrix=np.eye(3))
    H, K, L = base.hkl_grid()
    q = base.q_magnitude()
    lines = aluminum_fcc_lines(q_min=5.0, q_max=5.5)
    assert [line.family for line in lines] == ["311", "222"]

    diffuse = 0.9 + 0.08 * np.cos(0.4 * H) * np.cos(0.5 * K)
    fwhm = 0.28
    ring = (
        1.9 * _pseudo_voigt(q, lines[0].q, fwhm, 0.5)
        + 1.5 * _pseudo_voigt(q, lines[1].q, fwhm, 0.5)
    )
    noise = rng.normal(0.0, 0.012, shape)
    vol = HKLVolume.from_arrays(
        diffuse + ring + noise,
        (axes[0], axes[-1]), (axes[0], axes[-1]), (axes[0], axes[-1]),
        sigma=np.full(shape, 0.012), ub_matrix=np.eye(3))
    return vol, q, diffuse, ring, lines


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
    assert np.array_equal(result.cleaned.sigma, vol.sigma)


def test_global_fit_is_invariant_to_reciprocal_axis_relabeling():
    """The 3-D model must not depend on which array axis is called H/K/L."""
    vol, *_ = _global_ring_volume()
    permutation = (2, 0, 1)
    permuted = _permuted_volume(vol, permutation)

    original = fit_global_rings(vol, _config())
    relabeled = fit_global_rings(permuted, _config())
    inverse = tuple(np.argsort(permutation))

    assert original.diagnostics.n_fitted_shells == relabeled.diagnostics.n_fitted_shells
    assert np.allclose(
        original.ring_mean, np.transpose(relabeled.ring_mean, inverse),
        rtol=2e-10, atol=2e-10)
    assert np.allclose(
        original.ring_sigma, np.transpose(relabeled.ring_sigma, inverse),
        rtol=2e-10, atol=2e-10)
    assert np.allclose(
        original.cleaned.data, np.transpose(relabeled.cleaned.data, inverse),
        rtol=2e-10, atol=2e-10)


def test_global_fit_is_invariant_to_rigid_detector_frame_rotation():
    """Rotating the physical coordinate frame must not change fitted intensities."""
    vol, *_ = _global_ring_volume(seed=7)
    quarter_turn = np.array([
        [0.0, -1.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
    ])
    rotated = HKLVolume(
        data=vol.data.copy(),
        sigma=vol.sigma.copy(),
        mask=vol.mask.copy(),
        h_axis=vol.h_axis.copy(),
        k_axis=vol.k_axis.copy(),
        l_axis=vol.l_axis.copy(),
        ub_matrix=quarter_turn @ vol.ub_matrix,
        instrument=vol.instrument,
    )

    original = fit_global_rings(vol, _config())
    reoriented = fit_global_rings(rotated, _config())

    assert original.diagnostics.n_fitted_shells == reoriented.diagnostics.n_fitted_shells
    mean_relative_l1 = float(np.sum(np.abs(
        original.ring_mean - reoriented.ring_mean))) / float(
            np.sum(np.abs(original.ring_mean)))
    sigma_relative_l1 = float(np.sum(np.abs(
        original.ring_sigma - reoriented.ring_sigma))) / float(
            np.sum(np.abs(original.ring_sigma)))
    # Cell-boundary ties can move a few samples under an exact quarter-turn;
    # their aggregate effect must stay far below the scientific 1% intensity gate.
    assert mean_relative_l1 < 0.001
    assert sigma_relative_l1 < 0.02


def test_global_fit_is_stable_under_arbitrary_rigid_frame_rotation():
    """Angular bin seams may move under rotation but cannot materially change a fit."""
    vol, *_ = _global_ring_volume(seed=9)
    ax, az = 0.41, -0.63
    cx, sx = np.cos(ax), np.sin(ax)
    cz, sz = np.cos(az), np.sin(az)
    rotation = np.array([
        [cz, -sz * cx, sz * sx],
        [sz, cz * cx, -cz * sx],
        [0.0, sx, cx],
    ])
    rotated = HKLVolume(
        data=vol.data.copy(), sigma=vol.sigma.copy(), mask=vol.mask.copy(),
        h_axis=vol.h_axis.copy(), k_axis=vol.k_axis.copy(), l_axis=vol.l_axis.copy(),
        ub_matrix=rotation @ vol.ub_matrix, instrument=vol.instrument)

    original = fit_global_rings(vol, _config())
    reoriented = fit_global_rings(rotated, _config())
    scale = max(float(np.sum(np.abs(original.ring_mean))), 1e-12)
    relative_l1 = float(np.sum(np.abs(
        reoriented.ring_mean - original.ring_mean))) / scale

    assert original.diagnostics.n_fitted_shells == reoriented.diagnostics.n_fitted_shells
    assert relative_l1 < 0.03


def test_overlapping_al_lines_are_not_double_subtracted():
    """Neighboring broad Al profiles may merge, but the overlap stays physical."""
    vol, q, diffuse, ring, lines = _overlapping_al_volume()
    result = fit_global_rings(vol, _config(
        q_min=4.75, q_max=5.7, max_fwhm=0.45, min_snr=2.5,
        angular_lmax=0, angular_ridge=0.05))

    assert result.diagnostics.n_fitted_shells >= 1
    fitted_families = [
        shell.al_family for shell in result.diagnostics.shells
        if shell.material == "aluminum"
    ]
    assert fitted_families
    assert len(fitted_families) == len(set(fitted_families))
    assert any(family in {line.family for line in lines} for family in fitted_families)

    overlap = ((q > lines[0].q) & (q < lines[1].q)
               & (ring > 0.5))
    before = float(np.median(np.abs(vol.data[overlap] - diffuse[overlap])))
    after = float(np.median(np.abs(result.cleaned.data[overlap] - diffuse[overlap])))
    assert after < 0.7 * before
    # Double-counting two unresolved components would subtract substantially
    # more than their known combined signal in the shared shoulder.
    overshoot = result.subtracted[overlap] - ring[overlap]
    assert float(np.percentile(overshoot, 95)) < 0.20


def test_conservative_policy_reduces_truth_level_over_subtraction():
    """Model uncertainty must translate into safer subtraction, not just metadata."""
    vol, q, ring, _diffuse, _bragg, q111 = _global_ring_volume(seed=19)
    mean = fit_global_rings(vol, _config(subtraction="mean"))
    conservative = fit_global_rings(
        vol, _config(subtraction="conservative", confidence_z=1.0))
    shell = (np.abs(q - q111) < 0.09) & (ring > 0.15)

    mean_excess = np.maximum(mean.subtracted[shell] - ring[shell], 0.0)
    conservative_excess = np.maximum(
        conservative.subtracted[shell] - ring[shell], 0.0)
    assert float(np.mean(conservative_excess)) < float(np.mean(mean_excess))
    assert float(np.percentile(conservative_excess, 95)) < 0.08
    assert conservative.diagnostics.negative_flip_fraction <= (
        mean.diagnostics.negative_flip_fraction)


def test_input_counting_uncertainty_inflates_model_uncertainty_and_retains_signal():
    """A noisier measurement must produce a wider, more conservative ring model."""
    low_sigma, q, ring, *_ = _global_ring_volume(seed=23)
    high_sigma = HKLVolume(
        data=low_sigma.data.copy(),
        sigma=np.full(low_sigma.shape, 0.20),
        mask=low_sigma.mask.copy(),
        h_axis=low_sigma.h_axis.copy(),
        k_axis=low_sigma.k_axis.copy(),
        l_axis=low_sigma.l_axis.copy(),
        ub_matrix=low_sigma.ub_matrix.copy(),
        instrument=low_sigma.instrument,
    )
    cfg = _config(
        subtraction="conservative", confidence_z=1.0,
        min_al_lines=1, min_al_anchor_lines=1)

    precise = fit_global_rings(low_sigma, cfg)
    uncertain = fit_global_rings(high_sigma, cfg)
    support = (precise.ring_mean > 0.10) & (ring > 0.10) & np.isfinite(q)

    assert precise.diagnostics.n_fitted_shells >= 1
    assert uncertain.diagnostics.n_fitted_shells >= 1
    assert float(np.median(uncertain.ring_sigma[support])) > (
        1.2 * float(np.median(precise.ring_sigma[support])))
    assert float(np.median(uncertain.subtracted[support])) < (
        float(np.median(precise.subtracted[support])))


def test_intensity_unit_scaling_preserves_fit_and_uncertainty_covariance():
    """Changing intensity units must scale every modeled quantity linearly."""
    vol, *_ = _global_ring_volume(seed=27)
    factor = 37.0
    scaled = HKLVolume(
        data=factor * vol.data,
        sigma=factor * vol.sigma,
        mask=vol.mask.copy(),
        h_axis=vol.h_axis.copy(),
        k_axis=vol.k_axis.copy(),
        l_axis=vol.l_axis.copy(),
        ub_matrix=vol.ub_matrix.copy(),
        instrument=vol.instrument,
    )
    cfg = _config(
        material="generic", subtraction="conservative", confidence_z=1.0)

    reference = fit_global_rings(vol, cfg)
    converted = fit_global_rings(scaled, cfg)

    assert reference.diagnostics.n_fitted_shells == converted.diagnostics.n_fitted_shells
    assert np.allclose(converted.ring_mean / factor, reference.ring_mean,
                       rtol=2e-9, atol=2e-9)
    assert np.allclose(converted.ring_sigma / factor, reference.ring_sigma,
                       rtol=2e-9, atol=2e-9)
    assert np.allclose(converted.subtracted / factor, reference.subtracted,
                       rtol=2e-9, atol=2e-9)
    assert np.allclose(converted.cleaned.data / factor, reference.cleaned.data,
                       rtol=2e-9, atol=2e-9)


def test_aluminum_mode_preserves_narrow_non_al_sample_shell():
    """A narrow isotropic sample feature away from Al priors is a negative control."""
    vol, q, *_ = _global_ring_volume(with_ring=False, seed=29)
    sample_feature = 1.8 * _pseudo_voigt(q, 2.45, 0.10, 0.5)
    feature_vol = HKLVolume(
        data=vol.data + sample_feature,
        sigma=vol.sigma.copy(),
        mask=vol.mask.copy(),
        h_axis=vol.h_axis.copy(),
        k_axis=vol.k_axis.copy(),
        l_axis=vol.l_axis.copy(),
        ub_matrix=vol.ub_matrix.copy(),
        instrument=vol.instrument,
    )
    result = fit_global_rings(
        feature_vol, _config(material="aluminum", min_snr=2.5))

    assert result.diagnostics.n_detected_candidates >= 1
    assert result.diagnostics.n_fitted_shells == 0
    assert np.count_nonzero(result.subtracted) == 0
    assert np.array_equal(result.cleaned.data, feature_vol.data)
    assert "no detected shell matched the FCC Al prior" in result.diagnostics.warnings


def test_conservative_mode_does_not_subtract_ambiguous_single_al_line_feature():
    """One isotropic sample shell at Al(111) is not enough evidence to alter data."""
    vol, q, *_ = _global_ring_volume(with_ring=False, seed=31)
    q111 = aluminum_fcc_lines(q_min=2.5, q_max=2.9)[0].q
    sample_feature = 1.8 * _pseudo_voigt(q, q111, 0.10, 0.5)
    contaminated = HKLVolume(
        data=vol.data + sample_feature,
        sigma=vol.sigma.copy(),
        mask=vol.mask.copy(),
        h_axis=vol.h_axis.copy(),
        k_axis=vol.k_axis.copy(),
        l_axis=vol.l_axis.copy(),
        ub_matrix=vol.ub_matrix.copy(),
        instrument=vol.instrument,
    )
    result = fit_global_rings(contaminated, _config(
        material="aluminum", subtraction="conservative", min_snr=2.5))

    assert result.diagnostics.n_fitted_shells == 1
    assert result.diagnostics.status == "ambiguous"
    assert "only one shell supports the Al identification" in " ".join(
        result.diagnostics.warnings)
    assert np.count_nonzero(result.subtracted) == 0
    assert np.array_equal(result.cleaned.data, contaminated.data)


def test_inconsistent_chance_matches_to_two_al_lines_are_not_subtracted():
    """Two local tolerance hits without one shared Al lattice are still ambiguous."""
    vol, q, *_ = _global_ring_volume(with_ring=False, seed=33)
    q111, q200 = [line.q for line in aluminum_fcc_lines(q_min=2.5, q_max=3.2)]
    # Both peaks are inside the local ±0.12 A^-1 matching windows, but the
    # opposite shifts imply mutually inconsistent lattice parameters.
    sample_feature = (
        1.8 * _pseudo_voigt(q, q111 + 0.09, 0.09, 0.5)
        + 1.6 * _pseudo_voigt(q, q200 - 0.09, 0.09, 0.5)
    )
    contaminated = HKLVolume(
        data=vol.data + sample_feature,
        sigma=vol.sigma.copy(),
        mask=vol.mask.copy(),
        h_axis=vol.h_axis.copy(),
        k_axis=vol.k_axis.copy(),
        l_axis=vol.l_axis.copy(),
        ub_matrix=vol.ub_matrix.copy(),
        instrument=vol.instrument,
    )
    result = fit_global_rings(contaminated, _config(
        material="aluminum", subtraction="conservative", min_snr=2.5))

    assert result.diagnostics.n_detected_candidates >= 2
    assert result.diagnostics.status == "ambiguous"
    assert np.count_nonzero(result.subtracted) == 0
    assert np.array_equal(result.cleaned.data, contaminated.data)


def test_diagnostics_json_round_trip_is_finite_and_schema_complete(tmp_path):
    vol, *_ = _global_ring_volume()
    result = fit_global_rings(vol, _config(subtraction="conservative"))
    path = tmp_path / "ringremoved_diagnostics.json"

    # Strict JSON rejects NaN/Infinity, which are not portable between Python,
    # the browser, and downstream provenance tools.
    payload = result.diagnostics.to_dict()
    json.dumps(payload, allow_nan=False)
    write_global_ring_diagnostics(result.diagnostics, path)
    restored = json.loads(path.read_text(encoding="utf-8"))

    assert restored == payload
    assert restored["algorithm"] == "global_v2"
    assert restored["schema_version"] == 2
    assert restored["n_fitted_shells"] == len(restored["shells"])
    assert restored["subtraction_policy"] == "conservative"
    assert restored["n_valid_voxels"] > 0
    assert restored["n_profile_voxels"] > 0
    assert restored["fit_seconds"] >= 0.0
    assert restored["effective_config"]["material"] == "aluminum"
    assert restored["shells"]
    assert {
        "q_center", "fwhm", "snr", "angular_coverage",
        "angular_residual_rms", "model_uncertainty_median",
        "heldout_improvement", "heldout_rmse", "no_ring_rmse",
        "bright_arc_bias", "dim_arc_bias",
        "material", "al_family", "al_prior_q",
    } <= set(restored["shells"][0])
