"""NEBULA3D's HDF5 outputs in the Mantid MDHistoWorkspace layout (SaveMD version 2).

Pins the file layout Mantid's LoadMD expects — every group, dataset and
attribute of a SaveMD file, with its HDF5 type class, since the loader is strict
about types — and the round trips: NEBULA3D's own files load back losslessly
(float32 and float64, values under the mask included), a raw Mantid file still
has its masked voxels zeroed, and the legacy layouts (``/entry`` volumes, root
ΔPDF files) still read.

Set ``NEBULA3D_SAVEMD_TEMPLATE`` to a ``.nxs`` that Mantid's SaveMD wrote
(e.g. a CORELLI volume from ``data/raw/``) to also compare the layout against
it entry by entry; only its metadata is read.
"""

import os
from pathlib import Path

import h5py
import numpy as np
import pytest

import nebula3d
from nebula3d import pipeline
from nebula3d.core import HKLVolume
from nebula3d.io import load_delta_pdf, save_delta_pdf
from nebula3d.io.hkl_reader import load_ub_matrix
from nebula3d.utils import ub_from_lattice
from nebula3d.visualization.slices import read_cell_attrs

ROOT = "MDHistoWorkspace"
UB = ub_from_lattice(5.9, 10.4, 24.8, 89.5, 90.6, 90.6)
SHAPE = (5, 6, 7)


def _vol(dtype=np.float64, ub=UB, seed=0):
    rng = np.random.default_rng(seed)
    data = rng.normal(1.0, 0.5, SHAPE).astype(dtype)
    sigma = np.abs(rng.normal(0.1, 0.05, SHAPE)).astype(dtype)
    mask = rng.random(SHAPE) > 0.2
    data[~mask] = -99.0          # punched voxels keep a value under the mask
    data[0, 0, 0] = np.nan       # and a NaN stays a NaN
    mask[0, 0, 0] = False
    return HKLVolume(
        data=data, sigma=sigma, mask=mask,
        h_axis=np.linspace(-1.1, 1.3, SHAPE[0]),
        k_axis=np.linspace(-0.2, 0.2, SHAPE[1]),
        l_axis=np.linspace(-1.0, 1.2, SHAPE[2]) / 3.0,
        ub_matrix=ub, instrument="CORELLI (Å test)")


# ---------------------------------------------------------------------------
# HDF5 type checks
# ---------------------------------------------------------------------------
def _attr_type(obj, name):
    aid = h5py.h5a.open(obj.id, name.encode())
    return aid.get_type(), aid.get_space().get_simple_extent_type()


def _vlen_ascii_attr(obj, name):
    tid, space = _attr_type(obj, name)
    assert tid.get_class() == h5py.h5t.STRING, name
    assert tid.is_variable_str(), name
    assert tid.get_cset() == h5py.h5t.CSET_ASCII, name
    assert space == h5py.h5s.SCALAR, name
    return obj.attrs[name]


def _int32_attr(obj, name):
    tid, space = _attr_type(obj, name)
    assert tid.get_class() == h5py.h5t.INTEGER and tid.get_size() == 4, name
    assert tid.get_sign() == h5py.h5t.SGN_2, name
    assert space == h5py.h5s.SCALAR, name
    return int(obj.attrs[name])


def _nx(grp, nx_class, version=None):
    assert _vlen_ascii_attr(grp, "NX_class") == nx_class, grp.name
    if version is not None:
        assert _int32_attr(grp, "version") == version, grp.name


def _fixed_string(ds):
    """A NeXus string dataset: (1,), fixed-length null-terminated ASCII."""
    tid = ds.id.get_type()
    assert tid.get_class() == h5py.h5t.STRING, ds.name
    assert not tid.is_variable_str(), ds.name
    assert tid.get_cset() == h5py.h5t.CSET_ASCII, ds.name
    assert tid.get_strpad() == h5py.h5t.STR_NULLTERM, ds.name
    assert ds.shape == (1,), ds.name
    text = ds[0].decode()
    assert tid.get_size() == len(text.encode()), ds.name
    return text


