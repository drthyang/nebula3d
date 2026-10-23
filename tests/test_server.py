"""Tests for the FastAPI backend (datasets + slice endpoints).

Uses a synthetic data root so it is fast and independent of the real volumes.
The key correctness check is that the binary slice endpoint returns exactly what
``extract_slice`` produces directly.
"""

import json
import struct

import h5py
import numpy as np
import pytest
from fastapi.testclient import TestClient

import nebula3d
from nebula3d.core import HKLVolume
from nebula3d.io import save_delta_pdf
from nebula3d.pipeline import pipeline_paths
from nebula3d.server import deltapdf as dpdf_mod
from nebula3d.server import volumes as vol_mod
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import discover_datasets
from nebula3d.server.routers import datasets as datasets_router
from nebula3d.utils import ub_from_lattice
from nebula3d.visualization import extract_slice

UB = 2 * np.pi * np.eye(3) / 4.0
STEM = "sample_300K_test_cc_sub_bkg"
SLUG = "sample-300K-test-cc-sub-bkg"


def _vol(shape=(7, 9, 11), seed=0):
    rng = np.random.default_rng(seed)
    data = 1.0 + rng.normal(0.0, 0.3, shape)
    return HKLVolume.from_arrays(data, (-3, 3), (-4, 4), (-5, 5), ub_matrix=UB)


@pytest.fixture
def env(tmp_path):
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    vol = _vol()
    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs",
                           proc_dir=tmp_path / "processed")
    nebula3d.save(vol, paths.ringremoved)
    nebula3d.save(vol, paths.backfilled)
    vol_mod.clear_cache()
    app = create_app(ServerConfig(data_root=tmp_path))
    return TestClient(app), vol


def _parse_envelope(body: bytes):
    (hlen,) = struct.unpack("<I", body[:4])
    header = json.loads(body[4:4 + hlen].decode("utf-8"))
    data = np.frombuffer(body[4 + hlen:], dtype="<f4").reshape(
        header["ny"], header["nx"])
    return header, data


def test_health(env):
    client, _ = env
    assert client.get("/api/health").json() == {"status": "ok"}


def test_list_datasets_reflects_disk(env):
    client, _ = env
    data = client.get("/api/datasets").json()
    assert len(data) == 1
    ds = data[0]
    assert ds["id"] == SLUG
    assert ds["temperature"] == "300K"
    status = {s["name"]: s["exists"] for s in ds["stages"]}
    assert status["ringremoved"] is True
    assert status["backfilled"] is True
    assert status["raw"] is False          # no .nxs synthesised
    assert status["braggpunched"] is False
    assert status["flattened"] is False
    assert status["delta_pdf"] is False
    # volume ids are addressable
    vid = {s["name"]: s["volume_id"] for s in ds["stages"]}
    assert vid["ringremoved"] == f"{SLUG}.ringremoved"


def test_list_datasets_dates_each_output(env, tmp_path):
    # When each output was written, so the console can tell an output older
    # than one upstream of it (made before that stage last ran); none when it
    # does not exist.
    import os

    client, _ = env
    ds = client.get("/api/datasets").json()[0]
    mtime = {s["name"]: s["mtime"] for s in ds["stages"]}
    assert mtime["braggpunched"] is None and mtime["raw"] is None
    ring = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs",
                          proc_dir=tmp_path / "processed").ringremoved
    assert mtime["ringremoved"] == os.stat(ring).st_mtime
    assert isinstance(mtime["backfilled"], float)


def test_data_root_can_be_switched(tmp_path):
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs",
                           proc_dir=tmp_path / "processed")
    nebula3d.save(_vol(), paths.ringremoved)

    alt = tmp_path / "alt_data"
    (alt / "raw").mkdir(parents=True)
    (alt / "processed").mkdir()
    alt_stem = "sample_325K_alt_cc_sub_bkg"
    alt_slug = "sample-325K-alt-cc-sub-bkg"
    alt_paths = pipeline_paths(alt / "raw" / f"{alt_stem}.nxs",
                               proc_dir=alt / "processed")
    nebula3d.save(_vol(seed=1), alt_paths.ringremoved)

    app = create_app(ServerConfig(data_root=tmp_path))
    client = TestClient(app)

    assert client.get("/api/data-root").json()["data_root"] == str(tmp_path)
    assert client.get("/api/datasets").json()[0]["id"] == SLUG

    switched = client.put("/api/data-root", json={"data_root": str(alt)})
    assert switched.status_code == 200
    body = switched.json()
    assert body["data_root"] == str(alt)
    assert body["raw_exists"] is True
    assert body["processed_exists"] is True
    assert body["n_datasets"] == 1
    assert client.get("/api/datasets").json()[0]["id"] == alt_slug

    missing = client.put("/api/data-root", json={"data_root": str(tmp_path / "nope")})
    assert missing.status_code == 400


def test_data_root_browse_switches_selected_folder(tmp_path, monkeypatch):
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()

    alt = tmp_path / "picked"
    (alt / "raw").mkdir(parents=True)
    (alt / "processed").mkdir()
    alt_stem = "sample_350K_picked_cc_sub_bkg"
    alt_slug = "sample-350K-picked-cc-sub-bkg"
    alt_paths = pipeline_paths(alt / "raw" / f"{alt_stem}.nxs",
                               proc_dir=alt / "processed")
    nebula3d.save(_vol(seed=2), alt_paths.ringremoved)

    monkeypatch.setattr(datasets_router, "_choose_directory", lambda _initial: alt)

    app = create_app(ServerConfig(data_root=tmp_path))
    client = TestClient(app)

    blocked = client.post("/api/data-root/browse")
    assert blocked.status_code == 403

    picked = client.post("/api/data-root/browse", headers={"X-Nebula3d-Local": "1"})
    assert picked.status_code == 200
    body = picked.json()
    assert body["data_root"] == str(alt)
    assert body["n_datasets"] == 1
    assert client.get("/api/datasets").json()[0]["id"] == alt_slug


def test_data_root_browse_cancel_leaves_root(tmp_path, monkeypatch):
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    monkeypatch.setattr(datasets_router, "_choose_directory", lambda _initial: None)

    app = create_app(ServerConfig(data_root=tmp_path))
    client = TestClient(app)

    canceled = client.post("/api/data-root/browse", headers={"X-Nebula3d-Local": "1"})
    assert canceled.status_code == 409
    assert client.get("/api/data-root").json()["data_root"] == str(tmp_path)


@pytest.mark.parametrize("dpdf_name", ["full_chain", "short_legacy", "both"])
def test_discovery_no_phantom_from_delta_pdf_names(tmp_path, dpdf_name):
    """``*_delta_pdf.h5`` files attach to their dataset instead of spawning a
    phantom one — whether named with the full pipeline chain
    (``…_backfilled_delta_pdf.h5``) or the short legacy stem
    (``{stem}_delta_pdf.h5``).  Regression: both names previously slipped past
    the seeding skip-check (in opposite directions) and created a duplicate
    dataset carrying only the ΔPDF stage."""
    (tmp_path / "raw").mkdir()
    proc = tmp_path / "processed"
    proc.mkdir()
    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs", proc_dir=proc)
    nebula3d.save(_vol(), paths.ringremoved)
    nebula3d.save(_vol(), paths.backfilled)
    if dpdf_name in ("full_chain", "both"):
        _write_dpdf(paths.delta_pdf)               # …_backfilled_delta_pdf.h5
    if dpdf_name in ("short_legacy", "both"):
        _write_dpdf(proc / f"{STEM}_delta_pdf.h5")  # short legacy name

    datasets = discover_datasets(ServerConfig(data_root=tmp_path))

    assert len(datasets) == 1
    ds = datasets[0]
    assert ds.id == SLUG
    assert next(s for s in ds.stages if s.name == "delta_pdf").exists is True


def test_volume_meta(env):
    client, vol = env
    m = client.get(f"/api/volumes/{SLUG}.ringremoved/meta").json()
    assert m["shape"] == list(vol.data.shape)
    assert m["h_range"] == [-3.0, 3.0]
    assert m["l_range"] == [-5.0, 5.0]
    assert m["lattice"]["a"] == pytest.approx(4.0)
    assert "hk" in m["planes"] and "0kl" in m["planes"]


def test_volume_meta_says_where_sigma_came_from(tmp_path):
    """A NeXus Viewer hand-off without /entry/sigma: σ is √|I|, and on its
    normalized values the meta carries the note the agent reads."""
    import h5py

    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    n = 15
    with h5py.File(tmp_path / "raw" / f"{STEM}.nxs", "w") as f:
        entry = f.create_group("entry")
        entry["data"] = np.random.default_rng(0).uniform(0.05, 0.6, (n, n, n))
        for name in ("h_axis", "k_axis", "l_axis"):
            entry[name] = np.linspace(-2, 2, n)
        entry["ub_matrix"] = UB
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    m = client.get(f"/api/volumes/{SLUG}.raw/meta").json()
    assert m["sigma"] == "estimated"
    assert "√|I|" in m["sigma_note"] and "non-integer" in m["sigma_note"]


