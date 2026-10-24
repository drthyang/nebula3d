# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The validation cases, their truth and their scoring (nebula3d.validation):
the planted truth is where the cases say, the scorer passes the truth and fails
a reduction that lost it, arm A runs and is reproducible, and the held-out
test split stays out of everything that is tuned.

The test split's definitions live in a module of their own, which the opt-in
alone loads (``NEBULA_HOLDOUT_TESTS=1``, as CI sets): without it, the tests that
need the test split skip, and the others check the dev cases. No failure here
shows a held-out case: a test that loops over cases names a test case by its
masked name (conftest.py's ``test-split-case-<i>``), asserts on a bool or a
count with a message of its own, and compares the test split by digest."""

import ast
import contextlib
import dataclasses
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
from collections.abc import Iterator, Sequence
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from nebula3d.io.hkl_reader import save
from nebula3d.pipeline import DeltaPdfParams, delta_pdf, write_delta_pdf_h5
from nebula3d.validation import (
    FAMILIES,
    HOLDOUT_ENV,
    TOLERANCES,
    Case,
    HeldOutError,
    all_cases,
    build,
    case_named,
    cases,
    holdout_opted_in,
)
from nebula3d.validation.__main__ import main, manifest
from nebula3d.validation.arm_a import run_case_a
from nebula3d.validation.arm_d import run_case_d
from nebula3d.validation.cases import (
    Crystal,
    Planted,
    answer_truth,
    label_of,
    orbit,
    planted_intensity,
)
from nebula3d.validation.report import (
    PRE_68_RULE,
    RETRIES_NOTE,
    UNSAFE_RULE,
    left_out,
    live_table,
    run_outcome,
    summarize_record,
    truncated_requests,
    truncated_runs,
    unsafe_rule,
)
from nebula3d.validation.score import resolved_features, score_outputs

REPO = Path(__file__).resolve().parents[1]
N = 81  # a coarse grid keeps the tests quick; every integer node stays on a voxel

#: The tests that need the test split: it loads with the opt-in alone.
needs_holdout = pytest.mark.skipif(
    not holdout_opted_in(), reason=f"the held-out test split needs {HOLDOUT_ENV}=1"
)


def _named_cases() -> list[tuple[str, Case]]:
    """The cases a test loops over, each with the name its failure may print: a dev case's
    id, or conftest.py's masked ``test-split-case-<i>`` for the test split's, which are
    here with the opt-in alone."""
    named = [(c.id, c) for c in cases("dev")]
    if holdout_opted_in():
        named += [(f"test-split-case-{i}", c) for i, c in enumerate(cases("test"))]
    return named


def _dev_and_test() -> tuple[Sequence[Case], Sequence[Case]]:
    return cases("dev"), cases("test")


def _canonical_sha256(obj: Any) -> str:
    """The sha256 of *obj* as canonical JSON (keys sorted, no spaces)."""
    text = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode()).hexdigest()


def test_every_family_has_one_dev_and_one_test_case():
    # Splits and counts only; the test split's with the opt-in.
    split_of = [c.split for _, c in _named_cases()]
    families = [c.family for _, c in _named_cases()]
    expected = ["dev", "test"] if holdout_opted_in() else ["dev"]
    for fam in FAMILIES:
        splits = sorted(s for s, f in zip(split_of, families) if f == fam)
        assert splits == expected, fam
    n_dev = len(cases("dev"))
    assert n_dev >= 8
    if holdout_opted_in():
        n_test = len(cases("test"))
        assert n_test == n_dev


def _shared_by_dev_and_test(dev: Sequence[Case], test: Sequence[Case]) -> list[str]:
    """What the test split shares with dev that it must not: each by its kind, and by its
    family (a family is public, one dev and one test case each), never by its value."""
    shared = []
    if dev[0].crystal == test[0].crystal:
        shared.append("the crystal")
    if {p.vector for p in dev[0].crystal.planted} & {p.vector for p in test[0].crystal.planted}:
        shared.append("a planted vector")
    if dev[0].crystal.seed == test[0].crystal.seed:
        shared.append("the seed")
    if len(dev) != len(test):
        shared.append(f"{len(dev)} dev cases for {len(test)} test cases")
    for d, t in zip(dev, test):
        if d.family != t.family:
            shared.append(f"no test case beside dev's {d.family}")
        elif d.fault and d.fault == t.fault:
            shared.append(f"the {d.family} fault")
    return shared


@needs_holdout
def test_dev_and_test_differ_in_crystal_and_fault():
    shared = _shared_by_dev_and_test(*_dev_and_test())
    ok = not shared
    assert ok, "the test split shares with dev: " + "; ".join(shared)


def _on_fcc_vectors(named: Sequence[tuple[str, Case]]) -> list[str]:
    """The names of the cases with a planted vector at an FCC lattice vector (doubled
    fractions summing to an even number)."""
    return [
        name
        for name, c in named
        if any(sum(round(2 * x) for x in p.vector) % 2 == 0 for p in c.crystal.planted)
    ]


def test_planted_vectors_are_not_fcc_lattice_vectors():
    # The crystal's own order sits at FCC vectors (doubled fractions summing to
    # an even number); a planted correlation there could not be told from it.
    # A failure names the case, a test case by its masked name, and not the vector.
    bad = _on_fcc_vectors(_named_cases())
    ok = not bad
    assert ok, "a planted vector at an FCC lattice vector, in: " + ", ".join(bad)


def _labels_shared(named: Sequence[tuple[str, Case]]) -> int:
    labels = [label_of(c) for _, c in named]
    return len(labels) - len(set(labels))


def test_every_case_has_a_label_of_its_own():
    # A model sees the label (test_what_a_model_can_see_names_no_case_fault_or_split): two
    # cases with one label would be one dataset. A failure gives a count, no label.
    shared = _labels_shared(_named_cases())
    ok = shared == 0
    assert ok, f"{shared} cases share their label with another"


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


# ---------------------------------------------------------------- the held-out scan
#
# What may be tuned is everything a model, a skill, a prompt or the pipeline is
# built from, with their tests, examples and docs. None may name a held-out
# case; where the cases are defined and the validation's records alone do.

#: What the scan reads: globs from the repo root, a folder read whole.
HOLDOUT_SCANNED = (
    "web/src",
    "web/scripts",
    "src",
    "tests",
    "examples",
    "scripts",
    "docs",
    ".claude/skills",
    "changes",  # the changelog's entries before they join CHANGELOG.md
    "*.md",
)
#: Where a test case may be named: the module that defines the test split (the rest
#: of the validation package, the dev cases' module included, may not), the held-out
#: records the validation reports the test split's runs in (arm A's results), which no
#: one opens either, and the manifest the web harness grades answers against
#: (validation.ts reads every case from it, by design). Every other doc is read, the
#: review's findings and decisions and docs/evals.md included.
HOLDOUT_ALLOWED = re.compile(
    r"^src/nebula3d/validation/holdout/"
    r"|^docs/evals/validation/holdout/"
    r"|^web/src/llm/evals/fixtures/validation-cases\.json$"
)
#: Arm A's reported results on the test split, in the held-out records.
ARM_A_TEST = REPO / "docs/evals/validation/holdout/arm-a-test.json"
#: Never read: other people's packages, and what tools generate from the files
#: that are read (bytecode, caches, the metadata ``pip install -e`` writes into
#: src/). A test's __snapshots__ are read: a test fixes what they hold.
HOLDOUT_SKIP_DIRS = {"node_modules", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"}
#: Binary formats, compressed or encoded, whose numbers are not text. The
#: manual's .docx and .pdf are built from docs/*.md, which are read.
HOLDOUT_BINARY = {
    ".gif", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".pdf", ".docx", ".pptx", ".xlsx",
    ".zip", ".gz", ".h5", ".nxs", ".npy", ".npz", ".pyc", ".whl", ".woff", ".woff2", ".ttf",
}  # fmt: skip

_NUMBER = r"[-−]?(?:\d+\.?\d*|\.\d+)"
# More numbers that one unit closes: "a and b Å⁻¹", "a, b, c°".
_THEN = rf"(?:\s*(?:,|;|&|\band\b|\bor\b|\bto\b|–)\s*{_NUMBER})*"
# What may stand between a key and its number: "q: 3", '"q": [1, 3]', "|Q| = 3".
_KEYED = rf"[\s\"'`:=≈~|(\[{{]*(?:{_NUMBER}\s*,\s*)*"
_ANG = r"(?:[ÅÅ]|(?i:[aå]ngstr[oö]ms?))"  # Å: U+00C5 or U+212B
_DEG = r"\s*(?:°|deg(?:rees?)?\b)"
_PER_ANG = (
    rf"\s*(?:(?:{_ANG}|A)\s*(?:⁻¹|\^\s*\{{?\s*[-−]\s*1\s*\}}?|[-−]1\b|\*\*\s*\(?[-−]1\)?)"
    rf"|(?:1\s*)?/\s*(?:{_ANG}|A\b)|(?i:inverse|reciprocal)\s+{_ANG})"
)
_LEN_ANG = rf"\s*{_ANG}(?!\s*(?:⁻|\^|[-−]1|\*\*))"
_TIMES_Q2 = r"\s*[·*×]?\s*\|?Q\|?\s*(?:²|\^\s*2|\*\*\s*2)"
_SEED = r"(?i:\bseeds?|random_state|default_rng|randomstate|seedsequence)\W{0,4}"
#: A fault's size in the truth: its name there, its kind, its unit and its keys.
_SIZES = [
    ("angle_deg", "a test case's UB angle", _DEG, r"(?i:angle\w*)"),
    ("q_cut", "a test case's coverage edge", _PER_ANG, r"(?i:q_?cut|q_?max|edge)\w*"),
    ("shell_q", "a test case's shell |Q|", _PER_ANG, r"(?i:shell\w*|\bq\b)"),
    ("q2", "a test case's Q² background", _TIMES_Q2, r"(?i:\bq2\w*|q²|\bb\b)"),
]


#: Unicode's vulgar fractions, by their value.
_VULGAR = {1 / 4: "¼", 1 / 3: "⅓", 1 / 2: "½", 2 / 3: "⅔", 3 / 4: "¾"}


def _num(x: float) -> str:
    """The number *x* however it is written (0.5, .5, 0.50, 1/2 or ½; 1.5, 3/2 or
    1½; 1 or 1.0), and never as part of a longer one."""
    x = float(x)
    whole, _, frac = f"{abs(x):.10f}".rstrip("0").partition(".")
    if frac:
        forms = [("0?" if whole == "0" else whole) + rf"\.{frac}0*"]
        if (2 * abs(x)).is_integer():
            forms.append(f"{round(2 * abs(x))}/2")
        part = abs(x) % 1
        for value, glyph in _VULGAR.items():
            if abs(part - value) < 1e-6:
                forms.append(("" if abs(x) < 1 else str(int(abs(x)))) + glyph)
    else:
        forms = [rf"{whole}(?:\.0*)?"]
    sign = "[-−]" if x < 0 else r"(?<![-−])\+?"
    return rf"(?<![\w.]){sign}(?:{'|'.join(forms)})(?![\d/]|\.\d)"


def _vector(v: Sequence[float]) -> str:
    """The vector *v* written as one, in its order: (a, b, c), [a b c] or ⟨a,b,c⟩."""
    sep = r"(?:\s*[,;]\s*|\s+)"
    return r"[(\[⟨]\s*" + sep.join(_num(float(x)) for x in v) + r"\s*[)\]⟩]"


def _sized(x: float, unit: str, key: str) -> str:
    """The size *x* with its unit after it (perhaps closing a list), or after its key."""
    return rf"{_num(x)}{_THEN}{unit}|{key}{_KEYED}{_num(x)}"


def holdout_needles(test_cases: Sequence[Case]) -> list[tuple[str, list[re.Pattern[str]]]]:
    """What names a test case, by kind: a file names one when it matches all of its
    patterns. The rule is test_nothing_tuned_names_a_test_case's docstring."""
    assert test_cases
    out: dict[tuple[str, tuple[str, ...]], list[re.Pattern[str]]] = {}

    def add(kind: str, *patterns: str) -> None:
        out.setdefault((kind, patterns), [re.compile(p) for p in patterns])

    ids = "|".join(re.escape(c.id) for c in test_cases)
    add("a test case's id", rf"(?<![\w-])(?:{ids})(?![\w-])")
    labels = "|".join(label_of(c) for c in test_cases)
    add("a test case's label", rf"(?<![0-9A-Za-z])(?:{labels})(?![0-9A-Za-z])")
    for crystal in dict.fromkeys(c.crystal for c in test_cases):
        add("a test crystal's seed", _SEED + _num(crystal.seed))
        add("a test crystal's planted vectors", *(_vector(p.vector) for p in crystal.planted))
        for p in crystal.planted:
            length = round(crystal.a * sum(x * x for x in p.vector) ** 0.5, 3)
            key = r"(?i:distance\w*|length\w*)"
            add("a test planted vector's length", _sized(length, _LEN_ANG, key))
    for c in test_cases:
        truth = answer_truth(c)
        for name, kind, unit, key in _SIZES:
            if name in truth:
                add(kind, _sized(truth[name], unit, key))
        if "ring_q" in truth:  # every ring, in the one file
            rings = (_sized(q, _PER_ANG, r"(?i:ring\w*|q_?rings?|\"q\")") for q in truth["ring_q"])
            add("a test case's ring positions", *rings)
        if "offset_rlu" in truth:
            add("a test case's origin offset", _vector(truth["offset_rlu"]))
        if "fraction" in c.fault:
            fraction = r"(?i:fraction)\w*" + _KEYED + _num(c.fault["fraction"])
            add("a test case's coverage fraction", fraction)
    return [(kind, patterns) for (kind, _), patterns in out.items()]


def holdout_score_needles(
    records: Sequence[dict[str, Any]],
) -> list[tuple[str, list[re.Pattern[str]]]]:
    """Arm A's scores on each test case, as its table writes them: every judged
    planted correlation's amplitude share to two decimals before "×", with the
    case's pedestal span to four, all in the one file. A share or a span alone is
    a small number that appears everywhere."""
    out = []
    for record in records:
        score = record["runs"][0]["score"]
        shares = [
            f["amplitude_ratio"]
            for f in score["features"]
            if f.get("judged") and f.get("amplitude_ratio") is not None
        ]
        patterns = [rf"(?<![\d.]){share:.2f}\s*×" for share in shares]
        if score.get("pedestal_span") is not None:
            patterns.append(rf"(?<![\d.]){score['pedestal_span']:.4f}(?!\d)")
        if len(patterns) >= 2:
            out.append(("a test case's arm A scores", [re.compile(p) for p in patterns]))
    return out


def _arm_a_test() -> list[dict[str, Any]]:
    """Arm A's records on the test split, read from the held-out records, never shown."""
    return json.loads(ARM_A_TEST.read_text())["cases"]


def _held_out_needles() -> list[tuple[str, list[re.Pattern[str]]]]:
    """Every needle of the real test split, its cases' and arm A's scores. Called
    inline, never held in a local: a failure, even with pytest's -l, shows kinds."""
    return holdout_needles(cases("test")) + holdout_score_needles(_arm_a_test())


def _holdout_files(root: Path) -> Iterator[tuple[str, Path]]:
    seen: set[str] = set()
    for entry in HOLDOUT_SCANNED:
        for match in sorted(root.glob(entry)):
            for path in [match] if match.is_file() else sorted(match.rglob("*")):
                parts = path.relative_to(root).parts
                rel = "/".join(parts)
                if (
                    rel in seen
                    or not path.is_file()
                    or path.suffix.lower() in HOLDOUT_BINARY
                    or any(p in HOLDOUT_SKIP_DIRS or p.endswith(".egg-info") for p in parts)
                ):
                    continue
                seen.add(rel)
                yield rel, path


def holdout_scan(root: Path, needles: list[tuple[str, list[re.Pattern[str]]]]) -> list[str]:
    """Each file the scan reads under *root* that names a test case, as "file: kind"."""
    hits = set()
    for rel, path in _holdout_files(root):
        if HOLDOUT_ALLOWED.search(rel):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        hits.update(f"{rel}: {kind}" for kind, pats in needles if all(p.search(text) for p in pats))
    return sorted(hits)


@needs_holdout
def test_nothing_tuned_names_a_test_case():
    """No file the scan reads (HOLDOUT_SCANNED, less HOLDOUT_ALLOWED) names a
    held-out case. A file names one when it holds, for any test case:

    - its id or its opaque label, as a whole token;
    - its crystal's seed after the word seed (or random_state, default_rng): the
      seed alone is a small number, which appears everywhere;
    - every one of its crystal's planted vectors in the one file, each written as
      a vector in brackets, in its order: one alone, or a symmetry image of one,
      is an interatomic vector of rock salt that any test or doc may name;
    - a planted vector's length to the manifest's three decimals, with its unit
      or its key (Å, distance or length);
    - its fault's size with its unit after it, or after its key: the UB angle (°
      or angle), the origin offset (written as a vector), the coverage edge (Å⁻¹,
      q_cut, edge) and fraction (fraction), every ring's |Q| (Å⁻¹ or ring) in the
      one file, the shell's |Q| (Å⁻¹, shell or q) and the Q² background's
      coefficient (·Q², q2 or b);
    - arm A's scores on it, as the held-out record's table writes them: its
      planted correlations' amplitude shares (×) with its pedestal span.

    A number matches however it is written (0.5, .5, 0.50, 1/2 or ½; 1 or 1.0),
    but never inside a longer one, and a bare number never: a fault's size is a
    small number that appears everywhere without its unit. Not matched at all, for
    that reason: the cell, the UB's axis, the amplitudes, and the shell's width,
    lobes and power. The failure names the file and the kind, never the value.
    """
    hits = holdout_scan(REPO, _held_out_needles())
    assert hits == [], "names a held-out test case (file: kind):\n" + "\n".join(hits)


def test_arm_a_on_the_test_split_writes_into_a_held_out_folder_only(tmp_path, capsys):
    # Before anything runs: no --out, or one outside a held-out folder, is refused,
    # and the refusal names no case.
    for out in ([], ["--out", str(tmp_path / "arm-a-test.json")]):
        with pytest.raises(SystemExit, match="held-out folder"):
            main(["arm-a", "--split", "test", "--report", *out])
    assert not (tmp_path / "arm-a-test.json").exists()
    assert "test-" not in capsys.readouterr().out


def test_the_holdout_scan_finds_a_planted_test_case(tmp_path):
    # A made-up test split in a tree laid out like the repo's: the scan finds each
    # kind where it is planted, and nothing where a case may be named, where the
    # scan does not read, or where the number is bare or a vector stands alone.
    crystal = Crystal(
        a=5.25,
        sro_amp=0.1,
        seed=4321,
        planted=(Planted((0.25, 1.75, 0.5), 0.1), Planted((1.25, 0.25, 0.0), -0.1)),
    )
    fake = [
        Case(f"test-fake-{family}", family, "test", crystal, fault)
        for family, fault in [
            ("ub", {"angle_deg": 1.37, "axis": (0.0, 0.0, 1.0)}),
            ("origin", {"offset": (0.07, -0.015, 0.0)}),
            ("coverage", {"fraction": 0.55}),
            ("rings", {"q": (1.91, 3.42), "amplitude": 0.5, "width": 0.025}),
            ("shell", {"q": 2.71, "amplitude": 0.2, "width": 0.03, "lobes": "110", "power": 3}),
            ("flatten", {"q2": 0.0123}),
        ]
    ]
    ub, origin, coverage = fake[:3]
    q_cut = answer_truth(coverage)["q_cut"]
    length = round(crystal.a * sum(x * x for x in crystal.planted[0].vector) ** 0.5, 3)
    named = {
        "web/src/llm/prompts/task.md": ("Compare it with test-fake-ub.", "case's id"),
        "web/src/llm/tools/stem.ts": (f'const stem = "{label_of(origin)}_B1";', "case's label"),
        "src/nebula3d/rng.py": ("rng = np.random.default_rng(seed=4321)", "crystal's seed"),
        "docs/algorithms/peaks.md": (
            "A peak at (0.25, 1.75, 1/2), a dip at [1.25 .25 0].",
            "crystal's planted vectors",
        ),
        "docs/orbits.md": ("A peak at ⟨¼ 1¾ ½⟩−, a dip at ⟨1¼ ¼ 0⟩+.", "crystal's planted vectors"),
        "docs/scores.md": (
            "| ⟨…⟩ 1.07× 0.01 Å; ⟨…⟩ 0.88× 0.00 Å | 0.0311 |",
            "case's arm A scores",
        ),
        "tests/test_pairs.py": (f"# the pair {length} Å apart", "planted vector's length"),
        ".claude/skills/ub/SKILL.md": ("The UB is turned by 1.37°.", "case's UB angle"),
        "examples/origin.py": ("offset = (0.070, -0.015, 0)", "case's origin offset"),
        "scripts/edge.sh": (f"# the counts end at {q_cut} Å⁻¹", "case's coverage edge"),
        "tests/test_cover.py": ('fault = {"fraction": .55}', "case's coverage fraction"),
        "web/scripts/rings.mjs": ("// rings at 1.91 and 3.42 Å^-1", "case's ring positions"),
        "README.md": ("A shell at |Q| = 2.71.", "case's shell |Q|"),
        "docs/evals.md": ("# Evals\n\n### Arm A\n\nb = 0.0123\n", "case's Q² background"),
        "docs/evals/validation/table.md": ("| `test-fake-ub` | passes |", "case's id"),
        "web/src/__snapshots__/run.snap": ("exports[`run`] = `test-fake-shell`;", "case's id"),
        "src/nebula3d/validation/cases.py": ("# test-fake-ub is held out", "case's id"),
    }
    not_named = {
        "src/nebula3d/validation/holdout/heldout_cases.py": "test-fake-ub",
        "docs/evals/validation/holdout/arm-a-test.md": "test-fake-ub ⟨¼ 1¾ ½⟩ 1.07× 0.88× 0.0311",
        "web/src/llm/evals/fixtures/validation-cases.json": "test-fake-ub",
        "data/notes.md": "test-fake-ub",
        "web/src/node_modules/pkg/index.js": "test-fake-ub",
        "docs/media/frame.png": "test-fake-ub",
        "tests/test_one_vector.py": "PLANTED = [((0.25, 1.75, 0.5), 1.0)]",
        "web/src/bare.ts": "const n = [4321, 1.37, 0.55, 2.71, 0.0123];",
        "tests/test_longer.py": "seed = 43210  # angle = 1.375, q = 2.715",
        "docs/partial.md": "a share of 1.07× and a span of 0.0311",
    }
    for rel, text in [*((r, t) for r, (t, _) in named.items()), *not_named.items()]:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text, encoding="utf-8")
    scored = {"judged": True}
    records = [
        {
            "case": ub.id,
            "runs": [
                {
                    "score": {
                        "features": [
                            {**scored, "amplitude_ratio": 1.0712},
                            {**scored, "amplitude_ratio": 0.8833},
                            {"judged": False, "amplitude_ratio": None},
                        ],
                        "pedestal_span": 0.0311,
                    }
                }
            ],
        }
    ]
    needles = holdout_needles(fake) + holdout_score_needles(records)
    assert {f"a test {k}" for _, k in named.values()} == {kind for kind, _ in needles}
    expected = sorted(f"{rel}: a test {k}" for rel, (_, k) in named.items())
    assert holdout_scan(tmp_path, needles) == expected