def _array(ds, dtype, shape):
    assert ds.dtype == np.dtype(dtype), ds.name
    assert ds.shape == shape, ds.name
    return ds[()]


def test_writer_matches_the_savemd_layout(tmp_path):
    path = tmp_path / "v.nxs"
    vol = _vol(np.float32)
    nebula3d.save(vol, path)
    nh, nk, nl = SHAPE

    with h5py.File(path, "r") as f:
        for key, value in (("NX_class", "NXroot"), ("NeXus_version", "4.4.3"),
                           ("file_name", "v.nxs")):
            assert _vlen_ascii_attr(f, key) == value
        _vlen_ascii_attr(f, "HDF5_Version")
        _vlen_ascii_attr(f, "file_time")

        entry = f[ROOT]
        _nx(entry, "NXentry")
        assert _vlen_ascii_attr(entry, "QConvention") == "Crystallography"
        assert _int32_attr(entry, "SaveMDVersion") == 2
        assert list(_array(entry["coordinate_system"], np.uint32, (1,))) == [3]
        assert list(_array(entry["visual_normalization"], np.uint32, (1,))) == [0]

        data = entry["data"]
        _nx(data, "NXdata")
        signal = data["signal"]
        assert _vlen_ascii_attr(signal, "axes") == "D2:D1:D0"
        assert _int32_attr(signal, "signal") == 1
        for name, dtype in (("signal", "<f8"), ("errors_squared", "<f8"),
                            ("num_events", "<f8"), ("mask", "i1")):
            ds = data[name]
            assert ds.dtype == np.dtype(dtype), name     # LoadMD accepts nothing else
            assert ds.shape == (nh, nk, nl), name        # stored order, not transposed
            assert ds.chunks == (1, nk, nl), name
            assert ds.compression == "gzip" and ds.shuffle, name
        np.testing.assert_array_equal(data["mask"][()], (~vol.mask).astype(np.int8))
        np.testing.assert_array_equal(data["num_events"][()], vol.mask.astype(float))
        np.testing.assert_array_equal(data["signal"][()], vol.data.astype(np.float64))
        np.testing.assert_array_equal(data["errors_squared"][()],
                                      vol.sigma.astype(np.float64) ** 2)
        for d, (label, n, axis) in {"D2": ("[H,0,0]", nh, vol.h_axis),
                                    "D1": ("[0,K,0]", nk, vol.k_axis),
                                    "D0": ("[0,0,L]", nl, vol.l_axis)}.items():
            edges = _array(data[d], np.float64, (n + 1,))   # bin edges
            np.testing.assert_allclose(0.5 * (edges[1:] + edges[:-1]), axis, atol=1e-12)
            assert _vlen_ascii_attr(data[d], "long_name") == label
            assert _vlen_ascii_attr(data[d], "units") == "r.l.u."
            assert _vlen_ascii_attr(data[d], "frame") == "HKL"

        exp = entry["experiment0"]
        _nx(exp, "NXgroup", 1)
        inst = exp["instrument"]
        _nx(inst, "NXinstrument", 1)
        assert _fixed_string(inst["name"]) == " "   # blank: no instrument lookup
        _nx(inst["instrument_xml"], "NXnote")
        assert _fixed_string(inst["instrument_xml/data"]) == " "
        assert _fixed_string(inst["instrument_xml/type"]) == "text/xml"
        _fixed_string(inst["instrument_xml/description"])
        pmap = inst["instrument_parameter_map"]
        _nx(pmap, "NXnote", 1)
        for key in ("author", "data", "date", "description"):
            _fixed_string(pmap[key])
        assert _fixed_string(pmap["type"]) == "text/plain"

        logs = exp["logs"]
        _nx(logs, "NXgroup", 1)
        _nx(logs["W_MATRIX"], "NXlog")
        w = _array(logs["W_MATRIX/value"], np.float64, (9,)).reshape(3, 3)
        # column j = (h, k, l) direction of Dj: D0 = L, D1 = K, D2 = H
        np.testing.assert_array_equal(w, [[0, 0, 1], [0, 1, 0], [1, 0, 0]])
        assert _vlen_ascii_attr(logs["W_MATRIX/value"], "units") == " "
        _nx(logs["goniometer"], "NXpositioner", 1)
        assert list(_array(logs["goniometer/num_axes"], np.int32, (1,))) == [0]
        np.testing.assert_array_equal(
            _array(logs["goniometer/rotation_matrix"], np.float64, (9,)), np.eye(3).ravel())
        _nx(logs["mdhisto_was_modified"], "NXlog")
        assert _fixed_string(logs["mdhisto_was_modified/value"]) == "1"
        _vlen_ascii_attr(logs["mdhisto_was_modified/value"], "units")

        sample = exp["sample"]
        _nx(sample, "NXsample", 1)
        assert _vlen_ascii_attr(sample, "name") == " "
        assert _int32_attr(sample, "name_empty") == 1
        assert "userShape" in _vlen_ascii_attr(sample, "shape_xml")
        for key in ("geom_height", "geom_thickness", "geom_width"):
            _array(sample[key], np.float64, (1,))
        _array(sample["geom_id"], np.int32, (1,))
        material = sample["material"]
        _nx(material, "NXdata", 2)
        assert _vlen_ascii_attr(material, "formulaStyle") == "empty"
        _vlen_ascii_attr(material, "name")
        for key, value in (("number_density", 0.0), ("packing_fraction", 1.0),
                           ("pressure", 0.0), ("temperature", 0.0)):
            assert list(_array(material[key], np.float64, (1,))) == [value]
        assert list(_array(sample["num_oriented_lattice"], np.int32, (1,))) == [1]
        assert list(_array(sample["num_other_samples"], np.int32, (1,))) == [0]

        lattice = sample["oriented_lattice"]
        _nx(lattice, "NXcrystal")
        for key in ("cross_term", "maximum_order"):
            _array(lattice[key], np.int32, (1,))
        for key in ("modulated_hkl_error", "modulated_orientation_matrix"):
            _array(lattice[key], np.float64, (3, 3))
        # crystallographic: Q/2π = UB·hkl
        np.testing.assert_allclose(
            _array(lattice["orientation_matrix"], np.float64, (3, 3)) * 2 * np.pi, UB)
        for key, value in zip(("a", "b", "c", "alpha", "beta", "gamma"),
                              (5.9, 10.4, 24.8, 89.5, 90.6, 90.6)):
            assert _array(lattice[f"unit_cell_{key}"], np.float64, (1,))[0] == (
                pytest.approx(value))
            _array(lattice[f"unit_cell_{key}_error"], np.float64, (1,))

        # NEBULA3D's own group: what Mantid does not know
        extra = entry["nebula3d"]
        _nx(extra, "NXcollection")
        assert _int32_attr(extra, "format_version") == 1
        assert _vlen_ascii_attr(extra, "content") == "hkl_volume"
        assert _vlen_ascii_attr(extra, "dtype") == "float32"
        assert _vlen_ascii_attr(extra, "version") == nebula3d.__version__
        assert _vlen_ascii_attr(extra, "instrument") == vol.instrument
        np.testing.assert_array_equal(extra["ub_matrix"][()], UB)
        np.testing.assert_array_equal(extra["D2_centers"][()], vol.h_axis)


