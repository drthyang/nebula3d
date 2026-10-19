# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Does NEBULA Pilot help? Synthetic cases with a planted truth, scored the same
way for every arm (docs/evals.md, "Does the Pilot help?"):

- A, the default pipeline with no agent (:mod:`.arm_a`, runs here);
- B, the Pilot with its skills and guardrails, and C, the Pilot without its
  skills (web/src/llm/evals/validation*.ts, against a server this package's
  ``make`` command fills);
- D, the planted truth (:func:`.score.truth_dpdf`).

``python -m nebula3d.validation --help`` lists the commands.

The dev cases are :data:`DEV_CASES`. The test split is held out in a module of
its own, which no one opens: ``cases("test")`` loads it with the opt-in alone
(``NEBULA_HOLDOUT_TESTS=1``, or the CLI's ``--report``) and raises
:class:`HeldOutError` without it.
"""

from .cases import (
    DEV_CASES,
    FAMILIES,
    HOLDOUT_ENV,
    SPLITS,
    Case,
    HeldOutError,
    all_cases,
    build,
    case_named,
    cases,
    holdout_opted_in,
)
from .score import TOLERANCES, score_outputs

__all__ = [
    "DEV_CASES",
    "FAMILIES",
    "HOLDOUT_ENV",
    "SPLITS",
    "TOLERANCES",
    "Case",
    "HeldOutError",
    "all_cases",
    "build",
    "case_named",
    "cases",
    "holdout_opted_in",
    "score_outputs",
]
