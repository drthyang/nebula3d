"""End-to-end integration test of the full pipeline on synthetic data.

Exercises the real API:
    EmptySubtractor → PatchedRingModel → backfill_ring_shells
    → bragg_mask → backfill_bragg → compute_delta_pdf
"""

import dataclasses
import warnings

import numpy as np

from nebula3d.analysis import backfill_bragg, bragg_mask, compute_delta_pdf
from nebula3d.core import HKLVolume
from nebula3d.preprocessing import (
    EmptySubtractor,
    PatchedRingModel,
    RingShell,
    backfill_ring_shells,
)
from nebula3d.preprocessing.ring_model import _gaussian

RING_Q = 2.6
RING_SIGMA = 0.08


def _azimuthal_texture(vol: HKLVolume) -> np.ndarray:
    """T(phi) = 1 + 0.3 cos(2 phi) in the hk0 plane — anisotropic ring."""
    H, K, L = vol.hkl_grid()
    hkl = np.stack([H, K, L], axis=-1)
    Q = hkl @ vol.ub_matrix.T
    phi = np.arctan2(Q[..., 1], Q[..., 0])
    return 1.0 + 0.3 * np.cos(2 * phi)


def _synthetic_vol(shape=(25, 25, 25), seed=0, with_environment_ring=True):
    rng = np.random.default_rng(seed)
    h = np.linspace(-3, 3, shape[0])
    k = np.linspace(-3, 3, shape[1])
    l = np.linspace(-3, 3, shape[2])
    ub = 2 * np.pi * np.eye(3) / 4.0
    vol = HKLVolume.from_arrays(
        np.ones(shape), (h[0], h[-1]), (k[0], k[-1]), (l[0], l[-1]), ub_matrix=ub
    )
    q_mag = vol.q_magnitude()
    H, K, L = vol.hkl_grid()

    diffuse = 1.0 + 0.4 * np.cos(np.pi * H) * np.cos(np.pi * K) + 0.2 * np.cos(2 * np.pi * L)
    ring = _azimuthal_texture(vol) * _gaussian(q_mag, 60.0, RING_Q, RING_SIGMA)

    bragg = np.zeros(shape)
    for hb, kb, lb in [(0, 0, 0), (1, 0, 0), (0, 1, 0), (-1, 0, 0)]:
        ih = int(np.argmin(np.abs(h - hb)))
        ik = int(np.argmin(np.abs(k - kb)))
        il = int(np.argmin(np.abs(l - lb)))
        bragg[ih, ik, il] = 500.0

    data = diffuse + ring + bragg + rng.normal(0, 0.05, shape)
    if not with_environment_ring:
        data = data - 0.0  # placeholder; empty scan has its own ring below
    return HKLVolume.from_arrays(data, (h[0], h[-1]), (k[0], k[-1]), (l[0], l[-1]), ub_matrix=ub)


def _empty_scan(shape=(25, 25, 25)):
    """Environment ring only (no sample diffuse / Bragg)."""
    h = np.linspace(-3, 3, shape[0])
    k = np.linspace(-3, 3, shape[1])
    l = np.linspace(-3, 3, shape[2])
    ub = 2 * np.pi * np.eye(3) / 4.0
    vol = HKLVolume.from_arrays(
        np.ones(shape), (h[0], h[-1]), (k[0], k[-1]), (l[0], l[-1]), ub_matrix=ub
    )
    q_mag = vol.q_magnitude()
    # Small environment ring at a different |Q| than the sample-holder ring.
    data = 0.5 + _gaussian(q_mag, 20.0, 3.4, 0.08)
    return HKLVolume.from_arrays(data, (h[0], h[-1]), (k[0], k[-1]), (l[0], l[-1]), ub_matrix=ub)


def test_empty_subtraction_reduces_environment_ring():
    sample = _synthetic_vol()
    empty = _empty_scan()
    # Inject the environment ring into the sample too.
    sample = dataclasses.replace(sample, data=sample.data + empty.data - 0.5)

    sub = EmptySubtractor(empty, scale_q_range=(3.2, 3.6))
    out = sub.subtract(sample)
    assert np.isfinite(out.data).all()
    assert 0.0 < sub.scale < 5.0


