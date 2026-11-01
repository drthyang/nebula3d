- **reduction-qc reads the Laue comparison** (THY-59, skill text awaiting
  the user's review). Its Details gain a part on `compare_laue_classes`: what
  R_int, `x_noise` and χ²/dof mean, which voxels count (only measured ones;
  an empty voxel is never a zero), why classes see different voxels and why
  that is evidence, how the relative test cancels shared errors and leans to
  a class too low, the limits (correlated voxels, region-dependent errors and
  the common-subset flag, twinning), how to read each flag, and that the class
  is the user's to set. The rule's two numbers (10 % and two standard errors)
  are among its gates; the algorithm page is among its references.
