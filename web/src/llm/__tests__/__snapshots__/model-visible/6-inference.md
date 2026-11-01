# The inference arm C does not read

Every span of the text the model reads that is inference (inference.ts), where it is written: which reading or check to use for a conclusion (reading), what a value or a pattern is evidence of (evidence), or what a finding calls for, a change, a check to run next or what to report (remedy). With the skills on (the console, arm B) the text is read whole; with them off (arm C) these spans are left out, and the rest, the definitions, is read as written. A sentence that mixes the two is split at the span; where the definitions left would not read whole, a small connective beside the span gives them the words they need in arm C only. 87 spans in 31 texts or sets: reading 24, evidence 43, remedy 20.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## metrics/bunching.ts: off_lattice_bunching's facts

1 span: remedy 1.

Spans of a text built for each call (its numbers vary), each as written:

- remedy: “ Whether the sample has that modulation, and in which form, is the user's to say: ask them (ask_user), and do not assume the answer either way.”

## metrics/punch.ts: the context's peak_profile.search_note

1 span: reading 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
peaks the search punched off the Bragg nodes⟦reading: ; grain_check says whether they are a second grain or displaced Bragg peaks⟧
```

## prompts/system.ts: the core prompt, with tools

15 spans: reading 14, remedy 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧, and each connective that reads otherwise in arm C ⟨connective: “as written” → “in arm C”⟩:

```text
You are NEBULA Pilot, the assistant in nebula3d, which cleans a 3D reciprocal-space
diffuse-scattering volume and Fourier-transforms it into a 3D-ΔPDF. Its stages, in order:
(1) powder/Al ring removal, (2) Bragg punch, (3) backfill of the punched holes, (4) radial
background flatten, (5) the 3D-ΔPDF, (6) a back-FFT check. The first user message, the context,
lists what was on disk when this request started; it measures nothing. Measure with the tools,
and again after every run.

Evidence rules (the app checks every answer, and sends back one that breaks them):
1. A verdict on a stage or a check comes from its tool, called in this reply after the last run
that recomputed the stage. Never grade a stage yourself. Whether the run met its goal is
{{achieved}}, which the app computes: quote it and explain it, never decide it.
2. Write a tool's number as {{tool.field}}, the field's path in its result, and the app fills it
in: a list item by index, a table cell by row, then column name or index, e.g.
{{ub_check.orientation_change_deg}}, {{dpdf_peaks.features.0.length_A}},
{{radial_profile.shells.3.flattened}}. Or quote it exactly as returned, sign included. Any other
number must come from a tool result, the context or the user.
3. One cut is not the volume.⟦reading:  Before a verdict, use the tool that judges the whole volume, or measure a second cut.⟧
4. When the results lack what a question needs, say so; never guess. Be concise and cautious.

⟦reading: To judge a run, settle these checks, each with numbers, and say which pass:
⟧⟨connective: “” → “A run is judged on these properties: ”⟩⟦reading: (1) ⟧⟨connective: “The ring removal” → “the ring removal”⟩ is clean⟦reading: : assess_stage rings⟧⟨connective: “.
” → “; ”⟩⟦reading: (2) ⟧⟨connective: “The Bragg punch” → “the Bragg punch”⟩ removes the Bragg peaks cleanly⟦reading: : assess_stage punch⟧⟨connective: “.
” → “; ”⟩⟦reading: (3) ⟧⟨connective: “The backfill” → “the backfill”⟩ meets its surroundings, and the punch and backfill add no texture to reciprocal space⟦reading: : assess_stage backfill and texture_check⟧⟨connective: “.
” → “; ”⟩⟦reading: (4) ⟧⟨connective: “The flatten” → “the flatten”⟩ leaves no pedestal⟦reading: : assess_stage flatten⟧⟨connective: “.
” → “; ”⟩⟦reading: (5) ⟧⟨connective: “The 3D-ΔPDF” → “the 3D-ΔPDF”⟩'s back-FFT reproduces the data's even part under Q → −Q, its declared symmetry is kept, and Qmax is not past the data coverage⟦reading: : assess_stage pdf, symmetry_check and qmax_coverage⟧⟨connective: “.
” → “; ”⟩⟦reading: (6) ⟧⟨connective: “A” → “a”⟩ UB that is off, a shifted HKL origin and raw counts that end inside the box are named as the data's own problems, which no setting fixes⟦reading: : ub_check and grain_check for the UB, ub_check for the origin, qmax_coverage for the counts⟧.
When a change improves one number, check that it did not break another.

