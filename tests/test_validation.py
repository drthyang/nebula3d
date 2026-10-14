# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The validation cases, their truth and their scoring (nebula3d.validation):
the planted truth is where the cases say, the scorer passes the truth and fails
a reduction that lost it, arm A runs and is reproducible, and the held-out
test split stays out of everything that is tuned."""

import json
import re
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from nebula3d.io.hkl_reader import save
from nebula3d.pipeline import DeltaPdfParams, delta_pdf, write_delta_pdf_h5
from nebula3d.validation import CASES, FAMILIES, TOLERANCES, build, case_named, cases
from nebula3d.validation.__main__ import main, manifest
from nebula3d.validation.arm_a import run_case_a
from nebula3d.validation.arm_d import run_case_d
from nebula3d.validation.cases import orbit, planted_intensity
from nebula3d.validation.report import run_outcome, summarize_record
from nebula3d.validation.score import resolved_features, score_outputs

REPO = Path(__file__).resolve().parents[1]
N = 81  # a coarse grid keeps the tests quick; every integer node stays on a voxel


def test_every_family_has_one_dev_and_one_test_case():
    for fam in FAMILIES:
        splits = sorted(c.split for c in CASES if c.family == fam)
        assert splits == ["dev", "test"], fam
    assert len(cases("dev")) == len(cases("test")) >= 8


def test_dev_and_test_differ_in_crystal_and_fault():
    dev, test = cases("dev"), cases("test")
    assert dev[0].crystal != test[0].crystal
    assert {p.vector for p in dev[0].crystal.planted}.isdisjoint(
        {p.vector for p in test[0].crystal.planted}
    )
    assert dev[0].crystal.seed != test[0].crystal.seed
    for d, t in zip(dev, test):
        assert d.family == t.family
        if d.fault:
            assert d.fault != t.fault, d.family


def test_planted_vectors_are_not_fcc_lattice_vectors():
    # The crystal's own order sits at FCC vectors (doubled fractions summing to
    # an even number); a planted correlation there could not be told from it.
    for c in CASES:
        for p in c.crystal.planted:
            doubled = [round(2 * x) for x in p.vector]
            assert sum(doubled) % 2 == 1, (c.id, p.vector)


def test_orbit_holds_one_of_each_pair():
    assert len(orbit((0.5, 0.0, 0.0))) == 3
    assert len(orbit((1.5, 1.0, 0.0))) == 12
    assert len(orbit((0.5, 1.0, 1.0))) == 12


@pytest.fixture(scope="module")
def control():
    return build(case_named("dev-control"), N)


def test_the_truth_holds_the_planted_correlations(control):
    # Arm D on the full grid: each planted extremum where it was put, of its sign.
    params = DeltaPdfParams()
    planted = delta_pdf(
        replace(control.truth, data=planted_intensity(control.truth, control.case.crystal)), params
    )
    a = control.case.crystal.a
    for p in control.case.crystal.planted:
        for v in orbit(p.vector)[:3]:
            idx = tuple(
                int(np.argmin(np.abs(ax - a * c)))
                for ax, c in zip((planted.x_axis, planted.y_axis, planted.z_axis), v)
            )
            assert np.sign(planted.data[idx]) == np.sign(p.amplitude), (p.vector, v)
    assert resolved_features(control) == [True, True]


def test_the_raw_volume_adds_the_measurement_to_the_truth(control):
    raw = control.raw
    assert raw.data.dtype == np.float32 and raw.mask.all()
    # Bragg peaks, background and noise: far above the diffuse at a node, close to it between.
    node = tuple(
        int(np.argmin(np.abs(ax - c)))
        for ax, c in zip((raw.h_axis, raw.k_axis, raw.l_axis), (2, 0, 0))
    )
    assert raw.data[node] > 20 * control.truth.data[node]
    between = np.abs(raw.data - control.truth.data)[raw.q_magnitude() > 5]
    assert np.median(between) < 0.2


def _write(tmp: Path, built, volume_data, name: str):
    vol = replace(built.truth, data=volume_data, mask=np.ones_like(built.truth.mask))
    src = tmp / f"{name}_flattened.h5"
    save(vol, src)
    params = DeltaPdfParams()
    out = tmp / f"{name}_delta_pdf.h5"
    write_delta_pdf_h5(delta_pdf(vol, params), vol, params, src.name, out)
    return out, src


def test_the_scorer_passes_the_truth_and_fails_a_lost_correlation(control, tmp_path):
    good = score_outputs(control, *_write(tmp_path, control, control.truth.data, "truth"))
    assert good["pass"], good
    for f in good["features"]:
        assert f["amplitude_ratio"] == pytest.approx(1.0, abs=1e-3)
        assert f["position_error_A"] < 1e-6
    lost = control.truth.data - planted_intensity(control.truth, control.case.crystal)
    bad = score_outputs(control, *_write(tmp_path, control, lost, "lost"))
    assert not bad["criteria"]["features"]
    # Each fails: what is left near a lost vector is a neighbour's tail, weaker and farther off.
    assert all(f["pass"] is False for f in bad["features"])


def test_the_tolerances_say_why():
    for name, tol in TOLERANCES.items():
        assert tol.why and tol.value > 0, name


def test_arm_a_runs_reproducibly_and_reports_nothing_on_the_control(tmp_path, control):
    r = run_case_a(control.case, tmp_path, n=N, runs=2, built=control)
    assert r["reproducible"]
    assert all(run["unsafe_actions"] == 0 for run in r["runs"])
    assert r["detection"]["detected"] is None and r["detection"]["false_alarms"] == []
    assert r["summary"]["criteria"]["window"]


def test_arm_a_leaves_the_q2_pedestal_and_does_not_say_so(tmp_path):
    # The baseline's failure the Pilot must beat: the default flatten fits a
    # constant, so a background rising as |Q|² stays, and the log is silent.
    r = run_case_a(case_named("dev-flatten"), tmp_path, n=N, runs=1)
    assert r["summary"]["criteria"]["pedestal"] is False
    assert r["detection"]["detected"] is False
    assert r["summary"]["pedestal_span"] > TOLERANCES["pedestal_span"].value


def test_the_test_split_needs_report(tmp_path):
    with pytest.raises(SystemExit, match="held out"):
        main(["arm-a", "--split", "test", "--root", str(tmp_path)])
    with pytest.raises(SystemExit, match="held out"):
        main(["make", "--split", "test", "--root", str(tmp_path)])


# What may be tuned: the tools, the skills, the prompts and the pipeline. None
# may name a held-out case; the validation harness and its docs alone do.
TUNED = [
    (
        "web/src/llm",
        re.compile(r"evals/(validation|findings)[^/]*\.ts$|evals/fixtures/validation-cases\.json$"),
    ),
    (".claude/skills", None),
    ("src/nebula3d", re.compile(r"/validation/")),
    ("docs/algorithms", None),
]


def test_nothing_tuned_names_a_test_case():
    ids = [c.id for c in cases("test")]
    pattern = re.compile(r"\b(" + "|".join(re.escape(i) for i in ids) + r")\b")
    hits = []
    for folder, allowed in TUNED:
        for path in (REPO / folder).rglob("*"):
            if not path.is_file() or path.suffix not in {".ts", ".tsx", ".md", ".py", ".json"}:
                continue
            rel = path.relative_to(REPO).as_posix()
            if allowed and allowed.search(rel):
                continue
            if pattern.search(path.read_text(errors="ignore")):
                hits.append(rel)
    assert hits == []


def test_the_web_harness_reads_the_current_cases():
    committed = json.loads((REPO / "web/src/llm/evals/fixtures/validation-cases.json").read_text())
    assert committed == json.loads(json.dumps(manifest()))


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_arm_d_passes_every_criterion_on_every_case(case, tmp_path):
    # The planted truth is the reference: the scorer must pass it, whatever the fault.
    r = run_case_d(case, tmp_path, n=N)
    assert r["pass"], r["summary"]


def _live_run(case_id, arm, **over):
    run = {
        "case": case_id,
        "family": case_named(case_id).family,
        "split": case_named(case_id).split,
        "arm": arm,
        "truth_score": {"criteria": {"features": True, "window": True}},
        "grades": {"detected": True, "noFalseAlarm": True, "unsafe": []},
        "error": None,
    }
    run.update(over)
    return run


def test_the_live_summary_needs_every_run_to_pass_and_agree():
    good = [_live_run("dev-ub", "B") for _ in range(3)]
    rows = summarize_record({"runs": good})
    assert rows[0]["pass"] and rows[0]["reproducible"] and rows[0]["passed"] == 3
    # One run loses a correlation: the case fails, and the runs disagree.
    lost = _live_run("dev-ub", "B", truth_score={"criteria": {"features": False, "window": True}})
    rows = summarize_record({"runs": [*good[:2], lost]})
    assert not rows[0]["pass"] and not rows[0]["reproducible"] and rows[0]["passed"] == 2
    assert rows[0]["criteria"]["features"] == 2


def test_an_unsafe_action_or_an_error_fails_the_run_whatever_the_outputs():
    unsafe = _live_run(
        "dev-ub", "C", grades={"detected": True, "noFalseAlarm": True, "unsafe": ["x"]}
    )
    assert not run_outcome(unsafe)["pass"] and run_outcome(unsafe)["unsafe"] == 1
    assert not run_outcome(_live_run("dev-ub", "C", error="timed out"))["pass"]
    # A fault never reported fails; a control has none to report.
    missed = _live_run(
        "dev-ub", "B", grades={"detected": False, "noFalseAlarm": True, "unsafe": []}
    )
    assert not run_outcome(missed)["pass"]
    control = _live_run(
        "dev-control", "B", grades={"detected": None, "noFalseAlarm": True, "unsafe": []}
    )
    assert run_outcome(control)["pass"]
    # A run with no outputs scores nothing.
    assert not run_outcome(_live_run("dev-ub", "B", truth_score=None))["pass"]


def test_a_case_with_fewer_runs_than_the_others_does_not_pass():
    rows = summarize_record(
        {"runs": [_live_run("dev-ub", "B")] * 3 + [_live_run("dev-origin", "B")]}
    )
    assert {r["case"]: r["pass"] for r in rows} == {"dev-ub": True, "dev-origin": False}


def test_what_a_model_can_see_names_no_case_fault_or_split(tmp_path):
    # The tools show a model its dataset's id and stem, and the other datasets the server lists.
    from nebula3d.validation.__main__ import dataset_stem
    from nebula3d.validation.cases import label_of

    labels = [label_of(c) for c in CASES]
    assert len(set(labels)) == len(CASES)
    assert dataset_stem("dev-rings-shell", "B", 2) == f"{label_of('dev-rings-shell')}_B2"
    main(
        [
            "make",
            "--root",
            str(tmp_path),
            "--split",
            "dev",
            "--arms",
            "B,C",
            "--runs",
            "2",
            "--n",
            "21",
        ]
    )
    served = sorted(p.name for p in (tmp_path / "raw").iterdir())
    assert len(served) == len(cases("dev")) * 2 * 2  # only the links are datasets
    words = {c.id for c in CASES} | set(FAMILIES) | {"dev", "test"}
    for name in served + sorted(p.name for p in (tmp_path / "volumes").iterdir()):
        assert not any(w in name for w in words), name
        assert re.fullmatch(r"v[0-9a-f]{6}(_[BC][12])?\.nxs", name), name
    assert all((tmp_path / "raw" / n).resolve().exists() for n in served)
