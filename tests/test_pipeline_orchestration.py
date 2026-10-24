"""Tests for nebula3d.pipeline orchestration: chaining, resume, force, progress.

The heavy per-stage maths is covered elsewhere (test_pipeline.py,
test_radial_flatten.py, test_bragg.py, ...).  These tests pin the *orchestration*
contract of :func:`nebula3d.pipeline.run_pipeline`:

* the chained output file names match the original ``run_pipeline.py``;
* stages are skipped when their output already exists (resume);
* ``force_from`` recomputes the tail only;
* ``flatten_enabled=False`` routes the backfilled volume into the FFT;
* the progress callback fires per stage;
* the ΔPDF ``.h5`` is written in the schema the viewers read, with a working
  stale-cache guard.
"""

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

import nebula3d
from nebula3d import pipeline
from nebula3d.analysis.delta_pdf import FFTOriginError
from nebula3d.core import HKLVolume
from nebula3d.io import load_delta_pdf

UB = 2 * np.pi * np.eye(3) / 4.0


def _vol(shape=(9, 9, 9), seed=0, fill=1.0):
    rng = np.random.default_rng(seed)
    data = fill + rng.normal(0.0, 0.01, shape)
    return HKLVolume.from_arrays(data, (-3, 3), (-3, 3), (-3, 3), ub_matrix=UB)


def _fake_dpdf(shape=(8, 8, 8)):
    """Minimal stand-in for a DeltaPDF (what write_delta_pdf_h5 reads)."""
    n = shape[0]
    ax = np.linspace(-10, 10, n)
    return SimpleNamespace(
        data=np.random.default_rng(1).normal(0, 1, shape),
        x_axis=ax, y_axis=ax, z_axis=ax, q_max=3.0, apodization="gaussian",
        window_shape="separable", window_ellipsoid=None,
    )


# ---------------------------------------------------------------------------
# pure helpers
# ---------------------------------------------------------------------------
def test_pipeline_paths_match_run_pipeline_naming(tmp_path):
    paths = pipeline.pipeline_paths(tmp_path / "sample.nxs", proc_dir=tmp_path,
                                    flatten_enabled=True)
    assert paths.ringremoved.name == "sample_ringremoved.h5"
    assert paths.ring_diagnostics_json.name == (
        "sample_ringremoved_diagnostics.json"
    )
    assert paths.braggpunched.name == "sample_ringremoved_braggpunched.h5"
    assert paths.backfilled.name == "sample_ringremoved_braggpunched_backfilled.h5"
    assert paths.flattened.name == (
        "sample_ringremoved_braggpunched_backfilled_flattened.h5"
    )
    # ΔPDF name is derived from the *backfilled* stem regardless of flatten.
    assert paths.delta_pdf.name == (
        "sample_ringremoved_braggpunched_backfilled_delta_pdf.h5"
    )
    assert paths.pdf_input == paths.flattened


def test_pdf_input_is_backfilled_when_flatten_disabled(tmp_path):
    paths = pipeline.pipeline_paths(tmp_path / "s.nxs", proc_dir=tmp_path,
                                    flatten_enabled=False)
    assert paths.pdf_input == paths.backfilled


def _ring_vol_3d(shape=(5, 41, 41), ring_q=3.0, ring_fwhm=0.14, seed=0):
    """3-D volume with a textured powder ring in each 0kl plane (slice_axis='H')."""
    from nebula3d.preprocessing.parametric_ring import _pseudo_voigt

    rng = np.random.default_rng(seed)
    vol = HKLVolume.from_arrays(
        np.ones(shape), (-2, 2), (-4, 4), (-4, 4), ub_matrix=UB)
    q = vol.q_magnitude()
    _, K, L = vol.hkl_grid()
    Q = np.stack([np.zeros_like(K), K, L], axis=-1) @ UB.T
    phi = np.arctan2(Q[..., 2], Q[..., 1])
    diffuse = 1.0 + 0.2 * np.cos(np.pi * K) * np.cos(np.pi * L)
    ring = (1.0 + 0.4 * np.cos(2 * phi)) * 3.0 * _pseudo_voigt(q, ring_q, ring_fwhm, 0.5)
    data = diffuse + ring + rng.normal(0, 0.02, shape)
    return HKLVolume.from_arrays(
        data, (-2, 2), (-4, 4), (-4, 4), ub_matrix=UB), q


def test_remove_rings_parametric_runs_and_suppresses_ring():
    """The ring_model='parametric' branch runs through the per-slice 3-D driver
    and subtracts the planted ring while preserving the off-ring diffuse."""
    vol, q = _ring_vol_3d()
    params = pipeline.RingParams(
        ring_model="parametric", slice_axis="H", q_min=1.0, q_max=8.0,
        confirm_rings=False)
    out = pipeline.remove_rings(vol, params)

    assert out.data.shape == vol.data.shape
    assert np.isfinite(out.data).all()

    on_lo, on_hi = 2.9, 3.1
    base = float(np.median(vol.data[(q > 1.3) & (q < 1.9)]))
    before = float(np.median(vol.data[(q > on_lo) & (q < on_hi)])) - base
    after = float(np.median(out.data[(q > on_lo) & (q < on_hi)])) - base
    assert before > 0.3
    assert after < 0.4 * before


