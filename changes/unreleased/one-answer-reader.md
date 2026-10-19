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
  misorientation was credited as reporting one, and a 4 read out of "4,190",
  "1/4" or a list's "4." was credited as the ring at 4.05 Å⁻¹. Every
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