@pytest.mark.parametrize("layout", ["mantid", "entry"])
def test_declared_symmetry(tmp_path, layout):
    """A NeXus Viewer export's symmetry and symmetry_ops reach the volume meta:
    attributes of the nebula3d group in the Mantid layout, of /entry in the
    legacy one."""
    import h5py

    path = tmp_path / "viewer.nxs"
    write = _write_export if layout == "mantid" else _write_entry
    write(path, _vol(), symmetry="-1", symmetry_ops="h,k,l; -h,-k,-l")
    label, ops = vol_mod.declared_symmetry(path)
    assert label == "-1"
    assert ops == [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, -1]]]
    plain = tmp_path / "plain.h5"
    with h5py.File(plain, "w") as f:
        f.create_group("entry")
    assert vol_mod.declared_symmetry(plain) == (None, None)
    nebula3d.save(_vol(), tmp_path / "own.nxs")   # NEBULA3D's own output declares none
    assert vol_mod.declared_symmetry(tmp_path / "own.nxs") == (None, None)


def test_volume_coverage(env):
    client, vol = env
    c = client.get(f"/api/volumes/{SLUG}.ringremoved/coverage").json()
    assert c["id"] == f"{SLUG}.ringremoved"
    assert len(c["q"]) == len(c["counted"])  # a 7×9×11 volume has no 50-voxel shell
    assert 0 < c["box_q"] < c["box_corner_q"]
    assert client.get("/api/volumes/nope.ringremoved/coverage").status_code == 404


SIX_MMM_TEXT = "h,k,l; h+k,-h,l; k,h,l; h,k,-l"


def _hex_ub(a, c):
    astar = 4 * np.pi / (np.sqrt(3) * a)
    return np.array([[astar, astar / 2, 0], [0, astar * np.sqrt(3) / 2, 0], [0, 0, 2 * np.pi / c]])


def _hex_crystal(ub, ub_true, symmetrise=False):
    """A 61³ volume indexed with *ub* whose Bragg peaks sit at the nodes of *ub_true*."""
    from nebula3d.symmetry import GridSymmetry, parse_symmetry_ops

    vol = HKLVolume.from_arrays(np.full((61, 61, 61), 10.0), (-3, 3), (-3, 3), (-3, 3),
                                ub_matrix=ub)
    hkl = np.stack(np.meshgrid(vol.h_axis, vol.k_axis, vol.l_axis, indexing="ij"), axis=-1)
    for g in np.array(np.meshgrid(*[np.arange(-3, 4)] * 3, indexing="ij")).reshape(3, -1).T:
        if g.any():
            d = (hkl - np.linalg.inv(ub) @ ub_true @ g) @ ub.T
            vol.data += 500 * np.exp(-(d ** 2).sum(-1) / (2 * 0.15 ** 2))
    if symmetrise:
        sym = GridSymmetry.for_volume(vol, parse_symmetry_ops(SIX_MMM_TEXT))
        sym.orbit_mean(vol.data, vol.mask.copy())
    return vol


def _write_export(path, vol, **attrs):
    """*vol* as the NeXus Viewer exports it: the Mantid layout, with its
    attributes on the nebula3d group."""
    from nebula3d.io.mantid_nxs import MDDim, write_md_histo

    labels = ("[H,0,0]", "[0,K,0]", "[0,0,L]")
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    dims = [MDDim(label, axis, "r.l.u.", "HKL", tuple(np.eye(3)[i]))
            for i, (label, axis) in enumerate(zip(labels, axes))]
    write_md_histo(path, vol.data, dims, content="hkl_volume", valid=vol.mask,
                   ub_matrix=vol.ub_matrix, attrs=attrs)


def _write_entry(path, vol, **attrs):
    """*vol* in the NeXus Viewer's legacy layout, with /entry attributes."""
    with h5py.File(path, "w") as f:
        entry = f.create_group("entry")
        for name, values in (("data", vol.data), ("mask", vol.mask), ("h_axis", vol.h_axis),
                             ("k_axis", vol.k_axis), ("l_axis", vol.l_axis),
                             ("ub_matrix", vol.ub_matrix)):
            entry.create_dataset(name, data=values)
        for key, value in attrs.items():
            entry.attrs[key] = value


