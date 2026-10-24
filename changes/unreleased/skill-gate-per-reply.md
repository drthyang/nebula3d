- **NEBULA Pilot: the skill gate holds within a reply.** A stage's settings
  change, and the stage is tuned, only after its skill has been read in the
  same reply, or while the skill's whole text is in the messages the reply was
  sent. Before, a skill read in an earlier turn still counted in every later
  one, though the chat sends earlier turns as their text alone, so a later
  change passed the gate without the method in front of the model. A change
  in a later turn is now refused with "read the method again: call read_skill
  with name …", which says the skill was read earlier in the conversation but
  its text is not in this reply; once the model reads it again, the change goes
  through. The stage reviews work the same way. A reply's refusal for a skill
  not read before is worded as it was, and a single reply that reads and then
  changes is unchanged, so every validation run (one reply each) and both arms
  are unaffected: the token budget and the validation tests are unchanged, and
  the model-visible snapshots only gain the new refusal. With the skills off
  (arm C) there is still no gate (plan 1.7, the manager's decision on the
  user's delegation, 2026-10-19).
