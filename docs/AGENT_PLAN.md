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
  model-visible text unchanged; the snapshot test (2.0) shows any change to it
  in the diff.

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

### B. The agent layer: deepening candidates

An architecture review (the improve-codebase-architecture skill, 2026-10-18)
walked the agent loop and its guards, the tool specs and dispatch, the evidence,
reference and verdict modules, the analysis under the tools, and the validation
harness. Its terms: a **module** is **deep** when a small **interface** hides a
lot of behaviour, and **shallow** when the interface is nearly the
implementation; a **seam** is where an interface lives, and an **adapter** fills
it; depth gives callers **leverage** and maintainers **locality**. It found
seven candidates. The user decided on 2026-10-19:

| # | Candidate | Strength | Dependency | The user's decision |
| --- | --- | --- | --- | --- |
| 1 | The check-verdict module | Strong | in-process | start set (2.3) |
| 2 | Each tool declares its facts | Strong | in-process | start set (2.2), after the `dpdf_contrast` fix alone (2.1) |
| 3 | A tool result carries both readings | Strong | in-process | start set (2.5) |
| 4 | The executor owns a round of calls | Worth exploring | in-process | waits for the approval batch (3.1) |
| 5 | One reader of an answer's words | Worth exploring | in-process | waits (3.2) |
| 6 | Coverage measured once, in Python | Worth exploring | local-substitutable | waits (3.3) |
| 7 | Replays record at the client seam | Speculative | ports & adapters | waits (3.4) |

1. **The check-verdict module.** The rules for judging a check live in
   `report/report.ts`, which calls itself an assembler (`:1-5`). The tools
   write their verdicts in English, and five readers match the opening words
   (`answerChecks.ts:263-271`, `:300-310`; `verdict.ts:78`, `:87`;
   `report.ts:229-230`, `:336`, `:354`). They disagree:
   - **D1** a passing reach-based coverage verdict settles nothing
     (`tools/index.ts:1304-1305`, `answerChecks.ts:300`);
   - **D2** the report's achieved ignores the coverage verdict that
     `{{achieved}}` reads (`report.ts:333-336`, `verdict.ts:78`);
   - **D3** `grain_check` settles the UB topic, but no UB rule reads it
     (`answerChecks.ts:124`, `:276-281`);
   - **D4** "the UB is turned" has two definitions (`verdict.ts:99`,
     `answerChecks.ts:278`);
   - **D5** sharp peaks on protected planes are "needs attention" in the punch
     verdict and "stay by design" in its goal (`report.ts:206`,
     `tune/prompts.ts:25`);
   - **D6** the window weight is rounded before one check and not another
     (`tune/evaluate.ts:113`, `tools/index.ts:1295`).

   Deepened, one module owns each check's rule, its outcome kind and the run's
   achieved, and readers read the kind. Each disagreement is kept, named and
   pinned until the user decides it **(approval)**.
2. **Each tool declares its facts.** Ten lists kept by hand name tools by
   string: `CHANGES_STATE` (`agent.ts:110`), the local model's sets
   (`localTools.ts:11-45`), `TOPICS` (`answerChecks.ts:47-150`), the tools
   `verdict.ts` reads (`:56-102`), `REPORT_TOOLS` (`report/collect.ts:24`), the
   labels (`components/ChatView.tsx:91-122`), `stepKeys` (`highlight.ts:52-90`),
   `ACTIONS` (`evals/harness.ts:64`), the replays' lists (`evals/scripted.ts:101`,
   `evals/thy18.test.ts:41`) and `SWEEP_CALLS`
   (`evals/validationSweep.test.ts:24-34`). "Which tools act" has five answers.
   `dpdf_contrast` acts but is missing from `CHANGES_STATE`, so `{}`,
   `{reset: true}`, `{}` skips the third call and the model believes a limit
   the viewer no longer shows (`agent.ts:411-421`, `:441`). Deepened, each
   tool's definition carries its facts and the lists derive from the registry.
3. **A tool result carries both readings.** The whole result lives only in a
   Map inside `runAgent`, merged back twice (`agent.ts:382`, `:462`). The steps,
   the chat history and the run record keep the fitted text (`agent.ts:465-473`,
   `evals/validation.ts:301`), so a number a `{{reference}}` filled can read as
   untraced in the record. Deepened, a step holds what the tool found and what
   the model read.
4. **The executor owns a round of calls.** Arguments are parsed three times
   (`agent.ts:157-165`, `:169-176`; `tools/index.ts:1800`), and the repeat
   guard, the skill gate and the result budget sit in two modules.
