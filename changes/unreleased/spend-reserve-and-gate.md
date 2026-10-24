- **Validation: the paid model's gate names NEBULA's share, and the first
  run's reserve covers a run that tunes.** The cap stays $12: the user's $40
  is the total across three apps' Sonnet runs, so $12 for NEBULA keeps the
  total under it, and the gate's message and the model's instructions now say
  "$12 for NEBULA, within the $40 total". The spend tracker held the first
  run of a session to $1.20, the agent loop's worst (13 requests of 40,000
  tokens in, uncached, and 16,000 out, at Sonnet 5.5's price), which left out
  the tuning's requests now counted in a run (`usage.tuning`). It is now $5:
  the loop's $1.20, plus one tuning of all five stages at five trials, 15
  requests (a proposal, one more after a refused reply, and the pick, for
  each stage) of at most 12,500 tokens in and 16,000 out (the tuner's
  `max_tokens`), $2.775, with a 25% margin on the whole ($4.97). 12,500 tokens
  covers the longest tuning request measured, the ring stage's pick of five
  trials on the dev cases at the validation's grid, about 12,100 tokens when
  every character is counted at the estimate's rate for number-dense JSON; a
  replay pins it. Later runs are held, as before, to 1.5 times the dearest so
  far. Decided by the manager on the user's delegation, 2026-10-24.
