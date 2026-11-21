- **Pilot checks: the percentile routine sorts once.** The statistics behind
  `assess_stage` took most of their time in one routine, which sorted the same
  values again for every percentile. It now sorts a typed array once and
  reuses it. Every number is the same to the last bit: a test compares it with
  the old routine on NaN, ±Infinity, −0 and +0, repeated values and large
  arrays.