5. **One reader of an answer's words.** The answer checks and the graders
   split, negate and read numbers differently (`answerChecks.ts:160-190`,
   `:393-410`; `evals/checks.ts:15-55`; `evals/validation.ts:147-161`), and a
   UB claim needs 0.1° for the grader against 0.05° in the app
   (`validation.ts:160`). The risk: one shared reader would fail the gate and
   the grader together, where the validation could not see it.
6. **Coverage measured once, in Python.** `qmax_coverage` measures it twice,
   with two meanings of "measured" (`metrics/coverage.ts:57`,
   `src/nebula3d/analysis/coverage.py:116`).
7. **Replays record at the client seam.** `web/src/api/client.ts` already has
   two adapters, HTTP and Pyodide. A recorded third would let CI replays run
   the real tools and rules, which they now mock (`evals/scripted.ts:95-112`).

Leads checked and dropped by the review:
- **The scorer sharing the app's limits** (`score.py:70`, `:85-96`): the
  scorer judges the planted truth independently by design; sharing the rule
  would make the grading circular.
- **Native against Pyodide:** `webbridge.py` calls the server's modules, so the
  client seam has two adapters over one implementation, not two
  implementations.
- **The ring rule's two configs** (`_ringplane.py:102-103`,
  `server/volumes.py:364-366`): the same values, neither one a setting; a
  coupling, not a deepening.
- **The four "near a node" reaches** (`metrics/punch.ts:144`,
  `metrics/grains.ts:112-113`, `analysis/bragg.py:293`, `:587`): they answer
  different questions (at a node, beside one, a wing to punch); merging them
  would conflate them.

### C. The science under the tools: what stays open

The first draft of this section (this PR's first commit) listed every limit or
measurement written in more than one place. The review kept these as science,
not architecture. Each change here moves a number or a verdict, so each is
**(approval)**:

- **The pedestal**: the tools' rule and the scorer's differ by design but are
  not mapped to each other (`metrics/flatten.ts:99-100`,
  `src/nebula3d/validation/score.py:85-96`) (4.9).
- **σ and Auto in the ΔPDF tools**: three robust σ populations
  (`metrics/dpdf.ts:120-124`, `tools/index.ts:1002-1003`,
  `analysis/dpdf_features.py:85-87`), and `dpdf_contrast`'s "Auto" computed
  differently from the page's (`tools/index.ts:1000`,
  `components/colorScale.ts:52-64`) (4.10).
- **The flatten's judged range**: fixed at [0.8, 10] Å⁻¹ and the 25th
  percentile whatever the run set (`context/pipelineContext.ts:151`,
  `metrics/sliceStats.ts:180`) (4.11).
- **Defaults and the browser build**:
  - the ring texture order is 8 on the page and 6 in the package
    (`tune/catalog.ts:141`, `_ringplane.py:63`);
  - the ΔPDF window is gaussian 0.4 against hann 0.5 (`pipeline.py:562-563`,
    `delta_pdf.py:387-388`);
  - the consistency view uses default settings (`server/consistency.py:136-138`);
  - the browser build (float32, the low-memory ring test) is never validated
    (`webbridge.py:160`, `:201`; `ring_isotropy.py:171`, `:243-244`).

  See 4.12.
