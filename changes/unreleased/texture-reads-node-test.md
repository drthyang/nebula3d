- **On a grid too coarse for the Bragg punch's node test, the fills' texture
  in 3-D is now "not judged".** A behaviour change: where the punch's record
  (its profile JSON beside the punched stage) carries its node test's notice,
  a voxel too coarse for the background shell the test reads, so the punch
  left the nodes to its search pass (review finding G2), the 3-D texture read
  (`nebula3d.analysis.fill_texture`, `GET /api/volumes/{id}/texture`, the
  bridge's `volume_texture_json`) judges no fill, whatever room its holes
  leave their rims: `not_judged` is "grid too coarse (the punch's node test
  could not resolve the holes at this grid)" and `systematic_fill_bias`
  false, the holes and the summary measured as before. The reason opens with
  the words every reason the grid gives opens with, so the Pilot reads it as
  a grid too coarse (`isTooCoarse`). The notice is read from the record
  (`nebula3d.pipeline.read_node_test_notice`, new; `fill_texture` and
  `judge_fill_bias` take it as `node_test_notice`): no new limit, the punch's
  own 8-voxel shell floor (the manager's decision on the user's delegation,
  2026-10-24, review finding G3). On a coarse grid the holes are the search's
  peaks, each punched to its own width, and the rim's room no longer stands
  for its trend: on the validation's dev crystal at 81 points the holes reach
  1 voxel at the (111) nodes and 2 at the (200) ones, so on the dev-coverage
  case, whose counts end before the higher nodes, the median hole left its
  rim room by the rule's count (10 voxels, as far apart as the nodes), while
  the rim, 4 voxels deep, spanned 0.2 to 0.5 r.l.u. from the node and read the
  diffuse rising toward the next nodes; the read judged its fills and found a
  systematic bias above (0.52σ, 0.21 of the level, 14 of 15 holes) that was
  the rims', not the fills'. Now every dev case at 81 points is not judged
  for this reason (seven were before, by the room rule); at 161 points, where
  the node test resolves every node, every dev case's read is as before, hole
  for hole, and so is arm A.
