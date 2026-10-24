- **Fixed: on a volume whose counts end inside the ring range, the ring
  removal took every local maximum for a ring candidate.** The pooled ring
  removal bins |Q| from 1.5 to 10.5 Å⁻¹ whatever the volume holds, and its
  noise floor (a candidate rises 6 × the profile's noise, `pooled_min_snr`)
  counted the empty and sparse bins, which the detection fills flat: their
  differences are 0, so where the counts end well inside the range the noise
  fell to 0 (on the validation's dev crystal, with the counts ending anywhere
  from 4 to 5.5 Å⁻¹) and the floor went with it. The flood of candidates was
  judged and rejected, so nothing was subtracted on a fine grid, but their
  keep-outs crowded a real ring's flanks, and its powder-ring test drew its
  line through two or three bins (a signal-to-noise of about 1e16) and
  skipped its curve check. On a grid too coarse to confirm a ring, the
  coarse-grid notice listed the flood as ring candidates, and its remedy,
  `pooled_confirm_rings=False`, subtracted them: on the validation's
  dev-coverage case (counts cut at 4.51 Å⁻¹, no ring) at 81 points, 10 false
  shells, 9.4 % of |I|. The noise now comes from adjacent pairs of measured,
  non-sparse bins only, and is infinite with none (nothing is then a
  candidate); where every bin is measured it is the same as before. On
  dev-coverage there is now no candidate and no notice at either grid, and
  the remedy subtracts nothing; a strong ring is judged on two clean flank
  bins a side, with its curve check. A weak ring under the 6σ floor goes
  undetected, as with full coverage. The shells kept out of a judged ring's
  flanks are now picked at half the detection cut, 3σ: a keep-out only
  protects a flank and is never subtracted, so the lower bar is the cautious
  side, and a weak ring under 6σ beside a strong one no longer lifts the
  strong one's flank until it fails. The 97-point demo of the tests (±3
  r.l.u., counts ending at 7.55 Å⁻¹) reaches the bug: it now subtracts the
  aluminium rings at 2.69, 3.11, 4.38, 5.12 and 6.76 Å⁻¹ (14.1 % of |I|),
  where it also subtracted the weak 222 and 420 lines at 5.36 and 6.95 Å⁻¹
  (17.6 %); the 420, now under 6σ, is kept out of the 331's flank, which it
  would otherwise lift until the 331 failed. On a fully measured volume the
  lower bar can keep the crystal's own bumps out of a ring's flanks too (on
  the validation's dev-rings at 161 points the 2.2 Å⁻¹ ring is judged without
  its curve check, still a ring). The ring-removed volume of every dev case
  at 81 and 161 points, and of the console's demo volume (161 points over
  ±4 r.l.u.), is the same as before, bit for bit (review finding B3; the
  manager's decisions on the user's delegation, 2026-10-19 and 2026-10-24).
