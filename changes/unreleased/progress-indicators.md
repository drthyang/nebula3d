- **Fixed: the progress indicators say what happened.** The Execution page
  kept "Running", its spinner and Cancel for a native run whose progress stream
  dropped (the server restarted, or the network): it now asks the job — follows
  it again while it runs, without logging its lines twice, takes its end when
  it ended, or says the run was lost. A completed run no longer calls the
  stages it was not asked for "queued", nor counts them ("6 of 6 stages
  complete" beside "4 / 6 done"): they read "not in this run", or **stale** when
  the run recomputed a stage before them and their old output remains, and the
  run counts its own stages. The dataset listing now dates each output
  (`mtime`), and Configure marks an output older than one upstream of it stale;
  its badges also refresh when a native run ends (they kept "missing" for up to
  five minutes). An in-browser run that was cancelled reads "Cancelled", not
  "Failed", and no longer claims its completed stages were saved: stopping the
  in-browser engine discards them. NEBULA Pilot steps and tuning trials still
  running when a reply or a tuning run was stopped, or ended by an error, are
  marked stopped (and queued trials "not run") instead of spinning on in the
  transcript, also when a saved transcript is loaded again.
- **Fixed: a dropped progress stream no longer fails a run that is still
  going.** After the stream dropped, one unanswered status request ended the
  run as "Failed at stage 1 … Lost the connection", although the job ran on
  and finished, and the fourth drop of a long run failed it even with the server
  answering; with the run no longer counted as running, another run could start
  writing the same files. The page now asks the job again with a back-off,
  following it again at every drop while its stream brings events; while the
  server cannot be reached the run stays running ("reconnecting to the
  server…"), and after 45 s it reads **Connection lost**: its end is not known,
  no stage is marked failed, no other run (Run pipeline, NEBULA Pilot, a tuning
  run) starts, and the page takes the job's real end when the server answers.
- **Fixed: a stale ΔPDF is no longer reused as current.** The pipeline reused a
  ΔPDF whose input name and settings matched although its input had been
  recomputed after it (a run with the ΔPDF switched off); a ΔPDF older than its
  input is now recomputed (also on the WebGPU path and in
  `examples/run_pipeline.py`). On the Execution page a stage that reused a stale
  output, or computed from one, reads **stale**, not done; staleness now runs
  down the chain (an output rebuilt from a stale one is stale), following the
  ΔPDF's link to the flattened volume only when the ΔPDF was made from it (the
  listing's new `source`); a tuning trial, which writes into its own folder, no
  longer makes the dataset's untouched outputs read stale.
- **Fixed:** a NEBULA Pilot step that the user stopped (Stop during
  `run_pipeline`, which cancels the run) reads "stopped", not as an error; a
  cancelled in-browser run refreshes the dataset listing (the outputs went
  with the engine).