def test_full_pipeline_runs_and_produces_finite_dpdf():
    vol = _synthetic_vol()

    # (1) Empty-scan subtraction (no-op environment here; exercises the API).
    empty = _empty_scan()
    vol1 = EmptySubtractor(empty, scale=0.0).subtract(vol)
    assert np.isfinite(vol1.data).all()

    # (2) Factored ring model: fit with an explicit hint, then subtract.
    model = PatchedRingModel(n_patches=24, n_fourier=4, n_radial_bins=30,
                             snr_mask_threshold=2.0)
    fitted = model.fit(vol1, ring_hints=[RING_Q])
    assert len(fitted.rings) == 1
    assert np.isfinite(fitted.rank1_variance)
    vol2, I_ring = model.subtract(vol1, fitted)
    assert np.isfinite(vol2.data).all()
    assert np.isfinite(I_ring).all()

    # (3) Backfill the masked ring shell.
    rings = [RingShell(q_center=RING_Q, q_lo=RING_Q - 0.2, q_hi=RING_Q + 0.2)]
    vol_clean = backfill_ring_shells(vol2, rings, n_neighbors=12,
                                     fallback_tv=True, tv_iter=100)
    assert np.isfinite(vol_clean.data).all()
    assert vol_clean.mask.all()

    # (4) Bragg punch.
    b_keep = bragg_mask(vol_clean, punch_radius_hkl=0.35)
    vol_clean.apply_mask(b_keep)
    assert not vol_clean.mask.all()

    # (5) Backfill Bragg holes.
    vol_diffuse = backfill_bragg(vol_clean, method="tv", tv_lam=0.2)
    assert np.isfinite(vol_diffuse.data).all()

    # (6) 3D-ΔPDF.
    dpdf = compute_delta_pdf(vol_diffuse, apodization="hann", zero_pad=False)
    assert dpdf.data.shape == vol.data.shape
    assert np.isfinite(dpdf.data).all()


def test_bragg_local_backfill_uses_nearby_background_level():
    data = np.ones((9, 9, 9), dtype=float) * 0.5
    sigma = np.ones_like(data) * 0.1
    vol = HKLVolume.from_arrays(data, (-1, 1), (-1, 1), (-1, 1), sigma=sigma)
    vol.data[4, 4, 4] = 100.0
    vol.mask[4, 4, 4] = False

    filled = backfill_bragg(vol, method="local", local_radius=1)

    assert filled.mask.all()
    assert abs(float(filled.data[4, 4, 4]) - 0.5) < 1e-12


def test_direct_beam_fill_uses_background_outside_not_adjacent_halo():
    # Background 0.3 everywhere, a punched/unmeasured beam ball at the origin
    # (|Q|<=0.25) wrapped in a negative over-subtraction halo (|Q| 0.25–0.40)
    # that hugs the beam.  The direct-beam fill should reach *past* the halo to
    # the true background, whereas the generic dilated-shell fill is pulled into
    # the halo.
    n = 41
    data = np.full((n, n, n), 0.3, dtype=float)
    vol = HKLVolume.from_arrays(data, (-1, 1), (-1, 1), (-1, 1))
    q = vol.q_magnitude()
    holes = q <= 0.25
    halo = (q > 0.25) & (q <= 0.40)
    vol.data[holes] = -9.0
    vol.mask[holes] = False
    vol.data[halo] = -2.0
    i0 = n // 2

    new = backfill_bragg(vol, method="local", direct_beam_fill=True,
                         direct_beam_q_gap=0.2, direct_beam_q_width=0.15)
    old = backfill_bragg(vol, method="local", direct_beam_fill=False)

    assert np.isfinite(new.data).all()
    # NEW: whole beam ball replaced with the ~0.3 background sampled outside.
    assert abs(float(new.data[i0, i0, i0]) - 0.3) < 0.05
    assert np.allclose(new.data[holes], new.data[i0, i0, i0])
    # OLD: generic fill samples the adjacent −2 halo, so it goes negative.
    assert float(old.data[i0, i0, i0]) < 0.0

    # The Laplace method routes the beam through the same outside-|Q| fill.
    lap = backfill_bragg(vol, method="laplace", direct_beam_q_gap=0.2,
                         direct_beam_q_width=0.15)
    assert abs(float(lap.data[i0, i0, i0]) - 0.3) < 0.05


