# Browser engine: parallel rings + float32 + WebGPU ΔPDF — 2026-08-07

Scope: remove the two limits of the static (GitHub Pages / Pyodide) build —
serial ring removal, and the ~50 M-voxel float64 memory ceiling — via four
phases, each landed green and independently verified:

| Phase | What | Guarantee |
| --- | --- | --- |
| A | Zero-risk memory fixes at the peak stage | bit-exact (SHA-256 stage hashes) |
| B | Browser-parallel ring removal (Pyodide worker pool) | bit-identical to serial |
| C | float32 compute mode (browser default) | tolerance-gated vs float64 |
| D | WebGPU ΔPDF forward + inverse FFT cores | tolerance-gated vs scipy |

## Phase A — streaming/chunked memory fixes (bit-exact)

- `pipeline._consistency_metrics`: whole-volume `np.corrcoef`/compressed-copy
  temporaries (~35–45 B/voxel stacked on the binding stage) → two-pass
  per-H-plane streaming accumulators (float64 `np.dot` sums; per-plane r still
  `np.corrcoef`, so `per_plane_r` is unchanged).  Scalar metrics move ≤ ~1e-15
  relative (summation order); every stage volume is unchanged.
- `invert_delta_pdf`: dropped a pure-waste full-volume `astype` copy; the 3-D
  deapodization window is no longer materialised (per-plane divide,
  bit-identical by association-order preservation).
- `consistency_reconstruction` no longer materialises the residual volume; the
  viewer's residual panel is derived per 2-D slice (`data − recon`).
- New tools: `scripts/hash_stage_outputs.py` (the bit-exactness gate used at
  every phase boundary) and `scripts/measure_stage_peaks.py` (per-stage peak
  RSS; drives the admission-gate constants).

Verification: full suite green; SHA-256 of every stage HDF5 identical to the
pre-change baseline in both the browser-like (low-memory) and native modes;
consistency-JSON scalars moved ≤ 8e-16 relative.

## Phase B — parallel ring removal in the browser (bit-identical)

The ring stage (~70 % of a serial browser run) is embarrassingly parallel: the
pure per-plane unit (`_process_ring_plane`) moved verbatim to
`nebula3d._ringplane`, shared by the serial loop, the native process pool, and
the new browser path:

- Main thread spawns N slim Pyodide **ring workers** (numpy/scipy + wheel; no
  matplotlib — `nebula3d.visualization` now imports lazily) and wires each to
  the pipeline worker with a `MessageChannel` (`web/src/api/ringPool.ts`,
  `web/src/workers/{ringWorker,ringPoolClient}.ts`).  No SharedArrayBuffer, no
  COOP/COEP, no nested workers — plain transferable buffers.
- Python drives the fan-out from an async seam: `webbridge.run_async` →
  `pipeline.remove_rings_async(plane_executor=…)`; the remaining stages run
  through the unchanged sync `run_pipeline` with a new `carry_in=` in-memory
  hand-over.  `ring_stage_pending` is the shared resume gate.
- Robustness (from an adversarial multi-agent review, 11 findings fixed):
  stage-epoch-tagged plane messages (a reused pool can never apply a stale
  result from an aborted run), retained context for late-booting workers,
  `context_error` port retirement, per-plane exception containment, the wheel
  URL resolved once (no version skew), leak-proof PyProxy extraction, MEMFS
  upload-temp cleanup on all error paths, pool teardown on worker crash.
- Failed/undelivered planes are recomputed in-process; whole-pool failure
  falls back to the serial loop — output identical either way.

Verification: `tests/test_ring_parallel.py` pins serial == parallel bit-identity
through the real `ringworker` byte protocol (patched+parametric ×
low-memory on/off × H and K stack axes, shuffled delivery, dropped planes,
fallbacks) and closes the historical native-pool gap (`max_workers=2` ==
serial).  Live browser matrix: serial / 1-way (late-boot) / 4-way runs give
identical consistency metrics; pool reuse across forced re-runs exercises the
epoch guard.  Amdahl at rings ≈ 70 %: ~2.1× at 4 workers.

## Phase C — float32 compute mode (browser always-float32)

`PipelineParams.precision` ("float64" default — bit-identical to the historical
pipeline, re-verified by stage hashes; "float32" = browser policy, overridable
per run via a `"precision"` key in the params JSON).

Mixed-precision rules (each a no-op at float64):

| Category | Rule |
| --- | --- |
| Volume arrays (data/sigma/outputs), FFT | storage dtype (f32 → complex64) |
| Axes, UB, 3×3 geometry | always float64 |
| \|Q\| arithmetic and every bin/band/threshold decision | always float64 (`core.q_bin_indices`: per-slab f64 digitize → int32) |
| 1-D profiles, shell stats, solves, IRLS, curve_fit | always float64 (compressed inputs upcast; e.g. per-segment `astype(np.float64, copy=False)`) |
| Large reductions (mean/sum/std/moments) | explicit float64 accumulators (e.g. the ΔPDF mean subtract) |
| Per-plane ring model internals | float64 (plane upcast in `_process_ring_plane`, result rounded once on store — keeps native-f32 and worker paths exactly equal) |
| `tv_inpaint` | solves in float64, returns storage dtype |
| Cancellation-critical flatten subtract | computed at the promoted (f64) dtype, correctly rounded into f32 storage (numpy type promotion) |