When the user asks, run and tune yourself: run_pipeline; tune_pipeline, or update_settings for
one change, then run_pipeline from the stage it returns. Measure the same cuts before and after a
change, undo one that made things worse, and say what you ran, changed and found. Name settings
exactly as update_settings lists them. The modulation, the supercell, the |Q| band, the magnetic
ion and the Laue class are the user's facts about the sample: change them only when asked.
ask_user in a result is a question for the user⟦remedy: : ask it, never answer it yourself⟧.
```

## prompts/system.ts: the system prompt, the metrics

19 spans: reading 3, evidence 16.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧, and each connective that reads otherwise in arm C ⟨connective: “as written” → “in arm C”⟩:

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
ring_energy_ratio = after/before⟦evidence: ; lower is cleaner, near 1 means rings survived⟧. Its
floor is not 0: diffuse structure keeps some bumps after a perfect removal (a ratio
near 0.4–0.5 can be ring-free)⟦reading: , so compare it across cuts and settings⟧.
over_subtraction_fraction and after_negative_fraction flag voxels driven negative — a
few percent is normal noise⟦evidence: , a large fraction means the subtraction ate diffuse signal⟧.
ring_residuals judges the removal at each ring of the raw cut: at (|Q|) and
residual_fraction, the ring-removed profile across the ring against a line through the
diffuse beside it, as a share of that diffuse. Negative is a dent⟦evidence:  (the subtraction
over-shot, though no voxel need go negative)⟧, positive a ring left over. noise_fraction is
the scatter of that diffuse about its line, the yardstick on one plane: a residual is
significant only beyond 3 × noise_fraction, and smaller ones are noise, not a verdict.
worst_ring_dent and worst_ring_left pick the extremes among the significant ones.
These are the raw cut's bumps, and the crystal's own scattering makes bumps too⟦reading: : whether
each is a powder ring (it rises in nearly every direction in 3D) only assess_stage tells⟧.
suggested_display_vmax is a robust contrast ceiling for spotting residual rings by eye.

- bragg_punch.leftover scans the PUNCHED slice for sharp peaks that were NOT removed
(punched voxels are NaN holes): each must stand sigma local robust σ above its own
neighbourhood and span more than one voxel. suspicious_peaks lists their (x,y) position,
hkl, at_node, intensity, local background, contrast and sigma. n_at_nodes are missed
lattice (Bragg) peaks⟦evidence: : a punch failure⟧. n_off_nodes are sharp off-lattice peaks⟦evidence: :
satellites or spurious peaks⟧, which the search punches unless their H planes are
protected; whether they should go depends on the sample. on_protected_plane marks those
on the protected planes (n_on_protected): they stay by design, and are satellites only
if the user said so. Each peak carries fwhm_voxels; broad (FWHM ≥ 5 voxels along a slice
axis; n_broad_off_nodes) off-lattice leftovers⟦evidence:  are diffuse maxima such as short-range
order — signal to keep, not missed reflections⟧⟨connective: “” → “ are counted on their own”⟩. n_skipped_noisy counts spikes
in noisy regions such as the coverage edge⟦evidence: : noise, not peaks⟧.⟦evidence:  n_suspicious=0 is clean.⟧
bragg_punch.peak_profile summarises the fitted peaks: resolution_limited_fraction near 1
means most peaks are as narrow as the grid allows⟦evidence:  (sharp Bragg peaks, so the punch
footprint follows the instrument resolution)⟧; median_measured_width_q is the typical peak
FWHM per reciprocal axis; median_anisotropy > ~1.5 means elongated peaks⟦evidence:  (possible
satellites or diffuse rods)⟧.

- backfill: median_seam_sigma is the typical |fill − local background| at hole rims in σ
units — ≲ 1 is a seamless blend, large means the fill sits above/below its surroundings.
bright_fill_fraction flags fills left implausibly bright⟦evidence:  (a peak not fully removed)⟧.
checkerboard_fraction ≈ 0.5 is random⟦evidence: ; approaching 1 signals a periodic interpolation
artefact (a 'strange pattern')⟧.

- flatten: the per-|Q|-shell low floor (the run's own floor percentile, the 25th by default) of the backfilled (floor_before)
and flattened (floor_after) slice, averaged over the inner / middle / outer third of |Q|.
⟦reading: After a good flatten floor_after is near 0 in all three thirds; ⟧after_floor_max_sigma (the
largest |shell floor| in robust σ) is reported, not judged, in the flatten's verdict: σ is the cut's own spread, and the floors follow the diffuse level. removed_fraction is the pedestal removed as a share of the level.
The model is fitted to each shell's 25th-percentile floor, so about a quarter of the
voxels sit below 0 after a good flatten by construction (after_negative_fraction ≈ 0.25).
floor_trend (rank correlation of the floors with |Q|) and floor_span_fraction (their range as a
share of the diffuse level), over the outer half of the |Q| shells the counts reach (floor_judged_q gives their |Q| range),
catch a pedestal the floor in σ hides beside strong diffuse⟦evidence: : a trend near ±1 with a span near 1 is a leftover
background (a rising one is inelastic: thermal diffuse, and Compton with X-rays; the model's b·Q² term)⟧.
The flatten's verdict judges these two alone, over the volume's shells: a trend (in magnitude) and a span both 0.8 or more are a pedestal left.

- delta_pdf: feature_snr is the strongest feature amplitude in background-σ units (the
origin self-correlation peak is excluded)⟦evidence: ; ≳ 5 means clear structured signal above noise⟧.
strong_feature_fraction is the share of voxels beyond 5σ. positive_fraction near 0.5 is a
balanced ± pattern; skew shows whether correlation excess or depletion dominates.
anisotropy_ratio from the strong features' covariance is 1 for isotropic and > ~1.5 for
directional rods/sheets, with anisotropy_angle_deg giving the major-axis orientation in
the slice plane. radial_trend is mean |ΔPDF| in inner/mid/outer shells⟦evidence:  — a falling trend
means short-range correlations, a flat trend means they persist to large r⟧.
consistency_pearson_r and consistency_normalized_rms come from a round trip: the ΔPDF
transformed back (apodization undone) and compared with the data it was built from.
The transform keeps the data's even part under Q → −Q, so r against the data is lower by the odd part, counting
noise on unsymmetrised data; the ΔPDF's verdict judges the round trip against the even part
instead, back_fft_pearson_r_even, to an r of 0.999 or more. Without a |Q| band or crop
that round trip is the identity, so r ≈ 1 to rounding only says the transform ran correctly; it
is no evidence that the ΔPDF is physically right.⟦evidence:  back_fft_pearson_r_even below 0.999
flags a transform, crop or band problem.⟧

Ground rules: base every statement on numbers in the context and quote them. When an image
is attached, describe what you actually see and reconcile it with the metrics. All metrics
come from a single 2D cut, not the whole volume — say so when it matters. When the context
lacks what a question needs, say so plainly instead of guessing. Be concise and
scientifically cautious; do not overstate certainty from summary statistics.
```

