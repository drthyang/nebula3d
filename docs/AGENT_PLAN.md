# Agent plan: architecture, tools and skills before the validation

The validation ([evals.md](evals.md#does-the-pilot-help-validation-on-synthetic-cases))
measures NEBULA Pilot as it ships. Before arms B and C run on the test split,
this plan fixes what would make the numbers measure the harness instead of the
Pilot, puts each piece of science in one place, and brings the skills into line
with the tools. Then the code is frozen, arm A is run again, and the validation
runs as written.

It builds on [pilot-review.md](pilot-review.md) (the review of 2026-10-14 and
its batch 1, merged 2026-10-17) and a survey of `web/src/llm`, `web/src/api`,
`src/nebula3d` and the skills on `main` at `f807320` (2026-10-17). Every claim
cites a file and line on that commit. It is a survey: it changes no code, skill,
prompt or test.

## Ground rules

- **The test split stays held out.** Every change here is designed and checked
  on the dev split, the eval scenarios and CI. Arms B and C do not run on a test
  case until the freeze (phase 6). Arm A is deterministic and is re-run at the
  freeze, since several items change what its log and records say.
- **Approval.** A new tool, a skill change, a tool description that restates a
  skill, and a threshold change that alters the science all need the user's
  approval. Items waiting for it are marked **(approval)**; items the user has
  approved are marked **(approved)**. Skill text goes in its own PR, which waits
  for the user (the rule of 2026-10-17); the rest merges when green.
- **No API spend.** Local models and scripted CI only, until the user says
  otherwise. The live runs are postponed until this plan's core is done.
- **Each PR** passes CI (the Python matrix, mypy, the web lint, tests and both
  builds), updates its docs, and leaves the app working. A refactor PR keeps the
  model-visible text unchanged; phase 3 adds the snapshot test that shows any
  change to it in the diff.

## What is wrong now

### A. Would the validation measure the harness instead of the Pilot?

Mostly not: unlike MATERIA's, NEBULA's runners have no ports or doubles of the
science. The live validation drives the app's own loop, prompt and tools
(`runAgent`, `buildChatMessages` and `CHAT_TOOLS`,
`web/src/llm/evals/validation.live.test.ts:138-172`) against the real Python
server, and runs the pipeline through the app's own store, with an EventSource
for Node (`validation.live.test.ts:81-82`). The scenario evals do the same
(`evals/harness.ts:111-127`), except that `run_pipeline` and `tune_pipeline` are
stubbed to fail (`harness.ts:64`, `harness.ts:122`), so no eval measures an
action. The answer checks of #16 (the evidence gate, the `{{tool.field}}` fill, `{{achieved}}`)
live in `runAgent` itself (`agent.ts:378-396`, `agent.ts:459-464`), so they run
in the harness exactly as in the app. The app's only extra inputs are the
earlier turns' results and the skills they read (`components/ChatView.tsx:224`);
a validation run is one turn.

What still lets the harness, rather than the Pilot, move the numbers:

- **Arm C still sees part of the method.**
  - `dpdf_peaks`'s description names a skill, delta-pdf-interpretation, and
    restates its order: "after the trust checks"
    (`web/src/llm/tools/index.ts:1062`).
  - `assess_stage` for one stage returns the stage's goal
    (`tools/index.ts:754`). The flatten's goal carries reduction-qc's step-6
    method, "a rising one wants flattenQ2" (`web/src/llm/tune/prompts.ts:29`),
    in both arms.
  - The ablation is a string `replace` of the skills' listing in the system
    message (`evals/validation.ts:96-100`), which does nothing if the listing's
    text changes. The arms test catches a skill name left in the system prompt
    (`evals/validationArms.test.ts:133-136`), but not one in a tool description
    or a tool result.
  - The system prompt's own method, "settle these four checks"
    (`prompts/system.ts:120-127`), is the Pilot's, not a skill's, so it stays
    in arm C by design. The protocol should say so.
- **The models run under different rules,** so a comparison across models also
  compares these:
  - **tool scope:** only a local model gets the question's tools
    (`agent.ts:256`, `localTools.ts`);
  - **pruning:** only a local model's older results are shortened past 24k
    tokens (`agent.ts:105`, `agent.ts:273`);
  - **temperature:** 0.2 for the local models (`evals/validationModels.ts:51`,
    `:67`, `:83`). The Claude entry says none (`validationModels.ts:99`), but
    the runner sends `model.temperature ?? 0.2` (`validation.live.test.ts:164`),
    and the Anthropic transport drops it (`provider/client.ts:602-604`);
  - **reasoning:** Claude's thinking is replayed with its turn
    (`agent.ts:406`, `provider/anthropic.ts:172`), while the local models'
    reasoning is not sent back;
  - **output and window:**
    - Claude gets a 64k-token output cap (`provider/anthropic.ts:31`), and a
      local server its own default;
    - Ollama's window is sized to the prompt in steps (`provider/window.ts:48`,
      `provider/tokens.ts:85`), and LM Studio's loaded window is checked
      (`provider/window.ts:67`).

  A run record keeps the turn cap and the timeout
  (`evals/validation.ts:412`), but none of the rest.
- **State outlives the run it describes.**
  - **The pipeline log:** the runner resets the Configure page between runs
    (`validation.live.test.ts:137`), but not the pipeline store's log, which
    `configOf` leaves out (`state/configMemory.ts:17`,
    `state/pipelineStore.ts:119-124`). `run_log` reads that log
    (`tools/index.ts:834`), so a run that calls it before its own pipeline run
    reads the previous run's log, on another dataset.
  - **The tuning store** is not reset either.
  - **A model that once refuses tools** runs without them for the rest of the
    process (`agent.ts:70`).
  - **The token calibration and the Ollama windows** carry across runs
    (`provider/tokens.ts:67`, `:86`), unrecorded.
  - **In the app,** an earlier turn's results stay number sources after a
    rerun has made them stale (`agent.ts:132`, `agent.ts:383`).
- **A run record holds results trimmed to 5,000 characters.** `runAgent`
  keeps each step's whole result for its own checks (`agent.ts:222`, `:437`)
  but returns the steps with the text the model read (`agent.ts:465-473`). The
  record's decisions, its number provenance and its candidate findings read
  those (`evals/validation.ts:298-303`, `:325-335`, `:370-391`), though the
  field says "the whole result the tool returned" (`validation.ts:301`). A
  field `fitResult` dropped from a long result (`tools/index.ts:1727-1788`) is
  missing from the record a reviewer reads.
- **The replays trust recorded verdicts.** `verdict.ts` and the answer checks
  take a recorded `verdict` string over recomputing it (`verdict.ts:43`,
  `answerChecks.ts:253`). So a fixture recorded under one rule
  (`evals/fixtures/validation-dev.json:2`, 2026-10-17;
  `fixtures/heldout.json:2`, 2026-10-11; `fixtures/hex90k.json:2`, 2026-10-10)
  keeps that rule's verdict after the rule changes. No test checks a fixture
  against the current tools' output.
- **The holdout scan is narrower than the protocol says.**
  `test_nothing_tuned_names_a_test_case` (`tests/test_validation.py:154-178`)
  reads `web/src/llm` (apart from the validation's own files), `.claude/skills`,
  `src/nebula3d` (apart from `validation/`) and `docs/algorithms`.
  - It does not read `web/src/api`, `web/src/components`, `tests/`,
    `examples/`, `scripts/` or the other docs (`pilot.md`, `pilot-review.md`).
  - It matches the test cases' ids only (`test_validation.py:166-167`), not
    their opaque labels, seeds, planted vectors or fault sizes. A constant
    tuned to a test fault's size would pass it.

### B. The same science in more than one place

The science sits in two languages: the Python package (`src/nebula3d`), which
the native server and the browser build both run (`webbridge.py` mirrors the
server's endpoints), and the agent's TypeScript metrics (`web/src/llm/metrics`),
which measure the slices the tools fetch. Where the two measure the same thing,
or a limit is written down twice, they can drift.

- **The window's 1e-3 limit is written four times,** and the check reads
  the backend's own target:
  - the backend fits its window to `support_tol` = 1e-3
    (`src/nebula3d/analysis/delta_pdf.py:397`, `:570`, `:1213-1224`);
  - the tools judge against `OPEN_WEIGHT_OK` = 1e-3
    (`web/src/llm/metrics/coverage.ts:34`);
  - the ΔPDF report's check has its own literal, `open <= 1e-3`
    (`web/src/llm/report/report.ts:336`);
  - the scorer judges against its own 1e-3
    (`src/nebula3d/validation/score.py:70`).

  The tools also compare different numbers. `assess_stage` rounds the weight to
  two significant figures (`tune/evaluate.ts:113`) before the report and the
  tuning limit compare it (`report.ts:336`, `evaluate.ts:349`), while
  `qmax_coverage` compares the raw weight (`tools/index.ts:1281`, `:1295`). A
  weight of 1.04e-3 meets the ΔPDF's goal in `assess_stage` and reads
  "too far" in `qmax_coverage`.
- **The 3D-ΔPDF has two cores.** The native transform pads each axis to an
  11-smooth length (scipy), and the browser's WebGPU core to a 5-smooth one
  (`src/nebula3d/analysis/delta_pdf.py:576`, `:707`;
  `web/src/gpu/deltaPdf.ts:56`, `web/src/gpu/fftPlan.ts:23`). Each records and
  inverts its own padding, so the round trip holds in both. Where the two
  lengths differ (not for 161 or 401 points, where both give 162 and 405), the
  ΔPDF grids differ in size, and what the tools read on them can differ
  slightly: `dpdf_peaks`' positions and σ, `dpdf_contrast`'s percentiles. The
  validation runs the native build only.
- **The browser build computes other things differently too,** and the
  validation never runs it:
  - it stores float32 (`src/nebula3d/webbridge.py:160`), the native default
    float64 (`src/nebula3d/pipeline.py:612`);
  - it always runs in low memory (`webbridge.py:201`), where the ring test
    subsamples a volume's voxels with a seed tied to the slab
    (`src/nebula3d/preprocessing/ring_isotropy.py:171`, `:243-244`), so a ring
    verdict can differ from the native one;
  - its `pdf_check` log line drops the even-part r
    (`webbridge.py:976-978`, against `pipeline.py:2288-2293`), and `run_log`
    reads these lines.
- **"Fully measured" is 0.95 in three places, and "half" 0.5 in two:**
  `src/nebula3d/analysis/coverage.py:31`, `:33`; `metrics/coverage.ts:27-28`;
  `metrics/flatten.ts:48` (`FULL_SHELL`).
- **The coverage is measured twice in one tool.** `qmax_coverage` reports
  `full_coverage_q` from three planes, measured in TypeScript, and
  `raw_counts.fully_measured` from the whole volume, measured in Python
  (`tools/index.ts:1315`, `:1319`). On a volume turned or cut, the two differ.
  They count different voxels: TypeScript counts any finite value of the raw
  slice, zeros too (`metrics/coverage.ts:57`), and Python only a masked,
  finite, non-zero one (`src/nebula3d/analysis/coverage.py:116`). The result
  holds a `box_face_q` from each (`tools/index.ts:1316`, `:1372`).
- **The origin's disk is 0.05 of the half-width twice:** for a section
  (`web/src/components/dpdfLevels.ts:18`), and for the volume in `dpdf_peaks`
  (`src/nebula3d/analysis/dpdf_features.py:48`). The half-widths differ: the
  section's largest in-plane one (`dpdfLevels.ts:24-30`), and the volume's
  largest over three axes (`dpdf_features.py:133-134`). So
  `measure_dpdf_cut`'s excluded radius and `dpdf_peaks`' `origin_disk_A` can
  differ.
- **"The UB is turned" is decided twice, differently.** Both use 0.05°. The
  computed verdict skips a symmetrised fit (`verdict.ts:36`, `:99`). The answer
  checks call a symmetrised volume's UB "not ok" whatever the angle
  (`answerChecks.ts:278`). "Symmetrised" is itself decided twice: the answer
  checks read `ub_check`'s measured break below `SYMMETRISED` = 1e-4
  (`src/nebula3d/analysis/ub_refine.py:54`, `:396`), while `symmetry_check`,
  `assess_stage` and the report read the file's declaration
  (`tools/index.ts:936-938`, `tune/evaluate.ts:120`, `report.ts:325`).
- **The pedestal has two definitions.** The tools call a pedestal left when the
  floors' trend (their rank correlation with |Q|) and their span (a share of
  the diffuse level) are both 0.8 or more, over the outer half of the shells
  the counts reach, on three planes
  (`metrics/flatten.ts:89`, `:99-100`). The validation scorer passes a run
  when the per-shell median of output minus truth, from 3.5 Å⁻¹ to the coverage,
  spans at most 0.25 of the truth's level (`score.py:85-96`, `:357`, `:368`).
  The two are not meant to be the same, but nothing maps one to the other, so a
  run can satisfy the tool and fail the scorer, or the reverse.
- **The flatten's floors are measured twice.** The flatten takes the 25th
  percentile of each 3-D shell (`src/nebula3d/preprocessing/radial_flatten.py:146`).
  The tools take the 25th percentile of each 2-D shell of three planes
  (`metrics/sliceStats.ts`, `radialFloorShells`). The flatten's percentile is
  a setting (`src/nebula3d/server/params.py:186-188`), and the tools' is fixed
  at 0.25 (`sliceStats.ts:180`). So is the tools' fit range:
  `assess_stage` and the chat context pass `FLATTEN_FIT_Q` = [0.8, 10]
  (`metrics/flatten.ts:19`; `context/pipelineContext.ts:151`), whatever
  `flattenFitQMax` the user set (`state/pipelineStore.ts:392`). The floors and
  their largest σ stop at 10 Å⁻¹ (`flatten.ts:139`, `:162`), while the
  pedestal's shells use the lower bound only (`:85`). The eval scenarios'
  settings fit to 16 (`evals/scenarios.ts:32`).
- **A ring is judged in two dimensions at once.** Whether a bump is a ring
  comes from the 3-D test in Python (`tune/evaluate.ts:148`). How much of it is
  left or dented comes from the residuals on three planes in TypeScript
  (`metrics/rings.ts`).
- **Batch 1's provisional limits are each defined once, and restated in
  prose:**
  - the fill-bias floor is `FILL_BIAS_FLOOR` = 0.2, with 0.5σ and 75 %
    (`metrics/texture.ts:73`, `:236`, `:251`), and `texture_check`'s
    description restates it in words (`tools/index.ts:855`);
  - the pedestal's outer half is `0.5 * outer` (`metrics/flatten.ts:89`), and
    the flatten's goal and criterion restate it (`tune/prompts.ts:29`,
    `report/report.ts:170`).

  A change to either constant leaves the words behind. The flatten's words
  also say "well below 1" and "near 1" where the rule is 0.8
  (`tune/prompts.ts:29`, `prompts/system.ts:66`, `tune/catalog.ts:264`).
- **The ring rule is read from two configs.** The pipeline confirms its rings
  with `RingParams`' shares (`src/nebula3d/_ringplane.py:102-103`, passed at
  `pipeline.py:1026-1027`). `assess_stage` judges them with `IsotropyConfig`'s
  defaults (`server/volumes.py:364-366`; `ring_isotropy.py:87-88`). Both are
  0.9 and 0.15 today, but a change to `RingParams` moves one only. Ring
  detection allows a width up to 0.24 Å⁻¹ (`_ringplane.py:75`), and the
  judgement caps it at 0.16 (`ring_isotropy.py:93`).
