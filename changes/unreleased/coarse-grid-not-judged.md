- **On a grid too coarse for them, the ring check and the texture check now
  say "not judged", with the reason, and give no verdict.** No evidence never
  passes, applied to resolution: a check that cannot resolve what it judges
  says so. Each limit is the check's own. The powder-ring test (which shells
  rise in nearly every direction, `nebula3d.preprocessing.ring_isotropy`)
  needs one voxel or more across the widest ring it judges (its narrowest
  FWHM, two |Q| bins of half a voxel, within its 0.16 Å⁻¹ cap), and a grid
  that gives at least 90 % of a shell's direction cells 5 voxels in every bin
  of its profile; else "grid too coarse: …" (`grid_too_coarse`, and each
  shell's `not_judged`). The ring removal then subtracts no shell it cannot
  confirm, and its log says how many it could not judge and why (it called
  them the crystal's own); the Pilot's ring check (`assess_stage` rings) is
  not judged, its reason in `ring_rule`, with a bump on its planes or none
  (`GET /api/volumes/{id}/rings` takes no shell too, and gives the grid's
  `not_judged`). The fills' texture (`texture_check`, and
  `nebula3d.analysis.fill_texture` in 3-D) needs the grid's nodes 2·(r + 4)
  voxels apart or more for its median hole, reaching r voxels, to keep its
  rim on its own side of the midpoint to the next node; else a cut says why
  (`not_judged`), measures no bias (`systematic_fill_bias` null), and the
  check passes only when every cut was judged (3-D: `not_judged`,
  `node_spacing`, `room_needed`). It is the voxel's size that counts, not the
  number of points: on the validation's dev crystal, 81 points over ±4 r.l.u.
  are too coarse for both (0.99 voxels across 0.16 Å⁻¹; the nodes 10 voxels
  apart, where the holes' rims need 11 to 14), and 161 points are not (1.99;
  20). The replays' four expected failures at 81³ (a false ring at 1.75 Å⁻¹,
  the crystal's shell at 2.9 Å⁻¹ never seen) and the fill biases
  texture_check flagged there are now "not judged"; on 161³ every known
  answer and arm A are as before. On a fine grid nothing changes but the
  shells near |Q| = 0 whose direction cells the grid cannot fill (under 1.1
  to 1.2 Å⁻¹ at 0.081 Å⁻¹ a voxel): those are now not judged.
- **On a grid too coarse to confirm a ring, the ring removal subtracts no
  unconfirmed ring, and says so.** A behaviour change: the pooled ring removal
  confirms its rings with the powder-ring test (`pooled_confirm_rings`, on by
  default), so on such a grid it confirms none of the shells it detects and
  subtracts none of them, powder rings included, where before it would have
  subtracted what the test, unable to resolve them, called rings (the
  manager's decision on the user's delegation, 2026-10-19, review finding G1).
  It says so out loud: its log line ends on a notice, marked ⚠, such as "4
  rings detected but not confirmed at this grid (needs ≥ 1 voxel across
  0.16 Å⁻¹); not subtracted. Use a finer grid, or set
  pooled_confirm_rings=False to subtract every detected ring.", with the
  count and what the grid needs, from the test's own constants
  (`grid_needs`), and the two ways out. Its diagnostics record it
  (`unconfirmed_at_grid`: the count, the need, the notice, the shells' |Q|),
  served by the new `GET /api/rings/{id}/diagnostics` (the bridge's
  `ring_diagnostics_json`), so the console says it wherever the ring stage
  reports: the Execution page shows the stage's line as a warning, the
  Pilot's ring check (`assess_stage` rings) gives it first (`notice`), the
  report puts it on its ring card and among its caveats, and `run_log` shows
  the line. The validation's arm C reads the notice without its remedy (a
  remedy span, `verdicts/rules.ts`). The verdict on the run says why the ring
  removal is not judged, "not judged: the ring removal (grid too coarse for
  the ring check)", where it said "not measured since it was last computed"
  (the report's goal likewise). On the validation's dev crystal at 81 points
  the removal leaves three shells unconfirmed on dev-rings, the two planted
  rings among them; at 161 points none, and its log reads as before.
  `pooled_confirm_rings` is a setting of the Python API: the console does not
  offer it.
