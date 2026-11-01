"""A UB turned in the reduction: its diagnosis, round 1 and the tail sweep (THY-60).

The rotation fit on centre lists (exact, unbiased, calibrated, and refusing
what is not a rotation), the capsule kernel, and the punch end to end on
synthetic crystals reduced with the UB turned by 0.1°, 0.3° and 0.5°
(tests/misoriented_crystal.py): the fit recovers the turn, the tails are
removed down to the aligned crystal's level, diffuse features beside the nodes
survive, and a crystal with no turn, or with random offsets, is punched
exactly as before.  Synthetic data only.
"""

from __future__ import annotations

import dataclasses
import json

import numpy as np
import pytest
from scipy.spatial.transform import Rotation

import nebula3d.analysis.tail_sweep as tail_sweep
from nebula3d.analysis.bragg import BraggRemover, _PeakPunch
from nebula3d.analysis.bragg_qa import bright_fill_fraction
from nebula3d.analysis.misorientation import (
    MIN_PEAKS,
    capsule_inside,
    diagnose,
    fit_rotation,
)
from nebula3d.modulation import Modulation
from nebula3d.pipeline import (
    _PUNCHED_DATASET,
    BackfillParams,
    PunchParams,
    _read_punched,
    _write_punched,
    backfill,
    bragg_remover,
    punch_bragg,
)
from tests.misoriented_crystal import misoriented_crystal


def _hex_ub(a: float = 4.0, c: float = 5.0) -> np.ndarray:
    astar = 4 * np.pi / (np.sqrt(3) * a)
    return np.array([[astar, astar / 2, 0.0],
                     [0.0, astar * np.sqrt(3) / 2, 0.0],
                     [0.0, 0.0, 2 * np.pi / c]])


UB = _hex_ub()


def _nodes(n: int = 5) -> np.ndarray:
    r = np.arange(-n, n + 1)
    g = np.array(np.meshgrid(r, r, r, indexing="ij")).reshape(3, -1).T
    return g[np.any(g != 0, axis=1)].astype(np.float64)


OMEGA = np.radians(0.4) * np.array([0.3, -0.5, 0.81]) / np.linalg.norm([0.3, -0.5, 0.81])


# ---------------------------------------------------------------- the fit


def test_the_fit_recovers_a_rotation_from_exact_small_angle_offsets():
    q = _nodes() @ UB.T
    fit = fit_rotation(q, np.cross(OMEGA, q))
    assert np.allclose(fit.omega, OMEGA, atol=1e-12)
    assert fit.r2 == pytest.approx(1.0)
    assert fit.n_used == len(q)


def test_the_fit_of_exact_rotations_is_unbiased_to_a_small_fraction():
    """The small-angle model against exact rotations: the second-order term
    lies along Q or averages out over the nodes."""
    q = _nodes() @ UB.T
    for deg in (0.1, 0.5, 1.0):
        omega = OMEGA / np.linalg.norm(OMEGA) * np.radians(deg)
        dq = Rotation.from_rotvec(omega).apply(q) - q
        fit = fit_rotation(q, dq)
        assert np.linalg.norm(fit.omega - omega) / np.linalg.norm(omega) < 2e-3


def test_the_fit_uncertainty_is_calibrated():
    """Over many draws of the centres' scatter, the error of each component in
    units of its standard error has unit spread and no bias."""
    q = _nodes(4) @ UB.T
    rng = np.random.default_rng(7)
    pulls = []
    for _ in range(300):
        dq = np.cross(OMEGA, q) + rng.normal(0.0, 0.004, q.shape)
        fit = fit_rotation(q, dq)
        pulls.append((fit.omega - OMEGA) / np.sqrt(np.diag(fit.covariance)))
    pulls = np.array(pulls)
    assert np.all(np.abs(pulls.mean(axis=0)) < 0.2)
    assert np.all((pulls.std(axis=0) > 0.85) & (pulls.std(axis=0) < 1.15))


def _judged(q_hkl: np.ndarray, dq: np.ndarray, voxel: float = 0.04):
    centres = q_hkl + dq @ np.linalg.inv(UB).T
    return diagnose(UB, q_hkl, centres, np.full(len(q_hkl), 50.0), q_hkl, voxel)