def _layout(path):
    """{name: type descriptor} for every group, dataset and attribute."""
    out = {}

    def describe(tid):
        cls = tid.get_class()
        if cls == h5py.h5t.STRING:
            return ("string", tid.is_variable_str(), tid.get_cset(), tid.get_strpad())
        if cls == h5py.h5t.INTEGER:
            return ("int", tid.get_size(), tid.get_sign())
        return (int(cls), tid.get_size())

    def visit(name, obj):
        if isinstance(obj, h5py.Dataset):
            out[name] = ("dataset", describe(obj.id.get_type()), len(obj.shape))
        else:
            out[name] = ("group",)
        for key in obj.attrs:
            aid = h5py.h5a.open(obj.id, key.encode())
            out[f"{name}@{key}"] = ("attr", describe(aid.get_type()),
                                    aid.get_space().get_simple_extent_type())

    with h5py.File(path, "r") as f:
        visit("", f)
        f.visititems(visit)
    return out


def test_layout_matches_a_file_mantid_wrote(tmp_path):
    """Every group, dataset and attribute of a SaveMD file, with the same HDF5
    type; nothing else but the nebula3d group."""
    env = os.environ.get("NEBULA3D_SAVEMD_TEMPLATE")
    template = Path(env) if env else None
    if template is None or not template.exists():
        pytest.skip("no SaveMD template (set NEBULA3D_SAVEMD_TEMPLATE)")
    path = tmp_path / "v.nxs"
    nebula3d.save(_vol(), path)
    ours, theirs = _layout(path), _layout(template)
    missing = sorted(k for k in theirs if k not in ours)
    differ = sorted(k for k in theirs if k in ours and ours[k] != theirs[k])
    assert not missing, missing
    assert not differ, [(k, theirs[k], ours[k]) for k in differ]
    extra = sorted(k for k in ours if k not in theirs and "/nebula3d" not in k)
    assert not extra, extra


