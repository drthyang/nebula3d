# Changelog

## Unreleased

- **The Bragg punch now fits each peak's tilt, in Q.** Before this, the
  default pipeline fitted three radii along H, K, L, so no integer peak was
  tilted. The opt-in covariance fit did not follow the data either: it took
  eigenvectors in HKL, floored them at an HKL bounding box, read the core from
  a ±0.2 r.l.u. window (±1 voxel along c* here), and used the width of the 35 %
  core, which is 0.61σ for a Gaussian. On the TbTi3Bi4 100K volume, 44 % of
  peaks were floored on all three axes, and 0.7 % were set by the data on all
  three. `integer_optimize_shape` is now the covariance fit, in Q (the
  pipeline default):
  - takes the core's covariance in Q (`Σ_Q = UB·C·UBᵀ`), from a window sized
    in Å⁻¹, using only voxels connected to the peak;
  - divides by the Gaussian core-cut factor, so the widths are σ;
  - clips the ellipsoid to contain the punch frame's resolution ellipsoid and
    lie inside `max_radius_scale`× it;
  - leaves peaks whose cut is within `integer_fit_noise_n_mad` (3) noise
    sigmas of the background at the resolution ellipsoid;
  - adds the Å⁻¹ `margin` to the principal radii in Q.

  On synthetic tilted peaks on the real UB, the punch's long axis is now
  3–16° from the truth, where it was 26–31°. On 100K, 99 % of fitted peaks
  have at least one axis set by the data, and the measured long axes sit a
  median 38° off the spherical frame's φ̂. The default pipeline punches 4.45 %
  of voxels, up from 3.75 %; in integer mode it leaves 6.4 % of the
  strong-peak excess outside the punch, down from 7.1 %. `measure_peak_sigmas`
  and `measure_peak_covariance` (the profile's measured widths) use the same
  cut-corrected core, so the width histogram reads 1.65× wider than
  before. The position-only fit takes the same core's centroid. The
  default-punch golden master was regenerated (612 → 489 voxels). Profile
  JSONs from earlier runs predate this change.
- **Removed the diagonal Bragg-shape fit**: three radii along H, K, L, so no
  tilt, floored at an HKL bounding box; the same class of r.l.u. punch as the
  removed HKL frame. `integer_fit_covariance` is gone from `BraggRemover` and
  `PunchParams`, `punch_fit_covariance` from the run request, and the
  Configure page's "Fit tilted ellipsoid" switch with it; "Drop fit
  constraints" stays. Peak records no longer carry `radii_hkl`. A peak where
  the punch frame is undefined (at the origin) still gets the base
  ellipsoid's HKL bounding box. The profile JSON keeps `fit_covariance` (true
  when the shape fit ran) for readers of older profiles.
- **Removed methods with no physical basis.**
  - Generic image inpainting as a backfill: `method="tv"`, `"symmetry"`,
    `"symmetry+tv"` and the `nebula3d.inpainting` package (TV, Laue-symmetry
    copying, RBF, biharmonic). TV assumes a piecewise-constant image and leaves
    staircase artefacts in structured diffuse scattering, and every symmetry
    copy of a punched Bragg node is itself punched. The older ring workflow that
    used it went too: `backfill_ring_shells` (`preprocessing/backfill.py`) and
    `preprocessing/residual_rings.py`. The production ring stage subtracts its
    model, and anything it masks is filled by the Bragg backfill from its own
    surroundings. `backfill_bragg` now takes `local`, `laplace` or `q_shell`, and
    raises on anything else; `BackfillParams` lost `laue_class`, `tv_lam`,
    `tv_iter`.
  - The flatten's `median` and `mode` estimators. A |Q| shell's median or mode
    includes the diffuse signal itself, so subtracting it removes real diffuse
    scattering (the flatten validation found both over-subtract). `floor`
    (default) and `snip` remain.
  - Morphological grey opening as the ring-model baseline
    (`baseline_method="opening"`). It is a shape filter, not a background
    model, and dips below a diffuse background that falls with |Q|. SNIP is now
    the only baseline, so `baseline_method` is gone from `PatchedRadialRingModel`
    and `ParametricRingModel`.
  - Bragg punch radii in fractional HKL (`punch_frame="hkl"`, `punch_radii`,
    `punch_radius_hkl`; `punch_radius_h/k/l` in the run request). The
    resolution is set in Q, so r.l.u. radii depend on the cell and shear on
    oblique axes. The punch is sized in Å⁻¹ only: per peak in the spherical
    frame (the default, now also for `BraggRemover()` and `bragg_mask`) or
    along a*, b*, c* (`"q"`). `punch_frame="hkl"` raises. The `margin` guard
    band is Å⁻¹ everywhere, including the covariance-fit path, which inflated
    by r.l.u. outside the `"q"` frame. The default direct-beam punch, when no
    beam radii are set, is twice the Bragg punch's HKL bounding box. The
    default pipeline punch is unchanged: the same mask on the TbTi3Bi4 22K
    volume. `examples/compare_punch_frames.py` and `plot_punch_slices.py`
    (HKL vs Q comparisons) were removed, and the punch examples take
    `SPHERICAL_R` (Å⁻¹) instead of `R_HKL`.

  The Configure page no longer offers the removed options. Docs, examples and
  the manual source follow.
