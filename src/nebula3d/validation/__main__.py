# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The validation's commands (docs/evals.md, "Does the Pilot help?").

    python -m nebula3d.validation manifest                 # the cases, as JSON
    python -m nebula3d.validation arm-a --split dev        # arm A, scored
    python -m nebula3d.validation make --root R --split dev --arms B,C --runs 3
    python -m nebula3d.validation score --root R --record web/.validation/<label>.json

The test split is held out: every command that reads it needs ``--report``,
which says the numbers are for the record, not for improving anything.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

from .cases import FAMILIES, Built, build, case_named, cases

ARMS = ("B", "C")


def _split(args: argparse.Namespace) -> str:
    if args.split == "test" and not args.report:
        sys.exit(
            "the test split is held out: pass --report to run it for the reported numbers only"
        )
    return str(args.split)


def manifest() -> dict[str, Any]:
    """Every case: what the TS harness grades an answer against."""
    from .cases import CASES

    return {
        "families": dict(FAMILIES),
        "cases": [
            {
                "id": c.id,
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
            }
            for c in CASES
        ],
    }


def dataset_stem(case_id: str, arm: str, run: int) -> str:
    return f"{case_id}--{arm}-r{run}"


def cmd_make(args: argparse.Namespace) -> None:
    root = Path(args.root)
    (root / "raw").mkdir(parents=True, exist_ok=True)
    (root / "processed").mkdir(exist_ok=True)
    from ..io.hkl_reader import save

    arms = [a.strip() for a in args.arms.split(",") if a.strip()]
    for c in cases(_split(args)):
        base = root / "raw" / f"{c.id}.nxs"
        if not base.exists():
            save(build(c, args.n).raw, base)
        # One dataset per arm and run, each its own outputs; the volumes are links to one file.
        for arm in arms:
            for k in range(1, args.runs + 1):
                link = root / "raw" / f"{dataset_stem(c.id, arm, k)}.nxs"
                if not link.exists():
                    os.symlink(base.name, link)
        print(base)
    (root / "manifest.json").write_text(json.dumps(manifest(), indent=1, ensure_ascii=False) + "\n")


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
    from .score import score_outputs

    root = Path(args.root)
    record = json.loads(Path(args.record).read_text())
    built: dict[str, Built] = {}
    for run in record["runs"]:
        case = case_named(run["case"])
        if case.split == "test" and not args.report:
            sys.exit("this record holds test cases: pass --report")
        if case.id not in built:
            built[case.id] = build(case, args.n)
        found = _outputs(root / "processed", run["dataset"])
        run["truth_score"] = (
            score_outputs(built[case.id], *found)
            if found
            else {"pass": False, "criteria": {"outputs": False}, "note": "no ΔPDF was made"}
        )
    out = Path(args.out or args.record)
    out.write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n")
    print(out)


def cmd_arm_a(args: argparse.Namespace) -> None:
    from .arm_a import run_arm_a
    from .report import arm_a_table

    split = _split(args)
    root = Path(args.root) if args.root else Path(tempfile.mkdtemp(prefix="nebula-arm-a-"))
    results = run_arm_a(cases(split), root, n=args.n, runs=args.runs)
    if args.out:
        Path(args.out).write_text(
            json.dumps(
                {"split": split, "n": args.n, "runs": args.runs, "cases": results},
                indent=1,
                ensure_ascii=False,
            )
            + "\n"
        )
    print(arm_a_table(results))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(
        prog="python -m nebula3d.validation",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("manifest", help="print the cases as JSON")
    for name, fn in (("make", cmd_make), ("arm-a", cmd_arm_a), ("score", cmd_score)):
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
    args = ap.parse_args(argv)
    if args.cmd == "manifest":
        print(json.dumps(manifest(), indent=1, ensure_ascii=False))
        return
    args.fn(args)


if __name__ == "__main__":
    main()