def test_volume_ring_isotropy(tmp_path):
    """/rings judges shells: an isotropic powder ring is one, maxima along a few
    directions at the same |Q| are not."""
    n = 61
    blank = HKLVolume.from_arrays(np.zeros((n, n, n)), (-3, 3), (-3, 3), (-3, 3),
                                  ub_matrix=np.eye(3))
    H, K, L = blank.hkl_grid()
    q = blank.q_magnitude()
    ring = np.exp(-0.5 * ((q - 2.0) / 0.06) ** 2)
    lobes = sum(np.exp(-0.5 * ((H - h) ** 2 + (K - k) ** 2 + (L - l_) ** 2) / 0.25 ** 2)
                for h, k, l_ in [(2.6, 0, 0), (-2.6, 0, 0), (0, 0, 2.6), (0, 0, -2.6)])
    data = 1.0 + ring + 3.0 * lobes + np.random.default_rng(0).normal(0.0, 0.01, q.shape)
    vol = HKLVolume.from_arrays(data, (-3, 3), (-3, 3), (-3, 3), ub_matrix=np.eye(3))
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    nebula3d.save(vol, tmp_path / "raw" / f"{STEM}.nxs")
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    r = client.get(f"/api/volumes/{SLUG}.raw/rings", params={"q": "2.0,2.6", "fwhm": "0.14,0.14"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rule"] == {"direction_share": 0.9, "height_share": 0.15}
    assert [s["is_ring"] for s in body["shells"]] == [True, False]
    assert body["shells"][0]["isotropy"] > 0.9
    assert body["not_judged"] is None  # 0.1 Å⁻¹ a voxel: 1.6 voxels across 0.16 Å⁻¹
    # No shell: the grid's own limit alone.
    alone = client.get(f"/api/volumes/{SLUG}.raw/rings", params={"q": "", "fwhm": ""})
    assert alone.status_code == 200, alone.text
    assert (alone.json()["shells"], alone.json()["not_judged"]) == ([], None)
    bad_params = ({"q": "2.0", "fwhm": "0.1,0.1"}, {"q": "x", "fwhm": "0.1"},
                  {"q": "-1", "fwhm": "0.1"}, {"q": "nan", "fwhm": "0.1"},
                  {"q": "2.0", "fwhm": "inf"}, {"q": "inf,2.0", "fwhm": "0.1,0.1"})
    for bad in bad_params:
        assert client.get(f"/api/volumes/{SLUG}.raw/rings", params=bad).status_code == 400


def test_volume_ring_isotropy_on_a_grid_too_coarse(tmp_path):
    """/rings on a grid too coarse to judge any ring (0.3 Å⁻¹ a voxel, under one
    voxel across 0.16 Å⁻¹): not judged, the grid's reason given for the volume
    and every shell, with shells or none."""
    from nebula3d.preprocessing.ring_isotropy import grid_too_coarse

    q = np.linalg.norm(np.stack(np.meshgrid(*[np.linspace(-3, 3, 21)] * 3, indexing="ij")), axis=0)
    vol = HKLVolume.from_arrays(1.0 + np.exp(-0.5 * ((q - 2.0) / 0.06) ** 2), (-3, 3), (-3, 3),
                                (-3, 3), ub_matrix=np.eye(3))
    reason = grid_too_coarse(vol)
    assert reason.startswith("grid too coarse: ")
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    nebula3d.save(vol, tmp_path / "raw" / f"{STEM}.nxs")
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    for q_, fwhm in (("2.0", "0.14"), ("", "")):
        body = client.get(f"/api/volumes/{SLUG}.raw/rings", params={"q": q_, "fwhm": fwhm}).json()
        assert body["not_judged"] == reason
        assert all(s["not_judged"] == reason and not s["is_ring"] for s in body["shells"])
        assert len(body["shells"]) == len([x for x in q_.split(",") if x])


def test_ring_shells_must_be_finite_and_positive():
    # The browser bridge parses /rings requests with the same function.
    assert vol_mod.parse_ring_shells("2.45, 3.66", "0.08,0.08") == [(2.45, 0.08), (3.66, 0.08)]
    assert vol_mod.parse_ring_shells("", "") == []  # the grid's own limit alone
    many = ",".join(["1"] * 65)
    for q, fwhm in [("nan", "0.1"), ("2", "inf"), ("-inf", "0.1"), ("2", "0"), ("2", ""),
                    ("2,3", "0.1"), (many, many)]:
        with pytest.raises(ValueError):
            vol_mod.parse_ring_shells(q, fwhm)


def test_volume_ub_check(tmp_path):
    """The UB check on a NeXus Viewer export: a volume symmetrised under the
    operations it declares takes the symmetric fit, which finds the cell the
    peaks were put on."""
    a, c, a_true, c_true = 4.0, 5.0, 4.04, 4.95
    vol = _hex_crystal(_hex_ub(a, c), _hex_ub(a_true, c_true), symmetrise=True)
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    _write_entry(tmp_path / "raw" / f"{STEM}.nxs", vol, symmetry_ops=SIX_MMM_TEXT)
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    r = client.get(f"/api/volumes/{SLUG}.raw/ub", params={"cell": "1,1,1"})
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["fit"] == "symmetric" and u["symmetrised"] is True and u["operations"] == 4
    assert u["operations_from"] == f"{STEM}.nxs"
    assert u["cell"][:3] == pytest.approx([a_true, a_true, c_true], abs=2e-3)
    assert u["rms"] < 0.01 < u["rms_start"]
    # A cell error: the same relative offset at every |Q| along a direction, gone after.
    in_plane = [o for o in u["radial"] if o["direction"] == "in-plane"]
    assert in_plane
    assert all(o["before"] == pytest.approx(a / a_true - 1, abs=1e-3) for o in in_plane)
    assert all(abs(o["after"]) < 1e-3 for o in u["radial"])
    # A cell error is linear in the node: no mean offset, the origin is where it was.
    assert u["mean_offset_rlu"]["n"] == u["n_used"]
    assert max(abs(x) for x in u["mean_offset_rlu"]["after"]) < 2e-3
    assert client.get(f"/api/volumes/{SLUG}.raw/ub", params={"cell": "2,0,2"}).status_code == 400


def test_volume_ub_check_with_operations_that_do_not_map_the_grid(tmp_path):
    """Operations borrowed for a grid binned otherwise (K at 1.25× H's step)
    cannot map it onto itself: the check fits the rotation and the cell, the
    operations constraining the cell only, instead of failing with a 422."""
    a, a_true = 4.0, 4.04
    ub, ub_true = 2 * np.pi / a * np.eye(3), 2 * np.pi / a_true * np.eye(3)
    vol = HKLVolume.from_arrays(np.full((61, 49, 61), 10.0), (-3, 3), (-3, 3), (-3, 3),
                                ub_matrix=ub)
    hkl = np.stack(np.meshgrid(vol.h_axis, vol.k_axis, vol.l_axis, indexing="ij"), axis=-1)
    for g in np.array(np.meshgrid(*[np.arange(-2, 3)] * 3, indexing="ij")).reshape(3, -1).T:
        if g.any():
            d = (hkl - np.linalg.inv(ub) @ ub_true @ g) @ ub.T
            vol.data += 500 * np.exp(-(d ** 2).sum(-1) / (2 * 0.15 ** 2))
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    _write_entry(tmp_path / "raw" / f"{STEM}.nxs", vol, symmetry_ops="h,k,l; -k,h,l; -h,-k,-l")
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    r = client.get(f"/api/volumes/{SLUG}.raw/ub", params={"cell": "1,1,1"})
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["fit"] == "both" and u["operations"] == 3
    assert u["symmetry_break"] is None and u["symmetrised"] is None
    # The four-fold still constrains the cell: a = b, at the lattice the peaks sit on.
    assert u["cell"][0] == pytest.approx(u["cell"][1], abs=1e-6)
    assert u["cell"][:3] == pytest.approx([a_true] * 3, abs=2e-3)


@pytest.mark.parametrize("layout", ["mantid", "entry"])
def test_volume_ub_check_takes_the_symmetry_of_the_export(tmp_path, layout):
    """An unsymmetrised volume declares no symmetry; its symmetrised export,
    which names it as its source, does: the check fits the rotation and a cell
    constrained by the export's operations."""
    from scipy.spatial.transform import Rotation

    turn = Rotation.from_rotvec(np.radians(0.5) * np.array([1, 2, 3]) / np.sqrt(14)).as_matrix()
    ub = _hex_ub(4.0, 5.0)
    vol = _hex_crystal(ub, turn @ _hex_ub(4.02, 4.98))
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    _write_entry(tmp_path / "raw" / f"{STEM}.nxs", vol)
    write = _write_export if layout == "mantid" else _write_entry
    write(tmp_path / "raw" / f"{STEM}_sym6mmm.nxs", _hex_crystal(ub, ub, symmetrise=True),
          symmetry_ops=SIX_MMM_TEXT, source_file=f"{STEM}.nxs")
    assert vol_mod.symmetry_ops_for(tmp_path / "raw" / f"{STEM}.nxs")[1] == f"{STEM}_sym6mmm.nxs"
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    u = client.get(f"/api/volumes/{SLUG}.raw/ub", params={"cell": "1,1,1"}).json()
    assert u["operations_from"] == f"{STEM}_sym6mmm.nxs" and u["operations"] == 4
    assert u["fit"] == "both" and u["symmetrised"] is False
    assert u["angle_deg"] == pytest.approx(0.5, abs=0.02)
    assert u["cell"] == pytest.approx([4.02, 4.02, 4.98, 90, 90, 120], abs=2e-3)


def test_bragg_profile_missing_returns_empty_state(env):
    client, _ = env
    r = client.get(f"/api/bragg/{SLUG}/profile")
    assert r.status_code == 200
    body = r.json()
    assert body["dataset_id"] == SLUG
    assert body["has_profile"] is False
    assert body["n_peaks"] == 0
    assert body["peaks"] == []


def test_bragg_profile_reads_saved_json(tmp_path):
    (tmp_path / "raw").mkdir()
    proc = tmp_path / "processed"
    proc.mkdir()
    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs", proc_dir=proc)
    nebula3d.save(_vol(), paths.braggpunched)
    paths.bragg_profile_json.write_text(json.dumps({
        "schema_version": 1,
        "width_labels": ["Qx", "Qy", "Qz"],
        "hkl_width_labels": ["H", "K", "L"],
        "width_units": {"hkl": "r.l.u.", "q": "Å⁻¹"},
        "n_peaks": 1,
        "fit_covariance": True,
        "punch_frame": "q",
        "peaks": [{
            "index": 0,
            "source_node_hkl": [1, 0, 0],
            "center_hkl": [1.0, 0.0, 0.0],
            "q_abs": 1.57,
            "intensity": 4.2,
            "local_background": 1.1,
            "width_hkl": [0.3, 0.2, 0.1],
            "width_q": [0.12, 0.08, 0.04],
            "principal_width_hkl": [0.3, 0.2, 0.1],
            "principal_width_q": [0.12, 0.08, 0.04],
            "principal_directions_hkl": [
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            "fit_kind": "tilted",
        }],
    }), encoding="utf-8")

    app = create_app(ServerConfig(data_root=tmp_path))
    client = TestClient(app)
    r = client.get(f"/api/bragg/{SLUG}/profile")

    assert r.status_code == 200
    body = r.json()
    assert body["has_profile"] is True
    assert body["fit_covariance"] is True
    assert body["peaks"][0]["width_q"] == [0.12, 0.08, 0.04]


def test_ring_diagnostics_missing_returns_empty_state(env):
    client, _ = env
    r = client.get(f"/api/rings/{SLUG}/diagnostics")
    assert r.status_code == 200
    assert r.json() == {
        "dataset_id": SLUG,
        "diagnostics_path": r.json()["diagnostics_path"],
        "has_diagnostics": False,
        "status": None,
        "unconfirmed_at_grid": None,
    }
    assert r.json()["diagnostics_path"].endswith("_ringremoved_diagnostics.json")
    assert client.get("/api/rings/nope/diagnostics").status_code == 404


def test_ring_diagnostics_give_the_rings_left_unconfirmed_on_the_grid(tmp_path):
    """The ring removal's record (G1): the rings the pooled model detected and
    could not confirm on its grid, as its run log gives them, from the
    diagnostics the ring stage writes. The demo's Al rings on 0.2 r.l.u. a
    voxel (0.3 Å⁻¹). Diagnostics older than the volume describe a removal
    that no longer exists, and give nothing; a removal that left no shell
    unconfirmed gives none."""
    import os

    from nebula3d.demo import DemoModel, demo_volume
    from nebula3d.pipeline import RingParams, remove_rings, unconfirmed_rings_notice
    from nebula3d.preprocessing import write_global_ring_diagnostics

    (tmp_path / "raw").mkdir()
    proc = tmp_path / "processed"
    proc.mkdir()
    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs", proc_dir=proc)
    vol = demo_volume(41, seed=3, model=DemoModel(sro_amp=0.09), dtype=np.float32)
    lines: list[str] = []
    out = remove_rings(vol, RingParams(ring_model="pooled"),
                       progress=lambda stage, status, frac, msg: lines.append(msg))
    nebula3d.save(out, paths.ringremoved)
    write_global_ring_diagnostics(getattr(out, "_ring_diagnostics"), paths.ring_diagnostics_json)
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))

    body = client.get(f"/api/rings/{SLUG}/diagnostics").json()
    assert body["has_diagnostics"] is True and body["status"] == "no_confirmed_rings"
    left = body["unconfirmed_at_grid"]
    assert left["count"] == len(left["q_centers"]) > 0
    assert left["needs"] == "1 voxel across 0.16 Å⁻¹"
    assert lines[-1].endswith(f". ⚠ {left['notice']}")
    assert left["notice"] == unconfirmed_rings_notice(left["count"], left["needs"])
    assert " ring candidate" in left["notice"] and "not confirmed at this grid" in left["notice"]

    written = paths.ring_diagnostics_json.stat().st_mtime
    os.utime(paths.ringremoved, (written + 10, written + 10))
    stale = client.get(f"/api/rings/{SLUG}/diagnostics").json()
    assert stale["has_diagnostics"] is False and stale["unconfirmed_at_grid"] is None

    paths.ring_diagnostics_json.write_text(json.dumps({"algorithm": "pooled", "status": "fitted"}),
                                           encoding="utf-8")
    os.utime(paths.ring_diagnostics_json, (written + 20, written + 20))
    none_left = client.get(f"/api/rings/{SLUG}/diagnostics").json()
    assert none_left["has_diagnostics"] is True and none_left["status"] == "fitted"
    assert none_left["unconfirmed_at_grid"] is None

    paths.ring_diagnostics_json.write_text("{not json", encoding="utf-8")
    os.utime(paths.ring_diagnostics_json, (written + 30, written + 30))
    assert client.get(f"/api/rings/{SLUG}/diagnostics").status_code == 500


@pytest.mark.parametrize("plane,value", [("hk", 0.0), ("0kl", 0.0), ("h0l", 1.0)])
def test_slice_matches_extract_slice(env, plane, value):
    client, vol = env
    r = client.get(f"/api/volumes/{SLUG}.ringremoved/slice",
                   params={"plane": plane, "value": value})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/octet-stream"
    header, data = _parse_envelope(r.content)

    ref = extract_slice(vol, plane=plane, value=value)
    assert data.shape == ref.data.shape
    np.testing.assert_allclose(data, ref.data.astype("float32"), rtol=1e-5,
                               atol=1e-5, equal_nan=True)
    assert header["x_label"] == ref.x_label
    assert header["y_label"] == ref.y_label
    np.testing.assert_allclose(header["x_axis"], ref.x_axis, rtol=1e-6)


def test_slice_unknown_volume_404(env):
    client, _ = env
    assert client.get("/api/volumes/nope.ringremoved/slice").status_code == 404


def test_slice_missing_stage_404(env):
    client, _ = env
    # flattened was never written
    assert client.get(f"/api/volumes/{SLUG}.flattened/slice").status_code == 404


def test_slice_bad_plane_400(env):
    client, _ = env
    r = client.get(f"/api/volumes/{SLUG}.ringremoved/slice",
                   params={"plane": "zz"})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# ΔPDF endpoints
# ---------------------------------------------------------------------------
def _write_dpdf(path, nx=6, ny=8, nz=10, *, layout="mantid", angles=None):
    """A small ΔPDF file: the Mantid MDHistoWorkspace layout NEBULA3D writes, or
    the legacy root one (data, x/y/z_axis, ``lat_*`` attrs).  *angles* are the
    cell's (α, β, γ); None means 90° — and no angle attrs in a legacy file, as
    in files written before the angles were stored."""
    rng = np.random.default_rng(2)
    data = rng.normal(0.0, 1.0, (nx, ny, nz)).astype(np.float64)
    x = np.linspace(-10, 10, nx)
    y = np.linspace(-12, 12, ny)
    z = np.linspace(-15, 15, nz)
    if layout == "mantid":
        ub = ub_from_lattice(5.8, 10.4, 24.7, *(angles or (90.0, 90.0, 90.0)))
        save_delta_pdf(path, data, x, y, z, ub_matrix=ub, logs={"q_max": 11.9})
        return data, x, y, z
    with h5py.File(path, "w") as fh:
        fh.create_dataset("data", data=data)
        fh.create_dataset("x_axis", data=x)
        fh.create_dataset("y_axis", data=y)
        fh.create_dataset("z_axis", data=z)
        fh.attrs["lat_a"] = 5.8
        fh.attrs["lat_b"] = 10.4
        fh.attrs["lat_c"] = 24.7
        fh.attrs["q_max"] = 11.9
        if angles is not None:
            fh.attrs["lat_alpha"], fh.attrs["lat_beta"], fh.attrs["lat_gamma"] = angles
    return data, x, y, z


def _dpdf_client(tmp_path, **kw):
    (tmp_path / "raw").mkdir()
    (tmp_path / "processed").mkdir()
    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs",
                           proc_dir=tmp_path / "processed")
    data, x, y, z = _write_dpdf(paths.delta_pdf, **kw)
    dpdf_mod.clear_cache()
    app = create_app(ServerConfig(data_root=tmp_path))
    return TestClient(app), data, x, y, z