def test_remove_rings_global_v2_attaches_diagnostics():
    """The sample-only global path bypasses slice fitting and returns a
    persistable diagnostic contract."""
    vol, _q = _ring_vol_3d()
    params = pipeline.RingParams(
        ring_model="global_v2", q_min=1.0, q_max=8.0, q_step=0.04,
        ring_width=0.30, global_material="generic", global_subtraction="mean",
        global_angular_lmax=2, global_min_snr=2.0)
    out = pipeline.remove_rings(vol, params)

    diagnostics = getattr(out, "_ring_diagnostics")
    assert diagnostics["algorithm"] == "global_v2"
    assert diagnostics["n_fitted_shells"] >= 1
    assert out.data.shape == vol.data.shape


def test_remove_rings_global_v2_is_slice_axis_independent():
    vol, _q = _ring_vol_3d()
    common = dict(
        ring_model="global_v2", q_min=1.0, q_max=8.0, q_step=0.04,
        ring_width=0.30, global_material="generic", global_subtraction="mean",
        global_angular_lmax=2, global_min_snr=2.0)
    out_h = pipeline.remove_rings(vol, pipeline.RingParams(slice_axis="H", **common))
    out_l = pipeline.remove_rings(vol, pipeline.RingParams(slice_axis="L", **common))
    assert np.array_equal(out_h.data, out_l.data)
    assert getattr(out_h, "_ring_diagnostics") == getattr(out_l, "_ring_diagnostics")


def test_run_pipeline_global_v2_writes_diagnostic_sidecar(tmp_path):
    vol, _q = _ring_vol_3d()
    inp = tmp_path / "global_sample.nxs"
    nebula3d.save(vol, inp)
    params = pipeline.PipelineParams(rings=pipeline.RingParams(
        ring_model="global_v2", q_min=1.0, q_max=8.0, q_step=0.04,
        ring_width=0.30, global_material="generic", global_subtraction="mean",
        global_angular_lmax=2, global_min_snr=2.0))

    paths = pipeline.run_pipeline(
        inp, params, proc_dir=tmp_path, stages=("rings",))

    assert paths.ringremoved.exists()
    assert paths.ring_diagnostics_json.exists()
    diagnostic = json.loads(paths.ring_diagnostics_json.read_text())
    assert diagnostic["algorithm"] == "global_v2"
    assert diagnostic["n_fitted_shells"] >= 1


def test_transform_config_string_format():
    cfg = pipeline.delta_pdf_transform_config(
        pipeline.DeltaPdfParams(apodization="gaussian", gaussian_sigma=0.4,
                                zero_pad=True, subtract_mean=True,
                                crop_hkl=(4.0, 8.0, 15.0), subtract_smooth_bg=None)
    )
    assert cfg == (
        "apodize=gaussian;gaussian_sigma=0.4;zero_pad=1;subtract_mean=1;"
        "crop_hkl=4,8,15;q_band=;subtract_bg=;window_shape=auto;window_support=1"
    )


# ---------------------------------------------------------------------------
# orchestration with stubbed stage compute (fast, deterministic)
# ---------------------------------------------------------------------------
@pytest.fixture
def stubbed(monkeypatch):
    """Replace the five stage compute fns with fast recording stubs."""
    calls = []
    vol = _vol()

    def mk(name):
        # The punch also takes the sample's facts (symmetry, modulation).
        def stub(v, params=None, *, progress=None, **_facts):
            calls.append(name)
            return vol
        return stub

    monkeypatch.setattr(pipeline, "remove_rings", mk("rings"))
    monkeypatch.setattr(pipeline, "punch_bragg", mk("punch"))
    monkeypatch.setattr(pipeline, "backfill", mk("backfill"))
    monkeypatch.setattr(pipeline, "flatten", mk("flatten"))

    def pdf_stub(v, params=None, *, progress=None):
        calls.append("pdf")
        return _fake_dpdf()

    monkeypatch.setattr(pipeline, "delta_pdf", pdf_stub)

    # Stage 6 (pdf_check) — stub the back-FFT comparison so orchestration tests
    # stay fast and don't need a real invertible DeltaPDF; it touches the figure
    # so the resume/skip guard (json+png both exist) behaves.
    def pdf_check_stub(vol, dpdf, params, *, h_values=(0.0,), figure_path=None,
                       consume_dpdf=False):
        calls.append("pdf_check")
        if figure_path is not None:
            Path(figure_path).write_bytes(b"")
        return {"pearson_r": 1.0, "normalized_rms": 0.0}

    monkeypatch.setattr(pipeline, "pdf_consistency_check", pdf_check_stub)
    return SimpleNamespace(calls=calls, vol=vol)


def _seed_input(tmp_path):
    inp = tmp_path / "sample.nxs"
    nebula3d.save(_vol(), tmp_path / "sample.nxs")
    return inp


