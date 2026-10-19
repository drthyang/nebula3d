# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The browser build's verdicts against the native ones (docs/web.md, "Native
and browser parity").

One small synthetic volume runs through both engines: the dev split's case
with powder rings and a shell of the crystal's own scattering
(``nebula3d.validation``, dev only), on 121 points per axis, the coarsest grid
on which the ring stage judges its shells.

- **native**: float64 and the low-memory mode off, the pipeline with the
  server's parameters for an empty request (``build_params``, as the native
  app's job worker runs it), its outputs read through the server's endpoints;
- **browser**: :mod:`nebula3d.webbridge` as the Pyodide build drives it
  (``setup``, ``load_input``, ``run_async``: float32 storage, the low-memory
  mode on, no figure), its outputs read through the bridge's own functions.

Pinned equal (measured equal on every dev case and the demo, at 121 and 161
points): what the stages' summaries say, the ring decision, the punch, the
ΔPDF's grid, window and strongest features, and the round trip's settings.
Allowed to differ, by the measured amount: the values float32 rounds (about
1e-7 of the data), the round trip against the data's even part (≈ 1e-14
natively, ≈ 6e-6 in float32), and the ring test's direction measurements,
which the low-memory mode samples more thinly (its decisions agree).
"""

from __future__ import annotations

import asyncio
import json
import os
import re

import numpy as np
import pytest
from fastapi.testclient import TestClient

import nebula3d
from nebula3d import webbridge
from nebula3d.io import load_delta_pdf
from nebula3d.io.hkl_reader import save
from nebula3d.pipeline import pipeline_paths, read_punch_record, run_pipeline
from nebula3d.server.app import create_app
from nebula3d.server.config import ServerConfig
from nebula3d.server.params import build_params
from nebula3d.server.schemas import PipelineRunRequest
from nebula3d.validation import build, case_named

CASE = "dev-rings-shell"
N = 121
STEM = "parity_synthetic"
SLUG = "parity-synthetic"
LOW_MEMORY = "NEBULA3D_LOW_MEMORY"
# A number as the summaries print it: sign, thousands separators, decimals, exponent.
NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?")


def _responses(get) -> dict:
    """What the Pilot's tools and the viewers read of a run."""
    return {
        "check": get("check"),
        "meta": get("meta"),
        "profile": get("profile"),
        "rings": get("rings"),
        "features": get("features"),
    }


@pytest.fixture(scope="module")
def runs(tmp_path_factory) -> dict:
    root = tmp_path_factory.mktemp("parity")
    raw = root / "native" / "raw" / f"{STEM}.nxs"
    raw.parent.mkdir(parents=True)
    save(build(case_named(CASE), N).raw, raw)
    saved = os.environ.pop(LOW_MEMORY, None)
    try:
        # Native: the server's own parameters and endpoints, low-memory off.
        native_events: list[tuple] = []
        run_pipeline(raw, build_params(PipelineRunRequest(dataset_id=SLUG)),
                     proc_dir=root / "native" / "processed", force=True,
                     progress=lambda *e: native_events.append(e))
        client = TestClient(create_app(ServerConfig(data_root=root / "native")))
        routes = {
            "check": f"/api/consistency/{SLUG}/check",
            "meta": f"/api/consistency/{SLUG}/meta",
            "profile": f"/api/bragg/{SLUG}/profile",
            "rings": f"/api/rings/{SLUG}/diagnostics",
            "features": f"/api/deltapdf/{SLUG}.delta_pdf/features",
        }
        native = _responses(lambda k: client.get(routes[k]).json())
        # Browser: the bridge as the Pyodide worker drives it.
        webbridge.setup(workdir=str(root / "browser"))
        assert webbridge.load_input(f"{STEM}.nxs", str(raw)) == SLUG
        browser_events: list[tuple] = []
        asyncio.run(webbridge.run_async("", "{}", True, force=True,
                                        progress=lambda *e: browser_events.append(e)))
        bridge = {
            "check": lambda: webbridge.consistency_check_json(SLUG),
            "meta": lambda: webbridge.consistency_meta_json(SLUG),
            "profile": lambda: webbridge.bragg_profile_json(SLUG),
            "rings": lambda: webbridge.ring_diagnostics_json(SLUG),
            "features": lambda: webbridge.dpdf_features_json(f"{SLUG}.delta_pdf"),
        }
        browser = _responses(lambda k: json.loads(bridge[k]()))
    finally:
        os.environ.pop(LOW_MEMORY, None)
        if saved is not None:
            os.environ[LOW_MEMORY] = saved
    return {
        "raw": raw,
        "native": {"events": native_events, "api": native,
                   "paths": pipeline_paths(raw, proc_dir=root / "native" / "processed")},
        "browser": {"events": browser_events, "api": browser,
                    "paths": pipeline_paths(root / "browser" / "raw" / f"{STEM}.nxs",
                                            proc_dir=root / "browser" / "processed")},
    }


def _both(runs: dict, read) -> tuple:
    return read(runs["native"]), read(runs["browser"])


