- **Save and restore an analysis (Configure → Data: Save session, Restore
  session…).** A reload lost the run's record, closing the tab lost the NEBULA
  Pilot conversation, and in the browser build a reload or Cancel lost every
  stage output. A session file (`*.nebula-session.json`, versioned) keeps the
  dataset and its raw file (name, size and date), the Configure form, the
  outputs present (with when each was written), the last run (its stages, the
  settings it ran with and its log), the conversation, the structure overlay
  and the NEBULA3D version. Restoring asks first when it would replace a
  conversation or a run's log, selects the dataset, applies the session's
  settings over any the browser remembered (only the settings the form has,
  of the type it keeps them in), brings back the conversation and the run's
  log, and lists the saved outputs that are gone, or were written again since,
  with **Recompute them**: it runs those stages with the settings of the run
  that made them (its log says it computed them), not a form edited after that
  run; when the session does not know them it uses the restored form and says
  so. A raw file of another size under the same name is not recomputed on; a
  raw file dated otherwise, another NEBULA3D version, or a file saved before
  these checks (it still loads) is restored with a warning. On the demo volume
  in the native console the recomputed outputs were bit-identical to the
  originals; the browser build computes in float32, and was not checked. A
  session whose dataset is not here, or that was saved with no dataset, does
  not apply its settings; a file of another format, or of a newer version, is
  refused. Tool results in a restored conversation are shown but never taken
  as evidence for a later reply's numbers.