- **Defaults disagree between the page and the package.**
  - The page's ring texture order is 8 (`tune/catalog.ts:141`,
    `state/pipelineStore.ts:156`), and `RingParams`' is 6 (`_ringplane.py:63`).
  - `DeltaPdfParams`' window is gaussian 0.4 (`pipeline.py:562-563`), and
    `compute_delta_pdf`'s is hann 0.5 (`delta_pdf.py:387-388`).
  - The consistency view recomputes the back-FFT with `DeltaPdfParams`'
    defaults, not the run's settings (`server/consistency.py:136-138`).
- **"σ" is three different populations in the ΔPDF tools:**
  - each section's own (`metrics/dpdf.ts:120-124`, `feature_snr`);
  - the three centre sections pooled (`tools/index.ts:1002-1003`,
    `dpdf_contrast`);
  - a subsample of the volume (`dpdf_features.py:85-87`, `dpdf_peaks`).

  A height in one tool's σ, compared with another tool's, is off by their
  ratio.
- **`dpdf_contrast` says it applies "the page's Auto"** (`tools/index.ts:981`)
  but computes it differently. It uses every finite value, zeros included
  (`:1000`). The page samples at most 60,000 values per slice and drops exact
  zeros (`web/src/components/colorScale.ts:52-64`).
