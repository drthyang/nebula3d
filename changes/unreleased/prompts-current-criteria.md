- **NEBULA Pilot: the prompts state what the checks judge.** The system
  prompt said the flatten's largest floor in σ (`after_floor_max_sigma`) "≲ 1
  is flat", a limit the flatten's verdict dropped on 2026-10-17; it now says
  the verdict reports it and does not judge it, and that the verdict judges a
  pedestal alone: a floor trend and a span both 0.8 or more, over the outer
  half of the |Q| shells the counts reach, where it said the trend was taken
  over the whole coverage. It said a back-FFT r clearly below 1 flags a
  problem; the transform keeps the data's even part under Q → −Q, so r against
  the data is lower by the odd part (counting noise on unsymmetrised data),
  and the ΔPDF's verdict judges the round trip against the even part
  (`back_fft_pearson_r_even`) to an r of 0.999 or more. It now says so, and
  the ΔPDF review asks what the round trip says, where it asked whether the
  ΔPDF is trustworthy by `consistency_pearson_r`. The flatten review asks for
  the floor trend and span, not the floor in σ; the ring check reads
  `max_ring_left` and `max_ring_dent` at the rings confirmed in 3D, not the
  ring-energy ratio and the over-subtraction; the flatten's criterion no longer
  carries an internal note on who dropped the 1σ limit; and the system prompt
  says the diagnostic context is in the first user message, not "above". These
  words come from the verdict module (`web/src/llm/verdicts/rules.ts`,
  `web/src/llm/metrics/flatten.ts`), so they follow the rules if the rules
  change. The verdicts are unchanged (plan 1.6, the manager's decision on the
  user's delegation, 2026-10-19).
- **NEBULA Pilot: the system prompt's checks name every stage and the data's
  own problems.** They named four, the rings, the Bragg peaks, the fills'
  texture and Qmax, so a reply that settled only those left the run's verdict
  (`{{achieved}}`) not judged, the backfill, the flatten and the 3D-ΔPDF not
  measured. They now name the five stages as `{{achieved}}` names them, each
  with the checks that judge it (the backfill with `texture_check`, the
  3D-ΔPDF with `symmetry_check` and `qmax_coverage`), and the data's own
  problems, which no setting fixes: a UB that is off (`ub_check`,
  `grain_check`), a shifted HKL origin (`ub_check`) and raw counts that end
  inside the box (`qmax_coverage`). The validation's arm C reads the same
  properties as a plain list, in no order and without the checks.