- **The edge of the measured coverage is trimmed at load, on by default.** A
  measured voxel next to unmeasured space is barely normalised. On the 401³
  Fe3Ge2 TOPAZ volume those voxels reach p99 ≈ 4,000 and a maximum of
  5.5·10⁷, while one voxel further in they match the interior (p99 ≈ 38
  against 34). They went straight into the ΔPDF, and as Laplace boundary
  values they lit up the holes next to them. The pipeline now takes
  `PipelineParams.edge_trim` layers (default 1; 0 keeps them) off the measured
  coverage when it loads the raw input: those voxels become unmeasured, masked
  and zeroed as the loader leaves unmeasured voxels, and the run log says how
  many. The volume's own faces are not an edge. A fully measured volume such
  as TbTi3Bi4 22K loses ~7,000 of 48.4 M voxels; Fe3Ge2 loses 2.8 M, and its
  default punch then finds 52,281 peaks instead of 120,104 (most of the rest
  were edge voxels), punching 1.59 M voxels instead of 2.97 M. Existing
  outputs are not recomputed by themselves: re-run from the ring stage.
  `nebula3d.preprocessing.trim_coverage_edge`, `nebula3d.pipeline.load_input`,
  `edge_trim` in the run request (+ tests).
- **Backfill: each punched hole is filled from its own surroundings.** The
  backfill took every masked voxel for a hole, so a punched hole that touched
  unmeasured coverage merged with it, and the whole region (coverage and every
  hole touching it) got one fill value set by the coverage's rim. On the
  401³ Fe3Ge2 TOPAZ volume (73 % unmeasured) that was 82 % of the punched
  voxels, which showed as flat discs that did not match the data around them.
  The punch stage now records which voxels it punched, in memory and as
  `/entry/punched` in `*_braggpunched.h5`, and `backfill_bragg(punched=…)`
  fills each hole only from the measured voxels around it. The coverage is
  filled separately afterwards, with its own shell median. For `laplace`,
  unmeasured neighbours are a free (Neumann) boundary. On Fe3Ge2, the holes
  whose mean fill is more than 3 MAD from the median of the measured voxels
  within 2 voxels of them drop from 6.6 % to 0.0 % (`local`), and the median
  offset halves. A punch artifact written before this change has no record:
  the backfill says so in the run log and fills as before. Re-run the punch to
  fix it. `src/nebula3d/analysis/bragg_fill.py`, `src/nebula3d/pipeline.py`
  (+ tests).