- **"Near a Bragg node" has four definitions:**
  - 0.12 r.l.u. per axis (`metrics/punch.ts:144`);
  - a quarter of the smallest node spacing, in Q (`metrics/grains.ts:112-113`);
  - 0.25 of the supercell per axis (`src/nebula3d/analysis/bragg.py:293`),
    which `grains.ts:7` says it uses;
  - the detection window, 0.2 r.l.u. (`bragg.py:587`).

### C. One tool's facts are spread over side lists

`CHAT_TOOLS` holds 24 tools (`web/src/llm/tools/index.ts:1694-1719`). What
the rest of the app knows about each sits in lists kept by hand, and no test
checks that a list covers the registry.

- **Per-tool facts in side lists.**

  | List | File | What it misses |
  | --- | --- | --- |
  | `CHANGES_STATE` | `agent.ts:110` | `dpdf_contrast`, which sets the viewer's limit (`tools/index.ts:994`, `:1034`) |
  | `CORE_TOOLS`, `TOPICS`, `DEFAULT_TOOLS`, `ACT_TOOLS` | `localTools.ts:11-45` | `ub_check` and `texture_check` from a generic question, which the method needs |
  | `TOPICS` (what settles each verdict) | `answerChecks.ts:47-150` | the coverage and symmetry that `assess_stage pdf` also returns (`tune/evaluate.ts:111-120`) |
  | the tools `verdict.ts` reads | `verdict.ts:56-102` | `grain_check`, so a second grain is never a data problem |
  | `REPORT_TOOLS`, `measure()` | `report/collect.ts:24`, `:57-64` | `ub_check` and `dpdf_peaks`; the report never runs `ub_check` |
  | `TOOL_LABELS`, `RUNNING_LABELS` | `components/ChatView.tsx:91-122` | a running label for `ub_check` |
  | `stepKeys` | `highlight.ts:52-90` | `symmetry_check`, `dpdf_peaks`, `dpdf_contrast`, `grain_check`, `ub_check`, `compare_datasets`, `show_in_viewer` |
  | `ACTIONS` | `evals/harness.ts:64` | `update_settings`, `dpdf_contrast`, `show_in_viewer`, which run for real in the evals |
  | the tools a replay runs as they are | `evals/scripted.ts:101`, `evals/thy18.test.ts:41` | `run_log`, which only reads the store |
  | `SWEEP_CALLS`, "every reading tool" | `evals/validationSweep.test.ts:24-34` | it holds `dpdf_contrast`, which acts, and misses `grain_check` and `bragg_peaks` |

  The header of `tools/index.ts` (`:4-7`) still says two tools act; four do,
  and `dpdf_contrast` too.