@pytest.fixture(params=["mantid", "legacy"])
def dpdf_env(tmp_path, request):
    return _dpdf_client(tmp_path, layout=request.param)


def test_dpdf_meta(dpdf_env):
    client, data, _, _, _ = dpdf_env
    m = client.get(f"/api/deltapdf/{SLUG}.delta_pdf/meta").json()
    assert m["shape"] == list(data.shape)
    assert m["x_range"] == [-10.0, 10.0]
    assert m["z_range"] == [-15.0, 15.0]
    assert m["lattice"]["a"] == pytest.approx(5.8)
    assert m["q_max"] == pytest.approx(11.9)
    assert m["planes"] == ["xy", "xz", "yz"]


@pytest.mark.parametrize(
    "plane,fixed_axis,xl,yl",
    [("xy", "z", "x_H (Å)", "y_K (Å)"),
     ("xz", "y", "x_H (Å)", "z_L (Å)"),
     ("yz", "x", "y_K (Å)", "z_L (Å)")],
)
def test_dpdf_slice_matches_transpose(dpdf_env, plane, fixed_axis, xl, yl):
    client, data, x, y, z = dpdf_env
    r = client.get(f"/api/deltapdf/{SLUG}.delta_pdf/slice",
                   params={"plane": plane, "value": 0.0})
    assert r.status_code == 200
    header, arr = _parse_envelope(r.content)

    axis = {"x": x, "y": y, "z": z}[fixed_axis]
    i = int(np.argmin(np.abs(axis - 0.0)))
    ref = {
        "xy": data[:, :, i].T,
        "xz": data[:, i, :].T,
        "yz": data[i, :, :].T,
    }[plane].astype("float32")
    assert arr.shape == ref.shape
    np.testing.assert_allclose(arr, ref, rtol=1e-5, atol=1e-5)
    assert header["x_label"] == xl
    assert header["y_label"] == yl


def test_dpdf_file_without_angles_is_drawn_at_right_angles(tmp_path):
    """Files written before the cell angles were stored: no angles in the meta,
    every section drawn at 90°, and the section plane sits |cut| from the origin."""
    client, _, _, _, z = _dpdf_client(tmp_path, layout="legacy")
    m = client.get(f"/api/deltapdf/{SLUG}.delta_pdf/meta").json()
    assert m["lattice"]["gamma"] is None
    r = client.get(f"/api/deltapdf/{SLUG}.delta_pdf/slice",
                   params={"plane": "xy", "value": 4.0})
    header, _ = _parse_envelope(r.content)
    cut = float(z[int(np.argmin(np.abs(z - 4.0)))])
    assert header["axes_angle"] == 90.0
    assert header["r_center"] == [0.0, 0.0]
    assert header["r_perp"] == pytest.approx(abs(cut))


