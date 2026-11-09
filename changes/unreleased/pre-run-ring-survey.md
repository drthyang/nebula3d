- **NEBULA Pilot: a powder ring survey before the run (THY-43).** Before
  the workflow, `ring_survey` reads the raw volume's powder rings as the ring
  stage would find them, nothing removed: its own detection, 3D ring test,
  Al lattice fit and phase match as a dry run, a few seconds on a 401³
  volume natively. It labels the sample environment's Al lines with their
  hkl, names another phase whose lines may explain other rings as a
  possibility with its evidence, and flags each ring no line explains with
  its |Q| and strength; on a volume with no ring it flags nothing. The raw
  view draws them (AL and the line, the phase and its line, "?" and the
  |Q|), in both engines. The Pilot is offered it only before a run, when
  reduction-qc's core also says to run it first; auto mode's preflight runs
  it. The ring stage's 3D test now reads its slabs on threads natively,
  with the same verdicts, so the ring removal's detection is faster too.