- **The window's 1e-3 limit is written four times** (`delta_pdf.py:397`,
  `metrics/coverage.ts:34`, `report.ts:336`, `score.py:70`). The scorer's copy
  is independent by design; the check-verdict module (2.3) retires
  `report.ts:336`'s literal. That the coverage verdict cannot fail on the
  default window is in D.

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
| 1.3 | **The ablation is structural** **(approved 2026-10-19; built as 2.4)**. The system prompt is built from sections, not edited by string replace (`evals/validation.ts:96-100`). With skills off, no tool description, tool result or goal names a skill or carries a skill's step: `dpdf_peaks`'s description drops "(delta-pdf-interpretation)" and its order (`tools/index.ts:1062`), and the flatten's goal drops "a rising one wants flattenQ2" (`tune/prompts.ts:29`), which belongs to reduction-qc. A test runs a scripted arm-C session and finds no skill name, and no sentence of a skill, in any request or result. | M |
| 1.4 | **The holdout scan widened** to all of `web/src`, `src`, `tests`, `examples`, `scripts` and `docs` (the validation's own records and tables allowed), and to the test cases' opaque labels, seeds, planted vectors and fault sizes as well as their ids (`tests/test_validation.py:154-178`). | S |
| 1.5 | **Replays recompute, fixtures are checked.** The answer checks and `verdict.ts` recompute a stage's verdict from its numbers by the current rule instead of trusting a recorded label (`verdict.ts:43`, `answerChecks.ts:253`). Each fixture (`evals/fixtures/*.json`) is re-recorded by its probe, and a test checks every recorded result against the current tool's output shape (3.5), so a fixture cannot lag a tool. | M |
| 1.6 | **The prompts say what the checks judge.** The system prompt and the stage-review prompts stop stating the old criteria: the flatten's 1σ "flat" and "over the whole coverage" (`prompts/system.ts:59-64`), "r clearly below 1 flags a transform problem" (`system.ts:80-81`), and "trustworthy (consistency_pearson_r)" (`prompts/templates.ts:70`). They say what the verdicts now judge, from the check-verdict module (2.3). The four checks in the system prompt (`system.ts:120-128`) name all five stages and the UB, as `{{achieved}}` needs **(approval: it changes the Pilot's method in both arms)**. | S |
| 1.7 | **The skill gate holds within a reply.** A skill read in an earlier turn no longer opens the gate in a later one, since its text is not carried (`components/ChatView.tsx:218`, `:224`, `skills.ts:235-243`); the model is told to read it again. The arms are unaffected: a validation run is one turn. | S |
| 1.8 | **Run records keep whole results** (now 2.5). `runAgent` returns each step's whole result beside the text the model read (`agent.ts:222`, `:465-473`), and the record's decisions, number provenance and candidate findings read the whole one (`evals/validation.ts:298-303`), as its field already says. | S |
| 1.9 | **One reader of an answer's words** (now 3.2, after the approval batch). The answer checks and the validation's graders share `NEGATION`, `clauses`, `sentences` and the number reader (`answerChecks.ts:160-190`, `:393-410`; `evals/checks.ts:15-55`; `evals/validation.ts:147-151`), or a test lists the sentences on which they differ and why. | S |
| 1.10 | **Done.** The findings record takes the status, the commit, the regression tests, a note and the user's decision (`evals/findings.ts`, `docs/evals/validation/review-findings.json`); a test holds every implemented finding to them. | S |

### Phase 2 — The start set (the user's decision, 2026-10-19)

Stacked, one PR each, in this order, each based on the one before. Each new
module's interface is chosen by design-it-twice: two proposals, the lead picks.
Each PR:
- keeps the science, the verdicts and the snapshot of what the model sees
  unchanged, except where its row says;
- re-runs arm A on dev, where any change stops the work for the user;
- names, where two copies disagree, the behaviour it keeps, and pins it with a
  test.

| PR | Change | Size |
| --- | --- | --- |
| 2.0 | **A snapshot of what the model sees.** A test snapshots the system prompt in both arms, every tool's name, description and parameters, the local model's tool sets, the goals and criteria, the answer checks' send-back text, and a sample of each tool's result text, so any change to them shows in the diff. | S |
| 2.1 | **`dpdf_contrast` clears the repeat guard.** It acts but is missing from `CHANGES_STATE` (`agent.ts:110`, `:441`). It changes the repeat path only; a test runs `{}`, `{reset: true}`, `{}`. | S |
| 2.2 | **Each tool declares its facts** (candidate 2). Whether it acts, reaches the backend or changes a later reading; the topic it settles and the stage it reads; whether it makes a reply reportable; its labels and what it highlights. The side lists derive from the registry, and a test over the registry replaces them. A list that was stale is named; any difference that changes behaviour is kept as a named exception. | M |
| 2.3 | **The check-verdict module** (candidate 1). One module owns each check's rule, its outcome kind (met, needs attention, not judged, with reasons and data problems), the words built from that kind, and the run's achieved. Tools attach the kind; `verdict.ts`, the answer checks and the report read it. Recorded results with words only are read by one adapter. D1–D6 are kept, named and pinned; each unification is a question for the user before it changes a verdict **(approval)**. | L |
| 2.4 | **Arm C removes the whole method** **(approved 2026-10-19; was 1.3)**. With skills off, no tool description, tool result or goal names a skill or carries a skill's step: `dpdf_peaks`' description (`tools/index.ts:1062`), the flatten's goal (`tune/prompts.ts:29`). The system prompt is built from sections, not by string replace (`evals/validation.ts:96-100`). A structural switch, built after 2.3; it changes what the model sees under skills off only. | M |
| 2.5 | **A tool result carries both readings** (candidate 3; was 1.8). A step holds the whole result and the text the model read, parsed once. The record's decisions, number provenance and candidate findings read the whole result, as its field says (`evals/validation.ts:301`). It changes the record, not what the model sees. | M |