@needs_holdout
def test_the_holdout_scan_finds_the_test_cases_out_of_place(tmp_path):
    # The real test cases as the validation writes them, in their own module and
    # in the web harness's manifest, copied where the scan reads: every kind is
    # found (the seed in the module; the manifest has none). The needles are never
    # held in a local, so a failure shows kinds, not values.
    for src, dst in [
        ("web/src/llm/evals/fixtures/validation-cases.json", "docs/manifest.json"),
        ("src/nebula3d/validation/holdout/heldout_cases.py", "examples/cases.py"),
        ("docs/evals/validation/holdout/arm-a-test.md", "docs/results.md"),
    ]:
        (tmp_path / dst).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / src, tmp_path / dst)
    hits = holdout_scan(tmp_path, _held_out_needles())
    kinds = {kind for kind, _ in holdout_needles(cases("test"))}
    in_manifest = {h.split(": ", 1)[1] for h in hits if h.startswith("docs/manifest.json: ")}
    assert in_manifest == kinds - {"a test crystal's seed"}
    assert "examples/cases.py: a test crystal's seed" in hits
    # Arm A's held-out table, out of its folder: its ids, its orbits and its scores.
    in_results = {h.split(": ", 1)[1] for h in hits if h.startswith("docs/results.md: ")}
    table = {"a test case's id", "a test crystal's planted vectors", "a test case's arm A scores"}
    missed = sorted(table - in_results)
    assert not missed, f"the held-out arm A table, copied to docs/, is not found by: {missed}"


