# NEBULA Pilot: review of its tools and skills

What each tool computes, whether a test checks it against a known answer, and
where it falls short; then the same for the three skills. Written before the
validation's model runs ([evals.md](evals.md#does-the-pilot-help-validation-on-synthetic-cases)),
from the code, the tests, and a sweep that ran every tool on the eight dev
cases, whose faults are known by construction (the test split was not read).

"Known answer" means a test whose expected value is put in by construction, not
read back from the code: a constructed field, a rotation, a fault of known size.
A test that mocks the API and checks the wiring is not one.

## Tools

| Tool | What it computes | Known-answer test | Gaps |
| --- | --- | --- | --- |
| `read_skill` | Returns a skill, or a document it cites, and records the skill as read | Parsing, references, sections; the gate refuses a stage's change until its skill is read (`skills.test.ts`) | None found |
| `describe_dataset` | Stages on disk, grids and ranges, cell, σ provenance, the other datasets | Wiring and the σ note (`tools.test.ts`) | Lists every dataset the server has: a validation run sees only its own |
| `current_view` | The page and cuts the user has open | None | Untested; no science in it |
| `measure_reciprocal_cut` | Ring, leftover-peak, backfill and flatten metrics on any cut | The metric modules, on constructed slices (`metrics.test.ts`); the tool checks cut range | The same metrics as `assess_stage`, one cut at a time |
| `measure_dpdf_cut` | Feature SNR, anisotropy, radial trend of a ΔPDF section | The metric, on a directional pattern; the tool itself is untested | No feature positions or signs (see below) |
| `assess_stage` | Each stage's evaluation on three planes, and a verdict by the report's rule | Rule and headline per stage with fixed inputs (`tools`, `evaluate`, `report` tests); the replay of recorded results against injected faults (`heldout.test.ts`) | The flatten and ΔPDF verdicts read "needs attention" on all eight dev cases, the clean control included (findings 3, 5, 6) |
| `radial_profile` | Shell medians of every stage side by side | Layout only; the shell statistics on constructed fields | None found |
| `texture_check` | Fill bias against the rim, in rim σ, and azimuthal texture | Constructed fills, biased and not (`texture.test.ts`) | Flags all three cuts of the clean control (finding 4) |
| `qmax_coverage` | The window's weight on unmeasured space (recorded by the run), shell coverage, where the raw counts begin and end, a suggested band | Constructed coverage (`coverage.test.ts`, `test_coverage.py`); replay on a volume cut at 4.511 Å⁻¹. The sweep read 4.507 on the dev cut at 4.511 | Says "clean" with counts ending well inside the box (finding 7) |
| `symmetry_check` | A ΔPDF section against its images under the cell's in-plane operations | Symmetric and broken constructed sections | **Fixed:** called an asymmetry a break on a file that declares no symmetry (below) |
| `dpdf_contrast` | The viewer's colour limit from the three centre sections | Constructed ripple, origin peak and features | No physics to check; it changes the viewer only |
| `grain_check` | Groups off-lattice peaks into orbits; tests them against the nodes and as a rotated lattice | A second grain and its angle, a UB 0.9° off, random directions (`grains.test.ts`) | None found |
| `ub_check` | Fits the UB to the Bragg nodes' centres; the offsets by \|Q\| band and direction | Fit of a known rotation and cell (`test_ub_refine.py`); a 0.5° rotation (`test_faults.py`); replay, 0.602° for 0.6°. The sweep read 0.601° for 0.6° | Reports an unexplained offset (origin shift) only as an RMS, not the shift (finding 2) |
| `line_profile` | A row or column through any stage, with its maximum | Row and column of a constructed slice | None found |
| `bragg_peaks` | The punch's fitted peaks, sorted | Sorting (`tools.test.ts`); the fit is tested in Python (`test_peak_profile.py`) | None found |
| `consistency_details` | The saved back-FFT check | None for the tool | Its r is limited by noise on unsymmetrised data (finding 3) |
| `run_log` | The last run's log lines | Line selection | None found |
| `compare_datasets` | One cut's metrics across datasets | None | Untested; a validation run is given one dataset |
| `configure_settings` | The Configure page's settings | None | Untested |
| `update_settings` | A checked change to the Configure page | Catalogue and range checks, sample facts only on request, skill gate | None found |
| `run_pipeline` | Runs the pipeline, follows its events over SSE | Mocked store; Python tests of the pipeline | **Fixed:** never ran end to end from the evals (they stub it) and Node has no EventSource; the validation installs one and ran a real pipeline through it |
| `tune_pipeline` | Per-stage trials in a tuning folder, the best by the stage's goal | Mocked tuner; `test_tuning_runs.py`: `processed/` stays byte-identical | None found |
| `show_in_viewer` | Moves the console to a cut | The stores move | None found |

