- **Fixed: with the flatten off, the ΔPDF transformed a flattened volume left
  by an earlier run.** `nebula3d.pipeline.run_pipeline`, which the server and
  the browser run, finds each stage's input by walking back the cleanup
  stages, and it took the flattened volume on disk even with the flatten
  switched off (`PipelineParams.flatten_enabled=False`, the page's flatten
  switch). A run with the flatten off after one with it on then transformed
  the old flattened volume, its background removed, while its log said
  "flatten disabled (no background removed)" and `PipelinePaths.pdf_input`
  named the backfilled one; without *force* it even kept the first run's ΔPDF
  and back-FFT check as current. A stage switched off now passes its input
  through without reading an output an earlier run left, in the processed
  folder or among a tuning trial's inputs: the ΔPDF takes the run's
  backfilled volume, and a ΔPDF made from another volume is recomputed. When
  the flatten is off, the ΔPDF stage's log names the volume it transforms
  ("flatten disabled: the ΔPDF transforms …, with no background removed"),
  in the browser's WebGPU path too. Runs with the flatten on, and with it off
  from scratch, give the same outputs as before, bit for bit.