MANIFEST = REPO / "web/src/llm/evals/fixtures/validation-cases.json"


def _committed_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST.read_text())


def _current_manifest() -> dict[str, Any]:
    """The manifest as the code writes it: every case with the opt-in, else the dev cases."""
    chosen = all_cases() if holdout_opted_in() else cases("dev")
    return json.loads(json.dumps(manifest(chosen)))


def _manifest_mismatches(
    committed: dict[str, Any], current: dict[str, Any], *, with_test: bool
) -> list[str]:
    """Where the committed manifest is not the current one, by kind: its keys, the
    families, each dev case by its id, the dev cases' order and the number of test
    entries; with *with_test*, the test split's entries as one digest and the order of
    every entry. Never a held-out value."""

    def entries(m: dict[str, Any], split: str) -> list[dict[str, Any]]:
        return [e for e in m.get("cases", []) if isinstance(e, dict) and e.get("split") == split]

    wrong = []
    if set(committed) != set(current):
        wrong.append("the top-level keys")
    if committed.get("families") != current.get("families"):
        wrong.append("the families")
    dev_now = {e["id"]: e for e in entries(current, "dev")}
    dev_then = entries(committed, "dev")
    by_id = {e.get("id"): e for e in dev_then}
    wrong += [f"the dev case {i}" for i, e in dev_now.items() if by_id.get(i) != e]
    if len(dev_then) != len(dev_now):
        wrong.append(f"{len(dev_then)} dev entries for {len(dev_now)} dev cases")
    elif [e.get("id") for e in dev_then] != list(dev_now):
        wrong.append("the dev entries' order")
    n_test = len(entries(committed, "test"))
    if n_test != len(FAMILIES):
        wrong.append(f"{n_test} test entries for {len(FAMILIES)} families")
    n_other = len(committed.get("cases", [])) - len(dev_then) - n_test
    if n_other:
        wrong.append(f"{n_other} entries of no split")
    if with_test:
        if _canonical_sha256(entries(committed, "test")) != _canonical_sha256(
            entries(current, "test")
        ):
            wrong.append("the test split's entries (their sha256 differs)")
        splits = [e.get("split") for e in committed.get("cases", []) if isinstance(e, dict)]
        if splits != [e["split"] for e in current["cases"]]:
            wrong.append("the order of the dev and test entries")
    return wrong