def test_run_pipeline_runs_all_stages_in_order(tmp_path, stubbed):
    inp = _seed_input(tmp_path)
    events = []
    paths = pipeline.run_pipeline(
        inp, proc_dir=tmp_path,
        progress=lambda *a: events.append(a),
    )
    assert stubbed.calls == [
        "rings", "punch", "backfill", "flatten", "pdf", "pdf_check"]
    for p in (paths.ringremoved, paths.braggpunched, paths.backfilled,
              paths.flattened, paths.delta_pdf,
              paths.pdf_check_json, paths.pdf_check_png):
        assert p.exists(), p
    # nothing skipped on a fresh run
    assert not any(ev[1] == "skip" for ev in events)


def test_run_pipeline_resumes_and_skips_existing(tmp_path, stubbed):
    inp = _seed_input(tmp_path)
    pipeline.run_pipeline(inp, proc_dir=tmp_path)        # first run writes outputs
    stubbed.calls.clear()

    events = []
    pipeline.run_pipeline(inp, proc_dir=tmp_path,
                          progress=lambda *a: events.append(a))
    assert stubbed.calls == []                           # everything skipped
    skipped = {ev[0] for ev in events if ev[1] == "skip"}
    assert skipped == {
        "rings", "punch", "backfill", "flatten", "pdf", "pdf_check"}


def test_force_from_recomputes_tail_only(tmp_path, stubbed):
    inp = _seed_input(tmp_path)
    pipeline.run_pipeline(inp, proc_dir=tmp_path)
    stubbed.calls.clear()

    pipeline.run_pipeline(inp, proc_dir=tmp_path, force_from="backfill")
    assert stubbed.calls == ["backfill", "flatten", "pdf", "pdf_check"]


def test_force_recomputes_everything(tmp_path, stubbed):
    inp = _seed_input(tmp_path)
    pipeline.run_pipeline(inp, proc_dir=tmp_path)
    stubbed.calls.clear()

    pipeline.run_pipeline(inp, proc_dir=tmp_path, force=True)
    assert stubbed.calls == [
        "rings", "punch", "backfill", "flatten", "pdf", "pdf_check"]


def test_run_pipeline_trims_the_coverage_edge_of_the_raw_input(
        tmp_path, stubbed, monkeypatch):
    inp = tmp_path / "sample.nxs"
    raw = _vol(shape=(8, 8, 8))                # rings only: no ΔPDF, any grid
    raw.mask[:, :, 6:] = False                # unmeasured coverage
    raw.data[:, :, 6:] = 0.0
    nebula3d.save(raw, inp)
    seen = []

    def rings_stub(v, params=None, *, progress=None):
        seen.append(v.mask.copy())
        return stubbed.vol

    monkeypatch.setattr(pipeline, "remove_rings", rings_stub)
    events = []
    pipeline.run_pipeline(inp, proc_dir=tmp_path, stages=("rings",),
                          progress=lambda *a: events.append(a))
    pipeline.run_pipeline(inp, pipeline.PipelineParams(edge_trim=0),
                          proc_dir=tmp_path, stages=("rings",), force=True)

    assert not seen[0][:, :, 5].any() and seen[0][:, :, :5].all()   # on by default
    assert any("trimmed 64 voxels" in ev[3] for ev in events)
    assert seen[1][:, :, :6].all()                                  # 0 keeps it


def test_punch_record_survives_a_resume_from_disk(tmp_path, stubbed, monkeypatch):
    # The punch artifact stores which voxels are punch holes, so a backfill
    # run later (from the file, not the in-memory hand-over) still has them.
    inp = _seed_input(tmp_path)
    record = np.zeros(stubbed.vol.shape, dtype=bool)
    record[2:4, 2:4, 2:4] = True

    def punch_stub(v, params=None, *, progress=None, **_facts):
        out = HKLVolume(**{f: getattr(stubbed.vol, f) for f in (
            "data", "sigma", "mask", "h_axis", "k_axis", "l_axis", "ub_matrix")})
        setattr(out, "_punched", record)
        return out

    seen = []

    def backfill_stub(v, params=None, *, progress=None):
        seen.append(getattr(v, "_punched", None))
        return stubbed.vol

    monkeypatch.setattr(pipeline, "punch_bragg", punch_stub)
    monkeypatch.setattr(pipeline, "backfill", backfill_stub)
    pipeline.run_pipeline(inp, proc_dir=tmp_path, stages=("punch",))
    events = []
    pipeline.run_pipeline(inp, proc_dir=tmp_path, stages=("backfill",),
                          progress=lambda *a: events.append(a))

    np.testing.assert_array_equal(seen[0], record)
    assert not any("no punch record" in ev[3] for ev in events)


def test_stage_subset_runs_only_requested(tmp_path, stubbed):
    inp = _seed_input(tmp_path)
    # seed the punched file so backfill has an input to load
    nebula3d.save(stubbed.vol, pipeline.pipeline_paths(inp, proc_dir=tmp_path).braggpunched)
    pipeline.run_pipeline(inp, proc_dir=tmp_path, stages=("backfill",))
    assert stubbed.calls == ["backfill"]


