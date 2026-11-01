- **The punch reads a slightly turned UB off its peaks, follows it, and sweeps
  the tails it leaves (THY-60).** A UB turned in the reduction displaces each
  Bragg peak by ω × q (across Q, growing with |Q|) and smears it the same way,
  so far out the punch left a tail beside the hole and the backfill made it a
  bright spot. The punch now fits one rotation to its strong peaks' centres
  and records it (angle and its error, axis, the share of the offsets it
  explains, an F-test against none). Only when the turn is significant
  (p < 0.001), explains the offsets (R² ≥ 0.5) and shifts peaks by half a
  voxel or more: round 1 stretches each node's punch by |ω|·|Q| along ω × q̂
  (*Follow a turned UB*, on), and round 2, the tail sweep (*Tail sweep*: Auto,
  the default, Off or On), adds to the holes the tail beside each node along
  ±ω × q̂: voxels 5σ above the diffuse at their distance, connected to the
  hole, confined to the search region, no wider than the peak, within per-node
  and per-shell caps, outside the declared modulation and the H guard. The
  backfill then runs once, on the union. Every swept voxel is recorded (code 2
  in the punch record, and in the profile), with before/after numbers. Not on
  symmetrised data, where a turn shows as rings; nothing changes on a volume
  without a turn. The remedy stays upstream: refine the UB in the reduction;
  the console offers no regrid for it. The Bragg profile page and Configure
  say the turn in one line (details behind "?") and draw the swept voxels in
  magenta; NEBULA Pilot's punch assessment carries it (`ub_turn`) and
  bragg-node-audit says how to read it. See docs/algorithms/turned_ub.md.
  Existing punch outputs read as stale once (two new punch settings).
