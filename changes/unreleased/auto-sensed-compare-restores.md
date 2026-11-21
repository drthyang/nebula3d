- **Auto mode keeps the sensed punch settings without a second run.**
  When the punch needs attention with the settings the pre-run sensing
  recommended, auto mode runs the punch once with the defaults to compare.
  When the sensed settings were no worse, it then set them again and ran the
  pipeline a second time, to compute outputs it had before the comparison.
  It now sets those outputs aside before the comparison run and puts them
  back.
  - The same two conditions as for a fix put back: a run with the settings
    now in place must have nothing to compute, and the punch's check must
    read exactly as it did before the comparison. Otherwise the pipeline
    runs as it did before.
  - What is judged does not change: the same checks, the same winner, the
    same settings left in place. The comparison run with the defaults stays.
    When the defaults are better, the outputs set aside are deleted.
  - The files set aside take disk space during the comparison run (as much
    as the outputs from the punch on) and are deleted on every way out:
    Stop, Pause, a failed run, a new auto run and Close.
  - The activity log, the Changes list and the report then show one "Ran
    the pipeline" entry fewer. No wording changed.
