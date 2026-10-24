- **A sample's modulation can be declared, and the Bragg punch records what its
  search left alone; no run changes yet.** A modulation of wave vector k puts
  satellites at G ± m·k, which the punch's search pass takes for spurious
  peaks. `PipelineParams.modulation` declares it as a fact about the sample,
  beside its symmetry (`nebula3d.modulation.Modulation`: the k vectors as
  exact fractions, the order, the form and the half width). In the points form
  (the default) it protects the satellites G ± m·R·k, R over the point group.
  In the planes form it protects the planes through them, `t·x ≡ ±m·(k·t)
  (mod P)`. Either way it is on the parent lattice of the punch's cell, and
  the protection is the same at every equivalent position, so the punch shared
  across the symmetry orbit keeps it.

  Until the console asks the user (plan 4.15), a run that declares nothing
  declares the planes the search protected before, H = n ± 1/3 ± 0.08 r.l.u.,
  as k = (1/3, 0, 0) in plane form. That reproduces them bit for bit: on every
  dev case of the validation at 81 and 161 points the punch's holes, records
  and log are as before, and arm A is unchanged. For Python callers:
  - `PunchParams.search_exclude_h_fractions` now defaults to None. Its legacy
    fields still protect what they name, added to the declaration.
  - A direct `punch_bragg` call protects only the `modulation` it is given.
  - The request's `punch_search_protect_h` and `punch_search_protect_half_width`
    keep their meaning.

  The punch's record (`*_braggpunched_profile.json`, served by
  `GET /api/bragg/{id}/profile` and the bridge's `bragg_profile_json`) keeps
  what its search left alone (`modulation`: the declaration, the cell, the
  symmetry, the legacy planes) and whether its sharp peaks off the lattice
  bunch at one commensurate fraction (`bunching`), as an undeclared modulation
  would make them. The test is a binomial tail, family-wise at 1.35·10⁻³
  (one-sided 3σ) over the coordinates and denominators the grid resolves, with
  at least three hits; its log line says so when it fires, and it fired on no
  dev case.

  `POST /api/modulation/check` (the bridge's `modulation_check_json`) says what
  a declaration protects before a run. `GET /api/modulation/{id}/labels` (the
  bridge's `modulation_labels_slice`) gives which protected position each voxel
  of a slice of the punched stage lies in, read from the run's record, not the
  form. `peak_profile.magnetic_satellite_centers` no longer assumes the thirds:
  its `fractions` are the caller's to give.

  The physics, the record and a known limit are in `docs/modulation.md`: the
  recorded peak widths cannot tell a broad maximum from a sharp one.
