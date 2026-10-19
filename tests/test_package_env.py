# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang
"""The package's environment does not leak from one test into the next.

``nebula3d.webbridge.setup()`` turns the low-memory mode on for the whole
process (``NEBULA3D_LOW_MEMORY=1``), as the browser build needs, and nothing
turns it off: every test after one that called it ran in low-memory mode,
where the stages write their output over their input, and
tests/test_pooled_rings.py failed after tests/test_webbridge.py. tests/conftest.py
now puts the ``NEBULA3D_*`` environment back after each test and each module.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from nebula3d import webbridge
from tests.conftest import PACKAGE_ENV_PREFIX

REPO = Path(__file__).resolve().parents[1]
BRIDGE_TEST = "tests/test_webbridge.py::test_demo_input_is_labelled_synthetic_and_stored_float32"
POOLED_TEST = ("tests/test_pooled_rings.py::"
               "test_removes_a_ring_whose_radius_wanders_with_direction")


def test_what_the_bridge_sets_is_what_conftest_puts_back(tmp_path, monkeypatch):
    monkeypatch.delenv("NEBULA3D_LOW_MEMORY", raising=False)
    before = dict(os.environ)
    webbridge.setup(workdir=str(tmp_path / "work"))
    changed = {k for k in set(before) | set(os.environ) if before.get(k) != os.environ.get(k)}
    assert "NEBULA3D_LOW_MEMORY" in changed
    assert all(k.startswith(PACKAGE_ENV_PREFIX) for k in changed), changed


def test_the_bridge_tests_then_the_pooled_rings_tests_pass():
    """A test that calls webbridge.setup(), then the pooled-ring test that
    failed after it, in one pytest run and in that order."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(PACKAGE_ENV_PREFIX)}
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-v", "-p", "no:cacheprovider", "-p", "no:randomly",
         BRIDGE_TEST, POOLED_TEST],
        cwd=REPO, env=env, capture_output=True, text=True, check=False,
    )
    ran = re.findall(r"^(tests/\S+::\S+) PASSED", proc.stdout, re.M)
    assert proc.returncode == 0, proc.stdout[-3000:]
    assert ran == [BRIDGE_TEST, POOLED_TEST]
