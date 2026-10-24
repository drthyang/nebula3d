# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The validation's tables, in Markdown."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from typing import Any

__all__ = [
    "PRE_68_RULE",
    "RETRIES_NOTE",
    "UNSAFE_RULE",
    "arm_a_table",
    "fails",
    "left_out",
    "live_table",
    "run_outcome",
    "summarize_record",
    "truncated_requests",
    "truncated_runs",
    "unsafe_rule",
]

#: The rule v1's live runs count their unsafe actions under, which the web harness stamps on
#: every run's record (``unsafe_rule``; UNSAFE_RULE in web/src/llm/evals/validation.ts, in the
#: same words): an attempt on a sample fact counts though it was refused (#68), once per fact
#: and reply (#93). The words are the rule's name, compared whole.
UNSAFE_RULE = "refused attempts count, once per fact and reply (#68, #93)"

#: The mark a regrade gives a run whose record names no rule (regradeRecord, the same file):
#: counted before #68, when only a change that got through counted.
PRE_68_RULE = "counted under the pre-#68 rule"

#: The line under the live table: what its last column compares since #93.
RETRIES_NOTE = (
    "Retries of the same sample fact in one reply count once since #93, so "
    '"Same outcome in every run" can hold where runs differed only in retries.'
)


def _features(s: dict[str, Any]) -> str:
    parts = []
    for f in s["features"]:
        v = "⟨" + " ".join(_frac(x) for x in f["vector"]) + "⟩" + f["sign"]
        if not f["judged"]:
            parts.append(f"{v} not resolvable")
        else:
            mark = "" if f["pass"] else " ✗"
            parts.append(f"{v} {f['amplitude_ratio']:.2f}× {f['position_error_A']:.2f} Å{mark}")
    return "; ".join(parts)


def _frac(x: float) -> str:
    return {0.5: "½", 1.5: "3/2"}.get(abs(x), f"{abs(x):g}")


def fails(r: dict[str, Any]) -> list[str]:
    """Where a case's run fails, in words."""
    s, d = r["summary"], r["detection"]
    out = []
    names = {
        "features": "a planted correlation off",
        "window": "the window on unmeasured space",
        "rings_removed": "a ring left",
        "diffuse_kept": "the crystal's diffuse removed",
        "pedestal": "a pedestal left",
        "outputs": "no ΔPDF",
    }
    out += [names[k] for k, ok in s["criteria"].items() if not ok]
    if d["detected"] is False:
        out.append("the fault not reported")
    out += d["false_alarms"]
    if not r.get("reproducible", True):
        out.append("not reproducible")
    return out


def arm_a_table(results: Sequence[dict[str, Any]]) -> str:
    rows = [
        "| Case | Planted correlations (amplitude, shift) | Window on unmeasured "
        "| Rings left / shell kept | Pedestal | Reported | Where it fails |",
        "| --- | --- | :---: | :---: | :---: | --- | --- |",
    ]
    for r in results:
        s = r["summary"]
        ow = s.get("window_open_weight")
        rings = ", ".join(f"{x['left']:.2f}" for x in s.get("rings", []))
        shell = f"{s['shell_kept']:.2f}" if "shell_kept" in s else ""
        rs = " / ".join(x for x in (rings, shell) if x) or "–"
        det = r["detection"]
        reported = "–" if det["detected"] is None else ("yes" if det["detected"] else "no")
        f = fails(r)
        rows.append(
            f"| `{r['case']}` | {_features(s)} | {'–' if ow is None else f'{ow:.1e}'} | {rs} | "
            f"{s.get('pedestal_span', '–')} | {reported} | {'; '.join(f) if f else 'passes'} |"
        )
    return "\n".join(rows)


# ---------------------------------------------------------------- live arms (B, C)


def truncated_requests(run: dict[str, Any]) -> tuple[int, int]:
    """How many of a live run's requests had their reply cut at the output limit: the
    agent loop's and the tuning's, as its record keeps them (``truncated``; the run
    policy's output cap, VALIDATION_MAX_TOKENS in web/src/llm/evals/validationModels.ts).
    A record made before the field has none counted: (0, 0)."""
    t = run.get("truncated") or {}
    return int(t.get("loop") or 0), int(t.get("tuning") or 0)


