# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Profile-matched Bragg punch (``punch_footprint="profile"``).

The synthetic lattice has CORELLI-like voxels (0.039 Å⁻¹) and peaks of known
shape: a Gaussian core (σ = 0.03 Å⁻¹) plus an exponential tail along each
peak's polar axis θ̂ only (2 % of the peak, decay length 0.08 Å⁻¹) — the
c-axis-mosaic tail of the TbTi3Bi4 data.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from nebula3d.analysis.bragg import (
    BraggRemover,
    _monotone_profile,
    _mosaic_template,
    _profile_reach,
)
from nebula3d.core import HKLVolume
from nebula3d.pipeline import PunchParams, punch_bragg

A_CELL = 8.0
RS = 2 * np.pi / A_CELL  # Å⁻¹ per r.l.u.
STEP = 0.05
EXTENT = 3.0
CORE, TAIL, DECAY = 0.03, 0.02, 0.08
BG, NOISE = 0.2, 0.01
WEAK_NODE = (1, 2, 1)


def _axis() -> np.ndarray:
    return np.round(np.arange(-EXTENT, EXTENT + STEP / 2, STEP), 10)


def _index(hkl) -> tuple[int, int, int]:
    ax = _axis()
    return tuple(int(np.argmin(np.abs(ax - v))) for v in hkl)  # type: ignore[return-value]


def _lattice(nodes, amp, seed: int = 11) -> HKLVolume:
    ax = _axis()
    n = ax.size
    rng = np.random.default_rng(seed)
    data = BG + NOISE * rng.standard_normal((n, n, n))
    ub = RS * np.eye(3)
    w = int(np.ceil(0.5 / (RS * STEP)))
    frame_of = BraggRemover()._spherical_frame
    proto = HKLVolume.from_arrays(np.zeros((2, 2, 2)), (-1, 1), (-1, 1), (-1, 1), ub_matrix=ub)
    for node in nodes:
        frame = frame_of(proto, tuple(float(v) for v in node))
        r_mat = np.column_stack(frame)
        idx = _index(node)
        sl = tuple(slice(max(0, i - w), min(n, i + w + 1)) for i in idx)
        g = np.meshgrid(*(ax[s] - v for s, v in zip(sl, node)), indexing="ij")
        loc = np.einsum("ij,j...->i...", r_mat.T @ ub, np.array(g))  # (ρ, θ, φ) offsets
        d2 = (loc ** 2).sum(0)
        a = amp(node)
        data[sl] += a * np.exp(-0.5 * d2 / CORE**2)
        data[sl] += a * TAIL * np.exp(-np.abs(loc[1]) / DECAY) * np.exp(
            -0.5 * (loc[0] ** 2 + loc[2] ** 2) / CORE**2)
    return HKLVolume.from_arrays(data, (-EXTENT, EXTENT), (-EXTENT, EXTENT),
                                 (-EXTENT, EXTENT), sigma=np.full(data.shape, NOISE),
                                 ub_matrix=ub)


def _nodes():
    r = range(-3, 4)
    return [(h, k, l) for h in r for k in r for l in r if (h, k, l) != (0, 0, 0)]


def _amp(node) -> float:
    if node == WEAK_NODE:
        return 0.3
    return 30.0 + 270.0 * ((7 * node[0] + 3 * node[1] + 5 * node[2]) % 11) / 10.0


@pytest.fixture(scope="module")
def lattice() -> HKLVolume:
    return _lattice(_nodes(), _amp)


def _remover(**kw) -> BraggRemover:
    base = dict(mode="integer", min_intensity=0.25, min_prominence=0.05,
                min_significance=5.0, punch_footprint="profile", profile_q_bins=1,
                punch_incident_beam=False)
    base.update(kw)
    return BraggRemover(**base)


def test_profile_reach_interpolates_in_log():
    d = np.array([0.0, 0.1, 0.2])
    p = np.array([1.0, 1e-2, 1e-4])
    assert _profile_reach(d, p, 1e-3) == pytest.approx(0.15)
    assert _profile_reach(d, p, 1.0) == 0.0
    assert _profile_reach(d, p, 1e-6) == pytest.approx(0.2)  # never that low


def test_monotone_profile_extends_the_tail_exponentially():
    d = np.linspace(0, 0.5, 26)
    med = np.exp(-d / 0.1)
    med[15:] = np.nan  # unsampled beyond 0.28 Å⁻¹
    p = _monotone_profile(d, med)
    assert np.all(np.diff(p) <= 0)
    assert p[20] == pytest.approx(np.exp(-d[20] / 0.1), rel=0.05)


