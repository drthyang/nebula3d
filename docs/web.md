# Web UI

`nebula3d` ships **one** browser console — a React + TypeScript SPA (Vite)
that unifies the cleanup, 3D-ΔPDF, and consistency views, adds an AI assistant (NEBULA Pilot),
and drives the whole reduction pipeline. It has two interchangeable run modes
that share the same UI and the same `nebula3d` reduction code:

| Mode | `VITE_DATA_MODE` | Backend | Use it for |
| --- | --- | --- | --- |
| **In-browser** | `pyodide` | none — `nebula3d` runs in the browser via Pyodide | Fully static GitHub Pages app, no install; the complete pipeline at full-resolution float64 (up to ~50 M voxels) |
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
- **Parallel ring removal.** The ring stage (~70 % of a serial browser run) fans
  its independent per-plane fits out over a pool of slim Pyodide **ring
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

  (The default Bragg backfill, `backfill_bragg` with `method="local"`, is
  connected-component / `ndimage`-based and already lean: ~25 B/voxel transient
  vs ~41 for the former `q_shell` default; `laplace` adds ~10 B/voxel on top of
  `local` on a measured 401×401×301 volume, and its sparse solve runs in
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
noise is drawn one H plane at a time, in place), below the ring stage's
~195 MB, so the demo never sets the WASM heap's high-water mark. Every stage
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
nebula3d HDF5 file in the legacy layout (`/entry/{data, mask, h_axis, k_axis,
l_axis, ub_matrix}`, padded symmetric about Q = 0; it still loads, while
everything this app writes is a Mantid MDHistoWorkspace file) and sends it:

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
| **Configure / Run pipeline** | `run_pipeline.py` | Pick a dataset and tune the key parameters per stage — ring removal (azimuthal **patches**, texture **Fourier order**), punch (HKL ↔ Q-space frame), backfill, flatten, ΔPDF, consistency — then run all stages with a live stepper and log. Existing outputs are skipped unless *force* is on. The form is remembered per dataset in the browser, with the selected dataset: another temperature of the same sample starts from the form as it stands, another sample from the defaults (`state/configMemory.ts`). Default landing view. |
| **Reciprocal cleanup** | `explore_slice.py` | One view per HKLVolume stage (raw / ring-removed / punched / backfilled / flattened) on one H/K/L plane and cut, in the [viewer workspace](#viewer-workspace). All views share **one colour range**, set from a reference stage (the output stage by default, or *Each view* to scale each stage on its own), and one linked zoom and crosshair; hovering reads every stage's value at the same (K, L). The cut readout is an **editable box** — type `0.3333` and it snaps to the nearest plane. |
| **3D-ΔPDF** | `explore_delta_pdf_ortho.py` | Three real-space orthoslices (x_H–y_K, x_H–z_L, y_K–z_L) in the [viewer workspace](#viewer-workspace), each with its own cut slider, one shared ± colour range, a gray dashed unit-cell overlay and an optional [structure overlay](#structure-overlay) of interatomic vectors. Views open at ±40 Å. In *Navigate* mode a click on one view moves the other two cuts through the point. |
| **Multi-volume** _(hidden in 0.3.0)_ | `explore_delta_pdf_multi.py` | Related ΔPDF files × the three planes as a square grid, sharing cut, window, and contrast; a per-plane colour scale pooled across files. Component retained; unrouted from the sidebar for now. |
| **Q–R Band Transform** | `delta_pdf_consistency.py` | Back-FFT check: inverse-transforms the ΔPDF to reciprocal space and shows **data, ΔPDF, back-FFT and residual** as four views (focus layout, data large, by default), with agreement metrics (Pearson r, normalised RMS) in the header. Data, back-FFT and residual share one plane, cut, colour range and view; the residual has its own ± range on a diverging map. The ΔPDF plane follows the Q plane (H ↔ x, K ↔ y, L ↔ z) while *Link orientation* is on. **\|Q\|** and real-space **\|R\|** bands, each with its own *Apply* in the view footer, isolate which ranges support a signal; applying a band keeps both cuts. The \|Q\| band is drawn as its true contour on the r.l.u. axes: a circle for an orthogonal cell, a tilted ellipse (centred off the origin where the cut axis is not normal to the plane) for any other. |
| **NEBULA Pilot** | — (new) | A panel docked beside every page (opened from the sidebar; it slides over the page on narrow screens). Connect a local (Ollama / LM Studio) or cloud (OpenAI / Gemini / Anthropic) model. One **chat**: free questions, five one-click stage reviews, and two one-click requests (*Assess the run*, *Tune for the best result*), grounded in metrics computed in the browser. With **Tools** on, the model measures any cut, judges each stage on three planes, checks the punch and backfill for texture and the ΔPDF's Qmax against the data coverage, reads the Bragg profile, back-FFT check and run log, compares datasets, opens the viewer beside the chat, and acts: it runs the pipeline (shown live on the Execution page and in the chat), changes settings, and tunes the pipeline one stage at a time, keeping the best settings for each. Optional vision opt-in attaches the rendered slice for image-capable models. |

### Viewer workspace

The slice views (Reciprocal cleanup, 3D-ΔPDF, Q–R) share one workspace, after
the [NeXus Viewer](https://drthyang.github.io/neutron-nexus-viewer/)'s, so the
two apps work the same way.

- **Layouts** (icons at the right of the workspace header): *Grid* (every view
  the same size), *Focus* (one large view; the others are thumbnails beside it —
  2 × 2 with four of them, a column otherwise — and a click on one makes it the
  large view) and *Single* (one view; Esc returns). Each view's header has
  *Reset zoom*, *focus* and *maximize*; double-clicking a header maximizes it.
  The layout is remembered per page. Phones show every view, one per row.
- **Click modes** (left of the header, remembered): *Navigate* — hover reads
  values, and on 3D-ΔPDF a click moves the other two cuts through the point;
  *Zoom* — a click zooms in 2× (Alt-click zooms out), a drag zooms into the box;
  *Move* — a drag pans. In every mode a double-click returns to the full view
  and a trackpad or two-finger pinch zooms; a plain scroll wheel still scrolls
  the page. Views fill their cell: the field of view (the chip in each view's
  corner, ± Å⁻¹ or ± Å) spans the shorter side, and a wide view shows more.
- **Display bar**: colormap, then the colour range — vmin, the colour bar with
  the reference data's histogram behind it and a handle at each limit, vmax —
  then *asinh / lin / log*, *Auto* and *Brightness*. *Auto* sets vmin 0 (± for
  signed data), vmax at the 97th percentile and the asinh softening at the
  median of the positive values, from the centre cut, so the scale holds still
  while the cut moves. *Brightness* moves vmax in stops about Auto: right is
  brighter. Typed or dragged limits hold until *Auto* or a dataset change.
- **Shared settings**: the reciprocal plane, cut, colour range, scale and zoom
  are shared by Reciprocal cleanup and Q–R; the ΔPDF colour range, colormap,
  unit cells and zoom by 3D-ΔPDF and Q–R.

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

The assistant lives entirely in the browser (`web/src/llm/`) and follows a
*metrics-compute-the-truth, the-LLM-narrates* design: deterministic pure
functions derive real diagnostic numbers from the same slice envelopes the
viewers already fetch, and those numbers (never the raw volume) are sent to the
model as compact JSON. Nothing leaves the machine except the chat calls to the
model server the user configured — local providers keep everything on-device;
cloud providers are gated behind a data-leaves-your-device warning.

It is a panel docked beside every page (`components/AssistantPanel.tsx`), so it
can move the viewer while the conversation stays in view. The conversation and
any reply still streaming live in module-scoped stores (`chatStore.ts`,
`session.ts`), so closing the panel or changing pages does not stop them.

- **`metrics/`** — one pure module per judgment, each unit-tested
  (`vitest`, `npm --prefix web run test`):
  - `rings.ts` — residual powder-ring energy (localized bumps in the radial
    profile of shell **medians**, so Bragg peaks left before the punch do not
    dominate; sparse shells near the origin and in the box corners are left
    out) before vs after, over-subtraction fraction, and a suggested display
    ceiling. Shells are binned in true |Q| under the reciprocal metric
    (`qRadius` in `context/pipelineContext.ts`), so rings stay round on
    hexagonal and monoclinic cells. Its floor is not 0: on the synthetic demo
    volume a perfect removal gives 0.42–0.55, which the ring stage reaches.
    It also judges the removal at each ring of the raw cut: the ring-removed
    profile across the ring against a line through the diffuse beside it, as
    a share of that diffuse (negative: a dent, the subtraction over-shot;
    positive: a ring left over), significant only beyond 3 × the flanks' own
    scatter. `assess_stage` counts a ring only where two planes see it at one
    |Q| (a bump on one plane is the crystal's own scattering) and names the
    plane and |Q| of the worst.
  - `punch.ts` — scans the *punched* slice for peaks the punch missed: each
    must stand 8 local σ above its own neighbourhood and span more than one
    voxel. Spikes in noisy or sparse-count regions (the coverage edge: a
    neighbourhood a quarter exact zeros, or below a tenth of the slice's
    median level) are counted apart. With the cut known, each peak is classed
    at a lattice node (honouring the punch cell) or off-lattice, on the
    search's protected planes or not, and sharp or broad by its FWHM: a broad
    one (≥ 5 voxels along a slice axis) is a diffuse maximum kept, not a punch
    candidate. It also summarises the fitted `BraggProfile`
    (resolution-limited fraction, measured widths, anisotropy).
  - `backfill.ts` — hole-rim seam magnitude (σ units), bright residual plugs, and
    a checkerboard-fraction that flags periodic interpolation artefacts.
  - `flatten.ts` — the per-|Q|-shell floors (25th percentile) before and after
    the flatten, in thirds of |Q|, the largest leftover floor in σ, and the
    pedestal removed. Over every well-measured shell out to the coverage
    edge, `floor_trend` (the floors' rank correlation with |Q|) and
    `floor_span_fraction` (their range against the diffuse level) catch a
    pedestal the σ test hides beside strong diffuse structure.
  - `dpdf.ts` — feature SNR vs background, strong-feature anisotropy (covariance
    ratio + orientation), radial trend, and back-FFT consistency pass-through.
- **`context/`** — `loadContext.ts` fetches one cut through every stage (H–K at
  L=0 and the ΔPDF z=0 section by default, any cut on request) plus the run's
  records; `pipelineContext.ts` folds the metrics into the budgeted JSON
  context. **`prompts/`** — the domain system prompt (plus a tools section when
  tools are on) and the per-stage message builders. **`provider/`** — a
  dependency-free streaming OpenAI-compatible client with function calling, and
  Claude through Anthropic's SDK behind the same calls (`anthropic.ts`, loaded
  only when Anthropic is picked): system messages become the system prompt,
  a round's tool results go back in one user message, and a turn that called
  tools is replayed exactly as Claude returned it, thinking included.
  **`settings.ts`** — a localStorage store (provider, model, key, temperature,
  vision and tools opt-ins).
- **Tools** (`tools/`, `agent.ts`) — with *Tools* on, a reply is an agent loop:
  the browser runs each call the model makes against the same API the viewers
  use, sends the JSON back, and the model continues — up to twelve rounds. Every
  argument is checked; a bad call comes back to the model as an error it can
  correct. The transcript lists each call, which opens to its arguments and
  result, and a long one shows a live line while it runs. As each measuring or
  assessing call finishes, the console moves to the figure it looked at
  (*Follow*, on by default; `tools/openView.ts`): the cleanup page at its cut (a
  stage's worst plane for `assess_stage`, the strongest fill bias for
  `texture_check`), the 3D-ΔPDF at its section, the Bragg profile with its peak
  selected, the Q–R band transform for the back-FFT check, or the Execution
  page for the run log. Each step's *Show* reopens its figure. While the panel
  is open, the cards the agent is on breathe a blue edge (`llm/highlight.ts`,
  `.ai-glow`): those a running step works on (narrowed to the stage a run or a
  tuning run is on), then those its answer mentions, for 8 s after the reply.
  The cleanup, 3D-ΔPDF and Q–R views, the Bragg profile panels, the Execution
  stages and log, and the Configure stage boxes all take it. A model or server
  that refuses tools gets the plain request and a note saying so.
  - *Reading*: `describe_dataset`, `current_view`, `measure_reciprocal_cut`,
    `measure_dpdf_cut`, `line_profile`, `bragg_peaks`, `consistency_details`,
    `compare_datasets`, `configure_settings`, `run_log` (the last run's log).
  - *Assessing* — the four checks the system prompt asks of every run:
    `assess_stage` judges a stage against its goal on the three principal
    planes (the tuning run's own evaluation, `tune/evaluate.ts`);
    `radial_profile` puts the stages' |Q|-shell medians side by side (rings
    left or diffuse dented); `texture_check` (`metrics/texture.ts`) asks
    whether the fills sit systematically above or below their rims (a
    lattice-periodic pattern; flagged at a median ≥ 0.5σ with ≥ 75 % of holes
    one way) and whether the punch and backfill add variation around each |Q|
    shell; `qmax_coverage` (`metrics/coverage.ts`) gives the share of the
    ΔPDF window's weight on unmeasured space, read from the ΔPDF's provenance
    (≲ 10⁻³ is clean), with the window's shape and scale. On a file without it,
    it compares how far the forward transform's window reaches in |Q| (the |Q|
    band if set, else the box faces, the coverage edge when tapered to it, or
    the box corners for a flat separable window) with the |Q| where shells
    stop being 95 % measured.
  - *Acting*: `update_settings` (the method choices and thresholds in
    `tune/catalog.ts`, and, when the user names them, the sample facts the
    tuner never proposes: the search's protected planes and the punch cell),
    `run_pipeline` (as the Run button: the console moves to the Execution page;
    without `from_stage` it computes what is missing, with it it recomputes from
    that stage on), `tune_pipeline` (below), and `show_in_viewer`. Neither run
    starts while another is going, and *Stop* cancels the one the model
    started.
- **Tuning** (`tune/`, the `tune_pipeline` tool) — the chat starts it when asked
  for the best result, and shows each stage's trials under that reply
  (`components/TuneProgress.tsx`). It runs the pipeline one stage at a time (rings →
  punch → backfill → flatten → ΔPDF). For each stage it runs the user's
  settings, asks the model for up to *n − 1* alternatives, runs each, measures
  every trial on the three principal planes (`tune/evaluate.ts`), and asks the
  model which trial best meets the stage's goal (`tune/prompts.ts` states each
  goal and its trade-off, e.g. no leftover peaks *without* punching more
  diffuse). The chosen settings go to the Configure page. The model can only
  change the settings in `tune/catalog.ts` — method choices and thresholds, not
  facts about the sample (supercell, protected planes, magnetic ion, |Q|
  band) — and every proposal is checked against it before anything runs.
  The tool's report holds every trial's changes and numbers, marking a trial
  whose numbers equal the current settings' as `no_effect`, so the model
  quotes the comparison rather than recalling it. When every tuned stage
  keeps the current settings, the later stages are not re-run.
  **Trials never touch `processed/`** (`nebula3d.server.tuning`). Each run gets
  a folder beside it, `tuning/<run>/`; each trial runs into
  `tuning/<run>/trials/<stage>-<n>/`, reading its input from the run's own
  chain, `tuning/<run>/processed/` (or from `processed/` for the stages before
  the run's first one — `run_pipeline(inputs=…)`). Keeping a trial copies its
  files into the chain, where the next stage reads them, and deletes the
  stage's trial folders; untuned stages between tuned ones are re-run once into
  the chain. A trial is measured through a dataset view of it,
  `<id>~tune~<run>~<stage>-<n>`, so every slice, Bragg-profile and
  back-FFT-check endpoint serves it unchanged; the chain, `<id>~tune~<run>`, is
  listed after its dataset in the sidebar once a stage is kept. The browser
  build does the same in its virtual file system (`webbridge.run`/`run_async`
  with `tuning_run`/`tuning_trial`, `tuning_start_json`,
  `tuning_promote_json`). `tests/test_tuning_runs.py` checks, through the
  library, the server's job processes and the bridge, that a tuning run leaves
  every file in `processed/` byte-identical.
- **Vision** (`render/sliceImage.ts`) — when enabled and the model is
  vision-capable, the rendered slice PNG is attached to stage reviews so the
  model can literally assess the image alongside the numbers.

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
| GET | `/api/datasets` | discovered datasets with per-stage output status (tuning runs' chains included) |
| GET | `/api/datasets/{id}` | one dataset, or a tuning view: `<id>~tune~<run>` (the run's chain) or `<id>~tune~<run>~<stage>-<n>` (one trial) |
| GET | `/api/volumes/{id}/meta` | HKLVolume shape, axis ranges, lattice |
| GET | `/api/volumes/{id}/slice?plane=&value=&interp=` | binary 2D slice |
| GET | `/api/deltapdf/{id}/meta` | ΔPDF shape, ranges, lattice, \|Q\|max |
| GET | `/api/deltapdf/{id}/slice?plane=xy\|xz\|yz&value=` | binary ΔPDF orthoslice |
| GET | `/api/consistency/{dataset_id}/meta?q_min=&q_max=&r_min=&r_max=` | back-FFT metadata and metrics |
| GET | `/api/consistency/{dataset_id}/check` | the pipeline's saved back-FFT check metrics (no FFT) |
| GET | `/api/consistency/{dataset_id}/slice?panel=data\|recon\|residual\|dpdf&...` | binary consistency slice |
| POST | `/api/pipeline/run` | start a job; returns `{id, status, ...}`. With `tuning: {run_id, trial}` the job is one tuning trial: it runs only that stage, into the trial's folder |
| POST | `/api/tuning/runs` | `{dataset_id, first_stage}` → a tuning-run folder, `{run_id, dataset_id}` |
| POST | `/api/tuning/runs/{run_id}/promote` | `{trial}` → copy the trial into the run's chain, drop the stage's trials |
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
| `web/src/pages/` | one component per view (config, execution, reciprocal, ΔPDF, multi-volume, consistency) |
| `web/src/components/` | shared panels (`SliceCanvas`, `SlicePanel`, `DpdfPanel`, `UnitCellGrid`) + UI primitives (`ui.tsx`) |
| `web/src/api/` | typed fetch client (`client.ts`), the Pyodide engine (`pyodideEngine.ts`), React Query hooks, response types |
| `web/src/workers/` | the classic Web Worker hosting Pyodide |
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

Frontend checks (run in CI):

```bash
cd web && npm run lint && npm run typecheck && npm run build
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

A clean wheel is ~230 KB. `tests/test_build_web_wheel.py` covers the guards.

## In-browser design notes

- **Why Pyodide (with targeted WebGPU), not a JS/WGSL rewrite or pre-baked
  data.** `nebula3d` is pure Python and its compute deps (numpy/scipy/h5py) are
  official Pyodide packages, so the existing, regression-gated pipeline runs in
  the browser essentially unchanged.  The two places parallel/GPU compute
  actually pays are handled surgically without giving that property up: the
  runtime-dominant ring stage (~70 %) parallelises across Pyodide ring workers
  running the *identical* per-plane Python (bit-identical results), and the
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
