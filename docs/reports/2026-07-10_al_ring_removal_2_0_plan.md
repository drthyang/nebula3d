# Aluminum ring removal 2.0 — major improvement plan

Date: 2026-07-10

## 1. Executive decision

Replace the current choice between independent per-slice estimators with one
uncertainty-aware, global 3D spherical-shell model. Keep the existing patched and
parametric implementations as frozen baselines and fallbacks until the new path
passes synthetic-injection, paired-scan, real-data, downstream-DeltaPDF, runtime,
and browser-parity gates.

The new production path should support three evidence levels without assuming
that an empty-environment scan contains the sample holder:

1. **Al-informed sample-only fit** — use the FCC Al line family as a weak physical
   prior, while fitting lattice parameter, line shape, and a smooth 3D angular
   intensity field from the data.
2. **Material-agnostic sample-only fit** — discover persistent spherical shells
   without claiming that they are Al.
3. **Optional environment reference** — use a demonstrably matched empty scan as
   evidence or a jointly fitted nuisance template. Never require or blindly
   subtract a scan that omits the holder or produces systematic over-subtraction.

The central safety rule remains: subtract only signal strongly supported as a
powder-shell contribution. Ambiguous signal is retained and flagged.

## 2. Current baseline and why a redesign is justified

The present subsystem is sophisticated and its focused regression suite is green:
48 relevant ring/pipeline tests passed on 2026-07-10. It already includes robust
radial profiles, SNIP baselines, adaptive widths, per-ring pseudo-Voigt fits,
azimuthal Fourier texture, cross-stack shell confirmation, amplitude ceilings,
sampling masks, and process-level parallelism.

Its remaining limitations are architectural rather than a missing tuning knob:

- `remove_rings` fits every H/K/L plane independently. Cross-stack confirmation
  supplies shell positions and ceilings, but there is no jointly fitted 3D angular
  field or smoothness constraint across planes.
- A 2D Fourier texture on each plane is not a coordinate-independent description
  of intensity over a spherical shell. Results can depend on the selected
  `slice_axis`.
- The fitted model is discarded by the pipeline. The saved output contains no
  ring estimate, model uncertainty, per-shell quality, failure map, or provenance.
- Input `sigma` is not used as the primary fit likelihood and model uncertainty is
  not propagated into the cleaned volume.
- Fit failures leave a plane unchanged and are only reported through progress
  text; they are not persisted as machine-readable quality state.
- The documented dominant failure is texture-contrast compression: bright arcs
  are under-subtracted and dim arcs are over-subtracted. The azimuthal mean can
  look excellent while both errors cancel.
- The browser's `ring_energy_ratio` is based on an azimuthally averaged radial
  profile and is therefore vulnerable to the same cancellation. A global negative
  fraction is not specific enough to diagnose ring-local over-subtraction.
- Defaults disagree: Python/server `RingParams.ring_model` is `patched`, while the
  web store starts with `parametric/rolling`.
- Tests use clean analytic backgrounds, a small number of Gaussian rings, and
  controlled Fourier textures. They do not span realistic Al line families,
  incomplete coverage, shell-dependent resolution, angular center/width drift,
  multi-temperature data, empty cans, or difficult overlap with real diffuse
  features.
- An Al peak-position helper exists, but the production estimator neither tests an
  Al hypothesis nor uses the FCC reflection family as a hierarchical constraint.

## 3. Scientific target model

For each valid reciprocal-space voxel `v`, model

```text
I_v = D_v + R_v + O_v + epsilon_v

R_v = sum_j A_j(u_v, s_v) P_j(
          |Q_v| - q_j(a) - delta_q_j(u_v, s_v),
          w_j(u_v, s_v), eta_j)
```

where:

- `D_v` is the unknown single-crystal diffuse/background signal that must be
  preserved;
- `R_v >= 0` is the powder-shell contribution;
- `O_v` is a sparse/outlier component for Bragg peaks, bad voxels, and detector
  artifacts, used during fitting but never subtracted as a ring;
- `u_v = Q_v / |Q_v|` is the full 3D direction on the sphere;
- `s_v` is optional scan/temperature/sample-environment metadata;
- `P_j` is a normalized pseudo-Voigt or empirically learned line profile;
- `A_j` is a non-negative angular amplitude field;
- `delta_q_j` and `w_j` are low-order, regularized angular fields for small
  calibration/strain/coverage effects.

For an Al hypothesis, generate `q_j(a)` from allowed FCC reflections and fit one
shared lattice parameter `a`, rather than fitting unrelated centers. Use the
monatomic FCC multiplicities/structure factors and Debye-Waller trend only as weak
amplitude priors: sample geometry and absorption can dominate observed intensity.

