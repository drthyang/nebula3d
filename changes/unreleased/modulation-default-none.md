- **Nothing is protected by default: the punch's search leaves a position
  alone only where the sample's modulation is declared.** A behaviour change
  for every run that declares no modulation (the user's decision,
  2026-10-19; plan 4.15, P3). `nebula3d.pipeline.default_modulation()`
  returns None, and so does `PipelineParams.modulation` by default.
  - **What such a run now punches.** Until now a run that declared nothing
    left the planes H = n ± 1/3 ± 0.08 r.l.u. alone (the H fractions 0.3333
    and 0.6667, and their symmetry images). Its search now punches the sharp
    peaks it finds there too, satellites or spurious alike, as anywhere else
    off the lattice. Its punch record says `declared: null`, and the
    bunching test reads every sharp peak the search found off the lattice:
    when they bunch at one commensurate fraction, H = n ± 1/3 among them, the
    punch says so in its log and NEBULA Pilot asks the user whether the
    sample has that modulation.
  - **On the validation's dev cases.** All eight, at 81 and 161 points: the
    search finds no peak off the lattice, on those planes or elsewhere, so it
    punches nothing more. At 81 points its peaks (110 to 172 a case, 14 on
    dev-coverage) are all at nodes; at 161 it finds none, every node being
    judged by the node test. The punched volumes, their holes, peak
    records and logs are as before; only the record's `declared` is now
    null, and the bunching test fires on none. Arm A on dev: the 24 runs'
    scores, detections and digests are as recorded, 5 of 8 cases pass.
  - **To keep the old protection,** declare it: `{"k": "1/3, 0, 0", "form":
    "planes"}` (the Configure page's *Modulation k* `1/3, 0, 0` with *Form*
    planes), which protects the old planes bit for bit.
  - **The legacy request fields keep their meaning.** `punch_search_protect_h`
    protects the H fractions it names (`[]` none); a half width alone sets
    the half width of what is declared, and with nothing declared protects
    nothing. A blank *Modulation k* on the Configure page sends no
    declaration and so declares none.
