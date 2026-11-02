# The Pilot's tools, in full

**What this is.** Until THY-63 R2 (2026-11-01) each NEBULA Pilot tool's
description held its method as well as its contract. R2 cut every description
to a contract of at most 500 characters (what it answers, its inputs, what it
returns, when to call it; `web/src/llm/__tests__/toolContracts.test.ts`), and
moved the method out. This page keeps the method text each description held
before R2, word for word, so none of it is lost. It is for people: the model
does not read this page. Where the model needs a piece of it, it belongs in a
tool's result (a verdict, a criterion), in a skill, or in an algorithm page a
skill cites (docs/algorithms/), which R4 (the skills' restructure) decides.

**Where R4 put it** (a skill's `## Details` is read on request with
`read_skill` and `section`; an algorithm page with `reference`):

- **qmax_coverage**, how the reach is judged without the ΔPDF's record (the
  band, the box faces, the coverage edge, the box corners) and that it comes
  from the Configure page's settings: reduction-qc, Details, "The coverage and
  the |Q| band".
- **symmetry_check**, the operations it tests (those that move c included; an
  operation and its product with the inversion one entry; none declared: the
  cell's in-plane ones, not judged): delta-pdf-interpretation, Details, "The
  trust checks"; reduction-qc, Details, "Symmetry kept".
- **grain_check**, that symmetrising a volume whose UB is slightly off makes
  the displaced copies: bragg-node-audit, Details, "Peaks off the lattice".
  The rest of its method was already in that skill's step 5 and its contract.
- **compare_laue_classes**, the R_int formula (Σ|I − ⟨I⟩| / Σ|I| over orbits
  measured twice or more): docs/algorithms/laue_compare.md, "R_int, read
  twice", now a reference of reduction-qc.

The other tools' method text stays here: their contracts and results carry
what the model needs.

The descriptions as the model reads them now:
`web/src/llm/__tests__/__snapshots__/model-visible/2-tools.md`.

## assess_stage

Judge a stage's output against its goal, on the three principal planes through the origin plus the records the stage writes — the evaluation the tuning run judges trials by. rings: ring-energy ratio and over-subtraction per plane; punch: leftover peaks, punched fraction, fitted peaks; backfill: seam σ and bright fills; flatten: shell floors in σ; pdf: back-FFT r and RMS, feature SNR per section. Returns the stage's goal with the numbers. stage=all gives each stage's headline numbers; one stage adds the per-plane detail. Use it for a verdict on a stage, after a run, and before and after a change.

## texture_check

Check whether the punch and backfill printed a pattern of their own into reciprocal space. Fill bias, over every punch hole in 3-D: each filled hole against the range its measured rim allows, from the diffuse at the hole's edge carried in to its rise toward the node continued linearly (the diffuse often peaks at the nodes, so a sound fill sits above its rim's median); the part outside that range, signed, in the rim's σ and in units of the local diffuse level, and the shares of holes above and below it, and beyond it by a fifth of the level or more (above_floor_fraction, below_floor_fraction). Holes filled systematically outside it (systematic_fill_bias: 75 % of them one way, a median of 0.5σ and a fifth of the level or more) add a lattice-periodic texture that the ΔPDF turns into features at lattice vectors. Azimuthal texture, on a cut (default: the three principal planes through the origin): per |Q| shell, how much the sector means vary around the shell after the backfill against before the punch (unpunched voxels); a ratio near 1 adds none.

## qmax_coverage