def test_a_stage_left_out_with_no_output_on_disk_passes_input_through(tmp_path, stubbed):
    """A cleanup stage left out of `stages` is not run; with no output of it
    on disk, its input flows to the next stage: punch runs on the raw input
    and the ring-removed output is never written. (With one on disk, the
    next stage reads it: a partial re-run. The switches turn a stage off.)"""
    inp = _seed_input(tmp_path)
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path)
    pipeline.run_pipeline(
        inp, proc_dir=tmp_path,
        stages=("punch", "backfill", "flatten", "pdf", "pdf_check"),
    )
    assert "rings" not in stubbed.calls          # left out: not run
    assert stubbed.calls[0] == "punch"           # punch ran first (on the raw input)
    assert not paths.ringremoved.exists()        # not run → no output written
    assert paths.braggpunched.exists()           # downstream still produced
    assert paths.delta_pdf.exists()


def test_flatten_disabled_routes_backfilled_into_pdf(tmp_path, stubbed):
    inp = _seed_input(tmp_path)
    params = pipeline.PipelineParams(flatten_enabled=False)
    paths = pipeline.run_pipeline(inp, params, proc_dir=tmp_path)

    assert not paths.flattened.exists()
    assert "flatten" not in stubbed.calls
    logs = load_delta_pdf(paths.delta_pdf, read_data=False).logs
    assert logs["source_file"] == paths.backfilled.name


def _flatten_off_notice(paths):
    return (f"background correction disabled: the ΔPDF transforms {paths.backfilled.name}, "
            "with no background removed")


@pytest.mark.parametrize("via_inputs", [False, True], ids=["proc_dir", "inputs"])
def test_flatten_disabled_never_reads_a_flattened_volume_left_on_disk(
        tmp_path, stubbed, via_inputs):
    """With the flatten off, the ΔPDF takes the run's backfilled volume, as
    PipelinePaths.pdf_input says: never a flattened one an earlier run left,
    in the processed folder or among a tuning trial's inputs. A stage merely
    left out of `stages` still hands its output on (a partial re-run)."""
    inp = _seed_input(tmp_path)
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path, flatten_enabled=False)
    nebula3d.save(stubbed.vol, paths.flattened)  # left by a run with the flatten on
    kw: dict = {}
    if via_inputs:
        nebula3d.save(stubbed.vol, paths.backfilled)
        kw = dict(stages=("pdf",),
                  inputs={"backfill": paths.backfilled, "flatten": paths.flattened})
    events = []
    pipeline.run_pipeline(inp, pipeline.PipelineParams(flatten_enabled=False),
                          proc_dir=tmp_path, progress=lambda *a: events.append(a), **kw)

    assert paths.pdf_input == paths.backfilled
    logs = load_delta_pdf(paths.delta_pdf, read_data=False).logs
    assert logs["source_file"] == paths.backfilled.name
    assert ("pdf", "progress", None, _flatten_off_notice(paths)) in events
    assert "flatten" not in stubbed.calls


# ---------------------------------------------------------------------------
# the stages' switches: a stage switched off passes its input through
# ---------------------------------------------------------------------------
#: The level of the volume each stub stage writes (the raw input's is 1), so
#: the level a stage is given says which volume it read.
_LEVEL = {"raw": 1, "rings": 10, "punch": 20, "backfill": 30, "flatten": 40}
#: Each cleanup stage's output in PipelinePaths.
_OUTPUT = {"rings": "ringremoved", "punch": "braggpunched",
           "backfill": "backfilled", "flatten": "flattened"}
#: The stage after each switch's, and what it reads with that one off.
_NEXT = {"rings": ("punch", "raw"), "punch": ("backfill", "rings"),
         "backfill": ("flatten", "punch")}


@pytest.fixture
def levels(monkeypatch):
    """Stub stages that write a volume of their own level (_LEVEL) and record
    the level of the volume each was given: stage → level read."""
    read: dict[str, int] = {}

    def level(v):
        return int(round(float(np.nanmedian(v.data))))

    def mk(name):
        # The punch also takes the sample's facts (symmetry, modulation).
        def stub(v, params=None, *, progress=None, **_facts):
            read[name] = level(v)
            return _vol(fill=_LEVEL[name])
        return stub

    for name, fn in (("rings", "remove_rings"), ("punch", "punch_bragg"),
                     ("backfill", "backfill"), ("flatten", "flatten")):
        monkeypatch.setattr(pipeline, fn, mk(name))

    def pdf_stub(v, params=None, *, progress=None):
        read["pdf"] = level(v)
        return _fake_dpdf()

    def pdf_check_stub(vol, dpdf, params, *, h_values=(0.0,), figure_path=None,
                       consume_dpdf=False):
        if figure_path is not None:
            Path(figure_path).write_bytes(b"")
        return {"pearson_r": 1.0, "normalized_rms": 0.0}

    monkeypatch.setattr(pipeline, "delta_pdf", pdf_stub)
    monkeypatch.setattr(pipeline, "pdf_consistency_check", pdf_check_stub)
    return read


def _switched_off(*stages):
    return pipeline.PipelineParams(**{f"{s}_enabled": False for s in stages})