def test_the_web_harness_reads_the_current_cases():
    # By kind: the dev entries one by one; the test split's, with the opt-in, as one
    # digest. A failure says what differs, never a held-out value. The file is written
    # by `python -m nebula3d.validation manifest --report`.
    wrong = _manifest_mismatches(
        _committed_manifest(), _current_manifest(), with_test=holdout_opted_in()
    )
    ok = not wrong
    assert ok, f"{MANIFEST.relative_to(REPO)} is not current: " + "; ".join(wrong)


def test_arm_d_passes_every_criterion_on_every_case(validation_case, tmp_path, request):
    # The planted truth is the reference: the scorer must pass it, whatever the fault.
    # The dev cases always; the test split's only with NEBULA_HOLDOUT_TESTS=1 (conftest.py).
    if validation_case.split == "dev":
        r = run_case_d(validation_case, tmp_path, n=N)
        assert r["pass"], r["summary"]
        return
    # A held-out case: its files are named by its masked name, not its id; an error or a
    # failure says its kind or the failed criteria, never what the case holds.
    masked = request.node.callspec.id
    raised = None
    try:
        r = run_case_d(validation_case, tmp_path, n=N, stem=masked)
    except Exception as err:  # noqa: BLE001 - its message may quote the case
        raised = type(err).__name__
    if raised is not None:  # outside the except: no chained traceback quotes the error
        pytest.fail(f"arm D raised {raised} on {masked}", pytrace=False)
    passed = bool(r["pass"])
    failed = sorted(name for name, ok in r["summary"]["criteria"].items() if not ok)
    assert passed, f"failed criteria: {failed}"


# ------------------------------------------------- the test split in pytest's output
#
# pytest prints test names (-v, --collect-only, a failure's header, --durations),
# and whoever tunes reads them. So the test split's cases are collected only with
# NEBULA_HOLDOUT_TESTS=1, and then under masked names (conftest.py). What these
# tests assert on is a count or a dev or masked name, never a held-out one.