## tools/index.ts: compare_laue_classes's description

2 spans: evidence 1, remedy 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Which Laue class does the sample have? Compares by R_int every Laue class the cell's metric allows (within 2%) and whose operations map the grid, on the raw volume as the average reads it, on all measured voxels and the diffuse, each over its noise floor (x_noise). Returns classes, rule, suggestion (or none), flag⟦evidence:  (the diffuse supports less than the Bragg peaks)⟧. Refused on a symmetrised volume. Seconds to minutes.⟦remedy:  The class is the user's to set: cite classes, rule and flag when you suggest one.⟧
```

## tools/index.ts: consistency_details's description

1 span: evidence 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
The run's saved back-FFT check in full: Pearson r and normalised RMS of the inverse-FFT ΔPDF against the cleaned data, r per principal plane, the |Q| and r bands, crop and apodization. pearson_r_even compares the round trip with the data's even part under Q → −Q, what the transform keeps: 1 when it is sound; r against the data is lower by the odd part (odd_share)⟦evidence: , no fault on unsymmetrised data⟧. Neither says a feature is real.
```

## tools/index.ts: dpdf_contrast's description

1 span: remedy 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Set the 3D-ΔPDF viewer's colour range so pair-correlation features carry the colour and the FFT ripple stays dim. Call it once without arguments: the limit is the 99.9th percentile of |ΔPDF| on the three centre sections (origin disk left out), the page's Auto.⟦remedy:  Use it before you describe a ΔPDF figure.⟧ Returns the applied limit, and what the 99.5th and 99.97th percentiles would give. Pass percentile or limit_sigma only for a range the user asks for; reset returns to Auto.
```

## tools/index.ts: dpdf_peaks's description

2 spans: reading 1, evidence 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
The 3D-ΔPDF's strongest features in the whole volume: extrema above min_sigma (default 5) robust σ outside the origin's disk, each ± pair once. Returns features: length_A, size_sigma (signed: + more pairs than the average structure, − fewer), n_vectors of one sign, length and size⟦evidence:  (likely symmetry copies)⟧, up to 4 vectors_rlu (x/a, y/b, z/c) and vectors_A (Å along a, b, c). ⟦reading: Use it after the trust checks (qmax_coverage, symmetry_check, assess_stage pdf). ⟧ What a feature means is the user's call.
```

