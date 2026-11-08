# Demo QA, 2026-11-07

A full pass through the demo before the interview, on both builds and at two
widths, with every console message, failed request, broken state and slow
spot recorded. The pass ran on the synthetic demo volume only
(`synthetic_rocksalt`, simulated and not measured data). The Pilot ran on a
scripted model, an OpenAI-compatible server with no model behind it, so every
reply and tool call is the same on each run and costs nothing.

## What was tested

| | Browser build (Pyodide) | Native build (`nebula3d-web`) |
| --- | --- | --- |
| How it was served | `npm run build:pages`, served as static files under `/nebula3d/`, as GitHub Pages serves it | `npm run build`, then `nebula3d-web --data-root` on a folder holding only the synthetic demo file |
| Desktop, 1440 × 900 | Every step below | Every step below |
| Phone, 390 × 844, touch | Every step below | Every step below |

The steps, each run by a Playwright script on Chrome:

1. **Load:** Use demo (the browser build) or the dataset (native); Close
   volume; load it again.
2. **The pipeline:** a full run; a forced run of every stage; the symmetry
   average (Compare Laue classes, then a run with the suggested 4/mmm); a run
   from a stage with stale stages after it (a punch setting changed, Force
   off); Run again on the Execution page.
3. **The pages:** Configure, Execution, Reciprocal cleanup, Bragg profile,
   3D-ΔPDF and Q–R Band Transform. On each page: every layout, the H/K/L (and
   X/Y/Z) planes, zoom in and out, asinh/lin/log, a colormap change, Auto, and
   the grid switch. On the Bragg page, a peak picked from the table. On Q–R:
   apply a |Q| band, Use in pipeline, Run from ΔPDF, Undo.
4. **Highlights:** one Pilot reply that checks every stage and page
   (`assess_stage` on all five stages, `ub_check`, `dpdf_peaks`,
   `consistency_details`, `qmax_coverage`), with Follow on, so the views move
   to each page and draw its highlights.
5. **The Pilot:**
   - a reply with Apply cards: a sample fact (Supercell L) applied by click;
     a setting dismissed; a setting edited, then applied; Undo; the Run card;
   - auto mode on the scripted "fix" scenario: the Now line, the activity
     log, Pause and Resume, the run to its end, the report, Undo auto
     changes; then a second run stopped with Stop and its app report;
   - the context meter at neutral, amber (71 %) and red (93 %), then
     Summarize and continue;
   - a chat reply's report.
6. **Session:** Save session, reload, Restore session…, and Recompute them
   where the outputs were gone (the browser build).

At each step the script recorded console errors and warnings, page errors,
failed requests (and HTTP errors), long tasks over 200 ms, horizontal
overflow, spinners left on, and, on the phone, every visible control smaller
than 44 × 44 px (counting a `::before` hit area around it).

## Timings

Measured in the final pass, on an Apple-silicon Mac with Chrome. A time is
from the click to the result shown. Pipeline times are the Execution page's
own total runtime. The machine was shared with another session's eval, so
run times vary by a few seconds between passes.

| Step | Browser, desktop | Browser, phone | Native, desktop | Native, phone |
| --- | --- | --- | --- | --- |
| First paint of the app | 0.1 s | 0.1 s | 0.1 s | 0.1 s |
| Load the demo, first time (boots the engine) | 3.2 s | 3.8 s | instant (dataset already selected) | instant |
| Load it again after Close volume | 1.8 s | 2.1 s | instant | instant |
| Full pipeline, fresh | 13 s | 16 s | 24 s (first pass) | 2 s (the outputs kept on disk, nothing stale) |
| Full pipeline, forced (every stage again) | 18 s | 18 s | 17 s | 14 s |
| Run with the symmetry average on (4/mmm) | ≈ 18 s | ≈ 17 s | 11 s | 11 s |
| Each page's first render after the click | < 0.4 s | < 0.4 s | < 0.4 s | < 0.4 s |
| Compare Laue classes | 14 s | 11 s | 0.3 s | 0.3 s |
| Q–R: apply a \|Q\| band | < 0.1 s | < 0.1 s | < 0.1 s | < 0.1 s |
| Q–R: Run from ΔPDF | 1.5 s | 1.5 s | 3.3 s | 2.0 s |
| Restore session, then Recompute them | 15 s | 22 s | (outputs present) | (outputs present) |
| Pilot: the highlights reply (9 checks, scripted) | 25 s | 26 s | 12 s | 9 s |
| Pilot: an auto run on the scripted model (2 fixes, to its report) | 2 min 33 s | 2 min 28 s | 1 min 16 s | 1 min 52 s |
| Pilot: open a report | 19–25 s | 19–22 s | 1.5 s | 1.7 s |

The page-render times include the script's 0.3 s wait after the click; each
view was drawn within about 0.05 s after it. The full pipeline breaks down
as ring removal 8–11 s, Bragg punch about 1 s, and each later stage under
1 s. No step left a spinner on, and every step over 2 s showed progress: the
engine's boot panel, the Execution page's stage bar, the Pilot's "Now
examining" bar, the Auto panel's Now line, or the report's "Measuring the
reduction and drawing the figures…".

## Issues found and fixed

Each fix is its own commit on `fix/demo-qa`. None changes what the model
reads: the model-visible snapshots are unchanged.

