"""Tests for the isotropic radial-background flatten (spherical |Q|-shell sweep)."""

import numpy as np
import pytest

from nebula3d.core import HKLVolume
from nebula3d.preprocessing import flatten_radial_background
from nebula3d.preprocessing.form_factor import IONS, ion_key, magnetic_form_factor

#: Both subtraction paths: the fitted model (default) and the free-form floor.
BOTH = pytest.mark.parametrize("estimator", ["model", "floor"])


def _base_vol(shape=(41, 41, 41), seed=0, noise=0.05):
    """Volume with a smooth, decaying, isotropic radial pedestal + small noise."""
    rng = np.random.default_rng(seed)
    ub = 2 * np.pi * np.eye(3) / 4.0
    vol = HKLVolume.from_arrays(
        np.zeros(shape, dtype=float), (-3, 3), (-3, 3), (-3, 3), ub_matrix=ub
    )
    q = vol.q_magnitude()
    bg = 5.0 * np.exp(-q / 3.0) + 0.5
    vol.data[...] = bg + rng.normal(0.0, noise, shape)
    return vol, q, bg


def _model_vol(shape=(41, 41, 41), seed=0, noise=0.05, const=0.5, c=5.0, extra=None):
    """Volume whose pedestal is exactly ``const + c·F_Tb³⁺(Q)²`` (+ *extra(q)*)."""
    rng = np.random.default_rng(seed)
    ub = 2 * np.pi * np.eye(3) / 4.0
    vol = HKLVolume.from_arrays(
        np.zeros(shape, dtype=float), (-3, 3), (-3, 3), (-3, 3), ub_matrix=ub
    )
    q = vol.q_magnitude()
    bg = const + c * magnetic_form_factor(q, "Tb3+") ** 2
    vol.data[...] = bg + (extra(q) if extra is not None else 0.0) + rng.normal(0.0, noise, shape)
    return vol, q, bg


def _shell_medians(data, q, valid, step=0.15, min_count=10):
    """Per-shell median of *data* — an independent flatness probe for the tests."""
    edges = np.arange(float(q[valid].min()), float(q[valid].max()) + step, step)
    n = edges.size - 1
    bi = np.clip(np.digitize(q, edges) - 1, 0, n - 1)[valid]
    vv = data[valid].astype(float)
    order = np.argsort(bi, kind="stable")
    sb, sv = bi[order], vv[order]
    bounds = np.searchsorted(sb, np.arange(n + 1))
    out = np.full(n, np.nan)
    for b in range(n):
        seg = sv[bounds[b]:bounds[b + 1]]
        if seg.size >= min_count:
            out[b] = float(np.median(seg))
    return out


def test_flatten_collapses_shell_spread_and_is_continuous():
    vol, q, _ = _base_vol()
    valid = vol.mask & np.isfinite(vol.data)
    before = _shell_medians(vol.data, q, valid)

    res = flatten_radial_background(vol, estimator="floor", q_step=0.05, smooth=0.2,
                                    min_count=15)
    after = _shell_medians(res.volume.data, q, valid)

    assert np.nanstd(before) > 0.5                       # a real radial pedestal
    assert np.nanstd(after) < 0.15 * np.nanstd(before)   # flattened across shells
    assert np.all(np.isfinite(res.bg_curve))
    # smooth + continuous: no large shell-to-shell jump in the subtracted curve
    span = float(np.nanmax(res.bg_curve) - np.nanmin(res.bg_curve))
    assert np.max(np.abs(np.diff(res.bg_curve))) < 0.1 * span


@BOTH
def test_preserves_anisotropic_diffuse_blob(estimator):
    vol, _, _ = _base_vol()
    H, K, L = vol.hkl_grid()
    # localized blob off-origin: it occupies one azimuth of its |Q| shell, so it
    # is signal, not background, and must survive the floor subtraction.
    blob = 4.0 * np.exp(-((H - 1.5) ** 2 + K**2 + L**2) / (2 * 0.25**2))
    vol.data[...] = vol.data + blob
    ic = np.unravel_index(int(np.argmax(blob)), blob.shape)

    res = flatten_radial_background(vol, estimator=estimator, q_step=0.05, smooth=0.2,
                                    min_count=15)

    assert res.volume.data[ic] > 0.6 * 4.0               # blob peak retained