# ---------------------------------------------------------------------------
# HKL volumes
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("dtype", [np.float32, np.float64])
def test_own_files_load_back_losslessly(tmp_path, dtype):
    path = tmp_path / "v_ringremoved.h5"   # the extension does not matter
    vol = _vol(dtype)
    nebula3d.save(vol, path)

    back = nebula3d.load(path, dtype=None)
    assert back.data.dtype == np.dtype(dtype)        # the recorded precision
    np.testing.assert_array_equal(back.data, vol.data)   # incl. -99 under the mask
    np.testing.assert_array_equal(back.sigma, vol.sigma)
    np.testing.assert_array_equal(back.mask, vol.mask)
    for name in ("h_axis", "k_axis", "l_axis", "ub_matrix"):
        np.testing.assert_array_equal(getattr(back, name), getattr(vol, name))
    assert back.instrument == vol.instrument

    as64 = nebula3d.load(path)                       # explicit dtype still wins
    assert as64.data.dtype == np.float64
    np.testing.assert_array_equal(as64.data, vol.data.astype(np.float64))


def test_unknown_ub_writes_no_lattice(tmp_path):
    path = tmp_path / "v.h5"
    nebula3d.save(_vol(ub=np.eye(3)), path)
    with h5py.File(path, "r") as f:
        assert list(f[f"{ROOT}/experiment0/sample/num_oriented_lattice"][()]) == [0]
        assert "oriented_lattice" not in f[f"{ROOT}/experiment0/sample"]
    np.testing.assert_array_equal(nebula3d.load(path).ub_matrix, np.eye(3))
    np.testing.assert_array_equal(load_ub_matrix(path), np.eye(3))


def test_left_handed_ub_survives_without_a_lattice(tmp_path):
    # Mantid's OrientedLattice refuses det(UB) <= 0: no lattice, but the exact copy
    ub = UB @ np.diag([1.0, 1.0, -1.0])
    path = tmp_path / "v.h5"
    nebula3d.save(_vol(ub=ub), path)
    with h5py.File(path, "r") as f:
        assert "oriented_lattice" not in f[f"{ROOT}/experiment0/sample"]
    np.testing.assert_array_equal(nebula3d.load(path).ub_matrix, ub)


