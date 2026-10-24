# Skill interviews

A skill is the user's method in their own words (`.claude/skills/<name>/SKILL.md`),
read by NEBULA Pilot (`read_skill`) and by Claude Code alike. The three skills
below are drafts, written from this repository's docs and the research rounds.
Each keeps its *Draft: awaiting the user's interview* status until the user has
been interviewed on it. This page is the guide for those interviews. The
interviews are the user's time: the guide prepares them and answers none of
its questions.

Each answer lands in one of four places:

- **the skill's text:** the order, the judgment calls (each draft marks them
  "(to confirm with the user)"), the checklist, what to report. Skill text goes
  in its own PR, which waits for the user;
- **code:** a firm rule the app enforces, or a limit a tool judges by. The
  skill gate in `web/src/llm/skills.ts` is one: a stage's settings change, and
  the stage is tuned, only after its skill has been read in the same reply. A
  tool can also hold a rule of its own, as `ub_check` does on a symmetrised
  volume. A limit that changes goes in its own PR, with a decision record in the
  findings record (`docs/evals/validation/review-findings/`);
- **a tool description or a stage's goal** that restates a skill (X1). It
  changes with the skill text, in the same PR;
- **an eval scenario** (`web/src/llm/evals/scenarios.ts`): a request the user
  makes and what a right answer does, so a later change cannot quietly break
  it. Each skill has one today, on the firm rule, with a good and a bad replay.

How to run one: ask a few questions at a time, starting from the draft ("the
draft says X; is that how you do it?"). Ask for a dataset the method was used
on, and for one time it went wrong. Write the answers into the skill in the
user's terms, mark what is a firm rule, and add a scenario for each failure
they describe. Then show them the diff.

Skills and their examples use synthetic or published data only. Results on
the user's unpublished measurements stay out of the repository: describe them
qualitatively, as the docs do. No test-split case is read or quoted here or in
what the answers lead to: a limit the user asks to re-derive is re-derived on
the dev split and on constructed cases.

## How the questions are written

Each question has an id, so an answer can be recorded against it: R for
reduction-qc, B for bragg-node-audit, P for delta-pdf-interpretation, X for the
questions across the skills. Each has:

- **Ask:** the question, to put to the user;
- **Where:** the skill and its step, and the tool, field or constant, with
  file:line;
- **Today:** what the code does now;
- **Why it needs you:** why the code cannot settle it;
- **Options:** where there are some. One is marked *recommended* only where a
  physics reason favours it, and the reason is given.

*Before the freeze* marks a question whose answer changes a limit or a default
that the validation runs under. The agent plan (PR #18, `docs/AGENT_PLAN.md` on
its branch) asks for these to be settled before the code is frozen: once arms B
and C run on the test split, a change to them changes the tool those runs were
made with.

Line numbers are on `main` at `01032cf` (2026-10-19). In each section,
`SKILL.md:n` is that skill's file, and `llm/` is `web/src/llm/`. The skills are
quoted as they are on `main`. Batch 1's skill text (#17, branch
`validation/batch-1-skills`) is a proposed diff to them that waits for the user;
several questions ask whether to take its wording.

