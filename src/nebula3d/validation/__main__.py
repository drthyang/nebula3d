# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The validation's commands (docs/evals.md, "Does the Pilot help?").

    python -m nebula3d.validation manifest --report        # every case, as JSON
    python -m nebula3d.validation arm-a --split dev        # arm A, scored
    python -m nebula3d.validation arm-d --split dev        # arm D, the scorer's reference
    python -m nebula3d.validation make --root R --split dev --arms B,C --runs 3
    python -m nebula3d.validation score --root R --record web/.validation/<label>.json
    python -m nebula3d.validation summarize --record web/.validation/<label>.json

The test split is held out: every command that reads it needs ``--report``,
which says the numbers are for the record, not for improving anything. Its
definitions are in a module of their own (``holdout/heldout_cases.py``, which no
one opens), loaded only with an opt-in (:func:`.cases.cases`): ``--report`` is
this CLI's, and ``NEBULA_HOLDOUT_TESTS=1`` the tests' and CI's. ``manifest``
lists every case, so it needs one too; the web harness's copy is written by

    python -m nebula3d.validation manifest --report \
        > web/src/llm/evals/fixtures/validation-cases.json

Arm A on the test split writes its results into a held-out folder only (``--out``
with a ``holdout`` folder in its path, docs/evals/validation/holdout/ here), and
prints how many cases pass, never the cases.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .cases import (
    FAMILIES,
    Built,
    Case,
    HeldOutError,
    all_cases,
    answer_truth,
    build,
    case_named,
    cases,
    label_of,
)

ARMS = ("B", "C")


def _split(args: argparse.Namespace) -> str:
    if args.split == "test" and not args.report:
        sys.exit(
            "the test split is held out: pass --report to run it for the reported numbers only"
        )
    return str(args.split)


def manifest(selected: Sequence[Case] | None = None, *, report: bool = False) -> dict[str, Any]:
    """Every case (or the *selected*): what the TS harness grades an answer against. Every
    case holds the test split, so it needs the opt-in (*report*, or ``NEBULA_HOLDOUT_TESTS=1``)."""
    chosen = all_cases(report=report) if selected is None else selected
    return {
        "families": dict(FAMILIES),
        "cases": [
            {
                "id": c.id,
                "label": label_of(c),
                "family": c.family,
                "split": c.split,
                "cell_a": c.crystal.a,
                "planted": [
                    {
                        "vector": list(p.vector),
                        "sign": "+" if p.amplitude > 0 else "-",
                        "distance_A": round(c.crystal.a * sum(x * x for x in p.vector) ** 0.5, 3),
                    }
                    for p in c.crystal.planted
                ],
                "fault": {k: (list(v) if isinstance(v, tuple) else v) for k, v in c.fault.items()},
                "truth": answer_truth(c),
            }
            for c in chosen
        ],
    }


def dataset_stem(case_id: str, arm: str, run: int) -> str:
    """The raw file's stem, opaque (:func:`.cases.label_of`): a model sees the stem in its tools,
    and the case's name would give the fault away. The server's dataset id is this with other
    characters made hyphens (web/src/llm/evals/validation.ts parses it back)."""
    return f"{label_of(case_id)}_{arm}{run}"


def cmd_make(args: argparse.Namespace) -> None:
    root = Path(args.root)
    # The server lists every .nxs in raw/ as a dataset: the volumes themselves live beside it,
    # and raw/ holds only the links, one per arm and run.
    (root / "raw").mkdir(parents=True, exist_ok=True)
    (root / "volumes").mkdir(exist_ok=True)
    (root / "processed").mkdir(exist_ok=True)
    from ..io.hkl_reader import save

    arms = [a.strip() for a in args.arms.split(",") if a.strip()]
    made = cases(_split(args), report=args.report)
    for c in made:
        base = root / "volumes" / f"{label_of(c)}.nxs"
        if not base.exists():
            save(build(c, args.n).raw, base)
        # One dataset per arm and run, each its own outputs; the volumes are links to one file.
        for arm in arms:
            for k in range(1, args.runs + 1):
                link = root / "raw" / f"{dataset_stem(c.id, arm, k)}.nxs"
                if not link.exists():
                    os.symlink(Path("..") / "volumes" / base.name, link)
        print(base)
    # The root's own record of its cases: the split it was made from, never the other's.
    (root / "manifest.json").write_text(
        json.dumps(manifest(made), indent=1, ensure_ascii=False) + "\n"
    )


def _outputs(processed: Path, stem: str) -> tuple[Path, Path] | None:
    """The run's ΔPDF and the volume it was made from, as the ΔPDF records it."""
    from ..io import load_delta_pdf

    found = sorted(processed.glob(f"{stem}_*delta_pdf.h5"), key=lambda p: p.stat().st_mtime)
    if not found:
        return None
    pdf = found[-1]
    src = str(load_delta_pdf(pdf, read_data=False).logs.get("source_file", ""))
    pdf_input = processed / Path(src).name if src else None
    if pdf_input is None or not pdf_input.exists():
        return None
    return pdf, pdf_input