- **Desktop browsers: large volumes no longer run out of memory in the
  backfill.** A 401³ TOPAZ volume (64.5 M voxels, inside the ~80 M-voxel
  limit) failed in the browser with a `MemoryError` in the backfill. Four steps
  each built a full float64 |Q| grid with its temporaries, ~25–40 B/voxel on
  top of the volume: the cross-plane ring confirmation, the punch's per-|Q|-shell
  thresholds, the radial flatten and, on that volume, the direct-beam fill. Its
  unmeasured coverage (73 % of the cube) reaches the origin, so the direct-beam
  fill took all of it for the beam. The first three now compute |Q| one plane
  or one 16-plane slab at a time, with identical values. The direct-beam fill
  leaves an origin region whose bounding box is over 2 M voxels (a real beam's
  is ~2,000) to the generic fill. On the TOPAZ volume the old beam fill found
  no clean shell there and filled nothing, so every stage output is
  byte-identical, as it is on the 48.4 M-voxel TbTi3Bi4 volume. The Laplace
  fill also frees its unknown lists for an oversized region before filling it
  locally (same output). Under Pyodide 0.27.7 the WASM heap now peaks at
  2.8 GiB on the TOPAZ volume (it failed at 3.8 GiB; 2.9 GiB with
  `method="laplace"`), 2.1 GiB on the TbTi3Bi4 volume (was 2.5 GiB) and
  2.9 GiB on a fully measured 79.5 M-voxel volume at the limit (the old code
  hit the 4 GiB ceiling there), out of 4 GiB.
  `src/nebula3d/preprocessing/radial_background.py`,
  `src/nebula3d/analysis/bragg.py`, `src/nebula3d/analysis/bragg_fill.py`,
  `src/nebula3d/preprocessing/radial_flatten.py`, `tests/test_memory_peaks.py`.
- **Phones and tablets: a size limit that fits the device.** Loaded volumes
  (**Load volume…** and the NeXus Viewer import) were checked only against
  the desktop budget of ~80 M voxels, so a phone accepted volumes that the OS
  would kill the tab over mid-run. On a phone or tablet the gate now budgets
  the whole tab: ~0.55 GB of runtime + packages plus 150 B/voxel (measured
  ~125 B/voxel on a full demo run, plus room for a Mantid input's float64
  signal and errors) against 1.3 GB, i.e. up to ~5 M voxels (≈ 171³; the demo
  is 4.2 M). A larger file is refused before it loads, with a message that
  points to a desktop browser (up to ~80 M voxels) or the native build.
  Desktops are unchanged. The page detects the device (`web/src/api/device.ts`,
  now shared with the ring pool) and sends it in the pipeline worker's boot
  message to `webbridge.setup(mobile=…)`, because only the main thread can tell
  iPadOS from a Mac. `inspect_input` reports `device`.
  `src/nebula3d/webbridge.py`, `web/src/api/pyodideEngine.ts`,
  `web/src/workers/pyodideWorker.ts` (+ tests).
- **iPhone / iPad: the in-browser run no longer reloads the page mid-run.**
  On iOS every browser is WebKit, which runs all of a page's workers inside one
  content process. The OS kills that process at a memory limit far below a
  desktop's, and Safari then silently reloads the page. The ring-worker pool
  sized itself as `min(4, hardwareConcurrency − 2)`, and WebKit reports 4 on an
  iPhone, so it added two extra Pyodide + numpy/scipy instances (~0.45 GB
  resident each, measured) to the pipeline worker. With the 161³ demo that
  took a run past the limit. Phones and tablets (iOS, iPadOS — which sends a
  desktop-Mac user agent, so it is caught by its touch points — and Android)
  now get no ring workers. The ring stage runs serially in the pipeline worker
  instead, with bit-identical output. The `nebula3d.ringWorkers` localStorage
  setting still overrides. `web/src/api/ringPool.ts`, `web/src/api/device.ts`
  (`isMobileDevice`, + tests).