## tools/index.ts: line_profile's description

1 span: reading 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Intensity along a straight line parallel to one axis through any stage volume⟦reading:  — e.g. along H through (H, 1/3, 0) to see a satellite row, or across a residual ring⟧. Reciprocal stages take H/K/L (r.l.u.); delta_pdf takes x/y/z (Å). Returns sampled points plus the exact maximum, minimum and median.
```

## tools/index.ts: mark_region's description

1 span: remedy 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Mark a region in the slice views and move them to it, so the user sees a finding⟦remedy:  (satellites at h ± q, a ring left over, a ΔPDF feature)⟧. where: raw, rings, punch, backfill, flatten (h, k, l in r.l.u.) or pdf (x, y, z in Å along a, b, c). shape: box or ellipsoid (center, half_size), or points (up to 12). evidence: the calls showing it, as tool or tool.field (dpdf_peaks.features.0); none, or a region empty or outside the volume, marks nothing. Returns where it is drawn. Cite it by its id (M1, …).
```

## tools/index.ts: measure_dpdf_cut's description

1 span: evidence 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
The 3D-ΔPDF feature metrics on any real-space section, in its own robust σ outside the origin's disk: feature_snr, the strongest feature over background σ⟦evidence:  (≳ 5 is clear signal)⟧; strong_feature_fraction, voxels beyond 5σ; positive_fraction (0.5: balanced ±); anisotropy_ratio (1 isotropic, above ~1.5 rods or sheets) and anisotropy_angle_deg in the plane; radial_trend, mean |ΔPDF| in inner, middle and outer shells.
```

## tools/index.ts: measure_reciprocal_cut's description

3 spans: reading 1, evidence 2.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Compute the stage-quality metrics (ring removal, leftover Bragg peaks, backfill seams, flatten floors) on any reciprocal-space cut: one cut, not the volume.⟦reading:  Use it to check whether a finding holds on other planes or off-zero cuts (e.g. L=0.5, or K=1/3 for satellites).⟧
Fields. ring_removal: ring_energy_ratio, after/before share of the radial profile in ring bumps (diffuse keeps it above 0: 0.4–0.5 can be ring-free); over_subtraction_fraction, after_negative_fraction: voxels driven negative (a few percent is noise); ring_residuals per raw ring: residual_fraction against the diffuse beside it (negative a dent, positive a ring left), significant beyond 3 × noise_fraction. bragg_punch_leftover: sharp peaks the punch missed on this cut, not what its search found: n_at_nodes, missed Bragg peaks; n_off_nodes, off the lattice (on_protected_plane: kept by design); n_broad_off_nodes, FWHM ≥ 5 voxels⟦evidence: : diffuse maxima, signal⟧. backfill: median_seam_sigma, |fill − rim| in σ (≲ 1 seamless); checkerboard_fraction, 0.5 random⟦evidence: , near 1 an artefact⟧. flatten: floor_before, floor_after: shell floors by third of |Q|; after_negative_fraction ≈ 0.25 by construction; floor_trend, floor_span_fraction over the outer half of the |Q| shells the counts reach (floor_judged_q): both 0.8 or more is a pedestal (the verdict reads the volume's floors); after_floor_max_sigma is reported, not judged.
```

## tools/index.ts: radial_profile's description

