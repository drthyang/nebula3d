- **The validation's held-out test split lives in a module of its own, loaded
  with the opt-in alone.** Its crystal, faults and cases moved out of
  `nebula3d/validation/cases.py` into `nebula3d/validation/holdout/heldout_cases.py`,
  which no builder or agent opens; `cases.py` keeps the dev cases (`DEV_CASES`,
  which replaces `CASES`; `all_cases()` gives every case) and every builder.
  `cases("test")`, `all_cases()` and `case_named()` of a test case load it only
  with `NEBULA_HOLDOUT_TESTS=1` or the CLI's `--report`, and otherwise raise an
  error that says how to opt in, never an empty split.
  `python -m nebula3d.validation manifest` now needs `--report`, and `make`
  writes into its data root the manifest of the split it made. The cases are
  unchanged: a pinned sha256 of the test split checks it, an AST scan checks
  that the loader alone imports the module, and the held-out scan now allows
  test values in that module only. No test failure shows a held-out case any
  more (masked names, counts and digests; arm D names a test case's files by
  its masked name), and each failure path is checked on a made-up case.