- **The demo volume is labelled synthetic and costs less memory.** The file
  and dataset are now `synthetic_rocksalt` (was `demo_rocksalt`), and the
  Configure page says it is simulated, not measured data. It is stored float32,
  which is what the browser computes in, so its in-memory file halves
  (52 → 23 MB). `demo_volume` draws the counting noise one H plane at a time, in
  place (`dtype=` sets the storage precision). Generating 161³ then peaks at
  ~76 MB of arrays instead of ~220 MB, below the ring stage's ~195 MB, so the
  demo no longer sets the WASM heap's high-water mark (measured under Pyodide
  0.27.7: 179 MB after generation, was 325 MB). Measured under Node, a full
  demo run's pipeline worker is ~1.07 GB resident (was ~1.27 GB). On a phone it
  no longer carries two ring workers of ~0.45 GB each, so the total is roughly
  half.
  `src/nebula3d/demo.py`, `src/nebula3d/webbridge.py`, `tests/test_webbridge.py`.
- **New demo volume: finer grid, physical diffuse scattering.** **Use demo**
  loads a 161³ volume (was 33³) over ±4 r.l.u., step 0.05 r.l.u. (0.075 Å⁻¹).
  That is fine enough for resolution-limited Bragg peaks and a 0.5 Å ΔPDF
  grid, and the full chain still runs in about 5 s in the browser. The crystal
  is rock-salt-type (cubic, a = 4.2 Å, FCC lattice), on the intensity scale of
  a normalised Mantid volume (Bragg up to ~150, diffuse ~0.1–0.5), with three
  kinds of diffuse scattering, each with a known 3D-ΔPDF signature:
  - chemical short-range order (Krivoglaz–Clapp–Moss, V2/V1 = 0.3): maxima at
    (1 ½ 0); in the ΔPDF, negative at ⟨½ ½ 0⟩a and positive at ⟨1 ½ ½⟩a and
    ⟨2 0 0⟩a;
  - one-phonon thermal diffuse scattering of a nearest-neighbour FCC lattice
    (Q·D⁻¹·Q): halos at every node, growing as |Q|², streaking along ⟨110⟩;
  - 2-D order in the (001) layers: rods along L at (h+½, k+½), a checkerboard
    confined to the z = 0 plane in the ΔPDF.

  Also in the volume: FCC Bragg peaks with a |Q|-dependent resolution ellipsoid
  and Debye–Waller falloff, a radial background, a compact incident-beam spot,
  aluminium-can powder rings at the Al d-spacings with texture about c*,
  Poisson counting noise, and a matching per-voxel `sigma`. On the old demo,
  whose Bragg peaks were ~10× the diffuse and smaller than a voxel, the default
  punch reported 114 peaks and only 34 of them were at FCC nodes; the rest were
  noise at high |Q|. On the new one it finds only FCC nodes, and every diffuse
  maximum sits off the integer nodes so none is punched. The ΔPDF reproduces
  the ground truth of the planted diffuse (r = 0.91). The generator is `nebula3d.demo.demo_volume`,
  built in slabs so its temporaries stay small in the WASM heap. It can return
  any single component without noise, and `webbridge.make_demo_input` writes
  it as `synthetic_rocksalt`. `tests/test_demo.py` pins the physics and the
  end-to-end result. The absolute consistency-r floor in
  `tests/test_float32_equivalence.py` drops from 0.999 to 0.98, because the
  demo's counting noise caps r at ~0.992. The float32/float64 gates are
  unchanged. See `docs/web.md` ("Demo volume").
- **Layouts for iPhone, iPad, MacBook and 4K screens.** Below 1100 px (iPad
  Pro portrait and all iPhones) the sidebar becomes a compact top bar with a
  scrolling row of view pills. On phones this bar is a single row in landscape.
  Viewer panels no longer squeeze into one row there: they wrap into a grid, or
  stack one per row on a phone. Stat strips, headers, clusters and the Bragg
  peak table reflow instead of overflowing. On 4K at 150 %, Configure shows the
  workflow controls and the live preview side by side. On a 4K panel at 100 %,
  the console is scaled up. Touch screens get finger-sized controls, the shell
  uses the dynamic viewport height and safe-area insets, and phones get 16 px
  form text (no zoom on focus). Configure fields no longer spill out of their
  boxes on iPad widths. Long file names, run IDs and slider readouts wrap
  instead of being cut off. The AI Assistant page grows when its settings
  drawer is open, instead of running under the page footer. Checked at every
  target size (with iPhone safe areas emulated) for overlapping components
  and cut-off text. `web/src/index.css` ("Device layouts"),
  `web/src/App.tsx`, `web/index.html`; see `docs/web.md`.
