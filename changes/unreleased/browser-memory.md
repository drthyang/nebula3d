- **Fix: a long session re-read the Bragg punch's record every time.** The
  console reads the punch's record (`GET /api/bragg/{id}/profile`) whenever it
  reads the run: the Pilot's context, each auto-run check that loads it, the
  Bragg page. On a large volume the record is tens of MB, and an hour's
  session downloaded and parsed it again tens of times, each time tens of MB
  more for the browser to collect. The route now sends an ETag and answers
  304 while the record's file stands; the console keeps the parsed record of
  the last two datasets with its tag and asks with it, so a record is
  downloaded and parsed once per version of its file. Close volume forgets
  them. What the model reads is unchanged.
- **`scripts/pilot_memory_check.mjs`**: a full scripted auto run on the native
  build, with the tab's memory, DOM nodes, canvases, ImageData and running
  animations sampled every 5 s, then the finished run left idle. It fails when
  memory or DOM nodes keep growing once the run is done, the page keeps
  rebuilding its DOM or burning CPU, or any passes a bound.
  `scripts/demo/synthetic_volume.py` writes the synthetic demo at such a size
  (401 × 401 × 301 by default) for it.