The skill fact sync (branch `skills/fact-sync`, stacked on #17) is a second
proposed diff that waits for the user, who decided on 2026-10-19 to "fix the
facts now, interviews after v1". It makes the skills state what the tools and
the verdicts do, and changes none of the method: where the declared symmetry
and the ΔPDF's settings on disk come from (R5 (b), P2), the turn the verdict
calls a UB turned (R3), the ring rule's other two conditions and the
three-times-noise count (R8 (b)), which grain test has a control (B5 (a)), the
width limit off by default (B7), the operations `symmetry_check` tests (P3
(c)) and the round trip's 0.999 (P4). What those questions ask of the method
stays open here.

## 1. Reduction QC (`reduction-qc`, draft)

`SKILL.md` is `.claude/skills/reduction-qc/SKILL.md`.

### R1. The order

**Ask:** Do you check the UB before the coverage edges, or the other way round?
Is there a check you always make first that the draft leaves out (detector
masks, normalisation, the background subtraction)?

- **Where:** steps 1–7 (`SKILL.md:24-78`).
- **Today:** No tool enforces an order. The system prompt has a method of its
  own, four checks that start with the rings (`llm/prompts/system.ts:120-128`).
  It is the Pilot's, not a skill's, so it stays when the skills are off (X2).
- **Why it needs you:** The order is your method. A wrong UB misleads every
  later check, and so does a band past the counts.

### R2. The UB: what to read, and a shifted origin

**Ask:** (a) Should step 2 name `mean_offset_rlu` and `origin_shift_rlu`, and
say to report the origin, not the UB, when the second is given? (b) Are "more
than a quarter voxel off, less than a fifth removed by the fit" the right test
for an offset no UB explains, and 0.8 of what the fit leaves the right share
for naming it the origin's shift? (c) What do you do about a shifted HKL
origin?

- **Where:** step 2 (`SKILL.md:28-38`); `ub_check` (`llm/tools/index.ts:1248-1319`):
  `radial` (:1282), `mean_offset_rlu` (:1287-1293), `origin_shift_rlu` (:1294);
  `unexplainedOffset` and `originShift` (:1224-1244).
- **Today:** The skill reads the radial offsets by |Q| band and direction, and
  names neither field. `ub_check` gives the peaks' mean offset from their
  nodes in r.l.u., before and after the fit. A UB error averages out over the
  nodes and the fit removes it; a shifted origin moves every peak by one
  vector, which no UB can remove. When the peaks sit more than a quarter voxel
  off their nodes and the fit removes less than a fifth of that, the offset is
  unexplained. When the mean vector then makes 0.8 or more of the RMS the fit
  leaves, the tool gives it as `origin_shift_rlu` and says "Report the origin,
  not the UB" (:1305).
- **Why it needs you:** The skill text is yours. What to do about a shifted
  origin (reduce again, shift the grid, or only report it) is a reduction
  decision.

### R3. How large a turn, and when it wants a regrid

**Ask:** (a) How large a turn of the UB do you accept before you act on it?
(b) When do you regrid onto a refined UB, and when do you refit the UB in the
reduction and reduce again? (c) Should the Pilot run the regrid, or only
suggest it? (d) On a symmetrised volume, do you accept the regrid made from its
unsymmetrised source and symmetrised again?

- **Where:** step 2 (`SKILL.md:37-38`, which points at `examples/refine_ub.py`
  and marks the size "(to confirm with the user)"); "What to report"
  (`SKILL.md:118-122`: whether to regrid is the user's); `UB_TURN`
  (`llm/verdicts/rules.ts:436`); the regrid action,
  `nebula3d.analysis.ub_regrid.regrid_dataset` ([regrid.md](regrid.md); server
  `POST /api/datasets/{id}/regrid`, #26). No Pilot tool calls it yet (agent
  plan 4.7, its TypeScript half).
- **Today:** The verdict calls the UB turned at 0.05° or more from an
  unsymmetrised fit (D4, decided). That is where the fit's own noise ends, not
  a tolerance you set. The regrid refines the UB as `ub_check` does and writes
  `<stem>_regridded.nxs` as a new dataset beside the raw one, never over a
  file. It refuses a turn under 0.05° ([regrid.md](regrid.md#when-it-refuses),
  `turn_below_noise`), and a symmetrised volume whose unsymmetrised source is
  not beside it; with the source, it regrids that and symmetrises the result.
  It costs the voxels whose Q leaves the old grid (4.9 % of a fully measured
  synthetic 61³ box turned by 0.3°, far fewer on data that do not fill the
  box), and the edge trim takes one layer more at load
  ([regrid.md](regrid.md#what-a-regrid-costs)).
- **Why it needs you:** Regridding resamples the data by interpolation;
  reducing again does not. Which you choose, and past what turn, is your
  method.
- **Options for (a):** (i) one line at 0.05°: report and act; (ii) report at
  0.05° and act past a larger turn you name; (iii) a line in voxels rather than
  degrees: a turn θ moves a node at |Q| by about θ·|Q|, so the outermost nodes
  the punch must catch move the most.
- **Options for (c):** (i) the Pilot suggests it and you run it, as the skill
  says now; (ii) it runs it when your message in that turn asks for it, as
  agent plan 4.8 will hold sample facts (B10); (iii) it runs it on its own past
  a turn you name.

### R4. The `ub_refinement` reference and `docs/regrid.md`

**Ask:** Should the skill cite [regrid.md](regrid.md) for the regrid action and
its refusals: as a reference beside `ub_refinement.md`, in step 2 in place of
`examples/refine_ub.py`, or both?

- **Where:** References (`SKILL.md:124-127`); `read_skill` serves a reference
  whole up to 12,000 characters (`REFERENCE_MAX_CHARS`, `llm/skills.ts:158`).
- **Today:** The reference is `docs/algorithms/ub_refinement.md`, whose entry
  point is `examples/refine_ub.py` (`ub_refinement.md:4-5`). Neither the skill
  nor that page names the regrid action or when it refuses. Both pages are
  under 12,000 characters, so neither read is cut.
- **Why it needs you:** A reference is skill text (agent plan 5.2).
- **Options:** (i) add `regrid.md` as a second reference; (ii) step 2 names the
  action and its refusals and cites `regrid.md`; (iii) both.

### R5. Symmetrisation, and where the declared symmetry comes from

**Ask:** (a) Do you always work from the symmetrised volume, or keep the
unsymmetrised one for some checks? Which checks need it? (b) Should step 1 take
the declared symmetry from the tools that give it, or should `describe_dataset`
give it?

- **Where:** step 1 (`SKILL.md:24-27`), step 2 (`SKILL.md:30-32`), failure
  modes (`SKILL.md:105-106`); `describe_dataset` (`llm/tools/index.ts:296-338`).
- **Today:** Step 1 takes "the symmetry the file declares" from
  `describe_dataset`, whose result has no symmetry field. The declared symmetry
  reaches the model through `ub_check` (`symmetry_from`, :1270), `grain_check`
  (`declared_symmetry`, :1215), `symmetry_check` (`symmetry_declared`, :1020)
  and `assess_stage` for the ΔPDF (`llm/tune/evaluate.ts:124`). On a
  symmetrised volume `ub_check` fits only the changes that commute with the
  operations, and its UB is not judged (D4, decided).
- **Why it needs you:** Which checks need the unsymmetrised data is your
  method; the skill's wording is yours.
- **Options for (b):** (i) step 1 names the tools that give the symmetry (agent
  plan 5.4); (ii) `describe_dataset` gives the declared symmetry and whether the
  volume is symmetrised (a tool change, for approval).

### R6. The |Q| band

**Ask:** How do you place Qmin and Qmax in practice: where half of a shell's
voxels hold counts, as the tools do, or by eye on a cut? Do you keep a margin
inside them? With the window fitted to the coverage, do you still set a band?

- **Where:** step 3 (`SKILL.md:39-47`); `qmax_coverage`
  (`llm/tools/index.ts:1321-1433`) with `raw_counts`, `suggested_band` and
  `band_check` (`rawBand`, :1444-1475); the counts' edges
  (`src/nebula3d/analysis/coverage.py:9-10`, `HALF` :31).
- **Today:** The edges are where a shell's measured share first rises through
  one half and last falls through it; the suggested band rounds them inward to
  0.05 Å⁻¹. The band is suggested and never set by the model: it is not among
  the settings `update_settings` takes (`llm/tune/catalog.ts:1-5`). The backend
  shrinks its window until at most 1e-3 of its weight is on unmeasured space, so
  the coverage verdict cannot fail on the default window (agent plan, section D
  and 4.5).
- **Why it needs you:** The rule is yours ("where the raw counts begin and
  end"), and so is how it is applied.

### R7. Edge voxels

**Ask:** How many layers do you trim, and does that depend on the instrument or
the probe?

- **Where:** step 4 (`SKILL.md:48-53`); `edge_trim`
  (`src/nebula3d/pipeline.py:657`, applied at :729).
- **Today:** One layer is trimmed at load. A regridded dataset loses one layer
  more, since it is trimmed again.
- **Why it needs you:** How bright the edge is depends on the instrument and
  the reduction.

### R8. Powder rings: the rule's numbers, and two conditions the skill does not state

**Ask:** (a) Is at least 0.15 of the median height in 90 % of 128 directions
the right line? (b) Should step 5 also state the other two conditions, a height
three times its noise and a quarter of it above a curve, and are they right?
(c) Do your measured rings, textured or wandering in |Q|, clear all three?
(d) A ring too weak to clear them is neither removed nor counted: is that what
you want? (e) How large a dent or leftover do you tolerate?

- **Where:** step 5 (`SKILL.md:54-66`); `IsotropyConfig`
  (`src/nebula3d/preprocessing/ring_isotropy.py:87-88`: `direction_share` 0.9,
  `height_share` 0.15; :99-100: `min_snr` 3, `curve_share` 0.25) and the rule
  (:355-362); the rings' criterion and rule (`llm/verdicts/rules.ts:144-154`);
  [powder_rings.md](algorithms/powder_rings.md).
- **Today:** A shell is a powder ring when its median height over 128 direction
  cells is positive and at least 0.15 of it in 90 % of them; when, in the
  typical cell, it stands at least three times its flanks' scatter above them;
  and when at least 0.25 of the height stays above a quadratic through the
  flanks. A smooth hump under the shell reads as a height in every direction
  above a line, but not above the curve. The skill and the rings' criterion
  state the first condition only (agent plan, section E). The verdict counts a
  leftover or a dent only beyond three times its plane's noise (`rules.ts:145`,
  `:151`), which the skill does not state either. On synthetic volumes rings
  read an isotropy of 0.33 to 0.96 and the crystals' own shells −0.14 or less;
  above the curve, rings keep 0.35 of their height or more and an empty shell
  on a broad hump 0.15 or less (`ring_isotropy.py:32-44`).
- **Why it needs you:** All four numbers are marked "to confirm with the user"
  in the code. Which bumps are rings is physics.
- **Options for (b):** (i) step 5 states all three conditions and the
  three-times-noise rule (agent plan 5.4); (ii) they go in the skill's gates
  (X3); (iii) they stay in the code and its page, and the skill points there.

### R9. The flatten floor: its fields, and when to turn on the Q² term

**Ask:** (a) Should step 6 name the stage's fields, `floor_trend`,
`floor_span_fraction` and `pedestal_left` (`max_floor_trend` and
`max_floor_span_fraction` before plan 4.1), as #17 does? (b) Do you accept
#17's rule: turn `flattenQ2` on when `pedestal_left` is true, rerun from the
flatten and read it again, keep the term if the pedestal is gone, and leave it
off otherwise? (c) When is a floor that rises with |Q| background, and when
could it be signal? (d) When do you also extend *Fit to |Q|*
(`flattenFitQMax`)?

- **Where:** step 6 (`SKILL.md:67-74`); the flatten's evaluation
  (`llm/tune/evaluate.ts:318-338`): the whole volume's `floor_trend` (:329)
  and `floor_span_fraction` (:330), `pedestal_left` (:335); each plane's
  under `per_plane` (`llm/metrics/flatten.ts:83`).
- **Today:** The skill names `floor_trend`, which since plan 4.1 is the
  stage's own field (the whole volume's; before it, a per-plane field beside
  the planes' largest, `max_floor_trend`), and asks for
  floors "near zero across the whole coverage", while the verdict judges the
  outer half of the shells the counts reach (R10). It says a rising floor wants
  the Q² term but not when to turn it on ([pilot-review.md](pilot-review.md),
  finding 5). #17's step 6 names the fields and gives the rule in (b), but its
  first line still says "near zero across the whole coverage". The term is not
  free: on the dev split's clean controls it raised the scored pedestal span
  from 0.025 to between 0.066 and 0.107 of the diffuse level.
- **Why it needs you:** Skill text waits for you, and whether a rising floor is
  background is physics; #17 marks (c) "(to confirm with the user)".

### R10. The pedestal's judged shells and its limits (provisional, batch 1)

*Before the freeze.*

**Ask:** (a) Is the outer half of the measured shells where you look for a
pedestal? (b) Are a rank trend of 0.8 and a span of 0.8 of the diffuse level
the lines past which a pedestal is left? (c) Is the shell's 25th percentile the
floor you mean?

- **Where:** step 6 (`SKILL.md:67-74`); `judgedShells`
  (`llm/metrics/flatten.ts:50-90`) and `pedestalLeft` (:92-100); the flatten's
  rule and criterion (`llm/verdicts/rules.ts:206-216`);
  [pipeline.md](pipeline.md#the-floors-and-the-pedestal).
- **Today:** A pedestal is left when, over the judged shells, the floors' rank
  correlation with |Q| is 0.8 or more in size and their range is 0.8 or more of
  the diffuse level. The judged shells are those the counts reach (0.95 of a
  shell's voxels measured, not inside the fit range's start), from half the
  outermost such shell's |Q| outward. Both the outer half and the 0.8s were
  derived on the dev split, and the code labels them provisional. The reason it
  gives: after a constant fit the floors follow the crystal's own diffuse
  level, which rises to its strongest shells at low |Q| and falls past them, so
  a trend over every shell reads that fall wherever the coverage is short; an
  inelastic background is largest at high |Q|, where the diffuse's own
  oscillation is damped. On the eight dev cases, judged so, only the planted Q²
  background reads as a pedestal (trend 0.97, span 0.97; with the Q² term on,
  0.02 and 0.33); the cut-coverage case reads 0.93 and 0.49, the clean
  controls under 0.62 and 0.65 (`flatten.ts:66-70`).
- **Why it needs you:** These limits decide when a run's flatten meets its goal
  and, with #17, when the Pilot turns on the Q² term.
- **Options for (a):** (i) the outer half of the measured shells, as now;
  (ii) the shells past a fixed |Q|, as the validation's scorer judges its own
  pedestal (from 3.5 Å⁻¹ out to the coverage, `flatten.ts:71-72`); (iii) every
  shell in the fit range, as before batch 1, which read the cut-coverage case as
  a pedestal. *Recommended:* (i) or (ii) over (iii). Physics reason: an
  inelastic background (thermal diffuse and multiphonon scattering; Compton with
  X-rays) grows as Q², so it shows in the outer shells, where the crystal's own
  floor has stopped falling.
- **Options for (b):** (i) keep 0.8 and 0.8; (ii) a lower span limit (the clean
  controls reach 0.65); (iii) limits per probe.

### R11. The pedestal over the whole volume (agent plan 4.1)

*Before the freeze.*

**Ask:** When the verdict reads the whole volume's floors instead of three
planes, should its 0.8 limits be re-derived for that measure, from clean
controls and constructed pedestals only?

- **Where:** `nebula3d.preprocessing.shell_floors`
  (`src/nebula3d/preprocessing/flatten_floors.py`, #37;
  [pipeline.md](pipeline.md#the-floors-and-the-pedestal));
  `tests/test_shell_floors.py:389-415`; the verdict's reading of them
  (`llm/metrics/flatten.ts:298`, `volumePedestal`; `llm/tune/evaluate.ts:323`).
- **Today:** The whole volume's floors are measured on the flatten's own
  shells, and since plan 4.1 the flatten's verdict reads them, with the 0.8
  limits as they were set on the planes. On a synthetic volume with an isotropic Q²
  pedestal, the planes read a span of 0.99 and the volume 0.94, about 5 % lower,
  with the same trend of 1. The span divides by the diffuse level, the median
  over the measured voxels, and a shell holds voxels in proportion to Q² in the
  volume but to Q on a plane: the volume's median sits further out, higher
  where a pedestal rises. With the pedestal kept off the three planes, the
  planes read a level floor (span 0.03 to 0.05) and the volume the pedestal
  (span 0.96). Where the counts fill the box out to its corners, as on the
  dev cases, the volume's judged shells run past the planes' into the
  corners, and it reads a Q² pedestal's span 1.2 to 1.36 times the planes'
  ([pipeline.md](pipeline.md#the-floors-and-the-pedestal)).
- **Why it needs you:** 0.8 is your provisional limit, set on the planes'
  measure.
- **Options:** (i) keep 0.8 on the volume; (ii) re-derive both limits for the
  volume, from the dev split's clean controls and constructed pedestals of
  known size only, never the test split; (iii) keep the planes for the verdict
  and report the volume beside them. *Recommended:* (ii). Physics reason: the
  two measures weight the shells differently (Q² against Q), so a limit set on
  one is not the same limit on the other, and pedestals of known size show
  where the line falls on the new one.

### R12. What stops a run

**Ask:** What makes you stop and not run the 3D-ΔPDF at all? Should any of it
be a refusal in code rather than a sentence in the skill?

- **Where:** firm rules (`SKILL.md:81-89`); "What to report"
  (`SKILL.md:118-122`).
- **Today:** Nothing in the code stops a run before the ΔPDF. The tuning
  refuses a trial whose window puts more than 1e-3 of its weight on unmeasured
  space while the current settings stay inside that limit.
- **Why it needs you:** It is the skill's verdict on the whole reduction.

### R13. Rings seen from part of the sphere, and weak rings beside strong ones

**Ask:** (a) Between the box's face and its corner a shell is measured in some
directions only. May a ring be confirmed from part of the sphere, and from how
much of it? (b) A weak ring beside a strong one is subtracted at 1.2 to 2.4
times its amplitude. Is that a known limit you accept, or a fix to make?

- **Where:** the ring removal's noise floor and its open question
  ([pipeline.md](pipeline.md), "The candidates' noise floor, where the counts
  end early"); `IsotropyConfig.min_cells`
  (`src/nebula3d/preprocessing/ring_isotropy.py:150`); the keep-outs' bar,
  `_KEEP_OUT_SNR_SHARE` (`src/nebula3d/preprocessing/pooled_rings.py:119`);
  review finding B3.
- **Today:** A shell is judged on what the grid measures of its 128 direction
  cells, from 16 of them up (`min_cells`). On a synthetic cubic crystal, shells
  of the crystal's own pass as rings there whatever the noise, judged on 16 to
  32 cells. With `min_cells` at 64, half the sphere, all of them go, every
  planted ring stays, and the dev cases read as before; it stays 16 until you
  decide. Separately, on synthetic volumes with a weak ring (amplitude 0.05)
  beside a strong one (0.5), the weak one is subtracted at 1.2 to 2.4 times its
  amplitude in every geometry tried, full coverage included.
- **Why it needs you:** Which partial shells are rings, and how much error in a
  weak ring's subtraction the 3D-ΔPDF can carry, are physics.
- **Options for (a):** (i) keep 16; (ii) 64, half the sphere; (iii) another
  share you name, derived on the dev split and constructed cases.

## 2. Bragg-node audit (`bragg-node-audit`, draft)

`SKILL.md` is `.claude/skills/bragg-node-audit/SKILL.md`. Ported from the
scattering-agent-tools plugin skill of the same name.

### B1. The nodes and the punch cell

**Ask:** For a volume indexed on a supercell, how do you decide which nodes hold
Bragg peaks and which hold diffuse scattering? Who sets the punch cell, and
from what evidence?

- **Where:** step 1 (`SKILL.md:27-33`); `punchSupercellH/K/L`
  (`llm/tune/catalog.ts:32-58`).
- **Today:** The punch cell defaults to 1 along each axis: Bragg nodes at every
  integer. A volume indexed on a doubled cell needs 2, set by the user (B10).
  `ub_check` and `grain_check` take their Bragg nodes from it too
  (`llm/tools/index.ts:1263`, :1209).
- **Why it needs you:** The skill marks it "(to confirm with the user)".

### B2. Satellites and the protected planes

*Before the freeze.*

**Ask:** (a) When do you protect fractional-H planes, and how do you confirm
that they hold real satellites? Is ± 0.08 r.l.u. the right half-width? (b)
Should a sample have no protected planes unless you say it has satellites?
(c) Should step 2 say that sharp peaks on protected planes are reported on
their own line, out of the punch's verdict?

- **Where:** step 1 (`SKILL.md:27-33`), firm rules (`SKILL.md:67-68`);
  `punchProtectH` and `punchProtectHalfWidth` (`llm/tune/catalog.ts:16-31`);
  the pipeline's default, `search_exclude_h_fractions = (0.3333, 0.6667)`
  (`src/nebula3d/pipeline.py:514`); the punch's rule after D5
  (`llm/verdicts/rules.ts:156-177`).
- **Today:** By default the off-lattice search leaves the planes H = n + 1/3 and
  n + 2/3 alone on every dataset. Since D5 (decided), sharp peaks on protected
  planes stay out of the punch's verdict and are shown on their own line, as
  the punch's goal says they stay by design. So with the defaults, a spurious
  sharp peak at H = n ± 1/3 on a sample with no satellites is neither punched
  nor counted against the punch.
- **Why it needs you:** The skill calls the protected planes a fact about the
  sample, set only when you ask; the default sets them for every sample. D5
  itself is decided and not reopened here.
- **Options for (b):** (i) no protected planes by default; (ii) keep 1/3 and
  2/3, and the audit names them on every run; (iii) keep them as they are.
  *Recommended:* (i). Physics reason: satellites are a property of the sample,
  and the skill already treats the planes as a sample fact. (i) changes what
  the default pipeline punches, so it changes arm A too.

### B3. Leftovers at allowed nodes

**Ask:** What leftover at a node do you call a miss: a significance, a shape, a
share of the peak? Do you check every plane, or a few?

- **Where:** steps 2–3 (`SKILL.md:34-39`); the punch's rule
  (`llm/verdicts/rules.ts:167-177`).
- **Today:** Any leftover at a node on any of the three planes fails the punch
  (`leftover_at_nodes` must be 0). `assess_stage` measures the three planes
  through the origin (`llm/tune/evaluate.ts:17-19`); the off-zero cut the skill
  asks for needs `measure_reciprocal_cut`, which the skill does not name.
- **Why it needs you:** A real leftover is "sharp and stands above its own
  neighbourhood" (`SKILL.md:38-39`); how sharp, and how far above, is yours.

### B4. Forbidden nodes

**Ask:** When intensity sits at a forbidden node, how do you tell λ/2, multiple
scattering, a lower symmetry and a superlattice apart, and which do you test
first? What counts as "clearly above the local background"? Would a tool for
the 2h 2k 2l test and an orbit's members help?

- **Where:** step 4 (`SKILL.md:40-47`).
- **Today:** No tool measures the 2h 2k 2l test or compares an orbit's members
  (agent plan, section D); the skill reads them from `line_profile` and
  `show_in_viewer` by eye.
- **Why it needs you:** The skill marks "clearly above" "(to confirm with the
  user)", and which cause to test first is your method.

### B5. The grain tests and their controls

**Ask:** (a) Should step 5 say that only the rotated-copy test is judged against
random directions? (b) Should the near-node test get a control of its own?

- **Where:** step 5 (`SKILL.md:48-54`); `grainCheck`
  (`llm/metrics/grains.ts:106-163`): the near-node test (:126-136), the rotated
  copy and its control (:139-150); the grain's rule
  (`llm/verdicts/rules.ts:386-429`).
- **Today:** The skill says each test is judged "against the same search at
  random directions". Only the rotated copy is: a second grain needs at least
  four orbits, with one rotation indexing half of them or more and at least
  three times the random control plus three (`rules.ts:399`). The near-node
  test counts the strongest orbits within a quarter of the shortest node
  spacing of a node, and reads half or more of them as peaks beside the nodes
  (`rules.ts:396-397`), with no control. For points placed at random in a
  primitive cubic cell, about 6.5 % fall that close to a node (4π/3 · (1/4)³),
  so half is far above chance there; a longer cell axis lowers that share.
- **Why it needs you:** Skill text; and whether a test needs a control is your
  method.
- **Options for (b):** (i) none, and the skill says so (agent plan 5.4); (ii) a
  control like the rotated copy's: the same orbits at random directions at
  their |Q| (a tool change, for approval).

### B6. "UB off", peaks beside nodes, and a second grain

**Ask:** (a) Should step 5 say that `grain_check`'s "UB off" and its peaks
beside the nodes are a UB problem, so a reply cannot call the UB right, and
that `ub_check` on the unsymmetrised volume comes next? (b) Is 2° your line
between a UB that is off and a second grain? (c) When does a rotated copy count
as a second grain for you?

- **Where:** step 5 (`SKILL.md:52-54`); `SECOND_GRAIN_DEG`
  (`llm/metrics/grains.ts:55`); the grain's rule
  (`llm/verdicts/rules.ts:386-429`).
- **Today:** Decided (D3, D3a): `grain_check`'s "UB off" (one rotation under 2°
  puts half or more of the strongest orbits back on the lattice) and its peaks
  beside the nodes
  count as the UB off: a data problem in `{{achieved}}` and the report, and not
  OK for a claim that the UB is right. `grain_check` stays the check for a
  second grain. The skill says "a rotation under 2° is the UB, not a grain:
  check it with `ub_check`", and nothing of the peaks beside the nodes.
- **Why it needs you:** The decisions are made; the skill's wording and the 2°
  line are yours.

### B7. Broad maxima and the search's width limit

*Before the freeze.*

**Ask:** How broad must a maximum be to stay unpunched? Should the search's
width limit be on by default, and at what ratio to the Bragg width?

- **Where:** step 6 (`SKILL.md:55-57`); `punchSearchMaxWidth`
  (`llm/tune/catalog.ts:219-227`, default 0: off); `search_max_width_ratio =
  None` (`src/nebula3d/pipeline.py:517`); the punch's goal
  (`llm/verdicts/rules.ts:169`).
- **Today:** The skill says the width limit leaves broad maxima unpunched; by
  default it is off, so the search punches every candidate, broad or sharp. The
  setting's help suggests 2: spurious reflections are as sharp as Bragg peaks,
  so they stay punched while broad diffuse maxima stay. The punch's evaluation
  calls a leftover broad at a FWHM of 5 voxels or more along a slice axis, a
  different test from the search's ratio to the Bragg width.
- **Why it needs you:** Broad maxima are the signal; where "broad" starts is
  physics. A default that changes changes the default pipeline, so arm A.
- **Options:** (i) on by default, at a ratio you name; (ii) off by default, and
  the audit asks for it when it finds broad maxima punched; (iii) as now.

### B8. The fill-bias reading and its floor (provisional, batch 1)

*Before the freeze.*

**Ask:** (a) Do you accept #17's wording for step 7? (b) Is a fifth of the
local diffuse level the size of a systematic fill bias you would act on? (c) And
a median of 0.5σ, with 75 % of the holes one way? (d) Does your diffuse rise to
the nodes about linearly over the few voxels between a hole's rim and its node,
as the reference range assumes?

- **Where:** step 7 (`SKILL.md:58-60`); `texture_check`
  (`llm/tools/index.ts:901-954`, its description :912); `FILL_BIAS_FLOOR`
  (`llm/metrics/texture.ts:60-73`); `systematic_fill_bias` (:236, :249-254).
- **Today:** The skill reads "a fill bias near 0σ with about half the holes
  brighter" as clean. The tool compares each fill with the range its measured
  rim allows, from the diffuse at the hole's edge to its rise continued
  linearly to the node: the diffuse often peaks at the nodes (thermal diffuse
  scattering), so a sound fill sits above its rim's median. A cut has a
  systematic bias when at least five holes are judged, their median bias is
  0.5σ or more and a fifth of the local diffuse level or more, and 75 % of them
  lie one way. The fifth comes from this: a bias δ over holes that cover a
  share p of reciprocal space adds features at the lattice vectors that scale
  as δ·p; with the punch's ~3 % of the volume on the dev cases and a modulation
  of a tenth to a third of the level, a fifth makes a few per cent of the
  ΔPDF's features. On the dev cases the default fill reads at most 0.14 of the
  level; a fill set off by a tenth of the level reads 0.2 on one plane of the
  control. All three numbers are labelled provisional. A cusp sharper than
  linear (thermal diffuse ∝ 1/q² up to the node) can put a sound fill above the
  range (`texture.ts:19-22`).
- **Why it needs you:** The floor decides when the backfill "adds texture" in
  `{{achieved}}` and the report (D8, D14, decided).
- **Options for (b):** (i) keep a fifth; (ii) a floor scaled by the punched
  share p, since the artefact scales as δ·p: a fixed floor is looser on a
  volume punched more; (iii) another fixed share you name.

### B9. Which fill

**Ask:** Which fill do you use for which data, and what texture verdict do you
accept?

- **Where:** step 7 (`SKILL.md:58-60`); `backfillMethod`
  (`llm/tune/catalog.ts:247`); the fills in
  [bragg_cleanup.md](algorithms/bragg_cleanup.md), "Backfill Modes" (:611).
- **Today:** The default is `laplace` (`src/nebula3d/pipeline.py:562`); `local`
  puts one flat value in each hole, and `q_shell` is for comparison only. The
  skill's reference, `bragg_cleanup.md`, is 40 KB: a whole read is cut at
  12,000 characters, before "Backfill Modes", so the skill must cite that
  section by its heading (agent plan 5.4).
- **Why it needs you:** Which fill suits which data is your method.

### B10. Sample facts change only when you ask (agent plan 4.8)

**Ask:** (a) What counts as your asking: the setting and its value named, the
fact named ("it is indexed on a doubled cell"), or a yes to a change the Pilot
proposed in the turn before? (b) Should any setting besides the punch cell and
the protected planes be a sample fact?

- **Where:** firm rules (`SKILL.md:63-68`: "enforced in code");
  `update_settings` (`llm/tools/defs/update_settings.ts`); `SAMPLE_PARAMS` and
  `namesSampleFact`, with the words that name each fact (`llm/tune/catalog.ts`);
  [pilot.md](pilot.md), "Facts about the sample are yours".
- **Today:** Since #68 (agent plan 4.8), `update_settings` refuses a change to
  a sample fact unless your latest message names it: by the setting's name, or
  in words such as "protected planes", "punch cell" or "doubled cell". It makes
  the rest of the call, and the model asks you. The gate reads names, not
  intent: a bare "yes" names nothing. The tuning run never changes a sample
  fact. The validation counts a change the task never named as unsafe, and an
  attempt the gate refused too, once per fact and reply. The magnetic ion and
  the |Q| band are not settable by the model at all (`catalog.ts`).
- **Why it needs you:** The gate's definition of "asks", option (i) below, is
  provisional until you give yours.
- **Options for (a):** (i) your message in that turn names the setting or the
  fact; (ii) also a yes to a change the Pilot proposed in the turn before;
  (iii) only a setting and its value.

### B11. Where the punch went wrong

**Ask:** Where did the punch go wrong on a dataset you otherwise trusted it on?

- **Where:** failure modes (`SKILL.md:82-90`).
- **Today:** The skill's one eval scenario is on the gate
  (`llm/evals/scenarios.ts:218-222`).
- **Why it needs you:** Each failure you describe becomes a failure mode and an
  eval scenario.

### B12. The azimuthal ratio

*Before the freeze.*

**Ask:** (a) Is an azimuthal ratio near 1 part of a clean backfill for you, as
step 7 says? (b) If it is, how near, and should a rule judge it, or is it
reported only?

- **Where:** step 7 (`SKILL.md:58-60`); `texture_check`'s `azimuthal_ratio`
  (`llm/metrics/texture.ts:58`, `azimuthalVariation` :247-282, :323) and its
  description (`llm/tools/index.ts:941`); the texture rule
  (`llm/verdicts/rules.ts:464-475`); the system prompt's third check
  (`llm/prompts/system.ts:133-134`). These `llm/` lines are on the fact sync's
  branch, `skills/fact-sync`.
- **Today:** On each cut the tool splits every |Q| shell into 24 sectors and
  takes how much their means vary around the shell (the coefficient of
  variation, its median over the shells), before the punch, on the voxels it
  keeps, and after the backfill. The ratio is after over before: near 1 the
  backfill added no azimuthal texture. The texture rule judges
  `systematic_fill_bias` only, so no ratio, however far from 1, makes the
  backfill need attention in `{{achieved}}` or the report. The skill and the
  system prompt both read "an azimuthal ratio near 1" as part of a clean
  backfill, and neither says how near; the skill lint lists that 1 as a number
  with no constant behind it.
- **Why it needs you:** How much azimuthal texture the 3D-ΔPDF would show as
  features is physics, and a rule that judges it changes the backfill's
  verdict.
- **Options for (b):** (i) a rule judges it, at a ratio you name, derived on the
  dev split and constructed cases; (ii) it is reported, not judged, and step 7
  says so; (iii) step 7 drops it.

### B13. Declaring a modulation: three provisional choices (agent plan 4.15)

**Ask:** When you declare a modulation k: (a) a position that falls on the
lattice (2k on a node, say) is dropped; is that right? (b) The order runs from
1 to 6 and the half-width lies between 0 and 0.5 r.l.u.; are those the bounds
you want? (c) A k written as a decimal becomes the simplest fraction within
5·10⁻⁵ of it; is that the reading you mean?

- **Where:** `nebula3d.modulation.Modulation.parse` and `positions`
  (`src/nebula3d/modulation.py`); [modulation.md](modulation.md), "Declaring
  one".
- **Today:** As (a) to (c), labelled provisional in the code. The default
  declaration, until 4.15's last step, is today's planes as k = (1/3, 0, 0) in
  plane form, 0.08 r.l.u.
- **Why it needs you:** How a modulation is written down is your notation, and
  the bounds decide which declarations the app refuses.

### B14. The fill's rims on a coarse grid (agent plan 4.2)

**Ask:** (a) Around a Bragg node, does a rim that rises away from the hole read
past the node's own diffuse, so its range no longer says what the fill should
be? If so, what share of such rims should stop the verdict? (b) Should a rim's
depth be set in reciprocal space rather than as 4 voxels? (c) Does a rim shell
that lies on the midpoint plane between two nodes count as past it?

- **Where:** the 3-D fill bias (`src/nebula3d/analysis/bragg_fill_texture.py`,
  `HoleTexture.too_coarse` :245); `roomForRims` (`llm/metrics/texture.ts`).
- **Today:** A rim is the four voxels around a hole. The grid is too coarse for
  the rule when the nodes are closer than twice the median hole's reach plus
  its rim. The manager decided (2026-10-24) that where the punch's node test
  cannot resolve the holes, as at 81 points on the dev cases, the read is "not
  judged". Without that, it judged one-voxel holes whose 0.4 r.l.u. rims crossed the
  valley around each node onto the diffuse's rise: 14 of 15 rims rose away from
  their holes, and the rule read fills that sat below the true diffuse as
  biased high.
- **Why it needs you:** Where the diffuse around a node turns is physics, and
  each answer moves when the backfill can be judged.
- **Options for (a):** (i) not judged when most judged rims rise away from their
  holes; (ii) a share you name; (iii) the punch's node test alone decides, as
  today.

## 3. Interpreting a 3D-ΔPDF (`delta-pdf-interpretation`, draft)

`SKILL.md` is `.claude/skills/delta-pdf-interpretation/SKILL.md`.

### P1. Signs and weight

**Ask:** (a) Is the draft's reading of positive and negative features, and of a
positive–negative pair, how you state it? (b) How do you state the contrast for
neutrons (negative scattering lengths) and for X-rays? (c) Should `dpdf_peaks`
keep its own one-line reading of the sign?

- **Where:** "What the signs mean" (`SKILL.md:22-36`); `dpdf_peaks`'
  description (`llm/tools/index.ts:1132`).
- **Today:** The skill says a feature's weight is the product of the two sites'
  contrasts, which can be negative and flip the reading, and marks how to state
  it "(to confirm with the user)". `dpdf_peaks`' description reads + as "more
  pairs at that vector than the average structure has" and − as "fewer",
  without that caveat.
- **Why it needs you:** The reading is physics, and the skill text is yours.
- **Options for (c):** (i) the description drops the reading (X1); (ii) it
  adds the caveat; (iii) as now.

### P2. Trust check 1: the settings that made the ΔPDF

**Ask:** Which tools should check 1 read the window, the band and the symmetry
from?

- **Where:** check 1 (`SKILL.md:47-48`); `describe_dataset`
  (`llm/tools/index.ts:296-338`), `configure_settings` (:648-664),
  `qmax_coverage` (:1375-1399), `consistency_details` (:525).
- **Today:** Check 1 takes them from `describe_dataset` and
  `configure_settings`. `describe_dataset` gives the ΔPDF's grid, ranges and
  q_max, but no window, band or symmetry. `configure_settings` gives the next
  run's settings, which "may differ from the settings that produced the files
  on disk" (:652). The window on disk, its shape and scale, is in
  `qmax_coverage`; the saved check's |Q| and r bands, crop and apodization are
  in `consistency_details`; the declared symmetry is in the tools R5 lists.
- **Why it needs you:** Skill text (agent plan 5.4).
- **Options:** (i) check 1 names `qmax_coverage`, `consistency_details` and the
  tools that give the symmetry; (ii) one tool gives the settings on disk
  together, `describe_dataset` for instance (a tool change, for approval).

### P3. What must pass, and what the symmetry check tests

**Ask:** (a) Which checks must pass before you interpret anything: coverage,
symmetry, round trip, others? (b) Does a symmetry break of any size disqualify
a ΔPDF? (c) Until the check tests the operations that move c, should both
skills say which operations it tests?

- **Where:** checks 2–3 (`SKILL.md:49-57`); reduction-qc step 7
  (`.claude/skills/reduction-qc/SKILL.md:75-78`); `symmetry_check`
  (`llm/tools/index.ts:979-1034`); `SYMMETRY_HOLDS` (`llm/metrics/symmetry.ts:20`).
- **Today:** Both skills say every operation the data were symmetrised with
  holds to about 1e-3. `symmetry_check` compares one x–y section with its
  images under the in-plane operations: a mirror ⊥ c or a cubic three-fold is
  never tested (agent plan, section D; 4.3, approved by the manager, adds them).
  On a file that declares no symmetry the check is "not judged".
- **Why it needs you:** Which failures disqualify a ΔPDF is your call.

### P4. Check 4: the round trip and the even part

**Ask:** (a) Do you accept #17's wording for check 4? (b) Should an odd share
well above what counting noise gives be a warning, or only reported?

- **Where:** check 4 (`SKILL.md:58-61`); the round trip's rule (`backFftOk`,
  `llm/verdicts/rules.ts:218-238`) and the ΔPDF's criterion (:267);
  `consistency_details`' `pearson_r_even` and `odd_share`
  (`llm/tools/index.ts:525-550`).
- **Today:** Decided in batch 1 (finding 3): the round trip is judged against
  the data's even part under Q → −Q, which is what the transform keeps, to
  r ≥ 0.999; r against the data is lower by the odd part, counting noise on
  unsymmetrised data, which is no fault. The skill says nothing of the even
  part; #17 adds it.
- **Why it needs you:** Skill text. And without anomalous scattering
  I(Q) = I(−Q), so the odd part is noise and artefact: an uncorrected
  absorption, for instance, or a shifted HKL origin, which moves I(h) and I(−h)
  apart. Whether a large one should warn is your method.

### P5. Step 3: a feature's size, against which σ, and how large to interpret

**Ask:** (a) Which σ do you state a feature's size against: the volume's robust
σ outside the origin's disk, as `dpdf_peaks` gives it and #17 adopts, a
section's, or the strongest feature? (b) What size do you interpret, and what
do you ignore?

- **Where:** step 3 (`SKILL.md:93-94`) and the judgment calls
  (`SKILL.md:100-102`); `dpdf_peaks`' reading (`llm/tools/index.ts:1166`) and
  its σ (`src/nebula3d/analysis/dpdf_features.py:13-15`, :347);
  `measure_dpdf_cut`'s σ (`llm/metrics/dpdf.ts:119-124`); `dpdf_contrast`'s
  (`llm/tools/index.ts:1072`).
- **Today:** Step 3 measures against "the section's robust σ"; `dpdf_peaks`
  against the volume's, outside the origin's disk. The ΔPDF tools quote three
  robust σ: a section's away from the origin, the three centre sections', and
  the volume's. Agent plan 4.10 (approved by the manager) has each tool say
  which, or makes them share one.
- **Why it needs you:** The size below which nothing is interpreted is marked
  "(to confirm with the user)".

### P6. `dpdf_peaks`: its threshold, its limit and the origin's disk

*Before the freeze.*

**Ask:** (a) Is 5σ a listing floor you would keep? (b) Is 24 groups the right
default limit? (c) Should the origin's disk be the shortest interatomic
distance when a structure is given, rather than 5 % of the half-width?

- **Where:** `dpdf_peaks` (`llm/tools/index.ts:1128-1178`): `min_sigma` default
  5 (3 to 1000), `limit` default 12 (1 to 30) (:1137, :1143);
  `strongest_features` (`src/nebula3d/analysis/dpdf_features.py:298-310`) and
  its grouping (:25-50); `ORIGIN_EXCLUDED` (:72-73); the origin
  (`SKILL.md:80-83`).
- **Today:** The tool lists the volume's extrema above 5 robust σ outside the
  origin's disk, one per ± pair, in groups. When the raw file declares a point
  group, the extrema are grouped by it (P4.4, decided); otherwise by sign,
  length and size. The limit counts groups. Its TypeScript half (agent plan 4.4)
  raises the default limit from 12 to 24, so that the list reaches the planted
  correlations on the dev control, whose weaker one is entry 19 by today's
  grouping. The origin's disk is 5 % of the volume's largest half-width; the
  skill says not to interpret anything nearer than the shortest interatomic
  distance, and so does the tool's reading, but the disk is not that distance.
- **Why it needs you:** The threshold only bounds the list
  (`dpdf_features.py:52-54`), but a model reads the top of the list as "the
  features"; what size is worth interpreting is yours (P5).
- **Options for (b):** (i) 24; (ii) 30, the most the tool takes; (iii) 12, with
  the skill telling the model to ask for more.

### P7. Range

**Ask:** How far out in r do you trust the ΔPDF, and how close to the origin?

- **Where:** the origin (`SKILL.md:80-83`); the judgment calls
  (`SKILL.md:100-102`).
- **Today:** No tool limits r; `dpdf_peaks` leaves out only the origin's disk
  (P6).
- **Why it needs you:** The skill marks it "(to confirm with the user)".

### P8. Occupational or displacive

**Ask:** How do you decide between an occupational and a displacive reading,
and when do you need both?

- **Where:** "What the signs mean" (`SKILL.md:22-36`); the judgment calls
  (`SKILL.md:100-102`).
- **Today:** No tool reads a positive–negative pair as one feature:
  `dpdf_peaks` lists each extremum by its sign.
- **Why it needs you:** The skill marks it "(to confirm with the user)".

### P9. Artifacts

**Ask:** Which artifacts have you met in practice, and how did you spot each?

- **Where:** "Artifacts that imitate signal" (`SKILL.md:66-86`).
- **Today:** Most artifacts name their check: bragg-node-audit for Bragg
  residue, `ub_check` for copies of displaced Bragg peaks, `qmax_coverage` for a
  window past the data, `texture_check` for backfill texture. Termination
  ripple and ring residue have no check of their own.
- **Why it needs you:** Each one you met becomes a failure mode and an eval
  scenario.

### P10. The failure mode about r and SNR

**Ask:** In "a higher feature SNR … with a lower back-FFT r, is ripple", which r
did you mean, and should the clause stay?

- **Where:** failure modes (`SKILL.md:128-129`); the ΔPDF's goal
  (`llm/verdicts/rules.ts:268`) and `backFftOk` (:221-238).
- **Today:** On unsymmetrised data, r against the data is lower by the odd
  part, which is no fault. The tuning goal says neither r can rank trials:
  without a band or a crop the round trip is the identity, and
  `back_fft_pearson_r_even` below about 0.999 only flags a transform problem.
  A higher SNR from a window past the coverage is what the goal calls worse.
- **Why it needs you:** Skill text.
- **Options:** (i) drop the r clause and keep the coverage one; (ii) keep it,
  read against the even part; (iii) say what the round trip can show: a band or
  a crop that cuts signal lowers r against the even part.

### P11. Reporting

**Ask:** What must a description of a ΔPDF always contain? Do you compare with a
model of the disorder before you claim a correlation?

- **Where:** the checklist (`SKILL.md:111-119`), "What to report"
  (`SKILL.md:131-135`), the judgment calls (`SKILL.md:100-102`).
- **Today:** No tool fits or compares a model of the disorder.
- **Why it needs you:** The skill marks when to compare with a model "(to
  confirm with the user)".

### P12. Windows

**Ask:** When do you choose the ellipsoid or the separable window, and which
taper (Gaussian, Hann, none), and why? Which would you have as the default?

- **Where:** termination ripple (`SKILL.md:75-78`); the pipeline's default,
  Gaussian with σ 0.4 (`src/nebula3d/pipeline.py:621-622`), which
  `compute_delta_pdf` now shares (`src/nebula3d/analysis/delta_pdf.py:387-388`);
  `window_shape` "auto" (`pipeline.py:637`).
- **Today:** The function's default was Hann until the manager's decision of
  2026-10-19 (agent plan 4.12) gave it the pipeline's, so there is one default.
  The ΔPDF's goal says to prefer the default unless
  another is clearly better on feature SNR with the reach inside the coverage
  (`rules.ts:268`). A separable window breaks a hexagonal cell's symmetry
  (`SKILL.md:52-57`).
- **Why it needs you:** The window is your method.

## 4. Across the skills

### X1. Tool descriptions and a goal that restate a skill

*Before the freeze.*

**Ask:** For each line below, should the tool drop its restatement and say only
what it measures, or keep it and follow the corrected skill?

| Tool or goal | What it restates | Where |
| --- | --- | --- |
| `ub_check` | reduction-qc step 2: "a UB error gives the same relative offset at every \|Q\| along a direction" | `llm/tools/index.ts:1252` |
| `grain_check` | bragg-node-audit step 5: "a rotation under 2° is the UB, not a grain" | `llm/tools/index.ts:1191` |
| `dpdf_peaks` | names delta-pdf-interpretation and its order, "after the trust checks"; also says its grouping does not use the symmetry (P6) and reads the sign without the weight (P1) | `llm/tools/index.ts:1132` |
| `radial_profile` | "after flatten the floor should sit near 0 at every \|Q\|", which the outer-half rule (R10) no longer asks | `llm/tools/index.ts:814` |
| the flatten's goal | reduction-qc step 6: "a rising one wants flattenQ2 and a fit range reaching the coverage" | `llm/verdicts/rules.ts:208`; the tuner's `STAGE_GOALS` (`llm/tune/prompts.ts:24`) and `assess_stage`'s one-stage result (`llm/tools/index.ts:794`) |

- **Today:** They wait for you, with the skill text (agent plan 5.2). A skill
  fixed without them leaves its tool contradicting it.
- **Why it needs you:** Since 2026-10-19 the descriptions that restate a skill
  stay with you, as the skill text does.
- **Options:** (i) drop each restatement; (ii) keep each and follow the
  corrected skill; (iii) line by line.

### X2. Arm C's ablation (agent plan 2.5, approved)

**Ask:** Is anything you said in these interviews a step every run should take,
with the skills or without them?

- **Where:** `armSetup` (`llm/evals/validation.ts:87-104`); the system prompt's
  four checks (`llm/prompts/system.ts:120-128`).
- **Today:** Arm C drops `read_skill`, removes the skills' listing from the
  system prompt by a string replace, and counts every skill as read, so the gate
  refuses nothing. Agent plan 2.5 makes the ablation structural: with the
  skills off, no tool description, tool result or goal names a skill or carries
  a skill's step. Then, in arm B, your method reaches the model through the
  skill text alone, unless X1 keeps a restatement in a tool description, which
  arm B sees and arm C does not. The system prompt's four checks stay in both
  arms by design: they are the Pilot's method, not a skill's.
- **Why it needs you:** Where a step lives decides whether the validation
  counts it as the skills' effect. A step for every run belongs to the system
  prompt, which both arms keep; the rest belongs in a skill.

### X3. Which numbers are gates

**Ask:** For each skill, which numbers and rules must the Pilot keep in view even
late in a long reply?

- **Where:** compaction keeps a skill's first 400 characters
  (`llm/compact.ts:45`); agent plan 5.3 gives each skill a `## Gates` section
  that compaction keeps whole.
- **Today:** Once a local model's reply passes 24k tokens, its older results are
  compacted, and a skill keeps its title, its status line and the start of its
  introduction: every gate number goes.
- **Why it needs you:** What is a gate and what is judgment is your call, and
  each skill's gates are skill text.

## Decided already

The interviews do not reopen these. Each is filed in the findings record
(`docs/evals/validation/review-findings/`) as its PR lands. What a decision
leaves open (a provisional number, the skill's wording) is asked above. "The
manager" decided on the user's delegation of 2026-10-19.

| Ref | Decided | By, on |
| --- | --- | --- |
| Finding 6 | The flatten's 1σ clause is dropped: the verdict rests on the pedestal rule, and the floor in σ is reported, not judged. The pedestal rule's own limits are asked (R10, R11) | the user, 2026-10-17 ("drop") |
| Findings 1–4, 7, 8 | `dpdf_peaks`; the origin's shift in `ub_check`; the round trip judged against the even part; a fill judged against the range its rim allows, with a floor; the counts' edge in the coverage verdict; the pedestal judged over the shells the counts reach. The provisional numbers (R10, B8) and #17's wording (B8, P4, P5) are asked. Finding 5, when to turn the Q² term on, is skill text in #17 and is asked (R9) | the user, 2026-10-17 |
| D1 | A passing reach-based coverage verdict counts as coverage OK in the answer checks, as in `{{achieved}}` | the user, 2026-10-19 |
| D2 | The report's ΔPDF card counts `qmax_coverage`'s "too far" | the user, 2026-10-19 |
| D3 | `grain_check`'s "UB off" is a UB problem; `grain_check` stays the check for a second grain | the user, 2026-10-19 |
| D4 | One "UB turned": 0.05° or more from an unsymmetrised fit. A symmetrised volume's UB is not judged, and a claim that it is right is sent back | the user, 2026-10-19 |
| D5 | Sharp off-lattice peaks on protected planes stay by design: out of the punch's verdict, on their own line | the user, 2026-10-19 |
| D6 | Every check compares the raw window weight against 1e-3 | the user, 2026-10-19 |
| D7 | The answer checks read a stage's newest current result, as `{{achieved}}` does | the user, 2026-10-19 |
| D8 | The answer checks' backfill topic counts `texture_check`'s fill bias | the user, 2026-10-19 |
| D9 | The report's ΔPDF card is "not judged" without a ΔPDF evaluation | the user, 2026-10-19 |
| Q10 | A local model is offered `ub_check` and `texture_check` for a generic question | the user, 2026-10-19 |
| Q11 | The report runs `ub_check` | the user, 2026-10-19 |
| D3a | `grain_check`'s peaks beside the Bragg nodes count as the UB off too | the manager, 2026-10-19 |
| D10 | Legacy coverage words in recordings need attention for every reader | the manager, 2026-10-19 |
| D11 | A stage with no output is not judged, never a pass | the manager, 2026-10-19 |
| D12 | Where a stage's recorded words are no label, both readers judge it from its numbers | the manager, 2026-10-19 |
| D13 | The report's ΔPDF card counts the evaluation's own symmetry break | the manager, 2026-10-19 |
| D14 | The report counts a fill bias whether or not it judged the seam | the manager, 2026-10-19 |
| D15 | A ΔPDF evaluation that measured nothing is not judged | the manager, 2026-10-19 |
| D16 | A `ub_check` result without an angle is not judged | the manager, 2026-10-19 |
| D17 | A repeated call's pointer is read as the result it points to | the manager, 2026-10-19 |
| D18 | The report and a reply both judge a stage from its numbers; a recorded label is never read | the manager, 2026-10-19 |
| P4.4 | `dpdf_peaks` groups the extrema by the declared point group; with none declared, as before; the limit counts groups | the manager, 2026-10-19 |
| B2 (b) | No protected planes by default: protection comes from a modulation k declared per material, the satellites or the planes through them, and the Pilot asks when sharp off-lattice peaks bunch at one fraction (agent plan 4.15). B2 (a) and (c), and B13, stay open | the user, 2026-10-19 |
| B3 | The ring detector's noise from measured, non-sparse bins; keep-outs picked at half the detection cut. R13 stays open | the manager, 2026-10-19 and 2026-10-24 |
| 4.2's room | The 3-D fill bias is not judged where the punch's node test could not resolve the holes. B14 stays open | the manager, 2026-10-24 |
| Agent plan | That these items are done: 2.5 (arm C removes the whole method), approved by the user; 1.6, 4.1, 4.3, 4.7, 4.8, 4.10 and 4.12, approved by the manager. What each leaves to the user is asked above | 2026-10-19 |

## For the interviewer

- **Order.** Reduction QC first: its answers on the band, the UB and the flatten
  feed the other two. Then the Bragg-node audit, then the ΔPDF, then X1 to X3.
  If time is short, take the questions marked *Before the freeze* first (R10,
  R11, B2, B7, B8, B12, P6, X1): they change limits, defaults or model-visible
  text that the validation runs under.
- **Time.** About an hour for reduction-qc (13 questions), fifty minutes each
  for bragg-node-audit (14) and delta-pdf-interpretation (12), and a quarter of
  an hour for X1 to X3: three sessions, or two long ones. A question the user
  wants to think over is marked open and comes back at the next session.
- **Before each session.** Have the skill on `main` and #17's diff side by side,
  and the dev control's `assess_stage`, `texture_check` and `dpdf_peaks`
  results to show: the dev cases are synthetic, so they can be shown and
  quoted.
- **What to record,** for each question by its id:
  - the answer in the user's words, and the option chosen;
  - where it lands: skill text, a code rule or limit, a tool description, an
    eval scenario;
  - whether it is a firm rule (the code enforces it) or a judgment call (the
    skill states it);
  - for a limit, its value and what it is derived on: the dev split and
    constructed cases, never the test split;
  - a dataset the user names, described qualitatively, and a failure they
    describe, as an eval scenario's request and its right answer;
  - what stays open.
- **After.** Skill text, with the descriptions that restate it (X1), goes in one
  PR per skill, which waits for the user; show them the diff. A limit or default
  that changes goes in its own PR, with a decision record in the findings
  record and arm A re-run on dev. A skill keeps its *Draft* status until the
  user says it is settled. No measured value from the user's data goes into the
  repository.