- **NeXus Viewer import shows its progress.** While NEBULA3D waits for the
  volume, the viewer sends `nebula3d-import-progress` (stage label + overall
  fraction), and the import banner shows it as text and a progress bar instead
  of only "Waiting for the NeXus Viewer…". Once the file arrives, the banner
  shows the in-browser engine's start-up step and bar while it boots, instead of
  a bare "Loading…". The message is optional: older versions of either app
  ignore it or never send it. The Configure page's boot panel and the banner now
  share `bootPercent` (`api/pyodideEngine.ts`) and `useBootStatus`
  (`api/hooks.ts`). `web/src/api/importHandoff.ts` (`onProgress`, + test),
  `web/src/components/ViewerImportBanner.tsx`; see `docs/web.md`.
- **NeXus Viewer import: the two tabs no longer share a browser process.** The
  viewer opened this app with a window reference. Same-site tabs linked that way
  share one renderer process and main thread, so reloading, closing or crashing
  the viewer could also end a pipeline run here. A viewer on this app's origin
  now opens the tab with `noopener` and exchanges the same messages over the
  `BroadcastChannel` `nebula3d-import:<id>`. This app listens on the channel and
  on `window.opener`, so an older viewer and cross-origin dev servers still
  work. `web/src/api/importHandoff.ts` (+ tests); needs the matching
  neutron-nexus-viewer change; see `docs/web.md`.
- **Bragg backfill now fills from the diffuse around each hole.** The pipeline,
  `run_pipeline.py` and web default changes from `q_shell` to `local`.
  `q_shell` filled every hole with the median of its whole |Q| shell. That is
  biased at the lattice nodes, where correlations at lattice-vector separations
  peak or dip, and the node-periodic bias Fourier-transforms into spurious ΔPDF
  features at the lattice vectors. The standard punch-and-fill practice
  (NXRefine, Mantid `DeltaPDF3D`, KAREN) interpolates the surrounding diffuse.
  **Re-run backfill → ΔPDF on existing datasets: results change.**
  - **New `method="laplace"`:** a harmonic (Laplace) fill of all holes in one
    sparse system (Jacobi-preconditioned CG, no per-hole loop), continuing the
    local diffuse smoothly with no edge step. Its boundary sits `laplace_gap`
    (default 1) voxels outside the punch, so Bragg tails leaking past the punch
    do not pull the fill up; measured voxels in that band are kept. Exposed in
    `BackfillParams.laplace_gap`, the web method menu and `LAPLACE_GAP` in
    `examples/backfill_bragg_3d.py`.
  - **Synthetic check** (short-range order + node-peaked diffuse + Bragg):
    worst lattice-vector ΔPDF artefact ~2.3 % of the signal for `q_shell`,
    ~1 % for `local`, ~0.8 % for `laplace`. Backfill transient memory on a
    25 M-voxel volume: `q_shell` 41, `local` 25, `laplace` 35 B/voxel.
  - `q_shell` stays available for comparison. The web help text no longer
    claims it "interpolates".