def test_a_cell_error_along_q_is_no_rotation():
    """A 0.3 % cell error moves the peaks along Q; the rotation fits only what
    is across it, and finds none."""
    g = _nodes(4)
    q = g @ UB.T
    rng = np.random.default_rng(1)
    m = _judged(g, 0.003 * q + rng.normal(0.0, 0.002, q.shape))
    assert m.status == "not_significant"
    assert m.angle_deg < 3 * m.sigma_deg


def test_random_offsets_are_not_a_rotation():
    g = _nodes(4)
    rng = np.random.default_rng(2)
    m = _judged(g, rng.normal(0.0, 0.03, g.shape))
    assert m.status == "not_significant"
    assert m.r2 < 0.05
    assert not m.active


def test_a_rotation_buried_in_larger_scatter_is_significant_but_does_not_explain():
    g = _nodes(4)
    q = g @ UB.T
    rng = np.random.default_rng(3)
    dq = np.cross(OMEGA, q) + rng.normal(0.0, 3 * float(np.linalg.norm(np.cross(OMEGA, q),
                                                                        axis=1).mean()), q.shape)
    m = _judged(g, dq)
    assert m.significant and not m.explains
    assert m.status == "not_explained"


def test_peaks_along_one_direction_cannot_fix_the_rotation():
    g = np.array([[h, 0, 0] for h in range(1, 12)], dtype=np.float64)
    fit = fit_rotation(g @ UB.T, np.cross(OMEGA, g @ UB.T))
    assert fit.degenerate


def test_the_diagnosis_says_why_it_does_not_act():
    g = _nodes(3)
    q = g @ UB.T
    assert diagnose(UB, g, g, np.ones(len(g)), g, 0.04, symmetrised=True).status == "symmetrised"
    assert diagnose(UB, g[:0], g[:0], np.ones(0), g, 0.04).status == "no_peaks"
    few = g[:MIN_PEAKS - 1]
    assert diagnose(UB, few, few, np.ones(len(few)), g, 0.04).status == "too_few_peaks"
    # A tiny turn, beyond doubt but under half of this (large) voxel everywhere.
    tiny = OMEGA / np.linalg.norm(OMEGA) * np.radians(0.02)
    m = _judged(g, np.cross(tiny, q), voxel=0.5)
    assert m.significant and m.explains and not m.resolved
    assert m.status == "unresolved"
    assert "under half a voxel" in m.describe()


def test_the_capsule_is_the_ellipsoid_swept_along_its_segment():
    rng = np.random.default_rng(4)
    m = rng.normal(size=(3, 3))
    a = m @ m.T + 3 * np.eye(3)
    s = np.array([0.4, -0.2, 0.3])
    pts = rng.uniform(-1.5, 1.5, size=(20000, 3))
    inside = capsule_inside(pts[:, 0], pts[:, 1], pts[:, 2], a, s)
    ts = np.linspace(-1, 1, 801)
    d = pts[:, None, :] - ts[None, :, None] * s
    union = (np.einsum("ntj,jk,ntk->nt", d, a, d) <= 1.0).any(axis=1)
    assert np.mean(inside != union) < 2e-3  # only voxels at the boundary, sampled finely
    assert inside.sum() > 300
    still = capsule_inside(pts[:, 0], pts[:, 1], pts[:, 2], a, np.zeros(3))
    assert np.array_equal(still, np.einsum("nj,jk,nk->n", pts, a, pts) <= 1.0)


# ---------------------------------------------------------------- the punch, end to end

CASES = {
    "aligned": {"omega_deg": 0.0},
    "random": {"omega_deg": 0.0, "random_offset": 0.05},
    "t01": {"omega_deg": 0.1},
    "t03": {"omega_deg": 0.3},
    "t05": {"omega_deg": 0.5},
    "features": {"omega_deg": 0.5, "features": True},
}
SETTINGS = {
    "off": {"rotation_aware": False, "tail_sweep": "off"},
    "round2": {"rotation_aware": False},
    "default": {},
}
_CRYSTALS: dict[str, object] = {}
_PUNCHES: dict[tuple[str, str], object] = {}


