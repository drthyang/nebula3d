- **The Pilot judges the fills' texture over every punch hole in 3-D.**
  `texture_check` judged the fill bias on three cuts, where a hole crossed at
  its edge reads against a rim that lies off its node, and a peak off those
  planes (a satellite) is crossed at its pole or not at all. It now judges
  it by the volume's 3-D read (`nebula3d.analysis.fill_texture`, through
  `GET /api/volumes/{id}/texture` or `webbridge.volume_texture_json`): every
  hole with its 3-D rim, by the same rule and the same limits, which it asks
  for (`metrics/texture.ts`: a fifth of the local diffuse level, 0.5σ, three
  quarters of the holes one way, five holes judged). Its result is the
  summary over the holes (`n_holes`, `n_judged`, the medians in σ and in the
  level, the shares above and below the range and beyond the floor,
  `systematic_fill_bias`); on a grid too coarse for the holes' rims it
  measures no bias and says why (`not_judged`), as a cut did, and with fewer
  than five holes judged it gives no verdict either. The cuts carry the
  azimuthal texture only (`per_cut`: `cut`, `azimuthal_ratio`), and the
  figure is the H–K plane through the hole farthest outside its range. The
  verdict reads the 3-D summary; a result recorded by cut reads as it did.
- **A fill texture not judged keeps the run from "met".** No evidence never
  passes: as the ring removal on a grid too coarse for its check (G1), the
  fills' texture that `texture_check` could not judge, for a grid too coarse
  for the holes' rims or for too few holes (a new reason, "too few holes"),
  makes the run's verdict not judged, saying why: "not judged: the
  backfill's texture (grid too coarse)", or "(too few holes)", in
  `{{achieved}}` and in the report's goal ("Backfill's texture"), where it
  read "met" when every stage met its goal. The Backfill card still shows
  its seam's verdict, and its fill bias "not judged". A recorded result that
  judged nothing (no cuts) says nothing of the run, as before.
- The report's Backfill card says the fill bias over the holes ("no fill
  bias over 189 holes"), the backfill's criterion "the fills not biased one
  way", and the system prompt "no fills sitting systematically outside the
  range their rims allow". On the validation's dev cases the texture's
  verdicts are as before: at 161 points none of the eight has a systematic
  bias (the medians within 0.07 of the level, where the cuts read up to
  0.14), and at 81 points all eight are not judged, the grid too coarse for
  the rims in 3-D as on the cuts, so the control's run at 81 points is "not
  judged: the ring removal (grid too coarse for the ring check), the
  backfill's texture (grid too coarse)". On the constructed lattices of the
  Python half the verdict follows the volume: a fill equal to the truth
  passes, half the level too high in 80 % of the holes needs attention (0.8
  of them beyond the floor), satellites filled 12 % high as their nodes are
  read alike (every node and whole satellite beyond the floor), and a grid
  too coarse is not judged. What the model reads is smaller: 370 characters
  where 802 were on the synthetic crystal, and the worst local turn 263
  tokens less; a shortened result now keeps the 3-D numbers, where the cuts'
  list kept none.
