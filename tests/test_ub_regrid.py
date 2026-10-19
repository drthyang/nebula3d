"""Regridding a dataset onto its refined UB, as a new dataset (analysis.ub_regrid),
through the API (POST /api/datasets/{id}/regrid) and the browser bridge.

Synthetic hexagonal crystals indexed with a UB that the true one is turned
from by 0.3°, so each Bragg peak sits beside its node by 0.3° times |Q|.  The
regrid recovers the turn and puts the peaks back on their nodes.  It never
overwrites a file, never writes outside the data root, leaves the raw file
byte for byte as it was, and refuses, as data, when the fit cannot turn the
UB: a symmetrised volume without its unsymmetrised source, or a turn under
the UB check's 0.05° rule.
"""

import hashlib
import json
import os

import h5py
import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.spatial.transform import Rotation

import nebula3d
from nebula3d import webbridge
from nebula3d.analysis import ub_regrid
from nebula3d.analysis.ub_refine import (
    SYMMETRISED,
    UB_TURN,
    measure_centres,
    outside_grid,
    symmetry_break,
)
from nebula3d.analysis.ub_regrid import (
    CANNOT_SYMMETRISE,
    SYMMETRISED_WITHOUT_SOURCE,
    TARGET_EXISTS,
    TURN_BELOW_NOISE,
    regrid_dataset,
    regrid_target,
)
from nebula3d.core import HKLVolume
from nebula3d.pipeline import pipeline_paths
from nebula3d.server import volumes as vol_mod
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from nebula3d.symmetry import GridSymmetry, _group_closure, parse_symmetry_ops, read_symmetry_ops

SIX_MMM_TEXT = "h,k,l; h+k,-h,l; k,h,l; h,k,-l"
SIX_MMM = parse_symmetry_ops(SIX_MMM_TEXT)
STEM = "synthetic_hex"
SLUG = "synthetic-hex"
NEW_STEM, NEW_SLUG = f"{STEM}_regridded", f"{SLUG}-regridded"


def _hex_ub(a: float, c: float) -> np.ndarray:
    """UB (2π included) of a hexagonal cell, a* along x."""
    astar = 4 * np.pi / (np.sqrt(3) * a)
    return np.array([[astar, astar / 2, 0.0],
                     [0.0, astar * np.sqrt(3) / 2, 0.0],
                     [0.0, 0.0, 2 * np.pi / c]])


UB = _hex_ub(4.0, 5.0)
TURN_DEG = 0.3
TURN = Rotation.from_rotvec(np.radians(TURN_DEG) * np.array([1, 2, 3]) / np.sqrt(14)).as_matrix()


def _crystal(ub_true: np.ndarray, *, half: float = 3.0, step: float = 0.1,
             sigma_q: float = 0.15, seed: int = 1, measured_sigma: bool = True) -> HKLVolume:
    """A float32 volume indexed with UB whose Bragg peaks sit at the nodes of
    *ub_true*: Gaussian peaks (height 500, σ in Q) on a flat background of
    10 ± 0.5, every voxel measured; σ = √I, which came with the data unless
    *measured_sigma* is false."""
    n = int(round(2 * half / step)) + 1
    vol = HKLVolume.from_arrays(np.zeros((n, n, n)), (-half, half), (-half, half),
                                (-half, half), ub_matrix=UB)
    data = 10.0 + np.random.default_rng(seed).normal(0.0, 0.5, vol.shape)
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    to_hkl = np.linalg.inv(UB) @ ub_true
    r = np.arange(-int(half), int(half) + 1)
    for g in np.array(np.meshgrid(r, r, r, indexing="ij")).reshape(3, -1).T:
        if not g.any():
            continue
        c = to_hkl @ g  # where the peak lands in the volume's HKL
        box = tuple(slice(max(0, int(np.searchsorted(ax, x)) - 4),
                          int(np.searchsorted(ax, x)) + 5) for ax, x in zip(axes, c))
        grids = np.meshgrid(*(ax[b] - x for ax, b, x in zip(axes, box, c)), indexing="ij")
        d = np.stack(grids, axis=-1) @ UB.T
        data[box] += 500.0 * np.exp(-(d ** 2).sum(axis=-1) / (2 * sigma_q ** 2))
    vol.data = data.astype(np.float32)
    vol.sigma = np.sqrt(np.abs(vol.data))
    vol.sigma_estimated = not measured_sigma
    return vol