def _crystal(name: str):
    if name not in _CRYSTALS:
        _CRYSTALS[name] = misoriented_crystal(**CASES[name])  # type: ignore[arg-type]
    return _CRYSTALS[name]


def _punch(name: str, setting: str):
    if (name, setting) not in _PUNCHES:
        _PUNCHES[name, setting] = punch_bragg(_crystal(name).vol,  # type: ignore[attr-defined]
                                              PunchParams(**SETTINGS[setting]))
    return _PUNCHES[name, setting]


def _leaks(name: str, setting: str, n_sigma: float = 5.0) -> int:
    """Voxels left unpunched whose Bragg part (the truth) is n σ or more."""
    c = _crystal(name)
    out = _punch(name, setting)
    left = c.vol.mask & ~out._punched  # type: ignore[attr-defined]
    return int((left & (c.bragg > n_sigma * c.vol.sigma)).sum())  # type: ignore[attr-defined]


@pytest.mark.parametrize("name, deg", [("t01", 0.1), ("t03", 0.3), ("t05", 0.5)])
def test_the_fit_recovers_the_true_turn_within_its_uncertainty(name, deg):
    c = _crystal(name)
    m = _punch(name, "default")._bragg_profile["misorientation"]  # type: ignore[attr-defined]
    assert m["status"] == "active" and m["n_peaks"] == 105
    assert abs(m["angle_deg"] - deg) < 3 * m["sigma_deg"]
    true_axis = c.omega / np.linalg.norm(c.omega)  # type: ignore[attr-defined]
    off_axis = np.degrees(np.arccos(np.clip(np.dot(m["axis"], true_axis), -1.0, 1.0)))
    # The axis error across it, two directions of RMS axis_sigma_deg each.
    assert off_axis < 3 * np.sqrt(2) * m["axis_sigma_deg"]
    assert m["r2"] > 0.9 and m["p_value"] < 1e-100
    # Pinned (this platform's draw of the synthetic noise).
    assert m["angle_deg"] == pytest.approx({0.1: 0.1019, 0.3: 0.3024, 0.5: 0.5005}[deg], abs=2e-4)


def test_no_turn_leaves_both_rounds_inactive_and_the_punch_bit_identical():
    out = _punch("aligned", "default")
    m = out._bragg_profile["misorientation"]  # type: ignore[attr-defined]
    assert m["status"] == "not_significant" and not m["active"]
    assert m["round1"] == {"rotation_aware": True, "stretched": 0, "centred": 0}
    assert out._bragg_profile["tail_sweep"]["ran"] is False  # type: ignore[attr-defined]
    assert out._punched_round2 is None  # type: ignore[attr-defined]
    off = _punch("aligned", "off")
    assert np.array_equal(out._punched, off._punched)  # type: ignore[attr-defined]
    assert np.array_equal(out.mask, off.mask)  # type: ignore[attr-defined]
    # The count main punched before THY-60 on this crystal.
    assert int(out._punched.sum()) == 26162  # type: ignore[attr-defined]


def test_random_offsets_are_not_a_turn_and_the_sweep_stays_inactive():
    out = _punch("random", "default")
    m = out._bragg_profile["misorientation"]  # type: ignore[attr-defined]
    assert m["status"] in {"not_significant", "not_explained"}
    assert m["r2"] < 0.1
    assert out._bragg_profile["tail_sweep"]["ran"] is False  # type: ignore[attr-defined]
    assert np.array_equal(out._punched, _punch("random", "off")._punched)  # type: ignore[attr-defined]
    assert int(out._punched.sum()) == 26782  # type: ignore[attr-defined]


def test_off_is_the_punch_before_thy60():
    """With both off, a turned crystal is punched as main punched it."""
    for name, count in (("t03", 27660), ("t05", 35298), ("features", 35477)):
        assert int(_punch(name, "off")._punched.sum()) == count  # type: ignore[attr-defined]