@BOTH
def test_bragg_spikes_survive_and_do_not_inflate_bg(estimator):
    vol, _, _ = _base_vol()
    spikes = [(10, 20, 20), (30, 15, 25), (20, 30, 10)]
    for idx in spikes:
        vol.data[idx] += 100.0

    res = flatten_radial_background(vol, estimator=estimator, q_step=0.05, smooth=0.2,
                                    min_count=15)

    for idx in spikes:
        assert res.volume.data[idx] > 90.0               # spike stays in residual
    assert float(np.nanmax(res.bg_curve)) < 10.0         # bg not pulled to spike


def test_floor_keeps_the_anisotropic_diffuse():
    vol, q, _ = _base_vol()
    H, K, _ = vol.hkl_grid()
    phi = np.arctan2(K, H)
    # anisotropic diffuse: 0..2 around the azimuth of a |Q|≈4 shell.
    diffuse = 2.0 * np.exp(-((q - 4.0) ** 2) / (2 * 0.6**2)) * (0.5 + 0.5 * np.cos(2 * phi))
    vol.data[...] = vol.data + diffuse
    ic = np.unravel_index(int(np.argmax(diffuse)), diffuse.shape)

    kw = dict(q_step=0.05, smooth=0.2, min_count=15)
    floor = flatten_radial_background(vol, estimator="floor", **kw)
    # the shell median: the level the removed "median" estimator subtracted
    shell_median = float(np.median(vol.data[np.abs(q - q[ic]) < 0.025]))

    assert float(np.nansum(vol.data - floor.volume.data)) > 0
    # the floor sits under the shell's diffuse: it subtracts less than the
    # shell median would
    assert vol.data[ic] - floor.volume.data[ic] < shell_median
    assert floor.volume.data[ic] > 0.5 * diffuse[ic]


def test_snip_estimator_runs_and_flattens():
    vol, q, _ = _base_vol()
    valid = vol.mask & np.isfinite(vol.data)
    before = _shell_medians(vol.data, q, valid)

    res = flatten_radial_background(vol, estimator="snip", q_step=0.05, snip_width=0.4,
                                    min_count=15)
    after = _shell_medians(res.volume.data, q, valid)

    assert np.all(np.isfinite(res.bg_curve))
    assert np.nanstd(after) < 0.3 * np.nanstd(before)


@BOTH
def test_clip_negative_floors_at_zero(estimator):
    vol, _, _ = _base_vol(noise=0.5)
    res = flatten_radial_background(vol, estimator=estimator, clip_negative=True,
                                    q_step=0.05, smooth=0.2, min_count=15)
    fin = np.isfinite(res.volume.data)
    assert (res.volume.data[fin] >= 0.0).all()


@BOTH
def test_mask_preserved_and_values_finite(estimator):
    vol, _, _ = _base_vol()
    keep = np.ones(vol.shape, dtype=bool)
    keep[:5, :, :] = False                               # mask a slab
    vol.apply_mask(keep)
    before_mask = vol.mask.copy()

    res = flatten_radial_background(vol, estimator=estimator, q_step=0.05, smooth=0.2,
                                    min_count=15)

    assert np.array_equal(res.volume.mask, before_mask)  # mask untouched
    fin = np.isfinite(vol.data)
    assert np.isfinite(res.volume.data[fin]).all()


def test_all_masked_returns_unchanged():
    vol, _, _ = _base_vol()
    vol.apply_mask(np.zeros(vol.shape, dtype=bool))

    res = flatten_radial_background(vol)

    assert res.q_grid.size == 0
    assert res.bg_curve.size == 0
    assert np.array_equal(res.volume.data, vol.data)


