- **In the browser, a Pilot check reads each volume once.** The in-browser
  build keeps two volumes in memory at a time, and a check asked for its
  slices plane by plane across the five stages, so every slice read a whole
  volume from its file again. Now:
  - A check asks for a volume's planes together, in one call, and the volume
    is read once for them.
  - A volume's and a 3D-ΔPDF's metadata, and the labels of a slice, are read
    from the file's header; they read no volume.
  - A slice a check fetched is kept in the page and used again by the checks
    that follow (each stage's, then the report's final ones) for as long as
    its file stands unchanged. The in-browser engine says so itself, asked at
    every check: any run, tuning trial, promote, set-aside, restore, regrid
    or load ends it. Phones and tablets keep nothing.
  - The numbers are the same: every tool result of the scripted auto runs
    (clean, a fix, a fix put back, a tuning) is identical to before, and so
    is every slice.
  - On the demo volume an auto run with no fix took about 75 s and now takes
    about 38 s: the stage checks 22 s → 8 s, the report's final checks
    18 s → 0.3 s. With a phone's settings (nothing kept): 79 s → 49 s.
  - The native build makes the same requests as before, with the same
    answers; its metadata and label requests no longer load a volume either.
