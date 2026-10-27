# Web UI

`nebula3d` ships **one** browser console — a React + TypeScript SPA (Vite)
that unifies the cleanup, 3D-ΔPDF, and consistency views, adds an AI assistant (NEBULA Pilot),
and drives the whole reduction pipeline. It has two interchangeable run modes
that share the same UI and the same `nebula3d` reduction code:

| Mode | `VITE_DATA_MODE` | Backend | Use it for |
| --- | --- | --- | --- |
| **In-browser** | `pyodide` | none — `nebula3d` runs in the browser via Pyodide | Fully static GitHub Pages app, no install; the complete pipeline at full resolution, volumes stored in float32 (up to ~80 M voxels on a desktop, ~5 M on a phone or tablet) |
| **Native** | unset (default) | FastAPI (`nebula3d-web`) over `/api` | Local work with no size limit |

Both modes run the same `nebula3d` reduction code and expose the same views —
the static in-browser build has **full feature parity** with the native backend.

The standalone matplotlib viewers in `examples/explore_*.py` remain as a
CLI fallback (see [commands.md](commands.md)).

## Native run (`nebula3d-web`)

```bash
pip install -e ".[web]"
nebula3d-web                       # serves http://127.0.0.1:8000 and opens a browser
```

By default it reads `./data` (the `raw/` + `processed/` layout). Override:

```bash
nebula3d-web --data-root /path/to/data --port 8000
nebula3d-web --no-browser          # headless (e.g. remote)
```