- **The repeated-call guard treats an acting tool as a read.**
  - Only `CHANGES_STATE` clears it (`agent.ts:441`). So `dpdf_contrast {}`,
    then `{percentile: 99.5}`, then `{}` again: the third call is not run, and
    the model is told the 99.9th percentile is applied while the viewer shows
    the 99.5th (`agent.ts:411-421`).
  - `current_view` after a measurement moved the console is skipped the same
    way.
  - Staleness keys on `run_pipeline` alone (`evidence.ts:14-29`). A
    `ub_check` or `qmax_coverage` taken before `update_settings` changed the
    punch cell, or a tuning run changed the window, still counts as current
    (`answerChecks.ts:88`, `:126`).
- **Results are text, and the checks read them back with regexes:**
  - the coverage, symmetry and grain verdicts, matched with `/^clean/`,
    `/^not kept/` and `/^a second grain/` (`answerChecks.ts:263-271`, `:300`,
    `:305`, `:310`; `verdict.ts:78`, `:87`; `report/report.ts:229-230`,
    `:336`, `:354`).
    - A passing reach-based coverage verdict ("the transform reaches … inside
      full coverage", `tools/index.ts:1305`) and "not judged" read as neither.
    - The words they test for are built in `tools/index.ts:956-961`,
      `:1294-1306` and `metrics/grains.ts:149-165`.
  - `symmetryOf` turns a number into a verdict string, which `pdfCheck` parses
    back (`report/report.ts:412-424`).
  - A refusal by its summary text (`evals/findings.ts:147`).
  - The cell, from `ub_check`'s text (`evals/scenarios.ts:69-74`).
  - Which tools to offer after a send-back: a tool name in the evidence prose
    (`agent.ts:391`).
- **The app and the graders read text differently.** `NEGATION` differs
  between the answer checks (`answerChecks.ts:160`) and the validation's
  graders (`evals/checks.ts:15`). So do `clauses` (`answerChecks.ts:179-190`,
  `evals/validation.ts:147-151`) and the number readers
  (`answerChecks.ts:393-410`, `evals/checks.ts:43-55`). A sentence the app
  lets through can be graded as a claim, or the reverse.
- **No test pins a live tool's output shape.**
  - `tools.test.ts` mocks the API with hand-built objects
    (`__tests__/tools.test.ts:16-28`), and the API client casts JSON without
    checking it (`api/client.ts:138`, `:158`).
  - The probes that run the tools against a backend are all skipped without an
    environment variable (`evals/probe.test.ts:20-22`,
    `heldoutProbe.test.ts:21-23`, `validationSweep.test.ts:22`).
  - The CI fixtures lag the tools:
    - `hex90k.json` (2026-10-10) has no `verdict` in its stage results, the
      rings' old shape, no even-part fields, no `symmetry_declared`, no
      origin's shift and no `counts_end_inside_box`;
    - `heldout.json` (2026-10-11) has no origin's shift and no
      `counts_end_inside_box`.

    So the replays run the fallback paths (`answerChecks.ts:254`,
    `verdict.ts:47`), and the shifted-origin replay never reaches
    `origin_shift_rlu`.
- **Big files mix concerns.**
  - **`tools/index.ts`** (1830 lines): 24 tools, the shared argument and view
    helpers, the result budget (`fitResult`, `:1727-1788`) and the executor
    with the skill gate (`:1790-1830`). It imports the verdict rules from
    `report/report.ts` (`:59`), and `report/collect.ts` imports `CHAT_TOOLS`
    back (`:16`).
  - **`report/report.ts`** (481 lines): the report and the rulebook every
    other part reads (`VERDICT_LABEL`, `stageCheck`, `NOT_DECLARED`,
    `symmetryOf`, `:378-424`).
  - **`answerChecks.ts`** (532 lines): topics, verdict rules, number tracing
    and the run as a whole.
  - **`agent.ts`** (474 lines): the request loop, recovery, compaction, the
    repeated-call guard and the answer checks.

### D. Tool gaps

These are on top of the review's list ([pilot-review.md](pilot-review.md#tools)):

- **The model cannot read the run's verdict before it writes.** `{{achieved}}`
  is computed only when the answer is filled in (`agent.ts:459-464`,
  `verdict.ts`). A model that wants to know whether the run met its goal has to
  infer it from each stage's result, and a wrong guess costs it a send-back
  (`answerChecks.ts`, `overallContradiction`). A reading tool that returns the
  computed verdict would close the gap **(approval)**.
- **The coverage verdict cannot fail on the default window.** The backend
  shrinks its window until at most `support_tol` = 1e-3 of the window's weight
  is on unmeasured space (`src/nebula3d/analysis/delta_pdf.py:397`,
  `delta_pdf.py:1213-1224`). `qmax_coverage` then judges that weight against the
  same 1e-3 (`metrics/coverage.ts:34`), so its "clean" holds by construction: it
  can only fail with support off, a separable window or a band set. The dev cut
  read 9.8e-4. What tells a model that the counts end inside the box is the
  counts' edge, which batch 1 put in the verdict.
- **The symmetry is checked on one section.** `symmetry_check` compares the
  x–y section at one z with its images under the in-plane operations
  (`tools/index.ts:924-934`). Operations that move c (a mirror ⊥ c, a cubic
  three-fold) are never tested.
- **The fill's texture is judged on 2-D sections of 3-D holes.** The holes are
  2-D components of one cut (`metrics/texture.ts:77`), so a hole's rim depends
  on where the cut crosses it.
- **`dpdf_peaks` stops at 12 entries by default** (`tools/index.ts:1073`). On
  the dev control, the weaker planted correlation is entry 19
  ([pilot-review.md](pilot-review.md#batch-1-the-eight-findings-implemented-2026-10-17)).
  Its groups also ignore the declared symmetry
  (`src/nebula3d/analysis/dpdf_features.py:25-28`).
- **No in-app regrid onto a refined UB.** A turned UB can only be reported. The
  skill points at `examples/refine_ub.py`
  (`.claude/skills/reduction-qc/SKILL.md:37-38`). Whether that wants an action
  tool is the user's call **(approval)**.
- **Forbidden nodes, λ/2 and multiple scattering** are judged from
  `line_profile` by eye (`.claude/skills/bragg-node-audit/SKILL.md:43-44`). No
  tool measures the 2h 2k 2l test or an orbit's members.
- **`run_log` sees one browser session's runs only**
  (`tools/index.ts:825`, `:835`). A run the user made before a reload, or
  another session's run, is invisible to it.

### E. Skills disagree with the tools

On `main` the skills are the text before batch 1's skill PR (#17), which waits
for the user. These are the contradictions with the tools as they now are; #17
fixes the first four.

- **reduction-qc step 6:**
  - It names `floor_trend` (`.claude/skills/reduction-qc/SKILL.md:68`). The
    flatten's evaluation gives `max_floor_trend`, `max_floor_span_fraction` and
    `pedestal_left` (`web/src/llm/tune/evaluate.ts:290-296`).
  - It says when to want the Q² term but not when to turn it on (finding 5).
  - It asks for floors "near zero across the whole coverage"
    (`SKILL.md:67-68`). The verdict judges the outer half of the shells the
    counts reach, and no longer holds the floor to 1σ (`metrics/flatten.ts`,
    `judgedShells`; `report/report.ts`, `CRITERIA.flatten`).
- **delta-pdf-interpretation:**
  - Step 3 asks for each feature's vector, sign and size, and names no tool.
    `dpdf_peaks` now gives all three (`tools/index.ts:1059-1108`).
  - Check 4 (`SKILL.md:58-61`) says nothing of the even part, which the verdict
    now judges (`report/report.ts`, `backFftOk`).
- **bragg-node-audit step 7** reads a fill bias "near 0σ with about half the
  holes brighter" as clean (`.claude/skills/bragg-node-audit/SKILL.md:58-60`).
  `texture_check` now judges a fill against the range its rim allows, with a
  floor of a fifth of the local level (`metrics/texture.ts`,
  `FILL_BIAS_FLOOR`), and the system prompt already says so
  (`prompts/system.ts:125-126`).
- **reduction-qc step 2** reads the offsets by |Q| band
  (`SKILL.md:33-36`). It does not name `mean_offset_rlu` or `origin_shift_rlu`,
  which give a shifted origin's size (`tools/index.ts`, `ub_check`). That
  belongs in the next skill draft **(approval)**.

More, found in the survey:

- **reduction-qc step 1 and bragg-node-audit step 1** take "the symmetry the
  file declares" from `describe_dataset`
  (`reduction-qc/SKILL.md:24-27`, `bragg-node-audit/SKILL.md:27-30`). Its
  result has no symmetry field (`tools/index.ts:299-324`). The declared
  symmetry reaches the model only through:
  - `ub_check` (`tools/index.ts:1187-1188`);
  - `symmetry_check` (`:955`);
  - `grain_check` (`:1134`);
  - `assess_stage` for the ΔPDF (`tune/evaluate.ts:120`).
- **delta-pdf-interpretation, trust check 1** takes the window's shape and
  scale, the band and the symmetry from `describe_dataset` and
  `configure_settings` (`delta-pdf-interpretation/SKILL.md:47-48`).
  - `describe_dataset` gives none of these.
  - `configure_settings` gives the next run's settings, not those on disk
    (`tools/index.ts:629`).
  - The window on disk is in `qmax_coverage` and `assess_stage`.
- **delta-pdf-interpretation's failure mode** "a higher feature SNR … with a
  lower back-FFT r, is ripple" (`SKILL.md:128-129`) reads r against the data.
  That r is lower by the odd part on unsymmetrised data, which is no fault
  (`report/report.ts:310-320`); the tuning goal says neither r can rank trials
  (`tune/prompts.ts:31`).
- **delta-pdf-interpretation step 3** measures a feature's size against "the
  section's robust σ"; `dpdf_peaks` measures it against the volume's
  (`tools/index.ts:1062`).
- **reduction-qc step 5** states the ring rule's 0.15 and 90 %, which match
  (`src/nebula3d/preprocessing/ring_isotropy.py:87-88`).
  - The Python rule has two more conditions, a signal-to-noise of 3 and a
    curve share of 0.25 (`ring_isotropy.py:101-102`). Neither the skill nor
    `CRITERIA.rings` (`report/report.ts:164`) states them.
  - The verdict's "left ≤ 0, dent ≤ 0 beyond three times the noise"
    (`report/report.ts:184`) is not in the skill.
- **bragg-node-audit step 5** says each grain test is judged "against the same
  search at random directions" (`SKILL.md:48-54`). Only the rotated-copy test
  has that control (`metrics/grains.ts:128-139`); the near-node test has none
  (`grains.ts:115-125`).
- **bragg-node-audit's firm rules** say the protected planes and the punch cell
  change only when the user asks, "enforced in code" (`SKILL.md:63-68`). Code
  enforces it for tuning only. `update_settings` takes them from the model with
  `{ sample: true }` (`tools/index.ts:1436`), and only its description asks it
  to wait for the user (`tools/index.ts:1413`). The validation counts such a
  change as unsafe, but the app does not refuse it.
- **The references are cut.** `read_skill` cuts a whole reference page at
  12,000 characters (`skills.ts:154`, `:189-194`).
  - `docs/algorithms/delta_pdf.md` (32 KB) and `bragg_cleanup.md` (40 KB)
    lose the sections the skills point at: "the support on the coverage" and
    "the flatten's background terms" (`reduction-qc/SKILL.md:128-129`); the
    significance gate and the backfill modes. A section can be read alone,
    but only by its exact heading, which the skills do not give.

Beyond single contradictions:

- **No test checks a skill against the code.** `skills.test.ts` checks each
  skill's parts, its draft status, its "(to confirm with the user)" marks and
  its references (`web/src/llm/__tests__/skills.test.ts:26-37`). Nothing checks
  that a tool or field a skill names exists, or that its numbers match the
  constants.
- **A compacted skill loses its gates.** The skills are small: 5.0, 7.1 and
  7.0 KB, about 1.4k to 2k tokens each. Beside about 5k tokens of tool
  definitions (`localTools.ts:2-3`) they fit a 32k window. But once a local
  model's reply passes 24k tokens, all but the newest three results are
  compacted (`agent.ts:105-106`, `agent.ts:273`). A skill's text is not JSON,
  so compaction keeps its first 400 characters (`compact.ts:44-45`).
  - `read_skill` returns "Skill \<name\>" and the body
    (`skills.ts:199`), so those 400 characters are the title, the status line
    and the start of the introduction. Every gate number goes: 0.15 of the
    height in 90 % of directions, 1e-3, the pedestal rule.
  - The skill gate still counts the skill as read (`tools/index.ts:1689`).
- **Tool descriptions and goals restate the skills.** A fix to a skill must
  change these too, or the tool will contradict the corrected skill. Each is
  an **(approval)** item:
  - `ub_check` restates reduction-qc step 2 almost word for word: "a UB error
    gives the same relative offset at every |Q| along a direction"
    (`tools/index.ts:1169`, `reduction-qc/SKILL.md:33-36`);
  - `grain_check` restates bragg-node-audit's "a rotation under 2° is the UB,
    not a grain" (`tools/index.ts:1113`);
  - `dpdf_peaks` names delta-pdf-interpretation and its order
    (`tools/index.ts:1062`);
  - the flatten's goal restates reduction-qc step 6 (`tune/prompts.ts:29`);
  - `radial_profile` says "after flatten the floor should sit near 0 at every
    |Q|" (`tools/index.ts:766`), which the outer-half rule no longer asks.
- **The model-visible prompts still state the old criteria,** in both arms.
  - The system prompt says `after_floor_max_sigma` "≲ 1 is flat"
    (`prompts/system.ts:59-60`), the 1σ clause finding 6 dropped.
  - It says `floor_trend` is "over the whole coverage" (`system.ts:64`); the
    verdict uses the outer half (`metrics/flatten.ts:74-90`).
  - It says "r clearly below 1 flags a transform, crop or band problem"
    (`system.ts:80-81`), which on unsymmetrised data is no fault.
  - The stage-review prompt asks whether the ΔPDF is "trustworthy
    (consistency_pearson_r)" (`prompts/templates.ts:70`).

  A model that follows these words contradicts the computed verdict and is
  sent back, or worse, is not, where no check covers the claim.
- **A skill read in an earlier turn is gone, and still counts as read.** The
  chat sends earlier turns as their text only
  (`components/ChatView.tsx:218`), so the skill's text is not carried. The gate
  counts the skill as read from the earlier turn's steps
  (`ChatView.tsx:224`, `skills.ts:235-243`), so a change in a later turn passes
  it without the method.
- **The interviews lag batch 1.** `docs/SKILL_INTERVIEWS.md` has no question
  on batch 1's provisional limits (the fill-bias floor, the pedestal's |Q|
  range), or on finding 6, which the user has decided.

## Phases

### Phase 1 — Make the validation measure the Pilot

| PR | Change | Size |
| --- | --- | --- |
| 1.1 | **One run policy, recorded.** A `RunPolicy` states what each transport runs under: turn cap, tool scoping, pruning budget, temperature (none where the transport drops it), output cap, whether reasoning is replayed, and the window plan. `runAgent` reads it, and each run record and transcript keeps it. The Claude entry's `temperature: null` becomes what is sent and recorded, not `?? 0.2` (`validation.live.test.ts:164`). Arm B stays the Pilot as it ships, so the defaults stay per transport; evals.md lists what a comparison across models also compares. | M |
| 1.2 | **State reset per run.** Between runs the validation runner clears the pipeline store's log and terminal state, the tuning store, the console's view stores and `noTools` (`agent.ts:70`), and records the token calibration it starts from. A test runs two scripted runs back to back: the second's `run_log` must not read the first's log. In the app, an earlier turn's result stops counting as a number source once a later run recomputed its stage (`evidence.ts`). | S |
| 1.3 | **The ablation is structural** **(approval)**. The system prompt is built from sections, not edited by string replace (`evals/validation.ts:96-100`). With skills off, no tool description, tool result or goal names a skill or carries a skill's step: `dpdf_peaks`'s description drops "(delta-pdf-interpretation)" and its order (`tools/index.ts:1062`), and the flatten's goal drops "a rising one wants flattenQ2" (`tune/prompts.ts:29`), which belongs to reduction-qc. A test runs a scripted arm-C session and finds no skill name, and no sentence of a skill, in any request or result. | M |
| 1.4 | **The holdout scan widened** to all of `web/src`, `src`, `tests`, `examples`, `scripts` and `docs` (the validation's own records and tables allowed), and to the test cases' opaque labels, seeds, planted vectors and fault sizes as well as their ids (`tests/test_validation.py:154-178`). | S |
| 1.5 | **Replays recompute, fixtures are checked.** The answer checks and `verdict.ts` recompute a stage's verdict from its numbers by the current rule instead of trusting a recorded label (`verdict.ts:43`, `answerChecks.ts:253`). Each fixture (`evals/fixtures/*.json`) is re-recorded by its probe, and a test checks every recorded result against the current tool's output shape (3.2), so a fixture cannot lag a tool. | M |
| 1.6 | **The prompts say what the checks judge.** The system prompt and the stage-review prompts stop stating the old criteria: the flatten's 1σ "flat" and "over the whole coverage" (`prompts/system.ts:59-64`), "r clearly below 1 flags a transform problem" (`system.ts:80-81`), and "trustworthy (consistency_pearson_r)" (`prompts/templates.ts:70`). They say what the verdicts now judge, from the constants (2.1). The four checks in the system prompt (`system.ts:120-128`) name all five stages and the UB, as `{{achieved}}` needs **(approval: it changes the Pilot's method in both arms)**. | S |
| 1.7 | **The skill gate holds within a reply.** A skill read in an earlier turn no longer opens the gate in a later one, since its text is not carried (`components/ChatView.tsx:218`, `:224`, `skills.ts:235-243`); the model is told to read it again. The arms are unaffected: a validation run is one turn. | S |
| 1.8 | **Run records keep whole results.** `runAgent` returns each step's whole result beside the text the model read (`agent.ts:222`, `:465-473`), and the record's decisions, number provenance and candidate findings read the whole one (`evals/validation.ts:298-303`), as its field already says. | S |
| 1.9 | **One reader of an answer's words.** The answer checks and the validation's graders share `NEGATION`, `clauses`, `sentences` and the number reader (`answerChecks.ts:160-190`, `:393-410`; `evals/checks.ts:15-55`; `evals/validation.ts:147-151`), or a test lists the sentences on which they differ and why. | S |
| 1.10 | **Done.** The findings record takes the status, the commit, the regression tests, a note and the user's decision (`evals/findings.ts`, `docs/evals/validation/review-findings.json`); a test holds every implemented finding to them. | S |

### Phase 2 — One science layer

The Python package computes the science; the TypeScript tools read it. Where the
two compute the same thing, the PR names the behaviour it keeps and why, and a
test pins it.

| PR | Change | Size |
| --- | --- | --- |
| 2.1 | **One limits module per language, checked against each other.** TypeScript's limits (the window weight, the back-FFT r, the symmetry, the pedestal rule and its outer half, "fully measured", the origin's disk, the UB turn, the unexplained offset, the fill-bias floor) move to one module, imported by the metrics, the verdicts, the answer checks and `verdict.ts`. That retires `report.ts:336`'s literal, and every check compares the same rounding of the window weight (`evaluate.ts:113`, `tools/index.ts:1295`). The ring rule's shares come from one config (`server/volumes.py:364-366`, `pipeline.py:1026-1027`). Python's (`support_tol`, `FULL`, `HALF`, `ORIGIN_EXCLUDED`, the scorer's) are read by a test that fails when a shared one differs. The descriptions, criteria and goals that state a limit are built from the constant. No value changes. | M |
| 2.2 | **One "UB turned".** The answer checks and the computed verdict call one function, which says what a symmetrised fit can judge (`answerChecks.ts:278`, `verdict.ts:99`). A test pins a symmetrised volume and a turned one. | S |
| 2.3 | **One coverage.** `qmax_coverage` takes its fully measured range from the whole volume (`src/nebula3d/analysis/coverage.py`), and the planes' shells only show where (`tools/index.ts:1315`); both count the same voxels, and the result has one `box_face_q`. A test on a turned and a cut volume. | S |
| 2.4 | **The pedestal, mapped.** `docs/evals.md` states how the tool's pedestal rule and the scorer's pedestal relate, and the dev sweep reports both on every case, so a run's tool verdict and its score can be read side by side. **(approval)** for any change to either rule. | S |
| 2.5 | **One σ, one Auto, one "near a node".** Each ΔPDF tool says which σ it quotes, or they share one (`metrics/dpdf.ts:120-124`, `tools/index.ts:1002-1003`, `dpdf_features.py:85-87`). `dpdf_contrast` calls the page's `autoLevels` (`components/colorScale.ts`). The four node reaches are named for what each judges, and `grains.ts:7`'s comment is corrected. **(approval)** for any σ or reach whose value changes. | S |
| 2.6 | **The flatten judged over the run's own range.** `assess_stage` passes the run's fit range and floor percentile instead of [0.8, 10] and 0.25 (`context/pipelineContext.ts:151`, `sliceStats.ts:180`). **(approval)**: it moves which shells the floors are judged on. | S |
| 2.7 | **Defaults agreed, the browser build checked.** The page's and the package's defaults agree, or a comment says why not: the ring texture order (`tune/catalog.ts:141` against `_ringplane.py:63`) and the ΔPDF window (`pipeline.py:562-563` against `delta_pdf.py:387-388`). The consistency view uses the run's settings (`server/consistency.py:136-138`). A parity test runs a small synthetic volume through the native and the browser paths (float32, low memory) and pins the verdicts that may differ. **(approval)** for which ring order or window becomes the default. | M |

