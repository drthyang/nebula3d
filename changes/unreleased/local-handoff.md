- **The browser build points to the local version when it hits its limit.**
  When a volume is too large for the in-browser engine (the size gate's
  refusal at load, or its estimate for the selected dataset before a run), or
  a run fails of the engine's memory or 32-bit limits (Python's MemoryError,
  WebAssembly out of memory, numpy's 32-bit traps, the worker dying mid-run),
  the console shows a card where it happened: why, in one line with the
  numbers; QUICKSTART's install and launch commands with a Copy button and a
  link; and "Your data stays on your computer either way." It can be
  dismissed, remembered per dataset. A red memory bar during a run offers a
  soft link to it without stopping the run. The native build never shows it.
- **Known data errors read plainly.** A run stopped by `WindowSupportError`,
  `FFTOriginError` or `SymmetryAverageError` shows the error's own message on
  the Execution page, with the traceback behind "Details", instead of the
  whole traceback.