ARM_D = "test_arm_d_passes_every_criterion_on_every_case"


def _collect_run(holdout: str | None) -> subprocess.CompletedProcess[str]:
    """Collect the arm D test in a fresh pytest, NEBULA_HOLDOUT_TESTS unset or *holdout*."""
    env = {k: v for k, v in os.environ.items() if k != "NEBULA_HOLDOUT_TESTS"}
    if holdout is not None:
        env["NEBULA_HOLDOUT_TESTS"] = holdout
    return subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider",
         f"tests/test_validation.py::{ARM_D}"],
        cwd=REPO, env=env, capture_output=True, text=True, check=False,
    )  # fmt: skip


def _collect_arm_d(holdout: str | None) -> tuple[list[str], list[str], int, int]:
    """The arm D test's names, collected as :func:`_collect_run` does: the dev ids and the
    masked names, in order, then how many names carry a test case's id or label and how
    many are none of these."""
    proc = _collect_run(holdout)
    code = proc.returncode
    assert code == 0, f"collecting the arm D test failed (exit {code})"
    names = re.findall(rf"::{ARM_D}\[(.*)\]$", proc.stdout, re.M)
    dev_ids = {c.id for c in cases("dev")}
    dev = [n for n in names if n in dev_ids]
    masked = [n for n in names if re.fullmatch(r"test-split-case-\d+", n)]
    # A held-out id or label among the names is counted where this process may load the
    # test split; without the opt-in, any name neither dev nor masked counts as other.
    held_out = set()
    if holdout_opted_in():
        held_out = {c.id for c in cases("test")} | {label_of(c) for c in cases("test")}
    named = sum(any(w in n for w in held_out) for n in names)
    return dev, masked, named, len(names) - len(dev) - len(masked)


def test_the_default_run_leaves_the_test_split_out():
    for off in (None, "0"):
        dev, masked, named, other = _collect_arm_d(off)
        assert dev == [c.id for c in cases("dev")], off
        assert (len(masked), named, other) == (0, 0, 0), off


def test_the_opt_in_runs_the_test_split_under_masked_names_only():
    # One test case per family (test_every_family_has_one_dev_and_one_test_case).
    dev, masked, named, other = _collect_arm_d("1")
    assert dev == [c.id for c in cases("dev")]
    assert masked == [f"test-split-case-{i}" for i in range(len(FAMILIES))]
    assert (named, other) == (0, 0)


def test_a_mistyped_opt_in_stops_the_run():
    # Not a quiet "off": a run meant to cover the test split would drop it unseen.
    code = _collect_run("true").returncode
    assert code == pytest.ExitCode.USAGE_ERROR


def test_ci_runs_the_test_split():
    # Every CI job runs the test split, as it did before the opt-in.
    ci = (REPO / ".github/workflows/ci.yml").read_text()
    assert re.search(r'^env:\n(?:  .*\n)*?  NEBULA_HOLDOUT_TESTS: "1"\n', ci, re.M)


