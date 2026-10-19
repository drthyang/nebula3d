- **Behaviour change: the back-FFT consistency view transforms what the run
  transformed, as the run did.** The view (the Q–R Band Transform page,
  `GET /api/consistency/{id}/meta` and its slices and save,
  `webbridge.consistency_meta_json` in the browser) built its round trip with
  the package's ΔPDF defaults, a gaussian of σ 0.4 with the auto window and
  the support on, whatever the run had used, and on the flattened volume
  whenever one was on disk: after a run with hann, another σ, a separable
  window or the smooth background subtracted, or a ΔPDF made from another
  volume, its metrics and panels described a transform the run never made. It
  now takes the volume the run's ΔPDF was made from and its window, σ, shape
  and support, padding and subtractions from the ΔPDF, which records them in
  its provenance (`source_file` and `transform_config`, read back by
  `nebula3d.pipeline.delta_pdf_settings_from_config`). The |Q| range stays
  full, by design, and the band is the one applied in the view. The response
  says where both came from (`settings.source`: `"run"`, or `"defaults"` when
  the dataset's ΔPDF records no transform, as one written before the record
  does not; `settings.input`, the record's `made_from` when `same_input`, else
  the flattened volume, else the backfilled one), with a `note` for every
  fallback, and names the settings a partial record lacked (`defaulted`); the
  page's header shows the window and whose it is. A band saved from the view
  records the transform it was made with. After a run with no crop and no |Q|
  band, the view with no band applied now reproduces the run's own saved
  check. The browser build's results are pinned against the native ones
  (docs/web.md, "Native and browser parity").