Check that the forward transform (data → 3D-ΔPDF) does not reach past the measured reciprocal space. When the ΔPDF on disk records it, the verdict is the share of its window's weight on unmeasured space (≲ 1e-3 is clean), with the window's shape and scale. Otherwise it compares how far the transform's window reaches (the |Q| band if one is set, else the box faces, the coverage edge when the window is tapered to the coverage, or the box corners when apodization is off with a separable window) with full_coverage_q, where the raw volume's |Q| shells, in 3D, stop holding counts (measured and non-zero) in 95 % of their voxels. With the window fitted to the coverage (pdfWindowSupport), that share and that reach are the backend's own target, not a check: the verdict judges where the counts end and the band instead. The reach comes from the Configure page's settings, which may differ from the ones that made the ΔPDF on disk. raw_counts gives where the counts begin and end in |Q| (beyond those edges most voxels hold no counts) and the box's nearest face; suggested_band is the |Q| band they allow, and band_check says whether a band that is set stays inside the counts. When the counts end inside the box and no band is set, the verdict says so, with the edge and the band they allow (counts_end_inside_box).

## symmetry_check

Check that the 3D-ΔPDF keeps the symmetry its data were declared symmetrised with (with none declared the asymmetry is the data's own and is not judged): the ΔPDF against its image under each operation of the declared point group, an operation and its product with the inversion one entry (equal on the centrosymmetric ΔPDF), those that move c included (none declared: the cell's in-plane ones), on the sections the operation maps onto sections (the x–y sections at z and −z, default z = 0, and the x–z and y–z sections through the origin), else on the voxels it maps from one onto another (tested_on says which; not_tested, any it cannot test), as the RMS of the difference over the RMS, the worst section's. A symmetry the data were symmetrised with holds to about 1e-3 or better when the pipeline kept it; a larger share means a stage broke it, or the sample lacks that operation. Which operations the sample has is the user's to say.

## dpdf_contrast

Optimise the 3D-ΔPDF viewer's colour range, so the pair-correlation features carry the colour and the FFT ripple around them stays dim. Call it once, without arguments: it measures the three centre sections (xy, xz, yz through the origin; the origin's self-correlation disk left out), sets the limit at the 99.9th percentile of |ΔPDF|, the page's Auto, and lists what the 99.5th and 99.97th percentiles would give without applying them. Pass percentile (99–99.99) or limit_sigma only for a range the user asks for: a limit of a few σ colours the ripple, as the old Auto (the 97th percentile) did. reset returns the viewer to Auto. Quote the applied limit it returns.

## dpdf_peaks

The 3D-ΔPDF's strongest features, read from the whole volume rather than one section: its local extrema above min_sigma (default 5) robust σ of the volume outside the origin's disk, each with its vector in Å along a, b, c and in lattice units, its sign (+: more pairs at that vector than the average structure has, −: fewer) and its size in σ. The ΔPDF is centrosymmetric, so each ± pair is listed once. Extrema of one sign, length and size are one entry (n_vectors): copies of one correlation under the crystal's symmetry, most likely, though the grouping does not use the symmetry and two correlations can share a length. Use it for the strongest pair correlations with their vectors and signs, after the trust checks (qmax_coverage, symmetry_check on symmetrised data, assess_stage pdf). What size is worth interpreting, and what a feature means, is the user's call (delta-pdf-interpretation). Quote the vectors, signs and sizes it returns.

Its result's `reading`, moved into the description in R2:

Each entry: |r|, the largest size in σ with its sign, how many vectors (one per ± pair) share them, and up to 4 of those vectors in lattice units (x/a, y/b, z/c) and in Å along a, b, c. The size is against the volume's robust σ outside the origin's disk; features nearer the origin than the shortest interatomic distance are not pair correlations.

## grain_check

Is there a second grain, and what are the sharp off-lattice peaks the punch's search found? It takes the punch's peak record, groups the off-lattice peaks into symmetry orbits (the declared point group), and tests the strongest two ways. Against the Bragg nodes: an orbit within a quarter of the node spacing of one is that peak displaced, and its offset over |Q| is a rotation angle (symmetrising data whose UB is slightly off makes such copies; the angle is a lower bound). As a rotated copy of the Bragg lattice: a second grain is one rotation that indexes most strong orbits, judged against the same search at random directions; a rotation under 2° is the UB, not a grain. Run the punch first. Quote its verdict and numbers.

## ub_check

