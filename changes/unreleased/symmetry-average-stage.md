- **Symmetry averaging in the pipeline (stage 0, optional).** A volume that is
  not symmetrized no longer needs a round trip through the NeXus Viewer: the
  new first stage averages it over the sample's Laue class (a preset such as
  6/mmm, or generators) by the viewer's rules, and its gaps fill from their
  symmetry equivalents. Each voxel takes the equal-weight mean of the measured
  voxels among its equivalents, the result equal to the viewer's export bit for
  bit (pinned against the viewer's own code). The stage refuses operations
  that do not map the grid onto itself or change the cell's metric by more
  than 2 %, trims the raw coverage edge first, and writes
  `<stem>_symmetrized.h5`, which declares its operations as the viewer's export
  does; the stages after it treat equivalent voxels alike and declare the
  symmetry in their own outputs too. Off by default; an input symmetrized
  already passes through. The 3D-ΔPDF's "no measured region around Q = 0"
  message now points to it ("Symmetrize here").
- A Mantid SaveMD file without `errors_squared` (the NeXus Viewer's synthetic
  examples) loads, with σ = √|I| flagged as estimated, instead of stopping
  with a KeyError.
