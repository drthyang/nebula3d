- **Fix: a run from a stage used a stale output from a stage before it.**
  With the symmetry average off, a run from a stage (the NEBULA Pilot's rerun
  after a change, a Run card, an Apply card's Run) ran that stage and the
  ones after it, so after a ring setting changed, a run from the Bragg punch
  read the old ring removal output. Such a run now makes a stage before it
  again, with every stage after it, when that stage's output is missing or
  no longer follows from its input and settings, as the Configure page's
  stage track marks it, and reuses it otherwise. This is the rule a run from
  a stage already followed with the average on. A run from the first stage
  that is switched on, and the Run button's run, are unchanged.
