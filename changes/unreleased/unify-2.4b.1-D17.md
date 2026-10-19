- **NEBULA Pilot: a repeated tool call no longer hides the verdict it
  repeats.** When the model calls a check again with the same arguments,
  `{{achieved}}` and the answer checks read the earlier result the loop
  points to: a `qmax_coverage` "too far" still leaves the run not met, and a
  repeated `ub_check` no longer reads as a right UB (review entry D17,
  approved by the manager on the user's delegation, 2026-10-19).
