# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The back-FFT consistency view transforms as the dataset's run did.

The ΔPDF stage records its transform in the ΔPDF's provenance
(``transform_config``); the view reads it back for the window, its σ, shape
and support, the padding and the subtractions, keeps the full |Q| range (no
crop, by design), and says in its response where its settings came from: the
run's record, or the package defaults when there is none (``settings``).
"""

from __future__ import annotations

import dataclasses
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

import nebula3d
from nebula3d import webbridge
from nebula3d.core import HKLVolume
from nebula3d.demo import demo_volume
from nebula3d.io import load_delta_pdf, save_delta_pdf
from nebula3d.pipeline import (
    DeltaPdfParams,
    PipelineParams,
    consistency_reconstruction,
    delta_pdf_settings_from_config,
    delta_pdf_transform_config,
    pipeline_paths,
    run_pipeline,
)
from nebula3d.server import consistency as cons
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig

STEM = "synthetic_settings"
SLUG = "synthetic-settings"
HANN = DeltaPdfParams(apodization="hann", gaussian_sigma=0.5)
DEFAULT_WINDOW = {f: getattr(DeltaPdfParams(), f) for f in cons.WINDOW_FIELDS}


def _paths(root):
    return pipeline_paths(root / "raw" / f"{STEM}.nxs", proc_dir=root / "processed")


def _run(root, delta_pdf=HANN, stages=None):
    """The pipeline on a small synthetic volume under *root*, as the native app
    runs it (float64, its ΔPDF made with *delta_pdf*)."""
    paths = _paths(root)
    if not paths.input.exists():
        paths.input.parent.mkdir(parents=True, exist_ok=True)
        nebula3d.save(demo_volume(25), paths.input)
    kw = {} if stages is None else {"stages": stages}
    run_pipeline(paths.input, PipelineParams(delta_pdf=delta_pdf),
                 proc_dir=root / "processed", force=True, **kw)
    return paths


def _client(root):
    return TestClient(create_app(ServerConfig(data_root=root)))


def _write_backfilled(root):
    """A dataset with a backfilled volume and no ΔPDF."""
    paths = _paths(root)
    for name in ("raw", "processed"):
        (root / name).mkdir(exist_ok=True)
    rng = np.random.default_rng(0)
    vol = HKLVolume.from_arrays(1.0 + rng.normal(0.0, 0.3, (9, 11, 13)), (-3, 3), (-4, 4),
                                (-5, 5), ub_matrix=2 * np.pi * np.eye(3) / 4.0)
    nebula3d.save(vol, paths.ringremoved)
    nebula3d.save(vol, paths.backfilled)
    return paths


def _write_record(path, **logs):
    """A ΔPDF file whose provenance holds *logs* only."""
    axis = np.linspace(-5.0, 5.0, 4)
    save_delta_pdf(path, np.zeros((4, 4, 4)), axis, axis, axis, logs=logs)


@pytest.fixture(autouse=True)
def _fresh_caches():
    cons.clear_cache()
    yield
    cons.clear_cache()


# ---------------------------------------------------------------------------
# The record: transform_config read back
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("p", [
    DeltaPdfParams(),
    HANN,
    DeltaPdfParams(apodization="none", zero_pad=False, subtract_mean=False,
                   crop_hkl=(4.0, 8.0, 15.0), q_band=(0.5, 9.0), subtract_smooth_bg=0.3,
                   window_shape="ellipsoid", window_support=False),
    DeltaPdfParams(subtract_smooth_bg=(1.0, 2.0, 3.0), window_shape="separable"),
])
def test_the_transform_record_reads_back_as_written(p):
    assert DeltaPdfParams(**delta_pdf_settings_from_config(delta_pdf_transform_config(p))) == p


def test_a_record_gives_only_what_it_holds():
    # The example scripts' stamp: no q_band, window_shape or window_support.
    old = "apodize=hann;gaussian_sigma=0.5;zero_pad=1;subtract_mean=1;crop_hkl=;subtract_bg="
    assert delta_pdf_settings_from_config(old) == {
        "apodization": "hann", "gaussian_sigma": 0.5, "zero_pad": True,
        "subtract_mean": True, "crop_hkl": None, "subtract_smooth_bg": None}
    # The browser's WebGPU path appends its FFT; a key it does not know is no setting.
    gpu = delta_pdf_transform_config(HANN) + ";fft=webgpu-f32-p5"
    assert DeltaPdfParams(**delta_pdf_settings_from_config(gpu)) == HANN
    assert delta_pdf_settings_from_config("") == {}
    assert delta_pdf_settings_from_config("kind=3dpdf_bragg_kept") == {}


@pytest.mark.parametrize("bad", [
    "apodize=boxcar", "gaussian_sigma=wide", "zero_pad=yes", "window_shape=round",
    "crop_hkl=4,8", "q_band=1", "subtract_bg=1,2",
])
def test_a_record_that_does_not_read_back_is_refused(bad):
    with pytest.raises(ValueError, match="transform_config"):
        delta_pdf_settings_from_config(bad)


# ---------------------------------------------------------------------------
# The view: the run's settings, and where they came from
# ---------------------------------------------------------------------------
def test_a_run_made_with_hann_05_is_viewed_with_hann_05(tmp_path):
    """The known answer: the run's window, not the package's gaussian 0.4."""
    paths = _run(tmp_path, HANN)
    served = _client(tmp_path).get(f"/api/consistency/{SLUG}/meta")
    assert served.status_code == 200, served.text
    meta = served.json()
    assert meta["settings"] == {
        "source": "run",
        "note": None,
        "delta_pdf": paths.delta_pdf.name,
        "made_from": paths.flattened.name,
        "same_input": True,
        "defaulted": [],
        "apodization": "hann",
        "gaussian_sigma": 0.5,
        "zero_pad": True,
        "subtract_mean": True,
        "subtract_smooth_bg": None,
        "window_shape": "auto",
        "window_support": True,
        "run_crop_hkl": None,
        "run_q_band": None,
    }
    assert meta["metrics"]["apodization"] == "hann"
    # Computed with that window, not only labelled with it.
    vol = nebula3d.load(paths.flattened, dtype=None)
    hann = consistency_reconstruction(vol, HANN)["metrics"]
    gaussian = consistency_reconstruction(vol, DeltaPdfParams())["metrics"]
    for key in ("pearson_r", "normalized_rms", "pearson_r_even", "n_voxels"):
        assert meta["metrics"][key] == pytest.approx(hann[key], rel=1e-12, abs=0.0), key
    assert gaussian["normalized_rms"] != pytest.approx(hann["normalized_rms"], rel=1e-4)
    # So, over the full range, it reproduces the run's own saved check.
    check = _client(tmp_path).get(f"/api/consistency/{SLUG}/check").json()["metrics"]
    assert check["apodization"] == "hann"
    for key in ("pearson_r", "normalized_rms", "pearson_r_even", "n_voxels"):
        assert meta["metrics"][key] == pytest.approx(check[key], abs=1e-9), key
    # The browser build reads the same record.
    webbridge.setup(workdir=str(tmp_path))
    bridged = json.loads(webbridge.consistency_meta_json(SLUG))
    assert bridged["settings"] == meta["settings"]
    assert bridged["metrics"]["normalized_rms"] == pytest.approx(
        hann["normalized_rms"], rel=1e-12)


def test_the_view_follows_a_re_run_of_the_delta_pdf(tmp_path):
    """Re-running the ΔPDF stage with other settings leaves its input volume
    untouched; the view must not serve the reconstruction cached for the
    old ones."""
    paths = _run(tmp_path, HANN)
    client = _client(tmp_path)
    assert client.get(f"/api/consistency/{SLUG}/meta").json()["settings"]["apodization"] == "hann"
    mtime = paths.flattened.stat().st_mtime_ns
    _run(tmp_path, DeltaPdfParams(), stages=("pdf",))
    assert paths.flattened.stat().st_mtime_ns == mtime
    meta = client.get(f"/api/consistency/{SLUG}/meta").json()
    assert (meta["settings"]["apodization"], meta["settings"]["gaussian_sigma"]) == (
        "gaussian", 0.4)
    assert meta["metrics"]["apodization"] == "gaussian"  # recomputed, not the cached hann


def test_the_saved_band_records_the_transform_it_was_made_with(tmp_path):
    _run(tmp_path, HANN)
    saved = _client(tmp_path).post(f"/api/consistency/{SLUG}/save",
                                   params={"q_min": 1.0, "q_max": 6.0})
    assert saved.status_code == 200, saved.text
    logs = load_delta_pdf(saved.json()["path"], read_data=False).logs
    assert logs["transform_config"] == delta_pdf_transform_config(
        dataclasses.replace(HANN, q_band=(1.0, 6.0)))
    assert logs["apodization"] == "hann"


def test_without_a_record_the_view_takes_the_defaults_and_says_so(tmp_path):
    paths = _write_backfilled(tmp_path)
    client = _client(tmp_path)
    settings = client.get(f"/api/consistency/{SLUG}/meta").json()["settings"]
    assert settings["source"] == "defaults"
    assert settings["note"] == "no ΔPDF on disk for this dataset"
    assert (settings["delta_pdf"], settings["made_from"], settings["same_input"]) == (
        None, None, None)
    assert settings["defaulted"] == list(cons.WINDOW_FIELDS)
    assert {f: settings[f] for f in cons.WINDOW_FIELDS} == DEFAULT_WINDOW

    # A ΔPDF that records no transform, one that records only what the view
    # does not apply (its crop), and one that is no ΔPDF at all.
    _write_record(paths.delta_pdf, q_max=11.9, source_file=paths.backfilled.name)
    settings = client.get(f"/api/consistency/{SLUG}/meta").json()["settings"]
    assert settings["source"] == "defaults"
    assert settings["note"] == f"{paths.delta_pdf.name} records no transform settings"
    assert {f: settings[f] for f in cons.WINDOW_FIELDS} == DEFAULT_WINDOW
    _write_record(paths.delta_pdf, transform_config="crop_hkl=2,3,4")
    settings = client.get(f"/api/consistency/{SLUG}/meta").json()["settings"]
    assert settings["source"] == "defaults" and settings["run_crop_hkl"] == [2.0, 3.0, 4.0]
    assert settings["note"] == f"{paths.delta_pdf.name} records no transform settings"
    paths.delta_pdf.write_bytes(b"")
    settings = client.get(f"/api/consistency/{SLUG}/meta").json()["settings"]
    assert settings["source"] == "defaults"
    assert settings["note"].startswith(f"{paths.delta_pdf.name} could not be read")


def test_a_partial_record_names_the_settings_it_lacks(tmp_path):
    """A stamp written before window_shape and window_support existed: the
    run's window, and those two from the defaults, by name."""
    paths = _write_backfilled(tmp_path)
    _write_record(paths.delta_pdf, source_file=paths.backfilled.name, transform_config=(
        "apodize=hann;gaussian_sigma=0.5;zero_pad=0;subtract_mean=1;crop_hkl=2,3,4;subtract_bg="))
    settings = _client(tmp_path).get(f"/api/consistency/{SLUG}/meta").json()["settings"]
    assert settings["source"] == "run" and settings["note"] is None
    assert settings["defaulted"] == ["window_shape", "window_support"]
    assert (settings["apodization"], settings["gaussian_sigma"], settings["zero_pad"]) == (
        "hann", 0.5, False)
    assert (settings["window_shape"], settings["window_support"]) == ("auto", True)
    # The crop is the run's, reported; the view keeps the full range.
    assert settings["run_crop_hkl"] == [2.0, 3.0, 4.0]
    assert settings["same_input"] is True


def test_a_record_of_another_volume_is_still_the_runs_and_says_so(tmp_path):
    """A run with the flatten off leaves an older flattened volume beside the
    backfilled one its ΔPDF was made from: the view transforms the flattened
    one, with the run's window, and says the record describes the other."""
    paths = _write_backfilled(tmp_path)
    nebula3d.save(nebula3d.load(paths.backfilled), paths.flattened)
    _write_record(paths.delta_pdf, source_file=paths.backfilled.name,
                  transform_config=delta_pdf_transform_config(HANN))
    settings = _client(tmp_path).get(f"/api/consistency/{SLUG}/meta").json()["settings"]
    assert settings["source"] == "run" and settings["apodization"] == "hann"
    assert settings["made_from"] == paths.backfilled.name
    assert settings["same_input"] is False
