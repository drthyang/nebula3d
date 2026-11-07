- **Fix: a run from a stage skipped a stale symmetry average.** With the
  symmetry average on, a run from the ring removal (the NEBULA Pilot's rerun
  after a change, a Run card) ran the stages from the ring removal alone, so
  after an edge-trim or Laue class change the ring removal read the old
  average. Such a run now makes the average again when its record says it no
  longer follows from the raw input and its settings, with every stage after
  it, and reuses it otherwise. After a change to the edge trim or the Laue
  class with the average on, the Run card starts at the symmetry average.
- **Fix: the Pilot's ring gate took a ring verdict from before a run.** A 3D
  ring verdict in the chat stayed current after a run from a Run card, the
  Configure or Execution page, or outside the console, so a ring change could
  pass on a verdict about outputs no longer there. Any run that recomputes the
  ring removal now makes an earlier verdict stale, as a card's own ring check
  already was; a run that reuses the rings leaves it standing.
