- **Validation arm C removes the whole method, with one switch.** Arm C (the
  Pilot without its skills) is no longer arm B with the skills' listing cut out
  of the system prompt. One switch, `skills: false`
  (`web/src/llm/skills.ts`), is read by every builder of what the model reads:
  with it off the system prompt has no skills' section, `read_skill` is not
  offered, there is no skill gate, and every text keeps its definitions and
  leaves out its inference (which reading to use for a conclusion, what a
  pattern is evidence of, what a finding calls for): the system prompt's
  readings of its four checks, nine tool descriptions, two tools' readings, the
  stages' goals and criteria, the verdicts' remedies, the context's search note
  and the tuning prompts' help for three settings (`web/src/llm/inference.ts`;
  `6-inference.md` among the model-visible snapshots lists all 79 spans). The
  answer checks still check arm C's answers and send the same ones back, worded
  to name no skill, stage or tool to run next. With the switch on, what the
  console and arm B send the model is unchanged, byte for byte. Records made
  before this change ran arm C with the method's inference still in its text;
  [docs/evals.md](docs/evals.md) describes the arm as it now runs (the
  manager's decisions on the user's delegation, 2026-10-19).