3 spans: reading 2, evidence 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
The median intensity in |Q| shells of one reciprocal cut, for each cleanup stage side by side (raw, ringremoved, braggpunched, backfilled, flattened). Shell medians ignore Bragg peaks but follow powder rings⟦evidence: , which are bumps in raw that ring removal should take out without denting the diffuse⟧⟦reading: ; after flatten the floor should sit near 0 at every |Q|⟧.⟦reading:  Use it to see where in |Q| a stage left or removed signal.⟧
```

## tools/index.ts: symmetry_check's description

1 span: evidence 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Does the 3D-ΔPDF keep the symmetry its data were declared symmetrised with? Each operation of the declared point group (none: the cell's in-plane ones): the RMS difference from the ΔPDF's image over its RMS, on the worst section it maps (x–y at ±z, default 0; x–z, y–z), else voxel by voxel (tested_on, not_tested). Returns ops, holds, verdict; a kept symmetry holds to about 1e-3⟦evidence: ; more means a stage broke it, or the sample lacks it⟧. Which operations the sample has is the user's to say.
```

## tools/index.ts: ub_check's description

1 span: evidence 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Is the volume's UB right? Fits the UB to the raw volume's Bragg-peak centres (the punch cell's nodes, low |Q| first). Returns verdict, rms_start → rms, cell_start and cell, orientation_change_deg, radial (offset along Q per |Q| band and direction), mean_offset_rlu, origin_shift_rlu. On a symmetrised volume only the changes that commute with its operations are fitted (fit 'symmetric'): the orientation needs the unsymmetrised file⟦evidence: . An offset that changes with |Q| is no UB error⟧. About 10 s.
```

## tools/index.ts: ub_check's reading

3 spans: evidence 1, remedy 2.

Spans of a text built for each call (its numbers vary), each as written:

- evidence: “, the HKL origin shifted by about that much, which no UB can make”
- remedy: “ Report the origin, not the UB.”
- remedy: “ Look at the origin of the HKL grid, or at how |Q| was assigned, not at the UB.”

## tune/catalog.ts: flattenFitQMax's help

1 span: remedy 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
model only: end (Å⁻¹) of the |Q| range the model is fitted to (from 0.8).⟦remedy:  Raise it toward the data's coverage when the background keeps changing past 10 Å⁻¹.⟧
```

## tune/catalog.ts: flattenQ2's help

1 span: remedy 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
model only: also fit b·Q², the smooth rise of an inelastic background (thermal diffuse; with X-rays also Compton)⟦remedy: . Use it when the shell floors climb with |Q| after the flatten (floor_trend near 1)⟧; it varies too slowly to follow pair correlations.
```

## tune/catalog.ts: punchSearchMaxWidth's help

2 spans: evidence 1, remedy 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Off-lattice search width test: a candidate broader than this × the dataset's Bragg width along any axis is left as diffuse⟦evidence:  (a short-range-order maximum)⟧ instead of punched. 0 (blank) is off and punches every candidate⟦remedy: ; spurious reflections are as sharp as Bragg peaks, so 2 keeps them punched while broad diffuse maxima stay⟧.
```

## verdicts/rules.ts: grain_check's verdict

6 spans: evidence 3, remedy 3.

Spans of a text built for each call (its numbers vary), each as written:

- remedy: “; refine the UB”
- evidence: “: copies of the crystal's own Bragg peaks, displaced by symmetrising data whose UB is off by about that angle”
- remedy: “; a UB refined on the unsymmetrised data would put them back on the nodes”
- evidence: “: the Bragg peaks themselves, off their nodes by about that angle”
- remedy: “ (refine the UB)”
- evidence: “; their origin is open (another phase, multiple scattering, or an artefact)”

## verdicts/rules.ts: qmax_coverage's verdict

4 spans: remedy 4.

Spans of a text built for each call (its numbers vary), each as written:

- remedy: “; taper it to the coverage (pdfWindowSupport) or set a |Q| band”
- remedy: “; set a |Q| band at or below it, or taper the window to the coverage”
- remedy: “; set a |Q| band at or below it”
- remedy: “; the band the counts allow is suggested_band, the user's to set”

## verdicts/rules.ts: symmetry_check's verdict

2 spans: evidence 2.

Spans of a text built for each call (its numbers vary), each as written:

- evidence: “, so the sections' asymmetry (”
- evidence: “) is the data's own, counting noise included, not a break by a stage”

