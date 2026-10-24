- **Validation: the paid model's reserve takes every request at its output
  cap, a later run's never falls below it, and a second tuning in one run
  starts only if the budget covers it.** The spend tracker charges a run only
  after it ends, so the reserve it holds before a run starts is what keeps the
  $12 cap. The first run's reserve now takes the agent loop's output at its
  hard bound, 13 requests (12 rounds of tool calls and the answer) of 16,000
  tokens each (`VALIDATION_MAX_TOKENS`), in place of 16,000 over the whole
  run: the loop's 13 × 40,000 in and 13 × 16,000 out ($1.04 + $2.08) and one
  tuning's 15 × 12,500 in and 15 × 16,000 out ($0.375 + $2.40), $5.895 at
  Sonnet 5.5's price, with a 25% margin $7.37 (it was $5). Every count is read
  from the constant that decides it. A later run is held to the larger of
  $7.37 and 1.5 times the dearest run so far (it was 1.5 times the dearest
  alone, which after cheap runs fell far below a run that tunes). A run that
  asks for a second tuning starts it only if the budget left beyond its
  reserve covers one more tuning at its hard bound with the margin, $3.47;
  otherwise the call is not run, the model reads why, the run goes on, and
  its record (`tuning_budget`, optional, the schema unchanged) and transcript
  keep the skip. The cap stays $12, and no run starts while the spend and its
  reserve pass it. Decided by the manager on the user's delegation,
  2026-10-24; option (a) confirmed by the user.
