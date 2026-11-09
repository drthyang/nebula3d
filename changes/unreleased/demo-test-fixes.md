- **Fix: the shell floors failed with a 422 after the flatten ran again on
  its own.** A run resumed from a stage reads its input from disk, and on a
  raw volume whose bin edges were stored in float32 every reload moved the
  axes by a float32 ulp, so the flatten's output was no longer on the
  backfill's grid and the flatten check ended "not judged". A stage now
  reloads on the axes it was written with, and stages written before still
  pair.
- **Fix: numbers without float noise.** The chat, the report and a number
  filled in by reference show no long runs of digits (a tiny value reads in
  exponent form), qmax_coverage gives the window's weight to three figures,
  and a cut and a mark's plane are snapped to the grid, so the sample at the
  origin reads 0. A lead-in the model wrote before a reference whose value
  starts with the same words is not repeated.
- **Fix: the Auto panel's "Report ↗" opens the report.** It opened only the
  chat at the report reply; it now opens the report document, as the reply's
  Report button does.
- **Declaring a Laue class turns the symmetry average on.** The Laue class
  card ("Declare <class> (symmetry average)") switches the average on with
  the class and runs again from it, so every output declares the class and
  the symmetry check judges it; the card says so. Before, it set a field that
  reached no stage, and auto mode ran again for nothing. Auto mode now runs
  again after a sample fact only when the fact changes what a run sends.
- **Auto mode says "no change adopted".** A fix whose tuning kept the current
  settings is no longer logged as "Tuned the stage": the Now line, the
  activity log and the report say that no change was adopted.
- **Auto mode's tunings get a budget.** In an auto run a tuning runs at most
  three trials of a stage, and a stage gets at most four minutes of tuning
  over the whole run; trials not started in time are left out, those that ran
  are judged, and a stage whose time is spent is not tuned again. The chat's
  tunings are unchanged.
- **Fix: the ring removal's log names the shells it left as its record does.**
  Al lines a doublet left were logged as the crystal's own scattering; the
  log now names them by the record's code (the Al line, "member of a
  doublet", left) and counts the crystal's own apart.
- **The modulation card offers a k only when one stands out.** The off-lattice
  bunching names one k only when its hits reach twice chance and at least
  half of them lie on the lattice in the other coordinates, as satellites
  do. Bragg lobes beside the nodes can bunch at small fractions but do not
  pass, so the question lists the fractions that fit and no card offers a k.
- **Fix: numbered lists in the report and the chat keep their numbers.** A
  sub-list under an item stays inside it, and a list broken by bullets goes
  on at its number instead of starting again at 1.
- **The UB check is about three times faster** on a large volume, with the
  same result to the bit.
- **One Laue class card.** The Bragg sensing and the Laue comparison offer
  the same class as one card resting on both. After an Apply, a card whose
  change now holds reads "applied with another card", and auto mode sets
  aside a card the settings have moved under, so it never waits on a
  disabled Apply.
- **The punch records its footprint.** The punch's record and its log line
  name the footprint and whether the shape fit's constraints were dropped;
  the assessment and the report cite them.
- **Auto mode puts back a ring fix that leaves more ring.** A ring fix whose
  worst residual grows (a dent traded for a larger ring left) is worse, and
  put back.
- **A mark opens on its own stage's colour scale**, and the Highlights bar no
  longer names the step shown before it.
- **Close volume says what it does**: the conversation, the marks and the
  run's record go unless the session is saved; the dataset's settings stay
  remembered in the browser.
- **Tuning runs are not counted as datasets** ("1 dataset in folder (+2 tuning
  runs)").
- **A run and its stages are timed alike**: the auto line and the Execution
  page both use the wall clock, and a stage's time ends at its own done line.
- **The context meter shows tenths of a per cent under 10 %**, so it moves on
  a large context window.