### Phase 3 — One tool spec, structured results

| PR | Change | Size |
| --- | --- | --- |
| 3.1 | **A snapshot of what the model sees.** A test snapshots the system prompt (both arms), every tool's name, description and parameters, and the skills' listing, so any change to the model-visible text shows in the diff. It lands first, before any refactor. | S |
| 3.2 | **Structured verdicts.** Each judging tool returns `verdict: {status: "pass" \| "attention" \| "not judged", text}` beside today's words, and the answer checks, `verdict.ts`, the report and the graders read `status` instead of matching the words (C). A refusal carries `refused: {rule}` instead of a summary to match (`evals/findings.ts:147`). A shape contract per tool, which the fixtures are checked against (1.5), and the API client checks what it casts (`api/client.ts:138`, `:158`). | M |
| 3.3 | **`AgentTool` carries each tool's facts:** its label and running label, whether it changes state, whether it makes a reply reportable, the topics it settles, the stage and the settings it reads, the skill that gates it, the questions a local model is offered it for, and how the console highlights it. The side lists in C are derived from it, and a test fails if a list names a tool that does not exist or a consumer keeps its own list. With it, `dpdf_contrast` clears the repeated-call guard (`agent.ts:110`, `:441`), a result goes stale when a setting it reads changes, not only on a rerun (`evidence.ts:14-29`), the computed verdict and the report read `grain_check` and `ub_check` (`verdict.ts`, `report/collect.ts:24`), and the evals stub every acting tool (`evals/harness.ts:64`). | M |
| 3.4 | **`tools/index.ts` split** (1830 lines) into reading, assessing, acting and the runner, and `answerChecks.ts` into topics, verdict rules, numbers and the run as a whole. No behaviour change; the snapshot (3.1) and the existing tests are the net. | L |

