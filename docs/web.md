# Web UI

`nebula3d` ships **one** browser console — a React + TypeScript SPA (Vite)
that unifies the cleanup, 3D-ΔPDF, and consistency views, adds an AI Assistant,
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
  `.github/workflows/pages.yml` on push to `main`).
- The pipeline ships as a data-free `nebula3d` wheel that the page micropip-installs
  at runtime (the wheel filename is resolved from `wheels/manifest.json`, built
  by CI / `make web-wheel`). Pyodide runs in a dedicated Web Worker
  (`web/src/workers/pyodideWorker.ts`) so the UI never blocks; a boot-progress
  panel covers the ~15 MB WASM download (cached after first load).
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
- **float32 compute mode.** The browser always computes with float32 volume
  storage (`PipelineParams.precision="float32"`; native default stays float64):
  volume arrays and the FFT (float32→complex64) halve, while axes/UB, every
  |Q|-derived bin/band/threshold decision, all 1-D profile fits/solves, and
  every large reduction stay float64.  Validated against the float64 reference
  on all three real TbTi3Bi4 volumes (22/45/100 K, 48.4 M voxels each): ΔPDF
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

  Measured on the real 48.4 M-voxel volume (float32, low-memory), the binding
  stage is the backfill at ~42 B/voxel; the admission gate
  (`nebula3d.webbridge.inspect_input`, metadata-only so it can't OOM) budgets
  40 B/voxel net of interpreter overhead against 3.2 GB → volumes up to
  **~80 M voxels** are admitted (e.g. 401×401×401 = 64.5 M voxels ≈ 2.6 GB
  estimated peak; 501³ = 125.8 M is still refused with a message pointing to
  the native build).

  (The default Bragg backfill, `backfill_bragg` with `method="q_shell"`, is
  connected-component / `ndimage`-based and already lean. The older ring-workflow
  `backfill_ring_shells` — not on this pipeline — builds a KD-tree over every
  valid voxel; its low-memory path bounds that to a per-H-slab local tree,
  within ~1e-5 relative of the exact fill.)

Local dev for this build: `cd web && npm run dev:pyodide` (loads `.env.pages`,
base `/`).

## What it does

A single-page console with a left sidebar. The dataset is switched once from a
picker at the top of the sidebar; every view reads it from there (no per-view
dataset pickers). Most views replace a standalone `examples/explore_*.py` viewer:

| View | Replaces | What |
| --- | --- | --- |
| **Configure / Run pipeline** | `run_pipeline.py` | Pick a dataset and tune the key parameters per stage — ring removal (azimuthal **patches**, texture **Fourier order**), punch (HKL ↔ Q-space frame), backfill, flatten, ΔPDF, consistency — then run all stages with a live stepper and log. Existing outputs are skipped unless *force* is on. Default landing view. |
| **Reciprocal cleanup** | `explore_slice.py` | One panel per HKLVolume stage (raw / ring-removed / punched / backfilled / flattened) sharing an H/K/L plane selector, cut, contrast, log, and colormap. All panels share **one fixed global colour scale** (pooled from the centre cut). The cut readout is an **editable box** — type `0.3333` and it snaps to the nearest plane. |
| **3D-ΔPDF** | `explore_delta_pdf_ortho.py` | Three linked real-space orthoslices (x_H–y_K, x_H–z_L, y_K–z_L) as square **windows** (adjustable, default 80 Å), each with its own cut slider, plus contrast and a gray dashed unit-cell overlay. |
| **Multi-volume** _(hidden in 0.3.0)_ | `explore_delta_pdf_multi.py` | Related ΔPDF files × the three planes as a square grid, sharing cut, window, and contrast; a per-plane colour scale pooled across files. Component retained; unrouted from the sidebar for now. |
| **Consistency check** | `delta_pdf_consistency.py` | Back-FFT check: inverse-transforms the ΔPDF to reciprocal space and shows **data \| back-FFT \| residual** at a shared plane/cut, with agreement metrics (Pearson r, normalised RMS, per-plane r). Adjustable **\|Q\|** and real-space **r** bands isolate which ranges support a signal. |
| **AI Assistant** | — (new) | Connect a local (Ollama / LM Studio) or cloud (OpenAI / Gemini) model and ask it to assess the reduction. Four one-click reviews (ring removal, Bragg punch, backfill, ΔPDF features) plus free chat, all grounded in numeric metrics computed in the browser from the stage volumes. Optional vision opt-in attaches the rendered slice for image-capable models. |

## AI Assistant

The assistant lives entirely in the browser (`web/src/llm/`) and follows a
*metrics-compute-the-truth, the-LLM-narrates* design: deterministic pure
functions derive real diagnostic numbers from the same slice envelopes the
viewers already fetch, and those numbers (never the raw volume) are sent to the
model as a compact JSON context. Nothing leaves the machine except the chat call
to the model server the user configured — local providers keep everything
on-device; cloud providers are gated behind a data-leaves-your-device warning.

- **`metrics/`** — one pure module per judgment, each unit-tested
  (`vitest`, `npm --prefix web run test`):
  - `rings.ts` — residual powder-ring energy (localized bumps in the azimuthal
    radial profile) before vs after, over-subtraction fraction, and a suggested
    robust display ceiling for inspecting leftover rings at optimal contrast.
  - `punch.ts` — scans the *punched* slice for sharp maxima left unpunched
    (bright finite spikes away from the NaN holes) and summarises the fitted
    `BraggProfile` (resolution-limited fraction, measured widths, anisotropy).
  - `backfill.ts` — hole-rim seam magnitude (σ units), bright residual plugs, and
    a checkerboard-fraction that flags periodic interpolation artefacts.
  - `dpdf.ts` — feature SNR vs background, strong-feature anisotropy (covariance
    ratio + orientation), radial trend, and back-FFT consistency pass-through.
- **`context/pipelineContext.ts`** — folds the per-stage metrics into the budgeted
  JSON context; **`prompts/`** — the nebula3d domain system prompt + per-stage
  message builders; **`provider/`** — a dependency-free streaming
  OpenAI-compatible client; **`settings.ts`** — a localStorage store (provider,
  model, key, temperature, vision opt-in).
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
  browser — so contrast/log/colormap change instantly with no refetch.
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
| GET | `/api/datasets` | discovered datasets with per-stage output status |
| GET | `/api/volumes/{id}/meta` | HKLVolume shape, axis ranges, lattice |
| GET | `/api/volumes/{id}/slice?plane=&value=&interp=` | binary 2D slice |
| GET | `/api/deltapdf/{id}/meta` | ΔPDF shape, ranges, lattice, \|Q\|max |
| GET | `/api/deltapdf/{id}/slice?plane=xy\|xz\|yz&value=` | binary ΔPDF orthoslice |
| GET | `/api/consistency/{dataset_id}/meta?q_min=&q_max=&r_min=&r_max=` | back-FFT metadata and metrics |
| GET | `/api/consistency/{dataset_id}/slice?panel=data\|recon\|residual\|dpdf&...` | binary consistency slice |
| POST | `/api/pipeline/run` | start a job; returns `{id, status, ...}` |
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
the packaged `static/`. Always clean first:

```bash
rm -rf build src/*.egg-info src/nebula3d/server/static/data
python -m pip wheel . --no-deps --no-cache-dir -w web/public/wheels
unzip -l web/public/wheels/*.whl | grep -iqE '\.(bin|nxs|h5)' && echo "DATA LEAK — stop" || echo "clean"
```

A clean wheel is ~252 KB. The CI workflow performs this same data-leak check.

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
- **Pyodide gotchas.** `import nebula3d` pulls in matplotlib; Pyodide ships
  matplotlib 3.5.2 (< the wheel's `>=3.7` pin), so install with `deps=False` to
  skip the version check. Pipeline entry points: `nebula3d.load`,
  `nebula3d.core.HKLVolume.from_arrays`, `nebula3d.pipeline.run_pipeline`,
  `nebula3d.analysis.compute_delta_pdf`.
- **Privacy.** The public app ships **no data**; users supply their own at
  runtime. `web/public/data/` and `web/public/wheels/` are gitignored, and the CI
  wheel build is data-free.