Is the volume's UB right? On the raw volume it finds each Bragg node's peak (the punch cell gives the Bragg nodes: (2, 2, 2) on a doubled cell), measures its centre, and fits the UB that puts the centres back on their nodes, from low |Q| outward. A volume symmetrised under the operations it declares hides a misorientation as rings around the nodes, not shifts, so there it fits only the changes that commute with the operations (fit 'symmetric': for 6/mmm the scales of the hk plane and of l); otherwise the rotation and the cell together ('both'). radial is the peaks' median offset along Q from their nodes, relative to |Q|, per |Q| band and direction, before and after the fit: a UB error gives the same relative offset at every |Q| along a direction, so one that changes with |Q| is not a UB error, and refining the UB only averages it. mean_offset_rlu is the peaks' mean offset from their nodes in r.l.u., before and after the fit: a UB error averages out over the nodes and the fit removes it, while a shifted HKL origin moves every peak by one vector that stays after the fit (origin_shift_rlu, when that vector makes most of the offset the fit leaves). About ten seconds on a full volume. Quote rms_start → rms, the cell before and after, the angle, what radial shows, and an origin shift when it gives one.

## compare_laue_classes

Which Laue class does the sample have? Compares every Laue class the cell's metric allows (the UB under the symmetry average's 2% check) and whose operations map the grid, by R_int on the raw volume as the symmetry average reads it (the run's edge trim first): Σ|I − ⟨I⟩| / Σ|I| over the orbits measured twice or more, on every measured voxel and on the diffuse (the punch cell's Bragg nodes masked), each also over its noise floor, the R_int counting noise alone gives on the same orbits (x_noise). A class rises against a subgroup when its x_noise exceeds the subgroup's by more than 10% and two standard errors of the difference; suggestion is the supported class with the most operations in every reading that can tell the classes apart, none when even whole |Q| shells (no_symmetry) stay at the noise. flag says when the diffuse supports less than every measured voxel: averaging over the higher class would impose the Bragg peaks' symmetry on the diffuse. A volume symmetrized already is refused. Seconds to minutes. Cite its classes, rule and flag when you suggest a Laue class; the class is the user's to set, and update_settings refuses it.

## consistency_details

The run's saved back-FFT check in full: Pearson r and normalised RMS of the inverse-FFT ΔPDF against the cleaned data, r per principal plane, the |Q| and r bands, crop and apodization. The transform keeps the real part, which is the data's even part under Q → −Q: pearson_r_even compares the round trip with that part and is 1 when the transform is sound, while r against the data is limited by the odd part (odd_share: counting noise on unsymmetrised data), so r below 1 on unsymmetrised data is no fault. Neither says a feature is real.

## configure_settings

The Configure page's current settings — what the next run would use (blank = the backend default). They may differ from the settings that produced the files on disk. Name settings exactly as returned here when you suggest a change.

## update_settings

