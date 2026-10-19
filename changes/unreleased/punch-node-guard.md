- **On a grid too coarse for its background shell, the Bragg punch no longer
  punches the nodes its node test cannot judge.** A behaviour change: the
  node test (`integer_detect="significance"`, the default) takes each node's
  background from the median of the measured voxels between 1× and 2× the
  resolution ellipsoid R, and a median needs 8 of them (the test's own floor,
  now named `_SHELL_MIN_VOXELS`). With fewer it fell back, silently, on the
  window's median, which passes the diffuse at a node: on the validation's
  dev crystal at 81 points (0.161 Å⁻¹ a voxel) the shell held 2 to 6 voxels
  at 96 % of the nodes, and 29 to 106 forbidden nodes per case were punched,
  a quarter to a half of the punched voxels, all diffuse. Now a node whose
  shell holds fewer than 8 measured voxels, counted node by node (the count
  varies with the direction of Q, the mask and the box's faces), is not
  judged. With `mode="both"` (the default) it is left to the search pass,
  which punches it if it stands out of its |Q| shell, so weaker Bragg peaks
  may remain, and so may those in a |Q| shell too thin for the search (under
  20 voxels, at the box's far corners). With `mode="integer"` it is judged
  against its window's median as before, provisionally (the manager's
  decision on the user's delegation, 2026-10-19, review finding G2). The
  grid's limit comes from R and the floor: the shell is 7 times R's Q-volume,
  so 8 voxels need a voxel of (7π/6)·rρ·rθ·rφ or less, 0.143 Å⁻¹ a cubic
  voxel at the default R (`BraggRemover.node_test_limit`; a voxel's size is
  the edge of a cube of its Q-volume, `voxel_edge_q`). On a grid coarser than
  that the punch says so out loud: its done line ends on a notice, marked ⚠,
  such as "grid too coarse for the Bragg punch's node test: a voxel is 0.161
  Å⁻¹; its background shell needs ≤ 0.143 Å⁻¹. 703 of 728 nodes were not
  judged and were left to the search pass; weaker Bragg peaks may remain. Use
  a finer grid." (with `mode="integer"`: "… were judged provisionally,
  against their window's median; diffuse maxima at nodes may be punched. Use
  a finer grid."). Its line on the integer nodes counts them on any grid,
  and its record (the punch's profile JSON) keeps them as `node_test`, served
  by `GET /api/bragg/{id}/profile` and the bridge's `bragg_profile_json`. The
  Execution page shows the punch's done line as a warning; `run_log` gives it
  as written. On the dev cases at 81 points no forbidden node is punched any
  more (on the ring cases the four and two on the planted 4.05 Å⁻¹ ring,
  which the ring removal leaves at this grid, aside), the ⟨3/2 0 0⟩
  correlation the forbidden punches had cut to 0.77–0.79 on three cases is
  back to 0.89–0.93, and broad maxima planted at the (1,1,0) nodes go
  unpunched. The search pass punches the Bragg peaks there with smaller
  holes (from 8 integer peaks the punch learns no Bragg profile), and misses
  those at the box's corners. At 161 points every node's shell holds 9
  voxels or more: the punch, and arm A, are as before.