def _last_digit(token: str) -> float:
    """One unit in the last digit *token* prints."""
    mantissa, _, exponent = token.lower().partition("e")
    decimals = len(mantissa.split(".")[1]) if "." in mantissa else 0
    return 10.0 ** (int(exponent or 0) - decimals)


def test_the_two_paths_are_the_native_and_the_browser_engines(runs):
    native, browser = _both(runs, lambda r: nebula3d.load(r["paths"].ringremoved, dtype=None))
    assert native.data.dtype == np.float64 and browser.data.dtype == np.float32
    # The browser writes no figure; the native app does.
    assert runs["native"]["paths"].pdf_check_png.exists()
    assert not runs["browser"]["paths"].pdf_check_png.exists()


def test_the_stage_summaries_say_the_same(runs):
    """Every line the run logs, start to done: the same words, and every
    number the same to the digit it prints. Measured: identical, but for the
    sign of a zero (the flatten's R² of a constant fit, ±0.000)."""
    native, browser = _both(runs, lambda r: [(e[0], e[1], e[3]) for e in r["events"]])
    assert len(native) == len(browser) > 0
    for (stage, status, a), (stage_b, status_b, b) in zip(native, browser):
        assert (stage, status, NUMBER.sub("#", a)) == (stage_b, status_b, NUMBER.sub("#", b))
        for x, y in zip(NUMBER.findall(a), NUMBER.findall(b)):
            value_a, value_b = (float(t.replace(",", "")) for t in (x, y))
            assert abs(value_a - value_b) <= _last_digit(x), (stage, a, b)
    assert {e[0] for e in native if e[1] == "done"} == {
        "rings", "punch", "backfill", "flatten", "pdf", "pdf_check"}


def _shells(diagnostics: dict) -> list[dict]:
    return diagnostics["shells"] + diagnostics["rejected_shells"]


def test_the_ring_decision_is_the_same(runs):
    """The same shells found, the same confirmed as powder rings and the
    crystal's own shell kept, the same share of the intensity removed."""
    native, browser = _both(
        runs, lambda r: json.loads(r["paths"].ring_diagnostics_json.read_text()))
    assert native["status"] == browser["status"] == "fitted"
    assert [round(s["q_center"], 2) for s in native["shells"]] == [2.22, 4.05]  # the planted rings
    assert len(_shells(native)) == len(_shells(browser))
    for a, b in zip(_shells(native), _shells(browser)):
        assert a["q_center"] == pytest.approx(b["q_center"], abs=1e-6)
        assert (a["isotropy"]["is_ring"], a["isotropy"]["not_judged"]) == (
            b["isotropy"]["is_ring"], b["isotropy"]["not_judged"])
    assert native["removed_fraction"] == pytest.approx(browser["removed_fraction"], rel=1e-6)
    assert runs["native"]["api"]["rings"]["status"] == runs["browser"]["api"]["rings"]["status"]


#: The digits ShellIsotropy.as_dict keeps of each measurement.
ISOTROPY_DIGITS = {"q_center": 4, "fwhm": 4, "median_height": 6, "relative_height": 4,
                   "isotropy": 3, "snr": 1, "beyond_curve": 2}


def _same_measurements(a: dict, b: dict) -> bool:
    """Two shells' ring-test records, equal to the digits they keep."""
    for key, value in a.items():
        other = b[key]
        if key in ISOTROPY_DIGITS and value is not None and other is not None:
            if abs(value - other) > 1.01 * 10.0 ** -ISOTROPY_DIGITS[key]:
                return False
        elif value != other:
            return False
    return True


def test_the_ring_test_samples_more_thinly_in_low_memory_mode(runs, tmp_path, monkeypatch):
    """Allowed to differ: the measurements per direction behind the decision.
    The low-memory mode reads at most an eighth of the volume's voxels for the
    shells (ring_isotropy.shell_isotropy), so its medians per direction are
    noisier: on the confirmed rings here the isotropy moved by up to 0.048 and
    the signal-to-noise from 32.9 to 23.1 (on the 161³ demo by up to 0.27, and
    up to 2.6 times lower); on an empty shell, where the median height is
    about 0 and the ratio has no scale, the isotropy by 36. float32 has no
    part in it: the native engine in low-memory mode measures what the
    browser does."""
    native, browser = _both(
        runs, lambda r: json.loads(r["paths"].ring_diagnostics_json.read_text()))
    for a, b in zip(native["shells"], browser["shells"]):  # the confirmed rings
        assert abs(a["isotropy"]["isotropy"] - b["isotropy"]["isotropy"]) <= 0.1
    monkeypatch.setenv(LOW_MEMORY, "1")
    proc = tmp_path / "native-low-memory"
    run_pipeline(runs["raw"], build_params(PipelineRunRequest(dataset_id=SLUG)),
                 proc_dir=proc, stages=("rings",), force=True)
    lean = json.loads(pipeline_paths(runs["raw"], proc_dir=proc).ring_diagnostics_json.read_text())
    assert len(_shells(lean)) == len(_shells(browser))
    for a, b in zip(_shells(lean), _shells(browser)):
        assert _same_measurements(a["isotropy"], b["isotropy"]), (a["isotropy"], b["isotropy"])


