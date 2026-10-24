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
