# Changelog

## Unreleased

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
  boxes on iPad widths. `web/src/index.css` ("Device layouts"),
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
