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
  undetected, as with full coverage. The ring-removed volume of every dev case
  at 81 and 161 points, and of the console's demo volume (161 points over
  ±4 r.l.u.), is the same as before, bit for bit (review finding B3; the
  manager's decision on the user's delegation, 2026-10-19).