@pytest.mark.parametrize("layout", ["mantid", "legacy"])
@pytest.mark.parametrize("plane,angle", [("xy", 115.0), ("xz", 100.0), ("yz", 75.0)])
def test_dpdf_slices_carry_the_real_section_angle(tmp_path, layout, plane, angle):
    """With the cell angles stored (the oriented lattice; lat_alpha/beta/gamma
    in a legacy file), each section reports its own angle (γ for x_H–y_K, β
    for x_H–z_L, α for y_K–z_L) and the meta lists them."""
    client, *_ = _dpdf_client(tmp_path, layout=layout, angles=(75.0, 100.0, 115.0))

    m = client.get(f"/api/deltapdf/{SLUG}.delta_pdf/meta").json()
    assert (m["lattice"]["alpha"], m["lattice"]["beta"], m["lattice"]["gamma"]) == (
        pytest.approx(75.0), pytest.approx(100.0), pytest.approx(115.0))
    r = client.get(f"/api/deltapdf/{SLUG}.delta_pdf/slice",
                   params={"plane": plane, "value": 0.0})
    header, _ = _parse_envelope(r.content)
    assert header["axes_angle"] == pytest.approx(angle)


def test_dpdf_features_lists_extrema_in_angstrom_and_lattice_units(dpdf_env):
    """The ΔPDF's strongest extrema (analysis.dpdf_features), served: each
    vector in Å along a, b, c and in lattice units, the strongest first."""
    client, *_ = dpdf_env
    r = client.get(f"/api/deltapdf/{SLUG}.delta_pdf/features", params={"min_sigma": 1, "limit": 5})
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["sigma"] > 0 and f["min_sigma"] == 1 and 0 < len(f["groups"]) <= 5
    assert f["n_extrema"] >= len(f["groups"])
    sizes = [g["size_sigma"] for g in f["groups"]]
    assert sizes == sorted(sizes, reverse=True) and sizes[-1] >= 1
    for g in f["groups"]:
        assert g["sign"] in (1, -1) and g["n"] >= len(g["vectors"]) >= 1
        for v, u in zip(g["vectors"], g["vectors_rlu"]):
            # lattice units to 4 decimals: within 0.5e-4 of a cell edge (24.7 Å)
            assert [u[0] * 5.8, u[1] * 10.4, u[2] * 24.7] == pytest.approx(v, abs=2e-3)
            assert g["length"] >= f["origin_radius"]
    # No raw file, so no symmetry declared: grouped by sign, length and size.
    assert f["grouped_by"] == "sign, length and size (no symmetry declared)"
    assert all(g["multiplicity"] is None and 1 <= g["mean_size_sigma"] <= g["size_sigma"]
               for g in f["groups"])
    url = f"/api/deltapdf/{SLUG}.delta_pdf/features"
    assert client.get(url, params={"min_sigma": 0}).status_code == 422
    assert client.get(url, params={"limit": 0}).status_code == 422


@pytest.mark.parametrize("declared", [True, False])
def test_dpdf_features_are_grouped_by_the_symmetry_the_raw_file_declares(tmp_path, declared):
    """The raw file declares m-3m (a NeXus Viewer export's symmetry and
    symmetry_ops): the ΔPDF's peaks on two m-3m orbits, their copies unequal,
    are two entries, each of its multiplicity. Declaring nothing, they are
    grouped by sign, length and size, which splits the unequal copies."""
    from tests.test_dpdf_features import M3M, write_declared_dataset

    write_declared_dataset(tmp_path, STEM, ("m-3m", M3M) if declared else None)
    dpdf_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    r = client.get(f"/api/deltapdf/{SLUG}.delta_pdf/features", params={"min_sigma": 8, "limit": 30})
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["n_extrema"] == 27  # 24 + 3, one per ± pair
    if not declared:
        assert f["grouped_by"] == "sign, length and size (no symmetry declared)"
        assert len(f["groups"]) > 2 and sum(g["n"] for g in f["groups"]) == 27
        return
    assert f["grouped_by"] == "declared symmetry (m-3m: 48 operations, r ≡ −r)"
    assert [(g["sign"], g["n"], g["multiplicity"]) for g in f["groups"]] == [(1, 24, 24),
                                                                             (-1, 3, 3)]
    general, axial = f["groups"]
    assert general["size_sigma"] == max(general["sizes_sigma"]) > general["mean_size_sigma"]
    # The representative first, in Å and in lattice units; ⟨1 0 0⟩ at a = 4 Å.
    assert general["vectors_rlu"][0] == pytest.approx([x / 4.0 for x in general["vectors"][0]],
                                                      abs=1e-4)
    for u in general["vectors_rlu"]:
        assert sorted(abs(x) for x in u) == pytest.approx([0.25, 0.5, 0.75], abs=0.03)
    for u in axial["vectors_rlu"]:
        assert sorted(abs(x) for x in u) == pytest.approx([0.0, 0.0, 1.0], abs=0.03)
    assert axial["length"] == pytest.approx(4.0, abs=0.05)


def test_dpdf_bad_plane_400(dpdf_env):
    client, *_ = dpdf_env
    r = client.get(f"/api/deltapdf/{SLUG}.delta_pdf/slice", params={"plane": "hk"})
    assert r.status_code == 400


def test_dpdf_endpoint_rejects_hkl_volume(env):
    client, _ = env
    assert client.get(f"/api/deltapdf/{SLUG}.ringremoved/meta").status_code == 400


def test_hkl_endpoint_rejects_dpdf_volume(dpdf_env):
    client, *_ = dpdf_env
    assert client.get(f"/api/volumes/{SLUG}.delta_pdf/slice").status_code == 400


# ---------------------------------------------------------------------------
# back-FFT consistency endpoints
# ---------------------------------------------------------------------------
def test_consistency_meta_and_band(env):
    """Meta returns metrics + |Q| span; a sub-band limits the metric region."""
    client, _ = env
    full = client.get(f"/api/consistency/{SLUG}/meta")
    assert full.status_code == 200
    m = full.json()
    assert m["q_data_max"] > 0
    assert "kl" in m["planes"]
    assert m["metrics"]["q_band"] is None
    full_vox = m["metrics"]["n_voxels"]

    qmax = m["q_data_max"]
    banded = client.get(f"/api/consistency/{SLUG}/meta",
                        params={"q_min": qmax * 0.3, "q_max": qmax * 0.7})
    assert banded.status_code == 200
    mb = banded.json()
    assert mb["metrics"]["q_band"][0] == pytest.approx(qmax * 0.3)
    assert 0 < mb["metrics"]["n_voxels"] < full_vox   # the shell is a subset


def test_consistency_slice_envelope(env):
    client, _ = env
    r = client.get(f"/api/consistency/{SLUG}/slice",
                   params={"panel": "recon", "plane": "kl", "value": 0.0})
    assert r.status_code == 200
    header, data = _parse_envelope(r.content)
    assert data.shape == (header["ny"], header["nx"])
    assert header["x_label"] and header["y_label"]


def test_consistency_bad_panel_400(env):
    client, _ = env
    r = client.get(f"/api/consistency/{SLUG}/slice",
                   params={"panel": "nope", "plane": "kl"})
    assert r.status_code == 400


def test_consistency_unknown_dataset_404(env):
    client, _ = env
    assert client.get("/api/consistency/does-not-exist/meta").status_code == 404
    assert client.get("/api/consistency/does-not-exist/check").status_code == 404


def test_consistency_check_reads_saved_json(env, tmp_path):
    """The saved check is served as written (NaN → null), with no FFT."""
    client, _ = env
    r = client.get(f"/api/consistency/{SLUG}/check")
    assert r.status_code == 200
    assert r.json()["has_check"] is False
    assert r.json()["metrics"] is None

    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs",
                           proc_dir=tmp_path / "processed")
    paths.pdf_check_json.write_text(json.dumps({
        "pearson_r": 0.978, "normalized_rms": 0.21, "rms": 0.01,
        "n_voxels": 100, "per_plane_r": {"0": float("nan")},
        "crop_hkl": None, "q_band": None, "apodization": "none",
    }))
    body = client.get(f"/api/consistency/{SLUG}/check").json()
    assert body["has_check"] is True
    assert body["metrics"]["pearson_r"] == pytest.approx(0.978)
    assert body["metrics"]["per_plane_r"] == {"0": None}


def test_consistency_check_stale_when_older_than_dpdf(env, tmp_path):
    """A check older than the ΔPDF describes a ΔPDF that no longer exists."""
    import os

    client, _ = env
    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs",
                           proc_dir=tmp_path / "processed")
    paths.pdf_check_json.write_text(json.dumps(
        {"pearson_r": 0.99, "normalized_rms": 0.1}))
    paths.delta_pdf.write_bytes(b"")
    t = paths.pdf_check_json.stat().st_mtime
    os.utime(paths.delta_pdf, (t + 10, t + 10))
    body = client.get(f"/api/consistency/{SLUG}/check").json()
    assert body["has_check"] is False
    assert body["metrics"] is None


