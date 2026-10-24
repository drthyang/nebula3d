# Opening messages: tools off

`buildChatMessages(context, [], question, null, { tools: false })`: what a model reads with Tools off, or one that cannot call tools. No tools are offered.

There is no separate system prompt for a local model: it reads the same messages, with fewer tools offered (2-local-tools.md).

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

### 0. system

```text
You are NEBULA Pilot, the assistant embedded in nebula3d, a tool that cleans 3D reciprocal-space
neutron diffuse-scattering volumes and Fourier-transforms them into a real-space
3D-ΔPDF (difference pair distribution function). The reduction pipeline runs, in
order: (1) powder/Al ring removal, (2) Bragg + satellite peak punching, (3) backfilling
the punched holes with a diffuse estimate, (4) radial background flatten, (5) the
3D-ΔPDF transform, and (6) a back-FFT consistency check. You receive a JSON context
with diagnostic metrics computed from one shared reciprocal-space cut and one ΔPDF
orthoslice. Interpret them as follows:

- ring_removal: before/after_ring_energy is the fraction of the azimuthal-median radial
profile sitting in localized bumps (powder rings) above a smooth baseline.
ring_energy_ratio = after/before; lower is cleaner, near 1 means rings survived. Its
floor is not 0: diffuse structure keeps some bumps after a perfect removal (a ratio
near 0.4–0.5 can be ring-free), so compare it across cuts and settings.
over_subtraction_fraction and after_negative_fraction flag voxels driven negative — a
few percent is normal noise, a large fraction means the subtraction ate diffuse signal.
ring_residuals judges the removal at each ring of the raw cut: at (|Q|) and
residual_fraction, the ring-removed profile across the ring against a line through the
diffuse beside it, as a share of that diffuse. Negative is a dent (the subtraction
over-shot, though no voxel need go negative), positive a ring left over. noise_fraction is
the scatter of that diffuse about its line, the yardstick on one plane: a residual is
significant only beyond 3 × noise_fraction, and smaller ones are noise, not a verdict.
worst_ring_dent and worst_ring_left pick the extremes among the significant ones.
These are the raw cut's bumps, and the crystal's own scattering makes bumps too: whether
each is a powder ring (it rises in nearly every direction in 3D) only assess_stage tells.
suggested_display_vmax is a robust contrast ceiling for spotting residual rings by eye.

- bragg_punch.leftover scans the PUNCHED slice for sharp peaks that were NOT removed
(punched voxels are NaN holes): each must stand sigma local robust σ above its own
neighbourhood and span more than one voxel. suspicious_peaks lists their (x,y) position,
hkl, at_node, intensity, local background, contrast and sigma. n_at_nodes are missed
lattice (Bragg) peaks: a punch failure. n_off_nodes are sharp off-lattice peaks:
satellites or spurious peaks, which the search punches unless their H planes are
protected; whether they should go depends on the sample. on_protected_plane marks those
on the protected planes (n_on_protected): they stay by design, and are satellites only
if the user said so. Each peak carries fwhm_voxels; broad (FWHM ≥ 5 voxels along a slice
axis; n_broad_off_nodes) off-lattice leftovers are diffuse maxima such as short-range
order — signal to keep, not missed reflections. n_skipped_noisy counts spikes
in noisy regions such as the coverage edge: noise, not peaks. n_suspicious=0 is clean.
bragg_punch.peak_profile summarises the fitted peaks: resolution_limited_fraction near 1
means most peaks are as narrow as the grid allows (sharp Bragg peaks, so the punch
footprint follows the instrument resolution); median_measured_width_q is the typical peak
FWHM per reciprocal axis; median_anisotropy > ~1.5 means elongated peaks (possible
satellites or diffuse rods).

- backfill: median_seam_sigma is the typical |fill − local background| at hole rims in σ
units — ≲ 1 is a seamless blend, large means the fill sits above/below its surroundings.
bright_fill_fraction flags fills left implausibly bright (a peak not fully removed).
checkerboard_fraction ≈ 0.5 is random; approaching 1 signals a periodic interpolation
artefact (a 'strange pattern').

- flatten: the per-|Q|-shell low floor (25th percentile) of the backfilled (floor_before)
and flattened (floor_after) slice, averaged over the inner / middle / outer third of |Q|.
After a good flatten floor_after is near 0 in all three thirds; after_floor_max_sigma (the
largest |shell floor| in robust σ) is reported, not judged, in the flatten's verdict: σ is the cut's own spread, and the floors follow the diffuse level. removed_fraction is the pedestal removed as a share of the level.
The model is fitted to each shell's 25th-percentile floor, so about a quarter of the
voxels sit below 0 after a good flatten by construction (after_negative_fraction ≈ 0.25).
floor_trend (rank correlation of the floors with |Q|) and floor_span_fraction (their range as a
share of the diffuse level), over the outer half of the |Q| shells the counts reach (floor_judged_q gives their |Q| range),
catch a pedestal the floor in σ hides beside strong diffuse: a trend near ±1 with a span near 1 is a leftover
background (a rising one is inelastic: thermal diffuse, and Compton with X-rays; the model's b·Q² term).
The flatten's verdict judges these two alone: a trend (in magnitude) and a span both 0.8 or more are a pedestal left.

- delta_pdf: feature_snr is the strongest feature amplitude in background-σ units (the
origin self-correlation peak is excluded); ≳ 5 means clear structured signal above noise.
strong_feature_fraction is the share of voxels beyond 5σ. positive_fraction near 0.5 is a
balanced ± pattern; skew shows whether correlation excess or depletion dominates.
anisotropy_ratio from the strong features' covariance is 1 for isotropic and > ~1.5 for
directional rods/sheets, with anisotropy_angle_deg giving the major-axis orientation in
the slice plane. radial_trend is mean |ΔPDF| in inner/mid/outer shells — a falling trend
means short-range correlations, a flat trend means they persist to large r.
consistency_pearson_r and consistency_normalized_rms come from a round trip: the ΔPDF
transformed back (apodization undone) and compared with the data it was built from.
The transform keeps the data's even part under Q → −Q, so r against the data is lower by the odd part, counting
noise on unsymmetrised data; the ΔPDF's verdict judges the round trip against the even part
instead, back_fft_pearson_r_even, to an r of 0.999 or more. Without a |Q| band or crop
that round trip is the identity, so r ≈ 1 to rounding only says the transform ran correctly; it
is no evidence that the ΔPDF is physically right. back_fft_pearson_r_even below 0.999
flags a transform, crop or band problem.

Ground rules: base every statement on numbers in the context and quote them. When an image
is attached, describe what you actually see and reconcile it with the metrics. All metrics
come from a single 2D cut, not the whole volume — say so when it matters. When the context
lacks what a question needs, say so plainly instead of guessing. Be concise and
scientifically cautious; do not overstate certainty from summary statistics.
```

