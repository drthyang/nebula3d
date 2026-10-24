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


#: A cubic cell of 4 Å over ±3 r.l.u.: the box's nearest face at 4.712 Å⁻¹.
_CUBE_UB = 2 * np.pi * np.eye(3) / 4.0
#: Where the counts of cut_volume end, inside the box.
Q_CUT = 4.4


def cut_volume(stored: str) -> HKLVolume:
    """Counts out to |Q| = 4.4 Å⁻¹ in a box whose nearest face is at 4.712, and
    past them unmeasured space stored one of three ways: "masked", zero and
    masked (as the loader leaves a file's NaN or masked voxels); "nan", NaN
    and unmasked; "zeros", zero and unmasked (a reduction that writes zeros
    where nothing was measured, which marks them measured)."""
    vol = HKLVolume.from_arrays(np.zeros((61, 61, 61)), (-3, 3), (-3, 3), (-3, 3),
                                ub_matrix=_CUBE_UB)
    q = vol.q_magnitude()
    held = q <= Q_CUT
    vol.data[...] = np.where(held, 1.0 + 0.1 * np.cos(q), 0.0)
    if stored == "masked":
        vol.mask[...] = held
    elif stored == "nan":
        vol.data[~held] = np.nan
    else:
        assert stored == "zeros"
    return vol


@pytest.mark.parametrize("stored", ["masked", "nan", "zeros"])
def test_the_counts_end_where_they_end_however_unmeasured_space_is_stored(stored):
    """Known answer: the counts' edges and full coverage are the cut's, to a
    shell, whether the volume masks unmeasured space, stores NaN or stores zeros."""
    c = q_coverage(cut_volume(stored))
    assert c.q_step == 0.1
    assert c.q_max_edge == pytest.approx(Q_CUT, abs=c.q_step / 2)
    assert c.full_q_max == pytest.approx(Q_CUT - c.q_step / 2)  # the last whole shell, [4.3, 4.4)
    assert c.q_min_edge is None  # counts from the origin
    assert c.box_q == pytest.approx(3 * 2 * np.pi / 4.0)
    assert c.counted.tolist() == q_coverage(cut_volume("masked")).counted.tolist()


def test_zeros_stored_are_measured_but_hold_no_counts():
    """Known answer: masked or NaN, the measured voxels end with the counts; zeros
    stored unmasked are measured, so the measured voxels fill the box past them."""
    for stored in ("masked", "nan"):
        c = q_coverage(cut_volume(stored))
        assert c.measured_q_max == c.full_q_max, stored
        assert c.measured.tolist() == c.counted.tolist(), stored
    zeros = q_coverage(cut_volume("zeros"))
    assert np.all(zeros.measured == 1.0)
    assert zeros.measured_q_max == zeros.q[-1] > zeros.box_q > zeros.full_q_max


def test_the_window_support_follows_the_measured_voxels_not_the_counts():
    """What qmax_coverage's reach rests on: with the volume's mask as its support
    (the pipeline's default), the ΔPDF's window is fitted to where the measured
    voxels end, masked or NaN; zeros stored unmasked are data to it, so it is
    not fitted at all and records no weight on unmeasured space."""
    from nebula3d.analysis.delta_pdf import compute_delta_pdf

    for stored in ("masked", "nan"):
        vol = cut_volume(stored)
        d = compute_delta_pdf(vol, support=vol.mask)
        assert d.window_ellipsoid is not None and d.window_ellipsoid.scale < 1, stored
        assert d.window_open_weight is not None and d.window_open_weight <= 1e-3, stored
    zeros = cut_volume("zeros")
    d = compute_delta_pdf(zeros, support=zeros.mask)
    assert d.window_open_weight is None
    assert d.window_ellipsoid is None or d.window_ellipsoid.scale == 1


def test_the_shells_width_is_given():
    assert q_coverage(_shell_vol(0.8, 3.5), q_step=0.05).q_step == 0.05


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


def test_a_face_through_the_origin_is_no_box_face():
    # A half-space volume (h ≥ 0): its h = 0 face would make box_q 0, though
    # the shells carry on in the half it holds.
    ub = 2 * np.pi / 4.0 * np.eye(3)
    half = HKLVolume.from_arrays(np.ones((31, 61, 61)), (0, 3), (-3, 3), (-3, 3), ub_matrix=ub)
    box_q, corner_q = box_extent_q(half)
    assert box_q == pytest.approx(3 * 2 * np.pi / 4.0)
    assert q_coverage(half).box_q == pytest.approx(box_q)
    assert corner_q == pytest.approx(np.sqrt(27) * 2 * np.pi / 4.0)