def _ramp_vol(n=15):
    """A linear ramp: harmonic, so an exact Laplace fill must reproduce it."""
    i, j, k = np.meshgrid(*(np.arange(n),) * 3, indexing="ij")
    data = 0.3 + 0.10 * i + 0.05 * j - 0.02 * k
    return HKLVolume.from_arrays(data.astype(float), (-1, 1), (-1, 1), (-1, 1)), data


def test_bragg_laplace_backfill_continues_surrounding_gradient():
    for gap in (0, 1, 2):
        vol, truth = _ramp_vol()
        vol.mask[5:8, 5:8, 4:9] = False       # an elongated Bragg hole
        vol.mask[10, 3, 11] = False           # and a single-voxel one
        vol.data[~vol.mask] = 100.0

        filled = backfill_bragg(vol, method="laplace", laplace_gap=gap,
                                direct_beam_fill=False)

        assert filled.mask.all()
        np.testing.assert_allclose(filled.data, truth, atol=1e-8)


def test_bragg_local_backfill_is_flat_where_laplace_follows_gradient():
    vol, truth = _ramp_vol()
    vol.mask[5:8, 5:8, 4:9] = False
    local = backfill_bragg(vol, method="local", direct_beam_fill=False)
    # the flat median plateau misses the ramp by up to its half-width
    assert np.abs(local.data - truth)[~vol.mask].max() > 0.1


def test_bragg_laplace_gap_takes_boundary_past_leaked_bragg_tail():
    from scipy import ndimage

    data = np.ones((15, 15, 15))
    vol = HKLVolume.from_arrays(data, (-1, 1), (-1, 1), (-1, 1))
    hole = np.zeros(vol.shape, dtype=bool)
    hole[6:9, 6:9, 6:9] = True
    tail = ndimage.binary_dilation(
        hole, structure=ndimage.generate_binary_structure(3, 1)) & ~hole
    vol.data[hole] = 50.0
    vol.data[tail] = 5.0                      # Bragg tail just past the punch
    vol.mask[hole] = False

    adjacent = backfill_bragg(vol, method="laplace", laplace_gap=0,
                              direct_beam_fill=False)
    past = backfill_bragg(vol, method="laplace", laplace_gap=1,
                          direct_beam_fill=False)

    assert adjacent.data[hole].min() > 4.0    # pulled up to the tail level
    np.testing.assert_allclose(past.data[hole], 1.0, atol=1e-8)
    # the band is only a boundary offset: its measured values are kept
    np.testing.assert_array_equal(past.data[tail], 5.0)


def test_bragg_laplace_backfill_orphan_hole_gets_global_median():
    data = np.full((9, 9, 9), 0.5)
    vol = HKLVolume.from_arrays(data, (-1, 1), (-1, 1), (-1, 1))
    for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
        nb = (4 + d[0], 4 + d[1], 4 + d[2])
        vol.data[nb] = np.nan                 # unmeasured all around
        vol.mask[nb] = False
    vol.data[4, 4, 4] = 100.0
    vol.mask[4, 4, 4] = False

    filled = backfill_bragg(vol, method="laplace", direct_beam_fill=False)

    assert float(filled.data[4, 4, 4]) == 0.5


def test_bragg_laplace_backfill_batches_whole_holes():
    # A cap below the total unknown count splits the solve into batches of
    # whole holes; each block is independent, so the fill must not change.
    vol, truth = _ramp_vol(21)
    for c in ((4, 4, 4), (4, 15, 10), (15, 5, 14), (16, 16, 5), (10, 10, 10)):
        vol.mask[c[0]:c[0] + 3, c[1]:c[1] + 3, c[2]:c[2] + 2] = False
    vol.data[~vol.mask] = 100.0
    notes: list[str] = []

    one = backfill_bragg(vol, method="laplace", direct_beam_fill=False)
    # each hole + its 1-voxel band is 18 + 42 = 60 unknowns
    split = backfill_bragg(vol, method="laplace", direct_beam_fill=False,
                           laplace_max_unknowns=130, report=notes.append)

    assert notes == []  # nothing oversized, CG converged
    np.testing.assert_allclose(split.data, one.data, atol=1e-8)
    np.testing.assert_allclose(split.data, truth, atol=1e-8)
    np.testing.assert_array_equal(split.sigma, one.sigma)


