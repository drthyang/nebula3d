"""The raw coverage-edge trim, by the NeXus Viewer's rule (its mask's "Edge erosion").

A measured voxel next to unmeasured space is only partly covered by the
detectors, so its normalisation is tiny and its value unreliable: the edge trim
unmeasures every measured voxel within r voxels (Chebyshev distance: the
(2r + 1)³ box) of an unmeasured one, the box's own faces not an edge.  The
viewer's ``js/mask.js`` ``edgeMask`` is the reference: a voxel is unmeasured
when it is masked or not finite, and the fixture
``tests/fixtures/viewer_edge_trim.json`` holds what the viewer's own code kept
of the inputs :func:`edge_case` builds, for r = 0 to 3, run under node by
``scripts/viewer_edge_trim_fixture.py``.  NEBULA3D's trim must keep the same
voxels, bit for bit.
"""

from __future__ import annotations

import base64
import json
import zlib
from pathlib import Path

import numpy as np
import pytest

import nebula3d
from nebula3d.core import HKLVolume
from nebula3d.demo import demo_volume
from nebula3d.pipeline import PipelineParams, load_input
from nebula3d.preprocessing import trim_coverage_edge
from nebula3d.symmetry import GridSymmetry, laue_group
from nebula3d.utils import ub_from_lattice
from tests.test_symmetry_average import park_miller

FIXTURE = Path(__file__).parent / "fixtures" / "viewer_edge_trim.json"

#: The fixture's cases and radii: the viewer's "Edge erosion" field takes any
#: radius, and NEBULA3D offers 0 to 3 voxel layers (1 by default, as the
#: viewer's field starts).
EDGE_CASES: tuple[str, ...] = ("demo", "cubic", "hexagonal")
RADII: tuple[int, ...] = (0, 1, 2, 3)


def _unmeasure(vol: HKLVolume, covered: np.ndarray) -> HKLVolume:
    vol.mask &= covered
    vol.data[~vol.mask] = 0.0
    vol.sigma[~vol.mask] = 0.0
    return vol


