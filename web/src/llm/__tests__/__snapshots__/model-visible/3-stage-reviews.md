# Stage-review prompts

`buildStageReviewMessages(context, stage, null, { tools })`: the one-click reviews. Their system prompt and context message are the chat's (1-chat-arm-b.md, 1-chat-tools-off.md); the acknowledgement and the instruction follow.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## The assistant's acknowledgement

Tools on:

```text
Understood. I will assess the requested stage from the metrics above, checking other cuts with the tools.
```

Tools off:

```text
Understood. I will assess the requested stage using only the metrics above and any attached image.
```

## rings

Tools on:

```text
Assess the Al/powder ring removal for this cut. Using ring_removal, judge how completely the rings were subtracted and whether the subtraction over-shot into negative (over-subtracted) territory. If an image is attached, note any residual rings or dark halos. State the optimal display contrast to inspect it. Give a short verdict and one concrete suggestion if it can be improved. Before your verdict, look beyond this cut with assess_stage rings and radial_profile, and show the most telling cut in the viewer.
```

Tools off:

```text
Assess the Al/powder ring removal for this cut. Using ring_removal, judge how completely the rings were subtracted and whether the subtraction over-shot into negative (over-subtracted) territory. If an image is attached, note any residual rings or dark halos. State the optimal display contrast to inspect it. Give a short verdict and one concrete suggestion if it can be improved.
```

## punch

Tools on:

```text
Review the Bragg punch. From bragg_punch.leftover, say whether sharp peaks were left unpunched: missed lattice peaks (at_node) are a punch failure, off-lattice ones are satellites or spurious peaks; quote their hkl and σ, or confirm none survived. Then characterise the peak profile from bragg_punch.peak_profile (resolution-limited fraction, measured widths, anisotropy) and comment on whether the punch footprint looks appropriate. End with a verdict and any suggestion. Before your verdict, look beyond this cut with assess_stage punch and an off-zero cut, and show the most telling cut in the viewer.
```

Tools off:

```text
Review the Bragg punch. From bragg_punch.leftover, say whether sharp peaks were left unpunched: missed lattice peaks (at_node) are a punch failure, off-lattice ones are satellites or spurious peaks; quote their hkl and σ, or confirm none survived. Then characterise the peak profile from bragg_punch.peak_profile (resolution-limited fraction, measured widths, anisotropy) and comment on whether the punch footprint looks appropriate. End with a verdict and any suggestion.
```

## backfill

Tools on:

```text
Judge the backfill quality from the backfill metrics. Is the fill seamless (median_seam_sigma), are there bright residual plugs (bright_fill_fraction), and is there any strange periodic/checkerboard pattern (checkerboard_fraction)? If an image is attached, describe the filled regions. Give a verdict and a suggestion if warranted. Before your verdict, look beyond this cut with assess_stage backfill and texture_check, and show the most telling cut in the viewer.
```

Tools off:

```text
Judge the backfill quality from the backfill metrics. Is the fill seamless (median_seam_sigma), are there bright residual plugs (bright_fill_fraction), and is there any strange periodic/checkerboard pattern (checkerboard_fraction)? If an image is attached, describe the filled regions. Give a verdict and a suggestion if warranted.
```

## flatten

Tools on:

```text
Judge the radial flatten from the flatten metrics. Is the shell floor near zero and level across |Q| after the flatten (floor_after, floor_trend, floor_span_fraction), or is there a leftover trend or an over-subtraction? How much pedestal was removed (removed_fraction)? Give a verdict and a suggestion if warranted. Before your verdict, look beyond this cut with assess_stage flatten and radial_profile, and show the most telling cut in the viewer.
```

Tools off:

```text
Judge the radial flatten from the flatten metrics. Is the shell floor near zero and level across |Q| after the flatten (floor_after, floor_trend, floor_span_fraction), or is there a leftover trend or an over-subtraction? How much pedestal was removed (removed_fraction)? Give a verdict and a suggestion if warranted.
```

## dpdf

Tools on:

```text
Analyse the 3D-ΔPDF features from delta_pdf. Are there features clearly stronger than the background noise (feature_snr, strong_feature_fraction)? Are the correlations anisotropic, and along what direction (anisotropy_ratio, anisotropy_angle_deg)? What is the trend with distance (radial_trend), and what does the back-FFT round trip say (the ΔPDF's verdict judges it against the data's even part under Q → −Q, to an r of 0.999 or more; consistency_pearson_r is against the data)? If an image is attached, describe the pattern you see. Summarise the correlation picture in a few sentences. Before your verdict, look beyond this cut with assess_stage pdf and qmax_coverage, and show the most telling cut in the viewer.
```

Tools off:

```text
Analyse the 3D-ΔPDF features from delta_pdf. Are there features clearly stronger than the background noise (feature_snr, strong_feature_fraction)? Are the correlations anisotropic, and along what direction (anisotropy_ratio, anisotropy_angle_deg)? What is the trend with distance (radial_trend), and what does the back-FFT round trip say (the ΔPDF's verdict judges it against the data's even part under Q → −Q, to an r of 0.999 or more; consistency_pearson_r is against the data)? If an image is attached, describe the pattern you see. Summarise the correlation picture in a few sentences.
```
