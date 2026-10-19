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
