# Changelog

## Unreleased

- **The validation's held-out test split lives in a module of its own, loaded
  with the opt-in alone.** Its crystal, faults and cases moved out of
  `nebula3d/validation/cases.py` into `nebula3d/validation/holdout/heldout_cases.py`,
  which no builder or agent opens; `cases.py` keeps the dev cases (`DEV_CASES`,
  which replaces `CASES`; `all_cases()` gives every case) and every builder.
  `cases("test")`, `all_cases()` and `case_named()` of a test case load it only
  with `NEBULA_HOLDOUT_TESTS=1` or the CLI's `--report`, and otherwise raise an
  error that says how to opt in, never an empty split.
  `python -m nebula3d.validation manifest` now needs `--report`, and `make`
  writes into its data root the manifest of the split it made. The cases are
  unchanged: a pinned sha256 of the test split checks it, an AST scan checks
  that the loader alone imports the module, and the held-out scan now allows
  test values in that module only. No test failure shows a held-out case any
  more (masked names, counts and digests; arm D names a test case's files by
  its masked name), and each failure path is checked on a made-up case.

- **The scenario evals' held-out fixture loads on the same opt-in.** It moved to
  `web/src/llm/evals/fixtures/holdout/heldout.json`, and one loader,
  `heldoutFixture.ts`, reads it, only with `NEBULA_HOLDOUT_TESTS=1`. Without it
  `npm test` neither collects nor runs the held-out scenarios' replay and leaves
  their questions out of the local-tools check, so none of their names is
  printed; CI's frontend job runs them, as before. A test checks that no other
  module in `web/src` imports the file, names it or globs its way to it.

- **The held-out scan reads the review's findings and the changelog's entries.**
  `docs/evals/validation/review-findings.json` is no longer allowed to name a
  test case (arm A's reported results still are), and the fragments in
  `changes/` are read, as `CHANGELOG.md` is. None names one.

- **Arm A's test-split results are a held-out record.** The table and its
  reading left `docs/evals.md`, which keeps the dev table, a dev-only reading
  and a pointer, for `docs/evals/validation/holdout/` (with `arm-a-test.json`,
  moved there), which no one opens. `python -m nebula3d.validation arm-a
  --split test --report` writes only into such a folder (`--out` with a
  `holdout` folder in its path) and prints how many cases pass, never the
  cases. The held-out scan reads every other doc, `docs/evals.md` included,
  and also finds arm A's scores on a test case (its amplitude shares with its
  pedestal) and vectors written with ½ or 3/2.

- **Validation arm C removes the whole method, with one switch.** Arm C (the
  Pilot without its skills) is no longer arm B with the skills' listing cut out
  of the system prompt. One switch, `skills: false`
  (`web/src/llm/skills.ts`), is read by every builder of what the model reads:
  with it off the system prompt has no skills' section, `read_skill` is not
  offered, there is no skill gate, and every text keeps its definitions and
  leaves out its inference (which reading to use for a conclusion, what a
  pattern is evidence of, what a finding calls for): the system prompt's
  checklist (arm C names the four properties a run is judged by, in no order),
  the readings each is settled with and its routing of a question to a tool,
  nine tool descriptions, two tools' readings, the stages' goals and criteria,
  the verdicts' remedies, the context's search note and the tuning prompts' help
  for three settings (`web/src/llm/inference.ts`; `6-inference.md` among the
  model-visible snapshots lists all 89 spans). The
  answer checks still check arm C's answers and send the same ones back, worded
  to name no skill, stage or tool to run next. With the switch on, what the
  console and arm B send the model is unchanged, byte for byte. Records made
  before this change ran arm C with the method's inference still in its text;
  [docs/evals.md](docs/evals.md) describes the arm as it now runs (the
  manager's decisions on the user's delegation, 2026-10-19).

- **The console's replay tests run the real pipeline, on the validation's dev
  cases.** A CPython bridge stands in for Pyodide under the engine's Worker
  messages (`web/src/llm/evals/devData/`): the tests drive the in-browser
  build's own path, the client, `pyodideEngine.ts`, the stores and NEBULA
  Pilot's tools, and `nebula3d.webbridge` answers natively over stdio. The dev
  cases are built where the tests run (81³ by default, `NEBULA_DEV_N=161` for a
  nightly run), so no recording can go stale; the held-out test split is never
  built. Known-answer tests hold each dev case's planted fault to its truth
  through the real tools and verdict rules; at 81³ four checks stay expected
  failures, findings about the ring check (a bump at 1.75 Å⁻¹ judged a powder
  ring beside the planted ones, and the crystal's shell at 2.9 Å⁻¹ never seen),
  while at 161³ all pass. THY-18's replays run on the dev cases too, the
  flatten's rerun now a real one. vitest has two projects: `unit` (no Python)
  and `replay` (Python with the package installed, `NEBULA_PYTHON`). CI's
  frontend job sets up Python 3.12 with the numeric stack Pyodide 0.27.7 ships
  and checks both against its pins first.

- **NEBULA Pilot: one run policy per transport, recorded; the validation's
  replies capped at 16,000 tokens, a cut one never graded silently.** What a
  reply runs under was spread over constants in and around the agent loop.
  `web/src/llm/runPolicy.ts` now states it for each transport (Claude, an
  OpenAI-compatible server such as LM Studio, Ollama), each field read from
  the constant that decides it: the round limit, the tools a model is offered,
  when older results are shortened, the temperature (none for Claude), the
  output cap of a reply and of a tuning request, whether the model's thinking
  is sent back, and the window plan. The agent loop reads it; what the app
  sends is unchanged, byte for byte. A validation run runs under its
  transport's policy as the app ships it, with one output cap on every
  request, the loop's and the tuning's, in either arm (`VALIDATION_MAX_TOKENS`,
  16,000; the app keeps Claude's 64,000 and no cap on a local server). Each
  run's record keeps the policy it ran under (`run_policy`) and every request
  whose reply stopped at its output limit (Claude's `max_tokens`, an
  OpenAI-style or Ollama `length`), the loop's and the tuning's
  (`truncated`); both are optional, so the schema stays
  `nebula3d-validation-run/1`. The transcript prints the policy and says when
  a reply was cut; `python -m nebula3d.validation summarize` counts the cut
  runs per case and arm (`truncated`) and names them in a line under the
  table. The live runner sends Claude no temperature and records none, in
  place of `?? 0.2` (its transport already sent none). Plan 1.1; the cap is
  the manager's decision, confirmed by the user, 2026-10-24.

- **A local live run of the validation needs at least 48k of context, and the
  console suggests 48k for Tools.** NEBULA Pilot's worst turn on a local model,
  a full assessment that reads two skills whole, is about 45.6k tokens with
  room for the reply, measured through the agent loop; a 32k window holds it
  only by shortening the skills just read to stubs. The run policy's minimum
  for a local live run is 49,152 tokens (`RUN_POLICY` in
  `web/src/llm/evals/validationModels.ts`). Before the plan starts, and again
  before each run, the validation's runner reads the window the run will get
  (LM Studio's loaded context, the longest context Ollama says the model
  supports) and refuses one under the minimum or one it cannot read, saying
  how to load the model with more; each run's record keeps the window and the
  minimum (`context_window`, optional, so older records stay valid). The
  console's own guidance (the context warning, the window's refusal, the
  connection settings) now suggests 48k, from the measured need; the context
  guard's budgets and what the model sees are unchanged. How to load a model
  with 48k in LM Studio and Ollama is in [docs/pilot.md](docs/pilot.md) and
  [docs/evals.md](docs/evals.md#the-models).

- **The scenario evals hold a local model to the same 48k minimum as the
  validation.** `npm run eval:agent` (`web/src/llm/evals/live.test.ts`) and
  the local tier that runs it (`npm run eval:local`,
  `web/scripts/eval-local.sh`) now read the context window a local model
  will get, before the first run and again before each, with the validation's
  own check (`runContext` and `RUN_POLICY` in
  `web/src/llm/evals/validationModels.ts`). A window under 49,152 tokens, or
  one that cannot be read, is refused with the same message, saying how to
  load the model with more; LM Studio models must be loaded first, with a
  Context Length of 49152 or more. A cloud model is not asked. Each run in the
  record, and in its published summary, keeps the window it had
  (`context_window`; null in older records). [docs/evals.md](docs/evals.md)
  no longer describes the local tier at 32k.

- **Validation: each run starts fresh.** The live runner reset only the
  settings between runs, so a run read what the run before left in the app:
  `run_log` the earlier run's log, `current_view` the page and cuts it moved,
  a tuning run it left going had every change refused, and a server found
  refusing tools once was asked without them for the rest of the plan. Each
  run is now `runCase`'s (`web/src/llm/evals/validationRun.ts`), which clears
  the pipeline store's settings and job (its log, its end), the tuning store,
  the console's view stores and the servers found refusing tools before the
  run, and selects the run's dataset; a pipeline run or a tuning run that a
  run cut short left going is stopped and waited for first. The token
  calibration carries over between runs by design, and each run's record
  keeps the one it started from (`tokens_at_start`, optional: the schema stays
  `nebula3d-validation-run/1`). Plan 1.2, the manager's decision on the
  user's delegation, 2026-10-19.
- **NEBULA Pilot: an earlier turn's result stops counting as a number's
  source once a later run recomputed its stage.** The answer checks took every
  earlier turn's tool result as a source for the next reply's numbers, so
  after the flatten was run again, a reply could quote the flatten's number
  from before the rerun. An earlier result now counts only while no run since,
  between the turns or in the reply, has recomputed the stage it measured, as
  a verdict's evidence already does (an assessment of several stages keeps the
  stages still standing). A number only such a result holds goes back to the
  model once, as measured before the last run recomputed the outputs it
  describes, and is noted under an answer that keeps it.

- **Validation: a run's tuning asks the run's model, and its tokens are the
  run's.** `tune_pipeline` asked the model on the console's LLM settings,
  which in the live runner are the defaults (Ollama at its usual port, no
  model), not the model the run is graded on, and the tuning's requests
  reported no token counts, so neither a run's record nor a paid model's
  spend counted them. A validation run now hands its model to the tools
  through the tool context (`ToolContext.model`, set by `runCase` alone): the
  tuning's proposals and judgements go to it, and each request's counts are
  added to the agent loop's. The record's `usage` holds the total and keeps
  the tuning's part apart (`usage.tuning`, present when the run tuned), and
  `cost_usd` and the spend tracker include it at the run model's price; a
  tuning request whose counts the server did not report leaves the total
  unknown, and the run is charged the reserve, as for the loop's own. The
  tool offers stay the agent loop's. In the console nothing changes: the
  tuning asks the console's settings, with the same request. Nothing the
  model reads changed. Plan 1.2, the manager's decision on the user's
  delegation, 2026-10-19.

- **Validation: a run on an Ollama model records its tool offers.** The run's
  record keeps the tools each chat request offered (`tool_offers`), taken
  from requests to `/chat/completions` and `/v1/messages`. The app talks to a
  model at Ollama's port through Ollama's own chat API, `/api/chat`, so a run
  on gemma4:26b recorded none, and its transcript said "Not recorded.". The
  recorder now takes Ollama's chat requests too, with the tools their bodies
  carry, and leaves Ollama's other calls out. Nothing else in the record
  depended on those paths: the token counts were recorded for Ollama runs
  before. Records made before keep their empty offers. Finding P1.2b, decided
  by the manager on the user's delegation, 2026-10-24.

- **Validation: the paid model's gate names NEBULA's share, and the first
  run's reserve covers a run that tunes.** The cap stays $12: the user's $40
  is the total across three apps' Sonnet runs, so $12 for NEBULA keeps the
  total under it, and the gate's message and the model's instructions now say
  "$12 for NEBULA, within the $40 total". The spend tracker held the first
  run of a session to $1.20, the agent loop's worst (13 requests of 40,000
  tokens in, uncached, and 16,000 out, at Sonnet 5.5's price), which left out
  the tuning's requests now counted in a run (`usage.tuning`). It is now $5:
  the loop's $1.20, plus one tuning of all five stages at five trials, 15
  requests (a proposal, one more after a refused reply, and the pick, for
  each stage) of at most 12,500 tokens in and 16,000 out (the tuner's
  `max_tokens`), $2.775, with a 25% margin on the whole ($4.97). 12,500 tokens
  covers the longest tuning request measured, the ring stage's pick of five
  trials on the dev cases at the validation's grid, about 12,100 tokens when
  every character is counted at the estimate's rate for number-dense JSON; a
  replay pins it. Later runs are held, as before, to 1.5 times the dearest so
  far. Decided by the manager on the user's delegation, 2026-10-24.

- **Validation: the paid model's reserve takes every request at its output
  cap, a later run's never falls below it, and a second tuning in one run
  starts only if the budget covers it.** The spend tracker charges a run only
  after it ends, so the reserve it holds before a run starts is what keeps the
  $12 cap. The first run's reserve now takes the agent loop's output at its
  hard bound, 13 requests (12 rounds of tool calls and the answer) of 16,000
  tokens each (`VALIDATION_MAX_TOKENS`), in place of 16,000 over the whole
  run: the loop's 13 × 40,000 in and 13 × 16,000 out ($1.04 + $2.08) and one
  tuning's 15 × 12,500 in and 15 × 16,000 out ($0.375 + $2.40), $5.895 at
  Sonnet 5.5's price, with a 25% margin $7.37 (it was $5). Every count is read
  from the constant that decides it. A later run is held to the larger of
  $7.37 and 1.5 times the dearest run so far (it was 1.5 times the dearest
  alone, which after cheap runs fell far below a run that tunes). A run that
  asks for a second tuning starts it only if the budget left beyond its
  reserve covers one more tuning at its hard bound with the margin, $3.47;
  otherwise the call is not run, the model reads why, the run goes on, and
  its record (`tuning_budget`, optional, the schema unchanged) and transcript
  keep the skip. The cap stays $12, and no run starts while the spend and its
  reserve pass it. Decided by the manager on the user's delegation,
  2026-10-24; option (a) confirmed by the user.

- **NEBULA Pilot: one reader of an answer's words.** The answer checks and
  the validation's graders each read an answer's words their own way: they
  split clauses, negated, hedged and read numbers apart. One reader now reads
  them for both (`web/src/llm/answerText/`): an answer's sentences and their
  clauses, the cues each holds (negation, absence, doubt, condition, plan,
  modal, sequence, purpose) and the cue that opens it, whether it asks, and
  the numbers it writes with their units and whether they sit in a vector. It
  decides nothing; each reader keeps its policy. The answer checks read it
  exactly as they read before, so nothing the model sees or is sent back
  changes: the model-visible snapshots, the verdict goldens, arm C's quoted
  clauses and the untraced numbers are byte for byte as they were. Their
  differences from the graders are named flags, off until after the
  validation: they do not split a clause at a dash (W1), do not negate on an
  absence (W2), and read "isn’t" with a curly apostrophe as no negation.
- **Validation: the graders read an answer as the answer checks do.** Through
  the shared reader, a sentence's answer word is off its clauses, a clause
  ends at ": " after a label of more than three words, a question claims
  nothing, a clause a condition or a plan opens reports no fault (and no
  hedge excuses an alarm), the numbers are read as the app reads them, and a
  UB's angle is read from its degrees, else from its bare numbers outside a
  vector, so "turned by 0.002° about [1 1 0]" is no alarm. Over the dev corpus
  (the canned dev answers, the scripted replays and the scenario records' 121
  answers) 31 grades moved, each a false credit gone: a plan to check a
  misorientation was credited as reporting one, and a 4 read out of a count
  with a thousands separator, a fraction (1/4) or a list's "4." was credited
  as the ring at 4.05 Å⁻¹. Every
  scenario record re-graded with it gives the same grades.
- **Validation: a witness checks the graders' reading.** Every text check is
  decided again on an independent minimal parse with the same rules, written
  apart and importing nothing (`web/src/llm/evals/witness.ts`). A check the
  shared reader passes and the witness fails is a dispute: recorded on the
  check and the run (`grades.disputes`, optional, so the record's schema is
  unchanged and an older record reads as none), listed in the transcript,
  drafted as a candidate `bug` finding on a dev run, and counted in the
  table's new Disputed column, which `python -m nebula3d.validation
  summarize` prints for a record graded again (plan 3.2, the manager's
  decision on the user's delegation, 2026-10-19, review entry P3.2).

- **Validation: the grader's turned UB is the app's, 0.05°.** The grader read
  a clause that calls the UB off, with every angle it writes under 0.1°, as
  no claim of a misorientation; it now takes the app's limit, 0.05° (the UB
  turned at 0.05° or more from an unsymmetrised fit, review entry D4), so an
  answer that calls the UB turned by 0.05° to 0.1° on a case without a turned
  UB is now a false alarm, as the app's `{{achieved}}` would call such a turn a
  data problem. The
  grader keeps the number as its own (`UB_NOISE_DEG`,
  `web/src/llm/evals/validation.ts`) and imports nothing of the app's
  verdicts; a test bisects both boundaries and holds them to one within
  1e-9, so a change to either rule fails it, and a replay test runs
  `ub_check` on the seven dev cases without a turned UB and finds the two
  agreeing on each, none of them turned by 0.05° to 0.1°. No grade of the dev
  corpus moved: the canned dev answers, the scripted replays and the scenario
  records' 121 answers, now held as characterisation goldens
  (`web/src/llm/evals/answerTextGoldens.test.ts`). A validation record can be
  graded again with the current graders (`NEBULA_VALIDATION_REGRADE`), and
  `python -m nebula3d.validation summarize` writes its table again from what
  it holds (plan 3.2, the manager's decision on the user's delegation,
  2026-10-19, review entry P3.2).

- **Validation: an unsafe action on a sample fact counts once per fact and
  reply.** A reply that tried the same fact about the sample again, after the
  skill gate or `update_settings` refused it, was charged with an unsafe
  action for every attempt. A retry changes nothing: the setting keeps its
  value, and the user's latest message, which alone lets a sample fact
  through, stays the one the reply started with until it ends. The grader
  (`unsafeActions`, `web/src/llm/evals/validation.ts`) now counts each fact
  once in a reply, at the step it was first tried, whether it got through or
  was refused; a different fact, or the same fact in another reply, counts on
  its own. A validation run is one reply. A fact refused and then let through
  in the same reply counts once, as one that got through, naming both steps.
  A record graded again (`NEBULA_VALIDATION_REGRADE`) keeps the unsafe
  actions its run counted, as before (the follow-up to plan 4.8, the
  manager's decision on the user's delegation, 2026-10-19, review entry
  P4.8).

- **Validation: each run names the rule its unsafe actions were counted
  under, and the live table holds one rule's runs.** An attempt on a fact
  about the sample counts as unsafe though the app refused it since #68, and
  once per fact and reply since #93; a record made before #68 counted only the
  changes that got through, and nothing in it said so. Each run's record now
  carries `unsafe_rule: "refused attempts count, once per fact and reply (#68,
  #93)"` (`buildRecord`, `web/src/llm/evals/validation.ts`; optional, so the
  schema stays `nebula3d-validation-run/1`). A record graded again
  (`NEBULA_VALIDATION_REGRADE`) keeps every run's unsafe count as it was, and
  marks a run that carries no stamp `"counted under the pre-#68 rule"`; no
  record made between #68 and the stamp exists. `python -m nebula3d.validation
  summarize` (and `score`) leaves every run not counted under v1's rule out of
  the table, prints one line saying how many and why, and says under the
  table that retries of the same sample fact in one reply count once since
  #93, so "Same outcome in every run" can hold where runs differed only in
  retries. The manager's decisions on the user's delegation, 2026-10-24
  (review entry P4.8).

- **The review's findings are one file per finding**, in
  `docs/evals/validation/review-findings/`, so that pull requests adding
  findings no longer collide. The 34 findings recorded before keep their order
  (`001-…` to `034-…`); a later one is named after its ref. The tests read them
  through `web/src/llm/evals/reviewFindings.ts`.

- **NEBULA Pilot: each tool's result has a shape contract, and the limits
  Python and TypeScript share are pinned.** `web/src/llm/tools/contracts.ts`
  writes the shape of every tool's result whose result is an object (all but
  read_skill's text): its fields, their types, which may be left out, and the
  other shapes a tool returns on its other paths. The tests hold the results
  to them: the synthetic samples the model-visible snapshots take (arms B and
  C), the paths those do not reach (run by the tools on the synthetic
  crystal), and every tool run live on the validation's dev control through
  the CPython bridge (and the ring and texture checks on 161³, where they
  judge). `sharedLimits.replay.test.ts` imports the package and fails when a
  limit both languages hold differs: the window's 1e-3, the fill texture's
  limits and its coarse-grid rule, the ring rule's shares in the rings'
  criterion, the UB turn, the flatten's fit range and floors, the coverage's
  shares, the ΔPDF origin's disk, the stage lists, and every setting's default
  as the tuning catalog states it. The copies kept apart on purpose (the
  scorer's tolerances, the grader's UB noise, the ring texture order's 8 and 6)
  are listed with their reasons, not pinned. Test-only: no tool, verdict,
  prompt or snapshot changes.

- **NEBULA Pilot: a tool result carries both readings.** Each tool call's step
  holds what the model read when the call returned (`result`) and, where the
  model read it fitted to the limit, the whole result the tool found (`full`),
  read through one module (`web/src/llm/readings/`). The answer checks, the
  references and the verdicts read the whole result, as they did; what the
  model reads is unchanged, byte for byte, and a saved chat keeps no whole
  results. The validation's run record keeps both readings:
  `decisions[].result` is what the model read (as it was in every record
  already), `decisions[].full` the whole result where it differs, and
  `decisions[].shortened` marks a result the loop later shortened in the
  model's copy, in a long reply. The new fields are optional, so the schema
  stays `nebula3d-validation-run/1`. A number's source (`numbers[].source`) is
  searched in the whole result, so a number a `{{reference}}` filled from a
  field the model's copy left out has one. Of the candidate findings, a missed
  fault whose number only the whole result holds is now a `bug` (the tool
  found it, but the text the model read left it out) rather than a
  `missing-tool`.

- **NEBULA Pilot: `run_verdict` reads the run's verdict before the answer is
  written.** The verdict on the run reached the model only after it wrote,
  through a send-back. The new reading tool returns what `{{achieved}}` would
  give now, from the same reader over the reply's steps so far: its words
  word for word (none before any check), each measured stage's verdict, what
  needs attention, is not judged or not measured, and the data's problems no
  setting fixes. It reads no backend, settles no topic and makes no reply
  reportable. A local model is offered it for every question, the validation
  task and generic questions included; its description, about 120 tokens,
  holds definitions only, so arm C reads it as arm B does. A call to it is a
  repeat only while no other call has run since, so a check in between reads
  the verdict again (plan 4.6, approved by the manager).

- **NEBULA Pilot: the prompts state what the checks judge.** The system
  prompt said the flatten's largest floor in σ (`after_floor_max_sigma`) "≲ 1
  is flat", a limit the flatten's verdict dropped on 2026-10-17; it now says
  the verdict reports it and does not judge it, and that the verdict judges a
  pedestal alone: a floor trend and a span both 0.8 or more, over the outer
  half of the |Q| shells the counts reach, where it said the trend was taken
  over the whole coverage. It said a back-FFT r clearly below 1 flags a
  problem; the transform keeps the data's even part under Q → −Q, so r against
  the data is lower by the odd part (counting noise on unsymmetrised data),
  and the ΔPDF's verdict judges the round trip against the even part
  (`back_fft_pearson_r_even`) to an r of 0.999 or more. It now says so, and
  the ΔPDF review asks what the round trip says, where it asked whether the
  ΔPDF is trustworthy by `consistency_pearson_r`. The flatten review asks for
  the floor trend and span, not the floor in σ; the ring check reads
  `max_ring_left` and `max_ring_dent` at the rings confirmed in 3D, not the
  ring-energy ratio and the over-subtraction; the flatten's criterion no longer
  carries an internal note on who dropped the 1σ limit; and the system prompt
  says the diagnostic context is in the first user message, not "above". These
  words come from the verdict module (`web/src/llm/verdicts/rules.ts`,
  `web/src/llm/metrics/flatten.ts`), so they follow the rules if the rules
  change. The verdicts are unchanged (plan 1.6, the manager's decision on the
  user's delegation, 2026-10-19).
- **NEBULA Pilot: the system prompt's checks name every stage and the data's
  own problems.** They named four, the rings, the Bragg peaks, the fills'
  texture and Qmax, so a reply that settled only those left the run's verdict
  (`{{achieved}}`) not judged, the backfill, the flatten and the 3D-ΔPDF not
  measured. They now name the five stages as `{{achieved}}` names them, each
  with the checks that judge it (the backfill with `texture_check`, the
  3D-ΔPDF with `symmetry_check` and `qmax_coverage`), and the data's own
  problems, which no setting fixes: a UB that is off (`ub_check`,
  `grain_check`), a shifted HKL origin (`ub_check`) and raw counts that end
  inside the box (`qmax_coverage`). The validation's arm C reads the same
  properties as a plain list, in no order and without the checks.

- **The reduction-qc skill says when to turn the flatten's Q² term on.**
  Step 6 said a rising floor wants the term but not when: now, when
  `assess_stage` for the flatten reports `pedestal_left`, turn it on, rerun
  from the flatten and read it again; leave it off otherwise, since on a
  volume without such a background the term fits part of the crystal's own
  floor. It names the stage-level fields `assess_stage` gives. The skill is
  still a draft awaiting the user's interview (validation review, finding 5).
  The skill lines findings 1, 3 and 4 touch come with it: delta-pdf-interpretation
  names `dpdf_peaks` and judges the round trip against the even part, and
  bragg-node-audit reads the fill against the range its rim allows.

- **NEBULA Pilot: the facts about the sample are refused in code.** The
  search's protected planes and the punch cell (`punchProtectH`,
  `punchProtectHalfWidth`, `punchSupercellH/K/L`) change only when the
  user's latest message names them, as the bragg-node-audit skill's firm rule
  says. `update_settings` accepted them from the model before, and only its
  description asked it to wait. The agent loop now hands the tools the user's
  latest message, as the conversation arrived (never what the loop itself
  sends as the user), and `update_settings` refuses a change to a fact that
  message does not name: "punchSupercellH is a fact about the sample, which
  only the user sets: ask the user, and change it once they name it." The
  call's other changes are made, and its result lists both. Each fact's words
  are in `web/src/llm/tune/catalog.ts`: its key; for the protected planes
  "protect…" with "plane(s)", "H fractions", the Configure page's "Search
  skips H" (and a width as well for their half width); for the punch cell
  "supercell", "punch cell", "indexing cell", "doubled cell" or an n×n×n
  cell, all three axes. They name the setting, not the physics: "satellites",
  "modulation", a "plane" or a "cell" alone name nothing, nor does a bare
  "yes". The magnetic ion stays out of the model's reach altogether. The
  tool's description says so (about 22 more estimated tokens with every
  request that offers it). The validation counts a change to a sample fact the task never named
  whether it got through or was refused, since the model tried; a
  candidate finding tells the two apart (plan 4.8, the manager's decision on
  the user's delegation, 2026-10-19).

- **NEBULA Pilot: the skill gate holds within a reply.** A stage's settings
  change, and the stage is tuned, only after its skill has been read in the
  same reply, or while the skill's whole text is in the messages the reply was
  sent. Before, a skill read in an earlier turn still counted in every later
  one, though the chat sends earlier turns as their text alone, so a later
  change passed the gate without the method in front of the model. A change
  in a later turn is now refused with "read the method again: call read_skill
  with name …", which says the skill was read earlier in the conversation but
  its text is not in this reply; once the model reads it again, the change goes
  through. The stage reviews work the same way. A reply's refusal for a skill
  not read before is worded as it was, and a single reply that reads and then
  changes is unchanged, so every validation run (one reply each) and both arms
  are unaffected: the token budget and the validation tests are unchanged, and
  the model-visible snapshots only gain the new refusal. With the skills off
  (arm C) there is still no gate (plan 1.7, the manager's decision on the
  user's delegation, 2026-10-19).

- **NEBULA Pilot: a compacted skill keeps its gates.** In a long reply on a
  local model, the loop shortens the older tool results, and a skill the
  model read was cut to its first 400 characters, which could leave out the
  thresholds and rules the model is to work by. A skill that writes its gates
  under a `## Gates` heading now keeps that section whole when it is
  shortened, beside its name and the same opening as before
  (`web/src/llm/readings/compact.ts`). The section is capped at 1,200
  characters: past that it is cut at a line boundary, with a note of how many
  lines were left out, so the shortened skill stays under 1,800 characters and
  a 32k window still holds the longest turn. A skill without the section is
  shortened as before, byte for byte; no skill has one yet, so what the model
  reads is unchanged until the user writes them. A test per skill turns on
  when it gains the section, and holds that every number in it survives
  (plan 5.3, the code; the manager's decision on the user's delegation,
  2026-10-19).

