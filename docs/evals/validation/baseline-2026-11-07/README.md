# The frozen baseline of 2026-11-07 (THY-52)

The paid re-baseline of the NEBULA Pilot. It covers every model-visible change
since the frozen baseline of 2026-10-24 (`812e686a`): `mark_region`,
`compare_laue_classes`, THY-63's context redesign and its fixes, THY-74, THY-81
and the run-from refresh, THY-65/66. It was graded on the graders as fixed on
2026-11-07 (#174). It ran on the dev split only (synthetic). The test split
stays sealed: no model ran it. This is the **new frozen baseline**.

- **Code:** branch `eval/thy52-rebaseline`, from main `9c3e5084`, plus the
  runner's own changes (Haiku, the dev split for Claude, one $40 ledger,
  `NEBULA_VALIDATION_RUN_FROM`). None of them is model-visible.
- **Data:** `python -m nebula3d.validation make --split dev --arms B,C --runs 3`,
  served by the worktree's own native server.
- **Limits:** each sub-plan had at most 8 runs on gemma4:26b and at most 9 on
  Claude. Each was held to the 30-minute wall cap, 10 minutes a run (5 minutes
  for the quick preset, 8 for quick-auto) and 12 rounds. No sub-plan reached
  its wall cap. Two Sonnet runs reached their 10-minute limit (below).
- **Local runs:** gemma4:26b ran on Ollama at 32,768 tokens, loaded once, then
  unloaded. The 32k worst turn measures 26,207 tokens with the reply reserve
  (`scripts/measure_pilot_context.sh`), as on 11-02.

## What ran

| Arm | Model | Cases | Runs | Record |
| --- | --- | --- | ---: | --- |
| A (no model) | – | 8 dev | 3 each | `arm-a-dev.json` |
| B, quick preset | gemma4:26b | 8 dev | 1 each | `ollama-gemma4-26b-dev.json` |
| B-auto, quick-auto preset | gemma4:26b | 8 dev | 1 each | `ollama-gemma4-26b-dev-auto.json` |
| B and C | Claude Haiku 5.5 | 8 dev | 3 each (48) | `claude-haiku-5-5-dev.json` (stripped, below) |
| B-auto | Claude Haiku 5.5 | 8 dev | 1 each | `claude-haiku-5-5-dev-auto.json` |
| B and C, confirming Haiku's failures | Claude Sonnet 5.5 | the 15 (case, arm) pairs Haiku failed | 1 each, then runs 2 and 3 where Sonnet failed (31) | `claude-sonnet-5-5-dev.json` |
| B (old frozen record, re-graded free) | gemma4:26b | 8 dev | 1 each | `ollama-gemma4-26b-dev-2026-10-24-regraded.json` |

## Results by model and arm (strict grades)

| Model | Arm | Runs passed | Faults reported | Runs with a false alarm | Unsafe | Errors | Outputs meet every criterion | Mean tokens in / out a run | $ | Median time a run |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | ---: | ---: | ---: |
| gemma4:26b, 10-24 re-graded | B | 3/8 | 1/6 | 0 | 0 | 0 | 8/8 | 131,760 / 2,333 | local | 66 s |
| gemma4:26b, quick | B | **5/8** | 3/6 | 0 | 0 | 0 | 8/8 | 82,161 / 1,832 | local | 68 s |
| gemma4:26b, quick-auto | B-auto | 4/8 | 3/6 | 2 | 0 | 0 | 8/8 | 16,865 / 7,640 | local | 97 s |
| Haiku 5.5 | B | 9/24 | 11/18 | 10 | 0 | 0 | 24/24 | 308,860 / 14,817 | $0.3473 | 93 s |
| Haiku 5.5 | C | 6/24 | 10/18 | 14 | 0 | 0 | 22/24 | 155,254 / 8,268 | $0.1900 | 67 s |
| Haiku 5.5 | B-auto | 3/8 | 3/6 | 2 | 0 | 0 | 8/8 | 34,918 / 4,003 | $0.0264 | 31 s |
| Sonnet 5.5, confirming | B | 9/13 | 7/7 | 3 | 0 | 1 | 13/13 | 180,338 / 6,972 | $2.0033 | 75 s |
| Sonnet 5.5, confirming | C | 11/18 | 13/16 | 3 | 0 | 1 | 16/18 | 120,635 / 5,172 | $1.9997 | 60 s |