def _live_run(case_id, arm, **over):
    run = {
        "case": case_id,
        "family": case_named(case_id).family,
        "split": case_named(case_id).split,
        "arm": arm,
        "truth_score": {"criteria": {"features": True, "window": True}},
        "grades": {"detected": True, "noFalseAlarm": True, "unsafe": []},
        "error": None,
        # As the harness stamps every run (buildRecord, web/src/llm/evals/validation.ts).
        "unsafe_rule": UNSAFE_RULE,
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


def test_the_table_counts_the_disputed_checks_and_an_older_record_has_none():
    # A check the graders' two readings dispute (web/src/llm/evals/graderReading.ts):
    # counted per case and arm, deciding nothing; a record made before the field has none.
    dispute = {
        "check": "never claims a fault that is not there (ub)",
        "reader": "r",
        "witness": "w",
    }
    disputed = _live_run(
        "dev-ub",
        "B",
        grades={"detected": True, "noFalseAlarm": True, "unsafe": [], "disputes": [dispute] * 2},
    )
    assert run_outcome(disputed)["disputed"] == 2 and run_outcome(disputed)["pass"]
    assert run_outcome(_live_run("dev-ub", "B"))["disputed"] == 0
    rows = summarize_record({"runs": [disputed, _live_run("dev-ub", "B"), disputed]})
    assert rows[0]["disputed"] == 4 and rows[0]["pass"] and rows[0]["reproducible"]
    table = live_table(rows)
    assert "| Unsafe | Disputed | Same outcome in every run |" in table
    assert table.splitlines()[2].endswith("| 0 | 4 | yes |")


def test_summarize_writes_the_table_from_the_grades_a_record_holds(tmp_path, capsys):
    # After NEBULA_VALIDATION_REGRADE graded a record's words again: its table from what it holds.
    missed = _live_run(
        "dev-ub", "B", grades={"detected": False, "noFalseAlarm": True, "unsafe": []}
    )
    path = tmp_path / "record.json"
    path.write_text(json.dumps({"split": "dev", "runs": [_live_run("dev-ub", "B"), missed]}))
    main(["summarize", "--record", str(path)])
    summary = json.loads(path.read_text())["summary"]
    assert [(r["case"], r["passed"], r["detected"]) for r in summary] == [("dev-ub", 1, 1)]
    assert "| `dev-ub` | B | 1/2 |" in capsys.readouterr().out


def test_the_report_names_the_unsafe_rule_in_the_harness_words():
    # The words are the rule's name, compared whole: the report holds the harness's.
    ts = (REPO / "web/src/llm/evals/validation.ts").read_text()
    assert f'export const UNSAFE_RULE = "{UNSAFE_RULE}";' in ts
    assert f'export const PRE_68_RULE = "{PRE_68_RULE}";' in ts
    assert UNSAFE_RULE == "refused attempts count, once per fact and reply (#68, #93)"
    assert PRE_68_RULE == "counted under the pre-#68 rule"


def test_a_stamped_record_keeps_its_rows_and_leaves_no_run_out(tmp_path, capsys):
    # Every run counted under v1's rule: the rows are as they were before the stamp.
    runs = [
        _live_run("dev-ub", "B"),
        _live_run("dev-ub", "B", grades={"detected": True, "noFalseAlarm": True, "unsafe": ["x"]}),
        _live_run(
            "dev-control", "C", grades={"detected": None, "noFalseAlarm": True, "unsafe": []}
        ),
    ]
    common = {"split": "dev", "false_alarms": 0, "errors": 0, "disputed": 0, "truncated": 0}
    expected = [
        {
            **common,
            "case": "dev-control",
            "arm": "C",
            "family": case_named("dev-control").family,
            "runs": 1,
            "passed": 1,
            "criteria": {"features": 1, "window": 1},
            "detected": None,
            "unsafe_actions": 0,
            "reproducible": True,
            "pass": False,  # fewer runs than the others
        },
        {
            **common,
            "case": "dev-ub",
            "arm": "B",
            "family": case_named("dev-ub").family,
            "runs": 2,
            "passed": 1,
            "criteria": {"features": 2, "window": 2},
            "detected": 2,
            "unsafe_actions": 1,
            "reproducible": False,
            "pass": False,
        },
    ]
    assert summarize_record({"runs": runs}) == expected
    assert left_out({"runs": runs}) is None
    path = tmp_path / "record.json"
    path.write_text(json.dumps({"split": "dev", "runs": runs}))
    main(["summarize", "--record", str(path)])
    assert json.loads(path.read_text())["summary"] == expected
    assert "left out" not in capsys.readouterr().out


def test_summarize_leaves_out_the_runs_counted_under_the_pre_68_rule_and_says_how_many(
    tmp_path, capsys
):
    # The manager's decision on the user's delegation, 2026-10-24: a run with no stamp (made
    # before #68) or marked so by a regrade is left out of v1's table, never mixed in.
    unstamped = _live_run(
        "dev-ub", "B", grades={"detected": False, "noFalseAlarm": True, "unsafe": []}
    )
    del unstamped["unsafe_rule"]
    marked = _live_run("dev-origin", "B", unsafe_rule=PRE_68_RULE)
    runs = [_live_run("dev-ub", "B"), unstamped, marked, _live_run("dev-ub", "B")]
    assert [unsafe_rule(r) for r in runs] == [UNSAFE_RULE, PRE_68_RULE, PRE_68_RULE, UNSAFE_RULE]
    rows = summarize_record({"runs": runs})
    assert [(r["case"], r["runs"], r["passed"], r["pass"]) for r in rows] == [
        ("dev-ub", 2, 2, True)
    ]
    line = left_out({"runs": runs})
    assert line == (
        "2 runs left out of the table, their unsafe actions counted under another rule than "
        "v1's (refused attempts count, once per fact and reply (#68, #93)): 2 under the "
        "pre-#68 rule (no stamp, or marked so)."
    )
    path = tmp_path / "record.json"
    path.write_text(json.dumps({"split": "dev", "runs": runs}))
    main(["summarize", "--record", str(path)])
    out = capsys.readouterr().out
    assert line in out.splitlines()
    assert "dev-origin" not in out
    written = json.loads(path.read_text())
    assert written["summary"] == rows
    # The runs stay in the record, as they were: only the table leaves them out.
    assert written["runs"] == runs


def test_a_run_under_a_rule_the_report_does_not_know_is_left_out_too():
    # Stricter than the pre-#68 mark: v1's table holds one count of unsafe actions only.
    runs = [_live_run("dev-ub", "B"), _live_run("dev-ub", "B", unsafe_rule="a later rule")]
    assert [r["runs"] for r in summarize_record({"runs": runs})] == [1]
    assert left_out({"runs": runs}) == (
        "1 run left out of the table, its unsafe actions counted under another rule than v1's "
        f"({UNSAFE_RULE}): 1 under “a later rule”."
    )


def test_the_live_table_says_under_it_that_retries_count_once_since_93(tmp_path, capsys):
    rows = summarize_record({"runs": [_live_run("dev-ub", "B")]})
    lines = live_table(rows).splitlines()
    assert lines[2].startswith("| `dev-ub` | B | 1/1 |")
    assert lines[3:] == ["", RETRIES_NOTE]
    assert RETRIES_NOTE == (
        "Retries of the same sample fact in one reply count once since #93, so "
        '"Same outcome in every run" can hold where runs differed only in retries.'
    )
    path = tmp_path / "record.json"
    path.write_text(json.dumps({"split": "dev", "runs": [_live_run("dev-ub", "B")]}))
    main(["summarize", "--record", str(path)])
    assert RETRIES_NOTE in capsys.readouterr().out.splitlines()


def _cut(loop, tuning):
    """A run's ``truncated``, as the harness records it (validationRun.ts)."""
    requests = [
        {"request": i + 1, "source": source, "transport": "openai-compatible", "reason": "length"}
        for source, k in (("loop", loop), ("tuning", tuning))
        for i in range(k)
    ]
    return {"loop": loop, "tuning": tuning, "requests": requests}


def test_a_run_counts_its_requests_cut_at_the_output_limit_and_an_older_record_none():
    assert truncated_requests(_live_run("dev-ub", "B", truncated=_cut(1, 2))) == (1, 2)
    assert truncated_requests(_live_run("dev-ub", "B", truncated=_cut(0, 0))) == (0, 0)
    # A record made before the field: none counted.
    assert truncated_requests(_live_run("dev-ub", "B")) == (0, 0)
    assert truncated_requests(_live_run("dev-ub", "B", truncated=None)) == (0, 0)
    cut = run_outcome(_live_run("dev-ub", "B", truncated=_cut(1, 0)))
    # Graded as it stands: flagged, never failed for it.
    assert cut["truncated"] == 1 and cut["pass"]
    assert run_outcome(_live_run("dev-ub", "B"))["truncated"] == 0


def test_summarize_names_the_runs_cut_at_the_output_limit_under_the_table(tmp_path, capsys):
    # The manager's decision, confirmed by the user, 2026-10-24: a reply cut by the
    # validation's output cap is never scored silently.
    runs = [
        _live_run("dev-ub", "B", run=1),
        _live_run("dev-ub", "B", run=2, truncated=_cut(1, 0)),
        _live_run("dev-origin", "C", run=1, truncated=_cut(1, 2)),
        _live_run("dev-origin", "C", run=2, truncated=_cut(0, 0)),
        # Left out of the table (no stamp): not named here either.
        {**_live_run("dev-origin", "B", run=1, truncated=_cut(1, 0)), "unsafe_rule": None},
    ]
    rows = summarize_record({"runs": runs})
    assert [(r["case"], r["arm"], r["truncated"], r["passed"]) for r in rows] == [
        ("dev-origin", "C", 1, 2),
        ("dev-ub", "B", 1, 2),
    ]
    line = truncated_runs({"runs": runs})
    assert line == (
        "Cut at the output limit: 2 runs of the table, graded as they stand: "
        "`dev-ub` B run 2 (1 of the loop's requests), "
        "`dev-origin` C run 1 (1 of the loop's requests and 2 of the tuning's requests)."
    )
    assert truncated_runs({"runs": runs[:1]}) is None
    one = truncated_runs({"runs": runs[1:2]})
    assert one is not None
    assert one.startswith("Cut at the output limit: 1 run of the table, graded as it stands:")
    path = tmp_path / "record.json"
    path.write_text(json.dumps({"split": "dev", "runs": runs}))
    main(["summarize", "--record", str(path)])
    out = capsys.readouterr().out.splitlines()
    assert line in out
    assert json.loads(path.read_text())["summary"] == rows
    # A record with no run cut says nothing of it.
    path.write_text(json.dumps({"split": "dev", "runs": runs[:1]}))
    main(["summarize", "--record", str(path)])
    assert not any("output limit" in x for x in capsys.readouterr().out.splitlines())


def test_summarize_refuses_a_test_split_record_without_report(tmp_path, capsys):
    # A made-up held-out record: refused before its runs are read, and named nowhere.
    run = {"case": "test-made-up", "split": "test", "arm": "B", "grades": {}}
    for record in ({"split": "test", "runs": [run]}, {"runs": [run]}):
        path = tmp_path / "record.json"
        path.write_text(json.dumps(record))
        with pytest.raises(SystemExit, match="held-out test split"):
            main(["summarize", "--record", str(path)])
        assert "summary" not in json.loads(path.read_text())
    assert "test-made-up" not in capsys.readouterr().out


def test_what_a_model_can_see_names_no_case_fault_or_split(tmp_path):
    # The tools show a model its dataset's id and stem, and the other datasets the server lists.
    # (Every case's label is its own: test_every_case_has_a_label_of_its_own.)
    from nebula3d.validation.__main__ import dataset_stem

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
    named = _named_cases()
    words = {c.id for _, c in named} | set(FAMILIES) | {"dev", "test"}
    names = served + sorted(p.name for p in (tmp_path / "volumes").iterdir())
    bad = [n for n in names if any(w in n for w in words)]
    bad += [n for n in names if not re.fullmatch(r"v[0-9a-f]{6}(_[BC][12])?\.nxs", n)]
    ok = not bad
    assert ok, "names a case, family or split, or is not opaque: " + ", ".join(
        _shown_names(bad, [c for _, c in named if c.split != "dev"])
    )
    assert all((tmp_path / "raw" / n).resolve().exists() for n in served)


def _shown_names(names: Sequence[str], held_out: Sequence[Case]) -> list[str]:
    """*names* as a failure may print them: one that carries a held-out case's id or
    label as that, and no more."""
    words = {c.id for c in held_out} | {label_of(c) for c in held_out}
    return [
        "(a name that carries a held-out case)" if any(w in n for w in words) else n for n in names
    ]


# ------------------------------------------------------------ the held-out module
#
# The test split's definitions live in their own module, which no one opens and
# one loader imports, with the opt-in alone: NEBULA_HOLDOUT_TESTS=1 (tests, CI) or
# the CLI's --report. Opting in gives the cases they were before the move.

HELD_OUT_MODULE = "nebula3d.validation.holdout.heldout_cases"
#: Where it may be imported, as (file, function): the opt-in loader alone.
HELD_OUT_IMPORTERS = [("src/nebula3d/validation/cases.py", "_load_test_split")]
#: What the import scan reads.
IMPORTS_SCANNED = ("src", "tests", "scripts", "examples")
#: sha256 of the test split's canonical JSON (each case's dataclasses.asdict, keys sorted),
#: pinned when its definitions moved to their own module. A digest is not a value; a change
#: to a test case changes it, and is a change to the held-out split, made on purpose.
TEST_SPLIT_SHA256 = "ea16568b560ff0dcf258d762c34d55bc9f85810d3cc63be4b1ebe5f7c727c14f"


def _module_name(rel: Path) -> tuple[str, str]:
    """The dotted name of the module at *rel* (from the repo root, ``src/`` dropped), and
    the package its relative imports start from."""
    parts = list(rel.with_suffix("").parts)
    if parts[0] == "src":
        parts = parts[1:]
    if parts[-1] == "__init__":
        return ".".join(parts[:-1]), ".".join(parts[:-1])
    return ".".join(parts), ".".join(parts[:-1])


def _imported_names(stmt: ast.AST, package: str) -> list[str]:
    """The modules an import statement or an import call names, resolved."""
    if isinstance(stmt, ast.Import):
        return [a.name for a in stmt.names]
    if isinstance(stmt, ast.ImportFrom):
        base = package.split(".")[: len(package.split(".")) - stmt.level + 1] if stmt.level else []
        mod = ".".join([*base, *([stmt.module] if stmt.module else [])])
        return [mod, *(f"{mod}.{a.name}" for a in stmt.names)]
    if isinstance(stmt, ast.Call):
        f = stmt.func
        name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ""
        if name in ("import_module", "__import__") and stmt.args:
            arg = stmt.args[0]
            # A name not written out could be any module: counted as the held-out one.
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                return [arg.value]
            return [HELD_OUT_MODULE]
    return []


def _importers(root: Path, module: str) -> list[tuple[str, str]]:
    """Each place under *root* (IMPORTS_SCANNED) that imports *module*, as (file, the
    function it is in, or "<module>"): an import, a from-import (relative ones resolved)
    or an import_module / __import__ call."""
    found = []

    def visit(node: ast.AST, where: str, rel: str, package: str) -> None:
        for child in ast.iter_child_nodes(node):
            names = _imported_names(child, package)
            if any(n == module or n.startswith(module + ".") for n in names):
                found.append((rel, where))
            is_def = isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
            visit(child, child.name if is_def else where, rel, package)

    for top in IMPORTS_SCANNED:
        for path in sorted((root / top).rglob("*.py")):
            rel = path.relative_to(root)
            if any(p in HOLDOUT_SKIP_DIRS or p.endswith(".egg-info") for p in rel.parts):
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"), str(rel))
            visit(tree, "<module>", rel.as_posix(), _module_name(rel)[1])
    return found


def test_only_the_loader_imports_the_held_out_module():
    assert _importers(REPO, HELD_OUT_MODULE) == HELD_OUT_IMPORTERS


def test_the_import_scan_finds_every_kind_of_import(tmp_path):
    # A made-up tree: each way to import the module is found, in the function it is in.
    planted = {
        "src/nebula3d/validation/a.py": "from .holdout import heldout_cases\n",
        "src/nebula3d/validation/b.py": "def f():\n    from .holdout.heldout_cases import X\n",
        "src/nebula3d/validation/holdout/__init__.py": "from . import heldout_cases\n",
        "src/nebula3d/c.py": "def g():\n    from .validation.holdout import heldout_cases\n",
        "tests/test_d.py": "import nebula3d.validation.holdout.heldout_cases as h\n",
        "scripts/e.py": "import importlib\nm = importlib.import_module(NAME)\n",
        "examples/f.py": "__import__('nebula3d.validation.holdout.heldout_cases')\n",
    }
    not_planted = {
        "src/nebula3d/validation/g.py": "from . import cases\nfrom .holdout import other\n",
        "tests/test_h.py": "PATH = 'src/nebula3d/validation/holdout/heldout_cases.py'\n",
        "web/src/i.py": "from nebula3d.validation.holdout import heldout_cases\n",  # not read
    }
    for rel, text in {**planted, **not_planted}.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text, encoding="utf-8")
    assert sorted(_importers(tmp_path, HELD_OUT_MODULE)) == [
        ("examples/f.py", "<module>"),
        ("scripts/e.py", "<module>"),
        ("src/nebula3d/c.py", "g"),
        ("src/nebula3d/validation/a.py", "<module>"),
        ("src/nebula3d/validation/b.py", "f"),
        ("src/nebula3d/validation/holdout/__init__.py", "<module>"),
        ("tests/test_d.py", "<module>"),
    ]


