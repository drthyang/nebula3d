- **Validation: each run starts fresh.** The live runner reset only the
  settings between runs, so a run read what the run before left in the app:
  `run_log` the earlier run's log, `current_view` the page and cuts it moved,
  a tuning run it left going had every change refused, and a server found
  refusing tools once was asked without them for the rest of the plan. Each
  run is now `runCase`'s (`web/src/llm/evals/validationRun.ts`), which clears
  the pipeline store's settings and job (its log, its end), the tuning store,
  the console's view stores and the servers found refusing tools before the
  run, and selects the run's dataset; a pipeline run or a tuning run that a
  run cut short left going is stopped and waited for first. The token
  calibration carries over between runs by design, and each run's record
  keeps the one it started from (`tokens_at_start`, optional: the schema stays
  `nebula3d-validation-run/1`). Plan 1.2, the manager's decision on the
  user's delegation, 2026-10-19.
- **NEBULA Pilot: an earlier turn's result stops counting as a number's
  source once a later run recomputed its stage.** The answer checks took every
  earlier turn's tool result as a source for the next reply's numbers, so
  after the flatten was run again, a reply could quote the flatten's number
  from before the rerun. An earlier result now counts only while no run since,
  between the turns or in the reply, has recomputed the stage it measured, as
  a verdict's evidence already does (an assessment of several stages keeps the
  stages still standing). A number only such a result holds goes back to the
  model once, as measured before the last run recomputed the outputs it
  describes, and is noted under an answer that keeps it.