# ---------------------------------------------------------------------------
# request → PipelineParams mapping
# ---------------------------------------------------------------------------
def test_build_params_punch_significance_override():
    """The significance gate defaults to 5σ; a value overrides it, 0 turns it off."""
    from nebula3d.server.params import build_params
    from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

    def gate(**kw):
        req = PipelineRunRequest(dataset_id="x", params=StageParamsIn(**kw))
        return build_params(req).punch.min_significance

    assert gate() == 5.0
    assert gate(punch_min_significance=7.5) == 7.5
    assert gate(punch_min_significance=0) is None


def test_build_params_gate_off_falls_back_to_the_floors():
    """Integer nodes are judged by significance; with the gate off, by the floors."""
    from nebula3d.pipeline import bragg_remover
    from nebula3d.server.params import build_params
    from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

    def punch(**kw):
        req = PipelineRunRequest(dataset_id="x", params=StageParamsIn(**kw))
        return build_params(req).punch

    assert punch().integer_detect == "significance"
    off = punch(punch_min_significance=0)
    assert off.integer_detect == "floors"
    bragg_remover(off)  # a valid remover: the floors need no gate


def test_build_params_punch_supercell_and_h_guard():
    """A supercell factor per axis (the others stay 1); an H guard, 0 = off."""
    from nebula3d.server.params import build_params
    from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

    def punch(**kw):
        req = PipelineRunRequest(dataset_id="x", params=StageParamsIn(**kw))
        return build_params(req).punch

    assert punch().supercell == (1, 1, 1)
    assert punch().integer_h_guard_hkl == 0.12
    assert punch(punch_supercell_h=2, punch_supercell_k=2,
                 punch_supercell_l=2).supercell == (2, 2, 2)
    assert punch(punch_supercell_l=3).supercell == (1, 1, 3)
    assert punch(punch_h_guard=0.2).integer_h_guard_hkl == 0.2
    assert punch(punch_h_guard=0).integer_h_guard_hkl is None


def test_build_params_flatten_model_overrides():
    """The flatten defaults to the model with no ion (a constant only); an ion
    adds its c·F(Q)² term, and "none" keeps the constant only."""
    from nebula3d.server.params import build_params
    from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

    def flat(**kw):
        req = PipelineRunRequest(dataset_id="x", params=StageParamsIn(**kw))
        return build_params(req).flatten

    assert (flat().estimator, flat().ion) == ("model", None)
    assert flat(flatten_ion="Dy3+").ion == "Dy3+"
    assert flat(flatten_ion="none").ion is None
    assert flat(flatten_estimator="floor").estimator == "floor"


def test_build_params_ring_overrides():
    """Ring-removal overrides reach RingParams; omitted ones keep the defaults."""
    from nebula3d.pipeline import RingParams
    from nebula3d.server.routers.pipeline import build_params
    from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

    defaults = build_params(PipelineRunRequest(dataset_id="x"))
    assert defaults.rings.n_patches == RingParams().n_patches
    assert defaults.rings.n_fourier == RingParams().n_fourier
    assert defaults.rings.slice_axis == RingParams().slice_axis

    overridden = build_params(PipelineRunRequest(
        dataset_id="x",
        params=StageParamsIn(rings_n_patches=48, rings_n_fourier=10,
                             rings_slice_axis="L"),
    ))
    assert overridden.rings.n_patches == 48
    assert overridden.rings.n_fourier == 10
    assert overridden.rings.slice_axis == "L"
    # ring model defaults to the stack-pooled sector model; the others are opt-in
    assert defaults.rings.ring_model == "pooled"
    parametric = build_params(PipelineRunRequest(
        dataset_id="x",
        params=StageParamsIn(rings_model="parametric", rings_ring_width=0.3,
                             rings_radial_mode="peaks"),
    ))
    assert parametric.rings.ring_model == "parametric"
    assert parametric.rings.ring_width == 0.3
    assert parametric.rings.ring_radial_mode == "peaks"
    # the parametric radial model defaults to the continuous rolling sweep
    assert defaults.rings.ring_radial_mode == "rolling"
    global_v2 = build_params(PipelineRunRequest(
        dataset_id="x",
        params=StageParamsIn(
            rings_model="global_v2",
            rings_global_material="aluminum",
            rings_global_subtraction="diagnose_only",
            rings_global_confidence_z=1.5,
            rings_global_angular_lmax=3,
            rings_global_min_snr=7.0,
        ),
    ))
    assert global_v2.rings.ring_model == "global_v2"
    assert global_v2.rings.global_material == "aluminum"
    assert global_v2.rings.global_subtraction == "diagnose_only"
    assert global_v2.rings.global_confidence_z == 1.5
    assert global_v2.rings.global_angular_lmax == 3
    assert global_v2.rings.global_min_snr == 7.0
    pooled = build_params(PipelineRunRequest(
        dataset_id="x",
        params=StageParamsIn(rings_model="pooled", rings_pooled_sectors=48,
                             rings_pooled_window_deg=7.5),
    ))
    assert pooled.rings.ring_model == "pooled"
    assert pooled.rings.pooled_sectors == 48
    assert pooled.rings.pooled_window_deg == 7.5
    # an unrelated stage keeps its default
    from nebula3d.pipeline import PunchParams
    assert overridden.punch.min_intensity == PunchParams().min_intensity


def test_build_params_punch_overrides():
    """Punch overrides reach PunchParams; per-axis radii fall back to defaults."""
    from nebula3d.pipeline import PunchParams
    from nebula3d.server.routers.pipeline import build_params
    from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

    base = PunchParams()
    overridden = build_params(PipelineRunRequest(
        dataset_id="x",
        params=StageParamsIn(
            punch_mode="search",
            punch_margin=0.05,
            punch_phi_tail_hkl=0.3,
        ),
    )).punch

    assert overridden.mode == "search"
    assert overridden.margin == 0.05
    assert overridden.phi_tail_hkl == 0.3

    # omitting every punch field leaves PunchParams untouched
    defaults = build_params(PipelineRunRequest(dataset_id="x")).punch
    assert defaults.mode == base.mode
    assert defaults.punch_spherical_radii == base.punch_spherical_radii
    assert defaults.phi_tail_hkl == base.phi_tail_hkl
    # the per-peak spherical frame is the default (since 2026-06-27)
    assert defaults.punch_frame == "spherical"


def test_build_params_punch_search_floor_and_protected_planes():
    """The search floor and the protected H planes reach PunchParams; [] turns
    the protection off, and bad values are refused."""
    from nebula3d.pipeline import PunchParams
    from nebula3d.server.routers.pipeline import build_params
    from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

    base = PunchParams()
    assert base.search_exclude_h_fractions  # protected by default

    def punch(**kw):
        return build_params(PipelineRunRequest(dataset_id="x", params=StageParamsIn(**kw))).punch

    p = punch(punch_search_floor=8.0, punch_search_protect_h=[],
              punch_search_protect_half_width=0.05)
    assert p.search_min_intensity == 8.0 and p.search_min_prominence == 8.0
    assert p.search_exclude_h_fractions is None
    assert p.search_exclude_h_half_width == 0.05
    assert punch(punch_search_protect_h=[0.5]).search_exclude_h_fractions == (0.5,)
    # unset fields keep the defaults
    q = punch()
    assert q.search_exclude_h_fractions == base.search_exclude_h_fractions
    assert q.search_min_intensity == base.search_min_intensity
    assert punch(punch_search_max_width_ratio=2.5).search_max_width_ratio == 2.5
    assert punch(punch_search_max_width_ratio=0).search_max_width_ratio is None  # 0 = off
    assert q.search_max_width_ratio is None
    for bad in ({"punch_search_floor": 0.0}, {"punch_search_protect_h": [1.2]},
                {"punch_search_protect_half_width": -0.1},
                {"punch_search_max_width_ratio": 0.5}):
        with pytest.raises(ValueError):
            punch(**bad)


def test_build_params_flatten_q2_and_fit_range():
    """The b·Q² term and the fit range's end reach FlattenParams; a fit range
    ending before it starts is refused."""
    from nebula3d.pipeline import FlattenParams
    from nebula3d.server.routers.pipeline import build_params
    from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

    def flat(**kw):
        return build_params(PipelineRunRequest(dataset_id="x", params=StageParamsIn(**kw))).flatten

    base = FlattenParams()
    assert not base.q2_term
    f = flat(flatten_q2=True, flatten_fit_q_max=16.0)
    assert f.q2_term and f.fit_q_range == (base.fit_q_range[0], 16.0)
    assert flat().fit_q_range == base.fit_q_range
    with pytest.raises(ValueError):
        flat(flatten_fit_q_max=0.5)