- **3D-ΔPDF on non-orthogonal cells: true distances and real section angles.**
  The ΔPDF grid is unchanged (native FFT grid, `x_H/y_K/z_L` in Å along a, b,
  c), but the cell angles now travel with it. They are stored as
  `DeltaPDF.cell_angles` and as `lat_alpha/beta/gamma` in the `.h5` attrs (via a
  shared `pipeline.write_cell_attrs`). They are exposed as `alpha/beta/gamma` in
  the volume, ΔPDF and consistency lattice metadata, and sent with every ΔPDF
  slice (`axes_angle`, `r_center`, `r_perp`).
  - **True distances:** new `real_space_radius` and `section_geometry` in
    `nebula3d.analysis.delta_pdf`. The consistency r band and `r_data_max`
    now use the true metric; this is bit-identical for 90° cells.
  - **Web viewers** (3D-ΔPDF, multi-temperature, Q–R band) draw each section at
    γ/β/α. Unit-cell lines follow the lattice, and r-band circles are placed by
    true distance. The assistant's ΔPDF metrics and context use Cartesian
    positions and include the angles.
  - **matplotlib viewers** (`explore_delta_pdf_ortho.py`,
    `explore_delta_pdf.py`, `explore_delta_pdf_multi.py`) apply the same skew.
    This also fixes the ortho and multi viewers, which had crashed since the
    June rename on leftover `TEMP` / `central[t]` names.
  - **Older files** without angle attrs are drawn at 90° as before.
  - **`ub_from_lattice` fixed.** It returned a singular matrix for every cell;
    it now builds the Busing–Levy B matrix, and new `direct_cell(ub)` inverts it.
  - **Tests:** `tests/test_nonorthogonal_cells.py`, `tests/test_server.py` and
    `web/src/components/__tests__/oblique.test.ts` pin this on orthorhombic,
    hexagonal, monoclinic and triclinic cells.

- **Import from the NeXus Viewer.** The viewer's *Open in NEBULA3D* button
  opens this app with `?import=nexus-viewer&id=…&from=…` and posts its
  symmetrized, masked volume (nebula3d HDF5, padded symmetric about Q = 0)
  once the page reports ready; the in-browser build loads it like *Load
  volume…*, selects it as the dataset and reports back. Messages are exchanged
  only with `window.opener` at an allowed origin (own, drthyang.github.io,
  localhost in dev). `web/src/api/importHandoff.ts` (+ vitest suite),
  `web/src/components/ViewerImportBanner.tsx`; see `docs/web.md`.
- **Mantid loader: projection guard for non-orthogonal cells.** Each dim's
  `long_name` is now read as an (h, k, l) direction (`[-K,2K,0]` → (−1, 2, 0))
  and cross-checked against the `W_MATRIX` log. Only plain H, K, L axes (in any
  order) load; a projected grid such as the orthogonal hexagonal cut
  `[H,0,0]/[-K,2K,0]/[0,0,L]` is rejected with a rebinning hint instead of
  loading with silently wrong |Q| (the old parser took the first H/K/L letter
  in the label). Loads of the existing TbTi3Bi4 files are bit-identical.
  `tests/test_nonorthogonal_cells.py` pins the guard plus metric-correct ring
  removal and ΔPDF peak placement on hexagonal (γ = 120°) and monoclinic
  (β = 110°) cells.
- **Build & CI hardening.** The packaged wheel no longer nests a stale copy of
  the Pyodide wheel inside itself (`vite build` copied `web/public/wheels`
  into `server/static/`, and `package-data` shipped it: 1.35 MB of
  Russian-doll wheels vs ~230 KB clean); `exclude-package-data` now drops
  `static/data` + `static/wheels` from every wheel, the native build no
  longer copies `web/public`, and one shared `scripts/build_web_wheel.py`
  (Makefile + Pages workflow) inspects the wheel and publishes it
  content-addressed under `wheels/<sha256>/` so a redeploy can never serve a
  Pages-cached stale wheel. The browser boot drops matplotlib (~9 MB of
  wheels it loaded only to render a `pdf_check` PNG nothing reads). Pages now
  deploys only after the CI workflow passes on `main`; CI type-checks once
  against pinned numpy/mypy stubs (per-Python stub drift had kept `main` red
  since July), runs the suite under the exact numpy/scipy/h5py/matplotlib
  Pyodide 0.27.7 ships, builds both frontend modes, and reports every matrix
  leg. Also: the package version is read from `_version.py` only, coverage
  moved from pytest `addopts` to the CI command (~40 % faster local runs),
  `httpx2` replaces `httpx` for the Starlette test client, matplotlib
  `set_bad` → `with_extremes`, and a CSS comment containing `*/` that had
  silently disabled the `.bragg-page` flex rule is fixed.