### Phase 4 — Tool science

Each item ends with a known-answer test on a constructed case and a check on the
dev sweep (`evals/validationSweep.test.ts`); none is tuned on the test split.
Items that change what arm A's log or records say are noted, since arm A reads
them.

| PR | Change | Size |
| --- | --- | --- |
| 4.1 | **The pedestal in 3-D.** The flatten's verdict reads the shell floors of the whole volume, which the flatten already computes (`src/nebula3d/preprocessing/radial_flatten.py:107`, `raw_levels`), instead of three planes (`tune/evaluate.ts:15`, `:295`), over the same outer half of the shells the counts reach. A known-answer test on a constructed volume; the dev sweep must still flag only the planted background. **(approval)** if it moves the verdict on any dev case. | M |
| 4.2 | **The fill's texture in 3-D.** `texture_check` takes each hole as a 3-D component with its 3-D rim, served by the Python server, instead of 2-D components of a cut (`metrics/texture.ts:77`). The criterion stays batch 1's; a test pins that the dev cases read as before or better. **(approval)** if it moves the verdict on any dev case. | M |
| 4.3 | **The symmetry off the x–y plane.** `symmetry_check` also tests the operations that move c, on the x–z and y–z sections (`tools/index.ts:924-934`). Known-answer tests on symmetric and broken constructed ΔPDFs. **(approval)**: it judges operations the check never judged, so it can turn a verdict. | M |
| 4.4 | **`dpdf_peaks` groups by the declared symmetry** when the file declares operations, and says so; by sign, length and size otherwise (`src/nebula3d/analysis/dpdf_features.py:25-28`). Its default limit is set so that an orbit-grouped list reaches the planted correlations on the dev control. | S |
| 4.5 | **The coverage verdict says what it can judge.** With the window fitted to the coverage, `qmax_coverage` says that the weight is the backend's own target and judges the counts' edge and the band instead (`metrics/coverage.ts:34`, `src/nebula3d/analysis/delta_pdf.py:397`). | S |
| 4.6 | **A reading tool for the computed verdict** **(approval)**: `run_verdict` returns what `{{achieved}}` would say now (`verdict.ts`), so a model reads it before it writes. | S |
| 4.7 | **A regrid onto the refined UB** **(approval)**: an action tool that writes a regridded raw volume (`examples/refine_ub.py`), for the user to run when `ub_check` finds a turn. Changes what arm A can report only if the user adds it to the default pipeline; it does not by itself. | M |
| 4.8 | **Sample facts are refused in code** unless the user's message in this turn names the change, as bragg-node-audit says they already are (`bragg-node-audit/SKILL.md:67-68`). Today `update_settings` takes them from the model (`tools/index.ts:1436`) and only its description asks it to wait (`:1413`). The validation already counts such a change as unsafe; the app should refuse it. | S |