def test_pdf_input_is_the_output_of_the_last_stage_switched_on(tmp_path):
    def pdf_input(*off):
        flags = {f"{s}_enabled": False for s in off}
        return pipeline.pipeline_paths(tmp_path / "s.nxs", proc_dir=tmp_path,
                                       **flags).pdf_input

    paths = pipeline.pipeline_paths(tmp_path / "s.nxs", proc_dir=tmp_path)
    assert pdf_input() == paths.flattened
    assert pdf_input("backfill") == paths.flattened
    assert pdf_input("flatten") == paths.backfilled
    assert pdf_input("backfill", "flatten") == paths.braggpunched
    assert pdf_input("punch", "backfill", "flatten") == paths.ringremoved
    assert pdf_input("rings", "punch", "backfill", "flatten") == paths.input


def test_the_ring_stage_is_not_pending_when_switched_off(tmp_path):
    inp = tmp_path / "s.nxs"
    assert pipeline.ring_stage_pending(inp, proc_dir=tmp_path)  # no output yet
    assert not pipeline.ring_stage_pending(inp, _switched_off("rings"),
                                           proc_dir=tmp_path, force=True)


@pytest.mark.parametrize("listed", [False, True], ids=["left-out", "listed"])
@pytest.mark.parametrize("off", ["rings", "punch", "backfill"])
def test_a_stage_switched_off_passes_its_input_through(tmp_path, levels, off, listed):
    """After a run that wrote every output, a run with *off* switched off:
    the stage after it reads what came before it, never the output the first
    run left, which stays as it was. As the page sends it (the stage left out
    of `stages`, with its switch) or listed (all stages, the CLI's), where
    the stage says it is off."""
    inp = _seed_input(tmp_path)
    pipeline.run_pipeline(inp, proc_dir=tmp_path)  # all on: every output written
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path)
    old = getattr(paths, _OUTPUT[off])
    left = old.stat().st_mtime_ns
    levels.clear()
    stages = pipeline.STAGES if listed else tuple(s for s in pipeline.STAGES if s != off)
    events: list[tuple] = []
    pipeline.run_pipeline(inp, _switched_off(off), proc_dir=tmp_path, stages=stages,
                          force=True, progress=lambda *a: events.append(a))

    nxt, source = _NEXT[off]
    assert off not in levels                       # not run
    assert levels[nxt] == _LEVEL[source]           # what came before it
    assert levels["pdf"] == _LEVEL["flatten"]      # the chain after it ran
    assert old.stat().st_mtime_ns == left          # its old output left as it was
    src = paths.input if source == "raw" else getattr(paths, _OUTPUT[source])
    name = pipeline._STAGE_NAMES
    assert (nxt, "progress", None,
            f"{name[off]} disabled: the {name[nxt]} reads {src.name}") in events
    disabled = (off, "skip", None, pipeline._disabled_notice(off))
    assert (disabled in events) is listed


@pytest.mark.parametrize("off", ["rings", "punch", "backfill"])
def test_a_tuning_trial_passes_a_switched_off_stage_through(tmp_path, levels, off):
    """A trial of the stage after one switched off reads what came before
    that one, never the output its `inputs` name for it (a run with the
    stage on left it in processed/)."""
    inp = _seed_input(tmp_path)
    pipeline.run_pipeline(inp, proc_dir=tmp_path)  # processed/: all on
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path)
    nxt, source = _NEXT[off]
    before = pipeline.STAGES[:pipeline.STAGES.index(nxt)]
    inputs = {s: getattr(paths, _OUTPUT[s]) for s in before}
    levels.clear()
    pipeline.run_pipeline(inp, _switched_off(off), proc_dir=tmp_path / "trial",
                          stages=(nxt,), force=True, inputs=inputs)
    assert levels == {nxt: _LEVEL[source]}


@pytest.mark.parametrize("via_inputs", [False, True], ids=["proc_dir", "inputs"])
@pytest.mark.parametrize("left_out", ["rings", "punch", "backfill"])
def test_a_stage_left_out_hands_on_its_output_on_disk(tmp_path, levels, left_out,
                                                      via_inputs):
    """A stage switched on but left out of `stages` is a partial re-run, as
    before: the stage after it reads its output on disk, or the one `inputs`
    names (a tuning trial's) — the Pilot's single-stage re-runs and the
    tuning's trials need it."""
    inp = _seed_input(tmp_path)
    pipeline.run_pipeline(inp, proc_dir=tmp_path)
    nxt, _ = _NEXT[left_out]
    kw: dict = {"proc_dir": tmp_path}
    level = _LEVEL[left_out]
    if via_inputs:
        chain = pipeline.pipeline_paths(inp, proc_dir=tmp_path / "chain")
        given = getattr(chain, _OUTPUT[left_out])
        given.parent.mkdir()
        nebula3d.save(_vol(fill=77), given)
        kw = {"proc_dir": tmp_path / "trial", "inputs": {left_out: given}}
        level = 77
    levels.clear()
    events: list[tuple] = []
    pipeline.run_pipeline(inp, stages=(nxt,), force=True,
                          progress=lambda *a: events.append(a), **kw)
    assert levels == {nxt: level}
    assert not any("disabled" in ev[3] for ev in events)


