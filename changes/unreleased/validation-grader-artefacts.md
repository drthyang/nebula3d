- **Validation grader: three artefacts fixed (2026-11-07).** A deliberate
  grader change, approved before THY-52.
  - An answer that says a check's numbers are "within limits" is no longer
    charged with a false alarm. "Out of limits" still is.
  - An answer that quotes the ring stage's headline "left ≤ 0" is no longer
    credited with saying a ring is left. A bound above zero, and "a ring is
    left at 2.2 Å⁻¹", still count.
  - A background "well below the threshold for a pedestal", or a pedestal the
    flatten "removed effectively", is no longer charged as a pedestal. It
    still is when the same clause also says a problem ("but the background
    rises", "remains", "above the threshold").
  - A free re-grade of the saved dev records moved six grades. The frozen
    arm-B record of 2026-10-24 now passes 3 of 8 dev cases, not 1.
  - THY-52's paid re-baseline runs on the fixed grader and becomes the new
    frozen baseline (docs/evals.md, "Grader changes").