- **Browser engine: parallel ring removal, float32 compute, WebGPU ΔPDF.** The
  static (Pages/Pyodide) build now fans the ring stage out over a pool of slim
  Pyodide ring workers (bit-identical to serial by construction — the pure
  per-plane core in `nebula3d._ringplane` is shared by every backend; pinned by
  `tests/test_ring_parallel.py`), computes with float32 volume storage
  (`PipelineParams.precision`; axes/UB, |Q|-bin decisions, 1-D fits, and large
  reductions stay float64 — validated on all three real TbTi3Bi4 volumes at
  ΔPDF nrms ≤ 1e-5 with ≤ 2 punch-mask flips of 48.4 M voxels, ~15–25 %
  faster), and runs the ΔPDF forward/inverse FFT cores on WebGPU when available
  (`web/src/gpu/` mixed-radix Stockham with numpy-pinned index math; scipy
  fallback at every rung; `fft=webgpu-f32-p5` cache token). The admission gate
  rises from ~50 M to **~80 M voxels** (401³ volumes now run in-browser).
  Plus: streaming consistency metrics and per-plane deapodization (bit-exact,
  ~30 B/voxel off the old peak stage), wheel-manifest boot (no hardcoded
  version), lazy `nebula3d.visualization` import, MEMFS upload-leak fix, and
  workers moved to ES modules (`pyodide.mjs`). Native float64 runs are
  hash-verified bit-identical to the previous release.
  See `docs/reports/2026-08-07_browser_parallel_f32_webgpu.md`.
- **Ring Removal 2.0 — sample-only global 3D powder-shell inference.** Added the
  opt-in `ring_model="global_v2"` path for datasets where an empty-environment
  scan omits the Al holder or over-subtracts. It detects narrow shells in the
  unsubtracted 3D sample volume, weakly identifies the FCC Al family and fitted
  lattice parameter, fits a Bragg-robust real-spherical-harmonic angular field,
  propagates model uncertainty, and defaults to lower-confidence-bound
  subtraction. `auto`, `aluminum`, and material-agnostic modes plus
  conservative/mean/diagnose-only policies are exposed in Python, API, Pyodide,
  and Configure UI. Pipeline runs write a JSON diagnostic sidecar. Legacy
  patched/parametric models remain available and the default pending full
  real-data qualification.

## 0.3.0 (beta) — 2026-07-05

First beta. Adds an in-browser AI Assistant, a sidebar UI refresh, and the
low-memory + performance work below.

- **AI Assistant — grade the reduction from computed metrics.** A new browser
  view (`web/src/llm/`) connects to a local (Ollama / LM Studio) or cloud
  (OpenAI / Gemini) model and assesses the reduction, grounded in numeric
  metrics computed **in the browser** from the stage volumes — ring-removal
  residual energy, a leftover-Bragg-peak scan plus fitted peak-profile summary,
  backfill seam / checkerboard diagnostics, and ΔPDF feature SNR / anisotropy /
  radial trend. Four one-click stage reviews plus free chat; a ChatGPT-style
  transcript with markdown + LaTeX-Greek rendering, a rotating "sun" avatar, and
  collapsible model reasoning; an optional vision toggle that attaches the
  rendered slice for image-capable models. Everything is client-side — nothing
  leaves the machine except the chat call to the user's configured model server.
  The metrics layer is unit-tested (Vitest). Fixed a stack-overflow in the ΔPDF
  metrics on full-resolution slices along the way.
- **Sidebar UI refresh.** A single global dataset switcher lives in the sidebar
  (per-page dataset pickers removed; Configure shows it read-only); the chat
  session persists across page navigation; the brand is set full-caps; and the
  Multi-volume view is hidden for now. The browser build keeps full feature
  parity with the native backend.