- **The cut-off note asks for 48k, not 32k.** When a reply is cut off because the model ran out of room, the note now asks for a Context Length of 48k or more, the measured need of a full assessment that reads two skills (about 46k tokens), instead of 32k and "about 18k".

- **NEBULA Pilot: the transform's reach inside full coverage counts as
  coverage OK when an answer is checked.** An answer that says the window
  stays inside the coverage, once `qmax_coverage` finds the reach brought
  inside, is no longer sent back on an older "too far", as `{{achieved}}`
  already read it (the user's decision of 2026-10-19, review entry D1).

- **NEBULA Pilot's report: the 3D-ΔPDF card counts `qmax_coverage`'s "too
  far".** A transform that reaches past full coverage, or a window weight past
  1e-3 on unmeasured space, now needs attention on the card and leaves the
  report's goal not met, as the chat's `{{achieved}}` already said (the
  user's decision of 2026-10-19, review entry D2).

- **NEBULA Pilot: `grain_check`'s "UB off" counts as a problem with the UB.**
  When one small rotation puts the off-lattice peaks back on the Bragg
  lattice, `{{achieved}}` names it among the data's problems ("the UB is off
  by 0.9° (one rotation puts the off-lattice peaks back on the Bragg
  lattice)"), and an answer that calls the UB right is sent back;
  `grain_check` stays the check for a second grain (the user's decision of
  2026-10-19, review entry D3).

- **NEBULA Pilot: Bragg peaks displaced beside their nodes count as a UB
  that is off.** When half or more of the strongest off-lattice peaks
  `grain_check` finds sit beside Bragg nodes, `{{achieved}}` and the
  report's goal name it ("the UB is off by at least 1.2° (the strongest
  off-lattice peaks sit beside Bragg nodes)"), and an answer that calls the
  UB right is sent back, as the report's grain card already said (review
  entry D3a, approved by the manager on the user's delegation, 2026-10-19).

- **NEBULA Pilot: one rule for a turned UB.** `{{achieved}}` and the answer
  checks both call a UB turned at 0.05° or more from an unsymmetrised fit, a
  recording's `angle_deg` included; a symmetrised volume's UB is not judged,
  names no data problem, and an answer that calls it right is still sent
  back. The validation grader's 0.1° stays a rule of its own until the
  answer checks and the graders share one reader (the user's decision of
  2026-10-19, review entry D4).

- **NEBULA Pilot: sharp peaks on the protected planes no longer fail the
  punch.** They stay by design, as the punch's goal says, so its verdict
  leaves them out; `assess_stage` shows them on their own line,
  `leftover_on_protected_planes_sharp` (the user's decision of 2026-10-19,
  review entry D5).

- **NEBULA Pilot: the punch's criterion and report card follow the
  protected planes.** The criterion now reads "no sharp peak left off the
  lattice outside the protected planes", and the report's punch card counts
  the sharp off-lattice leftovers outside them, with those on the protected
  planes on a line of their own, kept by design (review entry D5).

- **NEBULA Pilot: the 3D-ΔPDF's verdict judges its window's raw weight.** A
  window that puts 1.04e-3 of its weight on unmeasured space now needs
  attention in `assess_stage` and is refused by the tuning, as
  `qmax_coverage` already said, though the evaluation shows the weight
  rounded to 0.001 (the user's decision of 2026-10-19, review entry D6).

- **NEBULA Pilot: the ΔPDF window's weight on unmeasured space is shown to
  three significant figures.** `assess_stage` and `qmax_coverage` now show a
  weight of 1.04e-3 as 0.00104, not 0.001, beside a verdict that it is past
  the 1e-3 limit (review entry D6).

- **NEBULA Pilot: an answer is checked against the newest result, as
  `{{achieved}}` reads it.** After a "needs attention", a newer result that
  judged nothing no longer leaves an answer held to the older verdict; a
  missing output or words that are no verdict still hide nothing. On the UB,
  the newer of `ub_check` and `grain_check`'s "UB off" decides, so a later
  `ub_check` that finds the UB right clears an earlier "UB off" from
  `{{achieved}}` too (the user's decision of 2026-10-19, review entry D7).

- **NEBULA Pilot: a UB check on a symmetrised volume no longer hides an
  earlier UB finding.** Such a check cannot judge the UB, so after
  `grain_check` finds the UB off, `{{achieved}}` still names the problem and
  an answer that calls the UB right is still sent back; after an earlier
  `ub_check` that judged the UB, that verdict stands. Alone, it still sends
  back a claim that the UB is right (review entry D7).

- **NEBULA Pilot: an answer that calls the backfill clean is held to the
  fill bias too.** It is sent back when either `assess_stage`'s seam or
  `texture_check`'s fill bias needs attention, whichever ran last, as
  `{{achieved}}` and the report already count both (the user's decision of
  2026-10-19, review entry D8).

- **NEBULA Pilot's report: no ΔPDF evaluation, no verdict on the 3D-ΔPDF.**
  Without one, the report's 3D-ΔPDF card says "not judged" and its goal is
  not judged, as the chat's `{{achieved}}` says; a coverage too far or a
  symmetry not kept still needs attention there (the user's decision of
  2026-10-19, review entry D9).

- **NEBULA Pilot on a local model: a generic question is offered `ub_check`
  and `texture_check`.** "How clean is this reduction?" now gets the UB and
  fill checks the method asks for, at about 800 more tokens a request (the
  user's decision of 2026-10-19, review entry Q10).

- **NEBULA Pilot's report runs `ub_check`, and its goal names the data's
  problems.** The goal line now ends, as `{{achieved}}` does, with the
  problems no setting fixes: a turned UB, `grain_check`'s "UB off", a
  shifted HKL origin, counts that end inside the box. A reply that ran only
  `ub_check` now offers a report (the user's decision of 2026-10-19, review
  entry Q11).

- **NEBULA Pilot: a repeated tool call no longer hides the verdict it
  repeats.** When the model calls a check again with the same arguments,
  `{{achieved}}` and the answer checks read the earlier result the loop
  points to: a `qmax_coverage` "too far" still leaves the run not met, and a
  repeated `ub_check` no longer reads as a right UB (review entry D17,
  approved by the manager on the user's delegation, 2026-10-19).

- **NEBULA Pilot: an older recording's coverage words count against the
  run.** A recorded `qmax_coverage` verdict opening "past", "unmeasured" or
  "not" now needs attention in `{{achieved}}` and on the report's 3D-ΔPDF
  card, as it already did for the answer checks (review entry D10, approved
  by the manager on the user's delegation, 2026-10-19).

- **NEBULA Pilot: a stage with no output is never a pass.** A 3D-ΔPDF that
  `assess_stage` finds missing no longer reads as passing to the answer
  checks, nor overrides an earlier "needs attention"; it is not judged, as
  `{{achieved}}` reads it (review entry D11, approved by the manager on the
  user's delegation, 2026-10-19).

- **NEBULA Pilot: a recorded stage verdict that is no label is judged from
  its numbers.** Where a recording's words are not a verdict ("fine",
  "pass"), the answer checks judge the stage's numbers, as `{{achieved}}`
  does, instead of letting any claim about it stand (review entry D12,
  approved by the manager on the user's delegation, 2026-10-19).

- **NEBULA Pilot: a stage's verdict comes from its numbers, in a reply as in
  the report.** A recorded label the numbers do not give (an older rule's
  "needs attention", say) no longer decides `{{achieved}}` or the answer
  checks; the stage's current rule judges the numbers beside it (review
  entry D18, approved by the manager on the user's delegation, 2026-10-19).

- **NEBULA Pilot's report: the 3D-ΔPDF card counts the evaluation's own
  symmetry break.** A ΔPDF section that breaks a symmetry the data were
  symmetrised with now needs attention on the card even when
  `symmetry_check` was not run or found it kept, as the chat's
  `{{achieved}}` already said (review entry D13, approved by the manager on
  the user's delegation, 2026-10-19).

- **NEBULA Pilot's report: a fill bias counts even when the seam was not
  judged.** A cut filled systematically one way now needs attention on the
  Backfill card when the seam was not measured, or the backfill not at all,
  as the chat's `{{achieved}}` names the backfill's texture (review entry
  D14, approved by the manager on the user's delegation, 2026-10-19).

- **NEBULA Pilot: a 3D-ΔPDF evaluation that measured nothing is not
  judged.** Without a round trip, a window weight or a section symmetry to
  read, the ΔPDF stage and the report's 3D-ΔPDF card say "not judged"
  instead of passing (review entry D15, approved by the manager on the
  user's delegation, 2026-10-19).

- **NEBULA Pilot: a `ub_check` result without an angle is not judged.** A
  recording that kept no turn angle no longer reads as a right UB, so an
  answer that calls the UB off is no longer sent back on it (review entry
  D16, approved by the manager on the user's delegation, 2026-10-19).

- **Sharp leftovers on protected planes are named in the punch's headlines.** They stay out of the punch's verdict by design (D5), with their own line in `assess_stage` and in the report. The report card's headline and the tuning table's headline now say "(N more on protected planes, kept)" whenever there are any, so nothing on those planes goes unsaid. The tuning headline's sharp count now leaves them out, as the verdict does.

- **On a grid too coarse for them, the ring check and the texture check now
  say "not judged", with the reason, and give no verdict.** No evidence never
  passes, applied to resolution: a check that cannot resolve what it judges
  says so. Each limit is the check's own. The powder-ring test (which shells
  rise in nearly every direction, `nebula3d.preprocessing.ring_isotropy`)
  needs one voxel or more across the widest ring it judges (its narrowest
  FWHM, two |Q| bins of half a voxel, within its 0.16 Å⁻¹ cap), and a grid
  that gives at least 90 % of a shell's direction cells 5 voxels in every bin
  of its profile; else "grid too coarse: …" (`grid_too_coarse`, and each
  shell's `not_judged`). The ring removal then subtracts no shell it cannot
  confirm, and its log says how many it could not judge and why (it called
  them the crystal's own); the Pilot's ring check (`assess_stage` rings) is
  not judged, its reason in `ring_rule`, with a bump on its planes or none
  (`GET /api/volumes/{id}/rings` takes no shell too, and gives the grid's
  `not_judged`). The fills' texture (`texture_check`, and
  `nebula3d.analysis.fill_texture` in 3-D) needs the grid's nodes 2·(r + 4)
  voxels apart or more for its median hole, reaching r voxels, to keep its
  rim on its own side of the midpoint to the next node; else a cut says why
  (`not_judged`), measures no bias (`systematic_fill_bias` null), and the
  check passes only when every cut was judged (3-D: `not_judged`,
  `node_spacing`, `room_needed`). It is the voxel's size that counts, not the
  number of points: on the validation's dev crystal, 81 points over ±4 r.l.u.
  are too coarse for both (0.99 voxels across 0.16 Å⁻¹; the nodes 10 voxels
  apart, where the holes' rims need 11 to 14), and 161 points are not (1.99;
  20). The replays' four expected failures at 81³ (a false ring at 1.75 Å⁻¹,
  the crystal's shell at 2.9 Å⁻¹ never seen) and the fill biases
  texture_check flagged there are now "not judged"; on 161³ every known
  answer and arm A are as before. On a fine grid nothing changes but the
  shells near |Q| = 0 whose direction cells the grid cannot fill (under 1.1
  to 1.2 Å⁻¹ at 0.081 Å⁻¹ a voxel): those are now not judged.
- **On a grid too coarse to confirm a ring, the ring removal subtracts no
  unconfirmed ring, and says so.** A behaviour change: the pooled ring removal
  confirms its rings with the powder-ring test (`pooled_confirm_rings`, on by
  default), so on such a grid it confirms none of the shells it detects and
  subtracts none of them, powder rings included, where before it would have
  subtracted what the test, unable to resolve them, called rings (the
  manager's decision on the user's delegation, 2026-10-19, review finding G1).
  It says so out loud: its log line ends on a notice, marked ⚠, such as "4
  ring candidates (shells that may be powder rings or the crystal's own
  scattering) detected but not confirmed at this grid (needs ≥ 1 voxel across
  0.16 Å⁻¹); not subtracted. Use a finer grid, or, from the Python API, set
  pooled_confirm_rings=False to subtract every candidate, the crystal's own
  shells included." (of one: "1 ring candidate (a shell that may be a powder
  ring or the crystal's own scattering) … to subtract it, even if it is the
  crystal's own shell."), with the count and what the grid needs, from the
  test's own constants (`grid_needs`), and the two ways out, the second
  subtracting the crystal's own shells too. Its diagnostics record it
  (`unconfirmed_at_grid`: the count, the need, the notice, the shells' |Q|),
  served by the new `GET /api/rings/{id}/diagnostics` (the bridge's
  `ring_diagnostics_json`), so the console says it wherever the ring stage
  reports: the Execution page shows the stage's line as a warning, the
  Pilot's ring check (`assess_stage` rings) gives it first (`notice`), the
  report puts it on its ring card and among its caveats, and `run_log` shows
  the line. The validation's arm C reads the notice without its remedy (a
  remedy span, `verdicts/rules.ts`). The verdict on the run says why the ring
  removal is not judged, "not judged: the ring removal (grid too coarse for
  the ring check)", where it said "not measured since it was last computed"
  (the report's goal likewise). On the validation's dev crystal at 81 points
  the removal leaves three shells unconfirmed on dev-rings, the two planted
  rings among them; at 161 points none, and its log reads as before.
  `pooled_confirm_rings` is a setting of the Python API: the console does not
  offer it.

- **Fixed: on a volume whose counts end inside the ring range, the ring
  removal took every local maximum for a ring candidate.** The pooled ring
  removal bins |Q| from 1.5 to 10.5 Å⁻¹ whatever the volume holds, and its
  noise floor (a candidate rises 6 × the profile's noise, `pooled_min_snr`)
  counted the empty and sparse bins, which the detection fills flat: their
  differences are 0, so where the counts end well inside the range the noise
  fell to 0 (on the validation's dev crystal, with the counts ending anywhere
  from 4 to 5.5 Å⁻¹) and the floor went with it. The flood of candidates was
  judged and rejected, so nothing was subtracted on a fine grid, but their
  keep-outs crowded a real ring's flanks, and its powder-ring test drew its
  line through two or three bins (a signal-to-noise of about 1e16) and
  skipped its curve check. On a grid too coarse to confirm a ring, the
  coarse-grid notice listed the flood as ring candidates, and its remedy,
  `pooled_confirm_rings=False`, subtracted them: on the validation's
  dev-coverage case (counts cut at 4.51 Å⁻¹, no ring) at 81 points, 10 false
  shells, 9.4 % of |I|. The noise now comes from adjacent pairs of measured,
  non-sparse bins only, and is infinite with none (nothing is then a
  candidate); where every bin is measured it is the same as before. On
  dev-coverage there is now no candidate and no notice at either grid, and
  the remedy subtracts nothing; a strong ring is judged on two clean flank
  bins a side, with its curve check. A weak ring under the 6σ floor goes
  undetected, as with full coverage. The shells kept out of a judged ring's
  flanks are now picked at half the detection cut, 3σ: a keep-out only
  protects a flank and is never subtracted, so the lower bar is the cautious
  side, and a weak ring under 6σ beside a strong one no longer lifts the
  strong one's flank until it fails. The 97-point demo of the tests (±3
  r.l.u., counts ending at 7.55 Å⁻¹) reaches the bug: it now subtracts the
  aluminium rings at 2.69, 3.11, 4.38, 5.12 and 6.76 Å⁻¹ (14.1 % of |I|),
  where it also subtracted the weak 222 and 420 lines at 5.36 and 6.95 Å⁻¹
  (17.6 %); the 420, now under 6σ, is kept out of the 331's flank, which it
  would otherwise lift until the 331 failed. On a fully measured volume the
  lower bar can keep the crystal's own bumps out of a ring's flanks too (on
  the validation's dev-rings at 161 points the 2.2 Å⁻¹ ring is judged without
  its curve check, still a ring). The ring-removed volume of every dev case
  at 81 and 161 points, and of the console's demo volume (161 points over
  ±4 r.l.u.), is the same as before, bit for bit (review finding B3; the
  manager's decisions on the user's delegation, 2026-10-19 and 2026-10-24).

- **Docs: the browser build's ring test has a known limit near `min_snr`.**
  In low-memory mode (the browser) the ring test reads at most an eighth of
  the volume's voxels for the shells, so a confirmed ring's signal-to-noise
  drops by up to about 2.6×, and a ring just above the rule's `min_snr` can
  be confirmed natively and left in the browser. docs/web.md ("Native and
  browser parity") says so; the validation is unaffected, since its live runs
  use the native server. A parity test pins it as a strict expected failure
  (`tests/test_native_browser_parity.py`: a planted ring that measures a
  signal-to-noise of 3.8 natively measures 2.1 in the browser), which fails
  the run once a fix lifts the limit. Whether the browser should sample
  more, at a memory cost, is a question for the user after v1. Nothing in
  the pipeline changed for it.
- **Cosmetic: the flatten's summary prints a zero R² as `0.000`.** A constant
  fit's R² is 0 up to rounding, of either sign, and the browser printed it as
  `R² -0.000` where the native engine printed `0.000`. The summary now drops
  the sign of a zero; every other R² prints as before.

- **On a grid too coarse for its background shell, the Bragg punch no longer
  punches the nodes its node test cannot judge.** A behaviour change: the
  node test (`integer_detect="significance"`, the default) takes each node's
  background from the median of the measured voxels between 1× and 2× the
  resolution ellipsoid R, and a median needs 8 of them (the test's own floor,
  now named `_SHELL_MIN_VOXELS`). With fewer it fell back, silently, on the
  window's median, which passes the diffuse at a node: on the validation's
  dev crystal at 81 points (0.161 Å⁻¹ a voxel) the shell held 2 to 6 voxels
  at 96 % of the nodes, and 29 to 106 forbidden nodes per case were punched,
  a quarter to a half of the punched voxels, all diffuse. Now a node whose
  shell holds fewer than 8 measured voxels, counted node by node (the count
  varies with the direction of Q, the mask and the box's faces), is not
  judged. With `mode="both"` (the default) it is left to the search pass,
  which punches a peak if it stands out of its |Q| shell; a search peak
  inside the window of a node left to it (the box the node test searches) is
  that node's Bragg peak, the brightest if there are more: its record takes
  the node as `source_node_hkl` and says the search found it (`found_by:
  "search"`, where the node test's peaks say `"integer"`), and it is punched
  and learned from like the node test's peaks, so the punch learns its Bragg
  profile from both (the profile records how many were the search's,
  `footprint_profile.from_search`). Bragg peaks the search cannot see may
  remain: below its floors, or in a |Q| shell too thin for it (under 20
  voxels, at the box's far corners, where they can be strong). With
  `mode="integer"` the node is judged against its window's median as before,
  provisionally (the manager's decision on the user's delegation, 2026-10-19,
  review finding G2). The grid's limit comes from R and the floor: the shell
  is 7 times R's Q-volume, so 8 voxels need a voxel of (7π/6)·rρ·rθ·rφ or
  less, 0.143 Å⁻¹ a cubic voxel at the default R
  (`BraggRemover.node_test_limit`; a voxel's size is the edge of a cube of
  its Q-volume, `voxel_edge_q`). On a grid coarser than that the punch says
  so out loud: its done line ends on a notice, marked ⚠, such as "grid too
  coarse for the Bragg punch's node test: a voxel is 0.161 Å⁻¹; its
  background shell needs ≤ 0.143 Å⁻¹. 703 of 728 nodes were not judged and
  were left to the search pass; Bragg peaks the search cannot see may
  remain. Use a finer grid." (with `mode="integer"`: "… were judged
  provisionally, against their window's median; diffuse maxima at nodes may
  be punched. Use a finer grid."). Its line on the integer nodes counts them
  on any grid, the search's line how many of its peaks were their Bragg
  peaks, and its record (the punch's profile JSON) keeps them as
  `node_test`, served by `GET /api/bragg/{id}/profile` and the bridge's
  `bragg_profile_json`, with each peak's `found_by`. The Execution page shows
  the punch's done line as a warning; `run_log` gives it as written. On the
  dev cases at 81 points no forbidden node is punched any more (on the ring
  cases the four and two on the planted 4.05 Å⁻¹ ring, which the ring
  removal leaves at this grid, aside), the ⟨3/2 0 0⟩ correlation the
  forbidden punches had cut to 0.77–0.79 on three cases is back to
  0.89–0.93, and broad maxima planted at the (1,1,0) nodes go unpunched. The
  search finds the Bragg peaks there (172 on the control, with the node
  test's 8 the 180 its profile is learned from) and misses those at the box's
  corners. At 161 points every node's shell holds 9 voxels or more: nothing
  is left to the search, and the punch, and arm A, are as before.

- **A sample's modulation can be declared, and the Bragg punch records what its
  search left alone; no run changes yet.** A modulation of wave vector k puts
  satellites at G ± m·k, which the punch's search pass takes for spurious
  peaks. `PipelineParams.modulation` declares it as a fact about the sample,
  beside its symmetry (`nebula3d.modulation.Modulation`: the k vectors as
  exact fractions, the order, the form and the half width). In the points form
  (the default) it protects the satellites G ± m·R·k, R over the point group.
  In the planes form it protects the planes through them, `t·x ≡ ±m·(k·t)
  (mod P)`. Either way it is on the parent lattice of the punch's cell, and
  the protection is the same at every equivalent position, so the punch shared
  across the symmetry orbit keeps it.

  Until the console asks the user (plan 4.15), a run that declares nothing
  declares the planes the search protected before, H = n ± 1/3 ± 0.08 r.l.u.,
  as k = (1/3, 0, 0) in plane form. That reproduces them bit for bit: on every
  dev case of the validation at 81 and 161 points the punch's holes, records
  and log are as before, and arm A is unchanged. For Python callers:
  - `PunchParams.search_exclude_h_fractions` now defaults to None. Its legacy
    fields still protect what they name, added to the declaration.
  - A direct `punch_bragg` call protects only the `modulation` it is given.
  - The request's `punch_search_protect_h` and `punch_search_protect_half_width`
    keep their meaning.

  The punch's record (`*_braggpunched_profile.json`, served by
  `GET /api/bragg/{id}/profile` and the bridge's `bragg_profile_json`) keeps
  what its search left alone (`modulation`: the declaration, the cell, the
  symmetry, the legacy planes) and whether its sharp peaks off the lattice
  bunch at one commensurate fraction (`bunching`), as an undeclared modulation
  would make them. The test is a binomial tail, family-wise at 1.35·10⁻³
  (one-sided 3σ) over the coordinates and denominators the grid resolves, with
  at least three hits; its log line says so when it fires, and it fired on no
  dev case.

  `POST /api/modulation/check` (the bridge's `modulation_check_json`) says what
  a declaration protects before a run. `GET /api/modulation/{id}/labels` (the
  bridge's `modulation_labels_slice`) gives which protected position each voxel
  of a slice of the punched stage lies in, read from the run's record, not the
  form. `peak_profile.magnetic_satellite_centers` no longer assumes the thirds:
  its `fractions` are the caller's to give.

  The physics, the record and a known limit are in `docs/modulation.md`: the
  recorded peak widths cannot tell a broad maximum from a sharp one.

- **A peak the punch's search protects now comes through the search whole.** A
  behaviour change (bug fix) wherever the flank of a protected peak was
  punched. Protected peaks are the declared modulation's satellites or planes
  (`PipelineParams.modulation`) and the legacy `search_exclude_h_*` planes.
  - **The bug.** The search left a protected position's voxels out of its
    candidates and also out of its local-maximum test, where they counted as
    −∞. So the voxel beside a protected peak could be a local maximum, and
    above the search floors it became a search peak whose punch took the
    protected peak with it.
  - **The fix.** The protected voxels count in the local-maximum test with
    their own values, so a voxel beside a brighter protected peak is its
    flank, not a peak. They are still never candidates, and no search peak's
    punch takes them. The node test, the integer pass's punches, the incident
    beam's punch and every threshold are unchanged. With nothing protected the
    search is as before.
  - **On test data.** On 6/m test data with satellites wider than their
    ± 0.08 r.l.u. protection, 198 of 216 satellites were punched with the
    points declared, and none are now. With the planes declared none were
    punched before or after. Satellites nobody declared are all still punched.
  - **On the validation.** With today's default (the planes H = n ± 1/3),
    the dev cases' punched holes, records and log at 81 and 161 points are as
    before, and arm A is unchanged. `docs/modulation.md` has the numbers.

- **The console declares the sample's modulation, and NEBULA Pilot reads what
  a run's search left alone from the run itself; no run changes until the
  default flips (plan 4.15's P3).** Behaviour-neutral: with the default
  declaration, every dev case of the validation reads the same verdicts,
  leftover marks and numbers as before, at 81 and 161 points, and the
  bunching test fires on none of them, so no dev run asks anything.
  - **The Configure page.** The punch's "Search skips H" and "± width" become
    the sample's modulation, four fields kept as typed: *Modulation k*
    (r.l.u., several separated by `;`; `none` declares none, blank leaves the
    backend's default), *Form* (points or planes, the user's to declare),
    *Order m* and *± width*. Under them, the backend says what they protect
    on the punch cell and the volume's symmetry
    (`POST /api/modulation/check`; in the browser build, once its engine is
    up). A run's request carries `modulation`, never the legacy
    `punch_search_protect_h` and `punch_search_protect_half_width`, which the
    backend still reads.
  - **The migration.** A form the browser remembered before (per dataset)
    has its protected H planes migrated once, when the console starts. An
    explicit value becomes k = (f, 0, 0) in plane form: "1/3, 2/3" is
    k = (1/3, 0, 0). `none`, or a half width of 0, declares none; a half width
    alone keeps the old default's planes at that width; a blank one stays
    blank.
  - **The marks follow the run, not the form.** The leftover scan marks a
    leftover off the lattice as on a protected position from the run's own
    punch record (`GET /api/modulation/{id}/labels`, read on the cut's grid).
    It no longer reads the Configure form, which could differ from what the
    run used, nor a second copy of the default in TypeScript (gone, with
    `parseFractions`). The punch's assessment counts them the same way, and
    so does its verdict, which leaves them out (D5). A run from before the
    punch kept its record marks none, and says so.
  - **The question.** When a run's sharp peaks off the lattice bunch at one
    commensurate fraction, `assess_stage` (the punch) and `run_pipeline`
    carry `off_lattice_bunching`: the facts, and `ask_user`, a question such
    as "14 of the 17 sharp peaks off the lattice sit at H = n ± 1/3, where
    about 2 would by chance. Does the sample have a modulation with
    k = (1/3, 0, 0)?". Two answer checks send an answer back once, then note
    it. One fires when a result carries the question and the answer asks
    none naming the fraction or the modulation (`unasked`). The other fires
    when the answer says outright that the sample has the modulation
    (`assumed`; hedged clauses are exempt). With the skills off, the
    send-back names no tool, stage or skill. The system prompt says what
    the field is, and the report lists the question among its caveats.
    With the setting's own text in `update_settings`, a local run's
    requests grow by about 175 estimated tokens with the skills on.
  - **The gate.** To the model the modulation is one sample setting,
    `modulation`, in `configure_settings` and `update_settings`. The model
    sets it only when the user's latest message names it: by "modulation", a
    wave or propagation vector, a k written out, or the protected planes'
    words. These words are provisional, the user's to confirm. "Satellites"
    alone still names nothing. In the validation, declaring a modulation the
    task never named counts as an unsafe action, as any sample fact does.

- **Nothing is protected by default: the punch's search leaves a position
  alone only where the sample's modulation is declared.** A behaviour change
  for every run that declares no modulation (the user's decision,
  2026-10-19; plan 4.15, P3). `nebula3d.pipeline.default_modulation()`
  returns None, and so does `PipelineParams.modulation` by default.
  - **What such a run now punches.** Until now a run that declared nothing
    left the planes H = n ± 1/3 ± 0.08 r.l.u. alone (the H fractions 0.3333
    and 0.6667, and their symmetry images). Its search now punches the sharp
    peaks it finds there too, satellites or spurious alike, as anywhere else
    off the lattice. Its punch record says `declared: null`, and the
    bunching test reads every sharp peak the search found off the lattice:
    when they bunch at one commensurate fraction, H = n ± 1/3 among them, the
    punch says so in its log and NEBULA Pilot asks the user whether the
    sample has that modulation.
  - **On the validation's dev cases.** All eight, at 81 and 161 points: the
    search finds no peak off the lattice, on those planes or elsewhere, so it
    punches nothing more. At 81 points its peaks (110 to 172 a case, 14 on
    dev-coverage) are all at nodes; at 161 it finds none, every node being
    judged by the node test. The punched volumes, their holes, peak
    records and logs are as before; only the record's `declared` is now
    null, and the bunching test fires on none. Arm A on dev: the 24 runs'
    scores, detections and digests are as recorded, 5 of 8 cases pass.
  - **To keep the old protection,** declare it: `{"k": "1/3, 0, 0", "form":
    "planes"}` (the Configure page's *Modulation k* `1/3, 0, 0` with *Form*
    planes), which protects the old planes bit for bit.
  - **The legacy request fields keep their meaning.** `punch_search_protect_h`
    protects the H fractions it names (`[]` none); a half width alone sets
    the half width of what is declared, and with nothing declared protects
    nothing. A blank *Modulation k* on the Configure page sends no
    declaration and so declares none.
  - **A remembered form that set only the protected planes' half width**
    (the old default's thirds at that width) is migrated to declare none,
    its width kept for a modulation you declare: the thirds were one
    sample's. Declare `1/3, 0, 0` as planes to keep them.

- **The flatten's shell floors, over the whole volume.** The flatten fits its
  pedestal to the floor of each |Q| shell (the 25th percentile of the shell's
  measured voxels, 0.05 Å⁻¹ shells), and the floors after it say whether a
  pedestal was left: a rising one is most often the inelastic background,
  which the Q² term takes. The Pilot reads them on three planes through the
  origin. `nebula3d.preprocessing.shell_floors` measures them over every voxel
  of each shell, on the flatten's own shells (on its input they are its own
  levels, value for value), with each shell's measured and total voxels, its
  median, and for the flattened stage the input's floors on the same shells
  and the diffuse level the pedestal's span is a share of (server:
  `GET /api/volumes/{id}/shell-floors`; browser:
  `webbridge.volume_shell_floors_json`, with the same fields). The flatten
  now records its settings in its output (`read_flatten_settings`), and the
  measurement takes them unless asked otherwise, so a run is measured on its
  own shells and percentile; they come back with its fit range. It reads the
  volumes a slab at a time and selects each percentile from histograms
  narrowed pass by pass: 29 MiB at its peak on a 401×401×301 float32 volume
  and its input in the browser's low-memory mode, 74 MiB natively, in 3 s,
  the same numbers in both. On a synthetic isotropic Q² pedestal the planes and the
  volume read the same pedestal; with the pedestal kept off those planes,
  only the volume sees it. Measurement only: the Pilot's verdict does not
  read it yet.

- **NEBULA Pilot: the flatten is judged over the run's own fit range and
  floor percentile.** Its numbers (the floors in thirds of |Q|, the largest
  floor in σ, the floor trend and span over the outer half of the shells the
  counts reach) were taken over the flatten's default fit range, 0.8–10 Å⁻¹,
  at the 25th percentile, whatever the run took. They are now taken over the
  range and at the percentile the run's flatten recorded in its output,
  which the volume's meta returns (`GET /api/volumes/{id}/meta` and the
  browser's `volume_meta_json`, `flatten_settings`; `null` for a stage the
  flatten did not write). The Configure page's settings are not read for it:
  they may have changed since the run, and only the file says what made it.
  A file written before the flatten recorded its settings is judged with the
  defaults, as before, and `assess_stage` and the chat's context say so. A
  run with the default settings reads as before (plan 4.11, the manager's
  decision on the user's delegation, 2026-10-19).

- **NEBULA Pilot: the flatten's pedestal is judged over the whole volume.**
  Its verdict read the shell floors of the three planes through the origin
  (the largest trend and span of the three), which see a background only
  along their own directions: a pedestal off them was missed, and the
  crystal's own diffuse in them read as a trend. It now reads the floors of
  every voxel of the flatten's own shells (`GET
  /api/volumes/{id}/shell-floors`, the browser's
  `volume_shell_floors_json`), by the same rule over the outer half of the
  shells the counts reach, from the run's own fit range: a trend and a span
  both 0.8 or more of the diffuse level are a pedestal left. `assess_stage`
  gives them as `floor_trend` (signed), `floor_span_fraction` and
  `floor_judged_q` (the |Q| range judged), where it gave the planes'
  `max_floor_trend` and `max_floor_span_fraction`; each plane's numbers stay
  under `per_plane`, and the largest floor in σ over the planes is still
  reported and not judged. An evaluation recorded before reads by the planes'
  numbers, as then. On the validation's dev cases no verdict changes, at 81³
  or at 161³: at 161³ the planted |Q|² background is found (trend 0.996,
  span 1.30) and the controls are not (trend 0.16 or less, span 0.65 or
  less), whose trends read as high as 0.93 on the planes. The 0.8 limits are
  as they were set on the planes (plan 4.1, the manager's decision on the
  user's delegation, 2026-10-19).

- **Fixed: with the flatten off, the ΔPDF transformed a flattened volume left
  by an earlier run.** `nebula3d.pipeline.run_pipeline`, which the server and
  the browser run, finds each stage's input by walking back the cleanup
  stages, and it took the flattened volume on disk even with the flatten
  switched off (`PipelineParams.flatten_enabled=False`, the page's flatten
  switch). A run with the flatten off after one with it on then transformed
  the old flattened volume, its background removed, while its log said
  "flatten disabled (no background removed)" and `PipelinePaths.pdf_input`
  named the backfilled one; without *force* it even kept the first run's ΔPDF
  and back-FFT check as current. A stage switched off now passes its input
  through without reading an output an earlier run left, in the processed
  folder or among a tuning trial's inputs: the ΔPDF takes the run's
  backfilled volume, and a ΔPDF made from another volume is recomputed. When
  the flatten is off, the ΔPDF stage's log names the volume it transforms
  ("flatten disabled: the ΔPDF transforms …, with no background removed"),
  in the browser's WebGPU path too. Runs with the flatten on, and with it off
  from scratch, give the same outputs as before, bit for bit.

- **Fixed: the Configure page's *Enable stage* switches for the ring removal,
  the Bragg punch and the backfill did not switch the stage off.** The page
  sent them only as stages left out of the run, and
  `nebula3d.pipeline.run_pipeline`, which the server and the browser run,
  reads a stage left out as a partial re-run: the next stage took that
  stage's output an earlier run had left on disk. With the ring removal off
  after a run that wrote its volume, the punch read that ring-removed volume,
  not the raw input, and the run's outputs were the earlier run's. Each of the
  three now has its own switch, as the flatten has
  (`PipelineParams.rings_enabled`, `punch_enabled`, `backfill_enabled`), which
  the page sends with every run (`StageParamsIn` on the server, the same
  fields in the browser). A stage switched off is not run and passes its
  input through: the next stage reads what came before it, never an output an
  earlier run left, in the processed folder or among a tuning trial's inputs,
  and the browser's WebGPU ΔPDF takes the same volume as the CPU path. Its own
  output from an earlier run stays on disk as it was, as the flatten's does.
  The log names the volume the stage after it reads ("ring removal disabled:
  the Bragg punch reads …"). A stage left out of the stages to run with its
  switch on is still a partial re-run, as the assistant's runs from a stage
  and the tuning's trials need. Runs with every stage on, and with a stage off
  from scratch, give the same outputs as before, bit for bit. As before, a run
  with *Force* off keeps the outputs that exist: after switching a stage off,
  turn *Force* on for the stages after it to be recomputed.

- **The fills' texture, on every punch hole in 3-D.** Fills systematically
  brighter (or darker) than the diffuse around their holes print a texture
  with the lattice's period, which the 3D-ΔPDF turns into features at the
  lattice vectors. The Pilot's `texture_check` judges each filled hole
  against the range its measured rim allows, on three cuts, where a hole
  crossed at its edge reads differently from one crossed at its centre and
  peaks off those planes are seen at their edges or not at all.
  `nebula3d.analysis.fill_texture` applies the same rule to every hole of
  the volume, the hole and its rim taken in 3-D: the holes from the punch's
  record (`nebula3d.pipeline.read_punch_record`), the rim the voxels 1 to 4
  out that the fill left as they were, the Pilot's trend, range, bias and
  limits (kept as parameters). It returns each hole's facts, the Pilot's
  summary and the shares of holes beyond the floor each way (server:
  `GET /api/volumes/{id}/texture` on a backfilled stage; browser:
  `webbridge.volume_texture_json`, with the same fields). On synthetic
  lattices a fill equal to the truth reads no bias, half the level too high
  in 80 % of the holes a systematic bias with 0.800 of them above, and the
  backfill's Laplace fill none; with satellites beside the nodes, all filled
  12 % high, the volume reads nodes and satellites alike, while the per-cut
  rule reads the satellites it crosses at their poles under the floor. It
  labels the holes a slab at a time: 7.4 MiB at its peak on a 401×401×301
  float32 pair with 6000 holes in the browser's low-memory mode, 23 MiB
  natively, in 1.4 s, the same numbers in both. Measurement only: the
  Pilot's verdict does not read it yet.

- **The Pilot judges the fills' texture over every punch hole in 3-D.**
  `texture_check` judged the fill bias on three cuts, where a hole crossed at
  its edge reads against a rim that lies off its node, and a peak off those
  planes (a satellite) is crossed at its pole or not at all. It now judges
  it by the volume's 3-D read (`nebula3d.analysis.fill_texture`, through
  `GET /api/volumes/{id}/texture` or `webbridge.volume_texture_json`): every
  hole with its 3-D rim, by the same rule and the same limits, which it asks
  for (`metrics/texture.ts`: a fifth of the local diffuse level, 0.5σ, three
  quarters of the holes one way, five holes judged). Its result is the
  summary over the holes (`n_holes`, `n_judged`, the medians in σ and in the
  level, the shares above and below the range and beyond the floor,
  `systematic_fill_bias`); on a grid too coarse for the holes' rims it
  measures no bias and says why (`not_judged`), as a cut did, and with fewer
  than five holes judged it gives no verdict either. The cuts carry the
  azimuthal texture only (`per_cut`: `cut`, `azimuthal_ratio`), and the
  figure is the H–K plane through the hole farthest outside its range. The
  verdict reads the 3-D summary; a result recorded by cut reads as it did.
- **A fill texture not judged keeps the run from "met".** No evidence never
  passes: as the ring removal on a grid too coarse for its check (G1), the
  fills' texture that `texture_check` could not judge, for a grid too coarse
  for the holes' rims or for too few holes (a new reason, "too few holes"),
  makes the run's verdict not judged, saying why: "not judged: the
  backfill's texture (grid too coarse)", or "(too few holes)", in
  `{{achieved}}` and in the report's goal ("Backfill's texture"), where it
  read "met" when every stage met its goal. The Backfill card still shows
  its seam's verdict, and its fill bias "not judged". A recorded result that
  judged nothing (no cuts) says nothing of the run, as before.
- The report's Backfill card says the fill bias over the holes ("no fill
  bias over 189 holes"), the backfill's criterion "the fills not biased one
  way", and the system prompt "no fills sitting systematically outside the
  range their rims allow". On the validation's dev cases the texture's
  verdicts are as before: at 161 points none of the eight has a systematic
  bias (the medians within 0.07 of the level, where the cuts read up to
  0.14), and at 81 points all eight are not judged, the grid too coarse for
  the rims in 3-D as on the cuts, so the control's run at 81 points is "not
  judged: the ring removal (grid too coarse for the ring check), the
  backfill's texture (grid too coarse)". On the constructed lattices of the
  Python half the verdict follows the volume: a fill equal to the truth
  passes, half the level too high in 80 % of the holes needs attention (0.8
  of them beyond the floor), satellites filled 12 % high as their nodes are
  read alike (every node and whole satellite beyond the floor), and a grid
  too coarse is not judged. What the model reads is smaller: 370 characters
  where 802 were on the synthetic crystal, and the worst local turn 263
  tokens less; a shortened result now keeps the 3-D numbers, where the cuts'
  list kept none.

- **On a grid too coarse for the Bragg punch's node test, the fills' texture
  in 3-D is now "not judged".** A behaviour change: where the punch's record
  (its profile JSON beside the punched stage) carries its node test's notice,
  a voxel too coarse for the background shell the test reads, so the punch
  left the nodes to its search pass (review finding G2), the 3-D texture read
  (`nebula3d.analysis.fill_texture`, `GET /api/volumes/{id}/texture`, the
  bridge's `volume_texture_json`) judges no fill, whatever room its holes
  leave their rims: `not_judged` is "grid too coarse (the punch's node test
  could not resolve the holes at this grid)" and `systematic_fill_bias`
  false, the holes and the summary measured as before. The reason opens with
  the words every reason the grid gives opens with, so the Pilot reads it as
  a grid too coarse (`isTooCoarse`). The notice is read from the record
  (`nebula3d.pipeline.read_node_test_notice`, new; `fill_texture` and
  `judge_fill_bias` take it as `node_test_notice`): no new limit, the punch's
  own 8-voxel shell floor (the manager's decision on the user's delegation,
  2026-10-24, review finding G3). On a coarse grid the holes are the search's
  peaks, each punched to its own width, and the rim's room no longer stands
  for its trend: on the validation's dev crystal at 81 points the holes reach
  1 voxel at the (111) nodes and 2 at the (200) ones, so on the dev-coverage
  case, whose counts end before the higher nodes, the median hole left its
  rim room by the rule's count (10 voxels, as far apart as the nodes), while
  the rim, 4 voxels deep, spanned 0.2 to 0.5 r.l.u. from the node and read the
  diffuse rising toward the next nodes; the read judged its fills and found a
  systematic bias above (0.52σ, 0.21 of the level, 14 of 15 holes) that was
  the rims', not the fills'. Now every dev case at 81 points is not judged
  for this reason (seven were before, by the room rule); at 161 points, where
  the node test resolves every node, every dev case's read is as before, hole
  for hole, and so is arm A.

- **NEBULA Pilot's `qmax_coverage` measures the coverage once, in Python.** It
  measured it twice: on the three principal planes in the browser (a voxel
  "measured" when finite) and in `nebula3d.analysis.coverage` (a voxel holding
  counts when measured, finite and non-zero). It now reads the Python module
  alone, through either adapter (`GET /api/volumes/{id}/coverage`, the
  webbridge's `volume_coverage_json`), on the raw volume's |Q| shells in 3D;
  the planes only show where. `full_coverage_q` is where the shells stop
  holding counts in 95 % of their voxels, the number `raw_counts` gives, so a
  box measured to its corners now reads full coverage past its faces (the dev
  control: 10.85 Å⁻¹ on 81³, where the planes read the face, 6.44). The result
  drops `per_plane` and `low_q_gap` (`raw_counts` gives the lower edges) and
  is about half as long (1,147 characters on the synthetic crystal, from
  2,135). The coverage response also gives `measured_q_max`, where the shells
  stop being fully measured (the ΔPDF window's support), and `q_step`, the
  shells' width.
- **The coverage verdict on a volume that stores zeros for unmeasured space.**
  Such a volume marks the zeros measured: the ΔPDF window's support takes them
  as data and the backend fits no window to the coverage, while the old check
  counted them as measured too and passed. `qmax_coverage` now reads where
  the counts end, says the taper cannot follow them, and needs attention when
  the transform reaches past them, with a |Q| band as the remedy. A separable
  window the Configure page asks for is no longer taken as tapered to the
  coverage: the backend fits only an auto or ellipsoid window. No dev case's
  verdict changes kind; those whose verdict rests on the reach (no recorded
  window weight: five on 81³, three on 161³) give the new full coverage.

- **NEBULA Pilot's coverage verdict says what it can judge.** With the ΔPDF's
  window fitted to the coverage (the support on, an auto or ellipsoid window),
  the backend keeps at most 1e-3 of the window's weight on unmeasured space,
  shrinking the window where it must, and `qmax_coverage` judged that weight
  against the same 1e-3, so its "clean" held by construction. It now opens "fitted to the
  coverage", says the weight (or, with no ΔPDF weight recorded, the taper's
  reach) is the backend's own target, not a check, and judges what it can:
  where the raw counts end (batch 1's sentence and data problem, as before)
  and a |Q| band that is set, which needs attention past the counts' edges
  ("too far: Qmax past the counts' upper edge …", the reason `band past
  counts`), the user's rule; inside them it passes. Without the fit (the
  support off, a separable window, zeros stored past the counts) the verdict
  judges the weight or the reach as before, and no longer says the window's
  taper keeps the transform on the counts. A band set without a Qmin starts
  at 0, as the run takes it: `band_check` no longer calls it below the
  counts' lower edge when the counts begin at the origin. On the dev cases no
  verdict changes kind: dev-ub, dev-origin and dev-coverage (and dev-rings
  and dev-rings-shell on 161³) now open "fitted to the coverage".

- **NEBULA Pilot: `symmetry_check` tests the symmetry off the x–y plane.** It
  compared the 3D-ΔPDF's x–y section at one height with its images under the
  cell's in-plane operations only, so a ΔPDF could break an operation that
  moves c (a mirror ⊥ c, a two-fold ⊥ c, a cubic three-fold, the inversion)
  and pass; on the section through the origin even the two-fold ∥ c held by
  the inversion alone, which the transform keeps. It now tests each operation
  of the point group the raw file declares (`symmetry_ops`, closed into its
  group, acting on real space as its transpose) on the sections the operation
  maps onto sections: the x–y sections at `z` and −`z`, and the x–z and y–z
  sections through the origin, read as before. An operation that maps none of
  them onto one is tested on the voxels it maps from one onto another; one
  that mixes axes whose grid steps differ is not tested, and `not_tested` says
  why. The ΔPDF is centrosymmetric by construction, so an operation and its
  product with the inversion give the same number: they are one entry ("two-fold
  ∥ c / mirror ⊥ c"), and m-3m's 47 operations read as 24. Each entry reports
  `rms_difference` (its worst section's), `pairs`, and `tested_on`, the
  sections it was compared on, those off the x–y plane included.
  The limit stays 1e-3, and an operation that moves c is judged as one that
  keeps it. Only the declared group is judged: a lattice operation the declared
  group lacks (the mirrors ⊥ a and ⊥ b of data symmetrised with 4/m on a
  square cell, the four-fold of mmm) is no longer tested, and the ΔPDF
  evaluation's `max_symmetry_break` (`assess_stage` for the ΔPDF, the tuning,
  the report's card) tests the same group, those of its operations that map
  the x–y section through the origin onto itself. With no operations declared,
  the cell's in-plane ones are tested, as before, now on the x–z and y–z
  sections too. Where no operation can be tested the verdict is "not judged",
  and says why, never a pass. Known answers on constructed ΔPDFs, and
  dev-control symmetrised over m-3m through the default run (every operation
  within 2e-7), pin it (plan 4.3, the manager's decision on the user's
  delegation, 2026-10-19).

- **Behaviour change: `compute_delta_pdf` with no window now applies the
  pipeline's, a gaussian of σ 0.4, instead of hann.** Its defaults (and
  `_prepare_forward`'s) were `apodization="hann"`, `gaussian_sigma=0.5`, while
  the pipeline's ΔPDF stage (`DeltaPdfParams`) runs `"gaussian"`, 0.4, so a
  Python API call with no window transformed differently from the stage. A
  script that relied on the old default passes `apodization="hann"` to keep it.
  The pipeline, the server, the browser and every caller in the package pass
  their own window and are unchanged. The ring texture order stays 8 on the
  page and 6 in the package (`RingParams.n_fourier`), on purpose: it reaches
  only the patched and parametric ring models, not the default pooled one. A
  comment at each says so, and `tests/test_defaults_agreed.py` pins both,
  with the window's defaults against `DeltaPdfParams`.

- **Behaviour change: the back-FFT consistency view transforms what the run
  transformed, as the run did.** The view (the Q–R Band Transform page,
  `GET /api/consistency/{id}/meta` and its slices and save,
  `webbridge.consistency_meta_json` in the browser) built its round trip with
  the package's ΔPDF defaults, a gaussian of σ 0.4 with the auto window and
  the support on, whatever the run had used, and on the flattened volume
  whenever one was on disk: after a run with hann, another σ, a separable
  window or the smooth background subtracted, or a ΔPDF made from another
  volume, its metrics and panels described a transform the run never made. It
  now takes the volume the run's ΔPDF was made from and its window, σ, shape
  and support, padding and subtractions from the ΔPDF, which records them in
  its provenance (`source_file` and `transform_config`, read back by
  `nebula3d.pipeline.delta_pdf_settings_from_config`). The |Q| range stays
  full, by design, and the band is the one applied in the view. The response
  says where both came from (`settings.source`: `"run"`, or `"defaults"` when
  the dataset's ΔPDF records no transform, as one written before the record
  does not; `settings.input`, the record's `made_from` when `same_input`, else
  the flattened volume, else the backfilled one), with a `note` for every
  fallback, and names the settings a partial record lacked (`defaulted`); the
  page's header shows the window and whose it is. A band saved from the view
  records the transform it was made with. After a run with no crop and no |Q|
  band, the view with no band applied now reproduces the run's own saved
  check. The browser build's results are pinned against the native ones
  (docs/web.md, "Native and browser parity").

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

- **NEBULA Pilot: `dpdf_peaks` says how its entries are grouped, and gives an
  orbit its multiplicity and its copies' mean size.** The backend groups the
  3D-ΔPDF's extrema by the point group the dataset's raw file declares, else
  by sign, length and size (`nebula3d.analysis.dpdf_features`, plan 4.4). The
  tool now passes that on: `grouped_by` names the rule (`"declared symmetry
  (m-3m: 48 operations, r ≡ −r)"`, `"sign, length and size (no symmetry
  declared)"`, or why a declared symmetry was not applied), and an entry
  grouped by the declared symmetry gives its copies' mean size
  (`mean_size_sigma`) beside the largest, and the orbit's distinct vectors,
  one per ± pair (`multiplicity`), beside the vectors found (`n_vectors`).
  Grouped by sign, length and size there is no orbit, and every size is
  within 5 % of the largest, so an entry gives neither and reads as it did:
  on the validation's dev cases, which declare no symmetry, the result grows
  only by `grouped_by`. The default limit stays 12 entries, and the tool's
  description is unchanged.
- **Requirement change: a local live run needs at least 56k of context
  (57,344 tokens), up from 48k (49,152).** NEBULA Pilot's worst turn on a
  local model was measured with the 3D-ΔPDF's strongest features as a
  synthetic handful; it now carries a full list, the validation dev control's
  at `dpdf_peaks`' default (`web/src/llm/__tests__/tokenBudget.test.ts`, the
  list recorded from the dev-data bridge), and reaches about 47.6k tokens with
  the reply reserve, 1.5k under the old minimum. The run policy (`RUN_POLICY`
  in `web/src/llm/evals/validationModels.ts`) now holds it with at least 3k
  free, which the budget test asserts. The validation's runner, the scenario
  evals (`npm run eval:agent`) and the local tier (`npm run eval:local`)
  refuse a window under 57,344 tokens, before the first run and before each:
  load an LM Studio model with a Context Length of 57344 or more
  (`lms load <model> --context-length 57344`), and use an Ollama model that
  supports at least that. The console's guidance (the context warning, the
  window's refusal, the connection settings, the hint when the context is
  full and the note when a reply is cut off) suggests 56k. The guard's
  budgets and what the model reads are unchanged.

- **Regrid a dataset onto its refined UB, as a new dataset.** A UB turned by
  a fraction of a degree puts each Bragg peak beside its node, by the angle
  times |Q|. `nebula3d.analysis.ub_regrid.regrid_dataset` refines the raw
  volume's UB as `ub_check` does (one shared `check_ub`, so the turn it acts
  on is the one the check reports), regrids the volume onto it, and writes
  `<stem>_regridded.nxs` beside it. The new file records the UB before and
  after, the fit, the turn and the file its data came from (server:
  `POST /api/datasets/{id}/regrid`; browser: `webbridge.dataset_regrid_json`,
  with the same fields). It never overwrites: the raw file is only read, and
  the new one must lie in the data root, must not exist, and is created
  exclusively. When the fit cannot turn the UB, nothing is written and the
  reason comes back as data: a symmetrised volume without its unsymmetrised
  source, or a turn under the check's 0.05° rule. Symmetrising is optional
  and off by default; a symmetrised dataset keeps its operations. On
  synthetic crystals turned by 0.3° the turn comes back within 0.0015°, and
  the peaks sit on their nodes again. The Pilot's tool for it comes later.

- **NEBULA Pilot: `regrid_refined_ub`, the regrid onto the refined UB.** The
  Pilot's tool for `nebula3d.analysis.ub_regrid.regrid_dataset` (plan 4.7):
  it regrids the selected dataset's raw volume onto its refined UB, with the
  UB check's fit (the punch cell's Bragg nodes and `q_max`, as `ub_check`
  takes them), and writes `<stem>_regridded.nxs` beside the raw file as a
  new dataset, never over a file (server: `POST /api/datasets/{id}/regrid`;
  browser: `webbridge.dataset_regrid_json`; the client's `regridDataset`).
  The backend's refusals come back in its own words, nothing written: a turn
  under the UB check's 0.05°, a symmetrised volume without its unsymmetrised
  source, a file or dataset id in use. It is the user's to run: it runs only
  when the user's latest message asks for a regrid by name ("regrid",
  "re-grid", its own name, or `refine_ub.py`), the gate `update_settings`
  holds a fact about the sample to, and is refused otherwise ("A regrid
  writes a new dataset, which only the user asks for: nothing was written.
  Ask the user, and regrid once they ask for it."). A local model is offered
  it only for such a message, so the validation task's offer is unchanged;
  the console's requests carry its definition, about 253 more estimated
  tokens. It selects nothing and runs no pipeline: the run's stages are as
  before, and the new dataset is reduced only when the user runs it. The
  evals never run it, as they never start a run. On the dev case with a
  turned UB the regrid writes the new dataset, and `ub_check` on it reads no
  turn (0.037° at 81 points per axis, 0.001° at 161, from 0.565° and 0.601°).

- **The ΔPDF's features are grouped by the declared symmetry.** When the raw
  file declares the point group its data were symmetrised with
  (`symmetry_ops`), the extrema that are images of one another under it are
  one entry, to within one voxel. The operations act on the ΔPDF's fractional
  coordinates as their transposes, in the cell the file records; on a
  hexagonal cell that differs from the operations themselves. An entry lists
  its strongest vector first and gives the orbit's `multiplicity`, the
  extrema found (`n`) and their mean and largest size; `grouped_by` says how
  the list was grouped. Positive and negative extrema never merge, and the
  limit counts entries. With no symmetry declared, or none that fits the
  recorded cell, the list is as before (`GET /api/deltapdf/{id}/features`,
  `webbridge.dpdf_features_json`, `nebula3d.analysis.dpdf_features`).

- **NEBULA Pilot: no verdict without its evidence, numbers by reference, and
  verdicts computed from the checks (THY-18).** A verdict on a stage needs its
  tool after the last run that recomputed that stage, not before it; a ring
  verdict needs `assess_stage`, the ΔPDF's correlations `dpdf_peaks`, the
  origin `ub_check`. The model writes a tool's number as `{{tool.field}}`,
  which the app fills in from the result. Whether the run met its goal,
  `{{achieved}}`, is computed from the checks the reply ran, shown under the
  reply and at the head of the report, and an answer that calls the run a
  success it does not give is sent back. Replay tests on the validation's dev
  cases cover each rule.

- **The flatten's verdict no longer holds its floors to 1σ (the user's choice; provisional).**
  The σ is the flattened cut's own spread and the floors follow the diffuse
  level, so all eight validation dev volumes read 1.5 to 1.8σ and "needs
  attention", the clean control and the planted case after its Q² term
  included. The verdict now rests on the pedestal rule, which separates them;
  the largest floor in σ is still measured and reported. The user chose to
  drop the 1σ limit (2026-10-17) over keeping or widening it (validation
  review, finding 6).

- **`texture_check` no longer flags a sound fill of a node-peaked diffuse.**
  It compared each fill with its rim's median in rim σ, and flagged all three
  cuts of the validation's clean control: the diffuse peaks at the nodes
  (thermal diffuse scattering), so a sound fill sits above that median, and σ
  shrinks with the counts. A fill is now compared with the range its measured
  rim allows, from the diffuse at the hole's edge carried in to its rise
  continued to the node (voxels the fill itself wrote are not rim), and a
  bias counts only when it is also a fifth of the local diffuse level or more
  (`median_fill_bias_level`; `above_fraction` and `below_fraction` replace
  `brighter_fraction`). No dev case is flagged; fills set off by a fifth of the
  level are (validation review, finding 4; the floor is provisional).

- **`dpdf_peaks`: the 3D-ΔPDF's strongest features, with their vectors and
  signs.** The validation's task and the delta-pdf-interpretation skill ask
  for each feature's vector, sign and size, and no tool gave them. The new
  tool (server: `GET /api/deltapdf/{id}/features`,
  `nebula3d.analysis.dpdf_features`) lists the volume's local extrema above a
  few robust σ outside the origin's disk, one per ± pair, each with its
  vector in Å and in lattice units (to a fraction of a voxel), its sign and
  its size in σ, those of one sign, length and size grouped. Planted
  correlations come out at their vectors with their signs (validation
  review, finding 1).

- **The flatten's pedestal is judged where a pedestal shows.** On the dev
  case whose counts end at 4.5 Å⁻¹, `assess_stage` said a pedestal was left
  where the planted truth has none: after a constant flatten the floors
  follow the crystal's own diffuse level, a hump at 1.7 Å⁻¹ and its fall,
  and over the short range a cut leaves that fall reads as a trend (the
  full control reads the same over the same shells). The trend and span are
  now taken over the outer half of the shells the counts reach (at least 95 %
  measured), where an inelastic background rises fastest and the diffuse's
  own oscillation is damped (`floor_judged_q`); the floors' thirds skip
  unmeasured shells, so a cut volume has them. On the eight dev cases only
  the planted |Q|² background reads as a pedestal (validation review,
  finding 8; the range is provisional, as the 0.8 limits are).

- **The back-FFT check judges what the transform keeps.** The ΔPDF is the
  real part of the Fourier transform, the transform of the data's even part
  under Q → −Q, so on unsymmetrised data r against the data measures their
  odd part, counting noise: every dev case of the validation read 0.979 to
  0.996 and failed the ΔPDF's 0.999 gate with a sound transform. The check
  now also compares the round trip with the even part (`pearson_r_even`,
  1 to rounding on all of them) and reports the odd share of the data's
  variance (`odd_share`); `assess_stage` and the report judge
  `pearson_r_even`, and a check saved before judges r only on data declared
  symmetrised (validation review, finding 3).

- **`qmax_coverage` says when the counts end inside the box.** Its verdict
  read "clean" on a volume whose counts end at 4.5 Å⁻¹ of a 6.4 Å⁻¹ box, the
  window's weight just under its limit, and the edge sat only in
  `raw_counts` and `suggested_band`. With no |Q| band set, the verdict and
  `band_check` now give the edge, the box face and the band the counts
  allow (validation review, finding 7).

- **`ub_check` gives a shifted origin's size.** The peaks' mean offset from
  their nodes in r.l.u., before and after the fit (`mean_offset_rlu`): a UB
  error averages out over the nodes and the fit removes it, while a shifted
  HKL origin moves every peak by one vector that stays. When the offsets are
  unexplained by any UB and that vector makes most of them, the check names
  the shift (`origin_shift_rlu`); on the dev origin case it reads
  (0.0305, 0.0195, 0) r.l.u. for the (0.03, 0.02, 0) put in (validation
  review, finding 2).

- **Text outside ASCII in a SaveMD file reads back right in other HDF5
  readers.** A run log, title or attribute with characters outside ASCII (a
  file name such as `Fe₃Ge₂_Å.nxs`) was stored as UTF-8 bytes labelled ASCII,
  so readers that trust the label, such as h5wasm-based web viewers, showed
  `Feâ‚ƒGeâ‚‚_Ã….nxs`. Such text is now labelled UTF-8; ASCII text keeps
  Mantid's type (`nebula3d/io/mantid_nxs.py`).

- **NeXus Viewer exports in the Mantid layout keep their symmetry.** The
  viewer now exports its symmetrized volumes as Mantid MDHistoWorkspace files
  the way NEBULA3D writes them, with its `source_file`, `symmetry` and
  `symmetry_ops` as attributes of the `nebula3d` group. NEBULA3D reads them
  there (`nebula3d.io.hkl_reader.declared_attrs`), so the declared symmetry
  still reaches every stage, the volume's meta and the UB check; older exports
  with the attributes on `/entry` read as before.

- **Does the Pilot help? A validation on synthetic cases with a planted truth.**
  `python -m nebula3d.validation` builds sixteen cases (eight faults, each in a
  dev and a held-out test split from another crystal), scores any arm's outputs
  on the planted correlations, and runs the default pipeline (arm A) and the
  scorer's reference (arm D). The Pilot's two arms, with and without its skills,
  have a runner, a transcript every run leaves, a findings schema and a model
  configuration with a spend cap; none has run a model yet. Arm B is the Pilot
  as shipped, including the tools it offers a local model; arm C is B without
  `read_skill` and the skills' listing, tested; each run records the tools
  offered on every request. The protocol and
  arm A's results are in `docs/evals.md`, the review of the tools and skills it
  began with in `docs/pilot-review.md`.
- **The ΔPDF is not called symmetry-broken when the file declares no symmetry.**
  `symmetry_check` and `assess_stage` for the ΔPDF read the asymmetry of every
  unsymmetrised volume (counting noise) as a break by a stage. A file that
  declares none is now "not judged", with the asymmetry still reported.
- **`assess_stage` for the flatten says whether a pedestal is left.** The
  report's own rule (a floor trend and a span both 0.8 or more) is one function
  now, stated as `pedestal_left` and in the headline, where the Q² term's
  question had two numbers to combine.
- **A local tier for NEBULA Pilot's evals.** `npm run eval:local` takes a
  local model through the eval scenarios and the held-out fault scenarios,
  after showing what the shared machine's model servers hold and how much
  memory is free, then checks the acceptance: at least 80 % of runs pass, no
  reply reaches the round cap or is ended by the loop guard, and no run ends
  in an exception; server failures are listed by kind
  (`web/scripts/eval-acceptance.mjs`).

- **A local model gets fewer tools at a time.** NEBULA Pilot offers a local
  model the reading tools every question needs and the ones its question is
  about, and the acting tools (settings, runs, tuning) only when the message
  asks for an action, not when it asks whether to. A question about the rings
  sends well under 60 % of the tools' definitions. A tool the model calls by
  name all the same still runs and stays offered, as does one an answer check
  asks for; cloud models get every tool.

- **A long NEBULA Pilot reply on a local model keeps its numbers in less
  room.** Once a request passes about 24k tokens, the reply's older tool
  results go back to the model shortened to their verdicts, headlines and
  numbers (the newest three stay whole), so the request stays inside a 32k
  window with room to reply. A request too long for the window is shortened to
  its newest result before it is refused. The model can call a shortened tool
  again for the whole result, and the answer checks read the whole results.

- **NEBULA Pilot does not go round in circles.** A tool call repeated with the
  same arguments, with nothing changed in between, is not run again: the model
  is pointed at the result it has. After two rounds in a row that brought
  nothing new, the model is asked to answer with what it has, and the reply
  notes it. The evals count such replies, and those that reach the round cap.

- **NEBULA Pilot rides out a failing model server.** A request that fails the
  way a local server on a shared machine does is asked again after a pause:
  the model crashed (most often out of memory) or was unloaded, the connection
  dropped, or the server sent nothing for minutes. What still fails ends the
  reply with a note that says what happened and what to do, keeping the steps
  that ran, instead of an error. The evals record such failures by kind, apart
  from wrong answers.

- **NEBULA Pilot never has its prompt cut to fit a local model.** Ollama is now
  reached through its own chat API, which takes a context length per request:
  each request gets a window that holds it and room for the reply, within the
  model's longest, and a model another app already runs with a window that
  holds the request keeps it, so it is not reloaded under that app. Before,
  Ollama ran the OpenAI-style endpoint at a length set
  by the machine's memory, 4k on a small machine, and dropped the start of a
  longer conversation without a word. A request longer than any window the
  model supports, or than the one LM Studio loaded it with, is not sent: the
  reply says how to fix it.

- **The 3D-ΔPDF refuses a grid without Q = 0 on its centre voxel.** The
  transform takes index n // 2 of each axis as Q = 0. On an even grid with a
  bin edge at 0 that voxel sits half a step off, and every feature at x was
  multiplied by cos(2π·δ·x) without a word. The stage now names each axis that
  is off, by how much, and the fix (re-bin with a bin centred at 0, or crop
  symmetric about 0), and transforms nothing. The cleanup stages run on any
  grid.
- **σ is read when the file has it, and the agent is told when it has not.** A
  NeXus Viewer export's `/entry/sigma` is read. Without one, σ is √|I|, and on
  normalized values the punch's significance test depends on the arbitrary
  intensity scale: `describe_dataset`, the punch's log line and `assess_stage`
  for the punch now say so. Each stage's output records whether its σ came
  with the data.
- **The browser's ring check keeps enough of every shell.** In the browser's
  low-memory mode the 3D ring check read an eighth of the volume's voxels,
  thinned alike over every shell, so the small shells near |Q| = 0 kept only a
  few directions: the demo's two lowest aluminium rings went unjudged and
  stayed in. Each shell now keeps about 32 voxels per direction cell and |Q|
  bin; on the demo the browser's ring stage matches the native one bit for
  bit.
- **Fixed, from a review of the latest work:**
  - A tool result past the size limit is trimmed to valid JSON (the longest
    lists and texts go first, named under `left_out`), and the answer checks
    judge the whole result: a cut-off result had let "no ring is left" pass
    against a ring check that needs attention. An earlier answer no longer
    vouches for the numbers of the next.
  - A smooth hump under a shell, or a shell at the noise level, is no longer
    a ring: a quarter of its height must stay above a quadratic through the
    flanks, and it must stand three times the flanks' scatter above them (to
    confirm with the user).
  - `assess_stage` checks what its criteria state: the 3D-ΔPDF's verdict
    judges the worst in-plane symmetry break, and the answer checks hold a
    verdict on the ΔPDF to it.
  - `ub_check` on a volume binned so that its declared symmetry operations
    cannot map the grid fits the rotation and the cell instead of failing,
    and says why the symmetrisation was not judged.
  - The number tracing reads numbers as written: thousands separators, signs,
    exponents in either case, and a round integer as precise as its last
    non-zero digit.
  - `qmax_coverage` no longer reports a box face at 0 Å⁻¹ on a volume that
    holds only half of reciprocal space.
  - `GET /api/volumes/{id}/rings` takes finite, positive shells only.
  - The docked NEBULA Pilot leaves the page 45 % of the room beside the
    sidebar, as intended.

- **A ring must rise in every direction.** A shell in |Q| is now a powder ring
  only if it stands above the diffuse beside it in nearly every direction over
  the sphere: at least 0.15 of its median height in 90 % of 128 direction
  cells, judged in 3D on the raw volume (to confirm with the user). The
  crystal's own scattering at one |Q| rises in some directions only.
  - The pooled ring removal subtracts only confirmed rings. A crystal with no
    rings keeps all of its diffuse: on the held-out synthetic volume the
    removal had taken 3 % of the intensity, up to a third of the diffuse near
    4.1 Å⁻¹. The demo volume's aluminium rings are removed as before, and the
    held-out rings lose 95 % and 96.5 %. `pooled_confirm_rings=False` restores
    the old behaviour.
  - `assess_stage` judges each bump the planes show the same way, through the
    new `GET /api/volumes/{id}/rings`. Its rule that rings are bumps seen on
    two planes is gone: symmetry makes planes equivalent (all three on a
    cubic cell), so the crystal's own scattering shows on each.
  - `assess_stage` with `stage=all` leaves out the stages' goals, and a ring
    result its noise-level bumps, so both fit the tool-result limit; one stage
    at a time still gives its goal.
- **Held-out evals with injected faults.** Five synthetic volumes that no
  eval, tuning or prompt was written on, each with one fault of a known size
  (`nebula3d.faults`): a turned UB, a shifted HKL origin, counts cut short in
  |Q|, and powder rings. `ub_check` measures 0.602° of a 0.6° turn, and says
  when no UB change explains the peaks' offsets. The counts' edge reads 4.507
  Å⁻¹ against 4.511, and both rings are found at their |Q|. The CI replays a good
  and a bad answer per scenario (`NEBULA_EVAL_SET=heldout` runs them on a real
  model). The set also found that the ring check read a cubic crystal's
  short-range-order diffuse as rings, and that the default ring removal
  subtracted part of that diffuse from a crystal with no rings (below).
- **Fixed:** the answer checks no longer call a sentence about the Bragg peaks'
  offset from their nodes an unmeasured verdict on the punch. They also catch
  "No ring is left" against a ring check that needs attention: the leading "No"
  was read as an answer word.

- **NEBULA Pilot's answers stand on their evidence.** Before you read a final
  answer, the agent checks it three ways:
  - a verdict on a stage needs the tool that measures it in this reply;
  - every number must come from a tool result or the context;
  - no claim may contradict a verdict a tool computed.

  `assess_stage` now returns each stage's verdict, *meets its goal* or *needs
  attention*, with the rule behind it, by the report's own criteria. An answer
  that fails goes back to the model once, with what to fix; what still fails
  is noted under the reply. In the eval replays, five of the nine research
  scenarios' failures are now caught by these checks alone: a ring verdict
  from the opening cut, a punch called clean that missed peaks, a second
  grain the tool rules out, and a UB called right that the fit turned or could
  not judge.
- **NEBULA Pilot has skills: the user's methods, read on demand.** Three
  drafts live in `.claude/skills`, where Claude Code reads them too:
  - `reduction-qc`: the UB, the symmetrisation, the |Q| edges and the
    coverage, edge and unmeasured voxels, the rings and the flatten;
  - `bragg-node-audit`: allowed and forbidden nodes, off-lattice peaks and the
    backfill, ported from the scattering-agent-tools skill;
  - `delta-pdf-interpretation`: what a feature's sign means, the trust checks
    and the artifacts that imitate signal.

  Each gives the steps in order, marks the judgment calls still to confirm
  with the user, and ends with a checklist and the failure modes. The system
  prompt lists only their names and descriptions, and the new `read_skill`
  tool reads one, or a document it cites. A firm rule rides on them: a
  stage's settings change, and the stage is tuned, only after its skill has
  been read in the conversation. Otherwise the call is refused, with the skill
  to read. The questions for the user's interviews are in
  [docs/SKILL_INTERVIEWS.md](docs/SKILL_INTERVIEWS.md).
- **NEBULA Pilot docks beside the page instead of covering it.** It takes its
  own column, and the page reflows beside it, so a figure the Pilot points at
  is never hidden under the panel. Drag the column's edge to resize it, or
  collapse it to a slim rail; the width is remembered. On a portrait tablet or
  a phone it is a bottom sheet under the page, resizable and collapsible the
  same way. With *Follow* on, the figure it works on is scrolled fully into
  view beside it. The pages' layouts follow the width they are given, so the
  cleanup views fall into fewer columns beside the dock instead of shrinking.

- **NEBULA Pilot has an eval suite, measured on real models.** Nine scenarios
  with known answers from the research rounds on a measured volume
  are graded deterministically, on the tools each model called and on what it
  answered. Numbers are checked against the run's own tool results. CI replays
  every scenario with a scripted model; `npm run eval:agent` runs real ones.
  Results, raw records included, are in [docs/evals.md](docs/evals.md):
  - Claude Sonnet 5.5 and Haiku 5.5 pass 27/27 each, at about $0.025 and $0.001
    a run.
  - gemma4:26b and qwen3:32b on Ollama pass 15/27 and 17/27; both answer the
    ring and punch questions from the opening cut.
  - qwen3.8-27b on LM Studio passed every run that finished, but most crashed
    for lack of GPU memory on a shared machine.

  Claude requests now cache the system prompt and tools, plus a breakpoint
  that follows the conversation, so about 90 % of their input is billed at the
  cache-hit rate. An eval never starts a pipeline run. The records and the
  replay fixtures name no sample: a sample written as a formula in a dataset
  id becomes sampleA, sampleB, … wherever it appears.
- **The UB can be refined from where the Bragg peaks sit.**
  `nebula3d.analysis.ub_refine` (and `examples/refine_ub.py`) finds each
  Bragg node's peak and fits one of four UB changes:
  - a rotation;
  - the cell, with the parameters the symmetry leaves free;
  - both;
  - only what commutes with the symmetry operations.

  The fit works from low |Q| outward, and the volume can then be regridded
  onto the refined UB, after the coverage edge is trimmed (its voxels can sit
  orders of magnitude above the interior, and symmetrising would spread
  them). A volume symmetrised under its operations hides a
  misorientation as rings around the nodes, so it takes the last fit alone;
  the orientation needs the unsymmetrised data. Peak centres are windowed
  centroids. A centroid of the voxels above half height overstated sub-voxel
  offsets by a third, which read a cell 1 % off as 1.3 % off. See
  [docs/algorithms/ub_refinement.md](docs/algorithms/ub_refinement.md).
- **NEBULA Pilot can check the UB.** `ub_check` (and
  `GET /api/volumes/{id}/ub`) runs the UB refinement on the raw volume, with
  the punch cell as the Bragg nodes. It reports how far the peaks sat from
  their nodes before and after, the cell, the rotation, and the peaks'
  radial offsets by |Q| band. On a symmetrised volume it says that only what
  the symmetry keeps could be fitted. An unsymmetrised volume takes its
  symmetry from the symmetrised export that names it as its source, to
  constrain the cell.
- **Each peak is punched to its own width.** The punch's default footprint
  is now `own`: along H, K and L each peak's line-cut FWHM (half-maximum
  crossings interpolated) defines a Gaussian, punched out to where it falls
  to the stopping level over the local noise. The shared Bragg profile,
  kept as `punch_footprint="profile"` (*Profile-matched (shared width)* on
  the Configure page), gave a sharp spike on a broad maximum the wide punch
  of a Bragg peak of its height. On measured data, own widths punched a
  smaller share of the broad maxima, so no maximum lost half its box. They
  left no more Bragg residue, with slightly more of the volume punched. Most
  peaks were punched to their own width; the rest keep the shared profile.
  **This changes the default punch mask.**
- **NEBULA Pilot can tell a second grain from displaced Bragg peaks.**
  `grain_check` groups the off-lattice peaks the punch's search found into
  symmetry orbits and tests the strongest two ways:
  - against the Bragg nodes: an orbit within a quarter of the node spacing
    is a Bragg peak displaced, and its offset over |Q| bounds the rotation
    from below;
  - as a rotated copy of the Bragg lattice (a second grain), against the
    same search at random directions. A rotation under 2° is the UB, not a
    grain.

  On measured data it tells Bragg peaks displaced by a UB that is off from a
  second grain. A volume's metadata now carries the symmetry its file
  declares. The agent's context counts the peaks the search punched off the
  lattice: a model had read the leftover count, which is only what the
  punch missed on one cut, as "no off-lattice peaks".
- **NEBULA Pilot writes an analysis report.** A reply that assessed, tuned
  or ran the pipeline gets a *Report* button. The report reads in the app
  and exports as a self-contained HTML page, which prints to PDF, or as
  Markdown. Its numbers come from a fresh measurement pass with the agent's
  own tools, never from the model's text. It holds:
  - the five stage checks, each judged by its stated goal;
  - the coverage, the raw counts' |Q| edges and the symmetry;
  - figures of the cleanup stages and the 3D-ΔPDF sections, drawn as the
    viewers draw them;
  - the dataset, the settings and sample facts, what the agent did, and the
    tuning trials with why each was kept or refused;
  - the caveats: every check that misses its goal.
  The model's answer appears as a labelled summary, with the model and
  provider named. Each check states, in a sentence, the rule its verdict
  follows. When the punch has run, the report also tests for a second
  grain: it flags a grain, or Bragg peaks displaced by a UB that is off.
- **The ΔPDF's |Q| band can come from the raw data.** The data's own Qmin and
  Qmax are where the counts begin and end: past either edge most voxels
  hold none. `GET /api/volumes/{id}/coverage` measures, per |Q| shell, the
  share of voxels holding counts (measured, finite and non-zero), and where
  it crosses one half. The Configure page shows the edges under the |Q| band,
  with a *From raw data* button that sets the band to them. `qmax_coverage`
  reports them, suggests the band, and says whether a band that is set stays
  inside the counts.
- **The |Q| band slider spans the whole box.** It stopped at the corner of a
  ±(4, 8, 15) r.l.u. crop that the ΔPDF does not apply: on a measured volume
  it ended well before the counts did.
- **The 3D-ΔPDF page's Auto shows the features, not the FFT ripple.** Auto
  put the colour limit at the 97th percentile of |ΔPDF|, but a ΔPDF section
  is mostly ripple around a few compact features, so that percentile
  measured the ripple. On a measured volume, the old limit saturated every
  feature and the ripple filled the colour range. Auto now takes the 99.9th
  percentile over the three centre sections, with the origin's
  self-correlation disk left out. The features carry the colour and the
  ripple stays near the neutral colour.
- **NEBULA Pilot can optimise the ΔPDF view's contrast.** `dpdf_contrast`
  sets the 3D-ΔPDF viewer's limit by the same rule in one call. It reports
  the robust σ, the strongest feature, and what other percentiles would
  give and in which direction. It warns when a range the user asks for is
  brighter than the optimum. In a first version every call applied its
  limit, so a model trying a 5σ limit left the viewer there; now only the
  chosen limit is applied.
- **NEBULA Pilot warns before a small context window cuts replies off.**
  LM Studio loads a model with a fixed context length, often 4k or 8k. With
  Tools on, NEBULA Pilot's first request alone is about 8k tokens, so such a
  model broke off its first reply. NEBULA Pilot now reads the length the
  model was loaded with from LM Studio. Below 32k it shows above the chat
  how far to raise it, up to what the model supports. LM Studio unloads an
  idle model and loads it again on the next request with the model's default
  settings (here 8k again, hours after a manual 70k load), so the warning also
  covers a model that is not loaded, names the model's default Context Length
  as what to change, and is read again whenever a reply starts or ends, on
  connecting, on a model change and when the page regains focus.
  The connection help gives the Context Length for LM Studio and
  `OLLAMA_CONTEXT_LENGTH` for Ollama.
- **Tuning no longer trades a clean ΔPDF for a higher SNR.** The ΔPDF
  stage was judged on feature SNR and the round trip alone, though its
  goal requires the transform to stay inside the measured coverage. On a
  measured volume a tuning run chose a separable window for a little more
  SNR. That window put far more of its weight on unmeasured reciprocal space
  than the ellipsoid window, and broke the ΔPDF's symmetry. The stage's
  evaluation now reports the window's weight on unmeasured space and the x–y
  section's worst symmetry break. A trial past the backend's own limit
  (10⁻³, where its automatic window gives up the separable shape) is not a
  candidate while your settings stay inside it, and the reason is given.
- **Tuning no longer tries a punch setting that cannot act.** With the
  default profile footprint, the punch replaces the covariance fit's radii
  with the learned profile's, so freeing those radii from their bounds
  changed nothing: the trial's output was byte-identical. The tuning
  catalog now offers that setting only with the ellipsoid footprint.
- **A reply that fails keeps what it did.** An error from the model server
  late in a reply emptied it from the chat: after a 23-minute tuning run,
  LM Studio rejected the final report mid-stream, and the transcript kept
  only the question and the error. The run's steps, the tuning card and the
  text written so far now stay, with the error as the reply's note. When
  the error is the model writing a reply its server cannot parse (LM
  Studio: "does not match the expected … format", here a tool call in the
  wrong syntax; Ollama: "error parsing tool call"), the same request is
  sent again, up to twice, before the reply gives up. No tool runs twice.
- **Each plane's ring verdict follows the cross-plane rule.** A bump seen
  on one plane only is the crystal's own scattering, and the ring review's
  totals already left it out. Each plane's detail still named it as that
  plane's worst leftover ring, and a model reported such bumps as
  misses of the ring removal. Each plane's residuals now mark them
  `single_plane_bump`, and its worst dent and leftover skip them.
- **`\DeltaPDF` reads as ΔPDF in the chat.** Models often write the
  ΔPDF as `\DeltaPDF`, which the chat left as typed, since a TeX command
  ends at the next non-letter. A Greek letter or symbol command now also
  ends at a capital letter, as a model means it, and a TeX control space
  (`10\ Å`) reads as a space. `\lesssim`, `\gtrsim` and the other common
  relations, and `\%`, read as their symbols too.
- **Names keep their underscores in the chat.** Models often write field
  names such as `ring_energy_ratio` without backticks, and the chat's
  Markdown took the underscores for italics: the name read
  "ringenergyratio". As in CommonMark, an underscore inside a word is now
  a literal, and `*` or `_` makes emphasis only where it touches its text
  (`5 * 3 * 2` stays as written).
- **A reply cut off by a full context no longer breaks the conversation.**
  When a local model ran out of room in the middle of a tool call, NEBULA
  Pilot sent the half-written call back with the next request, and LM
  Studio failed that request and every later one with a bare HTTP 500.
  A reply that stopped for lack of room now ends the turn with a note on
  how to give the model more room, and none of its tool calls run. A call
  whose arguments are not JSON is sent back as `{}`. A bare HTTP 500 from
  the model server now says what usually causes it.
- **NEBULA Pilot can check the ΔPDF's symmetry.** `symmetry_check`
  compares a ΔPDF section with its images under the cell's in-plane
  operations and says which hold. Five expert reviews of a measured
  volume had missed a clear break of its symmetry, which no tool could see.
- **A symmetrised volume gives a symmetric ΔPDF.** The ring removal, the
  backfill and the flatten each work on index-space neighbourhoods that the
  hexagonal six-fold does not map onto themselves. On a measured volume the
  ΔPDF lost a clear share of its symmetry: equivalent Bragg peaks kept tails
  on one side of the backfill and not the other. With the declared symmetry
  (`symmetry="auto"`, the default), these stages now average their output
  over each orbit (and the backfill's band and the ring stage's spoke mask
  are closed under the group). The ΔPDF's partners, its strongest equivalent
  features included, agree to rounding.
- **The conversation survives a reload.** Reloading the page emptied
  NEBULA Pilot's transcript and the unsent draft. Both are now kept for the
  tab (sessionStorage, up to about 1 MB of the newest turns) and come back
  after a reload; *Clear* forgets them. A reply still being written is lost,
  and its question says it was cut off.
- **A full context window says how to fix it.** When a local model's
  context window is too small, NEBULA Pilot showed the server's raw
  message. It now adds what to do: in LM Studio, raise the model's Context
  Length in its load settings to 32k and reload it; start Ollama with
  `OLLAMA_CONTEXT_LENGTH=32768`. With Tools on, the first request alone
  is about 8k tokens, and a full assessment reaches about 18k.
- **A tuning run's report holds every trial.** It returned only the chosen
  trial, so asked for each trial's numbers the model made one up ("12
  sharp leftovers" for a trial whose numbers matched the baseline's
  exactly). The report now lists every trial's changes and numbers. A
  trial whose numbers equal the current settings' is marked `no_effect`.
  When no setting changed, it no longer suggests rewriting the outputs.
- **The coverage check reads the window that actually ran.** It judged the
  transform by one reach radius from the Configure page's settings: on a
  measured volume it reported a box-face taper that was not used. The ΔPDF
  now records the share of its window's weight on unmeasured reciprocal space
  (`window_open_weight` in its provenance and in the ΔPDF metadata, with the
  window's shape and scale). `qmax_coverage` gives that share as its verdict:
  negligible on the measured volume, so clean.
- **The flatten can take a background that rises with |Q|.** Its model
  fitted a constant (plus the magnetic form factor), so on a measured
  volume the diffuse floor still climbed steadily across the coverage
  after the flatten. Inelastic background rises like that
  (thermal diffuse scattering, and with X-rays Compton scattering), starting
  out as Q². A *+ b·Q² term* switch (`flatten_q2`) adds it to the
  model. Like the other terms it varies only on the scale of the whole
  range, so pair correlations survive. Q² is only the leading term of a
  rise that saturates, so past the fit range's end the term is held at its
  value there. *Fit to |Q|* (`flatten_fit_q_max`) carries the fit past its
  old 10 Å⁻¹ end. The examples take `Q2=1` and `FIT_Q_MAX`; the punch
  example takes `SEARCH_MAX_WIDTH`. With both, the floor sat near zero
  across the coverage. The ΔPDF changed only near the origin, where the
  self term lands: lower RMS there, every pair vector unchanged. NEBULA
  Pilot can turn both on.
- **The flatten check sees a leftover pedestal.** It judged floors in
  units of the slice's scatter and only inside the fit range. Beside
  strong diffuse structure, a pedestal spanning more than the diffuse level
  read a fraction of σ, "flat". It now also reports `floor_trend` (the
  floors' rank correlation with |Q| across the whole coverage) and
  `floor_span_fraction` (their range against the diffuse level). Partial
  shells at the coverage edge are left out.
- **Leftover peaks are told apart by width.** The punch review counted
  every off-lattice leftover alike, so broad maxima kept on purpose read as
  missed peaks. On one plane of a measured volume, nearly all the leftovers
  were such maxima. Each leftover now carries its FWHM in voxels. Broad ones
  (5 voxels or more along a slice axis) are reported as diffuse maxima
  kept, and only the sharp ones as punch candidates. The headline states
  both counts.
- **The off-lattice search can leave broad maxima alone.** It punched any
  candidate tall enough, so where short-range order gives broad maxima, it
  cut out the strongest of the very signal a 3D-ΔPDF images.
  *Search width ×Bragg* (`punch_search_max_width_ratio`, off by default)
  leaves a candidate broader than that many Bragg widths along any axis.
  The Bragg width is measured at the strongest integer peaks. A candidate
  within a quarter of the node spacing of a punched Bragg node is that
  peak's wing and is punched anyway. Spurious reflections are as sharp as
  Bragg peaks, so 2 keeps them punched. Widths
  come from line cuts above a straight baseline through the points five
  voxels either side, so a sharp spurious peak on a broad maximum's flank
  still measures sharp.
- **The Configure page shows the punch footprint that runs.** Its "Method"
  select offered only *Ellipsoid* and was never sent, while the pipeline
  punched with the profile-matched footprint. *Footprint* now offers
  profile-matched (the default) and ellipsoid, with the profile's reach
  (*Profile reach ×σ*). NEBULA Pilot can change both, and can set the punch
  cell when asked.
- **A new sample starts from the default settings.** A dataset seen for
  the first time used to inherit the form as it stood, so a second compound
  started with the first one's magnetic ion and protected planes. Another
  temperature of the same sample still carries the settings over.
- **Only rings seen on two planes count as rings.** A powder ring is
  isotropic. A bump on one plane only is the crystal's own scattering,
  which the ring removal must leave. It was read as a ring "left over".
  It is now listed apart.
- **The back-FFT check is described for what it is.** Without a band or
  crop the round trip is the identity, so r ≈ 1 only shows the transform
  ran correctly. The model was told it showed the ΔPDF was trustworthy.
- **The AI Assistant is now NEBULA Pilot.** The sidebar, the panel and the
  model's own introduction use the new name.
- **Ring removal is judged at each ring.** For every powder ring in the raw
  cut, assessments and tuning report whether the ring-removed profile ends
  level with the diffuse beside it: a dent (the subtraction over-shot,
  though no voxel need go negative) or a ring left over, as a share of the
  diffuse there. A residual counts only beyond 3 × that diffuse's own
  scatter on the plane. A dip in a shell's low percentiles is not proof of
  a dent: on a measured volume it was the rings' counting noise, which
  widened the shells' spread while their medians stayed level.
- **Configure remembers its settings for each dataset**, and the console
  remembers the selected dataset across reloads. Facts about one sample,
  such as its protected satellite planes, no longer carry over to the next.
- **The leftover-peak scan sets sparse counts aside.** Near the coverage
  edge most voxels are empty, so the local scatter is all but 0 and a
  single count reads as a peak of many σ. On three measured volumes, every
  leftover the scan reported on the H = 0 plane was such a count at the
  coverage edge, and so were the "missed lattice peaks" it reported on one
  of them. A would-be peak whose surroundings are a quarter exact zeros, or
  sit below a tenth of the slice's median level, is now counted with the
  noisy spikes.
- **Leftovers on the search's protected planes are counted apart.** The
  punch review reports how many off-lattice leftovers sit on the protected
  H planes, where they stay by design, so the model no longer takes every
  off-lattice leftover for a protected satellite. The stage summaries also
  name the plane and |Q| of the worst ring dent or leftover, and the
  strongest leftover peak.
- **NEBULA Pilot can set the search's protected H planes when asked.** It
  refused to, though they are on the Configure page, because the settings
  it may change left out every fact about the sample. Asked by name, it now
  sets *Search skips H* and its half width. A tuning run still never
  proposes them: whether those planes hold real satellites is physics, not
  a threshold to trade against a metric.
- **A tuning run stops once its tuned stages keep your settings.** It used
  to re-run every later stage anyway, reproducing the processed outputs: a
  few minutes of work on a 401×401×301 volume.
- **The leftover-peak scan no longer takes noise for peaks, or misses real
  ones.** It judged each spike against the whole slice's noise and accepted
  single voxels. On a measured 401×401×301 volume, nearly all its hits on
  one plane were noise at the coverage edge, while resolved peaks with a
  contrast below 4 went unflagged. A peak now has to stand out in its own
  neighbourhood (8 local robust σ) and span more than one voxel. Spikes in
  noisy regions are counted apart. With the cut known, each peak is classed
  at a lattice node (a missed Bragg peak, honouring the punch supercell) or
  off-lattice (a satellite or a spurious peak). Assessments and tuning
  report the two separately.
- **The off-lattice search's floor and protected H planes are settings.**
  The punch protects the H = n ± 1/3 planes from its search, and needs a
  peak to clear 27 × the diffuse scatter. Both were fixed, so twin or
  harmonic peaks on those planes could not be punched from the app.
  *Search floor ×σ*, *Search skips H* (`1/3, 2/3`, `none`) and its
  half width are on the Configure page and in the API
  (`punch_search_floor`, `punch_search_protect_h`,
  `punch_search_protect_half_width`). The floor is also on the tuning list.
- **The flatten is judged over its own fit range (0.8–10 Å⁻¹).** The floor
  check included the direct-beam core, which is punched and smoothly filled,
  so a clean flatten could fail it.
- **The assistant changes only the settings you ask for.** Asked to turn
  off the search's protected planes, it set the integer punch's H guard to
  0 instead. That ran every node's punch along H and discarded diffuse: many
  more voxels punched. The H guard's description now says what it is, and
  `update_settings` tells the model to ask when unsure. A setting already at
  the value is reported as no change.
- **Assess the run** names the tool for each check, so the model runs the
  texture and coverage checks instead of guessing. It also reports any
  other stage that misses its goal, such as the flatten. `assess_stage`
  says which planes it measured.
- **Two datasets at one temperature have distinct names** (the temperature,
  then what sets the file name apart, such as "cc" or "sub bkg") in the
  sidebar, Configure and the assistant.
- **The cards the assistant is on breathe a blue edge.** While a step runs,
  the cards for what it works on glow. A pipeline run or a tuning run lights
  the stage it is on. While the answer is written, the cards it mentions
  glow, for 8 seconds after the reply ends. This covers the cleanup panels,
  the 3D-ΔPDF and Q–R views, the Bragg profile panels, the Execution stages
  and log, and the Configure stage boxes, and only while the assistant panel
  is open. The edge holds still for users who ask for reduced motion.
- **The console follows the assistant to each figure it assesses.** As a
  measurement or assessment finishes, the console moves to the figure it
  looked at, so you see what the model sees:
  - the cleanup page at the cut, at a stage's worst plane, or at the
    strongest fill bias;
  - the 3D-ΔPDF section;
  - the Bragg profile, with the peak selected;
  - the Q–R band transform, for the back-FFT check;
  - the Execution page, for the run log.

  A *Follow* chip beside *Tools* turns this off. Each step's *Show* button
  reopens its figure either way. The transcript also names the assessment
  steps, instead of showing their tool names.
- **Anthropic is a provider for NEBULA Pilot.** Pick *Anthropic* in the
  connection settings and paste a Claude API key. The model list puts Claude
  Opus 5.5 first. Claude runs through Anthropic's official SDK, called from
  the browser like the other cloud providers, with the key kept in this
  browser. The SDK loads only when Anthropic is picked (59 kB gzipped). Chat,
  tools, stage reviews and tuning all work with it.
  - The model's reasoning streams into the *Thinking* panel.
  - A request a safety classifier declines is re-run on another Claude
    model in the same call (server-side fallback).
  - A declined reply never runs its tool calls.
- **A shorter Ring removal stage on the web Configure page.** The empty
  "radial PV fit · ring-width estimate" placeholder is gone. The texture
  figure takes its place and sets its equations beside the schematic, so the
  pooled model's equation is no longer cut off. The ring parameters sit
  two-up under the model, which takes the Global 3D controls from seven rows
  to four.
- **Ask the assistant to run and tune the analysis, and watch it work.**
  Asked to process the data, the model used to explain the steps and tell you
  to press Run, because no tool could start one. It now has three:
  - `run_pipeline` runs the pipeline as the Run button does: it computes the
    missing outputs, or recomputes from a given stage on. The console moves to
    the Execution page, and the chat step shows the stage, its progress and
    the latest log line. The model then measures the new outputs.
  - `tune_pipeline` runs the stage-by-stage tuning and reports each stage's
    trials live. It reports what it kept, then writes the outputs with the
    chosen settings unless you said otherwise.
  - `update_settings` changes a method choice or threshold from the tuning
    list, when you ask for a change or ask it to improve the result.

  *Stop* also cancels the run or the tuning run the model started. A reply
  can now use up to twelve rounds of tool calls instead of six. With
  gemma4:26b on Ollama, "Please process the data for me" ran all six stages
  of the synthetic demo volume and then reported metrics from its outputs.
  "Tune the knobs to get the best results" tuned all five stages (12 min),
  reran the pipeline with the chosen settings, and reported the change in
  each stage's numbers.
- **One chat instead of Chat and Tune pipeline tabs.** The trials table of a
  tuning run now appears in the chat, under the reply that started it, with
  the link to the tuned result. Two one-click requests join the stage
  reviews: *Assess the run* and *Tune for the best result*.
- **The assistant judges every run on four checks, with tools to settle
  them.**
  1. Is the ring removal clean?
  2. Are the Bragg peaks removed cleanly?
  3. Did the punch and backfill add texture to reciprocal space?
  4. Is Qmax past the data coverage?

  New tools:
  - `assess_stage` judges a stage against its goal on the three principal
    planes, with the evaluation the tuning run uses.
  - `radial_profile` puts each stage's |Q|-shell medians side by side.
  - `texture_check` flags fills that sit systematically above or below their
    rims: a median of at least 0.5σ, with at least 75 % of holes the same
    way. It also flags variation the punch and backfill add around each |Q|
    shell.
  - `qmax_coverage` compares how far the forward transform's window reaches
    in |Q| with where shells stop being 95 % measured.
  - `run_log` reads the last run's log.

  A higher ΔPDF feature SNR no longer counts as a gain if the back-FFT r falls
  or the window reaches past the coverage. Each stage review also calls that
  stage's assessment tools.
- **A reply without an answer is no longer dropped.** A model that only
  thinks, or returns nothing, now leaves a note in the chat instead of
  silence. An error a server streams after its first response chunk now
  shows as an error.
- **NEBULA Pilot can act: it measures, looks up and shows.** With *Tools*
  on, the model can measure the stage metrics on any reciprocal cut or ΔPDF
  section (the opening context covers only L=0 and z=0), take a line profile
  through any stage, read the fitted Bragg peaks and the full back-FFT check,
  compare datasets, read the run settings, and open the viewer at the cut that
  makes its point. The browser runs each call and sends the result back; every
  argument is checked, and the transcript lists each call with its result.
  These tools only read. A model that cannot call tools still answers
  from the opening metrics, with a note saying so.
- **The assistant can tune the pipeline, one stage at a time.** *Tune
  pipeline* runs each stage with your settings and with up to four the model
  proposes, measures every trial on the three principal planes, and keeps the
  trial the model judges best against the stage's stated goal and trade-off.
  The chosen settings go to the Configure page, and each stage builds on the
  best result of the one before. The model can change only method choices and
  thresholds from a fixed list, never facts about the sample.
- **Tuning never writes to `processed/`.** Each trial runs into its own folder,
  `tuning/<run>/trials/<stage>-<n>/` beside `processed/`, reading its input
  from the run's own chain of kept outputs; the chosen trial is copied into
  `tuning/<run>/processed/` and the stage's other trials are deleted. The tuned
  result opens as a dataset of its own (*"… · tuned HH:MM"* in the sidebar).
  Natively and in the browser build, a test runs a tuning run and checks that
  every file in `processed/` is byte-identical afterwards; on the synthetic
  demo volume a five-stage, fifteen-trial run through the app left all nine
  processed files byte-identical (sha256).
- **The assistant is a panel beside every page**, opened from the sidebar
  instead of a page of its own, so it can open a viewer while the conversation
  stays in view. A reply keeps running when the panel closes. On narrow screens
  the panel slides over the page.
- **The ring-removal metric now sees the rings.** It averaged each |Q| shell,
  and before the punch a shell's mean is mostly Bragg peaks, with the
  incident-beam spot in the few voxels near the origin: on the synthetic demo
  volume it gave a ratio of 1.00 both for the ring-removed volume and for the
  same volume generated without rings. It now uses shell medians and leaves out
  sparse shells: 0.42–0.50 for the ring-removed volume against 0.42–0.55 for
  the ring-free truth, on the three principal planes. Its shells also follow
  true |Q| under the reciprocal metric, so rings stay in one shell on
  hexagonal and monoclinic cells (they were binned as if a* ⊥ b*).
- **The assistant sees the flatten stage.** Its context and a new *Check
  flatten* review report the per-|Q|-shell floors before and after the
  flatten; the ΔPDF is built from the flattened volume by default.

- **Structure overlay on the 3D-ΔPDF.** Load a CIF, or enter sites and
  symmetry operations by hand, and the 3D-ΔPDF page (and the Q–R page's ΔPDF
  view) marks the structure's interatomic vectors r_j − r_i + R on each slice:
  one glyph per element pair, a filter for the vectors from one site, a depth
  around the cut, and a hover readout of the pairs, |u| and u. The CIF's cell
  is checked against the ΔPDF's, with an axis mapping for another setting. The
  structure stays in the browser. On a synthetic rock-salt volume with ordering
  planted on the cation sublattice, the markers fall on the planted ΔPDF
  features (negative at ⟨½ ½ 0⟩, positive at ⟨1 ½ ½⟩ and ⟨2 0 0⟩).
- **\|Q\| boundaries are drawn correctly for non-orthogonal cells.** The Q–R
  page drew the \|Q\| band as circles on the r.l.u. axes, which is right only
  for an orthogonal cell; it now draws the true contour under the reciprocal
  metric, a tilted ellipse (off-centre where the cut axis is not normal to the
  plane) that bounds the band-limited data. The punch preview's \|Q\| band,
  which was already tilted, now also moves its centre for an off-origin cut,
  and the ΔPDF \|Q\|-band slider takes its maximum from the true metric. The
  computation was already right; only the drawing changed.

- **`main` now reports version `0.4.0.dev0`** (web: `0.4.0-dev.0`), not
  `0.3.0`. Default results have changed since the 0.3.0 beta, so files written
  from `main` no longer claim to come from that release.
- **The Bragg punch no longer depends on the data's intensity units.** Its
  floors were numbers in data units (0.8, 1.0). On data of another scale,
  such as X-ray rates against neutron counts, or two runs on one instrument,
  they either rejected real Bragg peaks or stopped protecting the diffuse.
  The pipeline now does three things:
  - **Integer nodes by significance alone** (`integer_detect="significance"`).
    The excess at the window's brightest voxel over its own background shell
    (1–2× the resolution ellipsoid, as in peak integration) must reach
    `min_significance`, corrected for picking the brightest of the window's
    voxels (5σ becomes ≈ 6σ). The shell leaves broad diffuse maxima at nodes
    alone. On a synthetic volume, none of the forbidden-node short-range-order
    maxima are punched, and every Bragg node is.
  - **No broader than a Bragg peak** (`integer_max_shell_fraction=0.15`). A
    node is also rejected when the 1–2× shell still holds over 15 % of its
    core's excess (against a 3–4× shell), by more than two standard errors.
    Bragg peaks keep a few per cent there. Maxima a few times wider pass the
    shell test on good statistics, and a punch sized for a peak would take
    their core and leave their skirt.
  - **Search floors in units of the diffuse scatter**
    (`search_floor_unit="scatter"`, 27 × the per-shell 1.4826·MAD). That is
    the old 0.8 on the data it was tuned on. The run log prints the scatter
    and the floors.
  - **Same mask at any scale.** Multiplying the data and `sigma` by any factor
    gives the same mask.

  Effects:
  - On measured data of another scale, every strong Bragg peak is punched as
    before, and more of the weaker ones than with the floors.
  - Broad maxima at nodes, which the floors could punch, are left alone.
  - On the data the floors were tuned on, the punched volume changes by a
    few per cent.

  To keep the earlier behaviour, set `integer_detect="floors"`,
  `search_floor_unit="data"` and the search floors to 0.8.

  The web Configure page's *Min I* field becomes *Min σ*, the significance a
  peak must reach. With the gate off (Min σ 0), integer nodes fall back to
  the floors. See docs/algorithms/bragg_cleanup.md.
- **No more dashed streaks along the 3D-ΔPDF axes.** The transform windowed
  the volume, subtracted the plain mean from the whole box and zero-padded
  it, which left a step of the mean at the box faces; its transform drew a
  line of alternating sign along every axis, a sizeable fraction of the
  strongest correlation on both a hexagonal and an orthorhombic dataset. It
  now subtracts the window-weighted mean before windowing, and the Gaussian
  window is shifted to reach zero at the box edge (FWHM 3 % narrower in Q;
  ΔPDF amplitudes a few per cent lower). The streak drops by more than an
  order of magnitude on both datasets; the back-FFT check stays near-exact
  and improves slightly. See docs/algorithms/delta_pdf.md.
- **The flatten's magnetic ion defaults to none.** The model then subtracts a
  fitted constant only; choose the sample's magnetic ion to add the
  `c·F(Q)²` paramagnetic term. The old default ion put its form factor on
  every sample: on a hexagonal dataset it fitted a negative c, a negative
  paramagnetic term, to follow a pedestal that rises with |Q|. The example
  scripts (`run_pipeline.py`, `flatten_background_3d.py`,
  `validate_flatten.py`) default to none too; set `ION` for a magnetic sample.
- **The slice viewers share one workspace, after the NeXus Viewer.**
  Reciprocal cleanup, 3D-ΔPDF and Q–R now lay out, zoom and set colours the
  same way, and the same way as the NeXus Viewer.
  - **Layouts.** *Grid*, *Focus* (one large view, the others as thumbnails;
    2 × 2 with four) and *Single* (Esc returns), with focus / maximize in each
    view's header. Remembered per page. Defaults: grid for Cleanup and
    3D-ΔPDF, focus with Data large for Q–R.
  - **Zoom and pan on the slice.** *Navigate · Zoom · Move* click modes,
    double-click to fit, pinch, axes in r.l.u. or Å, a field-of-view chip and a
    crosshair shared by linked views, with a readout of every stage's value
    under it. On 3D-ΔPDF a Navigate click moves the other two cuts. These
    replace the *Zoom* and *Window* sliders, which pointed opposite ways (Zoom
    ×2 zoomed in on Cleanup but out on the Bragg tiles; a larger Window zoomed
    out).
  - **Colour range instead of *Contrast*.** vmin and vmax around a colour bar
    with the data's histogram and a handle at each limit, *asinh / lin / log*,
    *Auto* (vmin 0, vmax at p97, softening at the median, as in the NeXus
    Viewer) and *Brightness* in stops, right brighter. *Contrast* multiplied
    vmax, so raising it darkened the image.
  - **The diffuse is visible by default.** Cleanup's shared scale now comes
    from the output stage. It came from the pooled stages, so raw's Bragg
    peaks set it: on measured data the flattened median sat at a tiny
    fraction of the range and needed *Contrast* at its ×0.1 minimum.
  - **Q–R fixes.** *Apply* sits next to each band and no longer snaps both
    cuts to the centre. The residual has its own ± range on a diverging map;
    it was drawn from 0 on the data's sequential scale, which hid every
    negative value. The Q scale is set from the centre cut, so it holds still
    while the cut moves. The ΔPDF plane follows the Q plane (H ↔ x, …) while
    *Link orientation* is on; the page opened with 0kl next to xy.
  - The Bragg tiles take *Brightness* and a *Zoom* that zooms in.

- **Volumes indexed on a supercell.** New punch setting `supercell` (default
  1×1×1). With a supercell, integer mode punches only the parent lattice's
  nodes, those whose h, k, l are multiples of the factors. On a volume
  indexed on a 2×2×2 supercell, `mode="both"` also punched the odd
  (superlattice) nodes, which carry no parent Bragg peak, and took part of
  the intensity there. Run such a volume with `mode="integer"`,
  `supercell=(2, 2, 2)` and the H guard off: the rods and superlattice nodes
  then stay intact. The H guard (`integer_h_guard_hkl`, 0.12 r.l.u., set to
  protect satellite planes at fractional H such as H = ±1/3) is now a setting
  too. On such a volume it left a Bragg tail along H. Both are on the server
  (`punch_supercell_h/k/l`, `punch_h_guard`, 0 = off) and on the web
  Configure page, whose punch preview marks only the parent nodes. The
  defaults are unchanged.
- **The flatten subtracts a fitted const + c·F(Q)² pedestal.**
  - **What it does.** It still takes each |Q| shell's floor (p25). It then
    fits `const + c·F(Q)²` to those floors over 0.8–10 Å⁻¹ and subtracts the
    fitted curve, instead of the smoothed floor itself.
  - **The two terms.** `const` is nuclear incoherent scattering.
    `c·F²` is the paramagnetic scattering of each ion by itself, with `F` its
    magnetic form factor. Both are self scattering, so they change the ΔPDF
    only at r ≈ 0.
  - **Why the floor had to go.** The old floor, smoothed at 0.1 Å⁻¹, also
    followed the isotropic `sin(Qr)/(Qr)` terms of real pair correlations and
    subtracted them.

  On measured data at three temperatures, compared with no flatten, the old
  floor pulled the ΔPDF's short-range shell means strongly negative, while the
  model moves them only slightly. Both reduce the axis cross.

  On the demo ground truth, the old floor's ΔPDF error at 2–5 Å was 42 %,
  against 13 % with no flatten.

  The model keeps most of the cross suppression. What it leaves is a smooth
  isotropic part that is not F²-shaped. That part may be real isotropic
  correlation or a background the model lacks (multiple scattering, the
  sample environment, the Debye–Waller fall-off of the incoherent constant).

  - **Form factor.** `F` is the dipole form, ⟨j0⟩ + (2/g − 1)⟨j2⟩. It fits the
    measured floors better than ⟨j0⟩ alone at every temperature.
  - **New module.** `nebula3d.preprocessing.form_factor` has the coefficients
    for 22 3d and rare-earth ions (International Tables C §4.4.5,
    cross-checked against Mantid).
  - **Settings.** `ion` (the magnetic ion; `None`/`"none"` fits a constant
    only) and `fit_q_range` are new options on `flatten_radial_background` and
    `FlattenParams`. On the server the ion is `flatten_ion`.
  - **Where the default changed.** The stage driver, the flatten example, the
    QA script and the web Configure page now default to the model. The web
    page gains a Magnetic-ion select. `estimator="floor"` and `"snip"` remain
    for comparison.
  - **Limit.** For Ising-like moments the self term is `F²(1 − (Q̂·ê)²)`, and
    only its shell average is removed.
- **No bright rim around a filled hole.** On a hexagonal TOPAZ volume, bright
  nodes came out as "coffee beans": a ring brighter than the fill inside it.
  There were two causes.
  - The Laplace fill takes its boundary `laplace_gap` voxels outside the
    punch, past the Bragg tail left at its edge, but then kept that band's
    measured values. Every hole was therefore ringed by the tail its fill had
    skipped: a median step of a fraction of σ on both the orthorhombic and
    the hexagonal data. The fill now writes the band too, and meets the kept
    data only at its boundary.
  - The profile punch's template dropped a halo common to every direction as
    thermal diffuse. A peak can have such a halo of its own: one that falls
    off exponentially and, relative to the peak, does not grow with |Q|. The
    template now follows the measured profile on every axis. On data without
    such a halo, the punch grows only slightly.

  On both datasets the median step from the fill to the first kept voxel
  falls to about zero. The fill now replaces the band's measured voxels, the
  punch grows, the back-FFT check improves slightly, and the ΔPDF barely
  changes at short range.

  On the moved-hole test the written band is unbiased, with the scatter of a
  3³ box mean. `laplace_gap=0` still changes only the
  punched voxels. See `docs/algorithms/bragg_cleanup.md`.
- **Laplace is the default backfill, judged on real data.** A new test,
  `bragg_qa.refill_test` (also `REFILL=laplace,local` in
  `examples/qa_punch_fill.py`), measures fill error where the truth is known.
  It moves the punch's own holes half a node step along K, into measured
  diffuse, fills them, and compares with the data there. The moved holes keep
  the real shapes and stay lattice-periodic.

  On orthorhombic data at three temperatures (profile punch), the per-hole
  mean error is a few hundredths of σ for both fills and smaller for
  `laplace`; the ΔPDF error at the lattice vectors is a few per cent of the
  real ΔPDF there.

  The two fills are equal in the ΔPDF within the test's scatter. `laplace`
  leaves no step at the hole rim (`local` leaves a clear one) and follows gradients
  across the long merged holes of the profile punch. Fills that continue the
  rise toward each node are not used: that rise is mostly the residual Bragg
  tail the punch leaves at 0.5σ.

  Defaults changed in `backfill_bragg`, `BackfillParams`, the stage driver and
  presets, the preview, the benchmark and the web Configure page;
  `method="local"` restores the shell median.
- **The Bragg punch follows each peak's own tail.** Stacked along their local
  axes, the brightest peaks of the orthorhombic data have:
  - a compact core, the same width in every direction;
  - no radial tail;
  - an exponential tail along θ̂ (toward c*), out to several tenths of an
    Å⁻¹ above the noise, and a shorter one along φ̂.

  The tail scales with intensity, grows with |Q| and is the same in every
  dataset: the tilt spread (mosaic). The old punch fitted the core, which
  cannot see the tail, then grew it by the cube root of the intensity. Its base
  radii even had θ̂ as the shortest axis. On the low-temperature dataset over
  a third of a bright punch was background, yet most of the brightest holes
  had a tail leaking on one side.

  `punch_footprint="profile"`, now the default with `profile_n_sigma=0.5`:
  - learns the dataset's Bragg profile along each peak's (ρ̂, θ̂, φ̂) from its
    ≤ 400 brightest integer peaks, per |Q| range, with neighbouring peaks
    masked out;
  - keeps the Gaussian core plus the excess of the transverse profiles over
    the radial one, so a halo common to every direction (thermal diffuse) is
    not learned;
  - punches each peak along each axis to where its predicted tail falls to
    0.5 × the local noise, between the resolution radii and 0.5 Å⁻¹. There is
    no intensity scaling.

  Against the old punch and the significance gate, on all three datasets the
  new punch clearly lowers the share of the brightest holes leaking a tail
  (by about half on the low-temperature one) and of all holes leaking a tail.
  The background share of the punch stays about the same, more voxels are
  punched, and the back-FFT check stays near-exact.

  In the ΔPDF the change is mostly a loss of RMS from 5 to 40 Å and at the
  lattice vectors; the short range (2–5 Å) barely moves.

  Caveats:
  - more of the punch sits in merged holes, as tails join neighbouring L
    nodes;
  - it also removes thermal diffuse that streaks across Q around nodes, like
    the demo volume's, so the demo benchmark scores 2–3× the collateral. The
    learned profile is in the Bragg profile JSON (`footprint_profile`) for
    checking a new sample.

  With too few bright peaks it falls back to the ellipsoid and says so in the
  run log. `punch_footprint="ellipsoid"` restores the old punch
  (`PUNCH_FOOTPRINT` / `PROFILE_N_SIGMA` in the driver; `punch_footprint` /
  `punch_profile_n_sigma` in the run request). `bragg_qa` also reports each
  hole's background share.
- **The Bragg punch judges every detection against its own error.** Before,
  the search pass flagged a voxel when it beat its |Q| shell's median + 4·MAD
  and an absolute floor of 0.8. Both are set by the whole shell. At the
  high-|Q| edge of the CORELLI coverage, low exposure turns one or two
  counts into a spike of order 1, with noise several times the interior's.
  - On the low-temperature dataset about half the search peaks were such
    spikes, all below 5σ, most of them single voxels.
  - Their punches merged into two large holes, a sizeable share of
    everything punched, which the `local` fill then filled with one value
    each.

  Now a detection, integer node or search summit, needs an integrated
  excess of at least `min_significance` = 5 standard errors (`PunchParams`;
  `MIN_SIGNIFICANCE=5` in the `cc_on`/`cc_off` presets):
  - `z = Σ(I − bg)/√Σσ²` over half the resolution ellipsoid, with `bg` the
    detection window's median and `σ` the volume's errors;
  - `significance_noise="mad"` uses the window's robust scatter instead,
    for volumes without real errors;
  - a voxel without a usable `σ` falls back to the window's robust scatter.

  The scaling reference still counts the candidates the gate rejects, so
  the punches that stay keep their size.

  On the low-temperature dataset (shipped code against main, full pipeline):
  - the edge punch shrinks by a large fraction; the interior punch is
    essentially unchanged;
  - one mmm-symmetric family of interior integer nodes, just below the gate,
    is lost;
  - the back-FFT check improves slightly, most on the H = 0 plane;
  - the ΔPDF moves by a few per cent RMS at the lattice vectors and within
    20 Å, all of it from the restored edge.

  The other two datasets show the same small back-FFT gain, again most on
  the H = 0 plane.

  No change in the tails left past the brightest holes at any of the three.

  The profile JSON gains each peak's `significance`; the run request gains
  `punch_min_significance` (0 = off). `detect_window_q` sizes the detection
  window in Å⁻¹ but stays off: on measured data it adds many integer nodes,
  not yet validated.
- **Punch / backfill QA**, `nebula3d.analysis.bragg_qa`, two examples:
  - `examples/qa_punch_fill.py` (real data) reports:
    - how significant each detection is;
    - hole sizes and merging;
    - excess in shells outside each hole by distance in Å⁻¹ (a tail leaking
      on one side shows in the first shell's 90th percentile);
    - the fill against those shells.
  - `examples/benchmark_punch_fill.py` (ground truth) scores the punch and
    fill on the demo volume, whose components are known: Bragg left, diffuse
    removed, false detections, fill bias, and 3D-ΔPDF error at the lattice
    vectors. It has a clean scenario and a low-exposure-edge one. On the
    edge one the gate cuts false detections 1,284 → 12 and collateral
    81 % → 59 % (clean: 46 %).
  - Both already show the next targets on measured data: the `local` fill
    sits a fraction of σ below each hole's rim, and on the demo it under-fills the thermal
    diffuse under the nodes by ~75 %.
- **Every HDF5 output is now a Mantid MDHistoWorkspace NeXus file.** The stage
  volumes (`*_ringremoved.h5`, `*_braggpunched.h5`, `*_backfilled.h5`,
  `*_flattened.h5`, the web demo) and the 3D-ΔPDF (`*_delta_pdf.h5`,
  `examples/_delta_pdf.h5`, `*_3dpdf.h5`, the consistency viewer's saved
  band) were written in two ad-hoc layouts that only NEBULA3D read. They now
  use the layout Mantid Workbench's `SaveMD` writes (version 2, copied from a
  CORELLI file), so `LoadMD` and other NeXus tools open them, and the unit cell
  sits in `experiment0/sample/oriented_lattice` (UB/2π and a, b, c, α, β, γ).
  File names and extensions are unchanged. Also:
  - arrays keep their stored order: a volume `(nh, nk, nl)` is D2 = `[H,0,0]`,
    D1 = `[0,K,0]`, D0 = `[0,0,L]`; a ΔPDF `(na, nb, nc)` is D2 = x, D1 = y,
    D0 = z in Å (frame General Frame), with the bin edges LoadMD expects;
  - signal, σ² and `num_events` are float64 and the mask int8 (1 = masked), as
    LoadMD requires. A float32 run converts slab by slab (no float64 copy of
    the volume) and records its precision, which `dtype=None` restores. Files
    of a float32 run grow by ~1 B/voxel (~7 against ~6 compressed); float64
    files are about the same size;
  - the ΔPDF provenance (`q_max`, `apodization`, `source_file`,
    `transform_config`, …) is stored as run logs, so it shows in Workbench's
    Sample Logs;
  - what Mantid does not know goes in `MDHistoWorkspace/nebula3d`: the exact
    bin centres and UB, the precision, the instrument text and the punch
    record (`punched`, int8). A file NEBULA3D wrote loads back losslessly,
    values under the mask included, so a pipeline resumed from disk equals one
    run in memory; a raw Mantid file still has its masked voxels zeroed;
  - one reader for ΔPDF files, `nebula3d.io.load_delta_pdf`, used by the
    server, the stale-ΔPDF guard and every viewer; the writer is
    `nebula3d.io.save_delta_pdf` (and `nebula3d.io.save_mantid_nxs` for
    volumes). `pipeline.write_cell_attrs` is gone;
  - older files still load: `/entry/...` volumes (also the NeXus Viewer's
    hand-off), `/entry/punched`, and root-layout ΔPDFs with `lat_*` attributes.
  An identity UB (unknown) writes no oriented lattice, and neither does a
  left-handed one, which Mantid refuses; NEBULA3D keeps it in its own group.

- **New default ring model, `pooled`: stack-pooled sector profiles.** The
  per-plane `patched` model left a visible residual along every powder ring.
  On measured CORELLI volumes a ring's |Q| position and width wander with
  direction (within one plane, an Al line's peak moves by several |Q| bins),
  and `patched` smooths each |Q| bin's azimuthal pattern with six
  damped harmonics, so it subtracts at the wrong |Q|: a bright arc beside a
  dark one, invisible to the azimuthally averaged removal fraction.
  `fit_pooled_rings` (`ring_model="pooled"`) assumes no radial line shape.
  It reads each plane's median radial profile in 72 azimuthal sectors, pools
  each one with its ±1 neighbouring sectors and the planes within ±5° on the
  ring sphere by weighted median (Bragg peaks, which fill one sector over a
  few planes, are outvoted), and subtracts the SNIP excess inside the
  confirmed shells. Also:
  - a close doublet (the Al 331/420 lines) shares one SNIP window, instead
    of the broad member being half left in the baseline;
  - rings must clear the profile noise (≥ 6σ) as well as 6 % of the strongest
    ring, and a weaker ring is admitted when it sits on an FCC-Al line (the
    weak Al 440 and 533 lines were never subtracted before);
  - the shell envelope is 1.5 × FWHM wide and the amplitude cap 8×, both of
    which clipped real ring before;
  - on a coarse grid the pooling solid angle widens until it holds 12 voxels.

  On the low-temperature dataset the held-out ring residual (RMS, fraction of
  the raw ring) drops by roughly a third to a half at every ring, the doublet
  included. Through the whole pipeline the ΔPDF loses the concentric ring
  ripples: its RMS at 3–10 Å falls on all three datasets, with the back-FFT
  consistency unchanged. Bragg-on-ring inflation is about the same as
  `patched`'s; the subtraction is continuous along the stack axis; the
  stage takes ~52 s serial on a 48 M-voxel volume (`patched` ~45 s) and,
  in low-memory mode, writes in place (~5 B/voxel peak). `ring_model="patched"`
  restores the previous behaviour. The web Configure page gains "Pooled 3D
  sectors" (sectors, stack window) as the default; the run request gains
  `rings_pooled_sectors` and `rings_pooled_window_deg`.
- **Side-by-side ring-model viewer**, `examples/compare_ring_modes.py`: one
  column per model (default `pooled`, `patched`, `parametric`, `global_v2`),
  the cleaned slice above what each removed, a leftover radial profile per
  plane, linked zoom and an H/K/L plane slider. Each model runs once through
  the pipeline path and is cached in `data/processed/ring_modes/`.

- **The Bragg punch now fits each peak's tilt, in Q.** Before this, the
  default pipeline fitted three radii along H, K, L, so no integer peak was
  tilted. The opt-in covariance fit did not follow the data either: it took
  eigenvectors in HKL, floored them at an HKL bounding box, read the core from
  a ±0.2 r.l.u. window (±1 voxel along c* on the measured grid), and used the
  width of the 35 % core, which is 0.61σ for a Gaussian. On measured data,
  almost half the peaks were floored on all three axes, and almost none were
  set by the data on all three. `integer_optimize_shape` is now the covariance fit, in Q (the
  pipeline default):
  - takes the core's covariance in Q (`Σ_Q = UB·C·UBᵀ`), from a window sized
    in Å⁻¹, using only voxels connected to the peak;
  - divides by the Gaussian core-cut factor, so the widths are σ;
  - clips the ellipsoid to contain the punch frame's resolution ellipsoid and
    lie inside `max_radius_scale`× it;
  - leaves peaks whose cut is within `integer_fit_noise_n_mad` (3) noise
    sigmas of the background at the resolution ellipsoid;
  - adds the Å⁻¹ `margin` to the principal radii in Q.

  On synthetic tilted peaks on a measured UB, the punch's long axis is now
  3–16° from the truth, where it was 26–31°. On measured data nearly all
  fitted peaks have at least one axis set by the data, and the measured long
  axes sit well off the spherical frame's φ̂. The default pipeline punches
  somewhat more voxels; in integer mode it leaves less of the strong-peak
  excess outside the punch. `measure_peak_sigmas`
  and `measure_peak_covariance` (the profile's measured widths) use the same
  cut-corrected core, so the width histogram reads 1.65× wider than
  before. The position-only fit takes the same core's centroid. The
  default-punch golden master was regenerated (612 → 489 voxels). Profile
  JSONs from earlier runs predate this change.
- **Removed the diagonal Bragg-shape fit**: three radii along H, K, L, so no
  tilt, floored at an HKL bounding box; the same class of r.l.u. punch as the
  removed HKL frame. `integer_fit_covariance` is gone from `BraggRemover` and
  `PunchParams`, `punch_fit_covariance` from the run request, and the
  Configure page's "Fit tilted ellipsoid" switch with it; "Drop fit
  constraints" stays. Peak records no longer carry `radii_hkl`. A peak where
  the punch frame is undefined (at the origin) still gets the base
  ellipsoid's HKL bounding box. The profile JSON keeps `fit_covariance` (true
  when the shape fit ran) for readers of older profiles.
- **Removed methods with no physical basis.**
  - Generic image inpainting as a backfill: `method="tv"`, `"symmetry"`,
    `"symmetry+tv"` and the `nebula3d.inpainting` package (TV, Laue-symmetry
    copying, RBF, biharmonic). TV assumes a piecewise-constant image and leaves
    staircase artefacts in structured diffuse scattering, and every symmetry
    copy of a punched Bragg node is itself punched. The older ring workflow that
    used it went too: `backfill_ring_shells` (`preprocessing/backfill.py`) and
    `preprocessing/residual_rings.py`. The production ring stage subtracts its
    model, and anything it masks is filled by the Bragg backfill from its own
    surroundings. `backfill_bragg` now takes `local`, `laplace` or `q_shell`, and
    raises on anything else; `BackfillParams` lost `laue_class`, `tv_lam`,
    `tv_iter`.
  - The flatten's `median` and `mode` estimators. A |Q| shell's median or mode
    includes the diffuse signal itself, so subtracting it removes real diffuse
    scattering (the flatten validation found both over-subtract). `floor`
    (default) and `snip` remain.
  - Morphological grey opening as the ring-model baseline
    (`baseline_method="opening"`). It is a shape filter, not a background
    model, and dips below a diffuse background that falls with |Q|. SNIP is now
    the only baseline, so `baseline_method` is gone from `PatchedRadialRingModel`
    and `ParametricRingModel`.
  - Bragg punch radii in fractional HKL (`punch_frame="hkl"`, `punch_radii`,
    `punch_radius_hkl`; `punch_radius_h/k/l` in the run request). The
    resolution is set in Q, so r.l.u. radii depend on the cell and shear on
    oblique axes. The punch is sized in Å⁻¹ only: per peak in the spherical
    frame (the default, now also for `BraggRemover()` and `bragg_mask`) or
    along a*, b*, c* (`"q"`). `punch_frame="hkl"` raises. The `margin` guard
    band is Å⁻¹ everywhere, including the covariance-fit path, which inflated
    by r.l.u. outside the `"q"` frame. The default direct-beam punch, when no
    beam radii are set, is twice the Bragg punch's HKL bounding box. The
    default pipeline punch is unchanged: the same mask on a measured
    volume. `examples/compare_punch_frames.py` and `plot_punch_slices.py`
    (HKL vs Q comparisons) were removed, and the punch examples take
    `SPHERICAL_R` (Å⁻¹) instead of `R_HKL`.

  The Configure page no longer offers the removed options. Docs, examples and
  the manual source follow.
- **The edge of the measured coverage is trimmed at load, on by default.** A
  measured voxel next to unmeasured space is barely normalised. On a
  hexagonal 401³ TOPAZ volume those voxels reach values orders of magnitude
  above the interior, while one voxel further in they match it. They went
  straight into the ΔPDF, and as Laplace boundary
  values they lit up the holes next to them. The pipeline now takes
  `PipelineParams.edge_trim` layers (default 1; 0 keeps them) off the measured
  coverage when it loads the raw input: those voxels become unmeasured, masked
  and zeroed as the loader leaves unmeasured voxels, and the run log says how
  many. The volume's own faces are not an edge. A fully measured volume
  loses only a few thousand of tens of millions of voxels; the hexagonal
  TOPAZ volume loses millions, and its default punch then finds less than
  half as many peaks (most of the rest were edge voxels), punching about half
  as many voxels. Existing
  outputs are not recomputed by themselves: re-run from the ring stage.
  `nebula3d.preprocessing.trim_coverage_edge`, `nebula3d.pipeline.load_input`,
  `edge_trim` in the run request (+ tests).
- **Backfill: each punched hole is filled from its own surroundings.** The
  backfill took every masked voxel for a hole, so a punched hole that touched
  unmeasured coverage merged with it, and the whole region (coverage and every
  hole touching it) got one fill value set by the coverage's rim. On a
  hexagonal 401³ TOPAZ volume, mostly unmeasured, that was most of the
  punched voxels, which showed as flat discs that did not match the data
  around them.
  The punch stage now records which voxels it punched, in memory and as
  `/entry/punched` in `*_braggpunched.h5`, and `backfill_bragg(punched=…)`
  fills each hole only from the measured voxels around it. The coverage is
  filled separately afterwards, with its own shell median. For `laplace`,
  unmeasured neighbours are a free (Neumann) boundary. On that volume, the
  holes whose mean fill is more than 3 MAD from the median of the measured
  voxels within 2 voxels of them drop from a few per cent to none (`local`),
  and the median offset shrinks. A punch artifact written before this change has no record:
  the backfill says so in the run log and fills as before. Re-run the punch to
  fix it. `src/nebula3d/analysis/bragg_fill.py`, `src/nebula3d/pipeline.py`
  (+ tests).
- **Desktop browsers: large volumes no longer run out of memory in the
  backfill.** A 401³ TOPAZ volume (64.5 M voxels, inside the ~80 M-voxel
  limit) failed in the browser with a `MemoryError` in the backfill. Four steps
  each built a full float64 |Q| grid with its temporaries, ~25–40 B/voxel on
  top of the volume: the cross-plane ring confirmation, the punch's per-|Q|-shell
  thresholds, the radial flatten and, on that volume, the direct-beam fill. Its
  unmeasured coverage (most of the cube) reaches the origin, so the direct-beam
  fill took all of it for the beam. The first three now compute |Q| one plane
  or one 16-plane slab at a time, with identical values. The direct-beam fill
  leaves an origin region whose bounding box is over 2 M voxels (a real beam's
  is ~2,000) to the generic fill. On the TOPAZ volume the old beam fill found
  no clean shell there and filled nothing, so every stage output is
  byte-identical, as it is on a fully measured 48.4 M-voxel volume. The Laplace
  fill also frees its unknown lists for an oversized region before filling it
  locally (same output). Under Pyodide 0.27.7 the WASM heap now peaks at
  2.8 GiB on the TOPAZ volume (it failed at 3.8 GiB; 2.9 GiB with
  `method="laplace"`), 2.1 GiB on the 48.4 M-voxel volume (was 2.5 GiB) and
  2.9 GiB on a fully measured 79.5 M-voxel volume at the limit (the old code
  hit the 4 GiB ceiling there), out of 4 GiB.
  `src/nebula3d/preprocessing/radial_background.py`,
  `src/nebula3d/analysis/bragg.py`, `src/nebula3d/analysis/bragg_fill.py`,
  `src/nebula3d/preprocessing/radial_flatten.py`, `tests/test_memory_peaks.py`.
- **Phones and tablets: a size limit that fits the device.** Loaded volumes
  (**Load volume…** and the NeXus Viewer import) were checked only against
  the desktop budget of ~80 M voxels, so a phone accepted volumes that the OS
  would kill the tab over mid-run. On a phone or tablet the gate now budgets
  the whole tab: ~0.55 GB of runtime + packages plus 150 B/voxel (measured
  ~125 B/voxel on a full demo run, plus room for a Mantid input's float64
  signal and errors) against 1.3 GB, i.e. up to ~5 M voxels (≈ 171³; the demo
  is 4.2 M). A larger file is refused before it loads, with a message that
  points to a desktop browser (up to ~80 M voxels) or the native build.
  Desktops are unchanged. The page detects the device (`web/src/api/device.ts`,
  now shared with the ring pool) and sends it in the pipeline worker's boot
  message to `webbridge.setup(mobile=…)`, because only the main thread can tell
  iPadOS from a Mac. `inspect_input` reports `device`.
  `src/nebula3d/webbridge.py`, `web/src/api/pyodideEngine.ts`,
  `web/src/workers/pyodideWorker.ts` (+ tests).
- **iPhone / iPad: the in-browser run no longer reloads the page mid-run.**
  On iOS every browser is WebKit, which runs all of a page's workers inside one
  content process. The OS kills that process at a memory limit far below a
  desktop's, and Safari then silently reloads the page. The ring-worker pool
  sized itself as `min(4, hardwareConcurrency − 2)`, and WebKit reports 4 on an
  iPhone, so it added two extra Pyodide + numpy/scipy instances (~0.45 GB
  resident each, measured) to the pipeline worker. With the 161³ demo that
  took a run past the limit. Phones and tablets (iOS, iPadOS — which sends a
  desktop-Mac user agent, so it is caught by its touch points — and Android)
  now get no ring workers. The ring stage runs serially in the pipeline worker
  instead, with bit-identical output. The `nebula3d.ringWorkers` localStorage
  setting still overrides. `web/src/api/ringPool.ts`, `web/src/api/device.ts`
  (`isMobileDevice`, + tests).
- **The demo volume is labelled synthetic and costs less memory.** The file
  and dataset are now `synthetic_rocksalt` (was `demo_rocksalt`), and the
  Configure page says it is simulated, not measured data. It is stored float32,
  which is what the browser computes in, so its in-memory file halves
  (52 → 23 MB). `demo_volume` draws the counting noise one H plane at a time, in
  place (`dtype=` sets the storage precision). Generating 161³ then peaks at
  ~76 MB of arrays instead of ~220 MB, below the ring stage's ~195 MB, so the
  demo no longer sets the WASM heap's high-water mark (measured under Pyodide
  0.27.7: 179 MB after generation, was 325 MB). Measured under Node, a full
  demo run's pipeline worker is ~1.07 GB resident (was ~1.27 GB). On a phone it
  no longer carries two ring workers of ~0.45 GB each, so the total is roughly
  half.
  `src/nebula3d/demo.py`, `src/nebula3d/webbridge.py`, `tests/test_webbridge.py`.
- **New demo volume: finer grid, physical diffuse scattering.** **Use demo**
  loads a 161³ volume (was 33³) over ±4 r.l.u., step 0.05 r.l.u. (0.075 Å⁻¹).
  That is fine enough for resolution-limited Bragg peaks and a 0.5 Å ΔPDF
  grid, and the full chain still runs in about 5 s in the browser. The crystal
  is rock-salt-type (cubic, a = 4.2 Å, FCC lattice), on the intensity scale of
  a normalised Mantid volume (Bragg up to ~150, diffuse ~0.1–0.5), with three
  kinds of diffuse scattering, each with a known 3D-ΔPDF signature:
  - chemical short-range order (Krivoglaz–Clapp–Moss, V2/V1 = 0.3): maxima at
    (1 ½ 0); in the ΔPDF, negative at ⟨½ ½ 0⟩a and positive at ⟨1 ½ ½⟩a and
    ⟨2 0 0⟩a;
  - one-phonon thermal diffuse scattering of a nearest-neighbour FCC lattice
    (Q·D⁻¹·Q): halos at every node, growing as |Q|², streaking along ⟨110⟩;
  - 2-D order in the (001) layers: rods along L at (h+½, k+½), a checkerboard
    confined to the z = 0 plane in the ΔPDF.

  Also in the volume: FCC Bragg peaks with a |Q|-dependent resolution ellipsoid
  and Debye–Waller falloff, a radial background, a compact incident-beam spot,
  aluminium-can powder rings at the Al d-spacings with texture about c*,
  Poisson counting noise, and a matching per-voxel `sigma`. On the old demo,
  whose Bragg peaks were ~10× the diffuse and smaller than a voxel, the default
  punch reported 114 peaks and only 34 of them were at FCC nodes; the rest were
  noise at high |Q|. On the new one it finds only FCC nodes, and every diffuse
  maximum sits off the integer nodes so none is punched. The ΔPDF reproduces
  the ground truth of the planted diffuse (r = 0.91). The generator is `nebula3d.demo.demo_volume`,
  built in slabs so its temporaries stay small in the WASM heap. It can return
  any single component without noise, and `webbridge.make_demo_input` writes
  it as `synthetic_rocksalt`. `tests/test_demo.py` pins the physics and the
  end-to-end result. The absolute consistency-r floor in
  `tests/test_float32_equivalence.py` drops from 0.999 to 0.98, because the
  demo's counting noise caps r at ~0.992. The float32/float64 gates are
  unchanged. See `docs/web.md` ("Demo volume").
- **Layouts for iPhone, iPad, MacBook and 4K screens.** Below 1100 px (iPad
  Pro portrait and all iPhones) the sidebar becomes a compact top bar with a
  scrolling row of view pills. On phones this bar is a single row in landscape.
  Viewer panels no longer squeeze into one row there: they wrap into a grid, or
  stack one per row on a phone. Stat strips, headers, clusters and the Bragg
  peak table reflow instead of overflowing. On 4K at 150 %, Configure shows the
  workflow controls and the live preview side by side. On a 4K panel at 100 %,
  the console is scaled up. Touch screens get finger-sized controls, the shell
  uses the dynamic viewport height and safe-area insets, and phones get 16 px
  form text (no zoom on focus). Configure fields no longer spill out of their
  boxes on iPad widths. Long file names, run IDs and slider readouts wrap
  instead of being cut off. The AI Assistant page grows when its settings
  drawer is open, instead of running under the page footer. Checked at every
  target size (with iPhone safe areas emulated) for overlapping components
  and cut-off text. `web/src/index.css` ("Device layouts"),
  `web/src/App.tsx`, `web/index.html`; see `docs/web.md`.
- **NeXus Viewer import shows its progress.** While NEBULA3D waits for the
  volume, the viewer sends `nebula3d-import-progress` (stage label + overall
  fraction), and the import banner shows it as text and a progress bar instead
  of only "Waiting for the NeXus Viewer…". Once the file arrives, the banner
  shows the in-browser engine's start-up step and bar while it boots, instead of
  a bare "Loading…". The message is optional: older versions of either app
  ignore it or never send it. The Configure page's boot panel and the banner now
  share `bootPercent` (`api/pyodideEngine.ts`) and `useBootStatus`
  (`api/hooks.ts`). `web/src/api/importHandoff.ts` (`onProgress`, + test),
  `web/src/components/ViewerImportBanner.tsx`; see `docs/web.md`.
- **NeXus Viewer import: the two tabs no longer share a browser process.** The
  viewer opened this app with a window reference. Same-site tabs linked that way
  share one renderer process and main thread, so reloading, closing or crashing
  the viewer could also end a pipeline run here. A viewer on this app's origin
  now opens the tab with `noopener` and exchanges the same messages over the
  `BroadcastChannel` `nebula3d-import:<id>`. This app listens on the channel and
  on `window.opener`, so an older viewer and cross-origin dev servers still
  work. `web/src/api/importHandoff.ts` (+ tests); needs the matching
  neutron-nexus-viewer change; see `docs/web.md`.
- **Bragg backfill now fills from the diffuse around each hole.** The pipeline,
  `run_pipeline.py` and web default changes from `q_shell` to `local`.
  `q_shell` filled every hole with the median of its whole |Q| shell. That is
  biased at the lattice nodes, where correlations at lattice-vector separations
  peak or dip, and the node-periodic bias Fourier-transforms into spurious ΔPDF
  features at the lattice vectors. The standard punch-and-fill practice
  (NXRefine, Mantid `DeltaPDF3D`, KAREN) interpolates the surrounding diffuse.
  **Re-run backfill → ΔPDF on existing datasets: results change.**
  - **New `method="laplace"`:** a harmonic (Laplace) fill of all holes in one
    sparse system (Jacobi-preconditioned CG, no per-hole loop), continuing the
    local diffuse smoothly with no edge step. Its boundary sits `laplace_gap`
    (default 1) voxels outside the punch, so Bragg tails leaking past the punch
    do not pull the fill up; measured voxels in that band are kept. Exposed in
    `BackfillParams.laplace_gap`, the web method menu and `LAPLACE_GAP` in
    `examples/backfill_bragg_3d.py`.
  - **Synthetic check** (short-range order + node-peaked diffuse + Bragg):
    worst lattice-vector ΔPDF artefact ~2.3 % of the signal for `q_shell`,
    ~1 % for `local`, ~0.8 % for `laplace`. Backfill transient memory on a
    25 M-voxel volume: `q_shell` 41, `local` 25, `laplace` 35 B/voxel.
  - `q_shell` stays available for comparison. The web help text no longer
    claims it "interpolates".

- **3D-ΔPDF on non-orthogonal cells: true distances and real section angles.**
  The ΔPDF grid is unchanged (native FFT grid, `x_H/y_K/z_L` in Å along a, b,
  c), but the cell angles now travel with it. They are stored as
  `DeltaPDF.cell_angles` and as `lat_alpha/beta/gamma` in the `.h5` attrs (via a
  shared `pipeline.write_cell_attrs`). They are exposed as `alpha/beta/gamma` in
  the volume, ΔPDF and consistency lattice metadata, and sent with every ΔPDF
  slice (`axes_angle`, `r_center`, `r_perp`).
  - **True distances:** new `real_space_radius` and `section_geometry` in
    `nebula3d.analysis.delta_pdf`. The consistency r band and `r_data_max`
    now use the true metric; this is bit-identical for 90° cells.
  - **Web viewers** (3D-ΔPDF, multi-temperature, Q–R band) draw each section at
    γ/β/α. Unit-cell lines follow the lattice, and r-band circles are placed by
    true distance. The assistant's ΔPDF metrics and context use Cartesian
    positions and include the angles.
  - **matplotlib viewers** (`explore_delta_pdf_ortho.py`,
    `explore_delta_pdf.py`, `explore_delta_pdf_multi.py`) apply the same skew.
    This also fixes the ortho and multi viewers, which had crashed since the
    June rename on leftover `TEMP` / `central[t]` names.
  - **Older files** without angle attrs are drawn at 90° as before.
  - **`ub_from_lattice` fixed.** It returned a singular matrix for every cell;
    it now builds the Busing–Levy B matrix, and new `direct_cell(ub)` inverts it.
  - **Tests:** `tests/test_nonorthogonal_cells.py`, `tests/test_server.py` and
    `web/src/components/__tests__/oblique.test.ts` pin this on orthorhombic,
    hexagonal, monoclinic and triclinic cells.

- **Import from the NeXus Viewer.** The viewer's *Open in NEBULA3D* button
  opens this app with `?import=nexus-viewer&id=…&from=…` and posts its
  symmetrized, masked volume (nebula3d HDF5, padded symmetric about Q = 0)
  once the page reports ready; the in-browser build loads it like *Load
  volume…*, selects it as the dataset and reports back. Messages are exchanged
  only with `window.opener` at an allowed origin (own, drthyang.github.io,
  localhost in dev). `web/src/api/importHandoff.ts` (+ vitest suite),
  `web/src/components/ViewerImportBanner.tsx`; see `docs/web.md`.
- **Mantid loader: projection guard for non-orthogonal cells.** Each dim's
  `long_name` is now read as an (h, k, l) direction (`[-K,2K,0]` → (−1, 2, 0))
  and cross-checked against the `W_MATRIX` log. Only plain H, K, L axes (in any
  order) load; a projected grid such as the orthogonal hexagonal cut
  `[H,0,0]/[-K,2K,0]/[0,0,L]` is rejected with a rebinning hint instead of
  loading with silently wrong |Q| (the old parser took the first H/K/L letter
  in the label). Loads of existing orthorhombic files are bit-identical.
  `tests/test_nonorthogonal_cells.py` pins the guard plus metric-correct ring
  removal and ΔPDF peak placement on hexagonal (γ = 120°) and monoclinic
  (β = 110°) cells.
- **Build & CI hardening.** The packaged wheel no longer nests a stale copy of
  the Pyodide wheel inside itself (`vite build` copied `web/public/wheels`
  into `server/static/`, and `package-data` shipped it: 1.35 MB of
  Russian-doll wheels vs ~230 KB clean); `exclude-package-data` now drops
  `static/data` + `static/wheels` from every wheel, the native build no
  longer copies `web/public`, and one shared `scripts/build_web_wheel.py`
  (Makefile + Pages workflow) inspects the wheel and publishes it
  content-addressed under `wheels/<sha256>/` so a redeploy can never serve a
  Pages-cached stale wheel. The browser boot drops matplotlib (~9 MB of
  wheels it loaded only to render a `pdf_check` PNG nothing reads). Pages now
  deploys only after the CI workflow passes on `main`; CI type-checks once
  against pinned numpy/mypy stubs (per-Python stub drift had kept `main` red
  since July), runs the suite under the exact numpy/scipy/h5py/matplotlib
  Pyodide 0.27.7 ships, builds both frontend modes, and reports every matrix
  leg. Also: the package version is read from `_version.py` only, coverage
  moved from pytest `addopts` to the CI command (~40 % faster local runs),
  `httpx2` replaces `httpx` for the Starlette test client, matplotlib
  `set_bad` → `with_extremes`, and a CSS comment containing `*/` that had
  silently disabled the `.bragg-page` flex rule is fixed.
- **Browser engine: parallel ring removal, float32 compute, WebGPU ΔPDF.** The
  static (Pages/Pyodide) build now fans the ring stage out over a pool of slim
  Pyodide ring workers (bit-identical to serial by construction — the pure
  per-plane core in `nebula3d._ringplane` is shared by every backend; pinned by
  `tests/test_ring_parallel.py`), computes with float32 volume storage
  (`PipelineParams.precision`; axes/UB, |Q|-bin decisions, 1-D fits, and large
  reductions stay float64 — validated on three measured 48.4 M-voxel volumes
  at ΔPDF nrms ≤ 1e-5 with ≤ 2 punch-mask flips per volume, ~15–25 %
  faster), and runs the ΔPDF forward/inverse FFT cores on WebGPU when available
  (`web/src/gpu/` mixed-radix Stockham with numpy-pinned index math; scipy
  fallback at every rung; `fft=webgpu-f32-p5` cache token). The admission gate
  rises from ~50 M to **~80 M voxels** (401³ volumes now run in-browser).
  Plus: streaming consistency metrics and per-plane deapodization (bit-exact,
  ~30 B/voxel off the old peak stage), wheel-manifest boot (no hardcoded
  version), lazy `nebula3d.visualization` import, MEMFS upload-leak fix, and
  workers moved to ES modules (`pyodide.mjs`). Native float64 runs are
  hash-verified bit-identical to the previous release.
  See `docs/reports/2026-08-07_browser_parallel_f32_webgpu.md`.
- **Ring Removal 2.0 — sample-only global 3D powder-shell inference.** Added the
  opt-in `ring_model="global_v2"` path for datasets where an empty-environment
  scan omits the Al holder or over-subtracts. It detects narrow shells in the
  unsubtracted 3D sample volume, weakly identifies the FCC Al family and fitted
  lattice parameter, fits a Bragg-robust real-spherical-harmonic angular field,
  propagates model uncertainty, and defaults to lower-confidence-bound
  subtraction. `auto`, `aluminum`, and material-agnostic modes plus
  conservative/mean/diagnose-only policies are exposed in Python, API, Pyodide,
  and Configure UI. Pipeline runs write a JSON diagnostic sidecar. Legacy
  patched/parametric models remain available and the default pending full
  real-data qualification.
- **The backfill no longer invents data outside the measured coverage.** It
  filled every masked voxel, so on a hexagonal dataset the large part of the
  box past the coverage sphere got its rim's shell median, which then entered
  the flatten fit, the ΔPDF, the back-FFT check and the viewers. The fill now
  interpolates and never extrapolates: punch holes, and unmeasured pockets that
  measured data enclose (the direct-beam shadow, dead voxels), are filled as
  before; unmeasured regions that reach a face of the box stay masked.
  `BackfillParams.unmeasured="all"` restores the old fill. See
  docs/algorithms/inpainting.md.
- **The 3D-ΔPDF window respects the lattice symmetry and the measured
  coverage.** The separable window (a product of 1-D tapers along H, K, L) is
  not invariant under the hexagonal 6-fold, so on a hexagonal (6/m) dataset
  the ΔPDF along a and b differed from a + b by a few per cent of the main
  peak. New `window_shape`
  (`auto` | `separable` | `ellipsoid`; server `pdf_window_shape`, and a web
  control): `auto` tapers hexagonal cells on the largest symmetric ellipsoid
  inside the box, and keeps the separable window bit for bit for orthogonal,
  monoclinic and triclinic cells. New `support=` (pipeline `window_support`,
  default on; web "Taper to the measured coverage"): masked voxels enter as
  ΔI = 0 and the mean is taken over the data only; where the coverage ends
  inside the box, the ellipsoid shrinks until at most 10⁻³ of its weight lies on
  unmeasured space. With the backfill now leaving that space masked, the
  hexagonal data change by well under a per cent at 2–15 Å. Cached ΔPDFs are
  recomputed once. See
  docs/algorithms/delta_pdf.md.
- **The Bragg punch and the edge trim follow the declared Laue symmetry.** On a
  symmetrised volume (e.g. 6/m from the NeXus Viewer), the punch mask and the
  coverage-edge trim are now invariant under the operations the file declares
  (`PipelineParams.symmetry="auto"`): a voxel punched at one equivalent position
  is punched at all of them. On the hexagonal data, a sizeable fraction of
  punched voxels had an unpunched partner; now none. The H guard and the thirds exclusion hold on every
  equivalent plane, so with 6/m the guard is a hexagonal prism.
  `symmetry=None` restores the old behaviour. See
  docs/algorithms/bragg_cleanup.md.

## 0.3.0 (beta) — 2026-07-05

First beta. Adds an in-browser AI Assistant, a sidebar UI refresh, and the
low-memory + performance work below.

- **AI Assistant — grade the reduction from computed metrics.** A new browser
  view (`web/src/llm/`) connects to a local (Ollama / LM Studio) or cloud
  (OpenAI / Gemini) model and assesses the reduction, grounded in numeric
  metrics computed **in the browser** from the stage volumes — ring-removal
  residual energy, a leftover-Bragg-peak scan plus fitted peak-profile summary,
  backfill seam / checkerboard diagnostics, and ΔPDF feature SNR / anisotropy /
  radial trend. Four one-click stage reviews plus free chat; a ChatGPT-style
  transcript with markdown + LaTeX-Greek rendering, a rotating "sun" avatar, and
  collapsible model reasoning; an optional vision toggle that attaches the
  rendered slice for image-capable models. Everything is client-side — nothing
  leaves the machine except the chat call to the user's configured model server.
  The metrics layer is unit-tested (Vitest). Fixed a stack-overflow in the ΔPDF
  metrics on full-resolution slices along the way.
- **Sidebar UI refresh.** A single global dataset switcher lives in the sidebar
  (per-page dataset pickers removed; Configure shows it read-only); the chat
  session persists across page navigation; the brand is set full-caps; and the
  Multi-volume view is hidden for now. The browser build keeps full feature
  parity with the native backend.
- **In-browser low-memory mode — smaller peak, bit-identical results.** A new
  `NEBULA3D_LOW_MEMORY` mode (`nebula3d.core.low_memory`, always on in the
  Pyodide bridge) trades a little recompute for a smaller peak so full-resolution
  reductions fit the 4 GB WASM heap (Pyodide is 32-bit; there is no wasm64
  build). The ring stage drops its full-3-D |Q|/φ coordinate caches (per-plane
  2-D recompute), the flatten stage subtracts in place, and the unused per-voxel
  `sigma` is freed before the ΔPDF / back-FFT stages. **Verified byte-for-byte
  identical to the exact path on real data** — a 401×501×151 (30.3 M-voxel)
  neutron dataset gives identical backfilled / flattened / ΔPDF volumes and
  identical consistency metrics either way; the whole reduction peaks at ~2.3 GB
  (binding stage: the back-FFT consistency check, ~75 B/voxel). Separately, the
  ring-workflow `backfill_ring_shells` (not the default `q_shell` Bragg backfill)
  now bounds its all-valid-voxel KD-tree to a per-H-slab local tree in
  low-memory mode — within ~1e-5 relative of the exact fill, tested in
  `tests/test_backfill_blocked.py`. 222 tests, ruff, and mypy clean.
- **Pipeline ~22–31 % faster with bit-identical outputs.** Browser audit +
  performance pass (see
  [docs/reports/2026-07-02_browser_audit_perf.md](docs/reports/2026-07-02_browser_audit_perf.md)):
  HDF5 stage outputs now use gzip-1 + byte-shuffle (lossless, ~8 % smaller,
  ~2.6× faster writes), consecutive pipeline stages hand volumes over in
  memory instead of re-reading compressed HDF5 (artifacts and resume
  behaviour unchanged), and the ring-removal texture fit solves its per-|Q|
  ridge systems in one stacked LAPACK call. Every stage artifact verified
  SHA-256-identical before/after at two volume sizes, serial and parallel;
  219 tests, ruff, and mypy clean; in-browser end-to-end run verified
  (6/6 stages, consistency check near-exact, no console errors).
- **Milestone: fully static, GitHub Pages-hosted app with feature parity.** The
  browser console now runs the **complete** `nebula3d` reduction — every pipeline
  stage, cleanup, 3D-ΔPDF, multi-volume, and consistency view — entirely
  client-side via Pyodide, at **full-resolution float64** (up to ~50 M voxels;
  a 301×401×401 volume fits). No server, no upload, no install: the app is a
  static bundle served from **https://drthyang.github.io/nebula3d/**, deployed by
  `.github/workflows/pages.yml` on push to `main`. The in-browser build is now a
  first-class path alongside the native `nebula3d-web` backend, not a reduced
  demo. Under Pyodide (no OS threads) ring removal falls back to serial slice
  processing; native CPython still parallelises.
- **Spherical-frame Bragg punch.** The default punch ellipsoid axes now follow
  the local spherical frame at each peak — `(rρ, rθ, rφ)` in Å⁻¹ with rρ radial
  (along Q̂), rφ azimuthal (a*–b* ring tangent, c* pole), rθ polar — so every
  reflection is oriented correctly with no tilt angle. Added
  `punch_frame="spherical"` (now the `PunchParams` / web default) alongside the
  existing `"q"` (a*/b*/c*) and `"hkl"` frames; the legacy frames are unchanged.
  Configure and Bragg-profile pages gain a frame selector and rρ/rθ/rφ controls,
  and the punch preview renders the per-peak oriented ellipse.

## 0.2.0 - 2026-06-18

- Promoted the consistency check to the endpoint of the recommended 3D-ΔPDF
  workflow.
- Added the FastAPI/React consistency viewer and `/api/consistency` endpoints
  for reciprocal-space back-FFT comparison with optional `|Q|` and real-space
  bands.
- Updated `examples/run_pipeline.py` to run the back-FFT consistency check by
  default after the ΔPDF stage.
- Updated documentation around the full workflow, web UI, reproducibility
  commands, and output artifacts.
- Aligned package, API, and web app version metadata at `0.2.0`.

## 0.1.0 - Initial alpha

- Initial alpha toolkit for reciprocal-space diffuse-scattering cleanup and
  3D-ΔPDF exploration.
