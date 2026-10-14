# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The validation's tables, in Markdown."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

__all__ = ["arm_a_table", "fails"]


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
