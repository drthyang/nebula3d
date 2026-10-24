- **NEBULA Pilot: a compacted skill keeps its gates.** In a long reply on a
  local model, the loop shortens the older tool results, and a skill the
  model read was cut to its first 400 characters, which could leave out the
  thresholds and rules the model is to work by. A skill that writes its gates
  under a `## Gates` heading now keeps that section whole when it is
  shortened, beside its name and the same opening as before
  (`web/src/llm/readings/compact.ts`). The section is capped at 1,200
  characters: past that it is cut at a line boundary, with a note of how many
  lines were left out, so the shortened skill stays under 1,800 characters and
  a 32k window still holds the longest turn. A skill without the section is
  shortened as before, byte for byte; no skill has one yet, so what the model
  reads is unchanged until the user writes them. A test per skill turns on
  when it gains the section, and holds that every number in it survives
  (plan 5.3, the code; the manager's decision on the user's delegation,
  2026-10-19).
