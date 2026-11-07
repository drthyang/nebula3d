- **NEBULA Pilot: the auto report lists the problems its checks found.** The
  app writes the list from the final checks' verdicts: each check that needs
  attention, with its reasons, and each problem in the data that no setting
  fixes, such as a turned UB or a shifted HKL origin, each with the tool that
  found it. When there is none, it says "none found by the checks". The list
  is shown above the report reply, in the activity log and in the report. The
  model writes no part of it: its reply gives each stage's verdict, what
  changed and why and what is left to decide, and refers to the list. A
  problem no check flags (a powder ring the ring check does not find) is not
  listed.
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