def _demo_case() -> HKLVolume:
    """The demo crystal (41³ over ±2 r.l.u.) with a measured coverage's
    shapes: the box corners and a beam stop unmeasured, a missing wedge in
    the upper half, two detector gaps, a few scattered voxels, and a few
    measured voxels NaN (unmeasured to the viewer)."""
    vol = demo_volume(41, extent=2.0, noise=False, dtype=np.float32)
    q = vol.q_magnitude()
    n = vol.data.shape[0]
    i, j, k = np.meshgrid(*(np.arange(n) - n // 2,) * 3, indexing="ij")
    phi = np.degrees(np.arctan2(j, i)) % 360.0
    covered = (q < 0.92 * q.max()) & (q >= 0.4) & ~((phi > 30) & (phi < 75) & (k > 4))
    covered[:, 7, :] = False
    covered[25, :, :12] = False
    u = park_miller(5, vol.data.size).reshape(vol.data.shape)
    _unmeasure(vol, covered & (u >= 0.0005))
    vol.data[(u > 0.999) & vol.mask] = np.nan
    return vol


def _cubic_case() -> HKLVolume:
    """A cubic cell (25³ over ±1.2 r.l.u.) measured but for the corners, ten
    holes of two to four voxels' radius at Park–Miller positions, and a few
    measured voxels NaN."""
    n = 25
    u = park_miller(17, n ** 3 + 40)
    data = (1.0 + u[:n ** 3]).reshape(n, n, n).astype(np.float32)
    vol = HKLVolume.from_arrays(data, (-1.2, 1.2), (-1.2, 1.2), (-1.2, 1.2),
                                sigma=np.full((n, n, n), 0.1, dtype=np.float32),
                                ub_matrix=ub_from_lattice(5.0, 5.0, 5.0), dtype=np.float32)
    idx = np.indices((n, n, n))
    covered = vol.q_magnitude() < 0.95 * vol.q_magnitude().max()
    for c in range(10):
        centre = (u[n ** 3 + 4 * c:n ** 3 + 4 * c + 3] * (n - 1)).round()
        radius = 2 + 2 * u[n ** 3 + 4 * c + 3]
        covered &= np.max(np.abs(idx - centre[:, None, None, None]), axis=0) > radius
    _unmeasure(vol, covered)
    vol.data[(u[:n ** 3].reshape(n, n, n) > 0.998) & vol.mask] = np.nan
    return vol


def _hexagonal_case() -> HKLVolume:
    """A hexagonal cell (31 × 31 × 21 over ±1.5 r.l.u. in H and K, ±1 in L),
    unequal box sides: the corners beyond a sphere, a beam stop and a 40°
    wedge of azimuths unmeasured, a few measured voxels NaN."""
    ub = ub_from_lattice(4.2, 4.2, 6.8, 90.0, 90.0, 120.0)
    shape = (31, 31, 21)
    u = park_miller(23, int(np.prod(shape))).reshape(shape)
    vol = HKLVolume.from_arrays((5.0 * u).astype(np.float32), (-1.5, 1.5), (-1.5, 1.5),
                                (-1.0, 1.0), sigma=np.full(shape, 0.2, dtype=np.float32),
                                ub_matrix=ub, dtype=np.float32)
    q = vol.q_magnitude()
    hh, kk = np.meshgrid(vol.h_axis, vol.k_axis, indexing="ij")
    phi = np.degrees(np.arctan2(ub[1, 0] * hh + ub[1, 1] * kk,
                                ub[0, 0] * hh + ub[0, 1] * kk)) % 360.0
    covered = (q < 0.9 * q.max()) & (q >= 0.35) & ~((phi > 100) & (phi < 140))[:, :, None]
    _unmeasure(vol, covered)
    vol.data[(u > 0.998) & vol.mask] = np.nan
    return vol


def edge_case(name: str) -> HKLVolume:
    """The fixture's input *name* (float32, as the browser computes)."""
    if name == "demo":
        return _demo_case()
    if name == "cubic":
        return _cubic_case()
    if name == "hexagonal":
        return _hexagonal_case()
    raise ValueError(name)


@pytest.fixture(scope="module")
def viewer() -> dict:
    return json.loads(FIXTURE.read_text())


def _viewer_kept(case: dict, r: int) -> np.ndarray:
    bits = np.frombuffer(zlib.decompress(base64.b64decode(case["valid"][str(r)])), dtype=np.uint8)
    n = int(np.prod(case["shape"]))
    return np.unpackbits(bits)[:n].astype(bool).reshape(case["shape"])


@pytest.fixture(scope="module")
def saved(tmp_path_factory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("edge")
    out = {}
    for name in EDGE_CASES:
        out[name] = root / f"{name}.nxs"
        nebula3d.save(edge_case(name), out[name])
    return out


@pytest.mark.parametrize("name", EDGE_CASES)
@pytest.mark.parametrize("r", RADII)
def test_the_edge_trim_keeps_what_the_viewers_erosion_keeps(viewer, saved, name, r):
    case = viewer["cases"][name]
    # The stage's own input: the file loaded and trimmed as a run takes it.
    vol = load_input(saved[name], PipelineParams(edge_trim=r, precision="float32"))
    kept = vol.mask & np.isfinite(vol.data)
    assert list(kept.shape) == case["shape"]
    assert np.array_equal(kept, _viewer_kept(case, r))
    # The viewer's counts: measured before, and the edge it took.
    stats = case["stats"][str(r)]
    assert int(kept.sum()) == stats["measured"] - stats["edge"]


def test_the_cases_have_edges_to_trim_at_every_radius(viewer):
    for name in EDGE_CASES:
        edges = [viewer["cases"][name]["stats"][str(r)]["edge"] for r in RADII]
        assert edges[0] == 0 and all(a < b for a, b in zip(edges, edges[1:])), name


def test_a_nan_value_is_an_unmeasured_voxel_as_in_the_viewer():
    # A voxel whose mask says measured but whose value is NaN counts as
    # unmeasured, as the viewer's loader makes it: its neighbours are an edge.
    vol = HKLVolume.from_arrays(np.ones((7, 7, 7), dtype=np.float32), (-3, 3), (-3, 3), (-3, 3),
                                dtype=np.float32)
    vol.data[3, 3, 3] = np.nan
    assert trim_coverage_edge(vol, 1) == 26
    kept = vol.mask & np.isfinite(vol.data)
    assert not kept[2:5, 2:5, 2:5].any() and kept.sum() == 7 ** 3 - 27


def test_the_box_faces_are_no_edge():
    vol = HKLVolume.from_arrays(np.ones((5, 5, 5), dtype=np.float32), (-2, 2), (-2, 2), (-2, 2),
                                dtype=np.float32)
    assert trim_coverage_edge(vol, 3) == 0 and vol.mask.all()


def test_a_symmetrized_input_is_trimmed_across_each_orbit():
    # The one rule the viewer has no counterpart for: an input that declares
    # the symmetry it was averaged with (a viewer export) is trimmed where any
    # equivalent voxel is, so it stays symmetric.  The viewer erodes only the
    # volume it is about to average, which is never symmetrized.
    vol = _cubic_case()
    sym = GridSymmetry.for_volume(vol, laue_group("m-3m").ops)
    before = vol.mask & np.isfinite(vol.data)
    plain = _cubic_case()
    trim_coverage_edge(plain, 1)  # the viewer's rule
    n = trim_coverage_edge(vol, 1, symmetry=sym)
    trimmed = before & ~vol.mask
    assert n == int(trimmed.sum())
    # Whole orbits of the measured voxels: closed under the group ...
    assert np.array_equal(sym.orbit_any(trimmed) & before, trimmed)
    # ... holding the viewer's trim, and more.
    by_viewer = before & ~plain.mask
    assert (by_viewer <= trimmed).all() and trimmed.sum() > by_viewer.sum()
