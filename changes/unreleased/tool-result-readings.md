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
  field the model's copy left out has one.
