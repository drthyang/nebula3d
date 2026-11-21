# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""A run's working files are stored without gzip; files that are kept are not.

The stage outputs and the ΔPDF of a pipeline run are written with no
compression filter on ``signal`` and ``errors_squared`` (gzip was a third of a
run's time); ``nebula3d.save`` and ``save_delta_pdf`` keep gzip by default, and
the browser build keeps it for its in-memory files.  Either way the layout and
the values are the same, files of both kinds read back to the same bits, and
the resume rule does not look at how a file is stored.
"""

from __future__ import annotations

import h5py
import numpy as np
import pytest

import nebula3d
from nebula3d import pipeline
from nebula3d.core import HKLVolume
from nebula3d.demo import demo_volume
from nebula3d.io import load_delta_pdf, mantid_nxs, save_delta_pdf
from nebula3d.io.mantid_nxs import save_mantid_nxs, working_compression

DATA = "MDHistoWorkspace/data"
SHAPE = (5, 6, 7)
#: Every stage that writes a file, the symmetry average and the flatten included.
PARAMS = pipeline.PipelineParams(
    symmetry_average_enabled=True,
    symmetry_average=pipeline.SymmetryAverageParams(laue="mmm"), flatten_enabled=True)


def _vol(dtype=np.float64) -> HKLVolume:
    rng = np.random.default_rng(3)
    data = rng.normal(1.0, 0.5, SHAPE).astype(dtype)
    sigma = np.abs(rng.normal(0.1, 0.05, SHAPE)).astype(dtype)
    mask = rng.random(SHAPE) > 0.2
    data[~mask] = -99.0
    data[0, 0, 0] = np.nan  # a NaN stays a NaN
    mask[0, 0, 0] = False
    data[1, 1, 1] = -0.0    # and a signed zero keeps its sign
    return HKLVolume(
        data=data, sigma=sigma, mask=mask,
        h_axis=np.linspace(-1.0, 1.0, SHAPE[0]),
        k_axis=np.linspace(-0.5, 0.5, SHAPE[1]),
        l_axis=np.linspace(-1.5, 1.5, SHAPE[2]),
        ub_matrix=np.eye(3) * 1.57, instrument="test")


def _same_bits(a: np.ndarray, b: np.ndarray) -> bool:
    return a.dtype == b.dtype and a.shape == b.shape and a.tobytes() == b.tobytes()


def _filters(path, name: str) -> tuple[str | None, bool, tuple[int, ...] | None]:
    with h5py.File(path, "r") as f:
        ds = f[f"{DATA}/{name}"]
        return ds.compression, bool(ds.shuffle), ds.chunks


def _datasets(path) -> dict[str, np.ndarray]:
    """Every dataset of the file but the write-time stamp."""
    out: dict[str, np.ndarray] = {}
    with h5py.File(path, "r") as f:
        f.visititems(lambda name, obj: out.__setitem__(name, np.asarray(obj[()]))
                     if isinstance(obj, h5py.Dataset) and not name.endswith("/date")
                     else None)
    return out


# ---------------------------------------------------------------------------
# the writer
# ---------------------------------------------------------------------------
def test_the_working_files_are_uncompressed_off_the_browser(monkeypatch):
    assert working_compression() is None
    monkeypatch.setattr(mantid_nxs.sys, "platform", "emscripten")
    assert working_compression() == "gzip"  # in-memory files: the smaller ones


@pytest.mark.parametrize("dtype", [np.float64, np.float32])
def test_an_uncompressed_volume_has_no_filter_and_the_same_layout(tmp_path, dtype):
    vol = _vol(dtype)
    plain, packed = tmp_path / "plain.h5", tmp_path / "packed.h5"
    nebula3d.save(vol, plain, compression=None)
    nebula3d.save(vol, packed)  # the default is gzip, as before

    for name in ("signal", "errors_squared"):
        assert _filters(plain, name) == (None, False, (1, *SHAPE[1:])), name
        assert _filters(packed, name) == ("gzip", True, (1, *SHAPE[1:])), name
    # Zeros and ones: gzip is free on them, so they stay compressed.
    for name in ("num_events", "mask"):
        assert _filters(plain, name) == ("gzip", True, (1, *SHAPE[1:])), name

    # Every dataset of the two files holds the same bytes in the same type.
    a, b = _datasets(plain), _datasets(packed)
    assert a.keys() == b.keys()
    for name in a:
        assert _same_bits(a[name], b[name]), name
    with h5py.File(plain, "r") as f, h5py.File(packed, "r") as g:
        for name in ("signal", "errors_squared", "num_events", "mask"):
            assert f[f"{DATA}/{name}"].dtype == g[f"{DATA}/{name}"].dtype
            assert f[f"{DATA}/{name}"].fillvalue == g[f"{DATA}/{name}"].fillvalue
            assert dict(f[f"{DATA}/{name}"].attrs) == dict(g[f"{DATA}/{name}"].attrs)


@pytest.mark.parametrize("dtype", [np.float64, np.float32])
@pytest.mark.parametrize("compression", [None, "gzip"])
def test_a_volume_round_trips_bit_for_bit(tmp_path, dtype, compression):
    vol = _vol(dtype)
    path = tmp_path / "v.h5"
    save_mantid_nxs(vol, path, compression=compression)
    back = nebula3d.load(path, dtype=None)
    assert _same_bits(back.data, vol.data)      # NaN and -0.0 included
    assert _same_bits(back.sigma, vol.sigma)
    assert _same_bits(back.mask, vol.mask)
    with h5py.File(path, "r") as f:
        assert _same_bits(f[f"{DATA}/signal"][()], vol.data.astype("<f8"))
        assert _same_bits(f[f"{DATA}/errors_squared"][()],
                          vol.sigma.astype("<f8") ** 2)


def test_an_uncompressed_volume_without_sigma_or_mask_writes_no_bytes_for_them(tmp_path):
    """errors_squared, num_events and mask are fill values until written."""
    path = tmp_path / "d.h5"
    data = np.arange(np.prod(SHAPE), dtype=np.float64).reshape(SHAPE)
    axes = [np.arange(n, dtype=float) for n in SHAPE]
    save_delta_pdf(path, data, *axes, compression=None)
    with h5py.File(path, "r") as f:
        grp = f[DATA]
        assert grp["signal"].compression is None
        assert grp["signal"].id.get_storage_size() == data.nbytes
        assert grp["errors_squared"].id.get_storage_size() == 0
        assert not grp["errors_squared"][()].any()
        assert (grp["num_events"][()] == 1.0).all()
    assert _same_bits(load_delta_pdf(path).data, data)


def test_an_unknown_compression_is_refused(tmp_path):
    with pytest.raises(ValueError, match="compression"):
        nebula3d.save(_vol(), tmp_path / "v.h5", compression="lzf")
    with pytest.raises(TypeError, match="Unexpected keyword"):
        nebula3d.save(_vol(), tmp_path / "v.h5", compresion=None)
    with pytest.raises(TypeError, match="Unexpected keyword"):
        nebula3d.save(_vol(), tmp_path / "v.txt", compression=None)


# ---------------------------------------------------------------------------
# a run
# ---------------------------------------------------------------------------
_RAW: list[bytes] = []


def _run(tmp_path, monkeypatch, *, browser: bool = False, **kwargs):
    if browser:  # what the browser build writes; also the files of older versions
        monkeypatch.setattr(pipeline, "working_compression", lambda: "gzip")
    inp = tmp_path / "raw" / "synthetic_demo.nxs"
    if not inp.exists():
        inp.parent.mkdir(parents=True)
        if not _RAW:  # one raw file for every run: a file is stamped when written
            nebula3d.save(demo_volume(25), inp)
            _RAW.append(inp.read_bytes())
        inp.write_bytes(_RAW[0])
    events: list[tuple] = []
    paths = pipeline.run_pipeline(inp, PARAMS,
                                  proc_dir=tmp_path / "processed",
                                  progress=lambda *a: events.append(a), **kwargs)
    return inp, paths, events


def _outputs(paths) -> list:
    return [paths.symmetrized, paths.ringremoved, paths.braggpunched,
            paths.backfilled, paths.flattened, paths.delta_pdf]


def test_a_run_writes_its_stage_files_and_dpdf_uncompressed(tmp_path, monkeypatch):
    _, paths, _ = _run(tmp_path, monkeypatch)
    for out in _outputs(paths):
        assert _filters(out, "signal")[0] is None, out.name
        assert _filters(out, "errors_squared")[0] is None, out.name
        assert _filters(out, "signal")[2] is not None, out.name  # chunked, as before
    with h5py.File(paths.braggpunched, "r") as f:  # the punch record: zeros and ones
        assert f[pipeline._PUNCHED_DATASET].compression == "gzip"


def test_a_run_gives_the_same_files_compressed_or_not(tmp_path, monkeypatch):
    """Dataset for dataset and attribute for attribute: only the filter differs."""
    _, plain, _ = _run(tmp_path / "plain", monkeypatch)
    _, packed, _ = _run(tmp_path / "packed", monkeypatch, browser=True)
    for a_path, b_path in zip(_outputs(plain), _outputs(packed)):
        assert _filters(b_path, "signal")[0] == "gzip"
        a, b = _datasets(a_path), _datasets(b_path)
        assert a.keys() == b.keys(), a_path.name
        for name in a:
            assert _same_bits(a[name], b[name]), f"{a_path.name}:{name}"
        with h5py.File(a_path, "r") as f, h5py.File(b_path, "r") as g:
            fa = dict(f[f"MDHistoWorkspace/{mantid_nxs.NEBULA3D_GROUP}"].attrs)
            ga = dict(g[f"MDHistoWorkspace/{mantid_nxs.NEBULA3D_GROUP}"].attrs)
        assert fa == ga, a_path.name
        assert pipeline.read_stage_record(a_path) == pipeline.read_stage_record(b_path)


def test_outputs_written_with_gzip_are_reused_and_read(tmp_path, monkeypatch):
    """A folder of outputs an earlier version wrote (gzip): a run with the same
    settings makes nothing again; one stage made again reads its gzip input
    and is the same as in a run that never compressed."""
    inp, paths, _ = _run(tmp_path, monkeypatch, browser=True)
    assert _filters(paths.backfilled, "signal")[0] == "gzip"
    monkeypatch.undo()
    assert working_compression() is None

    assert pipeline.resume_plan(inp, PARAMS,
                                proc_dir=tmp_path / "processed") == {}
    _, _, events = _run(tmp_path, monkeypatch)
    assert not [ev for ev in events if ev[1] == "start"]
    assert _filters(paths.flattened, "signal")[0] == "gzip"  # not touched

    old = nebula3d.load(paths.backfilled, dtype=None)  # an old gzip file reads
    _run(tmp_path, monkeypatch, force_from="flatten")
    assert _filters(paths.backfilled, "signal")[0] == "gzip"
    assert _filters(paths.flattened, "signal")[0] is None
    assert _same_bits(nebula3d.load(paths.backfilled, dtype=None).data, old.data)

    _, fresh, _ = _run(tmp_path / "fresh", monkeypatch)
    for mixed, plain in ((paths.flattened, fresh.flattened),
                         (paths.delta_pdf, fresh.delta_pdf)):
        a, b = _datasets(mixed), _datasets(plain)
        for name in a:
            assert _same_bits(a[name], b[name]), f"{mixed.name}:{name}"
    # Uncompressed outputs are fresh to the rule too.
    assert pipeline.resume_plan(inp, PARAMS,
                                proc_dir=tmp_path / "processed") == {}


def test_a_stage_record_does_not_depend_on_how_its_input_is_stored(tmp_path, monkeypatch):
    """The record a stage writes names its input by that input's own record,
    not by the file's bytes, size or date."""
    _, plain, _ = _run(tmp_path / "plain", monkeypatch)
    _, packed, _ = _run(tmp_path / "packed", monkeypatch, browser=True)
    assert plain.backfilled.stat().st_size != packed.backfilled.stat().st_size
    assert (pipeline._output_identity(plain.backfilled)
            == pipeline._output_identity(packed.backfilled))
    assert set(pipeline._output_identity(plain.backfilled)) == {"record"}