Represent angular fields with real spherical harmonics or a sparse spherical
B-spline basis. Enforce positivity with a softplus/log link. Select angular
complexity by held-out prediction, not a fixed Fourier order. Regularize adjacent
shells hierarchically so strong rings inform weak rings without forcing identical
texture.

The practical fit should be sparse: evaluate a ring kernel only inside a narrow
radial support around a candidate shell. Never construct a dense
`n_voxels x n_shells` matrix.

## 4. Separation strategy: protect diffuse signal first

The inverse problem is not fully identifiable from one contaminated volume: a
narrow, nearly isotropic sample feature can resemble a powder line. The system
must expose and manage that ambiguity rather than hide it.

Use the following hierarchy:

1. Detect candidate shells globally in the unsubtracted sample volume; require
   persistence in solid angle and/or across scan/temperature datasets.
2. When an empty-can/environment measurement is available, first test whether it
   reproduces the relevant components. If it does, fit its non-negative scale with
   propagated counting statistics, optionally as a smooth scan-angle function. If
   it omits the holder or fails held-out residual checks, retain it only as a
   diagnostic.
3. Test Al-informed and material-agnostic shell hypotheses; accept the simpler
   explanation that improves held-out prediction without forcing unmatched peaks
   into the Al family.
4. Fit Bragg-robustly with a Student-t or mixture likelihood and explicit narrow
   angular outlier weights. Do not rely on a trimmed mean alone.
5. Estimate the local diffuse baseline from radial sidebands, but add a protected
   feature mask for known or data-detected diffuse ridges.
6. Cross-fit: estimate the model on a subset of angular sectors/planes and score it
   on held-out sectors/planes. A genuine global powder shell should predict held-out
   data; an accidental crystal feature generally should not.
7. Require evidence improvement over a no-ring model using held-out likelihood and
   a complexity penalty. If evidence is weak, retain the signal.
8. Offer an explicit conservative mode that subtracts the lower confidence bound
   of `R`, not its posterior/point mean.

## 5. Work packages

### WP0 — Freeze and instrument the baseline (1 engineer-week)

- Assign stable names to legacy models: `legacy_patched` and
  `legacy_parametric_rolling`.
- Resolve the Python/web default mismatch without changing scientific output yet.
- Add a `RingFitResult` contract containing cleaned volume, ring estimate, ring
  uncertainty, shell table, diagnostics, failure status, config, and version.
- Persist per-plane legacy failures, skipped planes, masks, detected shells, and
  aggregate timings.
- Capture golden outputs and wall time/RSS for representative 22/45/100 K data.

Gate: existing outputs remain bit-identical under the legacy modes; all current
tests pass; web and server display the same effective configuration.

### WP1 — Build a non-circular benchmark and metric suite (2 engineer-weeks)

Create `tests/data/rings/manifest.json` plus a benchmark runner with:

- analytic 3D diffuse fields, Bragg peaks, noise, and exact ring ground truth;
- real ring-clean volumes with injected Al shell families;
- weak/strong Al, overlapping lines, pseudo-Voigt tails, shell-dependent width,
  center drift, textured arcs, missing wedges, sparse sectors, and bad pixels;
- clean negative controls and non-Al powder contaminants;
- paired sample/empty scans where available;
- multi-temperature injections in which the powder term is shared but sample
  diffuse scattering changes.

Primary metrics:

```text
ring_recall       = 1 - ||R_true - R_fit||_1 / ||R_true||_1
diffuse_retention = 1 - ||D_true - D_clean||_1 / ||D_true||_1
bright_arc_bias   = median_phi_positive[(R_fit - R_true) / peak]
dim_arc_bias      = median_phi_negative[(R_fit - R_true) / peak]
q_bias, width_bias, false_positive_energy, uncertainty_coverage
```

Also score per-shell/per-solid-angle standardized residuals, Bragg retention,
slice-axis invariance, and downstream DeltaPDF change outside a protected
near-origin region.

Gate: every metric is sensitive to a planted under-subtraction,
over-subtraction, center error, width error, and false-positive subtraction. No
metric may be reducible to the fitted model's own objective alone.

### WP2 — 3D shell geometry and candidate inference (2 engineer-weeks)

- Create one coordinate-independent `SphericalObservationSet` from valid voxels:
  `q`, unit direction, intensity, sigma, coverage weight, source index, and flags.
- Replace per-plane shell confirmation with a weighted global radial profile and
  solid-angle persistence test.
- Add `MaterialPrior` implementations for `aluminum_fcc`, `custom_cif/line_list`,
  and `agnostic`.
- For Al, fit `a` in a physically bounded interval and cluster reflections that
  are unresolved at the measured resolution.
- Report matched, missing, extra, and unresolved lines plus an Al evidence score.
- Make detector/sample coordinate frames explicit so angular fields have stable
  meaning across datasets.

