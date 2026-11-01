- **Which Laue class: the candidates compared by R_int.** The symmetry
  average's section has **Compare Laue classes**: every Laue class the cell's
  metric allows (the stage's own 2 % check) and whose operations map the grid
  is compared by R_int on the raw volume as the stage reads it, on every
  measured voxel and on the diffuse (the punch cell's Bragg nodes masked), in
  units of its noise floor (what counting noise alone gives on the same
  orbits). A table shows each class, its operations, both R_int and the orbits
  compared, indented by the chain of its subgroups, with the classes refused
  and why; the suggested class is the one with the most operations whose R_int
  stays within 10 % (and 2 standard errors) of every subgroup's, with the rule
  and the numbers that drove it, and none when even whole |Q| shells stay at
  the noise. A ⚠ flags a diffuse that supports less symmetry than the Bragg
  peaks. One click on a row sets the Laue class; the user runs it. Twinning
  can make a lower class look higher, which R_int cannot tell
  ([laue_compare.md](docs/algorithms/laue_compare.md)). Also in the API
  (`POST /api/volumes/{id}/laue-compare`, with progress) and the browser.
- **NEBULA Pilot: `compare_laue_classes`.** The same table and suggestion,
  compact for local models; the system prompt asks for it before the model
  suggests a class, which stays the user's to set.
- **The raw edge trim is a visible setting**, *Edge trim* in the symmetry
  average's section (0 to 3 voxel layers, 1 by default), and it applies to
  the raw input whether or not averaging is on. Its rule is the NeXus Viewer's
  "Edge erosion", voxel for voxel, pinned against the viewer's own code; a
  voxel whose value is NaN now counts as unmeasured, as in the viewer, so its
  neighbours are trimmed too. NEBULA Pilot changes it only when the user's
  latest message names it.
