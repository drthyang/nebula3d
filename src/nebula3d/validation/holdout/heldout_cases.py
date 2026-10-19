# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
#
# HELD OUT. Builders and agents must not open, print or read this file. Only the
# opt-in loader, nebula3d.validation.cases._load_test_split, imports it
# (tests/test_validation.py checks every import in src/ and tests/). It holds the
# validation's held-out test split.

"""The validation's held-out test split: its crystal, its faults and its cases.

Reached only through ``nebula3d.validation.cases("test")``, which loads this
module with the opt-in alone (``NEBULA_HOLDOUT_TESTS=1``, or the CLI's
``--report``). The dev cases and every builder are in :mod:`..cases`.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..cases import Case, Crystal, Planted

__all__ = ["TEST_CASES"]

TEST_CRYSTAL = Crystal(
    a=4.1,
    sro_amp=0.07,
    seed=23,
    planted=(Planted((0.5, 1.0, 0.0), 0.004), Planted((1.5, 1.0, 0.0), -0.003)),
)


def _test(family: str, test: Mapping[str, Any]) -> Case:
    """The family's test case, with its fault."""
    return Case(f"test-{family}", family, "test", TEST_CRYSTAL, test)


_SHELL_TEST = {"q": 3.35, "amplitude": 0.2, "width": 0.035, "lobes": "111", "power": 3}
_RINGS_TEST = {"aluminium": 0.6}  # the sample can's textured Al lines (nebula3d.demo)

#: Every case, dev then test per family.
TEST_CASES: tuple[Case, ...] = (
    _test("control", {}),
    _test("ub", {"angle_deg": 0.45, "axis": (1.0, 0.0, 2.0)}),
    _test("origin", {"offset": (0.0, 0.035, 0.02)}),
    _test("coverage", {"fraction": 0.62}),
    _test("rings", _RINGS_TEST),
    _test("shell", _SHELL_TEST),
    _test("flatten", {"q2": 0.0045}),
    _test("rings-shell", {**_RINGS_TEST, "shell": _SHELL_TEST}),
)