def _symmetrised(vol: HKLVolume) -> HKLVolume:
    GridSymmetry.for_volume(vol, SIX_MMM).orbit_mean(vol.data, vol.mask.copy())
    vol.sigma = np.sqrt(np.abs(vol.data))
    return vol


def _write_entry(path, vol: HKLVolume, **attrs) -> None:
    """*vol* in the NeXus Viewer's layout, with /entry attributes (an export)."""
    with h5py.File(path, "w") as f:
        entry = f.create_group("entry")
        for name, values in (("data", vol.data), ("sigma", vol.sigma), ("mask", vol.mask),
                             ("h_axis", vol.h_axis), ("k_axis", vol.k_axis),
                             ("l_axis", vol.l_axis), ("ub_matrix", vol.ub_matrix)):
            entry.create_dataset(name, data=values)
        for key, value in attrs.items():
            entry.attrs[key] = value


def _write_export(path, vol: HKLVolume, **attrs) -> None:
    """*vol* as the NeXus Viewer exports it in the Mantid layout, its
    attributes on the nebula3d group."""
    from nebula3d.io.mantid_nxs import MDDim, write_md_histo

    labels = ("[H,0,0]", "[0,K,0]", "[0,0,L]")
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    dims = [MDDim(label, axis, "r.l.u.", "HKL", tuple(np.eye(3)[i]))
            for i, (label, axis) in enumerate(zip(labels, axes))]
    write_md_histo(path, vol.data, dims, content="hkl_volume", valid=vol.mask,
                   ub_matrix=vol.ub_matrix, attrs=attrs)


WRITERS = {"entry": _write_entry, "mantid": _write_export}


def _root(tmp_path):
    (tmp_path / "raw").mkdir(parents=True)
    (tmp_path / "processed").mkdir()
    return tmp_path


def _raw(root, vol: HKLVolume | None = None, stem: str = STEM):
    """The dataset's raw volume, as NEBULA3D saves it (Mantid layout, float32 recorded)."""
    path = root / "raw" / f"{stem}.nxs"
    nebula3d.save(_crystal(TURN @ UB) if vol is None else vol, path)
    return path


