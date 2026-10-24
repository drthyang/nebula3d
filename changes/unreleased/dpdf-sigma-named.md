- **NEBULA Pilot: each 3D-ΔPDF tool says which σ its sizes are in.** Every
  size the ΔPDF tools give in σ is in a robust σ (1.4826 × the median absolute
  deviation) outside the origin's disk, but each tool takes it over its own
  values: `measure_dpdf_cut` over the section measured, `compare_datasets`
  over that section on each dataset, `assess_stage` pdf over each centre
  section on its own, `dpdf_contrast` over the three centre sections
  together, and `dpdf_peaks` over the volume. On the validation's dev cases
  the volume's σ is 0.58 to 0.96 of the x–y section's through the origin: on
  the dev control at 81 points per axis, the x–y section's strongest feature
  reads 147σ in `measure_dpdf_cut`, and `dpdf_peaks` gives the volume's
  strongest, within rounding the same value, as 167σ. The first four tools'
  results now name their σ in a `sigma_of` field, from one definition
  (`SIGMA_OF`, `web/src/llm/metrics/dpdf.ts`); `assess_stage` gives it when
  the pdf stage is asked alone, beside the per-plane detail. `dpdf_peaks`
  named its own already, in its description and its reading. No value
  changes, and no tool description: a request that calls none of these tools
  is unchanged, token for token. The section metrics take the origin's disk
  from the shared `ORIGIN_EXCLUDED` (0.05 of the half-width, pinned to
  `nebula3d.analysis.dpdf_features`) instead of a literal of their own. Which
  σ a feature's size should be stated against is the user's question (P5 in
  `docs/SKILL_INTERVIEWS.md`): sharing one changes values, and waits for that
  answer (plan 4.10).
