- **A peak the punch's search protects now comes through the search whole.** A
  behaviour change (bug fix) wherever the flank of a protected peak was
  punched. Protected peaks are the declared modulation's satellites or planes
  (`PipelineParams.modulation`) and the legacy `search_exclude_h_*` planes.
  - **The bug.** The search left a protected position's voxels out of its
    candidates and also out of its local-maximum test, where they counted as
    −∞. So the voxel beside a protected peak could be a local maximum, and
    above the search floors it became a search peak whose punch took the
    protected peak with it.
  - **The fix.** The protected voxels count in the local-maximum test with
    their own values, so a voxel beside a brighter protected peak is its
    flank, not a peak. They are still never candidates, and no search peak's
    punch takes them. The node test, the integer pass's punches, the incident
    beam's punch and every threshold are unchanged. With nothing protected the
    search is as before.
  - **On test data.** On 6/m test data with satellites wider than their
    ± 0.08 r.l.u. protection, 198 of 216 satellites were punched with the
    points declared, and none are now. With the planes declared none were
    punched before or after. Satellites nobody declared are all still punched.
  - **On the validation.** With today's default (the planes H = n ± 1/3),
    the dev cases' punched holes, records and log at 81 and 161 points are as
    before, and arm A is unchanged. `docs/modulation.md` has the numbers.