What the sweep read on the dev cases, against what was put in: the UB turn
0.601° (0.6°); the counts' upper edge 4.507 Å⁻¹ (4.511) with the band 0–4.5;
the two powder rings confirmed at 2.17 and 4.02 Å⁻¹ (2.2 and 4.05; a shell is
0.03 wide) and the crystal's own shells at 1.71, 1.81, 3.16 and 4.59 Å⁻¹ left
alone; the shifted origin as an offset RMS of 0.0583 Å⁻¹ that the fit does not
reduce; the planted |Q|² background as a flatten trend of 0.84 with a span of
0.84, against 0.52 and 1.2 on the control. On the control the ring, punch and
backfill verdicts, the UB, the coverage and the grain check found nothing; the
flatten and ΔPDF verdicts and the texture check did (findings 3, 4 and 6).

## Skills

All three are drafts awaiting the user's interview; nothing below changes them.

| | Decisions tied to a tool output | Criteria | Contradictions and gaps |
| --- | --- | --- | --- |
| `reduction-qc` | The UB, coverage and band, rings, flatten and symmetry steps each name their tool and the fields to read (`shells_judged`, `raw_counts`, `suggested_band`, `floor_trend`) | The ring rule (0.15 of the height in 90 % of directions), the 1e-3 window weight and the 0.8/0.8 pedestal rule are stated, with the first marked "to confirm". How large a UB offset is acceptable is left open | Step 6 says a rising floor wants the Q² term but not when to turn it on: no criterion, no tool field (finding 5). It names `floor_trend`; the stage-level fields are `max_floor_trend` and `max_floor_span_fraction` |
| `bragg-node-audit` | Leftovers, off-lattice peaks, backfill each name their tool. Forbidden nodes, λ/2 and multiple scattering are decided from `line_profile` and `show_in_viewer` and the user's evidence list | Broad maxima stay (width limit); a rotation under 2° is the UB. "Clearly above the background" is left to the user | Step 7 reads a fill bias near 0σ with half the holes brighter as clean, and the demo's diffuse peaks at every node, so a correct fill sits above its rim (finding 4) |
| `delta-pdf-interpretation` | Trust checks 1 to 5 each name their tool. The interpretation steps (vector, sign, size, symmetry, artifacts) have no tool that lists features | 1e-3 window weight, symmetry 1e-3; the feature size below which nothing is interpreted is left to the user | Step 3 asks for each feature's vector and size and no tool finds them (finding 1). Check 4 says an r near 1 is no evidence, while `assess_stage` fails the ΔPDF below r = 0.999 (finding 3). Its synthetic example (negative at ⟨½ ½ 0⟩a, positive at ⟨1 ½ ½⟩a and ⟨2 0 0⟩a) matches `nebula3d.demo` |

No skill contradicts another. The skills' firm rules (the gate, the 1e-3 window
limit, tuning never writing to `processed/`) are enforced in code and tested.

## Fixed now

- **A symmetry the file never declared was called a break.** `symmetry_check`
  and `assess_stage` for the ΔPDF said "not kept: mirror ⊥ a (0.035)" on every
  one of the eight dev volumes, none of which declares a symmetry: unsymmetrised
  data differ from their images by their own counting noise. The criterion's own
  wording is "the declared symmetry kept". Now a file that declares none is "not
  judged", with the asymmetry still reported; a declared symmetry is judged as
  before. Tests: `tools.test.ts`, `evaluate.test.ts`.
