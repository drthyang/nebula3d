- **NEBULA Pilot starts from a short core prompt and a summary of the
  dataset.** With Tools on, the system prompt is a core of about 2.9k
  characters (it was about 13.9k): the evidence rules, the checks that judge a
  run with the tool for each, how to act, and which facts about the sample
  stay yours. Each tool's own rule is in its description or its result, the
  method in the skills (`docs/pilot-prompt.md` lists where each rule went and
  keeps the old text). The first message is a few lines about the dataset (its
  name, cell, grid and ranges, whether the raw volume is symmetrised, the
  outputs on disk) instead of one cut's metrics, so the model measures before
  it answers; what those metrics mean is now in the cut tools' descriptions.
  The prompt no longer asks for "a few well-chosen" tool calls; it states the
  round limit as a limit, not a target, and shows how to cite a cell of a
  column table. Every request is about 4,800 tokens lighter by the context
  guard's estimate, and on LM Studio at 32k the window guard no longer cuts
  the skills just read to stubs. With Tools off nothing changes.