@pytest.mark.parametrize("name, off_min, kept_max", [("t03", 50, 2), ("t05", 700, 10)])
def test_the_tails_are_removed_down_to_the_aligned_crystals_level(name, off_min, kept_max):
    """Bragg tails the punch leaves (5σ or more of Bragg, by the truth): none
    on the aligned crystal; many beside the holes of a turned one; at the
    aligned level, within a few voxels, after rounds 1 and 2, and after round 2
    alone."""
    assert _leaks("aligned", "default") == 0
    assert _leaks(name, "off") >= off_min
    assert _leaks(name, "default") <= kept_max
    assert _leaks(name, "round2") <= kept_max
    # The record's own numbers, from the data alone: the voxels at the gate
    # beside the holes along ±ω × q̂, before and after round 2.
    ts = _punch(name, "round2")._bragg_profile["tail_sweep"]  # type: ignore[attr-defined]
    assert ts["ran"] and ts["n_voxels"] > 0
    assert ts["tail_voxels"]["after"] <= 0.02 * ts["tail_voxels"]["before"]
    # The Bragg intensity left outside the holes falls by most of it.
    c = _crystal(name)

    def left(setting: str) -> float:
        out = _punch(name, setting)
        keep = c.vol.mask & ~out._punched  # type: ignore[attr-defined]
        return float(c.bragg[keep].sum() / c.bragg.sum())  # type: ignore[attr-defined]

    assert left("default") < 0.2 * left("off")


def test_the_pinned_tail_numbers():
    """This platform's numbers for the 0.5° crystal (see the report in
    docs/algorithms/bragg_cleanup.md, "A UB turned in the reduction")."""
    assert (_leaks("t05", "off"), _leaks("t05", "round2"), _leaks("t05", "default")) == (756, 9, 5)
    assert (_leaks("t03", "off"), _leaks("t03", "round2"), _leaks("t03", "default")) == (55, 2, 0)
    ts = _punch("t05", "round2")._bragg_profile["tail_sweep"]  # type: ignore[attr-defined]
    assert ts["n_voxels"] == 1221 and ts["tail_voxels"] == {"before": 788, "after": 0,
                                                            "left_alone": 0}


def test_bright_fills_fall():
    """After the backfill (the default Laplace fill, once, on the union), the
    share of fills 3σ above their surroundings, over the volume and as the
    punch's record measures it at the swept nodes."""
    c = _crystal("t05")

    def bright(setting: str) -> float:
        out = _punch("t05", setting)
        filled = backfill(out, BackfillParams())
        return bright_fill_fraction(out, out._punched, filled.data)  # type: ignore[attr-defined]

    before = bright("off")
    assert before > 0
    assert bright("round2") < before and bright("default") < before
    rec = _punch("t05", "round2")._bragg_profile["tail_sweep"]["bright_fill"]  # type: ignore[attr-defined]
    assert rec["before"] > rec["after"] == 0.0
    del c


def test_diffuse_features_beside_the_nodes_survive_the_sweep():
    """A broad maximum and a rod beside two nodes, along the way their tails
    run: round 2 takes none of their voxels, and leaves those nodes alone."""
    c = _crystal("features")
    feature = c.features > 3 * c.vol.sigma  # type: ignore[attr-defined]
    for setting in ("round2", "default"):
        out = _punch("features", setting)
        r2 = out._punched_round2  # type: ignore[attr-defined]
        assert r2 is not None and r2.any()
        assert not (r2 & feature).any()
        nodes = {tuple(n["node"]): n["status"]
                 for n in out._bragg_profile["tail_sweep"]["nodes"]}  # type: ignore[attr-defined]
        for node in c.feature_nodes:  # type: ignore[attr-defined]
            assert nodes.get(node) in {"extended", "broad"}, (setting, node, nodes.get(node))


