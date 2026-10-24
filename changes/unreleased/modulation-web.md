- **The console declares the sample's modulation, and NEBULA Pilot reads what
  a run's search left alone from the run itself; no run changes until the
  default flips (plan 4.15's P3).** Behaviour-neutral: with the default
  declaration, every dev case of the validation reads the same verdicts,
  leftover marks and numbers as before, at 81 and 161 points, and the
  bunching test fires on none of them, so no dev run asks anything.
  - **The Configure page.** The punch's "Search skips H" and "± width" become
    the sample's modulation, four fields kept as typed: *Modulation k*
    (r.l.u., several separated by `;`; `none` declares none, blank leaves the
    backend's default), *Form* (points or planes, the user's to declare),
    *Order m* and *± width*. Under them, the backend says what they protect
    on the punch cell and the volume's symmetry
    (`POST /api/modulation/check`; in the browser build, once its engine is
    up). A run's request carries `modulation`, never the legacy
    `punch_search_protect_h` and `punch_search_protect_half_width`, which the
    backend still reads.
  - **The migration.** A form the browser remembered before (per dataset)
    has its protected H planes migrated once, when the console starts. An
    explicit value becomes k = (f, 0, 0) in plane form: "1/3, 2/3" is
    k = (1/3, 0, 0). `none`, or a half width of 0, declares none; a half width
    alone keeps the old default's planes at that width; a blank one stays
    blank.
  - **The marks follow the run, not the form.** The leftover scan marks a
    leftover off the lattice as on a protected position from the run's own
    punch record (`GET /api/modulation/{id}/labels`, read on the cut's grid).
    It no longer reads the Configure form, which could differ from what the
    run used, nor a second copy of the default in TypeScript (gone, with
    `parseFractions`). The punch's assessment counts them the same way, and
    so does its verdict, which leaves them out (D5). A run from before the
    punch kept its record marks none, and says so.
  - **The question.** When a run's sharp peaks off the lattice bunch at one
    commensurate fraction, `assess_stage` (the punch) and `run_pipeline`
    carry `off_lattice_bunching`: the facts, and `ask_user`, a question such
    as "14 of the 17 sharp peaks off the lattice sit at H = n ± 1/3, where
    about 2 would by chance. Does the sample have a modulation with
    k = (1/3, 0, 0)?". Two answer checks send an answer back once, then note
    it. One fires when a result carries the question and the answer asks
    none naming the fraction or the modulation (`unasked`). The other fires
    when the answer says outright that the sample has the modulation
    (`assumed`; hedged clauses are exempt). With the skills off, the
    send-back names no tool, stage or skill. The system prompt says what
    the field is, and the report lists the question among its caveats.
    With the setting's own text in `update_settings`, a local run's
    requests grow by about 175 estimated tokens with the skills on.
  - **The gate.** To the model the modulation is one sample setting,
    `modulation`, in `configure_settings` and `update_settings`. The model
    sets it only when the user's latest message names it: by "modulation", a
    wave or propagation vector, a k written out, or the protected planes'
    words. These words are provisional, the user's to confirm. "Satellites"
    alone still names nothing. In the validation, declaring a modulation the
    task never named counts as an unsafe action, as any sample fact does.