The installed wheel bundles the built SPA, so `nebula3d-web` is the only command
needed. From a source checkout that has not been built yet, build the frontend
first (`make ui`, see [Development](#development)) — otherwise only the API is
served.

## In-browser run (GitHub Pages / Pyodide)

The hosted build runs the **real** `nebula3d` pipeline in the user's browser via
[Pyodide](https://pyodide.org) (CPython + numpy/scipy/h5py compiled to
WebAssembly). Users load **their own** data file; nothing is uploaded, nothing is
hosted — the privacy-preserving path to a public, fully-functional app.

- Hosted at **https://drthyang.github.io/nebula3d/** (deployed by
  `.github/workflows/pages.yml` once the CI workflow has passed on `main`; a
  push that breaks tests, lint, types or the frontend build never reaches the
  live site).
- The pipeline ships as a data-free `nebula3d` wheel that the page micropip-installs
  at runtime (its content-addressed path `wheels/<sha256>/…` is resolved from
  `wheels/manifest.json`, both written by `scripts/build_web_wheel.py` — CI /
  `make web-wheel`). Pyodide runs in a dedicated Web Worker
  (`web/src/workers/pyodideWorker.ts`) so the UI never blocks; a boot-progress
  panel covers the ~15 MB WASM download (cached after first load). The boot
  loads only numpy, scipy and h5py — no matplotlib: nothing in the browser
  renders a figure.
- **Parallel ring removal (legacy ring models).** The default `pooled` ring
  model fits the whole volume and runs serially in the pipeline worker. With the
  per-plane models (`patched`, `parametric`) the ring stage instead fans its
  independent per-plane fits out over a pool of slim Pyodide **ring
  workers** (`web/src/api/ringPool.ts` spawns them; each boots numpy/scipy + the
  wheel, no matplotlib — `nebula3d.visualization` imports lazily).  Plane
  buffers flow pipeline-worker ↔ ring-worker directly over `MessageChannel`
  ports (stage-epoch-tagged messages; no `SharedArrayBuffer`, no COOP/COEP
  needed on Pages).  Every plane runs the exact same
  `nebula3d._ringplane._process_ring_plane` the serial path runs, and result
  application is order-independent, so **parallel output is bit-identical to
  serial** (pinned by `tests/test_ring_parallel.py`); a dead worker's planes are
  recomputed in-process.  Pool size: `min(4, hardwareConcurrency − 2)`,
  overridable via localStorage `nebula3d.ringWorkers` (`"0"` disables).
  **Phones and tablets get no ring workers** (iOS, iPadOS, Android;
  `isMobileDevice` in `web/src/api/device.ts`). There, all of a page's
  workers share one content process, and the OS kills it once it crosses a
  memory limit far below a desktop's; Safari then silently reloads the page
  mid-run. Each ring worker is a whole second Pyodide + numpy/scipy (~0.45 GB
  resident), and WebKit reports `hardwareConcurrency` 4 on an iPhone, so the
  desktop rule added two of them. The ring stage runs serially in the pipeline
  worker instead, with bit-identical output. The localStorage setting still
  overrides.
- **float32 compute mode.** The browser always computes with float32 volume
  storage (`PipelineParams.precision="float32"`; native default stays float64):
  volume arrays and the FFT (float32→complex64) halve, while axes/UB, every
  |Q|-derived bin/band/threshold decision, all 1-D profile fits/solves, and
  every large reduction stay float64.  Validated against the float64 reference
  on three measured 401×401×301 volumes (48.4 M voxels each): ΔPDF
  normalised RMS ≤ 1e-5, consistency-r deltas ≤ 6e-10, at most 2 punch-mask
  voxels flipped out of 48.4 M, identical peak counts — and ~15–25 % faster
  (`tests/test_float32_equivalence.py` gates it; a `"precision"` key in the run
  params JSON pins either mode for A/B validation).
- **Native and browser parity.** `tests/test_native_browser_parity.py` runs a
  synthetic volume (the validation's dev case with powder rings and a shell
  of the crystal's own, 121³) through the native engine (float64, low-memory
  off, the server's parameters and endpoints) and through `nebula3d.webbridge`
  as the Pyodide worker drives it (float32, low-memory on, `run_async`), and
  pins which verdicts must agree. *Equal*: every log line's words, and its
  numbers to the digit printed (the lines are identical: the flatten's
  summary no longer prints a constant fit's zero R² as `-0.000`, as the
  browser did); the ring decision (the shells found, the ones confirmed as
  powder rings and the crystal's kept, the share removed); the punch (the
  same peaks at the same nodes, the same voxels punched); the ΔPDF's grid,
  window, provenance and strongest features; the consistency view's
  settings. *To float32 rounding*: the cleaned volumes (normalised RMS 3e-8),
  the ΔPDF (1.5e-7), the peaks' intensities (1.4e-7), the back-FFT r and RMS
  (4e-10). *Allowed to differ*: the round trip against the data's even part
  (1e-14 natively, about 6e-6 in float32, both sound), and the ring test's
  measurements per direction, which the low-memory mode samples more thinly.

  **Known limit: a ring near the ring test's `min_snr`.** In low-memory mode
  the ring test reads at most an eighth of the volume's voxels for the shells
  (`ring_isotropy.shell_isotropy`), so its medians per direction are noisier
  and a confirmed ring's signal-to-noise drops by up to about 2.6× (on the
  161³ demo 103 → 48 at 3.09 Å⁻¹ and 7.0 → 3.8 at 6.94 Å⁻¹, against the
  rule's 3; their isotropy moved by up to 0.27). A ring near `min_snr` can be
  confirmed natively and left in the browser. The decisions agreed on every
  dev case and the demo at 121³ and 161³; a ring planted just above the
  threshold shows the limit (`test_a_ring_just_above_min_snr_is_confirmed_in_both_runtimes`,
  a strict expected failure that fails the run once a fix lifts it): the
  native engine confirms it at a signal-to-noise of 3.8, while the browser,
  reading about a third of that shell's voxels, measures 2.1 and keeps it,
  counted among the crystal's own shells. float32 plays no part in it: the
  native engine in low-memory mode measures what the browser does. The
  validation is unaffected, since its live runs use the native server.
  Whether the browser should sample more, at a memory cost, is a question for
  the user after v1.
- **WebGPU ΔPDF.** When WebGPU is available, the ΔPDF forward FFT and the
  back-FFT consistency inverse run on the GPU (`web/src/gpu/` — a mixed
  radix-2/3/4/5 Stockham line kernel with CPU-precomputed twiddles; index math
  CI-pinned to numpy fixtures).  The complex intermediates — the largest
  contiguous allocations in the pipeline — then never touch the wasm heap.
  Stage log lines show `[WebGPU]`; the ΔPDF `transform_config` carries an
  `fft=webgpu-f32-p5` token so CPU- and GPU-computed caches never masquerade as
  each other.  Any GPU refusal (no adapter, limits too low, device lost)
  silently falls back to the scipy path — the run never fails because of the
  GPU.
- **Memory ceiling.** Pyodide's 32-bit-WASM heap tops out at 4 GB (Pyodide
  ≥ 0.27; there is no wasm64 Pyodide build), so the whole reduction has to fit
  in that heap. The browser bridge turns on a **low-memory mode**
  (`NEBULA3D_LOW_MEMORY`, see `nebula3d.core.low_memory`) that trades a little
  recompute for a smaller peak (broadcast |Q| grids, per-plane ring
  coordinates, in-place flatten, dropped sigma before the FFTs), plus streaming
  consistency metrics and per-plane deapodization that replaced the old
  whole-volume temporaries at the peak stage.

  Measured as the WASM heap's high-water mark under Pyodide 0.27.7 (float32,
  low-memory; it includes the runtime and allocator fragmentation), a full run
  peaks at 2.9 GiB on a fully measured 79.5 M-voxel volume, 2.8 GiB on a
  64.5 M-voxel TOPAZ volume that is mostly unmeasured, and 2.1 GiB on a
  measured 48.4 M-voxel volume. The admission gate (`nebula3d.webbridge.inspect_input`,
  metadata-only so it can't OOM) budgets 40 B/voxel against 3.2 GB → volumes
  up to **~80 M voxels** are admitted (e.g. 401×401×401 = 64.5 M voxels ≈
  2.6 GB estimated peak; 501³ = 125.8 M is still refused with a message
  pointing to the native build). Every stage computes |Q| per plane or per
  16-plane slab: a full float64 |Q| grid with its temporaries costs ~25–40
  B/voxel more, which ran that TOPAZ volume out of memory
  (`tests/test_memory_peaks.py` guards the four stages that built one).

  **Phones and tablets get a smaller, tab-wide gate: ~5 M voxels** (≈ 171³;
  the 161³ demo is 4.2 M). There every worker shares one content process that
  the OS kills at a memory limit far below 4 GB, and the browser then reloads
  the page, losing the run. So the budget covers the whole tab, not just the
  pipeline's heap: ~0.55 GB of runtime + numpy/scipy/h5py (resident before any
  data) plus 150 B/voxel against 1.3 GB. The 150 B/voxel is the ~125 B/voxel a
  full demo run measured (heap high-water mark, MEMFS input and stage outputs,
  JS slices) plus room for a Mantid input's float64 signal and errors. The page
  detects the device (`web/src/api/device.ts`; only the main thread can tell
  iPadOS from a Mac) and passes it in the worker's boot message to
  `webbridge.setup(mobile=…)`. A larger file is refused with a message that
  points to a desktop browser (up to ~80 M voxels) or the native build.

  (The default Bragg backfill, `backfill_bragg` with `method="laplace"`, costs
  ~10 B/voxel more than the connected-component / `ndimage` `local` fill
  (~25 B/voxel transient, vs ~41 for the former `q_shell` default) on a measured
  401×401×301 volume, and its sparse solve runs in
  batches of at most 2 M unknowns (`LAPLACE_MAX_UNKNOWNS`), so it stays
  bounded however much of the
  volume is masked — a single masked region larger than that is an unmeasured
  coverage gap and gets the `local` fill, noted in the run log. The direct-beam
  fill applies the same cap to its region's bounding box: unmeasured coverage
  that reaches the origin is not a beam, and gets the generic fill.)

Local dev for this build: `cd web && npm run dev:pyodide` (loads `.env.pages`,
base `/`).

### Demo volume