def test_build_params_qspace_punch_overrides():
    """Q-space punch overrides (frame + isotropic / per-axis radii) reach PunchParams."""
    from nebula3d.pipeline import PunchParams
    from nebula3d.server.routers.pipeline import build_params
    from nebula3d.server.schemas import PipelineRunRequest, StageParamsIn

    base = PunchParams()
    iso = build_params(PipelineRunRequest(
        dataset_id="x",
        params=StageParamsIn(punch_frame="q", punch_q_radius=0.1),
    )).punch
    assert iso.punch_frame == "q"
    assert iso.punch_q_radius == 0.1

    # per-axis: a and c overridden, b falls back to the default punch_q_radii
    anis = build_params(PipelineRunRequest(
        dataset_id="x",
        params=StageParamsIn(punch_frame="q",
                             punch_q_radius_a=0.08, punch_q_radius_c=0.2),
    )).punch
    assert anis.punch_q_radii == (0.08, base.punch_q_radii[1], 0.2)

    # spherical is the default frame; the q radii remain available for frame="q"
    assert base.punch_frame == "spherical"
    assert base.punch_q_radii == (0.097, 0.072, 0.115)
    assert base.punch_spherical_radii == (0.097, 0.072, 0.115)

    # spherical-frame radii overrides reach PunchParams (rρ, rθ overridden;
    # rφ falls back to the default spherical radii)
    sph = build_params(PipelineRunRequest(
        dataset_id="x",
        params=StageParamsIn(punch_frame="spherical",
                             punch_spherical_radius_rho=0.13,
                             punch_spherical_radius_theta=0.05),
    )).punch
    assert sph.punch_frame == "spherical"
    assert sph.punch_spherical_radii == (0.13, 0.05, base.punch_spherical_radii[2])

    # Covariance-fit constraints toggle (the fit itself is always on)
    cov = build_params(PipelineRunRequest(
        dataset_id="x",
        params=StageParamsIn(punch_fit_unconstrained=True),
    )).punch
    assert cov.integer_fit_unconstrained is True
    assert base.integer_optimize_shape is True
    assert base.integer_fit_unconstrained is False


# ---------------------------------------------------------------------------
# pipeline job execution (real worker process)
# ---------------------------------------------------------------------------
def test_job_manager_runs_pipeline_in_process(tmp_path):
    import time

    from nebula3d.pipeline import DeltaPdfParams, PipelineParams, pipeline_paths
    from nebula3d.server.jobs import JobManager

    proc = tmp_path / "processed"
    proc.mkdir()
    inp = tmp_path / "s.nxs"
    paths = pipeline_paths(inp, proc_dir=proc)

    # seed a punched volume so backfill → flatten → pdf can run without the slow
    # ring/punch stages (and without a real Mantid .nxs).
    rng = np.random.default_rng(0)
    shape = (17, 17, 17)
    vol = HKLVolume.from_arrays(
        np.abs(rng.normal(1.0, 0.2, shape)), (-3, 3), (-3, 3), (-3, 3), ub_matrix=UB)
    for idx in [(8, 8, 8), (7, 8, 9)]:
        vol.data[idx] = -9.0
        vol.mask[idx] = False
    nebula3d.save(vol, paths.braggpunched)

    params = PipelineParams(
        delta_pdf=DeltaPdfParams(apodization="hann", zero_pad=False, crop_hkl=None))
    job = JobManager().start(inp, params, proc_dir=proc,
                             stages=("backfill", "flatten", "pdf"))

    deadline = time.time() + 120
    while job.status == "running" and time.time() < deadline:
        time.sleep(0.2)

    assert job.status == "done", (job.status, job.error)
    assert paths.delta_pdf.exists()
    stages_done = {e["stage"] for e in job.events if e.get("status") == "done"}
    assert {"backfill", "flatten", "pdf"} <= stages_done


class _EndedWorker:
    """A worker process that has already exited, as the drain sees it."""

    def __init__(self, exitcode):
        self.exitcode = exitcode

    def is_alive(self):
        return False


def _drained(monkeypatch, process, queued=(), status="running"):
    import queue

    from nebula3d.server import jobs as jobs_mod

    monkeypatch.setattr(jobs_mod, "_POLL_S", 0.01)
    q: queue.Queue = queue.Queue()
    for ev in queued:
        q.put(ev)
    job = jobs_mod.Job(id="j", input_name="s.nxs", status=status, _process=process)
    jobs_mod.JobManager()._drain(job, q)
    return job


def test_job_fails_when_its_worker_dies_without_a_word(monkeypatch):
    # A worker the OS kills (the OOM killer) puts neither done nor error: the
    # job must end, or its page and the Pilot's run wait on it forever.
    job = _drained(monkeypatch, _EndedWorker(-9),
                   queued=[{"type": "progress", "stage": "rings", "status": "start"}])
    assert job.status == "error"
    assert "killed (signal 9)" in job.error and "memory" in job.error
    assert len(job.events) == 1  # what it ran stays in the log

    crashed = _drained(monkeypatch, _EndedWorker(1))
    assert crashed.status == "error" and "exited with code 1" in crashed.error


def test_job_keeps_the_last_word_its_worker_put_before_exiting(monkeypatch):
    # A worker that ended normally: its done (or error) is still read, never
    # mistaken for a silent death.
    done = _drained(monkeypatch, _EndedWorker(0), queued=[{"type": "done"}])
    assert (done.status, done.error) == ("done", None)
    failed = _drained(monkeypatch, _EndedWorker(0),
                      queued=[{"type": "error", "message": "ValueError: bad"}])
    assert (failed.status, failed.error) == ("error", "ValueError: bad")
    # A cancelled job's terminated worker leaves it cancelled.
    cancelled = _drained(monkeypatch, _EndedWorker(-15), status="cancelled")
    assert (cancelled.status, cancelled.error) == ("cancelled", None)


def test_job_manager_reports_a_killed_worker(tmp_path):
    import os
    import signal
    import time

    from nebula3d.pipeline import PipelineParams
    from nebula3d.server.jobs import JobManager

    if not hasattr(signal, "SIGKILL"):
        pytest.skip("no SIGKILL on this platform")
    inp = tmp_path / "s.nxs"
    vol = HKLVolume.from_arrays(np.ones((9, 9, 9)), (-1, 1), (-1, 1), (-1, 1), ub_matrix=UB)
    nebula3d.save(vol, inp)
    job = JobManager().start(inp, PipelineParams(), proc_dir=tmp_path / "processed")
    os.kill(job._process.pid, signal.SIGKILL)  # what the OOM killer does

    deadline = time.time() + 20
    while job.status == "running" and time.time() < deadline:
        time.sleep(0.1)
    assert job.status == "error", job.snapshot()
    assert "killed (signal 9)" in job.error


def write_flatten_stages(root, settings=None):
    """A dataset under *root* whose backfilled and flattened stages exist:
    a uniform diffuse on a constant and a Q² pedestal, flattened as the
    pipeline's flatten stage writes it (constant only by default, so the Q²
    stays; its *settings* recorded).  Returns both volumes."""
    import dataclasses

    from nebula3d.pipeline import FlattenParams, _write_flatten_settings, flatten

    settings = settings or FlattenParams()
    rng = np.random.default_rng(11)
    filled = HKLVolume.from_arrays(np.zeros((33, 35, 37)), (-3, 3), (-3, 3), (-3, 3),
                                   ub_matrix=UB)
    q = filled.q_magnitude()
    filled.data[...] = 0.5 + 0.03 * q ** 2 + 0.2 * rng.random(q.shape)
    filled.mask &= q < 4.5
    # A copy: in low-memory mode the flatten subtracts in place over its input.
    flat = flatten(dataclasses.replace(filled, data=filled.data.copy()), settings)
    for name in ("raw", "processed"):
        (root / name).mkdir(exist_ok=True)
    paths = pipeline_paths(root / "raw" / f"{STEM}.nxs", proc_dir=root / "processed")
    nebula3d.save(filled, paths.ringremoved)
    nebula3d.save(filled, paths.backfilled)
    nebula3d.save(flat, paths.flattened)
    _write_flatten_settings(paths.flattened, settings)
    return filled, flat


