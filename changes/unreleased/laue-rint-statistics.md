- **Compare Laue classes: honest standard errors, χ²/dof and a common-subset
  check.** Neighbouring voxels share noise and errors through the resolution,
  so the orbits are not independent samples and their standard errors were
  too small (a third of the true spread on noise correlated over a voxel).
  The errors now come from a spatial block bootstrap (200 resamples from a
  fixed seed): every orbit sits in the block of its representative under the
  largest class compared, so a class and its subgroups are resampled on the
  same voxels, and the rule tests each class's excess over its subgroup
  against two standard errors of that difference. The block edge follows how
  far the residuals stay correlated (4 voxels at least). A **χ²/dof** column
  (1 = agreement within the counting noise) sits beside R_int, and a
  diagnostic reads every class again on the voxels the lowest class can
  judge: a warning when the suggestion changes there, a sign of errors that
  differ between regions of the coverage. Every earlier known answer holds
  ([laue_compare.md](docs/algorithms/laue_compare.md)). NEBULA Pilot's
  `compare_laue_classes` gives χ²/dof and the flag in the same result size.