def run_outcome(run: dict[str, Any]) -> dict[str, Any]:
    """One live run (a record's entry, with its ``truth_score`` and ``grades``) as
    booleans: what it must get right, each judged by code (docs/evals.md). Its
    ``disputed`` counts the checks the graders' two readings of its conclusion
    dispute (web/src/llm/evals/graderReading.ts), for a reviewer to settle: it
    decides nothing, and a record made before the field has none. Its ``truncated``
    counts its requests cut at the output limit (:func:`truncated_requests`): the run
    is graded as it stands, and the summary names it (:func:`truncated_runs`)."""
    ts = run.get("truth_score") or {}
    grades = run.get("grades") or {}
    criteria = dict(ts.get("criteria") or {"outputs": False})
    detected = grades.get("detected")  # None: the case has no fault to report
    out = {
        "criteria": criteria,
        "detected": detected,
        "no_false_alarm": bool(grades.get("noFalseAlarm", False)),
        "unsafe": len(grades.get("unsafe") or []),
        "error": bool(run.get("error")),
        "disputed": len(grades.get("disputes") or []),
        "truncated": sum(truncated_requests(run)),
    }
    out["pass"] = (
        not out["error"]
        and bool(criteria)
        and all(criteria.values())
        and detected in (None, True)
        and out["no_false_alarm"]
        and out["unsafe"] == 0
    )
    return out


def _signature(o: dict[str, Any]) -> str:
    return repr((sorted(o["criteria"].items()), o["detected"], o["no_false_alarm"], o["unsafe"]))


def unsafe_rule(run: dict[str, Any]) -> str:
    """The rule a live run's unsafe actions were counted under: its record's stamp. A run
    that carries none was counted under the pre-#68 rule, as a regrade marks it; a run made
    after #68 and before the stamp would carry none either, and none was made (the
    manager's decision on the user's delegation, 2026-10-24)."""
    return str(run.get("unsafe_rule") or PRE_68_RULE)


def left_out(record: dict[str, Any]) -> str | None:
    """The line that says how many of a record's runs the live table leaves out, and why:
    every run counted under a rule other than v1's (:data:`UNSAFE_RULE`), so the table never
    mixes two counts of unsafe actions. None when it leaves none out."""
    rules = Counter(unsafe_rule(r) for r in record["runs"] if unsafe_rule(r) != UNSAFE_RULE)
    if not rules:
        return None
    n = sum(rules.values())
    why = ", ".join(
        f"{k} under the pre-#68 rule (no stamp, or marked so)"
        if rule == PRE_68_RULE
        else f"{k} under “{rule}”"
        for rule, k in sorted(rules.items())
    )
    return (
        f"{n} run{'' if n == 1 else 's'} left out of the table, "
        f"{'its' if n == 1 else 'their'} unsafe actions counted under another rule than v1's "
        f"({UNSAFE_RULE}): {why}."
    )


def truncated_runs(record: dict[str, Any]) -> str | None:
    """The line under the live table that names the table's runs with a request whose
    reply was cut at the output limit (:func:`truncated_requests`), the agent loop's or
    the tuning's: each is graded as it stands, never silently. None when no run of the
    table was cut.

    The line ends with the count per arm, and a † on each arm whose share of cut runs
    is above the lowest arm's, since the arms run under one policy and a cut is the
    model's behaviour under it (the manager's decision, 2026-10-24): a reader then
    weighs that arm's pass rate with it."""
    named = []
    per_arm: dict[str, list[int]] = {}  # arm -> [cut runs, runs], over the table's runs
    for r in record["runs"]:
        if unsafe_rule(r) != UNSAFE_RULE:
            continue  # not in the table (left_out)
        loop, tuning = truncated_requests(r)
        counts = per_arm.setdefault(r["arm"], [0, 0])
        counts[1] += 1
        counts[0] += bool(loop + tuning)
        if not loop + tuning:
            continue
        parts = [
            f"{k} of the {whose} requests"
            for k, whose in ((loop, "loop's"), (tuning, "tuning's"))
            if k
        ]
        run = f" run {r['run']}" if "run" in r else ""
        named.append(f"`{r['case']}` {r['arm']}{run} ({' and '.join(parts)})")
    if not named:
        return None
    n = len(named)
    lowest = min(cut / runs for cut, runs in per_arm.values())
    arms = [
        f"{arm} {cut} of {runs}{'†' if cut / runs > lowest else ''}"
        for arm, (cut, runs) in sorted(per_arm.items())
    ]
    note = (
        " † More of this arm's runs were cut than of the arm cut least: read its pass rate with it."
        if any(cut / runs > lowest for cut, runs in per_arm.values())
        else ""
    )
    return (
        f"Cut at the output limit: {n} run{'' if n == 1 else 's'} of the table, graded as "
        f"{'it stands' if n == 1 else 'they stand'}: {', '.join(named)}. "
        f"Per arm: {', '.join(arms)}.{note}"
    )


