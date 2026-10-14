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
"""

from .cases import CASES, FAMILIES, SPLITS, Case, build, case_named, cases
from .score import TOLERANCES, score_outputs

__all__ = [
    "CASES",
    "FAMILIES",
    "SPLITS",
    "TOLERANCES",
    "Case",
    "build",
    "case_named",
    "cases",
    "score_outputs",
]
