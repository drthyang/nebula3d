- **NEBULA Pilot: the Auto panel.** While an auto run is open, a panel above
  the chat shows its plan, one row a phase with its state, a progress bar,
  and its clock: the working time against the 30-minute limit, with the
  time it waited for you and the run's total time shown apart. It counts the
  model replies, the fixes, the tokens and, on Claude, the spend. Stop,
  Resume and End are in its header. A fact the run waits for is pinned in
  it, with Apply, Edit and Skip. Each row links to its latest step in the
  chat and shows that step's highlights on the views. The checks and runs
  the app makes itself now show in the chat, tagged auto, and the highlights
  follow them as they run. Once the run ends, the panel links to its report
  and offers Undo auto changes. On a phone it folds to one line that opens
  into the plan, with 44 px taps.
- **Evals: the B-auto arm.** `NEBULA_VALIDATION_PRESET=quick-auto` runs the
  validation's quick plan (gemma4:26b, one run per dev case, the 30-minute
  cap) through auto mode, on arm B's cases and graders. It skips every fact
  card, so no fact changes.