def test_raw_mantid_file_masked_voxels_are_zeroed(tmp_path):
    # Without the nebula3d group the file is a raw Mantid one, as before.
    path = tmp_path / "raw_scan.nxs"
    vol = _vol()
    nebula3d.save(vol, path)
    with h5py.File(path, "a") as f:
        del f[f"{ROOT}/nebula3d"]

    back = nebula3d.load(path, dtype=None)
    assert back.data.dtype == np.float64
    valid = vol.mask & np.isfinite(vol.data)
    np.testing.assert_array_equal(back.mask, valid)
    assert np.all(back.data[~valid] == 0.0) and np.all(back.sigma[~valid] == 0.0)
    np.testing.assert_array_equal(back.data[valid], vol.data[valid])
    np.testing.assert_allclose(back.sigma[valid], vol.sigma[valid])
    np.testing.assert_allclose(back.ub_matrix, UB)      # from the oriented lattice
    np.testing.assert_allclose(back.h_axis, vol.h_axis)  # from the bin edges
    assert back.instrument == "raw_scan"

    back32 = nebula3d.load(path, dtype=np.float32)
    assert back32.data.dtype == np.float32
    np.testing.assert_array_equal(back32.mask, valid)


def _write_legacy_volume(path, vol, punched=None):
    """The pre-Mantid nebula3d layout (and the NeXus Viewer's hand-off)."""
    with h5py.File(path, "w") as f:
        grp = f.create_group("entry")
        grp.create_dataset("data", data=vol.data)
        grp.create_dataset("sigma", data=vol.sigma)
        grp.create_dataset("mask", data=vol.mask)
        for name in ("h_axis", "k_axis", "l_axis", "ub_matrix"):
            grp.create_dataset(name, data=getattr(vol, name))
        grp.attrs["instrument"] = vol.instrument
        if punched is not None:
            grp.create_dataset("punched", data=punched)


def test_legacy_entry_volume_still_loads(tmp_path):
    path = tmp_path / "old_backfilled.h5"
    vol = _vol(np.float32)
    _write_legacy_volume(path, vol)

    back = nebula3d.load(path, dtype=None)
    assert back.data.dtype == np.float32
    np.testing.assert_array_equal(back.data, vol.data)
    np.testing.assert_array_equal(back.mask, vol.mask)
    np.testing.assert_array_equal(back.ub_matrix, UB)
    assert back.instrument == vol.instrument
    np.testing.assert_array_equal(load_ub_matrix(path), UB)


def test_delta_pdf_file_is_not_an_hkl_volume(tmp_path):
    path = tmp_path / "x_delta_pdf.h5"
    ax = np.linspace(-5, 5, 4)
    save_delta_pdf(path, np.zeros((4, 4, 4)), ax, ax, ax)
    with pytest.raises(ValueError, match="load_delta_pdf"):
        nebula3d.load(path)


def test_punch_record_new_location_and_legacy(tmp_path):
    vol = _vol()
    punched = np.zeros(SHAPE, dtype=bool)
    punched[1:3, 2:4, 3:5] = True

    path = tmp_path / "s_braggpunched.h5"
    nebula3d.save(vol, path)
    pipeline._write_punched(path, punched)
    with h5py.File(path, "r") as f:
        ds = f[f"{ROOT}/nebula3d/punched"]
        assert ds.dtype == np.int8 and ds.chunks == (1, *SHAPE[1:])
    np.testing.assert_array_equal(pipeline._read_punched(path), punched)
    np.testing.assert_array_equal(nebula3d.load(path).data, vol.data)  # still a volume

    legacy = tmp_path / "old_braggpunched.h5"
    _write_legacy_volume(legacy, vol, punched=punched)
    np.testing.assert_array_equal(pipeline._read_punched(legacy), punched)

    bare = tmp_path / "bare.h5"
    nebula3d.save(vol, bare)
    assert pipeline._read_punched(bare) is None


# ---------------------------------------------------------------------------
# 3D-ΔPDF files
# ---------------------------------------------------------------------------
def _dpdf_axes(n=(6, 8, 10)):
    return (np.linspace(-10, 10, n[0]), np.linspace(-12, 12, n[1]),
            np.linspace(-15, 15, n[2]))


