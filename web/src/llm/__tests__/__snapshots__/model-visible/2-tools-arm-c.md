# Tool definitions with the skills off (validation arm C)

`toolSpecs(toolsWithSkills(CHAT_TOOLS, false))`: what arm C's model is offered with every request (23 tools, 21277 characters as JSON). A tool whose description names a skill or restates a skill's step has its text with the skills off (`descriptionWithoutSkills`), shown in full; every other definition is arm B's.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## Not offered

read_skill: it works only with the skills on (its facts' `needsSkills`).

## As in arm B (2-tools.md)

21 tools, their definitions as 2-tools.md has them: describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, grain_check, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, configure_settings, update_settings, run_pipeline, tune_pipeline, show_in_viewer.

## dpdf_peaks: its description with the skills off

```text
The 3D-ΔPDF's strongest features, read from the whole volume rather than one section: its local extrema above min_sigma (default 5) robust σ of the volume outside the origin's disk, each with its vector in Å along a, b, c and in lattice units, its sign (+: more pairs at that vector than the average structure has, −: fewer) and its size in σ. The ΔPDF is centrosymmetric, so each ± pair is listed once. Extrema of one sign, length and size are one entry (n_vectors): copies of one correlation under the crystal's symmetry, most likely, though the grouping does not use the symmetry and two correlations can share a length. Use it for the strongest pair correlations with their vectors and signs. What size is worth interpreting, and what a feature means, is the user's call. Quote the vectors, signs and sizes it returns.
```

Its parameters are as in 2-tools.md.

## ub_check: its description with the skills off

```text
Is the volume's UB right? On the raw volume it finds each Bragg node's peak (the punch cell gives the Bragg nodes: (2, 2, 2) on a doubled cell), measures its centre, and fits the UB that puts the centres back on their nodes, from low |Q| outward. A volume symmetrised under the operations it declares hides a misorientation as rings around the nodes, not shifts, so there it fits only the changes that commute with the operations (fit 'symmetric': for 6/mmm the scales of the hk plane and of l); otherwise the rotation and the cell together ('both'). radial is the peaks' median offset along Q from their nodes, relative to |Q|, per |Q| band and direction, before and after the fit. mean_offset_rlu is the peaks' mean offset from their nodes in r.l.u., before and after the fit: a UB error averages out over the nodes and the fit removes it, while a shifted HKL origin moves every peak by one vector that stays after the fit (origin_shift_rlu, when that vector makes most of the offset the fit leaves). About ten seconds on a full volume. Quote rms_start → rms, the cell before and after, the angle, what radial shows, and an origin shift when it gives one.
```

Its parameters are as in 2-tools.md.
