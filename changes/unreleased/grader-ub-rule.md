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
