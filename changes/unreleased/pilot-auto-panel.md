- **NEBULA Pilot: the Auto panel.** While an auto run is open, a panel above
  the chat says what it is doing.
  - **The Now line** says what the run is doing at this moment, for example
    "Checking the Bragg punch (stage 2 of 5)…", "Fixing the ring removal,
    try 1 of 2", "Tuning the Bragg punch, trial 2 of 3" or "Waiting for your
    answer: Laue class".
  - **The activity log** has one row a step: each check and run, each model
    reply, each fact asked. Each row has its status and one line of what was
    decided. Its detail (the evidence, the settings changed, the reply) opens
    on a click. The log is built from the run's own results, so it costs no
    tokens.
  - **The plan** has one row a phase with its state. Each row links to its
    latest step in the chat and shows that step's highlights.
  - The header shows the time worked, never against the limit; the time it
    waited for you is shown apart. Pause, Resume and Stop are always there.
    Stop ends the run with the app's report (see below).
  - The panel also shows a progress bar, the replies, fixes, tokens and, on
    Claude, the spend. A fact the run waits for is pinned in it, with Apply,
    Edit and Skip.
  - The checks and runs the app makes itself show in the chat, tagged auto,
    and the highlights follow them as they run.
  - Once the run ends, the panel links to its report and offers Undo auto
    changes.
  - On a phone the panel shows the Now line and the last three steps. One tap
    opens the rest. Taps are 44 px.
- **NEBULA Pilot: the clock shows the time worked**, not "of 30:00". The
  limit still holds, and the run's report names it when it ends a run.
- **Evals: the B-auto arm.** `NEBULA_VALIDATION_PRESET=quick-auto` runs the
  validation's quick plan (gemma4:26b, one run per dev case, the 30-minute
  cap) through auto mode, on arm B's cases and graders. It skips every fact
  card, so no fact changes.
