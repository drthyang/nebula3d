- **NEBULA Pilot's tool descriptions are short contracts.** Each tool tells
  the model what it answers, what it takes, what it returns and when to call
  it, in at most 500 characters (it was up to 1,300); the method is in the
  skills and the docs (`docs/pilot-tools.md` keeps the text the descriptions
  held). Every request is about 1,600 tokens lighter. A threshold that left a
  description is in its tool's result: texture_check now states its
  fill-bias rule. configure_settings lists only the settings off their
  defaults, with how many are at them; `all: true` lists every one.
  dpdf_peaks says how to read its entries in its description, not in every
  result.
