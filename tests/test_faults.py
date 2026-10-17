# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""Faults injected into the synthetic demo volume are found by the checks that
should find them: a turned UB by the UB fit, a shifted origin as offsets no UB
removes, a coverage cut by the raw counts' edge, rings at their |Q|."""

import numpy as np
import pytest

from nebula3d import faults
from nebula3d.analysis import ub_refine
from nebula3d.analysis.coverage import q_coverage
from nebula3d.demo import demo_volume
from nebula3d.server.volumes import voxel_q


@pytest.fixture(scope="module")
def vol():
    return demo_volume(121, seed=3)


def test_rotation_is_a_proper_rotation_by_the_angle():
    r = faults.rotation((1, 1, 0), 30)
    assert np.allclose(r @ r.T, np.eye(3))
    assert np.linalg.det(r) == pytest.approx(1)
    assert np.degrees(np.arccos((np.trace(r) - 1) / 2)) == pytest.approx(30)


def test_a_turned_ub_is_found_by_the_fit(vol):
    clean = ub_refine.refine_ub(vol, fit="both").fit
    turned = faults.misorient(vol, 0.5, (1, 1, 0))
    assert np.allclose(turned.ub_matrix, vol.ub_matrix)  # the file keeps the UB it had
    fit = ub_refine.refine_ub(turned, fit="both").fit
    assert clean.angle_deg < 0.02
    assert 0.4 < fit.angle_deg < 0.6
    assert fit.rms < 0.2 * fit.rms_start  # the UB explains the offsets


def test_a_shifted_origin_leaves_offsets_no_ub_removes(vol):
    fit = ub_refine.refine_ub(faults.shift_origin(vol, (0.03, 0.0, 0.0)), fit="both").fit
    assert fit.angle_deg < 0.02
    # The tool's rule (web/src/llm/tools ub_check: unexplainedOffset): off by more
    # than a quarter voxel, and the best UB removes less than a fifth of it.
    assert fit.rms_start > 0.25 * voxel_q(vol)
    assert fit.rms > 0.8 * fit.rms_start
    clean = ub_refine.refine_ub(vol, fit="both").fit
    assert clean.rms_start < 0.25 * voxel_q(vol)  # the clean volume does not trip it


def test_the_mean_offset_is_the_origin_shift_and_zero_for_a_turned_ub(vol):
    """docs/pilot-review.md finding 2: a shifted origin's size is the peaks' mean
    offset from their nodes, before the fit and after it; a UB error averages out."""
    shift = (0.03, 0.02, 0.0)
    r = ub_refine.refine_ub(faults.shift_origin(vol, shift), fit="both")
    m = ub_refine.mean_offset(r.fit, r.centres)
    assert m.n == r.fit.n_used
    assert m.before == pytest.approx(shift, abs=3e-3)
    assert m.after == pytest.approx(shift, abs=3e-3)  # no UB (a linear map) removes it
    assert max(m.standard_error) < 1e-3
    turned = ub_refine.refine_ub(faults.misorient(vol, 0.5, (1, 1, 0)), fit="both")
    t = ub_refine.mean_offset(turned.fit, turned.centres)
    assert np.abs(t.after).max() < 1e-3  # the fit removes the turn
    assert np.abs(t.before).max() < 3e-3  # and it averages out over the nodes
    clean = ub_refine.refine_ub(vol, fit="both")
    assert np.abs(ub_refine.mean_offset(clean.fit, clean.centres).before).max() < 1e-3


def test_voxel_q_is_the_finest_step_in_q(vol):
    step = vol.h_axis[1] - vol.h_axis[0]
    assert voxel_q(vol) == pytest.approx(np.linalg.norm(vol.ub_matrix[:, 0]) * step)


def test_a_coverage_cut_moves_the_raw_counts_edge(vol):
    assert q_coverage(vol).q_max_edge is None  # counts to the corners
    assert q_coverage(faults.cut_coverage(vol, 4.0)).q_max_edge == pytest.approx(4.0, abs=0.1)


def test_rings_sit_at_their_q(vol):
    ringed = faults.add_rings(vol, [2.5, 3.7], amplitude=1.0, width=0.03)
    q = vol.q_magnitude()
    added = ringed.data - vol.data
    for q0 in (2.5, 3.7):
        assert added[(np.abs(q - q0) < 0.01) & vol.mask].mean() > 0.9
    assert added[(np.abs(q - 3.1) < 0.01) & vol.mask].mean() < 1e-3


def test_faults_leave_unmeasured_voxels_as_the_loader_does(vol):
    cut = faults.cut_coverage(vol, 4.0)
    assert not cut.mask[vol.q_magnitude() > 4.0].any()
    assert (cut.data[~cut.mask] == 0).all() and (cut.sigma[~cut.mask] == 0).all()
    shifted = faults.shift_origin(vol, (0.2, 0.0, 0.0))
    assert not shifted.mask[0].any()  # what came in from outside the box
    assert (shifted.data[~shifted.mask] == 0).all()


def test_the_ring_stage_confirms_and_removes_injected_rings():
    # The held-out evals' crystal with powder rings put in at known |Q|: the
    # default ring stage confirms exactly those two and removes them, run live
    # (web/src/llm/evals/heldout.test.ts reads the same tools from a recording).
    from nebula3d.demo import DemoModel, demo_volume
    from nebula3d.preprocessing import PooledRingConfig, fit_pooled_rings

    base = demo_volume(121, seed=7, model=DemoModel(a=3.9, sro_amp=0.09, ring_amp=0.0),
                       dtype=np.float32)
    ringed = faults.add_rings(base, (2.45, 3.65), amplitude=0.6, width=0.03)
    out = fit_pooled_rings(ringed, PooledRingConfig())
    confirmed = sorted(s["q_center"] for s in out.diagnostics["shells"])
    assert len(confirmed) == 2
    assert confirmed == pytest.approx([2.45, 3.65], abs=0.05)
    q = base.q_magnitude()
    for q0 in (2.45, 3.65):
        shell = base.mask & (np.abs(q - q0) < 0.09)
        injected = float((ringed.data - base.data)[shell].sum())
        left = float((out.cleaned.data - base.data)[shell].sum())
        assert abs(left) < 0.15 * injected, q0
