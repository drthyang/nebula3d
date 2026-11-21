- **Auto mode puts a worse fix back without running the pipeline again.**
  When a fix made its stage's check worse, auto mode undid the setting and
  then ran the pipeline once more, to compute outputs it had minutes
  earlier. It now sets those outputs aside before the fix's run and puts
  them back.
  - On a large volume (about 50 million voxels) a ring fix put back cost a
    second run of over a minute; putting the outputs back takes well under a
    second, plus the stage's check. On the in-browser demo it saves about
    12 s for each fix put back.
  - The outputs put back are the files the check before the fix judged, with
    their dates. Before they are trusted, a run with the settings put back
    must have nothing to compute (the rule a resumed run follows), and the
    stage's check must read exactly as it did before the fix. Otherwise the
    pipeline runs as it did before.
  - The files set aside take disk space while the fix is tried: as much as
    the outputs from the fixed stage on. They are deleted when the fix is
    kept, and on Stop, Pause, a failed run, a new auto run and Close. They
    live in `set-aside/` beside `processed/` and are listed nowhere.
  - When the disk is short the outputs are not set aside, and the pipeline
    runs again as before. The in-browser build sets aside at most 512 MB,
    and nothing on a phone or tablet.
  - The activity log, the Changes list and the report then show the
    put-back without a second "Ran the pipeline" entry. No wording changed.
  - Not changed: your own Undo and *Undo auto changes* (they still offer a
    run).
