# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Tolerance gates for the float32 compute mode (`PipelineParams.precision`).

The float64 path must stay bit-identical to the historical pipeline (that is
checked by the stage-hash harness, `scripts/hash_stage_outputs.py`); these
tests gate what float32 is ALLOWED to change: results must agree with the
float64 reference to well within measurement noise, |Q|-derived decisions must
be exactly unchanged, and discrete flips (punch masks) must stay within the
documented boundary-voxel class (ROADMAP "punch frames" precedent).
"""

from __future__ import annotations

import dataclasses
import json
import os

import numpy as np
import pytest

import nebula3d
from nebula3d import webbridge
from nebula3d.analysis.delta_pdf import compute_delta_pdf
from nebula3d.core import HKLVolume, q_bin_indices, q_magnitude_from_axes
from nebula3d.pipeline import PipelineParams, pipeline_paths, run_pipeline


@pytest.fixture(autouse=True)
def _isolate_low_memory_env():
    """webbridge.setup() force-sets NEBULA3D_LOW_MEMORY=1 process-wide; keep
    that from leaking into later test modules (their fixtures assume the
    copy-on-write flatten path unless they opt in themselves)."""
    prev = os.environ.get("NEBULA3D_LOW_MEMORY")
    yield
    if prev is None:
        os.environ.pop("NEBULA3D_LOW_MEMORY", None)
    else:
        os.environ["NEBULA3D_LOW_MEMORY"] = prev


# ---------------------------------------------------------------------------
# dtype plumbing
# ---------------------------------------------------------------------------
def _write_demo(tmp_path, n=33):
    """The FCC demo volume, written natively via the webbridge generator."""
    webbridge.setup(workdir=str(tmp_path / "work"))
    webbridge.make_demo_input(n=n)
    raw = sorted((tmp_path / "work" / "raw").glob("*.nxs"))[0]
    return raw


def test_load_dtype_variants(tmp_path):
    raw = _write_demo(tmp_path)
    v64 = nebula3d.load(raw)
    v32 = nebula3d.load(raw, dtype=np.float32)
    vpre = nebula3d.load(raw, dtype=None)  # preserve stored dtype
    assert v64.data.dtype == np.float64 and v64.sigma.dtype == np.float64
    assert v32.data.dtype == np.float32 and v32.sigma.dtype == np.float32
    assert vpre.data.dtype == np.float64  # demo file stores float64
    # Axes/UB are float64 in every mode.
    for v in (v64, v32, vpre):
        assert v.h_axis.dtype == np.float64
        assert v.ub_matrix.dtype == np.float64
    # The float32 load is the rounded float64 load, exactly.
    assert np.array_equal(v32.data, v64.data.astype(np.float32))


def test_q_bin_indices_matches_full_digitize():
    """Bin decisions are float64 by construction — exact match, any storage."""
    rng = np.random.default_rng(7)
    h = np.linspace(-3, 3, 37)
    k = np.linspace(-2, 2, 23)
    l_ = np.linspace(-4, 4, 41)
    ub = 2 * np.pi * (np.eye(3) + 0.05 * rng.normal(size=(3, 3)))
    edges = np.arange(0.5, 12.0, 0.02)
    q = q_magnitude_from_axes(h, k, l_, ub)
    ref = np.digitize(q, edges).astype(np.int32)
    for slab in (1, 5, 16, 64):
        got = q_bin_indices(h, k, l_, ub, edges, slab=slab)
        assert np.array_equal(got, ref), f"slab={slab}"


def test_q_magnitude_out_dtype():
    h = np.linspace(-2, 2, 9)
    ub = 2 * np.pi * np.eye(3)
    q64 = q_magnitude_from_axes(h, h, h, ub)
    q32 = q_magnitude_from_axes(h, h, h, ub, out_dtype=np.float32)
    assert q64.dtype == np.float64 and q32.dtype == np.float32
    # f32 output is the rounded f64 arithmetic, not f32 arithmetic.
    assert np.array_equal(q32, q64.astype(np.float32))


def test_mean_subtract_uses_f64_accumulator():
    """A float32 volume with a large pedestal: the subtracted mean must come
    from a float64 accumulator (a float32 pairwise mean drifts ~1e-4 here)."""
    rng = np.random.default_rng(11)
    n = 48
    axes = np.linspace(-2, 2, n)
    base = (1000.0 + rng.normal(0, 1.0, (n, n, n))).astype(np.float32)
    vol64 = HKLVolume.from_arrays(base.astype(np.float64), (-2, 2), (-2, 2),
                                  (-2, 2), ub_matrix=2 * np.pi * np.eye(3))
    vol32 = dataclasses.replace(vol64, data=base,
                                sigma=np.sqrt(np.abs(base)))
    d64 = compute_delta_pdf(vol64, apodization="gaussian")
    d32 = compute_delta_pdf(vol32, apodization="gaussian")
    assert d32.data.dtype == np.float32
    assert np.isclose(d32.subtracted_mean, d64.subtracted_mean, rtol=1e-7)
    del axes


# ---------------------------------------------------------------------------
# Full-pipeline equivalence (the load-bearing gates)
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def f32_vs_f64_runs(tmp_path_factory):
    # Module-scoped fixtures are set up BEFORE the function-scoped autouse env
    # guard, so this one must restore NEBULA3D_LOW_MEMORY itself (setup()
    # inside _write_demo force-sets it process-wide).
    prev = os.environ.get("NEBULA3D_LOW_MEMORY")
    try:
        tmp = tmp_path_factory.mktemp("f32eq")
        raw = _write_demo(tmp, n=33)
        outs = {}
        for precision in ("float64", "float32"):
            p = PipelineParams(precision=precision)  # type: ignore[arg-type]
            proc = tmp / f"proc_{precision}"
            run_pipeline(raw, p, proc_dir=proc, force=True)
            outs[precision] = pipeline_paths(raw, proc_dir=proc)
        yield outs
    finally:
        if prev is None:
            os.environ.pop("NEBULA3D_LOW_MEMORY", None)
        else:
            os.environ["NEBULA3D_LOW_MEMORY"] = prev


def _nrms(a: np.ndarray, b: np.ndarray) -> float:
    d = a.astype(np.float64) - b.astype(np.float64)
    denom = float(np.sqrt(np.mean(b.astype(np.float64) ** 2))) or 1.0
    return float(np.sqrt(np.mean(d * d))) / denom


def test_stage_dtypes_propagate(f32_vs_f64_runs):
    paths = f32_vs_f64_runs["float32"]
    for art in (paths.ringremoved, paths.braggpunched, paths.backfilled,
                paths.flattened):
        v = nebula3d.load(art, dtype=None)
        assert v.data.dtype == np.float32, art.name
        assert v.sigma.dtype == np.float32, art.name


def test_punch_mask_flips_bounded(f32_vs_f64_runs):
    m64 = nebula3d.load(f32_vs_f64_runs["float64"].braggpunched, dtype=None).mask
    m32 = nebula3d.load(f32_vs_f64_runs["float32"].braggpunched, dtype=None).mask
    flips = int(np.count_nonzero(m64 != m32))
    n = m64.size
    assert flips <= max(int(5e-5 * n), 32), flips


def test_bragg_peak_count_stable(f32_vs_f64_runs):
    p64 = json.loads(
        f32_vs_f64_runs["float64"].bragg_profile_json.read_text())
    p32 = json.loads(
        f32_vs_f64_runs["float32"].bragg_profile_json.read_text())
    assert abs(int(p64["n_peaks"]) - int(p32["n_peaks"])) <= 2


def test_flattened_volume_close(f32_vs_f64_runs):
    v64 = nebula3d.load(f32_vs_f64_runs["float64"].flattened, dtype=None)
    v32 = nebula3d.load(f32_vs_f64_runs["float32"].flattened, dtype=None)
    both = (np.isfinite(v64.data) & np.isfinite(v32.data)
            & v64.mask & v32.mask & (v64.mask == v32.mask))
    assert _nrms(v32.data[both], v64.data[both]) < 1e-4


def test_delta_pdf_close(f32_vs_f64_runs):
    import h5py

    with h5py.File(f32_vs_f64_runs["float64"].delta_pdf, "r") as fh:
        d64 = fh["data"][()]
    with h5py.File(f32_vs_f64_runs["float32"].delta_pdf, "r") as fh:
        d32 = fh["data"][()]
    assert d32.dtype == np.float32
    assert _nrms(d32, d64) < 1e-4
    scale = float(np.max(np.abs(d64))) or 1.0
    assert float(np.max(np.abs(d32.astype(np.float64) - d64))) < 1e-3 * scale


def test_consistency_metrics_close(f32_vs_f64_runs):
    m64 = json.loads(f32_vs_f64_runs["float64"].pdf_check_json.read_text())
    m32 = json.loads(f32_vs_f64_runs["float32"].pdf_check_json.read_text())
    # The float32 round trip must stay in the faithful regime …
    assert m32["pearson_r"] > 0.999
    # … and sit right on top of the float64 reference (the absolute
    # normalized_rms is a property of the volume/window — the FCC demo sits at
    # ~1.6e-2 in BOTH modes — so the gate here is the mode DELTA).
    assert abs(m32["pearson_r"] - m64["pearson_r"]) < 1e-4
    assert abs(m32["normalized_rms"] - m64["normalized_rms"]) < 1e-4


# ---------------------------------------------------------------------------
# float32 ring stage: serial == parallel-executor (bit-identity holds per-dtype)
# ---------------------------------------------------------------------------
def test_ring_parallel_f32_bit_identity(monkeypatch):
    import asyncio

    from nebula3d.pipeline import RingParams, remove_rings, remove_rings_async
    from tests.test_ring_parallel import FakeExecutor, _ring_vol_3d

    monkeypatch.setenv("NEBULA3D_LOW_MEMORY", "1")
    vol = _ring_vol_3d()
    vol32 = dataclasses.replace(
        vol, data=vol.data.astype(np.float32),
        sigma=vol.sigma.astype(np.float32))
    p = RingParams(ring_model="patched", slice_axis="H", q_min=1.0, q_max=8.0,
                   confirm_rings=True)
    serial = remove_rings(vol32, p)
    parallel = asyncio.run(
        remove_rings_async(vol32, p, plane_executor=FakeExecutor()))
    assert serial.data.dtype == np.float32
    assert np.array_equal(serial.data, parallel.data)
    assert np.array_equal(serial.mask, parallel.mask)


# ---------------------------------------------------------------------------
# webbridge policy
# ---------------------------------------------------------------------------
def test_inspect_reports_precision_and_new_ceiling(tmp_path):
    import h5py

    webbridge.setup(workdir=str(tmp_path / "work"))
    path = tmp_path / "big.h5"
    with h5py.File(path, "w") as f:
        f.create_group("entry").create_dataset(
            "data", shape=(401, 401, 401), dtype="f8")  # 64.5 M voxels
    report = json.loads(webbridge.inspect_input("big.h5", str(path)))
    # 64.5 M × 38 B ≈ 2.45 GB — admitted by the float32 gate (was refused
    # by the float64 64 B/voxel gate).
    assert report["ok"] is True, report["message"]
    assert report["precision"] == "float32"
    assert report["ceiling_voxels"] >= 78_000_000


def test_run_precision_override(tmp_path):
    """params_json {"precision": "float64"} pins the debug/validation mode."""
    webbridge.setup(workdir=str(tmp_path / "work"))
    webbridge.make_demo_input(n=24)
    webbridge.run("rings", '{"precision": "float64"}', flatten_enabled=True,
                  force=True)
    ring = sorted(
        (tmp_path / "work" / "processed").glob("*_ringremoved.h5"))[0]
    assert nebula3d.load(ring, dtype=None).data.dtype == np.float64


def test_run_default_is_float32(tmp_path):
    webbridge.setup(workdir=str(tmp_path / "work"))
    webbridge.make_demo_input(n=24)
    webbridge.run("rings", "{}", flatten_enabled=True, force=True)
    ring = sorted(
        (tmp_path / "work" / "processed").glob("*_ringremoved.h5"))[0]
    assert nebula3d.load(ring, dtype=None).data.dtype == np.float32


def test_gpu_padding_choice_is_result_neutral():
    """The WebGPU path pads to strict 5-smooth lengths (scipy pads 11-smooth).
    Padding length is an implementation detail recorded per-result; the
    round trip through either padding must agree to float round-off."""
    from nebula3d.analysis.delta_pdf import (
        _fft_core_forward,
        _finish_forward,
        _prepare_forward,
    )
    from nebula3d.pipeline import pdf_consistency_check
    from nebula3d.webbridge import _five_smooth

    rng = np.random.default_rng(4)
    n = 33  # scipy: no pad (3·11); 5-smooth: 36 — maximally different choice
    data = (5.0 + rng.normal(0, 1.0, (n, n, n))).astype(np.float32)
    vol = HKLVolume.from_arrays(data, (-2, 2), (-2, 2), (-2, 2),
                                ub_matrix=2 * np.pi * np.eye(3))
    from nebula3d.pipeline import DeltaPdfParams

    p = DeltaPdfParams()
    dpdfs = []
    for fast_len in (None, _five_smooth):
        kwargs = {} if fast_len is None else {"fast_len": fast_len}
        plan = _prepare_forward(
            vol, apodization="gaussian", gaussian_sigma=p.gaussian_sigma,
            zero_pad=True, subtract_mean=True, real_space_angstrom=True,
            crop_hkl=None, q_band=None, subtract_smooth_bg=None, **kwargs)
        dpdfs.append(_finish_forward(plan, _fft_core_forward(plan)))
    m_ref = pdf_consistency_check(vol, dpdfs[0], p)
    m_p5 = pdf_consistency_check(vol, dpdfs[1], p)
    assert dpdfs[1].data.shape == (36, 36, 36)
    assert abs(m_ref["pearson_r"] - m_p5["pearson_r"]) < 1e-5
    assert abs(m_ref["normalized_rms"] - m_p5["normalized_rms"]) < 1e-5