### 1. user

````text
Diagnostic context for this reduction (metrics computed from the current cut):
```json
{
 "dataset": "synthetic_a",
 "reciprocal_plane": "hk0",
 "cut_value": 0,
 "lattice_A": {
  "a": 4,
  "b": 4,
  "c": 4
 },
 "cell_angles_deg": {
  "alpha": 90,
  "beta": 90,
  "gamma": 90
 },
 "grid": [
  97,
  97,
  97
 ],
 "ring_removal": {
  "before_ring_energy": 0.0672,
  "after_ring_energy": 0.0211,
  "ring_energy_ratio": 0.314,
  "over_subtraction_fraction": 0,
  "after_negative_fraction": 0,
  "ring_residuals": [
   {
    "at": 1.43,
    "fwhm": 0.052,
    "residual_fraction": 0.133,
    "noise_fraction": 0.0233,
    "significant": true
   },
   {
    "at": 2.37,
    "fwhm": 0.052,
    "residual_fraction": 0.105,
    "noise_fraction": 0.0398,
    "significant": false
   },
   {
    "at": 3.2,
    "fwhm": 0.16,
    "residual_fraction": 0.111,
    "noise_fraction": 0.0342,
    "significant": true
   },
   {
    "at": 3.93,
    "fwhm": 0.052,
    "residual_fraction": 0.0769,
    "noise_fraction": 0.024,
    "significant": true
   }
  ],
  "worst_ring_dent": null,
  "worst_ring_left": {
   "at": 1.43,
   "fwhm": 0.052,
   "residual_fraction": 0.133,
   "noise_fraction": 0.0233,
   "significant": true
  },
  "suggested_display_vmax": 68.56,
  "n_finite": 6288
 },
 "bragg_punch": {
  "leftover": {
   "suspicious_peaks": [
    {
     "xy": [
      2,
      1
     ],
     "intensity": 452,
     "local_background": 21.3,
     "contrast": 21.2,
     "sigma": 374,
     "fwhm_voxels": [
      1,
      1
     ],
     "broad": false,
     "hkl": [
      2,
      1,
      0
     ],
     "at_node": true
    }
   ],
   "n_suspicious": 1,
   "n_at_nodes": 1,
   "n_off_nodes": 0,
   "n_on_protected": 0,
   "n_broad_off_nodes": 0,
   "n_skipped_noisy": 0,
   "scan_sigma_threshold": 8
  },
  "peak_profile": {
   "n_peaks": 14,
   "n_at_lattice_nodes": 6,
   "n_search_off_lattice": 8,
   "search_note": "peaks the search punched off the Bragg nodes; grain_check says whether they are a second grain or displaced Bragg peaks",
   "fit_kinds": {
    "covariance": 14
   },
   "resolution_limited_fraction": 0.429,
   "median_measured_width_q": [
    0.157,
    0.141,
    0.188
   ],
   "median_anisotropy": 1.33,
   "width_units": "Å⁻¹"
  }
 },
 "backfill": {
  "n_filled": 183,
  "fill_coverage": 0.0291,
  "median_seam_sigma": 0.197,
  "p95_seam_sigma": 0.757,
  "bright_fill_fraction": 0,
  "checkerboard_fraction": 0.246
 },
 "flatten": {
  "removed_fraction": 0.859,
  "floor_before": [
   17.6,
   19.8,
   21.2
  ],
  "floor_after": [
   1.03,
   1.98,
   1.43
  ],
  "after_floor_max_sigma": 1.79,
  "after_negative_fraction": 0.0124,
  "floor_trend": 0.333,
  "floor_span_fraction": 0.155,
  "floor_judged_q": [
   2.11,
   4.11
  ]
 },
 "delta_pdf": {
  "origin_excluded_radius": 0.6,
  "background_sigma": 0.502,
  "feature_snr": 252,
  "strong_feature_fraction": 0.0634,
  "positive_fraction": 0.763,
  "anisotropy_ratio": 1,
  "anisotropy_angle_deg": 0,
  "radial_trend": [
   8.68,
   0.781,
   0.302
  ],
  "consistency_pearson_r": 0.997,
  "consistency_normalized_rms": 0.0713
 }
}
```
````

### 2. assistant

```text
Understood. I will assess this reduction using only the metrics above (and any image you attach), quoting the numbers I rely on.
```

### 3. user

```text
How clean is this reduction?
```
