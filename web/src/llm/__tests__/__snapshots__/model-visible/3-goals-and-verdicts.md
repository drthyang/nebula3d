# Stage goals and verdict text

The fixed text the tools' results and the tuning prompts carry.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## STAGE_GOALS (tune/prompts.ts): each stage's goal, in assess_stage's single-stage result and the tuning prompts

### rings

```text
Remove powder/Al rings: mean_ring_energy_ratio as low as the trials reach on every plane (its floor is set by the diffuse, not 0; near 0.4–0.5 can be ring-free), while over_subtraction_fraction and after_negative_fraction stay small (a few percent from noise), and each raw ring ends level with the diffuse beside it: max_ring_dent (how far the deepest ring sits below its flanks, a share of the diffuse there; the subtraction over-shot, even where no voxel goes negative) and max_ring_left (a ring left over) both 0: they count only residuals beyond 3 × their plane's noise_fraction, so any value above 0 is a real dent or leftover (worst_ring_dent and worst_ring_left say on which plane and at which |Q|). A bump counts only if it is a powder ring, rising in nearly every direction over the sphere (shells_judged); the others are the crystal's own scattering, which the removal must leave and subtracts nothing from (per_plane marks them ring: false, out of its worst_ring_dent and worst_ring_left). Lower ring energy bought by over-subtracting (negatives or ring dents rising) is worse, not better.
```

### punch

```text
Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis: diffuse maxima such as short-range order, which are the signal, not peaks to punch). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.
```

### backfill

```text
Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small (no bright plugs where peaks were), checkerboard_fraction near 0.5 (near 1 is a periodic interpolation artefact).
```

### flatten

```text
Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: max_floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and max_floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself. A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ: a rising one wants flattenQ2 and a fit range reaching the coverage (flattenFitQMax), not a free-form estimator, which also removes isotropic pair correlations.
```

### pdf

```text
The ΔPDF must show features above noise (feature_snr) with the transform's reach inside the measured coverage: window_weight_on_unmeasured, the share of the window's weight on unmeasured reciprocal space, must stay at or below 1e-3, where the backend's own window keeps it (a trial past it is not a candidate). A window that reaches further raises feature_snr with the backfill's guesses and the box's empty corners, which is worse, not better. max_symmetry_break is the x–y section's largest RMS difference from its image under the cell's in-plane operations (worst_symmetry_op names it): a trial that raises it far above your settings' value broke a symmetry your settings kept, as a separable window does on a hexagonal cell. back_fft_pearson_r_even, the round trip against the data's even part under Q → −Q (what the real transform keeps), must stay near 1; back_fft_pearson_r against the data is lower by the odd part (back_fft_odd_share, counting noise on unsymmetrised data). Without a band or crop the round trip is the identity, so neither can rank trials: back_fft_pearson_r_even below ~0.999 only flags a transform problem. Apodization trades real-space resolution against truncation ripples; prefer the default unless another is clearly better on feature_snr without the reach leaving the coverage.
```

## CRITERIA (report/report.ts): the rule behind each verdict, in assess_stage's result as criterion

### rings

```text
No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.
```

### punch

```text
No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.
```

### grains

```text
One grain, its UB right: no rotation of the Bragg lattice indexes the off-lattice peaks better than random directions do, and fewer than half of the strongest sit beside Bragg nodes, where a UB that is off puts the crystal's own peaks.
```

### backfill

```text
The fills meet their surroundings: a median seam of 1σ or less, and no cut whose fill is biased one way.
```

### flatten

```text
No pedestal: a floor trend and a span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level.
```

### pdf

```text
The back-FFT reproduces what the transform keeps, the data's even part under Q → −Q, to an r of 0.999 or more (a check recorded without that comparison: r against the data, judged only on data the file declares symmetrised, where the two are the same); at most 1e-3 of the window's weight on unmeasured space; and the declared symmetry kept.
```

## VERDICT_LABEL (report/report.ts): how a verdict reads in the tools' results

### pass

```text
meets its goal
```

### attention

```text
needs attention
```

### info

```text
not judged
```

## NAMED_REFERENCES (references.ts): the references the app fills besides a tool's fields

### achieved

```text
the computed verdict on the whole run: met, not met (and what needs attention) or not judged, with the data's problems no setting fixes
```

## NOT_DECLARED (report/report.ts): the symmetry verdict on a volume that declares none, for an asymmetry of 0.02

### NOT_DECLARED(0.02)

```text
not judged: the file declares no symmetry, so the section's asymmetry (0.02) is the data's own, counting noise included, not a break by a stage
```
