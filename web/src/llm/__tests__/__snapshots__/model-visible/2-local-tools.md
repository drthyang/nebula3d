# Tools offered to a local model

`toolsFor(question, CHAT_TOOLS)` (localTools.ts): a model on a local server is offered these with its first request; a tool it calls by name all the same runs and stays offered. Their definitions are in 2-tools.md.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## a generic question

> How clean is this reduction?

15 tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, ub_check, radial_profile, line_profile, bragg_peaks, run_log, configure_settings, show_in_viewer.

## a ΔPDF question

> What are the strongest pair correlations in the 3D-ΔPDF?

15 tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, line_profile, consistency_details, run_log, configure_settings, show_in_viewer.

## a flatten question

> Is there a background left after the flatten?

10 tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, assess_stage, radial_profile, line_profile, run_log, configure_settings, show_in_viewer.

## an action request

> Raise the punch significance to 6 and rerun the pipeline.

15 tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, assess_stage, grain_check, ub_check, line_profile, bragg_peaks, run_log, configure_settings, update_settings, run_pipeline, tune_pipeline, show_in_viewer.

## a regrid request

> Regrid the volume onto the refined UB.

13 tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, assess_stage, grain_check, ub_check, line_profile, bragg_peaks, run_log, configure_settings, regrid_refined_ub, show_in_viewer.
