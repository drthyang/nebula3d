- **Fixed: Q–R, Run from ΔPDF after Undo.** Undo of a band set with Use in
  pipeline puts Configure's band back, but the pipeline's ΔPDF is still the
  one made with that band. The row under the page's header then went away,
  and Run from ΔPDF with it. The row now stays, with Run from ΔPDF, for as
  long as the stage track reads the pipeline's ΔPDF as stale.
