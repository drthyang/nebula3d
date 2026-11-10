- **Pair-vector markers show what the ΔPDF says at each vector.** On the
  3D-ΔPDF page every marker of the structure overlay was the same hollow
  glyph, and the ΔPDF's value showed only on hover. Each marker now reads the
  volume at its own vector, in 3-D, in units of the robust σ outside the
  origin's disk (the σ of the ΔPDF's features): at or above *Fill above*
  (2–6σ, default 3σ) it is filled, in the colour map's positive colour where
  the pair is more common than in the average structure and in its negative
  colour where it is rarer. Below it the marker stays hollow, and smaller and
  fainter with *Fade pairs without signal* on (the default). Element pairs
  that share a vector are drawn nested and read as one line. The legend names
  the fills and counts the vectors above the threshold; the hover line reads
  "ΔPDF +6.2σ: more common than in the average structure". The values come
  once per structure and volume from `POST /api/deltapdf/{id}/pair-signal`
  (the bridge's `dpdf_pair_signal`), so moving a cut asks for nothing. The two
  settings are stored with the other overlay settings and in saved sessions.
  The Q–R page's overlay nests shared vectors but is not filled, since its
  view can show a band of the ΔPDF.