def test_the_punch_is_the_same(runs):
    """The same peaks at the same nodes, the same voxels punched (no boundary
    voxel flips here; tests/test_float32_equivalence.py allows a few)."""
    native, browser = _both(runs, lambda r: r["api"]["profile"])
    assert native["n_peaks"] == browser["n_peaks"] > 0

    def by_centre(profile):
        return sorted(profile["peaks"], key=lambda p: tuple(p["center_hkl"]))

    for a, b in zip(by_centre(native), by_centre(browser)):
        assert (a["source_node_hkl"], a["center_hkl"]) == (b["source_node_hkl"], b["center_hkl"])
        for key in ("intensity", "local_background", "significance"):  # float32: 1.4e-7
            assert a[key] == pytest.approx(b[key], rel=1e-5), key
    punched_n, punched_b = _both(runs, lambda r: read_punch_record(r["paths"].braggpunched))
    assert int(punched_n.sum()) == int(punched_b.sum()) > 0
    assert np.array_equal(punched_n, punched_b)


def test_the_cleaned_volumes_differ_by_float32_rounding(runs):
    for stage in ("backfilled", "flattened"):  # measured 7e-9 and 3e-8
        native, browser = _both(runs, lambda r: nebula3d.load(getattr(r["paths"], stage),
                                                             dtype=None))
        assert np.array_equal(native.mask, browser.mask), stage
        m = native.mask & np.isfinite(native.data)
        d = native.data[m] - browser.data[m].astype(np.float64)
        assert np.sqrt(np.mean(d * d) / np.mean(native.data[m] ** 2)) < 1e-6, stage


def test_the_delta_pdf_is_the_same(runs):
    """The same grid, window and provenance; values to float32 rounding
    (measured 1.5e-7 of the RMS); the same strongest features."""
    native, browser = _both(runs, lambda r: load_delta_pdf(r["paths"].delta_pdf))
    assert native.logs == browser.logs  # q_max, the window (resolved), the transform
    assert native.data.shape == browser.data.shape
    d = native.data - browser.data.astype(np.float64)
    assert np.sqrt(np.mean(d * d) / np.mean(native.data ** 2)) < 1e-5
    fa, fb = _both(runs, lambda r: r["api"]["features"])
    assert fa["n_extrema"] == fb["n_extrema"] and len(fa["groups"]) == len(fb["groups"]) > 0
    assert fa["sigma"] == pytest.approx(fb["sigma"], rel=1e-5)
    for ga, gb in zip(fa["groups"], fb["groups"]):
        for key in ("sign", "n", "multiplicity"):
            assert ga[key] == gb[key], key
        assert ga["length"] == pytest.approx(gb["length"], abs=1e-3)
        assert np.allclose(ga["vectors"], gb["vectors"], atol=1e-3)
        assert ga["size_sigma"] == pytest.approx(gb["size_sigma"], rel=1e-4)


def test_the_back_fft_check_is_the_same(runs):
    """The run's saved check. Equal to 1e-6 (measured 4e-10), but the round
    trip against the data's even part: exact to 1e-14 natively, while float32
    leaves about 6e-6; both read as sound (pearson_r_even ≥ 0.999)."""
    native, browser = _both(runs, lambda r: r["api"]["check"]["metrics"])
    assert native["n_voxels"] == browser["n_voxels"]
    for key in ("pearson_r", "pearson_r_even", "normalized_rms", "odd_share"):
        assert native[key] == pytest.approx(browser[key], abs=1e-6), key
    for key, value in native["per_plane_r"].items():
        assert value == pytest.approx(browser["per_plane_r"][key], abs=1e-6)
    assert native["normalized_rms_even"] < 1e-12
    assert browser["normalized_rms_even"] < 2e-5
    assert min(native["pearson_r_even"], browser["pearson_r_even"]) >= 0.999


def test_the_consistency_view_is_the_same(runs):
    """The view, served natively and bridged: the same settings (the run's),
    grid and metrics; and on each path, with the run's settings over the full
    range, it reproduces that run's own saved check."""
    native, browser = _both(runs, lambda r: r["api"]["meta"])
    assert native["settings"] == browser["settings"]
    assert native["settings"]["source"] == "run" and native["settings"]["defaulted"] == []
    for key in ("shape", "h_range", "k_range", "l_range", "dpdf_shape", "q_data_max",
                "r_data_max"):
        assert native[key] == browser[key], key
    for key in ("pearson_r", "pearson_r_even", "normalized_rms", "odd_share"):
        assert native["metrics"][key] == pytest.approx(browser["metrics"][key], abs=1e-6), key
    for side in ("native", "browser"):
        view = runs[side]["api"]["meta"]["metrics"]
        check = runs[side]["api"]["check"]["metrics"]
        for key in ("pearson_r", "pearson_r_even", "normalized_rms", "n_voxels"):
            assert view[key] == pytest.approx(check[key], abs=1e-9), (side, key)


def test_the_parity_volume_is_a_dev_case():
    assert case_named(CASE).split == "dev"