- **In-browser low-memory mode — smaller peak, bit-identical results.** A new
  `NEBULA3D_LOW_MEMORY` mode (`nebula3d.core.low_memory`, always on in the
  Pyodide bridge) trades a little recompute for a smaller peak so full-resolution
  reductions fit the 4 GB WASM heap (Pyodide is 32-bit; there is no wasm64
  build). The ring stage drops its full-3-D |Q|/φ coordinate caches (per-plane
  2-D recompute), the flatten stage subtracts in place, and the unused per-voxel
  `sigma` is freed before the ΔPDF / back-FFT stages. **Verified byte-for-byte
  identical to the exact path on real data** — a 401×501×151 (30.3 M-voxel)
  neutron dataset gives identical backfilled / flattened / ΔPDF volumes and
  identical consistency metrics either way; the whole reduction peaks at ~2.3 GB
  (binding stage: the back-FFT consistency check, ~75 B/voxel). Separately, the
  ring-workflow `backfill_ring_shells` (not the default `q_shell` Bragg backfill)
  now bounds its all-valid-voxel KD-tree to a per-H-slab local tree in
  low-memory mode — within ~1e-5 relative of the exact fill, tested in
  `tests/test_backfill_blocked.py`. 222 tests, ruff, and mypy clean.
- **Pipeline ~22–31 % faster with bit-identical outputs.** Browser audit +
  performance pass (see
  [docs/reports/2026-07-02_browser_audit_perf.md](docs/reports/2026-07-02_browser_audit_perf.md)):
  HDF5 stage outputs now use gzip-1 + byte-shuffle (lossless, ~8 % smaller,
  ~2.6× faster writes), consecutive pipeline stages hand volumes over in
  memory instead of re-reading compressed HDF5 (artifacts and resume
  behaviour unchanged), and the ring-removal texture fit solves its per-|Q|
  ridge systems in one stacked LAPACK call. Every stage artifact verified
  SHA-256-identical before/after at two volume sizes, serial and parallel;
  219 tests, ruff, and mypy clean; in-browser end-to-end run verified
  (6/6 stages, consistency r = 0.99963, no console errors).
- **Milestone: fully static, GitHub Pages-hosted app with feature parity.** The
  browser console now runs the **complete** `nebula3d` reduction — every pipeline
  stage, cleanup, 3D-ΔPDF, multi-volume, and consistency view — entirely
  client-side via Pyodide, at **full-resolution float64** (up to ~50 M voxels;
  a 301×401×401 volume fits). No server, no upload, no install: the app is a
  static bundle served from **https://drthyang.github.io/nebula3d/**, deployed by
  `.github/workflows/pages.yml` on push to `main`. The in-browser build is now a
  first-class path alongside the native `nebula3d-web` backend, not a reduced
  demo. Under Pyodide (no OS threads) ring removal falls back to serial slice
  processing; native CPython still parallelises.
- **Spherical-frame Bragg punch.** The default punch ellipsoid axes now follow
  the local spherical frame at each peak — `(rρ, rθ, rφ)` in Å⁻¹ with rρ radial
  (along Q̂), rφ azimuthal (a*–b* ring tangent, c* pole), rθ polar — so every
  reflection is oriented correctly with no tilt angle. Added
  `punch_frame="spherical"` (now the `PunchParams` / web default) alongside the
  existing `"q"` (a*/b*/c*) and `"hkl"` frames; the legacy frames are unchanged.
  Configure and Bragg-profile pages gain a frame selector and rρ/rθ/rφ controls,
  and the punch preview renders the per-peak oriented ellipse.

## 0.2.0 - 2026-06-18

- Promoted the consistency check to the endpoint of the recommended 3D-ΔPDF
  workflow.
- Added the FastAPI/React consistency viewer and `/api/consistency` endpoints
  for reciprocal-space back-FFT comparison with optional `|Q|` and real-space
  bands.
- Updated `examples/run_pipeline.py` to run the back-FFT consistency check by
  default after the ΔPDF stage.
- Updated documentation around the full workflow, web UI, reproducibility
  commands, and output artifacts.
- Aligned package, API, and web app version metadata at `0.2.0`.

## 0.1.0 - Initial alpha

- Initial alpha toolkit for reciprocal-space diffuse-scattering cleanup and
  3D-ΔPDF exploration.
