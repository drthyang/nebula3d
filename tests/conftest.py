# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The validation's held-out test split stays out of the default run.

Nothing that is tuned may see the test split (``nebula3d.validation.cases("test")``),
and whoever tunes reads pytest's output. So a test that takes a ``validation_case``
argument runs on the dev cases alone by default: the test split's cases are
neither collected nor run. ``NEBULA_HOLDOUT_TESTS=1`` adds them (CI sets it in
every job that runs pytest), each under an opaque name, ``test-split-case-0``,
``-1`` and so on in the order the cases are defined, never under its id.
"""

import os

import pytest

#: The opt-in: "1" runs the test split's cases too; unset, "" or "0" leaves them out.
HOLDOUT_ENV = "NEBULA_HOLDOUT_TESTS"


def holdout_on() -> bool:
    value = os.environ.get(HOLDOUT_ENV, "")
    if value not in ("", "0", "1"):
        # A typo must not quietly drop the test split from a run meant to cover it.
        raise pytest.UsageError(f'{HOLDOUT_ENV} must be "1" (on), "0" or unset (off)')
    return value == "1"


def pytest_configure(config: pytest.Config) -> None:
    holdout_on()


def pytest_report_header(config: pytest.Config) -> str:
    if holdout_on():
        return f"held-out test split: on ({HOLDOUT_ENV}=1), its cases under masked names"
    return f"held-out test split: off (set {HOLDOUT_ENV}=1 to run it too)"


def pytest_generate_tests(metafunc: pytest.Metafunc) -> None:
    if "validation_case" not in metafunc.fixturenames:
        return
    from nebula3d.validation import cases

    params = [pytest.param(c, id=c.id) for c in cases("dev")]
    if holdout_on():
        params += [pytest.param(c, id=f"test-split-case-{i}") for i, c in enumerate(cases("test"))]
    metafunc.parametrize("validation_case", params)
