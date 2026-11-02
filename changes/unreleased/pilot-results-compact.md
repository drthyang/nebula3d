- **NEBULA Pilot's tool results are more compact.** The model reads the same
  numbers in fewer tokens: radial_profile's shells, bragg_peaks' peaks and
  run_log's lines come as column tables (the column names once, a row of
  values per entry), and an answer may still name a value by its row and
  column. A ΔPDF feature's size carries its sign (−1520σ), so an answer that
  quotes it signed is no longer sent back. ub_check now gives its verdict
  with the angle and the 0.05° limit it was judged by, and assess_stage
  states a stage's whole criterion once in a reply, then only its limits.
