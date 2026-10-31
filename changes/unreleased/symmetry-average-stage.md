- **Symmetry averaging in the pipeline (stage 0, optional).** A volume that is
  not symmetrized no longer needs a round trip through the NeXus Viewer: the
  new first stage averages it over the sample's Laue class (a preset such as
  6/mmm, or generators) by the viewer's rules, and its gaps fill from their
  symmetry equivalents. Each voxel takes the equal-weight mean of the measured
  voxels among its equivalents, the result equal to the viewer's export bit for
  bit (pinned against the viewer's own code). The stage refuses operations
  that do not map the grid onto itself or change the cell's metric by more
  than 2 % (*Proceed despite the metric change*, under Advanced, averages over
  the latter anyway and records a warning), always trims the raw coverage edge
  first, and writes
  `<stem>_symmetrized.h5`, which declares its operations as the viewer's export
  does; the stages after it treat equivalent voxels alike and declare the
  symmetry in their own outputs too. Off by default; an input symmetrized
  already passes through.
- **Configure page:** the stage's section (stage 0) with the Laue class picker
  and an editable generators field, the run's reading of it ("24 operations,
  pooled with equal weight. Metric (UB) kept to 0.00%", or why it would refuse),
  the class declared for the volume by the viewer's export beside it (**Use
  it**), and *Average again* under Advanced. The outputs on disk and the
  Reciprocal cleanup page show the symmetrized volume.
- **"Symmetrize here":** when the 3D-ΔPDF stops because the coverage gaps reach
  Q = 0 (its message now names this remedy), the Execution page offers to
  switch the symmetry average on, with the class chosen or declared for the
  volume, and opens it on the Configure page.
- **NEBULA Pilot** reads the stage's settings but never sets them, the
  metric override included: the Laue class is the user's, and the Pilot
  suggests one instead. Its symmetry check,
  grain check and the tuning's 3D-ΔPDF evaluation read the point group from the
  volume the data came from.
- **One σ for a symmetrized volume:** the regrid's optional symmetrising now
  uses the same function as the stage, so its σ is the mean's, √(Σσ²)/n, as
  in the NeXus Viewer's export (it was the orbit's RMS σ).
- A Mantid SaveMD file without `errors_squared` (the NeXus Viewer's synthetic
  examples) loads, with σ = √|I| flagged as estimated, instead of stopping
  with a KeyError.
