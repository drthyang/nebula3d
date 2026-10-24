- **Fixed: the Configure page's *Enable stage* switches for the ring removal,
  the Bragg punch and the backfill did not switch the stage off.** The page
  sent them only as stages left out of the run, and
  `nebula3d.pipeline.run_pipeline`, which the server and the browser run,
  reads a stage left out as a partial re-run: the next stage took that
  stage's output an earlier run had left on disk. With the ring removal off
  after a run that wrote its volume, the punch read that ring-removed volume,
  not the raw input, and the run's outputs were the earlier run's. Each of the
  three now has its own switch, as the flatten has
  (`PipelineParams.rings_enabled`, `punch_enabled`, `backfill_enabled`), which
  the page sends with every run (`StageParamsIn` on the server, the same
  fields in the browser). A stage switched off is not run and passes its
  input through: the next stage reads what came before it, never an output an
  earlier run left, in the processed folder or among a tuning trial's inputs,
  and the browser's WebGPU ΔPDF takes the same volume as the CPU path. Its own
  output from an earlier run stays on disk as it was, as the flatten's does.
  The log names the volume the stage after it reads ("ring removal disabled:
  the Bragg punch reads …"). A stage left out of the stages to run with its
  switch on is still a partial re-run, as the assistant's runs from a stage
  and the tuning's trials need. Runs with every stage on, and with a stage off
  from scratch, give the same outputs as before, bit for bit. As before, a run
  with *Force* off keeps the outputs that exist: after switching a stage off,
  turn *Force* on for the stages after it to be recomputed.