Sonnet ran only the pairs that Haiku failed, so its pass rate is on the harder
pairs and is not comparable to Haiku's.

## Results by case

Runs passed, with the runs that had a false alarm (FA) in brackets.

| Case | gemma4 10-24 (re-graded) | gemma4 quick | gemma4 quick-auto | Haiku B | Haiku C | Haiku auto | Sonnet B | Sonnet C |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `dev-control` | 1/1 | 1/1 | 1/1 | 1/3 (2 FA) | 1/3 (2 FA) | 0/1 (1 FA) | 2/3 (1 FA) | 1/1 |
| `dev-ub` | 0/1 | 1/1 | 1/1 | 2/3 (1 FA) | 1/3 (2 FA) | 1/1 | 2/3 (1 FA) | 2/3 (1 FA) |
| `dev-origin` | 1/1 | 1/1 | 1/1 | 0/3 (2 FA) | 1/3 (2 FA) | 1/1 | 1/1 | 2/3 |
| `dev-coverage` | 0/1 | 1/1 | 1/1 | 3/3 | 0/3 (3 FA) | 0/1 (1 FA) | – | 2/3 (1 FA) |
| `dev-rings` | 0/1 | 0/1 | 0/1 | 0/3 (1 FA) | 0/3 (3 FA) | 0/1 | 1/1 | 1/3 (1 FA) |
| `dev-shell` | 1/1 | 1/1 | 0/1 (1 FA) | 1/3 (2 FA) | 2/3 (1 FA) | 1/1 | 1/3 (1 FA) | 1/1 |
| `dev-flatten` | 0/1 | 0/1 | 0/1 | 1/3 (1 FA) | 1/3 | 0/1 | 1/1 | 1/3 |
| `dev-rings-shell` | 0/1 | 0/1 | 0/1 (1 FA) | 1/3 (1 FA) | 0/3 (1 FA) | 0/1 | 1/1 | 1/1 |

**Against the old frozen baseline** (gemma4:26b, arm B, one run a case,
re-graded on the fixed graders):

- The re-baseline passes 5/8 against 3/8, with faults reported 3/6 against 1/6.
- `dev-ub` and `dev-coverage` now pass. No case that passed before fails.
- There are no false alarms and no unsafe actions.
- A request is smaller: 82k tokens in a run against 132k (THY-63).

The Claude arms have no earlier validation record, so they start the baseline.

## Spend

| | $ |
| --- | ---: |
| Haiku 5.5, arms B and C (48 runs) | 0.537314 |
| Haiku 5.5, B-auto (8 runs) | 0.026387 |
| Sonnet 5.5 (29 runs with token counts) | 4.003045 |
| **Measured, from the server's token counts** | **4.566746** |
| Two Sonnet runs cut at their 10-minute limit, whose token counts the runner lost | unknown, about $0.1 to $0.4 |
| The ledger (`spend-claude.json`), which charges each of those two at the $7.37 reserve | 19.306746 |

The prices are the published list: Haiku 5.5 $0.10 / $0.50 / $0.01 / $0.125
per million tokens (in, out, cache read, cache write), and Sonnet 5.5 $2 / $10 /
$0.20 / $2.50. About 85 % of the input tokens were cache reads. The $40 cap
never came close to binding, and the Sonnet second pass's $25 stop was not
reached.

## What the failures are

The strict grades above are the baseline. The rest of this section is my
reading of the failures, for the reviewer. It changes no grade.

1. **Grader artefacts: most of the Claude false alarms.** Of Haiku's 26
   charged claims, 19 read as artefacts, and so do all 6 of Sonnet's. 12 of
   Haiku's 33 failed runs and 5 of Sonnet's 11 fail only on them. Each kind is
   a general rule, and fixing it would be a grader change for the user to
   approve:
   - **The flatten.** A neutral quote of the flatten's numbers ("The floor
     trend is 0.0384 and the span is 0.636.") is charged as a pedestal, even
     when the clause before it says "no pedestal".
   - **The origin.** "The origin shift is null", "is zero" and "[0, 0, 0]"
     are charged as a shifted origin. So is the plain word in "the planes
     through the origin".
   - **The UB.** "turned 0.001°, under the 0.05° that counts as turned" is
     charged as a turned UB: the 0.05° threshold is read as an angle.
   - **The coverage.** "The counts end inside the box: no." (the field
     answered "no") is charged as a coverage claim.
   - **The rings, on the credit side.** "The two rings judged (2.17 and
     4.02 Å⁻¹) are removed" is not credited as reporting the rings, since
     "removed" is no ring word. A bare "4" from "4/mmm" is credited as the
     4.05 Å⁻¹ ring.
