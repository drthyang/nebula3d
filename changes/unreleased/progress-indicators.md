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