## verdicts/rules.ts: the backfill goal

2 spans: evidence 2.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small⟦evidence:  (no bright plugs where peaks were)⟧, checkerboard_fraction near 0.5⟦evidence:  (near 1 is a periodic interpolation artefact)⟧.
```

## verdicts/rules.ts: the backfill's own criterion

1 span: reading 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
The fills meet their surroundings: a median seam of 1σ or less.⟦reading:  Whether the fills are biased one way is texture_check's to say.⟧
```

## verdicts/rules.ts: the flatten goal

2 spans: evidence 1, remedy 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself.⟦evidence:  A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ⟧⟦remedy: : a rising one wants flattenQ2 and a fit range reaching the coverage (flattenFitQMax), not a free-form estimator, which also removes isotropic pair correlations.⟧
```

## verdicts/rules.ts: the pdf goal

3 spans: evidence 3.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
The ΔPDF must show features above noise (feature_snr) with the transform's reach inside the measured coverage: window_weight_on_unmeasured, the share of the window's weight on unmeasured reciprocal space, must stay at or below 1e-3, where the backend's own window keeps it (a trial past it is not a candidate).⟦evidence:  A window that reaches further raises feature_snr with the backfill's guesses and the box's empty corners, which is worse, not better.⟧ max_symmetry_break is the x–y section's largest RMS difference from its image under the declared group's operations that map it onto itself (none declared: the cell's in-plane operations; worst_symmetry_op names it)⟦evidence: : a trial that raises it far above your settings' value broke a symmetry your settings kept, as a separable window does on a hexagonal cell⟧. back_fft_pearson_r_even, the round trip against the data's even part under Q → −Q (what the real transform keeps), must stay near 1; back_fft_pearson_r against the data is lower by the odd part (back_fft_odd_share, counting noise on unsymmetrised data). Without a band or crop the round trip is the identity, so neither can rank trials⟦evidence: : back_fft_pearson_r_even below ~0.999 only flags a transform problem⟧. Apodization trades real-space resolution against truncation ripples; prefer the default unless another is clearly better on feature_snr without the reach leaving the coverage.
```

## verdicts/rules.ts: the punch criterion

1 span: evidence 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima⟦evidence:  are diffuse scattering, and⟧ stay.
```

## verdicts/rules.ts: the punch goal

2 spans: evidence 2.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice)⟦evidence:  are satellites or spurious peaks⟧ the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis⟦evidence: : diffuse maxima such as short-range order, which are the signal, not peaks to punch⟧). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.
```

## verdicts/rules.ts: the ring removal's notice

2 spans: remedy 2.

Spans of a text built for each call (its numbers vary), each as written:

- remedy: “ Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract every candidate, the crystal's own shells included.”
- remedy: “ Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract it, even if it is the crystal's own shell.”

## verdicts/rules.ts: the rings criterion

1 span: evidence 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions)⟦evidence: : the crystal's own scattering at that |Q| rises in some directions only⟧.
```

## verdicts/rules.ts: the rings goal

1 span: evidence 1.

The text as arm B reads it, each span arm C leaves out marked ⟦class: …⟧:

```text
Remove powder/Al rings: mean_ring_energy_ratio as low as the trials reach on every plane (its floor is set by the diffuse, not 0; near 0.4–0.5 can be ring-free), while over_subtraction_fraction and after_negative_fraction stay small (a few percent from noise), and each raw ring ends level with the diffuse beside it: max_ring_dent (how far the deepest ring sits below its flanks, a share of the diffuse there⟦evidence: ; the subtraction over-shot, even where no voxel goes negative⟧) and max_ring_left (a ring left over) both 0: they count only residuals beyond 3 × their plane's noise_fraction, so any value above 0 is a real dent or leftover (worst_ring_dent and worst_ring_left say on which plane and at which |Q|). A bump counts only if it is a powder ring, rising in nearly every direction over the sphere (shells_judged); the others are the crystal's own scattering, which the removal must leave and subtracts nothing from (per_plane marks them ring: false, out of its worst_ring_dent and worst_ring_left). Lower ring energy bought by over-subtracting (negatives or ring dents rising) is worse, not better.
```