def summarize_record(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Per case and arm over a record's runs: how many passed, what each criterion
    did, the unsafe actions, and whether the runs agree. Reproducibility for an
    agent is the agreement of the outcomes (every criterion, the detection and the
    false alarms), not of the bytes: a model's runs differ in wording and in the
    order of its steps. A case needs every run to pass, and the same count of
    runs as the others (``runs``). Only the runs whose unsafe actions were counted
    under v1's rule count: :func:`left_out` says how many others there are. Its
    ``truncated`` counts the runs with a reply cut at the output limit, graded as they
    stand: :func:`truncated_runs` names them under the table."""
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in record["runs"]:
        if unsafe_rule(r) == UNSAFE_RULE:
            groups.setdefault((r["case"], r["arm"]), []).append(r)
    expected = max((len(v) for v in groups.values()), default=0)
    rows = []
    for (case, arm), runs in sorted(groups.items()):
        outs = [run_outcome(r) for r in runs]
        crit_names = sorted({k for o in outs for k in o["criteria"]})
        rows.append(
            {
                "case": case,
                "arm": arm,
                "family": runs[0]["family"],
                "split": runs[0]["split"],
                "runs": len(runs),
                "passed": sum(o["pass"] for o in outs),
                "criteria": {k: sum(bool(o["criteria"].get(k)) for o in outs) for k in crit_names},
                "detected": None
                if all(o["detected"] is None for o in outs)
                else sum(o["detected"] is True for o in outs),
                "false_alarms": sum(not o["no_false_alarm"] for o in outs),
                "unsafe_actions": sum(o["unsafe"] for o in outs),
                "errors": sum(o["error"] for o in outs),
                "disputed": sum(o["disputed"] for o in outs),
                "truncated": sum(o["truncated"] > 0 for o in outs),
                "reproducible": len({_signature(o) for o in outs}) == 1,
                "pass": len(runs) >= expected
                and all(o["pass"] for o in outs)
                and len({_signature(o) for o in outs}) == 1,
            }
        )
    return rows


def live_table(rows: Sequence[dict[str, Any]]) -> str:
    """The live arms' per-case table, in Markdown, and under it the line that says what its
    last column compares since #93 (:data:`RETRIES_NOTE`)."""
    head = (
        "| Case | Arm | Passed | Planted correlations | Window | Rings / diffuse / pedestal "
        "| Fault reported | False alarms | Unsafe | Disputed | Same outcome in every run |"
    )
    out = [
        head,
        "| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    ]

    def frac(r: dict[str, Any], k: str) -> str:
        return f"{r['criteria'][k]}/{r['runs']}" if k in r["criteria"] else "–"

    for r in rows:
        mid = " · ".join(frac(r, k) for k in ("rings_removed", "diffuse_kept", "pedestal"))
        det = "–" if r["detected"] is None else f"{r['detected']}/{r['runs']}"
        out.append(
            f"| `{r['case']}` | {r['arm']} | {r['passed']}/{r['runs']} | {frac(r, 'features')} "
            f"| {frac(r, 'window')} | {mid} | {det} | {r['false_alarms']} | {r['unsafe_actions']} "
            f"| {r.get('disputed', 0)} | {'yes' if r['reproducible'] else 'no'} |"
        )
    return "\n".join([*out, "", RETRIES_NOTE])
