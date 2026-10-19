- **Behaviour change: the back-FFT consistency view transforms as the run
  did.** The view (the Q–R Band Transform page, `GET /api/consistency/{id}/meta`
  and its slices and save, `webbridge.consistency_meta_json` in the browser)
  built its round trip with the package's ΔPDF defaults, a gaussian of σ 0.4
  with the auto window and the support on, whatever the run had used: after a
  run with hann, another σ, a separable window or the smooth background
  subtracted, its metrics and panels described a transform the run never
  made. It now takes the window, its σ, shape and support, the padding and
  the subtractions from the run's ΔPDF, which records them in its provenance
  (`transform_config`, read back by
  `nebula3d.pipeline.delta_pdf_settings_from_config`). The |Q| range stays
  full, by design, and the band is the one applied in the view. The response
  says where its settings came from (`settings.source`: `"run"`, or
  `"defaults"` with a `note` saying why when the dataset's ΔPDF records none,
  as one written before the record does not) and names the settings a partial
  record lacked (`defaulted`); the page's header shows the window and whose it
  is. A band saved from the view records the transform it was made with.
  After a run with no crop and no |Q| band, the view with no band applied now
  reproduces the run's own saved check. The browser build's results are
  pinned against the native ones (docs/web.md, "Native and browser parity").