def _sha256(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _median_offset(vol: HKLVolume) -> float:
    """The peaks' median distance from their nodes (Å⁻¹), with the volume's UB."""
    c = measure_centres(vol)
    return float(np.median(np.linalg.norm((c.hkl - c.nodes) @ np.asarray(vol.ub_matrix).T,
                                          axis=1)))


# ---------------------------------------------------------------------------
# The package function
# ---------------------------------------------------------------------------
def test_regrid_recovers_the_turn_and_puts_the_peaks_on_their_nodes(tmp_path):
    root = _root(tmp_path)
    raw = _raw(root)
    before = _sha256(raw)
    r = regrid_dataset(raw, data_root=root)
    assert r.written and r.refusal is None
    assert r.target == raw.with_name(f"{NEW_STEM}.nxs") == regrid_target(raw)
    assert r.fit == "both" and r.refined_on == raw and not r.symmetrised
    f = r.check.refinement.fit
    # The turn put in, recovered: the angle, and the rotation itself.
    assert f.angle_deg == pytest.approx(TURN_DEG, abs=0.005)
    miss = Rotation.from_matrix(f.rotation @ TURN.T).magnitude()
    assert np.degrees(miss) < 0.005
    assert f.cell == pytest.approx((4.0, 4.0, 5.0, 90.0, 90.0, 120.0), abs=2e-3)

    new = nebula3d.load(r.target, dtype=None)
    assert new.data.dtype == np.float32 and not new.sigma_estimated
    assert np.allclose(new.ub_matrix, f.ub)
    # Before: 0.3° times |Q| off the nodes; after, a few thousandths of an Å⁻¹.
    offset_before = _median_offset(nebula3d.load(raw, dtype=None))
    offset_after = _median_offset(new)
    assert offset_before > 0.012
    assert offset_after < 0.004 and offset_after < 0.25 * offset_before
    assert _sha256(raw) == before  # the raw volume is only read

    # Every voxel was measured: those whose Q left the old box are the ones lost.
    src = nebula3d.load(raw, dtype=None)
    assert np.array_equal(~new.mask, outside_grid(src, f.ub))
    assert r.measured_before == src.data.size
    assert 0 < r.voxels_outside == r.measured_before - r.measured_after
    assert r.voxels_outside_share == pytest.approx(r.voxels_outside / r.measured_before)

    # The file records what was done.
    with h5py.File(r.target, "r") as h:
        a = h["entry"].attrs
        assert a["source_file"] == raw.name and a["regrid_dataset_file"] == raw.name
        assert a["regrid_fit"] == "both"
        assert a["regrid_turn_deg"] == pytest.approx(f.angle_deg)
        assert np.allclose(a["regrid_ub_start"], UB) and np.allclose(a["regrid_ub"], f.ub)
        assert a["regrid_symmetrised"] == 0
        assert "symmetry_ops" not in a  # not symmetrised: the pipeline must not take it so
    assert read_symmetry_ops(r.target) is None


def test_an_estimated_sigma_stays_estimated(tmp_path):
    """No σ came with the data: the new file leaves it out, and the loader
    estimates it again from the regridded data and says so."""
    root = _root(tmp_path)
    raw = _raw(root, _crystal(TURN @ UB, half=2.5, measured_sigma=False))
    r = regrid_dataset(raw, data_root=root)
    assert r.written
    with h5py.File(r.target, "r") as h:
        assert "sigma" not in h["entry"] and "data" in h["entry"]
    new = nebula3d.load(r.target, dtype=None)
    assert new.sigma_estimated
    assert np.allclose(new.sigma, np.sqrt(np.abs(new.data)))


def test_the_regrid_refines_as_the_ub_check_does(tmp_path):
    """The turn the regrid acts on is the one the UB check reports."""
    root = _root(tmp_path)
    raw = _raw(root)
    vol_mod.clear_cache()
    u = vol_mod.volume_ub_check(raw, (1, 1, 1), None)
    r = regrid_dataset(raw, data_root=root)
    f = r.check.refinement.fit
    assert u["fit"] == r.fit
    assert u["angle_deg"] == pytest.approx(f.angle_deg, abs=1e-9)
    assert np.allclose(u["ub"], f.ub, atol=1e-7)


def test_an_existing_target_is_refused_and_left_alone(tmp_path):
    root = _root(tmp_path)
    raw = _raw(root)
    before = _sha256(raw)
    target = regrid_target(raw)
    target.write_bytes(b"someone else's file")
    r = regrid_dataset(raw, data_root=root)
    assert not r.written and r.refusal.code == TARGET_EXISTS
    assert target.name in r.refusal.reason
    assert r.check is None  # refused before anything was fitted
    assert target.read_bytes() == b"someone else's file"
    assert _sha256(raw) == before
    # A link at the target is a file in the way too, even one pointing nowhere.
    target.unlink()
    os.symlink(tmp_path / "nowhere.nxs", target)
    assert regrid_dataset(raw, data_root=root).refusal.code == TARGET_EXISTS
    assert not (tmp_path / "nowhere.nxs").exists()


def test_a_target_made_while_regridding_is_not_overwritten(tmp_path, monkeypatch):
    """The file is created exclusively: one that appears after the check is
    refused, not overwritten."""
    root = _root(tmp_path)
    raw = _raw(root)
    target = regrid_target(raw)
    real = ub_regrid.regrid

    def regrid_and_race(vol, ub):
        target.write_bytes(b"made meanwhile")
        return real(vol, ub)

    monkeypatch.setattr(ub_regrid, "regrid", regrid_and_race)
    r = regrid_dataset(raw, data_root=root)
    assert not r.written and r.refusal.code == TARGET_EXISTS
    assert target.read_bytes() == b"made meanwhile"


def test_a_failed_write_leaves_no_partial_file(tmp_path, monkeypatch):
    root = _root(tmp_path)
    raw = _raw(root)
    before = _sha256(raw)

    def unwritable(*args, **kwargs):
        return {"regrid_fit": object()}  # h5py cannot store it

    monkeypatch.setattr(ub_regrid, "_provenance", unwritable)
    with pytest.raises(TypeError):
        regrid_dataset(raw, data_root=root)
    assert not regrid_target(raw).exists()
    assert _sha256(raw) == before


def test_never_writes_to_the_raw_file(tmp_path):
    root = _root(tmp_path)
    raw = _raw(root)
    before = _sha256(raw)
    for out in (raw, root / "raw" / ".." / "raw" / raw.name):
        with pytest.raises(ValueError, match="the volume being regridded"):
            regrid_dataset(raw, data_root=root, out=out)
    assert _sha256(raw) == before
    assert sorted(p.name for p in (root / "raw").iterdir()) == [raw.name]


def test_never_writes_outside_the_data_root(tmp_path):
    root = _root(tmp_path / "root")
    raw = _raw(root)
    for out in (tmp_path / "elsewhere.nxs", root / "raw" / ".." / ".." / "escape.nxs", root):
        with pytest.raises(ValueError, match="outside the data root"):
            regrid_dataset(raw, data_root=root, out=out)
    # A volume outside the root: the new file would be beside it, outside too.
    stray = tmp_path / f"{STEM}.nxs"
    nebula3d.save(_crystal(TURN @ UB, half=1.0), stray)
    with pytest.raises(ValueError, match="outside the data root"):
        regrid_dataset(stray, data_root=root)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["root", stray.name]
    assert sorted(p.name for p in (root / "raw").iterdir()) == [raw.name]


def test_a_turn_under_the_rule_is_refused(tmp_path):
    """A right UB: the fit turns it by less than its own noise, and nothing is written."""
    root = _root(tmp_path)
    raw = _raw(root, _crystal(UB))
    r = regrid_dataset(raw, data_root=root)
    assert not r.written and r.refusal.code == TURN_BELOW_NOISE
    assert r.check.refinement.fit.angle_deg < UB_TURN == 0.05
    assert "0.05°" in r.refusal.reason
    assert not regrid_target(raw).exists()


def test_a_symmetrised_volume_without_its_source_is_refused(tmp_path):
    """Symmetrised, a turned UB makes rings around the nodes: only the
    symmetric fit applies, and it cannot turn the UB."""
    root = _root(tmp_path)
    sym = root / "raw" / f"{STEM}_sym6mmm.nxs"
    vol = _symmetrised(_crystal(TURN @ UB))
    for attrs, says in (({}, "names none"),
                        ({"source_file": f"{STEM}.nxs"}, "not beside it")):
        _write_entry(sym, vol, symmetry_ops=SIX_MMM_TEXT, **attrs)
        r = regrid_dataset(sym, data_root=root, ops=SIX_MMM, ops_from=sym.name)
        assert not r.written and r.refusal.code == SYMMETRISED_WITHOUT_SOURCE
        assert r.fit == "symmetric" and r.source_symmetrised is True and r.check is None
        assert says in r.refusal.reason
    # Its source beside it, but symmetrised too.
    _write_entry(root / "raw" / f"{STEM}.nxs", vol)
    r = regrid_dataset(sym, data_root=root, ops=SIX_MMM, ops_from=sym.name)
    assert r.refusal.code == SYMMETRISED_WITHOUT_SOURCE and "symmetrised too" in r.refusal.reason
    assert sorted(p.name for p in (root / "raw").iterdir()) == [f"{STEM}.nxs", sym.name]


@pytest.mark.parametrize("layout", sorted(WRITERS))
def test_a_symmetrised_dataset_is_regridded_from_its_source_and_keeps_its_operations(
        tmp_path, layout):
    root = _root(tmp_path)
    raw = _raw(root)
    sym = root / "raw" / f"{STEM}_sym6mmm.nxs"
    WRITERS[layout](sym, _symmetrised(_crystal(TURN @ UB)), symmetry_ops=SIX_MMM_TEXT,
                    symmetry="6/mmm", source_file=raw.name)
    hashes = (_sha256(raw), _sha256(sym))
    r = regrid_dataset(sym, data_root=root, ops=SIX_MMM, ops_from=sym.name)
    assert r.written and r.target.name == f"{STEM}_sym6mmm_regridded_sym.nxs"
    assert r.refined_on == raw and r.fit == "both" and r.source_symmetrised is True
    assert r.check.refinement.fit.angle_deg == pytest.approx(TURN_DEG, abs=0.005)
    assert r.symmetrised
    new = nebula3d.load(r.target, dtype=None)
    assert symmetry_break(new, SIX_MMM) < SYMMETRISED
    # Symmetrised after the regrid, the copies stack on the nodes.
    assert _median_offset(new) < 0.004
    group = {m.tobytes() for m in _group_closure(SIX_MMM)}
    assert {m.tobytes() for m in _group_closure(read_symmetry_ops(r.target))} == group
    with h5py.File(r.target, "r") as h:
        a = h["entry"].attrs
        assert a["source_file"] == raw.name and a["regrid_dataset_file"] == sym.name
        assert a["symmetry"] == "6/mmm" and a["regrid_symmetrised"] == 1
    assert (_sha256(raw), _sha256(sym)) == hashes


def test_symmetrising_is_optional_and_needs_operations_that_map_the_grid(tmp_path):
    root = _root(tmp_path)
    raw = _raw(root)
    r = regrid_dataset(raw, data_root=root, symmetrise=True)
    assert not r.written and r.refusal.code == CANNOT_SYMMETRISE
    assert "none are declared" in r.refusal.reason

    r = regrid_dataset(raw, data_root=root, ops=SIX_MMM, ops_from="export.nxs",
                       symmetrise=True)
    assert r.written and r.symmetrised
    assert r.target == regrid_target(raw, symmetrised=True)
    assert r.target.name == f"{NEW_STEM}_sym.nxs"
    new = nebula3d.load(r.target, dtype=None)
    assert symmetry_break(new, SIX_MMM) < SYMMETRISED
    assert r.check.refinement.fit.angle_deg == pytest.approx(TURN_DEG, abs=0.005)

    # Operations that do not map the grid onto itself (K binned finer than H).
    vol = _crystal(TURN @ UB, half=2.0)
    odd = HKLVolume.from_arrays(vol.data[:, ::2, :].copy(), (-2, 2), (-2, 2), (-2, 2),
                                ub_matrix=UB)
    other = _raw(root, odd, stem="odd_grid")
    r = regrid_dataset(other, data_root=root, ops=SIX_MMM, symmetrise=True)
    assert not r.written and r.refusal.code == CANNOT_SYMMETRISE
    assert "do not map" in r.refusal.reason


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------
def _client(root) -> TestClient:
    vol_mod.clear_cache()
    return TestClient(create_app(ServerConfig(data_root=root)))


def test_regrid_endpoint_makes_a_new_dataset(tmp_path):
    root = _root(tmp_path)
    raw = _raw(root)
    before = _sha256(raw)
    client = _client(root)
    r = client.post(f"/api/datasets/{SLUG}/regrid", json={"cell": [1, 1, 1]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["written"] is True and out["refusal"] is None
    assert out["dataset_id"] == NEW_SLUG and out["file"] == f"{NEW_STEM}.nxs"
    assert out["source_file"] == raw.name == out["refined_on"]
    assert out["fit"] == "both" and out["symmetrised"] is False
    assert out["turn_deg"] == pytest.approx(TURN_DEG, abs=0.005)
    assert out["turn_threshold_deg"] == UB_TURN
    assert np.allclose(out["ub_start"], UB, atol=1e-7)
    assert 0 < out["voxels_outside"] < out["measured_before"]
    assert out["voxels_outside_share"] == pytest.approx(
        out["voxels_outside"] / out["measured_before"])
    assert _sha256(raw) == before

    # A dataset the app lists and runs: its raw volume is the new file.
    listed = {d["id"]: d for d in client.get("/api/datasets").json()}
    assert listed[NEW_SLUG]["raw_name"] == out["file"]
    assert next(s for s in listed[NEW_SLUG]["stages"] if s["name"] == "raw")["exists"]
    meta = client.get(f"/api/volumes/{NEW_SLUG}.raw/meta").json()
    assert np.allclose(meta["ub_matrix"], out["ub"], atol=1e-7)
    # The UB check on it: the peaks sit on their nodes, the UB no longer turned.
    u = client.get(f"/api/volumes/{NEW_SLUG}.raw/ub", params={"cell": "1,1,1"}).json()
    assert u["angle_deg"] < UB_TURN and u["rms"] < 0.01

    again = client.post(f"/api/datasets/{SLUG}/regrid", json={}).json()
    assert again["written"] is False and again["refusal"]["code"] == TARGET_EXISTS
    assert again["dataset_id"] == NEW_SLUG and again["file"] == out["file"]
    assert again["turn_deg"] is None  # refused before anything was fitted


def test_regrid_endpoint_on_a_symmetrised_dataset(tmp_path):
    """The operations come as the UB check takes them (the file's own): the
    symmetrised dataset is refused without its source, and regridded from it,
    symmetrised again, once it is beside it."""
    root = _root(tmp_path)
    sym_stem = f"{STEM}_sym6mmm"
    _write_entry(root / "raw" / f"{sym_stem}.nxs", _symmetrised(_crystal(TURN @ UB)),
                 symmetry_ops=SIX_MMM_TEXT, symmetry="6/mmm", source_file=f"{STEM}.nxs")
    client = _client(root)
    sym_slug = f"{SLUG}-sym6mmm"
    out = client.post(f"/api/datasets/{sym_slug}/regrid", json={}).json()
    assert out["written"] is False
    assert out["refusal"]["code"] == SYMMETRISED_WITHOUT_SOURCE
    assert out["fit"] == "symmetric" and out["source_symmetrised"] is True
    assert out["operations"] == 4 and out["operations_from"] == f"{sym_stem}.nxs"
    assert out["turn_deg"] is None and out["dataset_id"] is None

    _raw(root)  # the unsymmetrised volume it was made from, beside it now
    out = client.post(f"/api/datasets/{sym_slug}/regrid", json={}).json()
    assert out["written"] is True and out["symmetrised"] is True
    assert out["refined_on"] == f"{STEM}.nxs" and out["fit"] == "both"
    assert out["file"] == f"{sym_stem}_regridded_sym.nxs"
    assert out["dataset_id"] == f"{sym_slug}-regridded-sym"
    assert out["turn_deg"] == pytest.approx(TURN_DEG, abs=0.005)
    meta = client.get(f"/api/volumes/{out['dataset_id']}.raw/meta").json()
    assert meta["symmetry"] == "6/mmm" and len(meta["symmetry_ops"]) == 4


def test_regrid_endpoint_refusals_and_errors(tmp_path):
    root = _root(tmp_path)
    _raw(root, _crystal(UB))
    client = _client(root)
    out = client.post(f"/api/datasets/{SLUG}/regrid", json={}).json()
    assert out["written"] is False and out["refusal"]["code"] == TURN_BELOW_NOISE
    assert out["turn_deg"] < UB_TURN and out["dataset_id"] is None and out["file"] is None
    assert not (root / "raw" / f"{NEW_STEM}.nxs").exists()

    assert client.post("/api/datasets/nope/regrid", json={}).status_code == 404
    for bad in ({"cell": [0, 1, 1]}, {"cell": [1, 1]}, {"q_max": -1.0}):
        assert client.post(f"/api/datasets/{SLUG}/regrid", json=bad).status_code == 400

    # Pipeline outputs of a regridded dataset whose raw volume is gone: a new
    # file under that stem would inherit them, so it is refused.
    nebula3d.save(_crystal(UB, half=1.0),
                  pipeline_paths(root / "raw" / f"{NEW_STEM}.nxs",
                                 proc_dir=root / "processed").ringremoved)
    out = client.post(f"/api/datasets/{SLUG}/regrid", json={}).json()
    assert out["refusal"]["code"] == TARGET_EXISTS and "in use" in out["refusal"]["reason"]
    assert out["dataset_id"] is None


# ---------------------------------------------------------------------------
# The browser bridge, and its parity with the API
# ---------------------------------------------------------------------------
def _bridge(tmp_path, vol: HKLVolume | None = None) -> None:
    webbridge.setup(workdir=str(tmp_path / "work"))
    upload = tmp_path / "upload.nxs"
    nebula3d.save(_crystal(TURN @ UB) if vol is None else vol, upload)
    assert webbridge.load_input(f"{STEM}.nxs", str(upload)) == SLUG


def test_bridge_regrid_registers_the_new_dataset(tmp_path):
    _bridge(tmp_path)
    raw = tmp_path / "work" / "raw" / f"{STEM}.nxs"
    before = _sha256(raw)
    out = json.loads(webbridge.dataset_regrid_json(SLUG, "1,1,1"))
    assert out["written"] is True and out["dataset_id"] == NEW_SLUG
    assert out["turn_deg"] == pytest.approx(TURN_DEG, abs=0.005)
    # Registered as an input, as a load is: listed, and the next run's input.
    assert webbridge._S.input == raw.with_name(out["file"])
    assert webbridge._S.dataset_id == NEW_SLUG
    assert json.loads(webbridge.select_input(NEW_SLUG)) is True
    assert NEW_SLUG in {d["id"] for d in json.loads(webbridge.datasets_json())}
    meta = json.loads(webbridge.volume_meta_json(f"{NEW_SLUG}.raw"))
    assert np.allclose(meta["ub_matrix"], out["ub"], atol=1e-7)
    assert _sha256(raw) == before
    # The browser computes in float32, and writes so.
    assert nebula3d.load(raw.with_name(out["file"]), dtype=None).data.dtype == np.float32

    again = json.loads(webbridge.dataset_regrid_json(SLUG, "1,1,1"))
    assert again["written"] is False and again["refusal"]["code"] == TARGET_EXISTS
    with pytest.raises(KeyError):
        webbridge.dataset_regrid_json("nope")
    with pytest.raises(ValueError, match="cell must be"):
        webbridge.dataset_regrid_json(SLUG, "0,1,1")


@pytest.mark.parametrize("right_ub", [False, True], ids=["turned", "right"])
def test_the_api_and_the_bridge_return_the_same_fields(tmp_path, right_ub):
    vol = _crystal(UB if right_ub else TURN @ UB)
    server_root = _root(tmp_path / "server")
    _raw(server_root, vol)
    client = _client(server_root)
    _bridge(tmp_path / "bridge", vol)

    def both() -> tuple[dict, dict]:
        server = client.post(f"/api/datasets/{SLUG}/regrid", json={"cell": [1, 1, 1]})
        assert server.status_code == 200, server.text
        return server.json(), json.loads(webbridge.dataset_regrid_json(SLUG, "1,1,1"))

    server, bridge = both()
    assert set(server) == set(bridge)
    assert server == bridge
    assert server["written"] is (not right_ub)
    if not right_ub:  # and a refusal: the file exists now on both sides
        server, bridge = both()
        assert server == bridge and server["refusal"]["code"] == TARGET_EXISTS
