- **Regrid a dataset onto its refined UB, as a new dataset.** A UB turned by
  a fraction of a degree puts each Bragg peak beside its node, by the angle
  times |Q|. `nebula3d.analysis.ub_regrid.regrid_dataset` refines the raw
  volume's UB as `ub_check` does (one shared `check_ub`, so the turn it acts
  on is the one the check reports), regrids the volume onto it, and writes
  `<stem>_regridded.nxs` beside it. The new file records the UB before and
  after, the fit, the turn and the file its data came from (server:
  `POST /api/datasets/{id}/regrid`; browser: `webbridge.dataset_regrid_json`,
  with the same fields). It never overwrites: the raw file is only read, and
  the new one must lie in the data root, must not exist, and is created
  exclusively. When the fit cannot turn the UB, nothing is written and the
  reason comes back as data: a symmetrised volume without its unsymmetrised
  source, or a turn under the check's 0.05° rule. Symmetrising is optional
  and off by default; a symmetrised dataset keeps its operations. On
  synthetic crystals turned by 0.3° the turn comes back within 0.0015°, and
  the peaks sit on their nodes again. The Pilot's tool for it comes later.