| Commit | Issue | Fix |
| --- | --- | --- |
| `d1a0b90e` | The grid switch on the r.l.u. views was named *Unit cell*. Its dashed lines at integer h, k, l are not a unit cell. This was the user's correction. | It is now *HKL grid* on Reciprocal cleanup, the Bragg page, the Q–R page and the Configure preview. *Unit cell* stays on the real-space views (3D-ΔPDF, multi-volume), where the lines are the cell's edges. Only the visible name changes, so the stored setting and old sessions load as before. A test fails if *Unit cell* comes back on an r.l.u. view. |
| `00621988` | Phone: the session note's dismiss (×) was 32 px wide. | One-glyph small buttons are 44 px wide on touch screens. |
| `0c043a44` | Phone: after Restore session, the note's long text was squeezed into a narrow column beside its buttons. | The note wraps on phones: the text on its own row, the buttons under it. |
| `1f02f108` | After an auto run that had put back its own fixes, the panel still offered *Undo auto changes*, and the click said "Nothing to put back." | The button shows only while one of the run's changes still stands. Test added. |
| `cb750633` | Phone: the Pilot's tool-step rows (23–29 px), *Show* (22 px), *Report* (25 px), and the highlight bar's step link, clear (17 × 15 px) and legend chips were under 44 px. | All are 44 px taps on touch screens: rows and chips grow, and the pills and glyphs get a 44 px hit area around them. Desktop is unchanged. |
| `fb65f233` | While a run was under way, the Pilot showed the model as Connected and "Preparing metrics…", but the chat box said "Connect a model to chat…". | The chat box says what the panel says: "Preparing metrics…", "Select a processed dataset…", or "Connect a model" only when no model is connected. Test added. |
| `0cc36b9e` | Phone: Compare Laue classes rows, the taps that set a class, were 39–42 px tall. | Each row is 44 px tall on touch screens. |

After these fixes, the final pass recorded no console errors or warnings, no
page errors and no failed app requests, in either build at either width.
What the script did record is listed below; none of it comes from the app:

- `GET /api/v0/models` 404 from the scripted model server. The app asks a
  local server for LM Studio's loaded context length, and skips that on
  Ollama's port. Neither real Ollama nor LM Studio gives this 404.
- `net::ERR_ABORTED` on `POST /v1/chat/completions`. The client stops
  reading a stream at `[DONE]`, before the server closes it. This is not
  shown in the console.
- Long tasks: none over 200 ms in the final pass. Earlier passes saw a few
  of 200–280 ms while the Pilot's checks ran (native) and at the end of an
  auto run (browser). That is too short to read as a hang.
- On the phone, the class names inside the Compare Laue classes rows are
  small buttons, the keyboard's way to pick a class. The tap target is the
  row, which is now 44 px.
- The Bragg page's scatter markers are 7 px. On a phone, the peak table
  (44 px rows) is the way to pick a peak.

## Known issues, with workarounds

- **Reports take about 20 s to open in the browser build** (1.5 s in the
  native build), because a report measures every stage again in Pyodide. The
  overlay shows a spinner and "Measuring the reduction and drawing the
  figures…" the whole time. *Workaround:* demo the report on the native
  build, or open it and talk through the first screen while it measures.
- **An auto run takes about 2.5 minutes in the browser build**, against
  about 1–2 minutes natively, with the scripted model. A real model adds its
  own reply time. The Now line and the log show progress throughout.
  *Workaround:* start auto mode first and talk over it, or demo it on the
  native build.
- **Q–R: after Undo, the row with Run from ΔPDF went away**, though the
  pipeline's ΔPDF was still the band-limited one. Fixed on
  `fix/qr-undo-run`: the row now stays, with Run from ΔPDF, for as long as
  the stage track reads the pipeline's ΔPDF as stale. Without that fix, the
  workaround is Run pipeline on Configure, with Force off, which remakes
  only the ΔPDF.
- **A local model on the Pages build needs CORS.** Ollama must be started
  with `OLLAMA_ORIGINS` set to the site's origin, and LM Studio needs Enable
  CORS. The connection settings say so in their hint. *Workaround:* set it
  up before the interview, or use the native build.
- **Build warning:** Vite warns that a chunk is over 500 kB in both builds.
  This happens only at build time and changes nothing at run time.

## Checks

On the branch after the fixes:

- `npm run lint`: clean.
- `npm run typecheck`: clean.
- `NEBULA_HOLDOUT_TESTS=1 npx vitest run --project unit --maxWorkers=4`:
  2354 passed, 9 skipped, with the model-visible snapshots unchanged.
- `npx vitest run --project replay`: 105 passed, 1 expected fail, 3 skipped.
- `npm run build` and `npm run build:pages`: both built.
- pytest: not run, because no Python changed.

Then the whole demo pass ran again on both rebuilt builds, at both widths.
It was clean, as described above.

**For the docs builder:** the old README demo GIF showed an earlier UI; it
was replaced by stills and removed from the repo. The PDF and Word manuals
do not mention the HKL grid switch.

## Screenshots

Screenshots of every step are outside the repository, in the session's
scratchpad folder `demoqa/shots/`. Each carries the © 2026 Tsung-Han Yang
overlay. The files are named by phase, build and width: `p1-…` load, run
and pages; `p2-…` page controls, Q–R and session; `p3-…` the Pilot; `p4-…`
the symmetry average and runs from a stage. A set picked for the README is
in `demoqa/readme/`.