@pytest.mark.parametrize("off, nxt, source, notice", [
    (("rings", "punch"), "backfill", "raw",
     "ring removal and Bragg punch disabled: the backfill reads sample.nxs"),
    (("backfill", "flatten"), "pdf", "punch",
     "backfill and background correction disabled: the ΔPDF transforms "
     "sample_ringremoved_braggpunched.h5, with no background removed"),
    (("rings", "punch", "backfill", "flatten"), "pdf", "raw",
     "ring removal, Bragg punch, backfill and background correction disabled: the ΔPDF "
     "transforms sample.nxs, with no background removed"),
], ids=["rings+punch", "backfill+flatten", "all-four"])
def test_stages_switched_off_together_pass_through_together(
        tmp_path, levels, off, nxt, source, notice):
    inp = _seed_input(tmp_path)
    pipeline.run_pipeline(inp, proc_dir=tmp_path)
    levels.clear()
    events: list[tuple] = []
    paths = pipeline.run_pipeline(inp, _switched_off(*off), proc_dir=tmp_path,
                                  force=True, progress=lambda *a: events.append(a))
    assert levels[nxt] == _LEVEL[source]
    assert not set(off) & set(levels)
    assert (nxt, "progress", None, notice) in events
    logs = load_delta_pdf(paths.delta_pdf, read_data=False).logs
    assert logs["source_file"] == paths.pdf_input.name


def test_invalid_force_from_raises(tmp_path):
    with pytest.raises(ValueError, match="force_from"):
        pipeline.run_pipeline(tmp_path / "x.nxs", proc_dir=tmp_path,
                              force_from="nonsense")


# ---------------------------------------------------------------------------
# real stage calls (backfill → flatten → pdf) on a small synthetic volume
# ---------------------------------------------------------------------------
def _punched_vol(shape=(21, 21, 21)):
    rng = np.random.default_rng(0)
    vol = HKLVolume.from_arrays(
        np.zeros(shape), (-3, 3), (-3, 3), (-3, 3), ub_matrix=UB)
    q = vol.q_magnitude()
    vol.data[...] = 5.0 * np.exp(-q / 3.0) + 0.5 + rng.normal(0, 0.02, shape)
    # punch a few interior holes (so q_shell backfill has shell neighbours)
    for idx in [(9, 9, 9), (10, 9, 8), (8, 11, 10), (11, 10, 9)]:
        vol.data[idx] = -99.0
        vol.mask[idx] = False
    return vol


def test_real_backfill_flatten_pdf_writes_viewer_schema(tmp_path):
    inp = tmp_path / "s.nxs"
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path)
    nebula3d.save(_punched_vol(), paths.braggpunched)

    params = pipeline.PipelineParams(
        delta_pdf=pipeline.DeltaPdfParams(apodization="hann", zero_pad=False,
                                          crop_hkl=None),
    )
    events = []
    pipeline.run_pipeline(inp, params, proc_dir=tmp_path,
                          stages=("backfill", "flatten", "pdf"),
                          progress=lambda *a: events.append(a))

    # backfill produced an all-finite volume
    filled = nebula3d.load(paths.backfilled)
    assert np.isfinite(filled.data).all()
    assert paths.flattened.exists()

    # ΔPDF written in the layout the viewers read (Mantid MDHistoWorkspace)
    assert nebula3d.is_mantid_nxs(paths.delta_pdf)
    pdf = load_delta_pdf(paths.delta_pdf)
    assert pdf.data.shape == (pdf.x_axis.size, pdf.y_axis.size, pdf.z_axis.size)
    assert pdf.logs["source_file"] == paths.flattened.name
    assert pdf.logs["apodization"] == "hann"
    assert pdf.cell == pytest.approx((4.0, 4.0, 4.0, 90.0, 90.0, 90.0))  # 2π/(2π/4)
    np.testing.assert_array_equal(pdf.ub_matrix, UB)

    # per-stage start/done events fired
    pairs = {(ev[0], ev[1]) for ev in events}
    for stage in ("backfill", "flatten", "pdf"):
        assert (stage, "start") in pairs
        assert (stage, "done") in pairs


def test_flatten_records_its_settings_in_its_output(tmp_path):
    """The flattened file says which flatten made it, so the floors after it
    can be measured on the run's own shells, percentile and fit range; the
    volume is the flatten's, and a file the flatten did not write reads None."""
    import dataclasses

    inp = tmp_path / "s.nxs"
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path)
    nebula3d.save(_punched_vol(), paths.backfilled)
    flat = pipeline.FlattenParams(floor_percentile=20.0, q2_term=True, fit_q_range=(1.0, 4.0))
    pipeline.run_pipeline(inp, pipeline.PipelineParams(flatten=flat), proc_dir=tmp_path,
                          stages=("flatten",))

    recorded = pipeline.read_flatten_settings(paths.flattened)
    assert recorded == json.loads(json.dumps(dataclasses.asdict(flat)))
    assert recorded["fit_q_range"] == [1.0, 4.0] and recorded["q2_term"] is True
    direct = pipeline.flatten(nebula3d.load(paths.backfilled), flat)
    assert np.array_equal(nebula3d.load(paths.flattened).data, direct.data)
    assert pipeline.read_flatten_settings(paths.backfilled) is None
    assert pipeline.read_flatten_settings(tmp_path / "missing.h5") is None


