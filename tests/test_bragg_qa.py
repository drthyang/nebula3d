# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Punch / backfill QA metrics (``nebula3d.analysis.bragg_qa``)."""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from nebula3d.analysis.bragg_qa import (
    detection_significance,
    hole_census,
    hole_rings,
    lattice_points,
    score_against_truth,
    summarise_rings,
)
from nebula3d.core import HKLVolume
from nebula3d.demo import demo_volume
from nebula3d.pipeline import PunchParams, punch_bragg

N = 41


def _flat(level: float = 1.0, noise: float = 0.05, seed: int = 3) -> HKLVolume:
    rng = np.random.default_rng(seed)
    data = level + noise * rng.standard_normal((N, N, N))
    # 0.1 r.l.u. voxels of 0.035 Å⁻¹, about a CORELLI grid's.
    return HKLVolume.from_arrays(data, (-2, 2), (-2, 2), (-2, 2),
                                 sigma=np.full((N, N, N), noise),
                                 ub_matrix=0.35 * np.eye(3))


def _ball(centre: tuple[int, int, int], r: float) -> np.ndarray:
    i, j, k = np.ogrid[:N, :N, :N]
    return ((i - centre[0]) ** 2 + (j - centre[1]) ** 2 + (k - centre[2]) ** 2) <= r * r


def test_hole_census_counts_and_merging():
    vol = _flat()
    punched = _ball((10, 10, 10), 2) | _ball((30, 30, 30), 2) | _ball((30, 30, 33), 2)
    c = hole_census(vol, punched, large=(40,), top=2)
    assert c["n_holes"] == 2  # the last two balls touch
    assert c["punched_voxels"] == int(punched.sum())
    merged = int((_ball((30, 30, 30), 2) | _ball((30, 30, 33), 2)).sum())
    assert c["share_in_holes_over"]["40"] == pytest.approx(merged / punched.sum())
    assert c["largest"][0]["voxels"] == merged


def test_rings_see_a_one_sided_leak_and_the_fill_step():
    vol = _flat()
    hole = _ball((20, 20, 20), 3)
    data = vol.data.copy()
    data[hole] += 50.0  # the peak under the punch
    # A tail leaking past the hole on one side only (+H), one voxel deep.
    shell1 = _ball((20, 20, 20), 4) & ~hole
    data[shell1 & (np.arange(N)[:, None, None] > 22)] += 1.0
    punched_vol = dataclasses.replace(vol, data=data, mask=~hole)
    filled = np.where(hole, 0.8, data)  # a fill 0.2 under the level
    s = summarise_rings(hole_rings(punched_vol, hole, filled))
    row = s["all"]
    assert row["n_holes"] == 1
    assert abs(row["ring_excess_median"][0]) < 3  # the shell median hides it …
    assert row["frac_ring1_p90_over_3sigma"] == 1.0  # … the p90 does not
    assert row["fill_minus_reference"] == pytest.approx(-0.2 / 0.05, rel=0.25)


def test_detection_significance_matches_the_gate():
    vol = _flat(noise=0.05)
    data = vol.data.copy()
    data[20, 20, 20] += 2.0
    vol = dataclasses.replace(vol, data=data)
    z = detection_significance(vol, [(0.0, 0.0, 0.0), (1.0, 1.0, 1.0)])
    assert z[0] > 8 and abs(z[1]) < 5


def test_lattice_points_are_the_integer_vectors():
    ax = np.linspace(-2.0, 2.0, 17)
    pts = lattice_points((17, 17, 17), (ax, ax, ax))
    vals = np.stack([ax[p] for p in pts])
    assert vals.shape[1] == 5**3 - 1  # −2..2 on each axis, origin left out
    assert np.allclose(vals, np.round(vals))
    assert not np.any(np.all(vals == 0, axis=0))


def test_truth_score_of_an_oracle_fill():
    parts = ("background", "sro", "tds")
    vol = demo_volume(N, components=(*parts, "bragg", "beam"))
    diffuse = demo_volume(N, components=parts, noise=False).data
    bragg = demo_volume(N, components=("bragg",), noise=False).data
    beam = demo_volume(N, components=("beam",), noise=False).data
    out = punch_bragg(vol, PunchParams(search_exclude_h_fractions=None))
    punched = out._punched  # type: ignore[attr-defined]
    # Fill every hole with the true diffuse: no fill error left.
    filled = dataclasses.replace(vol, data=np.where(punched, diffuse, vol.data),
                                 mask=np.ones(vol.shape, dtype=bool))
    s = score_against_truth(vol, punched, filled, bragg=bragg, diffuse=diffuse,
                            beam=beam)
    assert s["fill_bias"] == pytest.approx(0.0, abs=1e-12)
    assert s["fill_rms"] == pytest.approx(0.0, abs=1e-12)
    assert 0.0 <= s["bragg_left"] < 0.1
    assert 0.0 <= s["collateral"] <= 1.0
    # What is left is the Bragg outside the holes: small next to the signal.
    assert s["pdf_rel_rms"] < 0.5
    # Leaving the Bragg peaks in (no punch at all) is far worse.
    none = np.zeros(vol.shape, dtype=bool)
    raw = dataclasses.replace(vol, mask=np.ones(vol.shape, dtype=bool))
    s0 = score_against_truth(vol, none, raw, bragg=bragg, diffuse=diffuse, beam=beam)
    assert s0["bragg_left"] == pytest.approx(1.0)
    assert s0["pdf_rel_rms"] > 5 * s["pdf_rel_rms"]