def test_delta_pdf_writes_the_savemd_layout_and_reads_back(tmp_path):
    x, y, z = _dpdf_axes()
    data = np.random.default_rng(3).normal(size=(x.size, y.size, z.size)).astype(np.float32)
    ub = ub_from_lattice(8.0, 8.0, 10.0, 90.0, 90.0, 120.0)
    logs = {"q_max": 11.9, "apodization": "gaussian", "source_file": "s_flattened.h5",
            "crop_hkl": "", "zero_pad": 1, "transform_config": "apodize=gaussian;zero_pad=1"}
    path = tmp_path / "s_delta_pdf.h5"
    save_delta_pdf(path, data, x, y, z, ub_matrix=ub, logs=logs)

    with h5py.File(path, "r") as f:
        entry = f[ROOT]
        assert list(entry["coordinate_system"][()]) == [0]
        d = entry["data"]
        assert d["signal"].dtype == np.float64 and d["signal"].shape == data.shape
        assert not d["errors_squared"][()].any() and not d["mask"][()].any()
        assert np.all(d["num_events"][()] == 1.0)
        for name, label, n in (("D2", "x", x.size), ("D1", "y", y.size), ("D0", "z", z.size)):
            assert d[name].shape == (n + 1,)
            assert _vlen_ascii_attr(d[name], "long_name") == label
            assert _vlen_ascii_attr(d[name], "units") == "Angstrom"
            assert _vlen_ascii_attr(d[name], "frame") == "General Frame"
        run = entry["experiment0/logs"]
        q_max = run["q_max/value"]
        assert q_max.dtype == np.float64 and q_max.shape == (1,)
        assert _vlen_ascii_attr(q_max, "units") == "Angstrom^-1"
        assert _fixed_string(run["source_file/value"]) == "s_flattened.h5"
        assert _fixed_string(run["crop_hkl/value"]) == " "   # Mantid's blank
        assert float(entry["experiment0/sample/oriented_lattice/unit_cell_gamma"][0]) == (
            pytest.approx(120.0))

    pdf = load_delta_pdf(path)
    assert pdf.data.dtype == np.float32
    np.testing.assert_array_equal(pdf.data, data)
    for got, want in zip((pdf.x_axis, pdf.y_axis, pdf.z_axis), (x, y, z)):
        np.testing.assert_array_equal(got, want)
    np.testing.assert_array_equal(pdf.ub_matrix, ub)
    assert pdf.cell == pytest.approx((8.0, 8.0, 10.0, 90.0, 90.0, 120.0))
    assert pdf.logs == {"q_max": 11.9, "apodization": "gaussian",
                        "source_file": "s_flattened.h5", "crop_hkl": "",
                        "zero_pad": 1.0,
                        "transform_config": "apodize=gaussian;zero_pad=1"}
    assert read_cell_attrs(path) == pytest.approx(pdf.cell)

    meta = load_delta_pdf(path, read_data=False)
    assert meta.data is None and meta.logs == pdf.logs
    nebula3d.save(_vol(), tmp_path / "v.h5")
    with pytest.raises(ValueError, match="nebula3d.load"):
        load_delta_pdf(tmp_path / "v.h5")