@pytest.mark.parametrize(("r2", "printed"), [
    (-2.2e-16, "R² 0.000"),  # a constant fit's 0, rounded below it
    (0.0, "R² 0.000"),
    (-4e-4, "R² 0.000"),     # rounds to zero: no sign either
    (-0.25, "R² -0.250"),    # a fit worse than the mean keeps its sign
    (0.9876, "R² 0.988"),
])
def test_the_flatten_summary_prints_a_zero_r2_without_a_sign(monkeypatch, r2, printed):
    """The summary gives the fit's R² to three decimals, and one that rounds
    to zero as 0.000, never -0.000. A constant fit's R² is 0 up to rounding,
    of either sign: on the parity volume the browser printed -0.000 where the
    native engine printed 0.000 (tests/test_native_browser_parity.py)."""
    from nebula3d.preprocessing import RadialFlattenResult

    vol = _vol()
    fit = RadialFlattenResult(
        volume=vol, q_grid=np.array([1.0]), bg_curve=np.array([0.5]),
        raw_levels=np.array([0.5]), counts=np.array([10]), estimator="model",
        model_coef=(0.5, 0.0), model_r2=r2)
    monkeypatch.setattr(pipeline, "flatten_radial_background", lambda *a, **k: fit)
    lines: list[str] = []
    pipeline.flatten(vol, progress=lambda stage, status, frac, msg: lines.append(msg))
    assert lines[-1] == f"background correction complete (const 0.5 + 0·F(Q)², {printed})"


def test_real_pdf_stale_guard_skips_on_rerun(tmp_path):
    inp = tmp_path / "s.nxs"
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path)
    nebula3d.save(_punched_vol(), paths.braggpunched)
    params = pipeline.PipelineParams(
        delta_pdf=pipeline.DeltaPdfParams(apodization="hann", zero_pad=False,
                                          crop_hkl=None),
    )
    kw = dict(proc_dir=tmp_path, stages=("backfill", "flatten", "pdf"))
    pipeline.run_pipeline(inp, params, **kw)

    events = []
    pipeline.run_pipeline(inp, params, progress=lambda *a: events.append(a), **kw)
    skipped = {ev[0] for ev in events if ev[1] == "skip"}
    assert {"backfill", "flatten", "pdf"} <= skipped


def test_real_pdf_older_than_its_input_is_recomputed(tmp_path):
    """A ΔPDF older than its input was made from what the input held before a
    stage upstream last ran (with the ΔPDF switched off then): same input name
    and settings, but stale — it is recomputed, never reused as current."""
    import os

    inp = tmp_path / "s.nxs"
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path)
    nebula3d.save(_punched_vol(), paths.braggpunched)
    params = pipeline.PipelineParams(
        delta_pdf=pipeline.DeltaPdfParams(apodization="hann", zero_pad=False,
                                          crop_hkl=None),
    )
    kw = dict(proc_dir=tmp_path, stages=("backfill", "flatten", "pdf"))
    pipeline.run_pipeline(inp, params, **kw)
    config = pipeline.delta_pdf_transform_config(params.delta_pdf)
    assert pipeline._pdf_is_current(paths.delta_pdf, paths.flattened.name, config,
                                    paths.flattened)

    # The flatten re-ran after the ΔPDF (the ΔPDF off): the ΔPDF is older.
    t = paths.flattened.stat().st_mtime
    os.utime(paths.delta_pdf, (t - 10, t - 10))
    assert not pipeline._pdf_is_current(paths.delta_pdf, paths.flattened.name, config,
                                        paths.flattened)
    events = []
    pipeline.run_pipeline(inp, params, progress=lambda *a: events.append(a), **kw)
    pdf = [(ev[1], ev[3]) for ev in events if ev[0] == "pdf"]
    assert ("skip", f"{paths.delta_pdf.name} is current") not in pdf
    assert ("progress", f"{paths.delta_pdf.name} stale — recomputing") in pdf
    assert paths.delta_pdf.stat().st_mtime >= paths.flattened.stat().st_mtime
    # Written after its input, it is current again; same-second dates count as current.
    events.clear()
    pipeline.run_pipeline(inp, params, progress=lambda *a: events.append(a), **kw)
    assert ("pdf", "skip") in {(ev[0], ev[1]) for ev in events}
    s = paths.flattened.stat().st_mtime
    os.utime(paths.delta_pdf, (s, s))
    assert pipeline._pdf_is_current(paths.delta_pdf, paths.flattened.name, config,
                                    paths.flattened)