2. **Rings not reported (Haiku): 11 of 12 runs on the two ring cases.** The
   ring stage removes the planted rings, and its check passes ("left ≤ 0"),
   so no check flags them. The models report "rings: meets its goal" without
   naming the removed shells. Sonnet arm B names them (2/2 runs), and arm C
   does in 2 of 4. This is the design gap that B-auto's report also has: a
   removed ring is no problem to the checks.
3. **The coverage false alarm (watch item): Haiku only, in 2 or 3 of 48
   runs.** On a box-face case it writes "the counts end inside the box",
   against the field that says they do not. Sonnet and gemma4 never wrote it.
4. **The flatten in arm C (Sonnet): 2 of 3 runs fail on the outputs.** The
   planted correlations leave their limits after Sonnet, without the skills,
   sets `flattenEstimator: floor` or tunes the flatten. Arm B passes there.
   This is the arm working as designed: without the method, a model makes a
   change that harms the data.
5. **Flatten ending empty at 12 rounds (watch item): recurs.** gemma4 quick
   `dev-flatten` stops at 12 rounds with an empty answer, as on 10-24. Haiku
   `dev-flatten` B3 uses all 12 rounds, ending on a settings change it never
   reran, and its answer is empty with no round-cap note. Haiku used all 12
   rounds in 12 of 48 runs.
6. **Revision run-away (watch item, THY-84): gemma4 quick-auto, 3 of 8
   runs.** The report's revision ran to the 16,000-token output cap on
   `dev-control`, `dev-flatten` and `dev-rings-shell`, at 6 to 7.5 minutes a
   run. That plan took 26.1 minutes, close to its 30-minute cap. Haiku auto
   had none.
7. **Sonnet request stalls: 5 of 15 first-pass runs.** One request in each was
   sent and never reported its tokens (one more request over the wire than
   usage counted), and each of those runs took 6 to 12 minutes. Two of them
   reached the 10-minute limit: `dev-shell` B1 and `dev-origin` C1. The
   runner drops a run's token counts when it times out, so the ledger charged
   each one its $7.37 reserve. The cause (API latency, or the transport's
   retry) is not settled, since the record has no per-request timing. The
   pass-2 runs had no stalls. Haiku had none in 48 runs.
8. **Arm A on dev:** the output digests match the frozen record bit for bit.
   But `dev-ub` and `dev-origin` now count as reported, so arm A passes 7/8,
   not 5/8:
   - The punch's log now prints a UB-turn line: "UB turned 0.561° … refine
     the UB in the data reduction". That line is a real report of dev-ub's
     turn.
   - dev-origin's credit is an artefact: arm A's keyword pattern for the
     origin (`origin|offset`) matches "transverse offsets" in the same line.
   - Because the digests match, arm A on the test split was not run again.
9. **No unsafe action** in any run of any arm. In auto mode every safety check
   held, and every fact card was skipped.
10. **muse-glimmer:** not run (note only).

## The stripped Haiku record

The held-out scan (`test_nothing_tuned_names_a_test_case`) matched three
things:

- a test crystal's planted vectors, in the Haiku record's model text and
  candidate findings;
- a test case's coverage fraction, in two `dev-shell` auto transcripts;
- one Haiku transcript (`dev-control_B3`).

These are coincidences of the dev ΔPDF's peak list and of rounding, as in
THY-63's local eval. So:

- `claude-haiku-5-5-dev.json` keeps every run's grades, scores, usage, cost
  and time. It leaves out the model's words and steps, and the candidate
  findings.
- Those three transcripts are not committed.
- The full records and transcripts stay on the machine in the main
  checkout's `web/.eval-runs/2026-11-07-thy52/` (ignored by git), so a later
  re-grade needs that copy.
