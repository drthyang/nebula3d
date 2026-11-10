- **Pilot: the magnetic reading of a 3D-ΔPDF's signs (2026-11-09).** A
  model-visible change to the ΔPDF interpretation skill.
  - On a map of magnetic diffuse scattering (a 3D-mΔPDF) a positive feature
    means the moments separated by that vector are parallel on average, a
    negative one antiparallel. The skill had only the atomic reading ("more
    pairs", "fewer pairs"), which is wrong there.
  - The Pilot does not tell the kind of map from the picture: the user says. A
    magnetic ion set for the flatten is a hint only. Not told, it asks, or
    states which reading it used.
  - The skill's Details say what sets a magnetic feature's size (the moments
    and their correlation, not the nuclear scattering contrasts), that the
    vacancy, clustering and displacement readings do not carry over, and that
    unpolarised neutrons give the sign but not the moments' direction.
  - The parallel or antiparallel reading is exact only without long-range
    magnetic order. In an ordered state, with the magnetic Bragg peaks punched
    and backfilled, the map shows the departure from the average ordered
    structure: the Details say so.
  - `dpdf_peaks`' description words its sign reading as an atomic map's.
  - Cost: the skill's core read grows by 201 characters (67 estimated tokens);
    the chat's worst turn is unchanged; the auto run's worst fix grows by 67,
    its ceiling raised 10,733 to 10,800 with the user's yes.
  - The highlights the Pilot draws on the ΔPDF (the `dpdf_peaks` marks) follow
    the structure panel's "ΔPDF type". With Magnetic the legend reads
    "+ parallel" and "− antiparallel" and its help says moments parallel or
    antiparallel; with Atomic (the default) it reads "+ more pairs" and
    "− fewer pairs" as before. The marks are the same for both. An interface
    change only: the model reads none of this text.