- **"Does the flatten want its Q² term?" had no stated answer.** The skill points
  at a pedestal and the tool gave two numbers to combine. `assess_stage` for the
  flatten now says `pedestal_left` (the report's own rule, one function), and its
  headline ends "pedestal left" or "no pedestal". On the dev cases it is true
  for the planted background and, wrongly, for the cut-coverage case (finding 8),
  and false for the other six; with the term on, the planted case reads false.
  The verdict itself is unchanged. Tests: `metrics.test.ts`, `evaluate.test.ts`.
- **The validation's own leaks and gaps** (`validation.ts`): the data were named
  after the case, which told a model the fault and the split, and every run saw
  the other cases' datasets; they now carry opaque labels and a run sees its own
  dataset alone. The answer graders charged a run with a fault for a tool's
  report or its own action, and a caveat after a semicolon cancelled a claim;
  they read clauses and charge only a statement that the fault is there.

## Findings left for the user

In the schema of [evals.md](evals.md#findings), with their evidence, in
[evals/validation/review-findings.json](evals/validation/review-findings.json),
checked by a test.

1. **Missing tool: the ΔPDF's strongest features.** The task and the
   interpretation skill ask for each feature's vector and sign, and no tool lists
   them; `dpdf_contrast` gives the strongest feature in σ without its place. A
   `dpdf_peaks` tool would list extrema above a few robust σ outside the
   origin's disk, with the vector in Å and r.l.u., the sign and the size.
2. **Missing tool: the origin's shift.** `ub_check` reads a shifted origin as an
   offset RMS the fit does not reduce, and says to look at the origin. It has the
   peaks' centres: it could report the mean offset in r.l.u., a vector, which is
   what a report on the origin needs.
3. **Science: the round-trip r on unsymmetrised data.** `assess_stage` fails a
   ΔPDF below r = 0.999. The transform keeps the real part, which is the part of
   the data even under Q → −Q, so on unsymmetrised noisy data r measures the
   share of noise in the odd part: 0.989 on the dev control, 0.989 to 0.996 on
   all eight, and 1.0 on the same control averaged with its inversion. Either
   compare with the even part, or judge r only on symmetrised volumes.
4. **Science: `texture_check` on a clean control.** All three cuts are flagged
   (median fill 0.57 to 1.34 rim σ, 88 to 96 % of the holes above the rim).
   The bias is in rim σ, which shrinks with the counts, with no floor in units
   of the diffuse level, and the diffuse peaks at the nodes (TDS), so a fill
   above its rim is expected.
5. **Skill: when to turn on flattenQ2.** Suggested for `reduction-qc` step 6:
   turn it on when `assess_stage` for the flatten says a pedestal is left, then
   rerun and read it again. On volumes without such a background the term is not
   free: it raised the pedestal span from 0.025 to 0.066 to 0.107 here, under
   the 0.25 limit.
6. **Science: the flatten's "floor above 1σ".** Floors read 1.5 to 1.8 σ on all
   eight dev volumes, after the Q² term too, so the flatten never meets its goal
   on them whatever it did; the pedestal rule, not this clause, separates them.
   The clause is the user's to keep or change.
7. **Orchestration: "clean" beside counts that end inside the box.** On the dev
   cut the window's weight is 9.8e-4, under the 1e-3 limit, so `qmax_coverage`
   opens "clean"; the counts end at 4.507 Å⁻¹ of a 6.44 Å⁻¹ box, which is in
   `raw_counts` and `suggested_band` and not in the verdict. A model that quotes
   the verdict omits it. The verdict or `band_check` could say it.
8. **Science: the pedestal rule on a cut volume.** On the dev cut-coverage case
   the flatten reads a falling floor (trend −0.82, span 1.19) and so "pedestal
   left", where the planted truth has none (the default run's pedestal span is
   0.015 of the diffuse level against the 0.25 limit). The floors before the
   flatten cannot be measured there (`floor_before` is empty). The rule should
   judge only shells the counts reach.
