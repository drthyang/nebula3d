- **NEBULA Pilot: auto mode.** "Run auto analysis" works through a fixed
  plan: a preflight of the raw volume, a run of what is missing or stale,
  then each stage's checks, and a report. The app runs the checks and the
  pipeline itself and moves on by the checks' own verdicts. The model is
  asked only to fix a stage that needs attention (two tries at most) and to
  write the report, each reply on its own, without the chat's history, the
  stage's checks handed to it as already run. The app never changes a
  setting itself: the model's own calls change one under every guard, and a
  fact about the sample (a supercell, a modulation, the Laue class, the |Q|
  band) pauses the run, just before the stage it affects, for your click on
  its card, or Skip. A fix that made its stage's check worse is put back and
  logged. Every change and run shows as auto mode's in the Changes list, the
  report and the next reply's "since the last reply" line, and one Undo puts
  the run's changes back. It stops at 30 minutes of working time (the time
  it waits for you not counted), 12 model replies, or $2 on Claude, and goes
  to its report, which names the limit, with its plan, the facts asked, and
  its tokens and time. Stop, Resume and End at any step. A fix reply is
  about 17k tokens and the report about 19k on a local model, with room for
  the reply.