def test_every_round2_voxel_is_recorded(tmp_path):
    out = _punch("t05", "round2")
    r2 = out._punched_round2  # type: ignore[attr-defined]
    punched = out._punched  # type: ignore[attr-defined]
    assert r2 is not None and not (r2 & ~punched).any()
    ts = out._bragg_profile["tail_sweep"]  # type: ignore[attr-defined]
    assert ts["n_voxels"] == int(r2.sum()) == len(ts["voxels_hkl"])
    vol = _crystal("t05").vol  # type: ignore[attr-defined]
    idx = np.argwhere(r2)
    hkl = np.stack([vol.h_axis[idx[:, 0]], vol.k_axis[idx[:, 1]], vol.l_axis[idx[:, 2]]], axis=1)
    got = np.array(sorted(map(tuple, ts["voxels_hkl"])))
    assert np.allclose(got, np.array(sorted(map(tuple, np.round(hkl, 5)))))
    json.dumps(out._bragg_profile)  # type: ignore[attr-defined]  # the record is JSON
    # In the punch record: code 1 for round 1, 2 for round 2; read back as holes.
    import h5py

    path = tmp_path / "p.h5"
    _write_punched(path, punched, r2)
    with h5py.File(path, "r") as fh:
        code = fh[_PUNCHED_DATASET][...]
    assert set(np.unique(code)) == {0, 1, 2}
    assert np.array_equal(code == 2, r2)
    assert np.array_equal(_read_punched(path), punched)


def test_the_backfill_runs_once_on_the_union():
    out = _punch("t05", "round2")
    r2 = out._punched_round2  # type: ignore[attr-defined]
    filled = backfill(out, BackfillParams())
    assert filled.mask[r2].all()
    assert not np.array_equal(filled.data[r2], out.data[r2])  # type: ignore[attr-defined]


def test_symmetrised_data_are_never_read_for_a_turn():
    vol = _crystal("t05").vol  # type: ignore[attr-defined]
    ops = (np.eye(3, dtype=np.int64),)
    on = dataclasses.replace(bragg_remover(PunchParams()), symmetry_ops=ops)
    off = dataclasses.replace(bragg_remover(PunchParams(**SETTINGS["off"])), symmetry_ops=ops)
    keep = on.build_mask(vol)
    assert on._rotation_report["misorientation"].status == "symmetrised"
    assert on._rotation_report["sweep"].ran is False
    assert np.array_equal(keep, off.build_mask(vol))


def test_the_caps(monkeypatch):
    vol = _crystal("t05").vol  # type: ignore[attr-defined]
    monkeypatch.setattr(tail_sweep, "GROWTH_CAP", 0.0)
    out = punch_bragg(vol, PunchParams(**SETTINGS["round2"]))
    ts = out._bragg_profile["tail_sweep"]
    assert ts["n_voxels"] == 0 and ts["counts"]["capped"] > 0 and ts["counts"]["swept"] == 0
    monkeypatch.setattr(tail_sweep, "GROWTH_CAP", 1.0)
    monkeypatch.setattr(tail_sweep, "SHELL_CAP", 0.0)
    out = punch_bragg(vol, PunchParams(**SETTINGS["round2"]))
    ts = out._bragg_profile["tail_sweep"]
    assert ts["n_voxels"] == 0 and ts["counts"]["shell_capped"] > 0 and ts["shells_capped"]


def test_round2_keeps_out_of_the_declared_modulation_and_the_h_guard():
    """Planes K ≡ ±1/6 (mod 1), across the tails' way: round 2 punches none of
    their voxels (which it would without them); and every round-2 voxel lies
    within the integer-H guard of its node."""
    vol = _crystal("t05").vol  # type: ignore[attr-defined]
    planes = Modulation.parse({"k": "0, 1/6, 0", "form": "planes"})
    assert planes is not None
    protected = np.broadcast_to(planes.mask(vol, None, (1, 1, 1)), vol.shape)
    free = _punch("t05", "round2")._punched_round2  # type: ignore[attr-defined]
    assert (free & protected).any()  # without the declaration it would punch there
    out = punch_bragg(vol, PunchParams(**SETTINGS["round2"]), modulation=planes)
    r2 = out._punched_round2  # type: ignore[attr-defined]
    assert r2 is not None and r2.any() and not (r2 & protected).any()
    guard = PunchParams().integer_h_guard_hkl
    h = vol.h_axis[np.argwhere(r2)[:, 0]]
    assert np.all(np.abs(h - np.round(h)) <= guard + 1e-9)


def test_on_runs_without_a_significant_turn_and_auto_does_not():
    vol = _crystal("random").vol  # type: ignore[attr-defined]
    out = punch_bragg(vol, PunchParams(tail_sweep="on"))
    ts = out._bragg_profile["tail_sweep"]
    assert ts["ran"] is True and ts["setting"] == "on"
    assert _punch("random", "default")._bragg_profile["tail_sweep"]["reason"] in {  # type: ignore[attr-defined]
        "not_significant", "not_explained"}
    with pytest.raises(ValueError, match="tail_sweep"):
        BraggRemover(tail_sweep="always")