@BOTH
def test_subtraction_is_purely_radial_so_anisotropy_is_untouched(estimator):
    """The flatten subtracts a single level per |Q|, so within a thin shell every
    voxel loses the *same* amount.  That is the precise guarantee that it cannot
    distort anisotropic features: any contrast between two voxels at the same |Q|
    (a Bragg/diffuse peak vs its background) is preserved exactly — only the
    radial mean is shifted. This locks the guarantee in on synthetic data.
    """
    vol, q, _ = _base_vol()
    H, K, L = vol.hkl_grid()
    # several anisotropic blobs at different |Q| and azimuth
    for h0, k0 in [(1.5, 0.0), (0.0, 1.8), (-1.2, 1.2)]:
        vol.data[...] += 4.0 * np.exp(-((H - h0) ** 2 + (K - k0) ** 2 + L**2) / (2 * 0.25**2))

    res = flatten_radial_background(vol, estimator=estimator, q_step=0.05, smooth=0.2,
                                    min_count=15)
    delta = vol.data - res.volume.data            # the amount removed at each voxel

    bg_span = float(np.nanmax(res.bg_curve) - np.nanmin(res.bg_curve))
    # a constant background (the model with ion="none") has zero span, so allow
    # float rounding of the subtraction, scaled to the background level.
    atol = 1e-9 * max(1.0, float(np.nanmax(np.abs(res.bg_curve))))
    # in a thin |Q| shell the removed amount varies only by the curve's slope ×
    # the shell width — a tiny fraction of the total background span.
    for q0 in (1.0, 2.0, 3.5):
        shell = np.abs(q - q0) < 0.02
        assert np.ptp(delta[shell]) <= 0.03 * bg_span + atol

    # and the blob-to-background contrast within a shell is retained to ~100%
    H1, K1, L1 = vol.hkl_grid()
    peak = (np.abs(H1 - 1.5) < 0.05) & (np.abs(K1) < 0.05) & (np.abs(L1) < 0.05)
    ref = (np.abs(q - q[peak].mean()) < 0.02) & ~peak
    c_before = float(vol.data[peak].mean() - np.median(vol.data[ref]))
    c_after = float(res.volume.data[peak].mean() - np.median(res.volume.data[ref]))
    assert abs(c_after - c_before) < 0.02 * abs(c_before)


def test_floor_is_conservative():
    """Subtracting the p25 floor leaves the shell bulk above zero (≈floor_pct
    negative); a shell median would centre it (≈50% negative).
    """
    vol, _, _ = _base_vol(noise=0.2)

    floor = flatten_radial_background(vol, estimator="floor", floor_percentile=25.0,
                                      q_step=0.05, smooth=0.2, min_count=15)
    fin = np.isfinite(vol.data)
    neg_floor = float(np.mean(floor.volume.data[fin] < 0.0))
    assert neg_floor < 0.40                       # floor keeps the bulk positive


def test_unknown_estimator_raises():
    vol, _, _ = _base_vol()
    for name in ("nope", "median", "mode"):  # median/mode remove real diffuse
        with pytest.raises(ValueError, match="estimator"):
            flatten_radial_background(vol, estimator=name)


# ---------------------------------------------------------------------------
# the const + c·F(Q)² model (default)
# ---------------------------------------------------------------------------
def test_model_is_the_default():
    vol, _, _ = _model_vol()
    res = flatten_radial_background(vol)
    assert res.estimator == "model"
    assert res.ion is None


