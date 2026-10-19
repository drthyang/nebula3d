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