def test_round1_centres_an_unfitted_peak_where_the_turn_puts_its_node():
    """A fitted centre is the peak's measured position and stays; a peak whose
    centre could not be fitted moves to node + ω × q.  Both are stretched by
    |ω × q| along ω × q̂ (swept ±½ ω × q)."""
    vol = _crystal("t05").vol  # type: ignore[attr-defined]
    rem = bragg_remover(PunchParams())
    peaks, _, _ = rem._detect(vol)
    turn = rem._rotation_report["misorientation"]
    node = (8, 1, 0)
    q = vol.ub_matrix @ np.array(node, dtype=np.float64)
    shift = np.linalg.inv(vol.ub_matrix) @ turn.shift(q)
    base = _PeakPunch(ih=0, ik=0, il=0, intensity=10.0, center_hkl=(8.01, 1.02, 0.0),
                      source_node_hkl=node)
    pair = [dataclasses.replace(base, centre_fitted=True), base]
    fitted, unfitted = rem._stretch(vol, pair, turn)
    assert fitted.center_hkl == base.center_hkl
    assert np.allclose(unfitted.center_hkl, np.array(node) + shift)
    for p in (fitted, unfitted):
        assert np.allclose(p.stretch_hkl, 0.5 * shift)
    assert rem._rotation_report["centred"] == 1 and rem._rotation_report["stretched"] == 2
    # Peaks found by the off-lattice search are left as they are.
    found = dataclasses.replace(base, found_by="search", source_node_hkl=None)
    assert rem._stretch(vol, [found], turn) == [found]
    del peaks


def test_the_run_writes_the_record_and_the_api_serves_it(tmp_path):
    """Through the pipeline's punch stage and the API: the settings as the
    page sends them, the punch record's code 2, and the profile's diagnosis
    and sweep."""
    from types import SimpleNamespace

    import h5py
    from fastapi.testclient import TestClient

    import nebula3d
    from nebula3d.pipeline import run_pipeline
    from nebula3d.server import volumes as vol_mod
    from nebula3d.server.app import create_app
    from nebula3d.server.config import ServerConfig
    from nebula3d.server.params import build_params
    from nebula3d.server.schemas import StageParamsIn

    stem = "sample_300K_test_cc_sub_bkg"
    (tmp_path / "raw").mkdir()
    raw = tmp_path / "raw" / f"{stem}.nxs"
    nebula3d.save(_crystal("t05").vol, raw)  # type: ignore[attr-defined]

    def params(**kw):
        return build_params(SimpleNamespace(flatten_enabled=False, params=StageParamsIn(**kw)))

    p = params(punch_rotation_aware=False, punch_tail_sweep="auto")
    assert (p.punch.rotation_aware, p.punch.tail_sweep) == (False, "auto")
    assert (params().punch.rotation_aware, params().punch.tail_sweep) == (True, "auto")
    with pytest.raises(ValueError, match="punch_tail_sweep"):
        params(punch_tail_sweep="always")
    paths = run_pipeline(raw, p, proc_dir=tmp_path / "processed", stages=("punch",))
    record = json.loads(paths.bragg_profile_json.read_text())
    assert record["misorientation"]["active"] is True
    assert record["misorientation"]["round1"]["stretched"] == 0  # rotation_aware off
    ts = record["tail_sweep"]
    assert ts["ran"] is True and ts["n_voxels"] > 0
    with h5py.File(paths.braggpunched, "r") as fh:
        code = fh[_PUNCHED_DATASET][...]
    assert int((code == 2).sum()) == ts["n_voxels"]
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    body = client.get("/api/bragg/sample-300K-test-cc-sub-bkg/profile").json()
    assert body["misorientation"]["status"] == "active"
    assert body["misorientation"]["angle_deg"] == pytest.approx(0.5, abs=0.01)
    assert body["tail_sweep"]["n_voxels"] == ts["n_voxels"] == len(body["tail_sweep"]["voxels_hkl"])
