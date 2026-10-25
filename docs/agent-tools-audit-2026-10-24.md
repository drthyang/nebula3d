# NEBULA Pilot: tool audit for planning (read-only, 2026-10-24)

**Scope.** The user's question: does the Pilot have the agent tools to measure the data before the workflow, and to check the result after it?
- **Code:** the frozen commit 812e686a, nothing built. Records: [evals/validation/](evals/validation/).
- **Transcripts:** dev only.
  - qwen: 4 dev runs on 3 cases, which include the 40-min timeout and the not-fresh re-run.
  - gemma: 8 dev runs, one per case.
  - A Sonnet dev diagnostic is staged, not run.
- **Method:** an inventory sweep of the tools (a subagent at low effort, on sonnet), tool-use counts by script ([evals/validation/live-2026-10-24.md](evals/validation/live-2026-10-24.md)), and the claims below verified in the code.

## The short answer
1. **The Pilot judges a run's outputs; it barely measures the data before the run.**
   - Before any run the model gets three things: `ub_check` (Bragg node positions only), `qmax_coverage` (where the counts end, and a suggested |Q| band), and `radial_profile` (shell medians, which ignore Bragg peaks by design).
   - Nothing measures the Bragg intensity level, the peak profile or the powder rings on the raw data.
2. **Much of what is missing is already computed and then dropped before the model.** This is the cheapest class of fix:
   - the learned Bragg profile (`footprint_profile`) and per-peak punch radii (`width_q`), in the punch record;
   - per-ring amplitude and FWHM, in the ring stage's diagnostics file, of which the API reads only `status`;
   - hole census, leakage outside holes and refill tests (`analysis/bragg_qa.py`), used by examples and tests only;
   - peak shape fits and resolution calibration (`analysis/peak_profile.py`), likewise;
   - the 3-D per-hole fill list, which `texture_check` summarises away;
   - the ΔPDF crop (`pdf_crop_*`), with no store field and no tool.
3. **After the run:**
   - Under-subtraction is covered (leftover peaks, on three planes or one cut).
   - Over-subtraction is weak: only `punched_fraction`, which has no reference and is not judged, and the 3-D fill bias.
   - The ΔPDF check reads only the back-FFT r, the window weight on unmeasured space and a *declared* symmetry. Nothing measures termination ripple, the origin region, Bragg residue at lattice vectors, or whether a feature's size is plausible.
4. **The models also leave tools unused.**
   - Gemma passed 1 of 8 dev cases, against arm A's 5 of 8. It reported the fault in 1 of 6 faulted cases, raised false alarms in 3, and skipped most checks: never `grain_check`, `radial_profile`, `consistency_details`, `dpdf_contrast` or `run_log`; `symmetry_check` and `texture_check` once each.
   - Several of its misses had the tool on hand: `qmax_coverage` was never called on dev-coverage, and the rings case showed confirmed rings that the answer called "no problems".
   - Neither model ever called `bragg_peaks`, the only per-peak intensity and width tool. It needs a punch first, and nothing points the model to it.
5. **A wording mismatch to fix with the tools:** the system prompt calls `median_measured_width_q` "the typical peak FWHM" (`prompts/system.ts:63`). It is n_sigma·σ (`pipeline.py:263`; default 2.5σ, about 1.06 × FWHM).

## Per capability
"Called" counts the runs in which the model called the tool: qwen out of 4 runs, gemma out of 8.

