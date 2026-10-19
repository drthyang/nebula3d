- **Arm A's test-split results are a held-out record.** The table and its
  reading left `docs/evals.md`, which keeps the dev table, a dev-only reading
  and a pointer, for `docs/evals/validation/holdout/` (with `arm-a-test.json`,
  moved there), which no one opens. `python -m nebula3d.validation arm-a
  --split test --report` writes only into such a folder (`--out` with a
  `holdout` folder in its path) and prints how many cases pass, never the
  cases. The held-out scan reads every other doc, `docs/evals.md` included,
  and also finds arm A's scores on a test case (its amplitude shares with its
  pedestal) and vectors written with ½ or 3/2.