### Phase 3 — After the user's approval batch

| PR | Change | Size |
| --- | --- | --- |
| 3.1 | **The executor owns a round of calls** (candidate 4): parsing, the call key, repeats, invalidation, the skill gate and the result budget in one module. The tools then split out of `tools/index.ts` (1830 lines) for locality. | M |
| 3.2 | **One reader of an answer's words** (candidate 5; was 1.9). It shares the tokenising, and the gate's topics and the grader's claims stay apart. **(approval)**: grades can shift, and earlier records would be re-scored. | S |
| 3.3 | **Coverage measured once, in Python** (candidate 6). `qmax_coverage` reads `src/nebula3d/analysis/coverage.py` behind both adapters; the planes only show where. **(approval)**: the coverage verdict can change on a volume that stores zeros. | S |
| 3.4 | **A recorded adapter at the client seam** (candidate 7), so CI replays run the real tools and rules on synthetic recorded slices. | M |
| 3.5 | **Shape contracts and limits across languages.** Each tool's result has a shape contract that the fixtures are checked against (1.5). A test fails when a limit shared between Python and TypeScript differs. No value changes. | M |

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
| 4.9 | **The pedestal, mapped.** `docs/evals.md` states how the tool's pedestal rule and the scorer's pedestal relate, and the dev sweep reports both on every case, so a run's tool verdict and its score can be read side by side. **(approval)** for any change to either rule. | S |
| 4.10 | **One σ and one Auto in the ΔPDF tools.** Each ΔPDF tool says which σ it quotes, or they share one (`metrics/dpdf.ts:120-124`, `tools/index.ts:1002-1003`, `dpdf_features.py:85-87`). `dpdf_contrast` calls the page's `autoLevels` (`components/colorScale.ts`). **(approval)** for any σ whose value changes. | S |
| 4.11 | **The flatten judged over the run's own range.** `assess_stage` passes the run's fit range and floor percentile instead of [0.8, 10] and 0.25 (`context/pipelineContext.ts:151`, `sliceStats.ts:180`). **(approval)**: it moves which shells the floors are judged on. | S |
| 4.12 | **Defaults agreed, the browser build checked.** The page's and the package's defaults agree, or a comment says why not: the ring texture order (`tune/catalog.ts:141` against `_ringplane.py:63`) and the ΔPDF window (`pipeline.py:562-563` against `delta_pdf.py:387-388`). The consistency view uses the run's settings (`server/consistency.py:136-138`). A parity test runs a small synthetic volume through the native and the browser paths (float32, low memory) and pins the verdicts that may differ. **(approval)** for which ring order or window becomes the default. | M |

### Phase 5 — Skills

Skill text goes in its own PR, which waits for the user (5.2 to 5.4). The lint (5.1), the compaction code in 5.3 and the interview questions (5.5) can merge when green.

| PR | Change | Size |
| --- | --- | --- |
| 5.1 | **Skill lint in CI.** Every tool and result field a skill names exists (from the tool registry, 2.2, and the tools' shape contracts, 3.5), and every gate number is bound to its constant in the check-verdict module (2.3). It lands with an allow-list of today's violations, which 5.2 empties. | M |
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

Phase 2 goes first, as the user decided on 2026-10-19: 2.0 to 2.5, stacked in
that order. Phase 1's other items and 5.1 can run beside it, since they touch the
harness and the skills' lint, not the modules phase 2 deepens. Phase 3 waits for
the user's approval batch. Phase 4 needs 2.3, so each science fix lands in one
check's rule and its outcome kind. Phase 5's content (5.2 to 5.5) waits for
phase 4, so the skills describe the final tools, and goes in its own PRs for the
user. Phase 6 is last.

The core goes first: phase 2, then 1.1, 1.2, 1.4–1.7, 1.10, 4.8 and 5.1–5.3. These
change what the validation would find. The rest is upkeep that can follow, before
or after the validation.

## Risks

- **A refactor changes behaviour silently.** The snapshot of the model-visible
  text (2.0) and the scripted replays catch changes in what the model sees; the
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
  local tier (`docs/evals.md`). 2.2 and 3.1 move them without changing them, and phase
  6 runs the local tier again.
- **The shared Mac.** Phase 6's local runs take the shared machine one model at
  a time (the manager's queue); nothing here loads a model before then.