**Use demo** (Configure → Data) loads a synthetic volume built by
`nebula3d.demo.demo_volume` (called from `webbridge.make_demo_input`). It is
named `synthetic_rocksalt` so it can never pass for measured data. The volume is
a simulated rock-salt-type crystal (cubic, a = 4.2 Å, FCC lattice) on a 161³
grid over ±4 r.l.u. (step 0.05 r.l.u. = 0.075 Å⁻¹, 4.2 M voxels), generated
float32. Its file, like every one NEBULA3D writes, is the Mantid layout, float64
on disk (~7 B/voxel compressed, against ~6 for the former float32 file). The
full chain runs in about 5 s in the browser (Apple-silicon Mac,
WebGPU). Generating it peaks at `data` + `sigma` plus one slab (~76 MB; the
noise is drawn one H plane at a time, in place), below the punch and backfill
stages' ~150 MB, so the demo never sets the WASM heap's high-water mark. Every stage
has something to act on, on the intensity scale of a normalised Mantid volume:

| Component | In reciprocal space | In the 3D-ΔPDF |
| --- | --- | --- |
| Bragg peaks | FCC nodes only (all-even / all-odd, the odd ones at 40 %), \|Q\|-dependent resolution | removed by the punch |
| Chemical short-range order (Krivoglaz–Clapp–Moss, V2/V1 = 0.3) | broad maxima at (1 ½ 0), joined along ⟨100⟩ | alternating shells: negative at ⟨½ ½ 0⟩a, positive at ⟨1 ½ ½⟩a and ⟨2 0 0⟩a |
| Thermal diffuse (nearest-neighbour FCC, Q·D⁻¹·Q) | halos at every node growing as \|Q\|², streaks along ⟨110⟩ | short-range displacement correlations |
| 2-D order in the (001) layers | rods along L at (h+½, k+½) | a checkerboard confined to the z = 0 plane |
| Radial background, incident beam, Al can rings (textured), counting noise | removed by flatten, punch, ring removal | — |

With the default parameters the punch finds only FCC nodes (never the diffuse),
and the ΔPDF reproduces the ground truth of the planted diffuse (the model run
through the same punch and fill) with a correlation of 0.91; the values at the
neighbour vectors agree in sign and to within ~20 % in relative size
(`tests/test_demo.py` pins the signs).
`demo_volume(components=(...), noise=False)` returns any single component, and
`nebula3d.save(demo_volume(), "data/raw/demo.nxs")` gives the native app the
same volume.

### Import from the NeXus Viewer