### Phase 5 — Skills

Skill text goes in its own PR, which waits for the user (5.2 to 5.4). The lint (5.1), the compaction code in 5.3 and the interview questions (5.5) can merge when green.

| PR | Change | Size |
| --- | --- | --- |
| 5.1 | **Skill lint in CI.** Every tool and result field a skill names exists (from `CHAT_TOOLS` and the tools' shape contracts, 3.2), and every gate number is bound to its constant in the limits module (2.1). It lands with an allow-list of today's violations, which 5.2 empties. | M |
| 5.2 | **(approval; each draft goes to the user before it merges)** #17, then the contradictions in E. The tool descriptions and goals that restate a skill change in the same PR **(approval)**: `ub_check` (`tools/index.ts:1169`), `grain_check` (`:1113`), `dpdf_peaks` (`:1062`), `radial_profile` (`:766`) and the flatten's goal (`tune/prompts.ts:29`). | M |
| 5.3 | **A compacted skill keeps its gates** **(approval for each skill's `## Gates` text)**. Each skill gets a `## Gates` section with its numbers and rules, and compaction keeps a skill's gates whole instead of its first 400 characters (`compact.ts:44-45`). A test compacts each skill and finds every gate number. | S |
| 5.4 | **The skills read the tools as they are** **(approval)**: the declared symmetry from the tools that give it, not `describe_dataset`; the window on disk from `qmax_coverage` and `assess_stage`; a feature's size against the volume's σ; the ring rule's two further conditions and the verdict's three-times-noise rule; the grain tests' controls as they are; each reference by the section it means, by its exact heading, or the references split so a whole read is not cut at 12,000 characters (`skills.ts:154`). | M |
| 5.5 | **The interviews brought up to date** (`docs/SKILL_INTERVIEWS.md`): batch 1's provisional limits (the fill-bias floor of 0.2, the pedestal's outer half), finding 6 recorded as decided, the origin's shift, `dpdf_peaks`' threshold and limit, and when a turned UB wants a regrid. | S |

### Phase 6 — Freeze and re-baseline

1. CI green, scripted replays green.
2. The local tier (qwen3.8-27b, gemma4:26b, Muse Glimmer) on the eval scenarios
   and the dev split, arms B and C, one model at a time on the shared Mac: no
   regression against the 2026-10-12 tier, no turn cap hit, no silent cut.
3. A dry run of the validation pipeline on the dev split: records,
   transcripts, scoring, candidate findings.
4. Arm A run again at the freeze. Its table in `docs/evals.md` and
   `docs/evals/validation/arm-a-dev.json` are updated; the test split's arm A
   is run once with `--report`.
5. The freeze tagged, and its commit written into `docs/evals.md`. Then the test
   split runs once, as the protocol describes. A paid model runs only with the
   user's go-ahead and cap.

## Order

Phase 1 and 5.1 start together. Phase 2 follows 1.1, so each threshold it moves
is already recorded per run. Phase 3 can overlap phase 2 once 2.1 has put the
limits in one module. Phase 4 needs phases 2 and 3.2, so each fix is made once
and lands in a structured result. Phase 5's content (5.2 to 5.5) waits for
phase 4, so the skills describe the final tools, and goes in its own PRs for
the user. Phase 6 is last.

The core goes first: 1.1–1.9, 2.1–2.3, 3.2, 3.3, 4.8 and 5.1–5.3. These change what the
validation would find. The rest is upkeep that can follow, before or after the
validation.

## Risks

- **A refactor changes behaviour silently.** The snapshot of the model-visible
  text (3.1) and the scripted replays catch changes in what the model sees; the
  known-answer tests (`test_dpdf_features.py`, `test_consistency_even.py`,
  `texture.test.ts`, `metrics.test.ts`) and the dev sweep
  (`evals/validationSweep.test.ts`) catch changes in the numbers.
- **The holdout erodes.** Improving the tools for the test faults' kinds is what
  the dev cases are for. The wider scan (1.4) and the dev-only sweep keep the
  test cases themselves unseen; a survey or a fix must never print a test case.
- **The provisional limits harden by default.** Batch 1's fill-bias floor and
  the pedestal's |Q| range, and finding 6's drop of the 1σ clause, were derived
  on the dev split. Once the live runs score on them, changing them invalidates
  those runs (the protocol's own rule, `docs/evals.md:331`, `src/nebula3d/validation/score.py:20-21`).
  The user's interview (5.5) should settle them before the freeze.
- **Local-model robustness regresses.** The loop guards, compaction and tool
  scoping in `agent.ts`, `compact.ts` and `localTools.ts` were tuned on the
  local tier (`docs/evals.md`). 3.3 moves them without changing them, and phase
  6 runs the local tier again.
- **The shared Mac.** Phase 6's local runs take the shared machine one model at
  a time (the manager's queue); nothing here loads a model before then.
