- **Fix: NEBULA Pilot no longer sends back a true claim about a stage it just
  tuned.** A reply that tuned a stage (`tune_pipeline`) and then said the stage
  passed was held to the check from before the tuning, because a tuning runs its
  trials in a tuning folder and writes no output until the pipeline runs again,
  so that older check was still the newest on record. In auto mode this sent
  back the fix reply's "the pedestal is removed" as a contradiction (THY-82).
  The tuning now judges the trial it keeps for each stage, by the checks' own
  rule and numbers, and the answer checks hold a claim about that stage to this
  verdict: a claim the kept trial bears out is not sent back, one it does not
  bear out still is, and a check after the tuning, or a run that recomputes the
  stage, comes after it as before. Every verdict is still a tool's, never the
  model's. The run's verdict ({{achieved}}), the report, the ring gate and auto
  mode's problems and plan still read the outputs on disk alone. Nothing the
  model reads changes.