Real-data validation (TbTi3Bi4, 401×401×301 = 48.4 M voxels, low-memory,
float32 vs float64):

| Volume | ΔPDF nrms | max rel diff | \|Δ pearson_r\| | punch flips | n_peaks | wall f64 → f32 |
| --- | --- | --- | --- | --- | --- | --- |
| 22 K | 1.0e-05 | 6.7e-08 | 3.8e-10 | 1 / 48.4 M | 14087 = 14087 | 229 s → 170 s (−26 %) |
| 45 K | 5.9e-06 | — | 6.0e-10 | 2 / 48.4 M | equal | 223 s → 174 s (−22 %) |
| 100 K | 1.7e-07 | — | 7.7e-12 | 0 | equal | 238 s → 207 s (−13 %) |

Measured per-stage peaks (22 K, low-memory, B/voxel, incl. ~5 B/voxel
interpreter baseline):

| stage | f64 | f32 |
| --- | --- | --- |
| load | 22.2 | 18.3 |
| rings | 31.9 | 31.9 |
| punch | 44.9 | 35.9 |
| **backfill (binding)** | **52.3** | **42.4** |
| flatten | 47.6 | 39.2 |
| pdf | 42.1 | 20.9 |
| pdf_check | 41.8 | 20.9 |

(The old binding stage, pdf_check at ~75 B/voxel, fell to ~42/21 after Phase A
+ float32.)  Admission gate: 40 B/voxel (net of overhead) against 3.2 GB →
**~80 M-voxel ceiling**; a 401³ (64.5 M) volume that was refused before is now
admitted and verified end-to-end.  Gates: `tests/test_float32_equivalence.py`
(15 tests: exact bin-decision equality, f64-accumulator mean, punch-flip
bounds citing the ROADMAP punch-frames precedent, full-pipeline deltas, ring
serial==parallel bit-identity at f32, webbridge policy/gate).

## Phase D — WebGPU ΔPDF core (forward + inverse)

`analysis/delta_pdf.py` refactored into prepare / FFT-core / finish (pure,
bit-identical for the scipy path — windowing, f64 mean subtract, and
deapodization stay single-source Python; `fast_len` injectable).  The GPU
backend (`web/src/gpu/`) replaces only the
`fftshift(fftn(ifftshift(pad(·))))` cores:

- Mixed radix-2/3/4/5 **Stockham** line kernel in workgroup shared memory
  (axes ≤ 1024), twiddles precomputed on the CPU in f64 → f32 (no driver
  sin/cos variance), hardcoded rational-angle DFT roots with the direction as
  a ±1 uniform; pad/ifftshift placement and fftshift/crop/1/P extraction
  kernels.  Every piece of index math has a pure-TS mirror in `fftPlan.ts`
  pinned to numpy fixtures in CI (`scripts/gen_fft_fixtures.py`): 32 line
  lengths forward+inverse at 8 decimals, 3-D separability, shift maps for
  even/odd lengths.
- Limits negotiated at `requestDevice` (defaults are far too small for the 8 P
  complex buffer); per-run capacity check; ≤64 MB upload/readback tiles; wasm
  views never held across an await.
- Python side: `webbridge._run_pdf_stages_gpu` mirrors `run_pipeline`'s
  pdf/pdf_check blocks (stale guard, artifact writes, emits, low-memory sigma
  drop); the GPU pads to strict 5-smooth lengths — an implementation detail
  recorded per-result in `pad_width`, so inversion is self-consistent — and
  stamps `transform_config` with `fft=webgpu-f32-p5` so CPU/GPU caches never
  masquerade as each other.  Fallback ladder at every rung (no adapter, limits,
  device-lost, any exception) → the same stages rerun on the scipy path.
- The complex intermediates (the pipeline's largest contiguous allocations)
  never touch the wasm heap: the pdf/pdf_check wasm peak drops from ~21 B/voxel
  (f32 scipy) to roughly the volume residency alone; backfill remains the
  binding stage, so the admission ceiling is unchanged (~80 M) but OOM
  headroom and heap fragmentation improve.

Verification: live browser run shows `[WebGPU]` on both stages with
consistency metrics **identical to the CPU result at display precision**
(r = 0.99986, nRMS = 1.626e-02) through a different FFT implementation *and*
different padding (33³ → 36³); `test_gpu_padding_choice_is_result_neutral`
pins padding neutrality on the CPU side (deltas < 1e-5); the GPU-computed ΔPDF
renders correctly in every viewer.

## Not done in this round

- A dedicated GPU-vs-CPU harness page / `?gpu=validate` in-app mode (the live
  demo-run comparison above covers the same evidence for now).
- Safari / Firefox manual E2E pass of the worker pool + GPU fallback.
- A Phase-A-style memory pass over the now-binding backfill stage (would raise
  the ~80 M ceiling further).

## Gate summary

pytest 268 passed · vitest 52 passed · ruff/mypy/tsc/eslint clean ·
f64 stage hashes identical to the pre-change baseline (both modes) ·
`npm run build:pages` + native build green.
