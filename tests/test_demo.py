"""The synthetic demo volume (:mod:`nebula3d.demo`).

Checks the physics each component is meant to carry (FCC reflection
conditions, (1 ½ 0) short-range order, transverse TDS, rods along L), and that
the pipeline run with its defaults recovers the planted correlations in the
3D-ΔPDF without punching the diffuse.
"""

from __future__ import annotations

import json

import h5py
import numpy as np
import pytest

import nebula3d
from nebula3d.demo import COMPONENTS, DemoModel, demo_volume
from nebula3d.pipeline import PipelineParams, pipeline_paths, run_pipeline


def _at(vol, h, k, l):
    """Value at the voxel nearest (h, k, l)."""
    idx = tuple(int(np.argmin(np.abs(ax - c)))
                for ax, c in zip((vol.h_axis, vol.k_axis, vol.l_axis), (h, k, l)))
    return float(vol.data[idx])


def test_default_grid_axes_and_ub():
    vol = demo_volume(41)  # default extent ±4 r.l.u.
    assert vol.data.shape == (41, 41, 41)
    assert vol.h_axis[0] == -4.0 and vol.h_axis[-1] == 4.0
    np.testing.assert_allclose(vol.ub_matrix, 2 * np.pi / DemoModel().a * np.eye(3))
    assert vol.mask.all()
    assert np.isfinite(vol.data).all() and (vol.sigma > 0).all()
    assert vol.data.dtype == np.float64 and vol.sigma.dtype == np.float64


def test_seeded_noise_is_deterministic():
    a = demo_volume(17, seed=3).data
    assert np.array_equal(a, demo_volume(17, seed=3).data)
    assert not np.array_equal(a, demo_volume(17, seed=4).data)


def test_noise_free_volume_is_4mmm_symmetric():
    d = demo_volume(41, noise=False).data
    scale = float(np.abs(d).max())
    for axis in range(3):
        assert np.abs(d - np.flip(d, axis)).max() < 1e-12 * scale
    assert np.abs(d - d.transpose(1, 0, 2)).max() < 1e-12 * scale


def test_unknown_component_is_rejected():
    with pytest.raises(ValueError, match="unknown demo components"):
        demo_volume(9, components=("sro", "magnons"))
    assert set(COMPONENTS) >= {"sro", "tds", "rods", "bragg"}


def test_bragg_peaks_obey_fcc_reflection_conditions():
    vol = demo_volume(81, components=("bragg",), noise=False)
    # all-even and all-odd nodes are allowed; all-odd is weaker (|F_odd/F_even|²)
    assert _at(vol, 2, 0, 0) > 50
    assert 0.2 < _at(vol, 1, 1, 1) / _at(vol, 2, 0, 0) < 0.6
    # mixed parity is systematically absent
    for hkl in ((1, 0, 0), (1, 1, 0), (2, 1, 0), (2, 1, 1)):
        assert _at(vol, *hkl) < 1e-6, hkl


def test_sro_maxima_sit_at_one_half_zero():
    vol = demo_volume(81, components=("sro",), noise=False)
    top = _at(vol, 1, 0.5, 0)
    assert top > _at(vol, 1, 0, 0) > _at(vol, 0, 0, 0)
    assert top > _at(vol, 0.5, 0.5, 0.5)
    # all (1 ½ 0) permutations are equivalent (cubic SRO)
    np.testing.assert_allclose(_at(vol, 0, 1, 0.5), top, rtol=1e-12)


def test_tds_is_strongest_transverse_to_q():
    vol = demo_volume(81, components=("tds",), noise=False)
    near = 0.2
    transverse = _at(vol, 2, near, 0)
    longitudinal = _at(vol, 2 + near, 0, 0)
    assert transverse > 1.5 * longitudinal
    # it is an acoustic halo: much weaker away from the node
    assert _at(vol, 2, 1, 0) < 0.2 * transverse


def test_rods_run_along_l_between_the_columns():
    vol = demo_volume(81, components=("rods",), noise=False)
    on_rod = [_at(vol, 0.5, 0.5, l) for l in (0.0, 0.5, 1.0, 1.5)]
    # uniform along L apart from the Debye–Waller factor
    assert min(on_rod) > 0.9 * max(on_rod)
    assert _at(vol, 0.5, 0.5, 0) > 20 * _at(vol, 0.25, 0.25, 0)
    assert _at(vol, 0, 0, 1) < 1e-3 * on_rod[0]  # never on an integer node


@pytest.fixture(scope="module")
def demo_run(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("demo")
    raw = tmp / "demo.nxs"
    nebula3d.save(demo_volume(97, extent=3.0), raw)
    run_pipeline(raw, PipelineParams(), proc_dir=tmp / "proc", force=True)
    return pipeline_paths(raw, proc_dir=tmp / "proc")


def test_pipeline_punches_only_fcc_nodes(demo_run):
    profile = json.loads(demo_run.bragg_profile_json.read_text())
    assert profile["n_peaks"] > 0
    for peak in profile["peaks"]:
        c = np.asarray(peak["center_hkl"])
        node = np.round(c)
        assert np.abs(c - node).max() < 0.15, c
        assert len({int(i) % 2 for i in node}) == 1, node  # never the diffuse


def test_pipeline_recovers_planted_sro_in_delta_pdf(demo_run):
    with h5py.File(demo_run.delta_pdf, "r") as fh:
        d = fh["data"][()]
        x = fh["x_axis"][()]
    a = DemoModel().a

    def at(v):
        return float(d[tuple(int(np.argmin(np.abs(x - c * a))) for c in v)])

    # unlike nearest neighbours, like neighbours at ⟨1 ½ ½⟩ and ⟨2 0 0⟩
    assert at((0.5, 0.5, 0)) < 0
    assert at((0.5, 0, 0.5)) < 0
    assert at((1, 0.5, 0.5)) > 0
    assert at((2, 0, 0)) > 0
    # the nearest-neighbour correlation is the strongest feature off the origin
    r = np.sqrt(sum(g * g for g in np.meshgrid(x, x, x, indexing="ij")))
    shell = (r > 1.5) & (r < 12)
    assert abs(at((0.5, 0.5, 0))) > 0.8 * np.abs(d[shell]).max()