| Capability | (a) What exists today | (b) Called | (c) Gap |
|---|---|---|---|
| **Bragg intensity level, before the run** | `ub_check`: finds node peaks on raw and returns positions, offsets and the UB, no intensity (M+J). `line_profile` through a node by hand (M). After a punch only: `bragg_peaks` (intensity, local background, significance; ≤25 per call). | ub_check 4/4, 7/8; bragg_peaks 0, 0; line_profile 1/4, 0 | Nothing gives peak height over background, integrated intensity, the spread over \|Q\| or the dynamic range against the diffuse, before a punch |
| **Bragg peak profile, before the run** | Only after a punch: `bragg_peaks` widths, and the opening context's `peak_profile` medians. Not exposed: `footprint_profile` (template per \|Q\| bin and axis), per-peak `width_q`, and `peak_profile.py` shape fits. | bragg_peaks 0, 0 | No profile estimate before the punch (shape, width per axis against \|Q\|, resolution floor, tails). No comparison of punch radius with measured width. |
| **Powder rings, before the run** | Before: the scalar `before_ring_energy`, and `radial_profile` (about 0.28 Å⁻¹ shells against ring FWHM of 0.07–0.29). After ring removal: `ring_residuals` per plane (position, FWHM), and `assess_stage rings` with 3-D confirmation (it drops the FWHM). Not exposed: the diagnostics file's per-ring amplitude and FWHM. | radial_profile 4/4 (9 calls), 0/8; run_log 2/4, 0 | No raw-only ring finder giving position, width and amplitude with the 3-D isotropy test |
| **Q band and r band** | Q: `qmax_coverage` gives raw count edges, `suggested_band` and `band_check` (M+J). `pdfQMin` and `pdfQMax` can be read but not set (the user's). r: only the grid's extents and the excluded origin disk. The backend's ΔPDF crop has no field and no tool. | qmax_coverage 4/4, 7/8; consistency_details 2/4, 0 | No r-band recommendation (Δr from Qmax, an r_max past which the ΔPDF is ripple or noise). No signal-to-noise criterion for Qmin and Qmax beyond the coverage edges. |
| **Bragg over- or under-subtraction, after the run** | Leftover peaks: `assess_stage punch` and `measure_reciprocal_cut` (3 planes or one cut). `grain_check`. 3-D fill bias: `texture_check`. Backfill seams and `bright_fill_fraction`. Hole size: only `punched_fraction`, which isn't judged. | texture_check 4/4, 1/8; grain_check 4/4, 0/8; measure_reciprocal_cut 2/4, 5/8 | No hole radius against peak width per node, no Bragg tail leaking past the hole (`hole_rings` exists in Python), no per-hole outlier list, no volume-wide leftover scan |
| **Does the 3D-ΔPDF look right, after the run** | `consistency_details` (back-FFT). `symmetry_check`, judged only if the file declares a symmetry. `dpdf_peaks`, `measure_dpdf_cut` and `dpdf_contrast`, each sizing features against its own σ. `qmax_coverage` window weight. The origin is excluded everywhere. | dpdf_peaks 4/4, 6/8; symmetry_check 4/4, 1/8; dpdf_contrast 4/4, 0/8; measure_dpdf_cut 2/4, 1/8 | No ripple amplitude or period against Qmax and the window. No origin-region measure. No Bragg-residue test at lattice vectors. No plausibility reference (dev features read 800–2,250σ). No check against the shortest interatomic distance. One σ convention per tool. |

M = measures and returns values; J = only judges.

## What the dev transcripts show the model needed and didn't have
- **A reference for "is this ΔPDF feature real?"**
  - qwen called a 1,360σ feature "absurd" and spent 5 calls (`measure_dpdf_cut` ×2, `line_profile` ×3) trying to separate it from ripple, origin tail and Bragg residue.
  - Two numbers in its answer (270, 61) come from no tool.
  - Gemma quoted a 1,520σ feature with no such check.
- **Ring detail.**
  - qwen re-called `radial_profile` (32, then 16 bins) and `run_log` ×3 looking for per-ring numbers. It concluded "no powder rings" from identical median profiles.
  - Gemma read ring residuals as an ineffective ring stage, a guess.
  - On dev-rings-shell, gemma mixed raw bumps with post-removal residuals: the ring/non-ring status sits in another tool's output.
- **The UB's effect.** qwen wrote that a 0.6° turn "does not degrade the ΔPDF" with no measurement. Gemma called the same turn "successfully refined". Nothing measures what a turned UB does to the punch or the ΔPDF.
- **The rule's own limits.** Gemma cited a pedestal limit of 0.8 that no tool result prints (it's in `verdicts/rules.ts`).
- **Room to finish.**
  - Gemma's dev-flatten fixed the flatten, then ran out of rounds before measuring the repair (12-round cap, empty answer).
  - qwen's answers were cut at the 16k output cap in 2 of 3 runs, its thinking filling the cap.
  - These are limits, not missing tools, but they hit hardest when checking takes many calls.

## Model weakness or tool gap (provisional; Sonnet's dev runs will refine it)
- **Model or orchestration:** gemma's skipped checks, its uncalled `qmax_coverage` on the coverage case, its missed confirmed rings, and its invented ΔPDF features (no `dpdf_peaks` call on dev-ub). The tools existed and gave, or would have given, the answer.
- **Tool gaps:** a measurement before the workflow (Bragg level, profile, rings), the Q/r band decision, and a ΔPDF plausibility check (ripple, origin, Bragg residue). No tool exists to call for any of them.
- **Exposure gaps (computed, not shown):** the profile template, punch radii, ring amplitudes, hole leakage and census, and per-hole fills. These are the cheapest first steps.

*Caveats:* dev only, one run per case. qwen's 4 runs include a timeout and a run that was not fresh. Nothing is built; this is for the planning round.