def test_real_pdf_refuses_an_even_grid_after_the_cleanup_stages(tmp_path):
    """On an even grid Q = 0 falls between two voxels: the cleanup stages run and
    keep their outputs, and the ΔPDF stage refuses, naming the axes and the fix."""
    inp = tmp_path / "s.nxs"
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path)
    nebula3d.save(_punched_vol(shape=(20, 20, 20)), paths.braggpunched)
    params = pipeline.PipelineParams(
        delta_pdf=pipeline.DeltaPdfParams(apodization="hann", zero_pad=False,
                                          crop_hkl=None),
    )
    with pytest.raises(FFTOriginError, match="H has no bin centred at 0.*Re-bin"):
        pipeline.run_pipeline(inp, params, proc_dir=tmp_path,
                              stages=("backfill", "flatten", "pdf"))
    assert paths.backfilled.exists() and paths.flattened.exists()
    assert not paths.delta_pdf.exists()


def _diffuse_vol(n=15):
    """A clean centrosymmetric diffuse volume on an odd grid (exact round trip)."""
    vol = HKLVolume.from_arrays(
        np.zeros((n, n, n)), (-3, 3), (-3, 3), (-3, 3), ub_matrix=UB)
    vol.data[...] = 5.0 * np.exp(-vol.q_magnitude() / 2.0) + 1.0
    return vol


def test_real_pdf_check_roundtrip_metrics(tmp_path):
    """The real pdf_check stage inverts the ΔPDF and recovers the diffuse data."""
    import json

    inp = tmp_path / "s.nxs"
    params = pipeline.PipelineParams(
        flatten_enabled=False,
        delta_pdf=pipeline.DeltaPdfParams(apodization="gaussian", zero_pad=False,
                                          crop_hkl=None),
    )
    paths = pipeline.pipeline_paths(inp, proc_dir=tmp_path, flatten_enabled=False)
    nebula3d.save(_diffuse_vol(15), paths.backfilled)   # = pdf_input when flatten off

    events = []
    pipeline.run_pipeline(inp, params, proc_dir=tmp_path,
                          stages=("pdf", "pdf_check"),
                          progress=lambda *a: events.append(a))

    assert paths.pdf_check_json.exists()
    assert paths.pdf_check_png.exists()
    assert ("pdf_check", "done") in {(ev[0], ev[1]) for ev in events}
    metrics = json.loads(paths.pdf_check_json.read_text())
    assert metrics["pearson_r"] > 0.999        # gaussian window → near-exact
    assert metrics["normalized_rms"] < 1e-2


# ---------------------------------------------------------------------------
# the flatten off after a run with it on: the ΔPDF's input (known answers)
# ---------------------------------------------------------------------------
def _demo_input(tmp_path):
    from nebula3d.demo import demo_volume

    inp = tmp_path / "raw" / "synthetic_demo.nxs"
    inp.parent.mkdir()
    nebula3d.save(demo_volume(25), inp)
    return inp


def _transforms(paths, source):
    """The run's ΔPDF records *source* as its input and is, bit for bit, the
    pipeline's transform of that volume; its saved check is that volume's."""
    pdf = load_delta_pdf(paths.delta_pdf)
    assert pdf.logs["source_file"] == source.name
    direct = pipeline.delta_pdf(nebula3d.load(source), pipeline.DeltaPdfParams())
    np.testing.assert_array_equal(pdf.data, direct.data)
    check = json.loads(paths.pdf_check_json.read_text())
    want = pipeline.pdf_consistency_check(nebula3d.load(source), direct,
                                          pipeline.DeltaPdfParams())
    for key in ("pearson_r", "normalized_rms", "n_voxels"):
        assert check[key] == pytest.approx(want[key], rel=1e-12), key


@pytest.mark.parametrize("earlier", [None, "resume", "force"])
def test_the_flatten_off_transforms_the_runs_backfilled_volume(tmp_path, earlier):
    """With the flatten off the ΔPDF is the backfilled volume's: from scratch
    (as before the fix), and after a run with the flatten on, which leaves its
    flattened volume on disk (resumed or forced: before the fix the second run
    transformed that file, or kept the first run's ΔPDF as current)."""
    inp = _demo_input(tmp_path)
    proc = tmp_path / "processed"
    if earlier is not None:
        pipeline.run_pipeline(inp, proc_dir=proc)  # the flatten on
    paths = pipeline.pipeline_paths(inp, proc_dir=proc, flatten_enabled=False)
    left = paths.flattened.stat().st_mtime_ns if earlier is not None else None
    events = []
    pipeline.run_pipeline(inp, pipeline.PipelineParams(flatten_enabled=False),
                          proc_dir=proc, force=earlier == "force",
                          progress=lambda *a: events.append(a))

    _transforms(paths, paths.backfilled)
    assert ("pdf", "progress", None, _flatten_off_notice(paths)) in events
    if earlier is None:
        assert not paths.flattened.exists()
    else:  # the earlier run's flattened volume is left as it was
        assert paths.flattened.stat().st_mtime_ns == left


def test_the_flatten_on_transforms_its_flattened_volume_as_before(tmp_path):
    inp = _demo_input(tmp_path)
    events = []
    paths = pipeline.run_pipeline(inp, proc_dir=tmp_path / "processed",
                                  progress=lambda *a: events.append(a))
    _transforms(paths, paths.flattened)
    assert not any("background correction disabled" in e[3] for e in events)
