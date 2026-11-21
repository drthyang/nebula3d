- **Pilot checks: a cut's metrics are computed once.** `assess_stage` computed
  every stage's slice metrics again for each stage it judged, and the report's
  final checks did so once more. The metrics are now kept with the slices they
  were computed from and reused while those slices are the same, bit for bit.
  A run, a tuning trial or a promote that changes a stage's output changes its
  slices, so its metrics are computed again; a fix put back gets the earlier
  numbers back. The slices are still read on every check, so nothing depends
  on dates or on the dataset listing. Closing the volume empties the store.
  On a large volume (about 50 million voxels) a repeated check of one stage
  now takes a fraction of a second. No number a check reports has changed.