The [NeXus Viewer](https://drthyang.github.io/neutron-nexus-viewer/) symmetrizes
and masks Mantid volumes, which this pipeline expects as input. Its **Open in
NEBULA3D** button opens this app in a new tab as
`?import=nexus-viewer&id=<uuid>&from=<viewer origin>`, builds the volume as a
Mantid MDHistoWorkspace file the way this app writes one (padded symmetric
about Q = 0, σ in `errors_squared`, and a `nebula3d` group with the exact axes
and UB, its `sigma` provenance and the viewer's attributes: `source_file`,
`symmetry`, `symmetry_ops`, …) and sends it. Its older exports, in the legacy
layout (`/entry/{data, mask, sigma, h_axis, k_axis, l_axis, ub_matrix}`,
attributes on `/entry`), still load. Without σ from the viewer, σ is √|I|: on normalized
values the punch's significance test then depends on the arbitrary intensity
scale, and the console says so where NEBULA Pilot reads it (`describe_dataset`,
the punch's log line and its assessment):

1. this app → viewer: `nebula3d-import-ready`, repeated each second until the file arrives;
2. viewer → this app, while it builds the file: `nebula3d-import-progress` with a stage
   `label` (*Symmetrizing*, *Writing HDF5*) and an overall `fraction` (0–1), shown as a
   bar in the waiting banner. Optional: an older viewer sends none;
3. viewer → this app: `nebula3d-import` with the `File`, schema `nexus-viewer/1` and
   provenance `meta` (source file, symmetry, mask), or `nebula3d-import-cancel`;
4. this app loads it like **Load volume…** (the banner shows the in-browser engine's
   start-up if it is still booting), selects it as the dataset, clears the
   parameters from the address bar and answers `nebula3d-import-loaded` (or
   `nebula3d-import-error`), which the viewer shows next to its button.

When the viewer has this app's origin (both on `drthyang.github.io`), it opens
the tab with `noopener` and the messages go over the `BroadcastChannel`
`nebula3d-import:<id>`. Keep it that way: same-site tabs that hold a window
reference to each other share one renderer process and main thread. With the
old link, reloading, closing or crashing the viewer could also end a pipeline
run here. A viewer on another origin (a local dev server) needs the window
reference, so this app also listens on `window.opener` at the `from` origin.
`from` must be this app's origin, `https://drthyang.github.io`, or (in
`npm run dev*` only) localhost. The engine starts booting as soon as the page
opens, while the viewer is still building the file. `web/src/api/importHandoff.ts` implements the
protocol (tests in `web/src/api/__tests__/importHandoff.test.ts`) and
`web/src/components/ViewerImportBanner.tsx` shows the progress. The native API
build answers with an error: import needs the in-browser engine.

## What it does

A single-page console with a left sidebar. The dataset is switched once from a
picker at the top of the sidebar; every view reads it from there (no per-view
dataset pickers). Most views replace a standalone `examples/explore_*.py` viewer:

| View | Replaces | What |
| --- | --- | --- |
| **Configure / Run pipeline** | `run_pipeline.py` | Pick a dataset and tune the key parameters per stage — ring removal (the *Model*, pooled 3D sectors by default; azimuthal patches and Fourier order for the per-plane models), punch (the *Footprint*: own width by default, profile-matched or an ellipsoid in the spherical ρ/θ/φ or reciprocal a*/b*/c* frame), backfill, background correction (the `flatten` stage: the radial background subtracted), ΔPDF, consistency — then run all stages with a live stepper and log. Existing outputs are skipped unless *force* is on. A stage's *Enable stage* switch turns it off: the run sends the switch (`params.rings_enabled`, `punch_enabled`, `backfill_enabled`; the background correction's `flatten_enabled`), the stage is not run, and the stage after it reads what came before it, never an output an earlier run left, whose file stays as it was (see [the complete pipeline](pipeline.md#the-complete-pipeline)). With *force* off, the stages after it keep the outputs that exist. The punch's *Modulation k*, *Form*, *Order m* and *± width* declare the sample's modulation, a fact about the sample that the off-lattice search leaves alone; the note under them is the backend's description of what they protect ([modulation.md](modulation.md#the-console-and-nebula-pilot)). The form is remembered per dataset in the browser, with the selected dataset: another temperature of the same sample starts from the form as it stands, another sample from the defaults (`state/configMemory.ts`). **Save session** writes the analysis to a file (`*.nebula-session.json`, `state/session.ts`): the dataset and its raw file (name, size, date), the form, the stage outputs present (and when each was written), the last run (its stages, settings and log), the NEBULA Pilot conversation, the structure overlay and the version. **Restore session…** (it asks first when it would replace a conversation or a run's log) brings it back on its dataset (in another browser too) and lists the outputs that are no longer there or were written again since, with **Recompute them**, which runs those stages with the settings of the last run when it made them (otherwise with the restored form, and says so); it is not offered when the raw file is not the session's (another size), and warns when the file is dated otherwise or the version differs. The pipeline is deterministic, so with the same input and settings they come back the same (bit-identical in the native console on the demo; the browser build computes in float32). The volumes themselves are not in the file. Default landing view. |
| **Reciprocal cleanup** | `explore_slice.py` | One view per HKLVolume stage (raw / ring-removed / punched / backfilled / background-corrected) on one H/K/L plane and cut, in the [viewer workspace](#viewer-workspace). All views share **one colour range**, set from a reference stage (the output stage by default, or *Each view* to scale each stage on its own), and one linked zoom and crosshair; hovering reads every stage's value at the same (K, L). The cut readout is an **editable box** — type `0.3333` and it snaps to the nearest plane. |
| **Bragg profile** | — | Width diagnostics of the punch's fitted Bragg peaks: widths against \|Q\|, their distribution per axis, a sortable peak table and the selected peak's intensity in three slices through its centre (a\*·b\*, a\*·c\*, b\*·c\*) with the fitted, measured and \|Q\|-floor ellipses. The three tiles are one linked view about the peak, zoomed and panned as in the [viewer workspace](#viewer-workspace): zooming or panning one moves the other two through the same hkl point. They open (and reset, by double-click, 0 or a view's *Reset zoom*) at 3.5× the peak's widest fitted width and zoom out to 10× that; the ellipses are drawn with the slices' own pixel mapping, so they stay on the data at any zoom. The page has the workspace header: *Unit cells* draws integer h, k, l, *Integer HKL only* filters the peaks, the layout switch shows the three slices as a grid, one large with two thumbnails, or one alone; the display bar sets their one colour range. The dashboard gives the slices the wide column: scatter and peak table on the left, the selected peak and the width histograms on the right (one column on a narrow page, the slices second). |
| **3D-ΔPDF** | `explore_delta_pdf_ortho.py` | Three real-space orthoslices (x_H–y_K, x_H–z_L, y_K–z_L) in the [viewer workspace](#viewer-workspace), each with its own cut slider, one shared ± colour range, a gray dashed unit-cell overlay and an optional [structure overlay](#structure-overlay) of interatomic vectors. Views open at ±40 Å. In *Navigate* mode a click on one view moves the other two cuts through the point. |
| **Multi-volume** _(hidden in 0.3.0)_ | `explore_delta_pdf_multi.py` | Related ΔPDF files × the three planes as a square grid across the page, under the workspace header, sharing the cuts and one ± colour range (Auto as on 3D-ΔPDF, pooled over the files' centre sections). Each plane has one view shared by every file, zoomed and panned as in the [viewer workspace](#viewer-workspace), so the files are always compared at the same scale; views open at ±40 Å. Component retained; unrouted from the sidebar for now. |
| **Q–R Band Transform** | `delta_pdf_consistency.py` | Back-FFT check: inverse-transforms the ΔPDF to reciprocal space and shows **data, ΔPDF, back-FFT and residual** as four views (focus layout, data large, by default), with agreement metrics (Pearson r, normalised RMS) in the header. Data, back-FFT and residual share one plane, cut, colour range and view; the residual has its own ± range on a diverging map. The ΔPDF plane follows the Q plane (H ↔ x, K ↔ y, L ↔ z) while *Link orientation* is on. **\|Q\|** and real-space **\|R\|** bands, each with its own *Apply* in the view footer, isolate which ranges support a signal; applying a band keeps both cuts. The \|Q\| band is drawn as its true contour on the r.l.u. axes: a circle for an orthogonal cell, a tilted ellipse (centred off the origin where the cut axis is not normal to the plane) for any other. The round trip transforms what the run transformed, as the run did: the volume the run's ΔPDF was made from, with its window, σ, shape and support, padding and subtractions, which the ΔPDF records (`source_file`, `transform_config`), over the full \|Q\| range and the band applied here. Without a record to follow it falls back: to the package defaults when the ΔPDF records no transform (none on disk, or one written before the record), and to the flattened volume, else the backfilled one, when no record names its input or that file is gone. The header says which, and why: "the run's window: hann", or "the default window, gaussian σ 0.4: no ΔPDF on disk for this dataset; the view falls back to …". |
| **NEBULA Pilot** | — (new) | A column docked beside every page, which the page reflows beside, never over it: drag its edge to resize it, or collapse it to a slim rail (opened from the sidebar or the rail). In a window under 1000 px wide (900 px in landscape) it is a bottom sheet under the page instead. With *Follow* on, the figure it works on stays fully in view beside it. Connect a local (Ollama / LM Studio) or cloud (OpenAI / Gemini / Anthropic) model. One **chat**: free questions, five one-click stage reviews, and two one-click requests (*Assess the run*, *Tune for the best result*), grounded in metrics computed in the browser. With **Tools** on, the model measures any cut, judges each stage on three planes, checks the punch and backfill for texture, the ΔPDF's window against the data coverage (and where the raw counts begin and end in \|Q\|) and the ΔPDF's symmetry, sets the ΔPDF view's contrast, reads the Bragg profile, back-FFT check and run log, compares datasets, opens the viewer beside the chat, and acts: it runs the pipeline (shown live on the Execution page and in the chat), changes settings, and tunes the pipeline one stage at a time, keeping the best settings for each. Optional vision opt-in attaches the rendered slice for image-capable models. |

### Viewer workspace

The slice views (Reciprocal cleanup, Bragg profile, 3D-ΔPDF, Q–R) share one
workspace, after the [NeXus Viewer](https://drthyang.github.io/neutron-nexus-viewer/)'s,
so the two apps work the same way; the multi-volume grid has the same header
and zooms and pans by the same rules.

- **Header** (`components/WorkspaceHeader.tsx`), in one order on every page:
  the click modes and a **?** that opens the gesture card, the overlays (*Unit
  cells*, *Structure*), the page's own controls (plane, cut, orientation,
  filters), the layout switch at the right; under them the display bar. Each
  control has the same name and a one-line tooltip on every page. On phones
  (the phone tiers under [Screen sizes](#screen-sizes), held upright or on
  their side) the display bar folds behind a button at the end of the first
  row, closed at first: closed, it shows each bar's colormap swatch and its
  scale (or ± limit); a tap opens it. Open or closed is remembered by the
  browser, for every page. Tablets and desktops show the display bar as
  before.
- **Gesture card** (`components/GestureHint.tsx`): a click or tap on the
  **?** (or Enter / Space on it) opens a card with one row per action — Zoom,
  Move, Reset, Box zoom — each way drawn as key caps and pointer glyphs:
  ⌘ or Ctrl + scroll, pinch or + / − to zoom; Shift + drag, a middle-drag or
  the arrow keys to move; a double-click, 0 or *Reset zoom* to reset; *Box
  zoom* then a drag, Esc to cancel. ⌘ shows on Apple platforms, Ctrl
  elsewhere; a touch-only device (a coarse pointer with no hover) shows the
  touch gestures instead: pinch, a two-finger drag, a double-tap. Esc, a
  click outside it or its × closes it, and focus returns to the **?**; it
  does not open on hover, where it would cover the display bar. Until the card has been opened once, the
  **?** carries a small dot (remembered by the browser); nothing opens by
  itself. The rows are the ones the views handle (`components/gestures.ts`,
  `components/ViewFrame.tsx`).

- **Layouts** (icons at the right of the workspace header): *Grid* (every view
  the same size), *Focus* (one large view; the others are thumbnails beside it —
  2 × 2 with four of them, a column otherwise — and a click on one makes it the
  large view) and *Single* (one view; Esc returns). Each view's header has
  *Reset zoom*, *focus* and *maximize*; double-clicking a header maximizes it.
  The layout is remembered per page. Phones show every view, one per row.
- **Click modes** (left of the header): *Navigate*, the default — hover reads
  values, and on 3D-ΔPDF a click moves the other two cuts through the point;
  and the **Box zoom** tool — press it, drag a box on a view and the view
  zooms into the box, then the views are back in *Navigate* (press it again,
  or Esc, to put it away). No mode is remembered: a page opens in
  *Navigate*. Zoom and pan need no mode; in every mode the views behave like
  an embedded map ("cooperative" gestures):
  - **Wheel.** When the page can scroll, a plain wheel or two-finger scroll
    over a view scrolls the page, and the view says *Use [Ctrl] + scroll to
    zoom* (*[⌘]* on Apple platforms, drawn as a key cap) for a moment; **Ctrl/⌘ + wheel** zooms about the
    pointer, and so does a trackpad **pinch** (Chrome, Edge and Firefox send it
    as Ctrl + wheel; Safari's pinch gestures are read too). When the page
    cannot scroll (the views fill the window), a plain wheel zooms. One wheel
    notch is a factor 2 in any browser; a trackpad zooms smoothly. A sideways
    scroll is left to the page.
  - **Drag.** A middle-button drag, a Shift+drag or a two-finger drag on a
    touch screen pans (a Shift+click does nothing; a trackpad's two-finger
    scroll is the wheel above). The view's centre stays on the data, so the
    slice cannot be dragged off screen.
  - **Double-click** returns to the full view, as do a double-tap on a touch
    screen, the header's *Reset zoom* and the **0** key (the NeXus Viewer's
    meaning).
  - **Buttons and keys.** The **+ / −** buttons under the field-of-view chip
    zoom about the view's centre; on a focused view (click it or Tab to it)
    **+ / −** zoom, the **arrow keys** pan a tenth of the view, and **0**
    resets.

  Zooming out stops a little past the whole slice, or at the view a page opens
  with if that is wider. Views fill their cell: the field of view (the chip in
  each view's corner, ± Å⁻¹, ± Å or ± r.l.u.) spans the shorter side, and a
  wide view shows more. No page has a zoom slider: where views are compared
  they zoom together (the stages of Reciprocal cleanup, the three Bragg peak
  tiles, every temperature of one plane on the multi-volume page).
- **Unit cells** (a switch beside the click modes; one setting for every
  page): gray dashed lines at the unit-cell edges — multiples of a, b, c on
  the real-space views, and integer h, k, l on the r.l.u. views (Reciprocal
  cleanup, the Q–R page's Q views, the Bragg peak tiles), drawn at the slice's
  own scale and angle, so they stay on the data while it zooms and pans.
- **Display bar** (`DisplayBar`, the same order on every page): colormap, then
  the colour range — vmin, the colour bar with the reference data's histogram
  behind it and a handle at each limit, vmax — then *asinh / lin / log* (for
  data that is not signed), *Auto* and *Brightness*. *Auto* sets vmin 0 (± for
  signed data), vmax at the 97th percentile and the asinh softening at the
  median of the positive values, from the centre cut, so the scale holds still
  while the cut moves. On the 3D-ΔPDF page Auto takes the 99.9th percentile of
  |ΔPDF| over the three centre sections, the origin's self-correlation disk left
  out (`components/dpdfLevels.ts`): a ΔPDF section is mostly FFT ripple, so the
  97th percentile sits on the ripple and saturates every feature; the
  multi-volume page does the same over every file. On the Bragg profile Auto
  takes the 99th percentile of the three windows about the peak (not the
  view, so the colours hold while zooming), its scale is its own (lin by
  default), and limits are kept relative to each peak's Auto, so Brightness
  carries from peak to peak. *Brightness* moves vmax in stops about Auto:
  right is brighter. Typed or dragged limits hold until *Auto* or a dataset
  change.
- **Shared settings**: the reciprocal plane, cut, colour range, scale and zoom
  are shared by Reciprocal cleanup and Q–R; the ΔPDF colour range, colormap
  and zoom by 3D-ΔPDF and Q–R; *Unit cells* by every page.

### Structure overlay

A 3D-ΔPDF is a map of interatomic vectors u = r_j − r_i + R, not of atoms, so
the overlay marks those vectors. *Add structure…* on the 3D-ΔPDF page opens a
panel: load a CIF (cell, sites and the `_space_group_symop_operation_xyz` /
`_symmetry_equiv_pos_as_xyz` list), or enter sites by hand with symmetry
operations as x,y,z triplets plus a lattice centring. The operations are closed
into the full group, so generators are enough. The CIF's cell is checked against
the ΔPDF's (3 %, 1°); a CIF in another axis setting can be mapped onto the
data's a, b, c, and a structure whose cell does not match is not drawn. Vectors
are placed on the ΔPDF's own cell.

Each element pair has its own glyph: the colour names one element, the shape
the other, and a chip per pair in the workspace header hides or shows it.
*Vectors from* keeps only the vectors that start on one site, i.e. the
structure seen from that atom. A vector is marked on a slice when it lies
within ± *depth* of the cut (default: half a voxel) and fades with its distance
from the plane. Hovering a marker reads its pairs and how many per cell, |u|,
u in lattice units and its offset from the cut. The Q–R page's ΔPDF view shows
the same overlay. The structure stays in this browser (localStorage); it is
never sent to the server or written to a dataset.

### Screen sizes

The layout is tuned for these screens (CSS viewport in Apple points). The tiers
live at the end of `web/src/index.css`, under "Device layouts".

| Screen | Viewport | Layout |
| --- | --- | --- |
| iPhone 18 Pro / Pro Max, portrait | 402 × 874 / 440 × 956 | The sidebar becomes a top bar: brand and dataset picker, then the views as a row of pills that scrolls sideways. Viewer panels stack one per row. Form text is 16 px, so Safari does not zoom in when a field gets focus. The API status and version move to the end of each page. |
| iPhone 18 Pro / Pro Max, landscape | 874 × 402 / 956 × 440 | The top bar is a single row. Panels go three to a row. Padding clears the Dynamic Island and the home indicator (`viewport-fit=cover`). |
| iPad Pro 11″ / 13″, portrait | 834 × 1210 / 1032 × 1376 | Top bar with the full row of views. Panels go three to a row, or two to a row when there are 2 or 4. Configure's workflow boxes go two to a row. |
| iPad Pro 11″ / 13″, landscape | 1210 × 834 / 1376 × 1032 | Sidebar, narrowed to 208 px. |
| MacBook Pro 14″ / 16″ | 1512 × 982 / 1728 × 1117 | The baseline desktop layout. On short windows (≤ 920 px tall, e.g. the 14″) there is less vertical padding, so viewer panels start higher. |
| 4K at 200 % (1920 × 1080) | ≥ 1800 wide | Wider sidebar and gutters. The Bragg scatter plot, peak table and run log get taller. |
| 4K at 150 % (2560 × 1440) | ≥ 2400 wide | Configure shows the workflow controls and the live punch / \|Q\|-band preview side by side, with the preview pinned while you scroll. |
| 4K at 100 % (3840 × 2160) | ≥ 3200 wide | The whole console is scaled up 1.25–1.5× (CSS `zoom`), so it looks like the 150 % layout rather than tiny text. Browser zoom turns this off. |

Narrower portrait tablets (600–799 px, e.g. iPad mini or Split View) show two
panels to a row. On any touch screen (`pointer: coarse`), slider thumbs,
switches, buttons and help icons are enlarged to finger size. The Configure workflow grid uses
container queries, so its column count follows the width it actually gets,
including the narrower column in the 4K side-by-side layout.

## NEBULA Pilot (AI assistant)

The console's AI agent has its own page, [pilot.md](pilot.md): its tools, its
guardrails (answers checked against the tools, skills read first, tuning that
cannot touch your results), its evals, and how it works.

## Architecture

```
Native:    Browser (React/TS SPA)  ──HTTP/SSE──►  FastAPI (uvicorn)  ──►  nebula3d library
In-browser: Browser (React/TS SPA) ──RPC──►  Web Worker → Pyodide  ──►  nebula3d (same code)
```

- **Slices** are extracted with the same `nebula3d.visualization.extract_slice` the
  matplotlib viewers use, returned as a compact binary envelope
  (`[uint32 header_len][JSON header][float32 data]`), and colour-mapped in the
  browser — so the colour range, scale and colormap change instantly with no refetch.
- **Native** runs `nebula3d.pipeline.run_pipeline` in a separate process
  (`multiprocessing` spawn), streaming progress over Server-Sent Events; cancel
  terminates the worker. Loaded volumes are kept in an LRU cache sized to hold
  every cleanup stage of a dataset at once, so the shared cut slider scrubs
  without re-reading the ~100 MB volumes.
- **In-browser** runs the selected stages through one `webbridge.run_async`
  call (progress streams per stage through a JS callback).  The async seam is
  what lets the ring stage fan out over the worker pool and the ΔPDF stages
  await the WebGPU backend while the rest of the pipeline stays the unchanged
  synchronous `run_pipeline`.  The Python side is a thin in-process driver,
  **`nebula3d.webbridge`**, that reuses the FastAPI-free server helpers
  (`volumes`, `deltapdf`, `consistency`, `datasets`, `params`) against a
  virtual `/work` FS — slicing/discovery/consistency are *not* reimplemented in
  JS. `client.ts` branches on `PYODIDE_MODE` for every endpoint.

### Endpoints (native API)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/datasets` | discovered datasets with per-stage output status (tuning runs' chains included) and when each output was written (`mtime`, POSIX seconds; none for the raw input), and for the ΔPDF the output it was made from (`source`, from the input name its file records: `flattened`, `backfilled`, …, `raw`; none when not known): Configure marks an output older than one upstream of it, or made from a stale one, **stale**; and the raw input's `raw_file` `{size, mtime}` (bytes, POSIX seconds; none when it is not on disk; `mtime` null in the browser build), which a restored session checks its input against |
| GET | `/api/datasets/{id}` | one dataset, or a tuning view: `<id>~tune~<run>` (the run's chain) or `<id>~tune~<run>~<stage>-<n>` (one trial) |
| POST | `/api/datasets/{id}/regrid` | `{cell, q_max, symmetrise}` → the dataset's raw volume regridded onto the UB the UB check refines, written as a new dataset beside it (`<stem>_regridded.nxs`) and never over a file: `{written, dataset_id, file, ub_start, ub, turn_deg, symmetrised, voxels_outside, voxels_outside_share, …}`. A refusal (the file exists, a turn under 0.05°, a symmetrised volume without its source) is a 200 with `written: false` and `refusal: {code, reason}`. The bridge's `dataset_regrid_json` returns the same fields. See [regrid.md](regrid.md) |
| GET | `/api/volumes/{id}/meta` | HKLVolume shape, axis ranges, lattice, UB, the symmetry the file declares (`symmetry`, `symmetry_ops`), and the settings the flatten that wrote it recorded (`flatten_settings`: its `fit_q_range`, `floor_percentile`, …; `null` for a stage the flatten did not write, or wrote before it recorded them) |
| GET | `/api/volumes/{id}/slice?plane=&value=&interp=` | binary 2D slice |
| GET | `/api/volumes/{id}/coverage` | where the counts begin and end in \|Q\|: the share of each shell's voxels holding counts, the edges where it crosses ½, where the shells stop being fully measured (the ΔPDF window's support), the shells' width, and the box's nearest face |
| GET | `/api/volumes/{id}/ub?cell=&q_max=` | whether the UB puts the Bragg peaks on their nodes, and the refined UB |
| GET | `/api/volumes/{id}/rings?q=&fwhm=` | which shells are powder rings: each rises in nearly every direction |
| GET | `/api/volumes/{id}/shell-floors?q_step=&percentile=&min_count=` | the flatten's floor of every \|Q\| shell over the whole volume (`centres`, `floors`, `counts`, `totals`, `medians`); for the flattened stage also of its input, the backfilled stage (`floors_before`, …), and the diffuse `level` the pedestal's span is a share of. Unset settings are those the flatten recorded in the file (returned as `flatten`, its fit range included), else its 0.05 Å⁻¹ shells, 25th percentile and 20 voxels. The bridge's `volume_shell_floors_json` returns the same fields. See [the floors and the pedestal](pipeline.md#the-floors-and-the-pedestal) |
| GET | `/api/volumes/{id}/texture?limit=&min_sigma=&one_way=&min_holes=&floor=` | for a backfilled stage, whether the fills sit systematically off the diffuse around their holes: the Pilot's `texture_check` rule on every punch hole of the dataset's punched stage (`punched_id`; the holes from the punch's record), each with its 3-D rim (`systematic_fill_bias`, `median_fill_bias_sigma`, `median_fill_bias_level`, `above_fraction`, `below_fraction`, the shares beyond the floor, and the `limit` holes farthest outside their range). Unset limits are the Pilot's: 0.5σ, three quarters of the holes, 5 holes, a fifth of the level. 400 for another stage, 404 without the punched stage. The bridge's `volume_texture_json` returns the same fields. See [the fills' texture](pipeline.md#the-fills-texture) |
| GET | `/api/deltapdf/{id}/meta` | ΔPDF shape, ranges, lattice, \|Q\|max |
| GET | `/api/deltapdf/{id}/slice?plane=xy\|xz\|yz&value=` | binary ΔPDF orthoslice |
| GET | `/api/deltapdf/{id}/features?min_sigma=&limit=` | the strongest extrema outside the origin's disk, grouped by the point group the raw file declares, else by sign, length and size (`grouped_by`) |
| GET | `/api/consistency/{dataset_id}/meta?q_min=&q_max=&r_min=&r_max=` | back-FFT metadata and metrics, and `settings`: the volume and transform the round trip ran and where they came from (`source` `"run"`, from the ΔPDF's record, or `"defaults"`; `input` the volume, the record's `made_from` when `same_input`; a `note` for every fallback; `defaulted` names what a partial record lacked) |
| GET | `/api/consistency/{dataset_id}/check` | the pipeline's saved back-FFT check metrics (no FFT) |
| GET | `/api/consistency/{dataset_id}/slice?panel=data\|recon\|residual\|dpdf&...` | binary consistency slice |
| POST | `/api/consistency/{dataset_id}/save` | save the band-limited back-FFT result |
| GET | `/api/bragg/{dataset_id}/profile` | the fitted Bragg profile the punch recorded |
| GET | `/api/rings/{dataset_id}/diagnostics` | what the ring stage recorded in its diagnostics: their `status`, and `unconfirmed_at_grid`, the ring candidates (powder rings or the crystal's own scattering) the pooled model detected and could not confirm on its grid, which it did not subtract (`count`, `needs`, the `notice` its run log ends on, `q_centers`), else null. Diagnostics older than the ring-removed volume give none (`has_diagnostics` false). The bridge's `ring_diagnostics_json` returns the same fields. See [which shells are rings](pipeline.md#which-shells-are-rings-and-the-grid-that-takes) |
| GET, PUT | `/api/data-root` | the data root the server reads, and changing it |
| POST | `/api/data-root/browse` | pick the data root in a native folder dialog |
| GET | `/api/health` | liveness |
| POST | `/api/pipeline/run` | start a job; returns `{id, status, ...}`. `stages` are the stages to run: one left out is a partial re-run, the stages after it reading its output on disk. `params.rings_enabled`, `punch_enabled` or `backfill_enabled` false (the flatten's: `flatten_enabled`) switches a stage off: it is not run, and its input passes through to the next stage. With `tuning: {run_id, trial}` the job is one tuning trial: it runs only that stage, into the trial's folder |
| POST | `/api/tuning/runs` | `{dataset_id, first_stage}` → a tuning-run folder, `{run_id, dataset_id}` |
| POST | `/api/tuning/runs/{run_id}/promote` | `{trial}` → copy the trial into the run's chain, drop the stage's trials |
| GET | `/api/pipeline/jobs/{id}` | a job's status |
| GET | `/api/pipeline/jobs/{id}/events` | SSE progress stream |
| POST | `/api/pipeline/jobs/{id}/cancel` | terminate a running job |

Volume ids are `"<dataset_id>.<stage>"` (e.g. `sample.backfilled`, `sample.delta_pdf`).

## Development

Run the backend and the Vite dev server (hot reload) separately:

```bash
# terminal 1 — API on :8000
nebula3d-web --no-browser --reload

# terminal 2 — Vite dev server on :5173 (proxies /api to :8000)
cd web && npm install && npm run dev      # http://localhost:5173
```

Frontend layout:

| Path | What |
| --- | --- |
| `web/src/App.tsx` | sidebar shell + view routing |
| `web/src/pages/` | one component per view (config, execution, reciprocal, Bragg profile, ΔPDF, consistency; the multi-volume page is kept but unrouted) |
| `web/src/components/` | shared panels (`SliceCanvas`, `Workspace`, `ViewFrame`, `UnitCellGrid`, `StructureOverlay`, `PilotDock`) + UI primitives (`ui.tsx`) |
| `web/src/api/` | typed fetch client (`client.ts`), the Pyodide engine (`pyodideEngine.ts`), React Query hooks, response types |
| `web/src/workers/` | ES-module workers: `pyodideWorker.ts` (the pipeline) and `ringWorker.ts` (the ring pool) |
| `web/src/state/` | zustand stores for cleanup + ΔPDF view state |
| `web/src/colormaps/` | client-side colormap LUTs |

The React app is built into **two** gitignored targets (rerun the matching one
after editing `web/src`):

```bash
make ui            # → src/nebula3d/server/static   (served by native nebula3d-web; bundled in the wheel)
make ui-pages      # → web/dist                  (GitHub Pages / Pyodide build)
```

> **Heads-up — the native bundle can go stale.** `src/nebula3d/server/static/` is a
> gitignored build artifact that only changes when you run `make ui`. If you edit
> `web/src` (or pull) and don't rebuild, `nebula3d-web` keeps serving the **old** UI
> (it prints a `[warn]` at startup when the bundle is older than `web/src`). After
> rebuilding, hard-refresh (Cmd/Ctrl-Shift-R). The two targets are independent.

Frontend checks (run in CI; `build` type-checks first):

```bash
cd web && npm run lint && npm test && npm run build && npm run build:pages
```

## Packaging & the data-free wheel

The native SPA in `src/nebula3d/server/static/` is a build artifact (git-ignored);
`package-data` bundles `static/**/*` so the published wheel serves the UI with no
Node toolchain on the user's side. A release build is `cd web && npm ci &&
npm run build`, then build the wheel.

The **Pages** build instead micropip-installs an `nebula3d` wheel at runtime, so it
must be built **data-free** — a careless build can bundle experimental data via
the packaged `static/`. Three guards, in depth:

1. `pyproject.toml` `exclude-package-data` drops `static/data/*` and
   `static/wheels/*` from every wheel (the latter is the Pyodide wheel that
   `vite build` used to copy into `static/`, which made each wheel nest the
   previous one; the native build no longer copies `web/public` at all).
2. `scripts/build_web_wheel.py` — what `make web-wheel` and the Pages workflow
   run — inspects the built wheel and refuses any data suffix, anything under
   `static/data/` or `static/wheels/`, or a nested `.whl`.
3. It then publishes the wheel **content-addressed** at
   `web/public/wheels/<sha256[:12]>/…` and writes `manifest.json`, so a redeploy
   can never serve a Pages-cached stale wheel under a version-only name.

```bash
make web-wheel          # = python scripts/build_web_wheel.py
```

A clean wheel is ~330 KB (more if `server/static` holds a built SPA).
`tests/test_build_web_wheel.py` covers the guards.

## In-browser design notes

- **Why Pyodide (with targeted WebGPU), not a JS/WGSL rewrite or pre-baked
  data.** `nebula3d` is pure Python and its compute deps (numpy/scipy/h5py) are
  official Pyodide packages, so the existing, regression-gated pipeline runs in
  the browser essentially unchanged.  The two places parallel/GPU compute
  actually pays are handled surgically without giving that property up: the
  ring stage, with the per-plane ring models, parallelises across Pyodide ring
  workers running the *identical* per-plane Python (bit-identical results), and the
  memory-dominant ΔPDF FFT block runs on WebGPU behind the shared
  prepare/core/finish seam in `nebula3d.analysis.delta_pdf` (only the
  `fftshift(fftn(ifftshift(pad(·))))` core is replaced; windowing, mean, and
  deapodization stay single-source Python, and the GPU result is
  tolerance-gated against the scipy core).  An earlier idea of rewriting the
  whole pipeline in WGSL stays rejected — the robust fits are a poor GPU fit.
  Pre-baked static volumes were rejected because they would require *hosting
  the data*.
- **Pyodide gotchas.** The wheel declares matplotlib as a dependency but the
  browser never imports it (`nebula3d.visualization` is lazy and the bridge
  skips the native `pdf_check` PNG), so the boot loads only numpy/scipy/h5py
  and installs the wheel with `deps=False`. Pipeline entry points: `nebula3d.load`,
  `nebula3d.core.HKLVolume.from_arrays`, `nebula3d.pipeline.run_pipeline`,
  `nebula3d.analysis.compute_delta_pdf`.
- **Privacy.** The public app ships **no data**; users supply their own at
  runtime. `web/public/data/` and `web/public/wheels/` are gitignored, and the CI
  wheel build is data-free.
