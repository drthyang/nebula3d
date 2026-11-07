- **NEBULA Pilot: the auto report names the problems in the data.** The
  report reply now starts with the problems the final checks found in the
  data, with their numbers, or says they found none. Before, it gave each
  stage's verdict, so a stage that passed hid its data's problem, such as a
  turned UB or a shifted HKL origin. The problems come from the checks'
  verdicts only.
- **NEBULA Pilot: auto replies have an output cap.** On a model server that
  sets none (a local model, an OpenAI-compatible cloud one), each auto reply
  may write at most 16,000 tokens, the validation's cap. A reply cut at the
  cap is kept as the chat keeps one, with its note and ⚠ marks, and the run
  goes on to its report. Claude keeps its own caps.
- **NEBULA Pilot: Stop ends an auto run with the app's report.** Pause still
  stops the run so that Resume can go on. Stop ends it where it is: the app
  writes the report from what the run checked, with no model reply and no
  cost. The report says "stopped by you", the rows it did not reach are
  marked not checked, and the panel's Report opens it. A report that a limit
  left to the app opens the same way.
- **Fix: "wait for the run under way to end" stayed after the run ended.** In
  the browser build, a reload empties the engine, so the demo is loaded and
  run again. A click on "Run auto analysis" during that run was refused, and
  the note stayed until the next click. It now shows only while a run is
  under way.
