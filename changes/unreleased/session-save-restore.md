- **Save and restore an analysis (Configure → Data: Save session, Restore
  session…).** A reload lost the run's record, closing the tab lost the NEBULA
  Pilot conversation, and in the browser build a reload or Cancel lost every
  stage output. A session file (`*.nebula-session.json`, versioned) keeps the
  dataset and its raw file, the Configure form, the outputs present, the last
  run (its stages, the settings it ran with and its log), the conversation and
  the structure overlay. Restoring selects the dataset, applies the session's
  settings over any the browser remembered, brings back the conversation and
  the run's log, and lists the saved outputs that are gone with **Recompute
  them**, which runs exactly those stages: on the demo volume the recomputed
  outputs were bit-identical to the originals. A session whose dataset is not
  here is not applied (load its input first); a file of another format, or of a
  newer version, is refused.
