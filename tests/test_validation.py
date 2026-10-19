# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The validation cases, their truth and their scoring (nebula3d.validation):
the planted truth is where the cases say, the scorer passes the truth and fails
a reduction that lost it, arm A runs and is reproducible, and the held-out
test split stays out of everything that is tuned."""

import json
import re
import shutil
from collections.abc import Iterator, Sequence
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from nebula3d.io.hkl_reader import save
from nebula3d.pipeline import DeltaPdfParams, delta_pdf, write_delta_pdf_h5
from nebula3d.validation import CASES, FAMILIES, TOLERANCES, Case, build, case_named, cases
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
    "*.md",
)
#: Where a test case may be named: where the cases are defined, the validation's
#: records and tables, and the manifest the web harness grades answers against
#: (validation.ts reads every case from it, by design).
HOLDOUT_ALLOWED = re.compile(
    r"^src/nebula3d/validation/"
    r"|^docs/evals/validation/"
    r"|^web/src/llm/evals/fixtures/validation-cases\.json$"
)
#: The doc sections that report the test split's results, by their heading.
HOLDOUT_SECTIONS = {"docs/evals.md": "### Arm A"}
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


def _num(x: float) -> str:
    """The number *x* however it is written (0.5, .5, 0.50 or 1/2; 1 or 1.0), and
    never as part of a longer one."""
    x = float(x)
    whole, _, frac = f"{abs(x):.10f}".rstrip("0").partition(".")
    if frac:
        forms = [("0?" if whole == "0" else whole) + rf"\.{frac}0*"]
        if (2 * abs(x)).is_integer():
            forms.append(f"{round(2 * abs(x))}/2")
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


def _without_section(text: str, heading: str) -> str:
    """*text* with the section under *heading* blanked, to the next heading of its
    level or above (a heading in a code block does not count)."""
    level = len(heading) - len(heading.lstrip("#"))
    out, inside, fenced = [], False, False
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            fenced = not fenced
        elif not fenced and re.match(rf"#{{1,{level}}} ", line):
            inside = line.startswith(heading)
        out.append("\n" if inside else line)
    return "".join(out)


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
        if rel in HOLDOUT_SECTIONS:
            text = _without_section(text, HOLDOUT_SECTIONS[rel])
        hits.update(f"{rel}: {kind}" for kind, pats in needles if all(p.search(text) for p in pats))
    return sorted(hits)


def test_nothing_tuned_names_a_test_case():
    """No file the scan reads (HOLDOUT_SCANNED, less HOLDOUT_ALLOWED and the
    HOLDOUT_SECTIONS) names a held-out case. A file names one when it holds, for
    any test case:

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
      coefficient (·Q², q2 or b).

    A number matches however it is written (0.5, .5, 0.50 or 1/2; 1 or 1.0), but
    never inside a longer one, and a bare number never: a fault's size is a small
    number that appears everywhere without its unit. Not matched at all, for that
    reason: the cell, the UB's axis, the amplitudes, and the shell's width, lobes
    and power. The failure names the file and the kind, never the value.
    """
    for doc, heading in HOLDOUT_SECTIONS.items():
        assert re.search(rf"^{re.escape(heading)}", (REPO / doc).read_text(), re.M), doc
    hits = holdout_scan(REPO, holdout_needles(cases("test")))
    assert hits == [], "names a held-out test case (file: kind):\n" + "\n".join(hits)


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
        "tests/test_pairs.py": (f"# the pair {length} Å apart", "planted vector's length"),
        ".claude/skills/ub/SKILL.md": ("The UB is turned by 1.37°.", "case's UB angle"),
        "examples/origin.py": ("offset = (0.070, -0.015, 0)", "case's origin offset"),
        "scripts/edge.sh": (f"# the counts end at {q_cut} Å⁻¹", "case's coverage edge"),
        "tests/test_cover.py": ('fault = {"fraction": .55}', "case's coverage fraction"),
        "web/scripts/rings.mjs": ("// rings at 1.91 and 3.42 Å^-1", "case's ring positions"),
        "README.md": ("A shell at |Q| = 2.71.", "case's shell |Q|"),
        "docs/evals.md": (  # the Arm A section is not read; the next one is
            "# Evals\n\n### Arm A: results\n\ntest-fake-ub\n\n## Next\n\nb = 0.0123\n",
            "case's Q² background",
        ),
        "web/src/__snapshots__/run.snap": ("exports[`run`] = `test-fake-shell`;", "case's id"),
    }
    not_named = {
        "src/nebula3d/validation/cases.py": "test-fake-ub",
        "docs/evals/validation/table.md": "test-fake-ub",
        "web/src/llm/evals/fixtures/validation-cases.json": "test-fake-ub",
        "data/notes.md": "test-fake-ub",
        "web/src/node_modules/pkg/index.js": "test-fake-ub",
        "docs/media/frame.png": "test-fake-ub",
        "tests/test_one_vector.py": "PLANTED = [((0.25, 1.75, 0.5), 1.0)]",
        "web/src/bare.ts": "const n = [4321, 1.37, 0.55, 2.71, 0.0123];",
        "tests/test_longer.py": "seed = 43210  # angle = 1.375, q = 2.715",
    }
    for rel, text in [*((r, t) for r, (t, _) in named.items()), *not_named.items()]:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text, encoding="utf-8")
    needles = holdout_needles(fake)
    assert {f"a test {k}" for _, k in named.values()} == {kind for kind, _ in needles}
    expected = sorted(f"{rel}: a test {k}" for rel, (_, k) in named.items())
    assert holdout_scan(tmp_path, needles) == expected


def test_the_holdout_scan_finds_the_test_cases_out_of_place(tmp_path):
    # The real test cases as the validation writes them, in the cases' module and
    # in the web harness's manifest, copied where the scan reads: every kind is
    # found (the seed in the module; the manifest has none). The needles are never
    # held in a local, so a failure shows kinds, not values.
    for src, dst in [
        ("web/src/llm/evals/fixtures/validation-cases.json", "docs/manifest.json"),
        ("src/nebula3d/validation/cases.py", "examples/cases.py"),
    ]:
        (tmp_path / dst).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / src, tmp_path / dst)
    hits = holdout_scan(tmp_path, holdout_needles(cases("test")))
    kinds = {kind for kind, _ in holdout_needles(cases("test"))}
    in_manifest = {h.split(": ", 1)[1] for h in hits if h.startswith("docs/manifest.json: ")}
    assert in_manifest == kinds - {"a test crystal's seed"}
    assert "examples/cases.py: a test crystal's seed" in hits


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
