# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The validation's held-out test split stays out of the default run.

Nothing that is tuned may see the test split (``nebula3d.validation.cases("test")``),
and whoever tunes reads pytest's output. So a test that takes a ``validation_case``
argument runs on the dev cases alone by default: the test split's cases are
neither collected nor run. ``NEBULA_HOLDOUT_TESTS=1`` adds them (CI sets it in
every job that runs pytest), each under an opaque name, ``test-split-case-0``,
``-1`` and so on in the order the cases are defined, never under its id.

The opt-in is also what lets the test split load at all: its definitions are held
out in a module of their own, which ``cases("test")`` imports only with it and
refuses without it (nebula3d.validation.cases). The tests that need the test split
skip without it (tests/test_validation.py).

Each test, and each module, also gets back the ``NEBULA3D_*`` environment it
started with (:func:`_restore_package_env`).
"""

import os
from collections.abc import Iterator

import pytest

#: The opt-in: "1" runs the test split's cases too; unset, "" or "0" leaves them out.
HOLDOUT_ENV = "NEBULA_HOLDOUT_TESTS"

#: The prefix of the process-wide settings the package reads from the environment.
#: ``nebula3d.webbridge.setup()`` sets one, ``NEBULA3D_LOW_MEMORY=1`` (the browser
#: build's low-memory mode, process-wide by design), and nothing unsets it.
PACKAGE_ENV_PREFIX = "NEBULA3D_"


def _package_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k.startswith(PACKAGE_ENV_PREFIX)}


def _put_back(saved: dict[str, str]) -> None:
    for key in [k for k in os.environ if k.startswith(PACKAGE_ENV_PREFIX) and k not in saved]:
        del os.environ[key]
    os.environ.update(saved)


@pytest.fixture(autouse=True, scope="module")
def _restore_package_env_per_module() -> Iterator[None]:
    """:func:`_restore_package_env` for a module: a module-scoped fixture that
    calls ``webbridge.setup()`` runs before the per-test snapshot is taken."""
    saved = _package_env()
    yield
    _put_back(saved)


@pytest.fixture(autouse=True)
def _restore_package_env() -> Iterator[None]:
    """Snapshot the ``NEBULA3D_*`` environment before each test and put it back
    after. A test that called ``webbridge.setup()`` left the low-memory mode on
    for every test after it, where the stages write their output over their
    input: tests/test_pooled_rings.py then failed after tests/test_webbridge.py
    (tests/test_package_env.py runs the two in that order)."""
    saved = _package_env()
    yield
    _put_back(saved)


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
