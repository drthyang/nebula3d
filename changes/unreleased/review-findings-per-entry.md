- **The review's findings are one file per finding**, in
  `docs/evals/validation/review-findings/`, so that pull requests adding
  findings no longer collide. The 34 findings recorded before keep their order
  (`001-…` to `034-…`); a later one is named after its ref. The tests read them
  through `web/src/llm/evals/reviewFindings.ts`.
