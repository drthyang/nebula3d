# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The pooled ring detector's noise floor where the counts end inside its |Q| range.

The ring stage bins |Q| from ``RingParams.q_min`` to ``q_max`` (1.5 to 10.5 Å⁻¹)
whatever the volume holds. The detector's noise, the MAD of the pooled radial
profile's bin-to-bin differences, ran over every bin, the empty ones too, which
it fills flat: a filled run's differences are zero, so once about half the bins
were empty the noise was exactly 0, every local maximum became a ring candidate,
and their keep-outs left a real ring's isotropy test a line through two flank
bins (a signal-to-noise of about 1e16, the curve check skipped). The noise now
comes from the measured bins only (``radial_background._measured_noise``;
finding B3, docs/evals/validation/review-findings/B3.json). The numbers called
"before" below were measured on main at 39b0835, before the fix.
"""

import dataclasses

import numpy as np
import pytest

from nebula3d.core import HKLVolume
from nebula3d.faults import add_rings, cut_coverage
from nebula3d.pipeline import RingParams, remove_rings
from nebula3d.preprocessing.radial_background import (
    _detect_rings,
    _fill_nan_1d,
    _measured_noise,
    _snip_baseline,
)
from nebula3d.preprocessing.sampling import trim_coverage_edge
from nebula3d.validation import build, case_named


def _loaded(vol: HKLVolume) -> HKLVolume:
    """*vol* as the pipeline's loader hands it to the ring stage: float64, with the
    edge of its measured coverage trimmed by one voxel (``load_input``)."""
    out = dataclasses.replace(vol, data=vol.data.astype(np.float64),
                              sigma=vol.sigma.astype(np.float64), mask=vol.mask.copy())
    trim_coverage_edge(out, 1)
    return out


def test_the_noise_is_unchanged_where_every_bin_is_measured():
    resid = np.random.default_rng(1).normal(0.0, 0.01, 300)
    every = np.ones(resid.size, dtype=bool)
    assert _measured_noise(resid, every) == (
        1.4826 * float(np.median(np.abs(np.diff(resid)))) / np.sqrt(2.0))


def test_no_two_adjacent_measured_bins_means_no_noise_floor_to_pass():
    resid = np.arange(6, dtype=np.float64)
    assert _measured_noise(resid, np.array([True, False, True, False, True, False])) == np.inf


def test_a_profile_whose_counts_end_early_keeps_its_noise_floor():
    """Counts ending at 5 Å⁻¹ leave 61 % of the 1.5-10.5 Å⁻¹ bins empty. Their
    flat fill makes the median difference, the old noise, exactly zero; over
    the measured bins it is the profile's own, and only the ring passes 6σ."""
    rng = np.random.default_rng(0)
    q_step = 0.04
    q_grid = 1.5 + q_step * (np.arange(225) + 0.5)
    pooled = (1.0 + 0.3 * np.exp(-(((q_grid - 3.0) / 1.5) ** 2))
              + 0.2 * np.exp(-0.5 * ((q_grid - 2.6) / 0.03) ** 2)
              + rng.normal(0.0, 0.01, q_grid.size))
    empty = q_grid > 5.0
    pooled[empty] = np.nan
    counts = np.where(empty, 0.0, 100.0)

    g = _fill_nan_1d(pooled)
    rough = _snip_baseline(g, max(3, int(round(0.24 / q_step))))
    assert empty.mean() > 0.6
    assert float(np.median(np.abs(np.diff(g - rough)))) == 0.0  # the old estimate
    assert _measured_noise(g - rough, ~empty) > 0.002

    centers, _ = _detect_rings(q_grid, pooled, q_step, 0.24, counts=counts, min_snr=6.0,
                               rel_prominence=0.0)
    assert len(centers) == 1 and abs(centers[0] - 2.6) <= q_step


@pytest.mark.parametrize("n", [81, 161])
def test_dev_coverage_raises_no_flood_of_ring_candidates(n):
    """The validation's dev-coverage case (counts cut at 4.51 Å⁻¹, no ring).
    Before: a noise of exactly 0 (151 of the 224 bins empty at n=161, 77 of 112
    at n=81); at n=161 24 candidates, 18 of them judged and rejected as the
    crystal's own scattering; at n=81 10, all listed in the coarse-grid notice
    as ring candidates."""
    vol = _loaded(build(case_named("dev-coverage"), n).raw)
    diag = remove_rings(vol, RingParams())._ring_diagnostics  # type: ignore[attr-defined]
    assert len(diag["shells"]) + len(diag["rejected_shells"]) <= 1
    assert not diag.get("unconfirmed_at_grid")


def test_a_ring_the_flood_crowded_is_judged_on_full_flanks():
    """The dev crystal at n=161 with no counts past 4 Å⁻¹ and rings at 2.2 and
    3.3 Å⁻¹. Before: candidates at 2.00 and 2.41 Å⁻¹ kept all but one bin a
    side out of the 2.2 ring's flanks; its line ran through those two bins, a
    signal-to-noise of 9.9e15, and the curve check (a quadratic through four
    flank bins or more) was skipped. Now it has two clean bins a side, the
    most this grid's flank takes, so both checks run."""
    base = build(case_named("dev-control"), 161).raw
    vol = _loaded(add_rings(cut_coverage(base, 4.0), [2.2, 3.3], 0.5, 0.025))
    diag = remove_rings(vol, RingParams())._ring_diagnostics  # type: ignore[attr-defined]
    found = {round(s["q_center"], 1): s["isotropy"] for s in diag["shells"]}
    assert sorted(found) == [2.2, 3.3]
    ring = found[2.2]
    assert ring["is_ring"]
    assert 10.0 < ring["snr"] < 1e3
    assert ring["beyond_curve"] is not None and ring["beyond_curve"] > 0.25


def test_the_coarse_grid_remedy_subtracts_no_flood_shell():
    """#60's notice at n=81 offers ``pooled_confirm_rings=False`` to subtract
    every candidate. On dev-coverage, which holds no ring, it subtracted 10
    shells at n=81 before, at 1.70 to 3.96 Å⁻¹ (9.4 % of |I|): all of them the
    flood. Now there is no candidate, so nothing is subtracted."""
    vol = _loaded(build(case_named("dev-coverage"), 81).raw)
    out = remove_rings(vol, RingParams(pooled_confirm_rings=False))
    diag = out._ring_diagnostics  # type: ignore[attr-defined]
    assert diag["shells"] == []
    assert diag["removed_fraction"] == 0.0
    measured = vol.mask & np.isfinite(vol.data)
    assert np.array_equal(out.data[measured], vol.data[measured])
