- **Docs: the browser build's ring test has a known limit near `min_snr`.**
  In low-memory mode (the browser) the ring test reads at most an eighth of
  the volume's voxels for the shells, so a confirmed ring's signal-to-noise
  drops by up to about 2.6×, and a ring just above the rule's `min_snr` can
  be confirmed natively and left in the browser. docs/web.md ("Native and
  browser parity") says so; the validation is unaffected, since its live runs
  use the native server. A parity test pins it as a strict expected failure
  (`tests/test_native_browser_parity.py`: a ring planted at a signal-to-noise
  of 3.8 natively reads 2.1 in the browser), which fails the run once a fix
  lifts the limit. Whether the browser should sample more, at a memory cost,
  is a question for the user after v1. Nothing in the pipeline changed for
  it.
- **Cosmetic: the flatten's summary prints a zero R² as `0.000`.** A constant
  fit's R² is 0 up to rounding, of either sign, and the browser printed it as
  `R² -0.000` where the native engine printed `0.000`. The summary now drops
  the sign of a zero; every other R² prints as before.
