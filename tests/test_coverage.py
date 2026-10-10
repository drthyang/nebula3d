"""Where a volume's counts begin and end in |Q| (analysis.coverage)."""

import numpy as np
import pytest

from nebula3d.analysis.coverage import box_extent_q, q_coverage
from nebula3d.core import HKLVolume


def _shell_vol(q_lo: float, q_hi: float, ub=None) -> HKLVolume:
    """Counts only between |Q| = q_lo and q_hi; zero and masked outside, as a
    NeXus Viewer export leaves unmeasured space."""
    ub = 2 * np.pi * np.eye(3) / 4.0 if ub is None else ub
    vol = HKLVolume.from_arrays(np.zeros((61, 61, 61)), (-3, 3), (-3, 3), (-3, 3), ub_matrix=ub)
    q = vol.q_magnitude()
    held = (q >= q_lo) & (q <= q_hi)
    vol.data[...] = np.where(held, 1.0 + 0.1 * np.cos(q), 0.0)
    vol.mask[...] = held
    return vol


def test_edges_where_most_voxels_stop_holding_counts():
    vol = _shell_vol(0.8, 3.5)
    c = q_coverage(vol, q_step=0.05)
    assert c.q_min_edge == pytest.approx(0.8, abs=0.05)
    assert c.q_max_edge == pytest.approx(3.5, abs=0.05)
    assert c.full_q_min == pytest.approx(0.8, abs=0.1)
    assert c.full_q_max == pytest.approx(3.5, abs=0.1)
    # The box face: h = 3 r.l.u. at 2π/4 Å⁻¹ per r.l.u.; the corner √3 further.
    assert c.box_q == pytest.approx(3 * 2 * np.pi / 4)
    assert c.box_corner_q == pytest.approx(np.sqrt(3) * 3 * 2 * np.pi / 4)


def test_measured_from_the_origin_and_to_the_corner_has_no_edges():
    vol = _shell_vol(0.0, 100.0)
    c = q_coverage(vol, q_step=0.1)
    assert c.q_min_edge is None and c.q_max_edge is None
    assert np.all(c.counted == 1.0)


def test_a_zero_or_unmasked_voxel_holds_no_counts():
    vol = _shell_vol(0.0, 100.0)
    vol.data[:, :, :30] = 0.0  # measured but empty: no counts
    vol.mask[:, :, 30:] = False  # counts, but masked out
    c = q_coverage(vol, q_step=0.1)
    assert c.counted.max() == 0.0
    assert c.q_min_edge is None and c.q_max_edge is None


def test_box_face_on_a_hexagonal_cell():
    """The nearest face of an oblique box is |f| / ‖row of UB⁻¹‖, not |UB·f|."""
    a, cpar = 8.0, 10.0
    # Reciprocal basis of a hexagonal cell (γ = 120°), 2π included.
    astar = 4 * np.pi / (np.sqrt(3) * a)
    ub = np.array([[astar, astar * np.cos(np.radians(60)), 0.0],
                   [0.0, astar * np.sin(np.radians(60)), 0.0],
                   [0.0, 0.0, 2 * np.pi / cpar]])
    vol = HKLVolume.from_arrays(np.zeros((21, 21, 21)), (-5, 5), (-5, 5), (-2, 2), ub_matrix=ub)
    box_q, corner_q = box_extent_q(vol)
    # Along c* the face is l = 2: 2 · 2π/10.  In-plane faces sit at
    # 5 · a*·sin(60°) from the origin, farther than that here.
    assert box_q == pytest.approx(2 * 2 * np.pi / cpar)
    assert corner_q > box_q