def test_the_test_split_is_unreachable_without_the_opt_in(monkeypatch):
    # Not an empty split, which a run meant to cover it would take for a pass: an error
    # that says how to opt in. Nothing of the test split is printed or returned.
    for value in (None, "", "0", "true"):
        if value is None:
            monkeypatch.delenv(HOLDOUT_ENV, raising=False)
        else:
            monkeypatch.setenv(HOLDOUT_ENV, value)
        assert not holdout_opted_in(), value
        with pytest.raises(HeldOutError, match=f"{HOLDOUT_ENV}=1"):
            cases("test")
        with pytest.raises(HeldOutError, match=f"{HOLDOUT_ENV}=1"):
            all_cases()
        with pytest.raises(HeldOutError, match=f"{HOLDOUT_ENV}=1"):
            manifest()
        with pytest.raises(KeyError, match=f"{HOLDOUT_ENV}=1"):
            case_named("no-such-case")
        out = io.StringIO()
        with contextlib.redirect_stdout(out), pytest.raises(SystemExit, match="--report"):
            main(["manifest"])
        printed = len(out.getvalue())
        assert printed == 0, "the manifest printed without the opt-in"
        assert case_named("dev-control").split == "dev"
    # A fresh interpreter that imports the whole package and reads the dev cases never
    # loads the held-out module.
    env = {k: v for k, v in os.environ.items() if k != HOLDOUT_ENV}
    probe = (
        "import sys, nebula3d.validation as v, nebula3d.validation.__main__, "
        "nebula3d.validation.arm_a, nebula3d.validation.arm_d, nebula3d.validation.report, "
        "nebula3d.validation.score\n"
        "v.cases('dev'); v.case_named('dev-control')\n"
        "try:\n    v.cases('test')\nexcept v.HeldOutError:\n    print('refused')\n"
        f"print({HELD_OUT_MODULE!r} in sys.modules)\n"
    )
    proc = subprocess.run(
        [sys.executable, "-c", probe], cwd=REPO, env=env, capture_output=True, text=True
    )
    said = proc.stdout.split()
    assert said == ["refused", "False"], f"exit {proc.returncode}"