def cmd_score(args: argparse.Namespace) -> None:
    """Score a live record's runs (arms B and C) on their outputs, and merge the grades."""
    from .report import live_table, summarize_record
    from .score import score_outputs

    root = Path(args.root)
    record = json.loads(Path(args.record).read_text())
    built: dict[str, Built] = {}
    for run in record["runs"]:
        try:
            case = case_named(run["case"], report=args.report)
        except KeyError:
            sys.exit(
                "this record holds a case that is no validation case"
                if args.report
                else "this record holds a case that is no dev case: "
                "pass --report if it is a test case"
            )
        if case.split == "test" and not args.report:
            sys.exit("this record holds test cases: pass --report")
        if case.id not in built:
            built[case.id] = build(case, args.n)
        found = _outputs(root / "processed", run.get("stem", run["dataset"]))
        run["truth_score"] = (
            score_outputs(built[case.id], *found)
            if found
            else {"pass": False, "criteria": {"outputs": False}, "note": "no ΔPDF was made"}
        )
    record["summary"] = summarize_record(record)
    out = Path(args.out or args.record)
    out.write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n")
    print(live_table(record["summary"]))
    print(out)


def holds_test_split(record: dict[str, Any]) -> bool:
    """Whether a live record holds the held-out test split: as it says, or as any run says."""
    return record.get("split") == "test" or any(
        r.get("split") == "test" for r in record.get("runs", [])
    )


def cmd_summarize(args: argparse.Namespace) -> None:
    """A live record's per-case table again, from the grades and the scores it holds, and
    written back as its summary: after its runs' words were graded again
    (NEBULA_VALIDATION_REGRADE, web/src/llm/evals/validation.live.test.ts), or to read it.
    Nothing is scored, so it needs neither the data root nor the cases."""
    from .report import live_table, summarize_record

    record = json.loads(Path(args.record).read_text())
    if holds_test_split(record) and not args.report:
        sys.exit(
            "this record holds the held-out test split: pass --report to summarize it for "
            "the reported numbers only"
        )
    record["summary"] = summarize_record(record)
    out = Path(args.out or args.record)
    out.write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n")
    print(live_table(record["summary"]))
    print(out)


#: Where arm A's results on the test split may go: a held-out folder, which no one
#: opens (docs/evals/validation/holdout/ in this repo).
HELD_OUT_FOLDER = "holdout"


def cmd_arm_a(args: argparse.Namespace) -> None:
    from .arm_a import run_arm_a
    from .report import arm_a_table, fails

    split = _split(args)
    # The test split's results go into a held-out folder only, and are never printed:
    # whoever runs it reads the count, not the cases.
    if split == "test" and not (args.out and HELD_OUT_FOLDER in Path(args.out).parts):
        sys.exit(
            "arm A on the test split writes its results into a held-out folder only, and "
            f"prints none: pass --out with a '{HELD_OUT_FOLDER}' folder in its path, e.g. "
            "docs/evals/validation/holdout/arm-a-test.json"
        )
    root = Path(args.root) if args.root else Path(tempfile.mkdtemp(prefix="nebula-arm-a-"))
    results = run_arm_a(cases(split, report=args.report), root, n=args.n, runs=args.runs)
    if args.out:
        Path(args.out).write_text(
            json.dumps(
                {"split": split, "n": args.n, "runs": args.runs, "cases": results},
                indent=1,
                ensure_ascii=False,
            )
            + "\n"
        )
    if split == "test":
        passed = sum(not fails(r) for r in results)
        print(
            f"arm A on the test split: {passed} of {len(results)} cases pass; "
            f"the results are in {args.out}"
        )
        return
    print(arm_a_table(results))


def cmd_arm_d(args: argparse.Namespace) -> None:
    from .arm_d import run_arm_d

    split = _split(args)
    root = Path(tempfile.mkdtemp(prefix="nebula-arm-d-"))
    for r in run_arm_d(cases(split, report=args.report), root, n=args.n):
        bad = [k for k, ok in r["summary"]["criteria"].items() if not ok]
        print(f"{r['case']}: {'passes' if r['pass'] else 'FAILS ' + ', '.join(bad)}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(
        prog="python -m nebula3d.validation",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("manifest", help="print every case as JSON (needs --report: the test split)")
    p.add_argument(
        "--report", action="store_true", help="allow the held-out test split (it lists every case)"
    )
    for name, fn in (
        ("make", cmd_make),
        ("arm-a", cmd_arm_a),
        ("arm-d", cmd_arm_d),
        ("score", cmd_score),
    ):
        p = sub.add_parser(name)
        p.set_defaults(fn=fn)
        p.add_argument(
            "--n", type=int, default=161, help="grid points per axis (161: every node on a voxel)"
        )
        p.add_argument(
            "--report",
            action="store_true",
            help="allow the held-out test split (reported numbers only)",
        )
        if name != "score":
            p.add_argument("--split", choices=("dev", "test"), default="dev")
            p.add_argument("--runs", type=int, default=3)
        if name == "make":
            p.add_argument("--root", required=True)
            p.add_argument("--arms", default=",".join(ARMS))
        if name == "arm-a":
            p.add_argument("--root", help="where the runs go (default: a temporary folder)")
            p.add_argument("--out", help="write the full results here (JSON)")
        if name == "score":
            p.add_argument("--root", required=True)
            p.add_argument("--record", required=True)
            p.add_argument("--out")
    p = sub.add_parser(
        "summarize",
        help="a live record's per-case table again, from the grades and scores it holds",
    )
    p.set_defaults(fn=cmd_summarize)
    p.add_argument("--record", required=True)
    p.add_argument("--out", help="write the record here (default: in place)")
    p.add_argument(
        "--report",
        action="store_true",
        help="allow the held-out test split (reported numbers only)",
    )
    args = ap.parse_args(argv)
    if args.cmd == "manifest":
        try:
            listed = manifest(report=args.report)
        except HeldOutError as err:
            sys.exit(f"{err}: the manifest lists every case")
        print(json.dumps(listed, indent=1, ensure_ascii=False))
        return
    args.fn(args)


if __name__ == "__main__":
    main()
