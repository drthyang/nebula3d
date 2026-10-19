- **Behaviour change: `compute_delta_pdf` with no window now applies the
  pipeline's, a gaussian of σ 0.4, instead of hann.** Its defaults (and
  `_prepare_forward`'s) were `apodization="hann"`, `gaussian_sigma=0.5`, while
  the pipeline's ΔPDF stage (`DeltaPdfParams`) runs `"gaussian"`, 0.4, so a
  Python API call with no window transformed differently from the stage. A
  script that relied on the old default passes `apodization="hann"` to keep it.
  The pipeline, the server, the browser and every caller in the package pass
  their own window and are unchanged. The ring texture order stays 8 on the
  page and 6 in the package (`RingParams.n_fourier`), on purpose: it reaches
  only the patched and parametric ring models, not the default pooled one. A
  comment at each says so, and `tests/test_defaults_agreed.py` pins both,
  with the window's defaults against `DeltaPdfParams`.
