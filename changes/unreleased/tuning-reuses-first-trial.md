- **A tuning no longer computes its first trial again.** Trial 1 of a stage
  is the current settings. When the stage's existing output was made from
  exactly those settings and the same input, the tuning now takes that output
  as trial 1 instead of running the stage once more.
  - "Exactly" is the rule a resumed run already follows: the output's stage
    record names the same input, edge trim, symmetry and settings, and the
    output is not older than its input. Anything else is computed as before:
    a changed setting, an earlier stage made again or kept with other
    settings, a missing output or side file.
  - On a large volume (about 50 million voxels) trial 1 of the ring removal
    or of the Bragg punch took most of a minute; it now takes about a second,
    plus its check. In the in-browser build it takes a few seconds.
  - The values are the same: the trial's files are the existing output's,
    and its check reads the same numbers. Trials 2 and later, the judging and
    what is kept do not change. The dataset's processed files are still only
    read; the trial gets its own copy (on macOS a copy-on-write clone, which
    takes no extra disk space).
  - After a tuning that ends on a first trial taken this way, the run log
    shows the "exists" line for that stage instead of the stage's own lines.
  - Auto mode's time limit for tuning a stage estimates a trial's length from
    the stage's time in the last run until a trial has been computed.
