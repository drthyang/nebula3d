- **NEBULA Pilot's coverage verdict says what it can judge.** With the ΔPDF's
  window fitted to the coverage (the support on, an auto or ellipsoid window),
  the backend keeps at most 1e-3 of the window's weight on unmeasured space,
  shrinking the window where it must, and `qmax_coverage` judged that weight
  against the same 1e-3, so its "clean" held by construction. It now opens "fitted to the
  coverage", says the weight (or, with no ΔPDF weight recorded, the taper's
  reach) is the backend's own target, not a check, and judges what it can:
  where the raw counts end (batch 1's sentence and data problem, as before)
  and a |Q| band that is set, which needs attention past the counts' edges
  ("too far: Qmax past the counts' upper edge …", the reason `band past
  counts`), the user's rule; inside them it passes. Without the fit (the
  support off, a separable window, zeros stored past the counts) the verdict
  judges the weight or the reach as before, and no longer says the window's
  taper keeps the transform on the counts. A band set without a Qmin starts
  at 0, as the run takes it: `band_check` no longer calls it below the
  counts' lower edge when the counts begin at the origin. On the dev cases no
  verdict changes kind: dev-ub, dev-origin and dev-coverage (and dev-rings
  and dev-rings-shell on 161³) now open "fitted to the coverage".