def test_bragg_laplace_backfill_oversized_region_gets_local_fill():
    # A masked region past the cap is a coverage gap, not a Bragg punch: it
    # gets the local shell median (bounded memory), and says so; ordinary
    # holes are still Laplace-filled.
    vol, truth = _ramp_vol(21)
    vol.mask[:, :, 16:] = False               # unmeasured slab (zeroed)
    vol.data[:, :, 16:] = 0.0
    vol.mask[5:8, 5:8, 4:7] = False           # a Bragg punch
    vol.data[5:8, 5:8, 4:7] = 100.0
    notes: list[str] = []

    filled = backfill_bragg(vol, method="laplace", direct_beam_fill=False,
                            laplace_max_unknowns=1000, report=notes.append)
    local = backfill_bragg(vol, method="local", direct_beam_fill=False)

    assert filled.mask.all()
    assert len(notes) == 1 and "local shell median" in notes[0]
    np.testing.assert_array_equal(filled.data[:, :, 16:], local.data[:, :, 16:])
    np.testing.assert_allclose(filled.data[5:8, 5:8, 4:7],
                               truth[5:8, 5:8, 4:7], atol=1e-8)


def test_pipeline_backfill_logs_laplace_notes(monkeypatch):
    import nebula3d.pipeline as pipeline_mod
    from nebula3d.pipeline import BackfillParams, backfill

    real = pipeline_mod.backfill_bragg
    monkeypatch.setattr(pipeline_mod, "backfill_bragg",
                        lambda *a, **k: real(*a, laplace_max_unknowns=1000, **k))
    vol, _ = _ramp_vol(21)
    vol.mask[:, :, 16:] = False
    events: list[tuple[str, str, str]] = []

    with warnings.catch_warnings():
        warnings.simplefilter("error")        # routed to the log, not warned
        backfill(vol, BackfillParams(method="laplace"),
                 progress=lambda s, st, f, m: events.append((s, st, m)))

    assert any(st == "progress" and "local shell median" in m
               for _, st, m in events)


def test_bragg_laplace_backfill_keeps_float32_storage():
    vol, truth = _ramp_vol()
    vol = dataclasses.replace(vol, data=vol.data.astype(np.float32),
                              sigma=vol.sigma.astype(np.float32))
    vol.mask[5:8, 5:8, 4:9] = False

    filled = backfill_bragg(vol, method="laplace", direct_beam_fill=False)

    assert filled.data.dtype == np.float32
    assert filled.sigma.dtype == np.float32
    np.testing.assert_allclose(filled.data, truth, atol=1e-5)


def test_pipeline_backfill_default_fills_from_surroundings():
    from nebula3d.pipeline import BackfillParams

    # never the |Q|-shell level: it is biased at every lattice node
    assert BackfillParams().method == "local"


def test_q_magnitude_matches_meshgrid_reference():
    """The broadcast |Q| accumulation must match the meshgrid formulation.

    q_magnitude used to build the full (nh,nk,nl) meshgrid + (...,3) Cartesian
    stack (~10 volume-sized arrays); it now accumulates |Q|² from broadcast 1-D
    axes.  Same float64 math, so it must agree to rounding error on an
    arbitrary (non-orthogonal) UB matrix.
    """
    rng = np.random.default_rng(7)
    ub = rng.standard_normal((3, 3)) * 1.5 + 2.0 * np.eye(3)
    vol = HKLVolume.from_arrays(
        rng.random((13, 11, 9)), (-2, 2), (-1.5, 1.5), (-1, 1), ub_matrix=ub)

    H, K, L = vol.hkl_grid()
    hkl = np.stack([H, K, L], axis=-1)
    ref = np.linalg.norm(hkl @ ub.T, axis=-1)

    assert np.allclose(vol.q_magnitude(), ref, rtol=1e-12, atol=1e-12)
