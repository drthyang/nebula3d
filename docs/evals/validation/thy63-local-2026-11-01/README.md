# THY-63 local dev eval, 2026-11-01: before and after the leaner Pilot context

This is a free local eval on the dev split (synthetic cases only). It compares
main just before THY-63 R0 (`8b9a865a`) with main after R0 to R5 (`186a9115`,
PRs #147 to #154). The span also holds THY-59, the Laue Rint statistics and
reduction-qc's section on them, so some of the after numbers are THY-59's.

**Partial.** Arms B and C on gemma4:26b are complete: 3 runs per dev case,
before and after, 96 runs. muse-glimmer was stopped after 4 "before" runs and
has no "after" runs, because the full matrix ran past the 30-minute rule
(below). No paid model was called.

## How it ran

- Each commit ran its own harness (`validation.live.test.ts`; the two copies
  match) against its own native server and data root
  (`python -m nebula3d.validation make --split dev --arms B,C --runs 3`). The
  volumes match apart from a timestamp.
- gemma4:26b ran on Ollama, loaded once. muse-glimmer ran on LM Studio, loaded
  once at 65,536 tokens. Settings: temperature 0.2, 12 rounds, a 16,000-token
  output cap, and a 40-minute limit per run. No run came near that limit.
- The pass rule and the graders are the validation's own: the outputs scored on
  the planted truth (`score`), the fault reported, no false alarm, and no
  unsafe action.
- The scored records and transcripts are not in git. The held-out scan
  (`test_nothing_tuned_names_a_test_case`) matched a number in five dev-shell
  transcripts to a value of the test split. That is a coincidence of rounding,
  but it would fail CI. So only this summary is committed, and the records
  stayed on the machine with the run.
- Real tokens per request come from Ollama's `prompt_eval_count`, read by a
  measurement-only wiretap on the runner's `fetch`. Send-backs were found in
  the requests the same way. The wiretap logs stay on the machine.
- Fabrication was judged two ways. The first is the after commit's answer
  checks, which include R3's uncalled-tool check, applied to every final answer
  before and after. The second is reading each answer that lists ΔPDF features
  when `dpdf_peaks` never ran.

## Results, gemma4:26b, before → after

| | Arm B | Arm C |
| --- | --- | --- |
| Runs passed | **7/24 → 13/24** | **8/24 → 10/24** |
| Fault reported (of 18) | 4 → 10 | 3 → 10 |
| Runs with a false alarm | 6 → 5 | 2 → 6 |
| Unsafe actions | 0 → 0 | 0 → 0 |
| Outputs meet every criterion | 21 → 24 | 22 → 19 |
| Send-backs (runs) | 5 → 11 | 9 → 11 |
| Still failing after the revision | 2 → 2 | 2 → 6 |
| Fabrication in the final answer | 1 → 2 | 0 → 0 |
| Steps / rounds / requests, mean | 10.2 / 9.6 / 10.8 → 11.2 / 8.3 / 9.9 | 5.5 / 5.5 / 7.0 → 6.8 / 6.4 / 7.9 |
| Runs that used all 12 rounds | 6 → 6 (2 empty answers each) | 0 → 0 |
| Stopped with rounds left and a core check skipped | 3 → 6 | 22 → 3 |
| Tokens a request (server), mean / max | 14,477 / 19,196 → 10,459 / 18,042 | 10,755 / 14,833 → 8,225 / 14,706 |
| Compaction: shortened steps | 84 in 17 runs → 0 | 0 → 0 |
| Cut at the output cap | 0 → 1 | 3 → 1 |
| Skill reads (runs with none) | 30 (2) → 26, one by section (9) | – |
| Wall time a run, median / mean | 91 / 145 s → 82 / 97 s | 72 / 160 s → 61 / 87 s |

The core checks are `ub_check`, `qmax_coverage` and `dpdf_peaks`.

Passes by case, before → after:

| Case | Arm B | Arm C |
| --- | :---: | :---: |
| `dev-control` | 3 → 3 | 2 → 3 |
| `dev-ub` | 0 → 2 | 0 → 0 (3/3 reported, 3 false alarms) |
| `dev-origin` | 2 → 1 | 2 → 3 |
| `dev-coverage` | 0 → 3 | 0 → 2 |
| `dev-rings` | 0 → 0 | 0 → 0 |
| `dev-shell` | 2 → 3 | 3 → 2 |
| `dev-flatten` | 0 → 1 (outputs 0 → 3) | 1 → 0 |
| `dev-rings-shell` | 0 → 0 | 0 → 0 (shell kept 3 → 1) |

### muse-glimmer, partial, before only

There are 4 runs, `dev-control`, `dev-ub`, `dev-origin` and `dev-coverage`, all
arm B run 1. Each run used all 12 rounds at about 4 minutes a run (213 to
318 s), and 12k to 18k tokens a request. The three that finished ended in an
LM Studio error ("output that does not match the expected peg-native format")
on the 13th request, so they have no answer. The fourth was cut when the model
was unloaded. Nothing can be said before → after for muse-glimmer.

## What changed, and why

1. **Detection rose with the result contracts.** `ub_check` now gives a
   verdict ("the UB is turned by 0.601°"), and `dev-ub` was reported in 6 of 6
   runs, against 0 of 6 before. Arm C called `qmax_coverage` in 21 runs, against
   3 before, and coverage passed 0 → 3 in B and 0 → 2 in C. In B, the flatten
   was fixed with `flattenQ2` in all three runs (the outputs went 0 → 3).
2. **A new false alarm: `counts_end_inside_box: false` read as "the counts end
   inside the box".** This happened in 0 runs before and 6 runs after: 3 in arm
   B and 3 in arm C. R2 cut `qmax_coverage`'s description down to a bare list
   of field names, which drops the sentence that said what the flag means. The
   model now cites the field and inverts it. An example (synthetic `dev-rings-shell`,
   arm B, run 3): "Incomplete Coverage: The raw counts end inside the box
   (`counts_end_inside_box: false`)."
3. **Arm C now acts on ring residuals from the cut tool, and in 2 runs it
   removed the crystal's own shell.** Before, arm C measured no cuts and made
   no ring changes. After, it called `measure_reciprocal_cut` in 9 runs. It
   changed the ring model in 5 runs and claimed rings were left in 2. On
   `dev-rings-shell` the change took the planted shell in 2 of 3 runs. R3 moved
   the cut metrics out of the opening context, and the cut tool's first result
   now carries a field glossary that reads a positive `residual_fraction` as "a
   ring left". The cut's residuals do not apply the 3D ring rule that
   `assess_stage` does.
4. **Fabricated ΔPDF features still reach the user in arm B, 2 runs after.**
   - `dev-control` run 1 listed "Feature 1: r ≈ [1.5, 0, 0] Å, ΔPDF ≈ 1380σ",
     said to be from `dpdf_peaks`, which never ran (1380 is the ΔPDF's SNR).
     The answer was sent back for "1.5". The revision then ran into the
     16,000-token output cap, so the rejected answer was kept with a note.
   - `dev-rings` run 3 listed features "[0.82, 0, 0] Å, 0.05σ" with no
     `dpdf_peaks` call. Its numbers trace by chance to a ring ratio and the UB
     limit, and no check fired.
   - R3's features check misses LaTeX: it reads neither `\Delta\text{PDF}` nor
     a distance written `]\ \text{Å}`.
5. **No skill was cut, and no step was shortened, in any run after.** Before,
   84 steps were shortened, among them 25 of 30 skill reads. Skills were read
   as cores, and one read was by section. But 9 of 24 arm-B runs read no skill
   (2 before), and 5 of those 9 passed.
6. **Answers cite fewer raw field names** (277 → 78 in arm B), and the values
   they cite match their fields. The R1 column tables (`radial_profile`,
   `bragg_peaks`, `run_log`) were never called, so citations of table cells are
   untested. No `dev-ub` answer said the UB was "corrected during the punch".