Gate: candidate centers are invariant to `slice_axis`; Al lattice recovery and
line matching meet the synthetic tolerances; clean controls do not trigger an Al
claim.

### WP3 — Robust global 3D fitter (4 engineer-weeks)

Implement in increasing complexity:

1. fixed centers/widths + non-negative spherical amplitude field;
2. shared resolution law `w(q)` and pseudo-Voigt mixing;
3. small low-order angular center/width corrections;
4. hierarchical coupling of texture across Al reflections;
5. multi-dataset joint fit with shared shell physics and dataset-specific scale.

Use alternating robust optimization:

- update radial/physical parameters with bounded nonlinear least squares;
- update angular coefficients with sparse penalized IRLS;
- update Bragg/outlier weights from residuals and local angular support;
- update a conservative diffuse sideband model;
- stop on held-out likelihood and parameter stability.

Include deterministic initialization, explicit convergence reasons, and bounded
fallbacks. Keep a simpler `global_nonparametric` mode in case the Al hypothesis is
rejected.

Gate: on the benchmark matrix, median ring recovery >= 95%, diffuse retention >=
98%, Bragg peak attenuation <= 1%, false-positive removed energy <= 0.5% on clean
controls, and results vary <= 1% across requested slice axes. Difficult cases may
return `ambiguous` rather than forcing a subtraction.

### WP4 — Uncertainty and conservative subtraction (2 engineer-weeks)

- Use input voxel variances in the fit likelihood.
- Estimate parameter/model uncertainty by sandwich covariance for routine runs and
  block bootstrap over solid-angle sectors for validation runs.
- Produce `ring_sigma` and propagate
  `sigma_clean^2 = sigma_input^2 + sigma_ring^2`, including covariance caveats.
- Add `subtract = mean`, `lower_confidence_bound`, and `diagnose_only` policies.
- Calibrate uncertainty coverage on the injection suite.

Gate: nominal 90% intervals cover 85-95% of benchmark truth; uncertainty grows in
missing wedges and weak-shell regions; conservative mode reduces false positives
without silently reporting full removal.

### WP5 — Diagnostics, UX, and provenance (2 engineer-weeks)

Replace the single mean ring-energy score with a diagnostic bundle:

- per-shell residual vs `q`;
- residual heatmap vs `(q, solid angle)`;
- bright-arc and dim-arc bias shown separately;
- standardized residual distribution inside shell and in sidebands;
- held-out prediction score and no-ring-vs-ring evidence;
- per-shell center, width, amplitude, angular complexity, and uncertainty;
- subtracted-energy map, oversubtraction-risk map, coverage map, and fit-failure map;
- slice-axis invariance check for validation runs;
- before/model/after and diverging residual views with a shared scale.

The UI should lead with a one-line status: `validated`, `conservative`,
`ambiguous`, or `failed`, followed by the reasons. Advanced controls should not
expose raw regularization constants until an automatic selection path exists.

Persist algorithm version, effective config, material hypothesis, line list,
fit status, metrics, and source hashes with the output.

Gate: the documented texture-contrast-compression example must fail the new QA
even when azimuthal mean removal is near 100%.

### WP6 — Performance and browser parity (2 engineer-weeks)

- Profile the sparse global solver before optimizing.
- Chunk voxels by shell and solid-angle block; reuse basis/kernel matrices.
- Keep float64 reference calculations and add an explicitly tolerated float32
  path only after numerical comparison.
- Parallelize independent shell/bootstrap blocks; avoid copying full volumes into
  workers.
- Define memory budgets for native and Pyodide/browser execution.
- If the full optimizer is too large for Pyodide, run the fit server-side and keep
  deterministic model evaluation/subtraction in the browser. Do not maintain two
  scientifically different default algorithms under one label.

Gate: <= 2x the current native ring-stage wall time in validated mode, <= 1.25x in
routine mode, bounded peak memory, and browser/native output differences below the
benchmark tolerance.

### WP7 — Real-data validation and staged release (2-3 engineer-weeks)

Validation cohorts:

- current TbTi3Bi4 22/45/100 K datasets;
- at least two additional CORELLI samples with Al contamination and different
  diffuse topology;
- paired empty-can/environment datasets;
- clean controls with no visible Al rings;
- a non-Al contaminant dataset.

For each cohort, require blinded visual review plus metrics. Compare legacy
patched, legacy parametric, global agnostic, and Al-informed modes. Evaluate both
reciprocal-space residuals and DeltaPDF stability/interpretability.

Release sequence:

1. hidden experimental API;
2. CLI opt-in `model=global_v2`;
3. UI beta with side-by-side legacy comparison;
4. default only after all gates pass;
5. retain legacy fallback for one minor release, then deprecate based on telemetry
   and reproducibility needs.

## 6. Proposed code shape

