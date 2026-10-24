- **NEBULA Pilot's `qmax_coverage` measures the coverage once, in Python.** It
  measured it twice: on the three principal planes in the browser (a voxel
  "measured" when finite) and in `nebula3d.analysis.coverage` (a voxel holding
  counts when measured, finite and non-zero). It now reads the Python module
  alone, through either adapter (`GET /api/volumes/{id}/coverage`, the
  webbridge's `volume_coverage_json`), on the raw volume's |Q| shells in 3D;
  the planes only show where. `full_coverage_q` is where the shells stop
  holding counts in 95 % of their voxels, the number `raw_counts` gives, so a
  box measured to its corners now reads full coverage past its faces (the dev
  control: 10.85 Å⁻¹ on 81³, where the planes read the face, 6.44). The result
  drops `per_plane` and `low_q_gap` (`raw_counts` gives the lower edges) and
  is about half as long (1,147 characters on the synthetic crystal, from
  2,135). The coverage response also gives `measured_q_max`, where the shells
  stop being fully measured (the ΔPDF window's support), and `q_step`, the
  shells' width.
- **The coverage verdict on a volume that stores zeros for unmeasured space.**
  Such a volume marks the zeros measured: the ΔPDF window's support takes them
  as data and the backend fits no window to the coverage, while the old check
  counted them as measured too and passed. `qmax_coverage` now reads where
  the counts end, says the taper cannot follow them, and needs attention when
  the transform reaches past them, with a |Q| band as the remedy. A separable
  window the Configure page asks for is no longer taken as tapered to the
  coverage: the backend fits only an auto or ellipsoid window. No dev case's
  verdict changes kind; those whose verdict rests on the reach (no recorded
  window weight: five on 81³, three on 161³) give the new full coverage.