def test_mosaic_template_drops_a_halo_common_to_all_axes():
    d = np.linspace(0, 0.5, 51)
    core = np.exp(-0.5 * (d / 0.03) ** 2)
    halo = 0.01 / (1 + (d / 0.03) ** 2)  # thermal-diffuse-like, every direction
    tail = 0.02 * np.exp(-d / 0.08)  # mosaic, along θ̂ only
    raw = np.stack([np.maximum(core, halo), np.maximum(core, halo + tail),
                    np.maximum(core, halo)])
    t = _mosaic_template(d, raw)
    # along ρ̂ and φ̂ only the core is left; along θ̂ the mosaic tail
    assert _profile_reach(d, t[0], 1e-3) == pytest.approx(0.03 * np.sqrt(2 * np.log(1e3)), rel=0.1)
    assert _profile_reach(d, t[2], 1e-3) < 0.13
    assert _profile_reach(d, t[1], 1e-3) == pytest.approx(DECAY * np.log(20), rel=0.1)


def test_learned_profile_finds_the_tail_axis(lattice):
    r = _remover()
    peaks, _, profile = r._detect(lattice)
    assert profile is not None and sum(profile.n_peaks) >= 20
    q = float(np.median(profile.q_centers))
    rho, theta, phi = profile.radii(q, 1e-3)
    assert theta > 2 * rho and theta > 2 * phi
    # the tail's own decay: TAIL·exp(−d/DECAY) = 1e-3 (the thin cylinders the
    # profile is sampled in average the tail a little below TAIL)
    assert theta == pytest.approx(DECAY * np.log(TAIL / 1e-3), rel=0.2)
    # the core is Gaussian: ρ̂ reach ~ σ √(2 ln 1000), the voxel-sampled σ
    assert rho == pytest.approx(CORE * np.sqrt(2 * np.log(1e3)), rel=0.35)
    assert all(p.profile_shape for p in peaks)


def _punched_at(r: BraggRemover, vol: HKLVolume, node, axis: int, dist: float) -> bool:
    frame = r._spherical_frame(vol, tuple(float(v) for v in node))
    hkl = np.asarray(node, float) + np.linalg.solve(vol.ub_matrix, dist * frame[axis])
    keep = r.build_mask(vol)
    return not keep[_index(hkl)]


def test_bright_peak_is_punched_along_its_tail_only(lattice):
    r = _remover(profile_n_sigma=1.0)
    # the brightest in-plane node away from the volume edge (θ̂ = c*)
    node = max((n for n in _nodes() if max(map(abs, n)) <= 2 and n[2] == 0), key=_amp)
    a = _amp(node)
    # the tail stays above 1σ out to DECAY·ln(TAIL·a/σ) along θ̂ (capped at 0.5)
    reach = min(DECAY * np.log(TAIL * a / NOISE), 0.5)
    assert _punched_at(r, lattice, node, 1, 0.6 * reach)
    assert not _punched_at(r, lattice, node, 0, 0.6 * reach)
    assert not _punched_at(r, lattice, node, 2, 0.6 * reach)


def test_weak_peak_gets_the_resolution_floor(lattice):
    r = _remover()
    peaks, _, _ = r._detect(lattice)
    weak = next(p for p in peaks if p.source_node_hkl == WEAK_NODE)
    floor = np.asarray(r.punch_spherical_radii)
    m_q = lattice.ub_matrix @ np.linalg.inv(weak.shape_hkl) @ lattice.ub_matrix.T
    frame = np.column_stack(r._spherical_frame(lattice, weak.center_hkl))
    radii = np.sqrt(np.diag(frame.T @ m_q @ frame))
    assert np.all(radii >= floor - 1e-9)
    assert np.all(radii <= 1.15 * floor)


def test_too_few_peaks_falls_back_to_the_ellipsoid():
    few = [(1, 0, 0), (0, 2, 0), (2, 1, 1), (0, 1, 2), (1, 1, 0)]
    vol = _lattice(few, lambda n: 200.0)
    r = _remover()
    peaks, _, profile = r._detect(vol)
    assert profile is None
    assert peaks and not any(p.profile_shape for p in peaks)
    ellipsoid = dataclasses.replace(r, punch_footprint="ellipsoid")
    assert np.array_equal(r.build_mask(vol), ellipsoid.build_mask(vol))


def test_unknown_footprint_is_rejected():
    with pytest.raises(ValueError, match="punch_footprint"):
        BraggRemover(punch_footprint="blob")


def test_pipeline_records_the_learned_profile(lattice):
    out = punch_bragg(lattice, PunchParams(search_exclude_h_fractions=None))
    prof = out._bragg_profile  # type: ignore[attr-defined]
    assert prof["punch_footprint"] == "profile"
    fp = prof["footprint_profile"]
    assert fp is not None and fp["axes"] == ["ρ", "θ", "φ"]
    assert {r["fit_kind"] for r in prof["peaks"]} == {"profile"}
