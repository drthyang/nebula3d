- **Fixed: a changed edge trim or Laue class left later outputs in place.**
  A resumed run reused every cleanup output that existed, so after changing
  the edge trim only the symmetry average was made again, and ring removal,
  the punch, the backfill, the flatten and the ΔPDF needed Force. Each stage
  output now records what it was made from: its input (the raw file's size
  and a sampled content digest, or a digest of the earlier output's own
  record), the edge trim, the symmetry setting and the stage's settings; the
  ΔPDF records its input's digest the same way. A run makes an output again
  when its record no longer matches the run's settings, or when it is older
  than its input, and every output after it with it; without Force. Unchanged
  settings reuse everything, and a copied data folder (new dates, same files)
  is still the same input. The Configure page's stage track asks the backend
  which outputs the current settings would make again (`POST
  /api/pipeline/stale`, or the in-browser engine) and marks them stale before
  the run, with the reason in the tooltip ("it was made with edge trim 1,
  now 2"). Outputs written before this change record nothing to compare, so
  the first run after it makes them all again once.