Change settings on the Configure page; the next run_pipeline uses them and the user sees the fields change. These method choices and thresholds can be changed: ringModel (pooled|global_v2|patched|parametric), ringPooledSectors (integer 8–144), ringPooledWindow (number 0.5–30), ringNFourier (integer 0–40), ringGlobalSubtraction (conservative|mean), punchMinSig (number 3–12), punchMode (both|integer|search), punchHGuard (number 0–0.3), punchSearchFloor (number 3–60), punchFootprint (own|profile|ellipsoid), punchProfileNSigma (number 0.1–3), punchSearchMaxWidth (number 1–6), punchMargin (number 0–0.5), punchFitUnconstrained (true|false), backfillMethod (laplace|local|q_shell), flattenQ2 (true|false), flattenFitQMax (number 3–25), flattenEstimator (model|floor|snip), pdfApod (gaussian|hann|none), pdfWindowShape (auto|separable|ellipsoid), pdfWindowSupport (true|false). These facts about the sample only when the user asks for that change, never to improve a result: modulation ({"k": "1/3, 0, 0", "order": 1, "form": "points|planes", "half_width": 0.08}, "none" or "default"; The sample's modulation: the off-lattice search leaves its satellites G ± m·k alone (form points, the default) or the planes through them (form planes), the form the user's to declare; k in r.l.u., several separated by ";", order m 1–6 (default 1), half_width in r.l.u. (default 0.08); "none" declares none, and so does "default", the backend's own.) punchSupercellH (integer 1–6; The punch's indexing cell along H: the Bragg nodes are the multiples of this H (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.) punchSupercellK (integer 1–6; The punch's indexing cell along K: the Bragg nodes are the multiples of this K (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.) punchSupercellL (integer 1–6; The punch's indexing cell along L: the Bragg nodes are the multiples of this L (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.) So too edgeTrim (0–3; Voxel layers taken off the raw input's coverage edge at load, whether or not the symmetry average is on (the NeXus Viewer's edge erosion): 0 to 3, default 1.) A change to one of them is refused unless the user's latest message names it. The magnetic ion and |Q| band stay with the user, and so does the symmetry average (symmetryAverageEnabled, symmetryLaue, symmetryReaverage, symmetryAllowMetricChange): suggest a Laue class with your evidence instead, for the user to set. Change them when the user asks for a change, or asks you to improve or tune the result, and only the settings the user named or agreed to; when unsure which setting the user means, ask instead of guessing. Settings already at the value are left as they are. Returns each change and the stage to rerun from.

## run_pipeline

Run the reduction pipeline on the selected dataset with the Configure page's settings, as the Run button does: it writes the dataset's stage outputs, and the console shows the run on its Execution page while it goes. Without from_stage, outputs that still follow from the current settings and inputs are reused (unless the user switched Force on), and the rest are recomputed. With from_stage, that stage and every enabled stage after it are recomputed: use it after update_settings. A run takes seconds to minutes. Returns how it ended, which stages were computed or reused, and the outputs that now exist; measure them afterwards.

## tune_pipeline

Search for the best settings, one stage at a time: for each stage it runs the current settings, has you propose alternatives, runs each, judges which best meets the stage's goal, keeps it and moves on, so later stages build on the best earlier ones. Trials run in a tuning folder: the dataset's own outputs are not changed, and the chosen settings end up on the Configure page. The user watches the trials in the chat, under this reply, and each run on the Execution page. Takes minutes (one run per trial). Returns every trial's changes and numbers (a trial that matched the current settings' numbers exactly is marked no_effect), and each stage's chosen trial and why: quote these, never numbers the result does not hold.

## regrid_refined_ub

Regrid the dataset's raw volume onto its refined UB, as a new dataset: the fit is ub_check's (the punch cell's Bragg nodes, q_max), and the volume resampled onto the refined UB is written as <stem>_regridded.nxs beside the raw file, never over a file. No pipeline is run. Only when the user's latest message asks for a regrid; otherwise refused. Nothing is written, and refusal gives code and reason, when the turn is under turn_threshold_deg, a symmetrised volume has no unsymmetrised source beside it, or the new file or dataset id exists. Returns the new dataset, the turn, the peaks' RMS before → after, and the measured voxels lost outside the old grid.

## mark_region

Mark a region in the console's slice views and move them to it, so the user sees what you found: use it for a finding they should look at, such as satellites at h ± q, a ring left over, or a ΔPDF feature. where: the stage whose output shows it: raw, rings, punch, backfill or flatten (reciprocal space; h, k, l in r.l.u.), or pdf (the 3D-ΔPDF; x, y, z in Å along a, b, c). shape: box or ellipsoid, with center and half_size (half-widths along the three axes), or points, with up to 12 positions. evidence: the calls in this conversation whose results show it, as tool or tool.field (dpdf_peaks.features.0). A region without evidence, empty, or outside the volume is not marked. The result says which views and cuts it was drawn on, cut to the volume. Cite the mark by its id (M1, …) in your answer.