def test_volume_shell_floors(tmp_path, monkeypatch):
    """/shell-floors: the flattened stage's floors over the whole volume, its
    input's on the same shells (the flatten's own levels) and the level."""
    from nebula3d.preprocessing import flatten_radial_background, shell_floors

    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)  # whatever ran before
    filled, flat = write_flatten_stages(tmp_path)
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    r = client.get(f"/api/volumes/{SLUG}.flattened/shell-floors")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == f"{SLUG}.flattened" and body["before_id"] == f"{SLUG}.backfilled"
    assert (body["q_step"], body["percentile"], body["min_count"]) == (0.05, 25.0, 20)
    assert body["flatten"]["fit_q_range"] == [0.8, 10.0] and body["flatten"]["q2_term"] is False
    want = shell_floors(flat, before=filled)

    def listed(a):
        return [None if not np.isfinite(x) else float(x) for x in a]

    assert body["floors"] == listed(want.floors)
    assert body["floors_before"] == listed(flatten_radial_background(filled).raw_levels)
    assert body["medians_before"] == listed(want.medians_before)
    assert body["counts"] == want.counts.tolist() and body["totals"] == want.totals.tolist()
    assert len(body["q_edges"]) == len(body["centres"]) + 1 == want.centres.size + 1
    assert body["level"] == float(want.level)
    # The flatten took the constant: the floors after it rise with the Q².
    floors = [f for f in body["floors"] if f is not None]
    assert floors[-1] - floors[0] > 0.3
    # Another stage alone, and the settings as asked.
    alone = client.get(f"/api/volumes/{SLUG}.backfilled/shell-floors",
                       params={"percentile": 10, "q_step": 0.1, "min_count": 5}).json()
    assert alone["before_id"] is None and alone["floors_before"] is None
    assert (alone["q_step"], alone["percentile"], alone["min_count"]) == (0.1, 10.0, 5)
    assert alone["level_count"] == int((filled.mask & np.isfinite(filled.data)).sum())
    assert alone["flatten"] is None  # the backfilled stage records no flatten
    for bad in ({"percentile": 101}, {"q_step": 0}, {"min_count": 0}, {"q_step": 1e-5}):
        assert client.get(f"/api/volumes/{SLUG}.flattened/shell-floors",
                          params=bad).status_code == 422
    assert client.get("/api/volumes/nope.flattened/shell-floors").status_code == 404


def test_volume_shell_floors_take_the_runs_own_settings(tmp_path, monkeypatch):
    """A flattened stage is measured with the settings its flatten recorded,
    here the 20th percentile, so the input's floors are that flatten's own
    levels; a setting asked for wins, and a stage without them takes the
    flatten's defaults."""
    from nebula3d.pipeline import FlattenParams
    from nebula3d.preprocessing import flatten_radial_background

    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)  # whatever ran before
    run = FlattenParams(floor_percentile=20.0, q2_term=True, fit_q_range=(1.0, 4.0))
    filled, _flat = write_flatten_stages(tmp_path, run)
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    body = client.get(f"/api/volumes/{SLUG}.flattened/shell-floors").json()
    assert body["percentile"] == 20.0
    assert body["flatten"]["floor_percentile"] == 20.0
    assert body["flatten"]["fit_q_range"] == [1.0, 4.0] and body["flatten"]["q2_term"] is True
    levels = flatten_radial_background(filled, floor_percentile=20.0).raw_levels
    assert body["floors_before"] == [None if not np.isfinite(x) else float(x) for x in levels]
    asked = client.get(f"/api/volumes/{SLUG}.flattened/shell-floors",
                       params={"percentile": 25}).json()
    assert asked["percentile"] == 25.0 and asked["flatten"] == body["flatten"]
    alone = client.get(f"/api/volumes/{SLUG}.backfilled/shell-floors").json()
    assert alone["percentile"] == 25.0 and alone["flatten"] is None


def write_texture_stages(root, record=True, **lattice):
    """A dataset under *root* whose punched and backfilled stages exist:
    holes punched on a lattice of nodes and filled as
    ``tests.test_fill_texture._lattice(**lattice)`` builds them, the punch's
    record written into the punched stage unless *record* is False (a file
    from before the punch recorded its holes).  Returns the lattice."""
    import dataclasses

    from nebula3d.pipeline import _write_punched
    from tests.test_fill_texture import _lattice

    lat = _lattice(**lattice)
    for name in ("raw", "processed"):
        (root / name).mkdir(exist_ok=True)
    paths = pipeline_paths(root / "raw" / f"{STEM}.nxs", proc_dir=root / "processed")
    nebula3d.save(dataclasses.replace(lat.punched, mask=np.ones(lat.record.shape, bool)),
                  paths.ringremoved)
    nebula3d.save(lat.punched, paths.braggpunched)
    if record:
        _write_punched(paths.braggpunched, lat.record)
    nebula3d.save(lat.filled, paths.backfilled)
    return lat


def test_volume_texture(tmp_path, monkeypatch):
    """/texture: the backfilled stage's fills against the punched stage's
    holes, read from the punch's record, judged by texture.ts's rule with
    their 3-D rims: fill_texture's numbers, the holes farthest outside their
    range listed first, the rule's limits as asked."""
    from nebula3d.analysis import fill_texture

    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)  # whatever ran before
    lat = write_texture_stages(tmp_path, n=61, bias=0.5, share=0.8)
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    url = f"/api/volumes/{SLUG}.backfilled/texture"
    r = client.get(url)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == f"{SLUG}.backfilled" and body["punched_id"] == f"{SLUG}.braggpunched"
    assert body["holes_from"] == "punch_record" and (body["rim"], body["min_rim"]) == (4, 8)
    assert ((body["min_sigma"], body["one_way"], body["min_holes"], body["floor"])
            == (0.5, 0.75, 5, 0.2))
    want = fill_texture(lat.punched, lat.filled, punch_record=lat.record)
    for name in ("n_holes", "n_judged", "judged", "median_fill_bias_sigma",
                 "median_fill_bias_level", "above_fraction", "below_fraction",
                 "above_floor_fraction", "below_floor_fraction", "systematic_fill_bias"):
        assert body[name] == getattr(want, name), name
    assert body["n_holes"] == 27 and body["systematic_fill_bias"]
    # The 20 holes farthest outside their range, in units of their level.
    rows = body["holes"]
    assert len(rows) == 20
    sizes = [abs(row["bias_level"]) for row in rows]
    assert sizes == sorted(sizes, reverse=True) and sizes[-1] > 0.45
    h = want.holes
    for row in rows:
        i = row["index"]
        assert row["centre_hkl"] == [round(float(v), 6) for v in h.centre_hkl[i]]
        assert (row["voxels"], row["rim_voxels"]) == (int(h.voxels[i]), int(h.rim_voxels[i]))
        for name in ("fill", "level", "sigma", "slope", "edge", "peaked", "bias",
                     "bias_sigma", "bias_level"):
            assert row[name] == float(getattr(h, name)[i]), name
        assert row["not_judged"] is None
    # Every hole, none, and the rule's limits as asked.
    assert len(client.get(url, params={"limit": 1000}).json()["holes"]) == 27
    assert client.get(url, params={"limit": 0}).json()["holes"] == []
    high = client.get(url, params={"floor": 0.6, "one_way": 0.5, "min_holes": 3}).json()
    assert (high["floor"], high["one_way"], high["min_holes"]) == (0.6, 0.5, 3)
    assert not high["systematic_fill_bias"]                   # the median is half the level
    assert high["median_fill_bias_level"] == body["median_fill_bias_level"]
    for bad in ({"limit": -1}, {"limit": 100_001}, {"one_way": 1.5}, {"min_holes": 0},
                {"floor": -0.1}, {"min_sigma": -1}, {"floor": "inf"}):
        assert client.get(url, params=bad).status_code == 422, bad
    assert client.get(f"/api/volumes/{SLUG}.braggpunched/texture").status_code == 400
    assert client.get("/api/volumes/nope.backfilled/texture").status_code == 404


def test_volume_texture_without_a_punch_record(tmp_path, monkeypatch):
    """A punched stage written before the punch recorded its holes: they are
    texture.ts's own (unmeasured when punched, measured when filled), the
    same holes here; without the punched stage there is nothing to read."""
    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)  # whatever ran before
    write_texture_stages(tmp_path, record=False, n=61, bias=0.5, share=0.8)
    vol_mod.clear_cache()
    client = TestClient(create_app(ServerConfig(data_root=tmp_path)))
    url = f"/api/volumes/{SLUG}.backfilled/texture"
    body = client.get(url).json()
    assert body["holes_from"] == "masks" and body["n_holes"] == 27
    assert body["systematic_fill_bias"]
    assert body["above_floor_fraction"] == pytest.approx(0.8, abs=0.02)
    paths = pipeline_paths(tmp_path / "raw" / f"{STEM}.nxs", proc_dir=tmp_path / "processed")
    paths.braggpunched.unlink()
    assert client.get(url).status_code == 404
