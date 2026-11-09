- **The punch check sees what the punch leaves beside its holes (THY-43).**
  The leftover scan now judges the maxima at a punch hole's rim, which it used
  to skip: a Bragg peak whose shape the footprint does not follow (a doublet,
  a streak, a width growing with |Q|) leaves its excess there. A maximum
  beside a Bragg node's hole, or within 0.25 Å⁻¹ of its peak, holding 3 % or
  more of that peak's height is a Bragg tail, and the punch needs attention
  for it; under 3 % it is a faint rim, counted and not judged. A peak is at a
  node within two voxels along each axis of the slice (it was 0.12 r.l.u.,
  under one voxel along a long cell axis). The direct beam's neighbourhood and a
  declared satellite are never tails. The backfilled planes are scanned too:
  `left_after_backfill` counts what the fill left at nodes and as tails.
  `assess_stage`'s punch drops the derived counts (`total_leftover_peaks`,
  `leftover_off_lattice`, `leftover_on_protected_planes`,
  `noisy_spikes_skipped`) and the strongest leftover's raw intensities, which
  pays for the new ones. The Highlights draw tails (red squares) and faint
  rims (grey).
- **NEBULA Pilot senses the Bragg peaks before a run (THY-43).** A new
  pre-run tool, `bragg_sense`, reads six raw sections (0kl, h0l, hk0 through
  0 and 1) and measures the strong peaks' shapes as the punch's fit would:
  tilt and elongation, lobes, where the fit's cap binds, and the share of each
  peak every footprint would leave with the run's own punch settings (seconds
  on a large volume, both engines). Its rule, set conservatively (see THY-43),
  names the method settings the peaks ask for: the
  ellipsoid footprint where it leaves less than the default (or no more, on
  tilted or lobed peaks), its fit's constraints dropped where the cap binds
  and unconstrained leaves less; never a footprint that leaves more than the
  default. A reach that grows with |Q| is said, not set. Data symmetrised
  already that declare no symmetry get a card to declare it (the symmetry
  average over the class), the user's click alone. The Pilot sets the method
  settings with `update_settings`, citing the numbers (bragg-node-audit,
  "Before a run"); auto mode's preflight runs it; the flagged peaks are drawn
  on the raw view as their fit's ellipse. On a grid too coarse for a peak's
  shape it judges nothing, and says why.
- **"Drop fit constraints" says it acts only with the ellipsoid footprint**,
  on the Configure page and in the settings the Pilot reads.