@needs_holdout
def test_the_opt_in_gives_the_test_split_as_it_was():
    digest = _canonical_sha256([dataclasses.asdict(c) for c in cases("test")])
    same = digest == TEST_SPLIT_SHA256
    assert same, "the test split's cases are not those pinned (their sha256 differs)"
    # Every case, in the manifest's order, and each test case by its id: compared by
    # identity, so a failure shows no case.
    interleaved = [c for pair in zip(cases("dev"), cases("test")) for c in pair]
    in_order = len(all_cases()) == len(interleaved) and all(
        a is b for a, b in zip(all_cases(), interleaved)
    )
    assert in_order, "all_cases() is not each family's dev case, then its test case"
    n_test = len(cases("test"))
    found = sum(case_named(c.id) is c for c in cases("test"))
    assert found == n_test, f"case_named finds {found} of the {n_test} test cases"


# ------------------------------------------------- the failure paths, on a fake case
#
# Each assertion above that could meet a held-out case, made to fail on a made-up
# test case: its failure (the message and pytest's introspection) shows nothing of it.


def _fake_test_case() -> Case:
    """A made-up held-out case, never a real one: everything it holds a failure must not
    show. Its first planted vector is an FCC lattice vector, which no case may plant."""
    crystal = Crystal(
        a=5.25,
        sro_amp=0.1,
        seed=4321,
        planted=(Planted((1.0, 1.0, 0.0), 0.1), Planted((0.25, 1.75, 0.5), -0.1)),
    )
    return Case("test-fake-ub", "ub", "test", crystal, {"angle_deg": 1.37, "axis": (0.0, 0.0, 1.0)})


def _fake_shown(text: str, c: Case) -> list[str]:
    """What of the fake case *c* the text shows."""
    shown = [c.id, label_of(c), str(c.crystal.seed), str(c.crystal.a), "1.75", "1.37"]
    for p in c.crystal.planted:
        shown += [str(p.vector), str(list(p.vector)), ", ".join(map(str, p.vector))]
    shown += [repr(c), repr(c.crystal), repr(c.fault)]
    return [s for s in shown if s in text]


def _failure(test: Any, *args: Any) -> str:
    """The text of *test*'s failure: its message with pytest's introspection."""
    with pytest.raises(AssertionError) as info:
        test(*args)
    return str(info.value)


def test_a_failure_shows_nothing_of_a_held_out_case(monkeypatch, tmp_path):
    this = sys.modules[__name__]
    fake = _fake_test_case()
    dev_twin = replace(fake, id="dev-fake-ub", split="dev")
    monkeypatch.setattr(this, "_named_cases", lambda: [("test-split-case-0", fake)] * 2)

    # The FCC check and the label check: the masked name, or a count.
    text = _failure(test_planted_vectors_are_not_fcc_lattice_vectors)
    assert "test-split-case-0" in text and _fake_shown(text, fake) == []
    text = _failure(test_every_case_has_a_label_of_its_own)
    assert "1 cases share" in text and _fake_shown(text, fake) == []

    # Dev and test the same in every way: each kind named, no value.
    monkeypatch.setattr(this, "_dev_and_test", lambda: ([dev_twin], [fake]))
    text = _failure(test_dev_and_test_differ_in_crystal_and_fault)
    for kind in ("the crystal", "a planted vector", "the seed", "the ub fault"):
        assert kind in text
    assert _fake_shown(text, fake) == []

    # The web harness's manifest: a test entry changed, and a dev entry.
    current = json.loads(json.dumps(manifest([dev_twin, fake])))
    committed = json.loads(json.dumps(current))
    committed["cases"][1]["fault"]["angle_deg"] = 1.38
    committed["cases"][0]["cell_a"] = 5.5
    monkeypatch.setattr(this, "_committed_manifest", lambda: committed)
    monkeypatch.setattr(this, "_current_manifest", lambda: current)
    monkeypatch.setattr(this, "holdout_opted_in", lambda: True)
    text = _failure(test_the_web_harness_reads_the_current_cases)
    assert "the dev case dev-fake-ub" in text and "test split's entries" in text
    assert _fake_shown(text, fake) == [] and "1.38" not in text

    # Arm D on a held-out case: its files named by the masked name, a failure by its
    # criteria, an error by its kind.
    stems = []

    def failing_arm_d(case: Case, root: Path, *, n: int, stem: str) -> dict[str, Any]:
        stems.append(stem)
        summary = {"criteria": {"features": False, "window": True}, "case": repr(case)}
        return {"case": case.id, "pass": False, "summary": summary}

    def raising_arm_d(case: Case, root: Path, *, n: int, stem: str) -> dict[str, Any]:
        raise ValueError(f"{case.id}: {case.crystal.planted[1].vector}, {case.crystal.seed}")

    node = SimpleNamespace(callspec=SimpleNamespace(id="test-split-case-0"))
    request = SimpleNamespace(node=node)
    arm_d_test = test_arm_d_passes_every_criterion_on_every_case
    monkeypatch.setattr(this, "run_case_d", failing_arm_d)
    text = _failure(arm_d_test, fake, tmp_path, request)
    assert "failed criteria: ['features']" in text and _fake_shown(text, fake) == []
    assert stems == ["test-split-case-0"]
    monkeypatch.setattr(this, "run_case_d", raising_arm_d)
    with pytest.raises(pytest.fail.Exception) as info:
        arm_d_test(fake, tmp_path, request)
    text = str(info.getrepr(style="long", chain=True))
    assert "arm D raised ValueError on test-split-case-0" in text
    assert _fake_shown(text, fake) == []

    # The served names: one that carries a held-out case is shown as that.
    names = [f"{label_of(fake)}_B1.nxs", "v000000_B1.nxs"]
    assert _shown_names(names, [fake]) == ["(a name that carries a held-out case)", names[1]]


def test_arm_d_names_its_files_by_the_stem_it_is_given(tmp_path, control):
    run_case_d(control.case, tmp_path / "id", n=N, built=control)
    run_case_d(control.case, tmp_path / "masked", n=N, built=control, stem="test-split-case-0")
    assert sorted(p.name for p in (tmp_path / "id").iterdir()) == [
        "dev-control--D_delta_pdf.h5",
        "dev-control--D_flattened.h5",
    ]
    assert sorted(p.name for p in (tmp_path / "masked").iterdir()) == [
        "test-split-case-0--D_delta_pdf.h5",
        "test-split-case-0--D_flattened.h5",
    ]