def test_legacy_delta_pdf_still_reads(tmp_path):
    x, y, z = _dpdf_axes()
    data = np.arange(x.size * y.size * z.size, dtype=np.float32).reshape(x.size, y.size, z.size)
    path = tmp_path / "old_delta_pdf.h5"
    with h5py.File(path, "w") as fh:
        fh.create_dataset("data", data=data)
        fh.create_dataset("x_axis", data=x)
        fh.create_dataset("y_axis", data=y)
        fh.create_dataset("z_axis", data=z)
        fh.attrs["q_max"] = 11.9
        fh.attrs["source_file"] = "old_backfilled.h5"
        fh.attrs["transform_config"] = "apodize=hann"
        fh.attrs["lat_a"], fh.attrs["lat_b"], fh.attrs["lat_c"] = 5.8, 10.4, 24.7

    pdf = load_delta_pdf(path)
    assert pdf.data.dtype == np.float32
    np.testing.assert_array_equal(pdf.data, data)
    np.testing.assert_array_equal(pdf.y_axis, y)
    assert pdf.lattice["gamma"] is None                    # no angles stored
    assert pdf.cell == (5.8, 10.4, 24.7, 90.0, 90.0, 90.0)
    assert pdf.ub_matrix is None
    assert pdf.logs == {"q_max": 11.9, "source_file": "old_backfilled.h5",
                        "transform_config": "apodize=hann"}
    assert read_cell_attrs(path) == pdf.cell
    assert pipeline._pdf_is_current(path, "old_backfilled.h5", "apodize=hann")


def test_pdf_is_current_reads_the_new_layout(tmp_path):
    inp = tmp_path / "s.nxs"
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path, flatten_enabled=False)
    vol = HKLVolume.from_arrays(
        1.0 + np.random.default_rng(0).normal(0, 0.01, (9, 9, 9)),
        (-2, 2), (-2, 2), (-2, 2), ub_matrix=2 * np.pi * np.eye(3) / 4.0)
    nebula3d.save(vol, paths.backfilled)
    p = pipeline.PipelineParams(
        flatten_enabled=False,
        delta_pdf=pipeline.DeltaPdfParams(apodization="hann", zero_pad=False))
    pipeline.run_pipeline(inp, p, proc_dir=tmp_path, stages=("pdf",))

    config = pipeline.delta_pdf_transform_config(p.delta_pdf)
    assert nebula3d.is_mantid_nxs(paths.delta_pdf)
    assert pipeline._pdf_is_current(paths.delta_pdf, paths.backfilled.name, config)
    assert not pipeline._pdf_is_current(paths.delta_pdf, "other.h5", config)
    assert not pipeline._pdf_is_current(paths.delta_pdf, paths.backfilled.name,
                                        config + ";changed")
    logs = load_delta_pdf(paths.delta_pdf, read_data=False).logs
    assert logs["apodization"] == "hann" and logs["zero_pad"] == 0.0


@pytest.mark.parametrize("precision", ["float64", "float32"])
def test_pipeline_resumed_from_disk_equals_one_in_memory(tmp_path, precision):
    """Every stage reloaded from its predecessor's file gives bit-identical
    outputs to one run that hands each volume over in memory."""
    from nebula3d.demo import demo_volume

    raw = tmp_path / "demo.nxs"
    nebula3d.save(demo_volume(41, extent=3.0), raw)
    params = pipeline.PipelineParams(precision=precision, pdf_check_enabled=False)
    stages = ("rings", "punch", "backfill", "flatten", "pdf")

    pipeline.run_pipeline(raw, params, proc_dir=tmp_path / "memory", stages=stages)
    for stage in stages:
        pipeline.run_pipeline(raw, params, proc_dir=tmp_path / "disk", stages=(stage,))

    mem = pipeline.pipeline_paths(raw, proc_dir=tmp_path / "memory")
    disk = pipeline.pipeline_paths(raw, proc_dir=tmp_path / "disk")
    for name in ("ringremoved", "braggpunched", "backfilled", "flattened"):
        a = nebula3d.load(getattr(mem, name), dtype=None)
        b = nebula3d.load(getattr(disk, name), dtype=None)
        assert a.data.dtype == np.dtype(precision), name
        for field in ("data", "sigma", "mask"):
            np.testing.assert_array_equal(getattr(a, field), getattr(b, field),
                                          err_msg=f"{name}.{field}")
    np.testing.assert_array_equal(load_delta_pdf(mem.delta_pdf).data,
                                  load_delta_pdf(disk.delta_pdf).data)