```text
src/nebula3d/preprocessing/rings/
  api.py             RingRemovalConfig, RingFitResult, fit_ring_field
  observations.py    weighted 3D spherical observation construction
  materials.py       Al FCC and custom/generic line priors
  candidates.py      global shell discovery and evidence scoring
  basis.py           spherical harmonic/spline bases and regularization
  profiles.py        pseudo-Voigt, empirical kernels, resolution law
  solver.py          sparse alternating robust optimizer
  uncertainty.py     covariance/bootstrap and sigma propagation
  diagnostics.py     residual/evidence/retention metrics
  serialization.py   model/result persistence and provenance
  legacy.py          adapters for the two current implementations
```

Public API:

```python
result = fit_ring_field(volume, RingRemovalConfig(...), references=[empty_scan])
result.cleaned
result.ring_mean
result.ring_sigma
result.shells
result.diagnostics
result.status
```

`remove_rings()` should become a compatibility wrapper around this contract.

## 7. CI and acceptance matrix

Every pull request affecting the new subsystem should run:

- unit tests for geometry, Al lines, bases, profiles, robust weights, and
  serialization;
- property tests for rotation/slice-axis invariance, non-negativity, determinism,
  and mask monotonicity;
- synthetic-injection matrix at reduced size;
- legacy bit-identity tests;
- native float64 reference tests;
- web parameter/schema/metric tests.

Nightly/release CI should add the full benchmark, block-bootstrap coverage,
performance/RSS regression, browser parity, and licensed real-data checks.

No default switch is allowed unless all of these hold:

- scientific gates in WP3/WP4;
- zero unexplained high-severity failures on the real-data cohort;
- no clean-control false subtraction above threshold;
- reproducible result/provenance artifacts;
- approved migration notes and rollback path.

## 8. Critical implementation order

Do not start with the optimizer. The highest-leverage order is:

1. result/diagnostic contract and benchmark metrics;
2. injection generator and clean negative controls;
3. global spherical observation geometry and Al evidence model;
4. simplest global non-negative angular fit;
5. robust outlier separation and held-out validation;
6. radial/texture complexity only when a benchmark failure justifies it;
7. uncertainty, UX, and performance;
8. real-data qualification and default migration.

This order prevents another cycle in which a more expressive model improves its
own fit while making preservation of the unknown diffuse signal harder to prove.

## 9. Estimated scope and decision checkpoints

Total: approximately 17-20 engineer-weeks for one experienced scientific Python
developer, shorter with parallel ownership of benchmarks/UI/performance.

Decision checkpoints:

- **After WP1:** metrics demonstrably expose current bright/dim arc errors.
- **After WP2:** Al-informed detection beats generic detection without false Al
  claims on controls.
- **After WP3:** global model beats both legacy baselines on held-out truth.
- **After WP4:** conservative subtraction and uncertainty are calibrated.
- **After WP7:** decide whether `global_v2` becomes default, remains opt-in, or is
  narrowed to paired-empty/Al-confirmed datasets.

The project should be willing to stop at any checkpoint. A trustworthy
`ambiguous—do not subtract` result is a scientific improvement over a visually
smooth but unvalidated residual.

## 10. Technical references informing the plan

- Savici et al., “Efficient data reduction for time-of-flight neutron scattering
  experiments on single crystals,” *J. Appl. Cryst.* 55 (2022): statistically
  weighted event reduction and efficient sample-environment background
  subtraction, including removal of Al powder lines.
  <https://doi.org/10.1107/S1600576722009645>
- Michels-Clark et al., “Expanding Lorentz and spectrum corrections to large
  volumes of reciprocal space for single-crystal time-of-flight neutron
  diffraction,” *J. Appl. Cryst.* 49 (2016): normalization, statistical
  weighting, and reciprocal-space reduction used by later diffuse-scattering
  workflows. <https://doi.org/10.1107/S1600576716001369>
- Cervellino and Frison, “Texture corrections for total scattering functions,”
  *Acta Cryst.* A76 (2020): spherical-harmonic treatment of non-uniform powder
  orientation and its consequences for total scattering.
  <https://doi.org/10.1107/S2053273320002521>
- Ashiotis et al., “The fast azimuthal integration Python library: pyFAI,”
  *J. Appl. Cryst.* 48 (2015): diffraction geometry, ring extraction,
  pixel-splitting, and parallel radial/azimuthal integration.
  <https://doi.org/10.1107/S1600576715004306>
- Morgan et al., “rmc-discord: reverse Monte Carlo refinement of diffuse
  scattering and correlated disorder from single crystals,” *J. Appl. Cryst.* 54
  (2021): uncertainty-weighted diffuse-scattering analysis, empty-instrument
  background guidance, and caution around powder-line overlap with diffuse
  features. <https://doi.org/10.1107/S1600576721010141>
