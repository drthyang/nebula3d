- **NEBULA Pilot: a UB check on a symmetrised volume no longer hides an
  earlier UB finding.** Such a check cannot judge the UB, so after
  `grain_check` finds the UB off, `{{achieved}}` still names the problem and
  an answer that calls the UB right is still sent back; after an earlier
  `ub_check` that judged the UB, that verdict stands. Alone, it still sends
  back a claim that the UB is right (review entry D7).
