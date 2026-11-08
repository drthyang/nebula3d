- **The Pilot's validation re-baselined, paid (THY-52, 2026-11-07).** It ran on
  the dev split only, on the fixed graders, and is the new frozen baseline:
  `docs/evals/validation/baseline-2026-11-07/`.
  - gemma4:26b at 32k passes 5/8 against the old baseline's 3/8 (re-graded).
  - Claude Haiku 5.5 passes 9/24 runs in arm B and 6/24 in arm C. Sonnet 5.5,
    on the pairs Haiku failed, passes 9/13 in B and 11/18 in C.
  - No unsafe action in any run.
  - $4.57 measured, $19.31 on the ledger against the $40 cap (two timed-out
    runs were charged at the reserve).
