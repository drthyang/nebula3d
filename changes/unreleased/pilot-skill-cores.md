- **The Pilot reads a skill's core, and the rest on request** (THY-63 R4,
  skill text awaiting the user's review). Each skill is written as a head,
  `## Gates` (its thresholds, each once), `## Steps` and `## Details`.
  `read_skill` returns the head, gates and steps; Details, or one part of it,
  comes with `section`. A reference page longer than 4,000 characters is read
  from an index of its headings, one section at a time (a long section part
  by part), where a page used to be cut at 12,000. On the token budget's
  worst turn the skills read fall from about 20.8k to 9.9k estimated tokens.
  The skill lint holds each skill to the form.
