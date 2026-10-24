- **NEBULA Pilot: the flatten is judged over the run's own fit range and
  floor percentile.** Its numbers (the floors in thirds of |Q|, the largest
  floor in σ, the floor trend and span over the outer half of the shells the
  counts reach) were taken over the flatten's default fit range, 0.8–10 Å⁻¹,
  at the 25th percentile, whatever the run took. They are now taken over the
  range and at the percentile the run's flatten recorded in its output,
  which the volume's meta returns (`GET /api/volumes/{id}/meta` and the
  browser's `volume_meta_json`, `flatten_settings`; `null` for a stage the
  flatten did not write). The Configure page's settings are not read for it:
  they may have changed since the run, and only the file says what made it.
  A file written before the flatten recorded its settings is judged with the
  defaults, as before, and `assess_stage` and the chat's context say so. A
  run with the default settings reads as before (plan 4.11, the manager's
  decision on the user's delegation, 2026-10-19).