def test_model_recovers_the_pedestal_and_flattens():
    """On an exact const + c·F² pedestal the fit returns c, and const less the
    floor's noise offset (p25 of Gaussian noise is 0.674σ below the mean)."""
    noise = 0.05
    vol, q, _ = _model_vol(noise=noise)
    valid = vol.mask & np.isfinite(vol.data)

    res = flatten_radial_background(vol, ion="Tb3+", q_step=0.05, min_count=15)
    const, c = res.model_coef

    assert c == pytest.approx(5.0, rel=0.02)
    assert const == pytest.approx(0.5 - 0.674 * noise, abs=0.01)
    assert res.model_r2 > 0.99
    after = _shell_medians(res.volume.data, q, valid)
    assert np.nanstd(after) < 0.01                       # flat: one constant left
    assert np.nanmedian(after) == pytest.approx(0.674 * noise, abs=0.01)


def test_model_keeps_isotropic_correlations_the_floor_removes():
    """The point of the model.  Pair correlations at distance r add an isotropic
    ``sin(Qr)/(Qr)`` term to every shell (period 2π/r).  The fixed-shape model
    cannot follow it, so it survives; the free-form floor follows it and
    subtracts it — which carved spherical shells into the real ΔPDF.
    """
    r0 = 3.75                                            # Å; period 1.68 Å⁻¹
    def corr(q):
        x = np.maximum(q, 1e-6) * r0
        return 0.4 * np.sin(x) / x * magnetic_form_factor(q, "Tb3+") ** 2

    vol, q, _ = _model_vol(shape=(61, 61, 61), extra=corr)
    valid = vol.mask & np.isfinite(vol.data)
    edges = np.arange(1.0, 7.0 + 1e-9, 0.15)
    shell = np.digitize(q[valid], edges) - 1
    inside = (shell >= 0) & (shell < edges.size - 1)
    truth = corr(0.5 * (edges[:-1] + edges[1:]))
    t = truth - truth.mean()

    def retained(res):
        """Share of the injected correlation term left in the shell medians."""
        vals = res.volume.data[valid][inside]
        prof = np.array([np.median(vals[shell[inside] == i]) for i in range(t.size)])
        return float(np.sum((prof - prof.mean()) * t) / np.sum(t * t))

    model = flatten_radial_background(vol, ion="Tb3+", q_step=0.05, min_count=15)
    floor = flatten_radial_background(vol, estimator="floor", q_step=0.05, smooth=0.10,
                                      min_count=15)

    assert retained(model) > 0.8                         # 0.88: F² absorbs a little
    assert retained(floor) < 0.3                         # 0.07


def test_model_without_an_ion_fits_a_constant():
    vol, _, _ = _base_vol()
    for ion in (None, "none", ""):
        res = flatten_radial_background(vol, ion=ion, q_step=0.05, min_count=15)
        assert res.ion is None
        assert res.model_coef[1] == 0.0
        assert np.ptp(res.bg_curve) == 0.0
        assert res.bg_curve[0] == pytest.approx(res.model_coef[0])


def test_unknown_ion_raises():
    vol, _, _ = _model_vol()
    with pytest.raises(ValueError, match="form factor"):
        flatten_radial_background(vol, ion="Xx3+")


def test_form_factor_table():
    """⟨j0⟩(0) = 1 for every tabulated ion (guards the coefficients against a
    typo), F falls with |Q|, and the dipole ⟨j2⟩ term follows the Landé g."""
    for name in IONS:
        assert magnetic_form_factor(0.0, name) == pytest.approx(1.0, abs=2e-3), name
        f = magnetic_form_factor(np.linspace(0.0, 4.0, 41), name)
        assert np.all(np.diff(f) < 0), name
    # spin-only g = 2: no ⟨j2⟩ term; Tb³⁺ (g = 3/2) adds ⅓⟨j2⟩ > 0
    s2 = (6.0 / (4 * np.pi)) ** 2
    a, aa, b, bb, c, cc, d = IONS["Tb3+"].j0
    j0 = a * np.exp(-aa * s2) + b * np.exp(-bb * s2) + c * np.exp(-cc * s2) + d
    assert magnetic_form_factor(6.0, "Tb3+") > j0
    for alias in ("Tb3+", "tb3", "Tb^3+", " TB3+ "):
        assert ion_key(alias) == "Tb3+"
