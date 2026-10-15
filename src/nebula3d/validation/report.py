# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The validation's tables, in Markdown."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

__all__ = ["arm_a_table", "fails", "live_table", "run_outcome", "summarize_record"]


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


def run_outcome(run: dict[str, Any]) -> dict[str, Any]:
    """One live run (a record's entry, with its ``truth_score`` and ``grades``) as
    booleans: what it must get right, each judged by code (docs/evals.md)."""
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


def summarize_record(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Per case and arm over a record's runs: how many passed, what each criterion
    did, the unsafe actions, and whether the runs agree. Reproducibility for an
    agent is the agreement of the outcomes (every criterion, the detection and the
    false alarms), not of the bytes: a model's runs differ in wording and in the
    order of its steps. A case needs every run to pass, and the same count of
    runs as the others (``runs``)."""
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in record["runs"]:
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
                "reproducible": len({_signature(o) for o in outs}) == 1,
                "pass": len(runs) >= expected
                and all(o["pass"] for o in outs)
                and len({_signature(o) for o in outs}) == 1,
            }
        )
    return rows


def live_table(rows: Sequence[dict[str, Any]]) -> str:
    """The live arms' per-case table, in Markdown."""
    head = (
        "| Case | Arm | Passed | Planted correlations | Window | Rings / diffuse / pedestal "
        "| Fault reported | False alarms | Unsafe | Same outcome in every run |"
    )
    out = [head, "| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"]

    def frac(r: dict[str, Any], k: str) -> str:
        return f"{r['criteria'][k]}/{r['runs']}" if k in r["criteria"] else "–"

    for r in rows:
        mid = " · ".join(frac(r, k) for k in ("rings_removed", "diffuse_kept", "pedestal"))
        det = "–" if r["detected"] is None else f"{r['detected']}/{r['runs']}"
        out.append(
            f"| `{r['case']}` | {r['arm']} | {r['passed']}/{r['runs']} | {frac(r, 'features')} "
            f"| {frac(r, 'window')} | {mid} | {det} | {r['false_alarms']} | {r['unsafe_actions']} "
            f"| {'yes' if r['reproducible'] else 'no'} |"
        )
    return "\n".join(out)
