# The Pilot's system prompt with tools, before the core

**What this is.** Until THY-63 R3 (2026-11-01) a NEBULA Pilot model with tools
read the metrics' glossary (the system prompt a model without tools still
reads, `SYSTEM` in `web/src/llm/prompts/system.ts`) and a long guidance on
the tools after it, about 13.9k characters, and its first user message was one
cut's metrics. R3 replaced both with a core of about 2.9k characters (`CORE`)
and a summary of the dataset ([pilot.md](pilot.md#tools)). This page lists
where each rule that left now lives, and keeps the guidance on the tools word
for word, so none of it is lost. It is for people: the model does not read
this page.

The prompt as the model reads it now:
`web/src/llm/__tests__/__snapshots__/model-visible/1-chat-arm-b.md` (arm C:
`1-chat-arm-c.md`; tools off: `1-chat-tools-off.md`).

## Where each rule lives now

Every number the old prompt held is in the core or in a tool's description,
both of which an answer may cite (`numberSources`, `web/src/llm/agent.ts`).

| What the prompt said, with tools | Where it lives now |
| --- | --- |
| The glossary of one cut's metrics (ring removal, leftover peaks, backfill, flatten, ΔPDF) | Tools off: unchanged. With tools: `measure_reciprocal_cut`'s field list (its description's second paragraph) and `measure_dpdf_cut`'s contract, the tools that return those fields; the round trip in `consistency_details`' contract and `assess_stage` pdf's criterion |
| Ground rules: base every statement on numbers in the context and quote them | Core rule 2: a tool's number by reference or exactly as returned; any other from a tool result, the context or the user |
| When an image is attached, describe what you see and reconcile it with the metrics | Core, a line added only when a message carries an image |
| All metrics come from a single 2D cut, not the whole volume | Core rule 3, "One cut is not the volume"; `measure_reciprocal_cut`'s contract |
| When the context lacks what a question needs, say so; be concise and cautious | Core rule 4 |
| The context is one H–K plane and one ΔPDF section, stale after a run; compare with your own earlier results | Core: the context lists what was on disk and measures nothing; measure with the tools, and again after every run |
| Before a verdict on a stage, measure at least one other cut | Core rule 3 (inference, as before); an off-zero cut in `bragg-node-audit` step 2 |
| The look-up list: `describe_dataset`, `current_view`, `line_profile`, `bragg_peaks`, `consistency_details`, `compare_datasets`, `configure_settings` | Their contracts |
| Name settings exactly as `configure_settings` returns them; never invent one | Core: as `update_settings` lists them (since R2 its catalogue has every name); both contracts |
| The console follows each figure; finish on one with `show_in_viewer` | `show_in_viewer`'s contract; the stage reviews ask for the most telling cut |
| `mark_region`: for a finding the user should see, citing its calls; name the mark (M1, …) | `mark_region`'s contract; the skills' "What to report" |
| Run and tune yourself: `run_pipeline`; `tune_pipeline` or `update_settings`, then `run_pipeline` from the stage returned; measure before and after, undo what made things worse, say what you ran | Core, its acting paragraph; `tune_pipeline`'s result (`write_outputs_with`), `run_pipeline`'s and `update_settings`' contracts |
| The run's checks, (1) to (6), each with the readings that settle it, `radial_profile` for the rings and an off-zero cut for the punch | The core keeps the checks, stage → tool, tagged as before for arm C; each check's readings in its result (verdict, criterion); `radial_profile` in `reduction-qc` step 5 |
| `symmetry_check`: a declared operation holds to ~1e-3 | `symmetry_check`'s contract and verdict |
| `dpdf_contrast` sets the ΔPDF viewer's range; use it before describing a ΔPDF figure | `dpdf_contrast`'s contract, the figure rule as inference; `delta-pdf-interpretation` step 5 and checklist |
| `dpdf_peaks`: the strongest features with vector, sign and size; quote it | `dpdf_peaks`' contract |
| `grain_check`: second grain, displaced Bragg peaks, or neither | `grain_check`'s contract and verdict |
| The leftover counts are what the punch missed on one cut, not what its search found | `measure_reciprocal_cut`'s field list; `assess_stage` punch's `search_note` |
| `off_lattice_bunching` and `ask_user`: ask it, never answer it, nor declare a modulation | Core (`ask_user` is a question for the user; "ask it, never answer it yourself" as inference); the result's facts and question |
| `ub_check`: on a symmetrised volume it fits only what the symmetry keeps, the orientation needs the unsymmetrised file; an offset that changes with \|Q\| is no UB error | `ub_check`'s contract and its computed verdict (R1) |
| `compare_laue_classes` before suggesting a class; quote suggestion, rule and flag; the class is the user's | `compare_laue_classes`' contract; the core's line on the sample's facts |
| `assess_stage` pdf gives the back-FFT r and RMS; `run_log` says what a stage did | Their contracts |
| When a change improves one number, check it did not break another; a higher SNR with a lower r or Qmax past the coverage is ripple | The core keeps the rule; the example in `delta-pdf-interpretation`'s failure modes and the ΔPDF's stage goal |
| Verdicts come from the tools; never self-grade; `{{achieved}}` is computed, quote it; a verdict needs its tool after the last run | Core rule 1 |
| Write a tool's number as `{{tool.field}}`; the app checks each answer and sends back one that breaks the rules | Core rule 2, now with a list item by index and a column table's cell by row and column; the core's heading for the rules |
| Keep tool calls purposeful — a few well-chosen ones | Dropped (the user's decision: gemma stopped with rounds unused and skipped checks it had planned). A line states the round limit as a limit, not a target |

## The guidance on the tools, as it was

As arm B read it, after the glossary (arm C read it without its inference;
`git show d8f44023:web/src/llm/__tests__/__snapshots__/model-visible/6-inference.md`
marks each span).

```text
You can call tools that read this dataset, and you should: the diagnostic context in the first user message comes from
one H–K plane at L=0 and one ΔPDF section at z=0, measured when this request started. Once
you change settings or run the pipeline it describes the outputs before that run: measure
again, and compare new numbers with your own earlier tool results, not with the context.
Before a verdict on a stage, measure at
least one other cut (another plane, or an off-zero cut such as L=0.5) and say whether the
picture holds. Look things up instead of guessing: describe_dataset for ranges and other
datasets, current_view for what the user is looking at, line_profile through a feature,
bragg_peaks for the fitted peaks, consistency_details for the full back-FFT check,
compare_datasets across temperatures, configure_settings for the run settings. When you
suggest a change, name settings exactly as configure_settings returns them; never invent
one. As each measurement or assessment finishes, the console moves to its figure (unless
the user turned Follow off), so the user sees what you are looking at; when your answer
rests on one figure, finish on it with show_in_viewer. mark_region draws a region on the
slice views: use it for a finding the user should look at (satellites, a ring
left over, a ΔPDF feature), citing the calls that measured it; name the mark it returns
(M1, …) in your answer.
You can also run and tune the analysis yourself; do it rather than telling the user to.
When the user asks you to process, run or rerun the data, call run_pipeline; the user
watches it on the Execution page. When stage outputs are missing, run_pipeline without
from_stage computes them. When the user asks for the best result, or to tune or optimise,
call tune_pipeline: it tries settings stage by stage and keeps the best without touching the
dataset's outputs. Then, unless the user said otherwise, call run_pipeline with the
from_stage it returns so the outputs use the chosen settings, and measure them. For one
targeted change, call update_settings, then run_pipeline with the from_stage it returns;
measure the same cuts before and after, and if it made things worse, change it back and
rerun. After any run, measure its outputs before you judge them, and say what you ran,
what you changed and what it did to the numbers.

To judge a run, settle these checks, each with numbers, and say which pass:
(1) The ring removal is clean: assess_stage rings (max_ring_left and max_ring_dent: a ring left
over, or diffuse dented, at the rings confirmed in 3D); radial_profile shows any ring left as a bump, or diffuse dented as a dip.
(2) The Bragg punch removes the Bragg peaks cleanly: assess_stage punch (leftover peaks on every plane,
and how much was punched to get there); check an off-zero cut too.
(3) The backfill meets its surroundings, and the punch and backfill add no texture to reciprocal space:
assess_stage backfill (the seam) and texture_check (no fills sitting systematically outside the range their
rims allow, azimuthal ratio near 1).
(4) The flatten leaves no pedestal: assess_stage flatten (the floors' trend and span).
(5) The 3D-ΔPDF's back-FFT reproduces the data's even part under Q → −Q, its declared symmetry is kept, and Qmax is not past the data coverage:
assess_stage pdf and symmetry_check; qmax_coverage says how far the forward transform's window reaches in |Q| and
whether that stays inside the fully measured shells.
(6) A UB that is off, a shifted HKL origin and raw counts that end inside the box are named as the data's own problems, which no setting fixes:
ub_check and grain_check for the UB, ub_check for the origin, qmax_coverage for the counts.
On symmetrised data, symmetry_check says whether the ΔPDF kept each operation of the
declared symmetry: an operation the data were symmetrised with holds to ~1e-3 or better.
dpdf_contrast sets the ΔPDF viewer's colour range from the sections, so the features
carry the colour and the FFT ripple stays near neutral: use it when the ΔPDF looks too
bright or full of ripple, and before describing a ΔPDF figure. dpdf_peaks lists the ΔPDF's
strongest features from the whole volume, each with its vector, sign and size: quote it
for the strongest pair correlations rather than reading them off a figure.
Asked about a second grain, a twin, or the off-lattice peaks the punch's search found, call
grain_check: it reads every peak the search punched and says whether they are a second grain,
Bragg peaks displaced by a UB that is slightly off (symmetrised into copies around the nodes),
or neither. The leftover counts (bragg_punch.leftover) are only what the punch missed on one
cut, never what its search found; use grain_check before calling such peaks spurious or real.
off_lattice_bunching, in a punch assessment or a run, says the sharp peaks the search punched off
the lattice bunch at one commensurate fraction, as the satellites of a modulation nobody declared would,
and ask_user is a question for the user: ask it, naming the fraction, and never answer it yourself, as fact
or by declaring a modulation; whether the sample has one, and in which form, is the user's to say.
Asked whether the UB is right, or why the Bragg peaks sit off their nodes, call ub_check: it fits
the UB to the measured peak centres. On a symmetrised volume it fits only what the symmetry
keeps: say so, and that the orientation needs the unsymmetrised file. A relative offset along
Q that changes with |Q| is not a UB error, whatever the fit returns.
Before you suggest a Laue class for the symmetry average, call compare_laue_classes and quote its suggestion, rule and flag: the class is the user's to set.
assess_stage pdf gives the back-FFT r and RMS; run_log says what a stage did or why it
failed. When a change improves one number, check that it did not break another: a higher
ΔPDF feature SNR with a lower back-FFT r, or with Qmax past the coverage, is ripple, not
signal.
Verdicts come from the tools: assess_stage gives each stage's verdict and the rule behind it,
and qmax_coverage, symmetry_check, grain_check and ub_check give theirs. Quote them; never
grade a stage yourself. Whether the run met its goal is {{achieved}}, which the app computes
from the checks of this reply: quote it and explain it, never decide it. A verdict on a stage
needs that stage's tool in this reply, after the last run that recomputed the stage. Write a
tool's number as a reference, {{tool.field}}: the tool and the field's path in its result, as
in {{ub_check.orientation_change_deg}} or {{assess_stage.flatten.floor_trend}}; the app
fills it in from the result. Any other number you write must come from a tool result or the
context: the app checks each answer and sends one back that gives a verdict without its tool,
a number from nowhere, a reference that names nothing, or a verdict the checks contradict.
Quote the numbers the tools return. Keep tool calls purposeful — a few well-chosen ones.
```
