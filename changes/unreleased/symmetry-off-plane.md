- **NEBULA Pilot: `symmetry_check` tests the symmetry off the x–y plane.** It
  compared the 3D-ΔPDF's x–y section at one height with its images under the
  cell's in-plane operations only, so a ΔPDF could break an operation that
  moves c (a mirror ⊥ c, a two-fold ⊥ c, a cubic three-fold, the inversion)
  and pass; on the section through the origin even the two-fold ∥ c held by
  the inversion alone, which the transform keeps. It now tests each operation
  of the point group the raw file declares (`symmetry_ops`, closed into its
  group, acting on real space as its transpose) on the sections the operation
  maps onto sections: the x–y sections at `z` and −`z`, and the x–z and y–z
  sections through the origin, read as before. An operation that maps none of
  them onto one is tested on the voxels it maps from one onto another; one
  that mixes axes whose grid steps differ is not tested, and `not_tested` says
  why. Each operation reports `rms_difference` (its worst section's), `pairs`,
  `tested_on` and `moves_c`. The limit stays 1e-3, and an operation that
  moves c is judged as one that keeps it. Only the declared group is judged:
  a lattice operation the declared group lacks (the a ↔ b mirror of data
  symmetrised with 6/m, the four-fold of mmm on a square cell) is no longer
  tested; with no operations declared, the cell's in-plane ones are, as
  before, now on the x–z and y–z sections too. Known answers on constructed
  ΔPDFs, and dev-control symmetrised over m-3m through the default run (every
  one of its 47 operations within 2e-7), pin it (plan 4.3, the manager's
  decision on the user's delegation, 2026-10-19).
