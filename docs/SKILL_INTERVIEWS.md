# Skill interviews

A skill is the user's method in their own words (`.claude/skills/<name>/SKILL.md`),
read by NEBULA Pilot (`read_skill`) and by Claude Code alike. The three skills
below are drafts, written from this repository's docs and the research rounds.
Each keeps its *Draft: awaiting the user's interview* status until the user has
been interviewed on it. This page is the guide for those interviews, to be held
after Tuesday 13 October 2026.

Each answer lands in one of three places:

- **the skill's text:** the order, the judgment calls (each draft marks them
  "(to confirm with the user)"), the checklist, what to report;
- **code:** a firm rule the app enforces. Today there is one, in
  `web/src/llm/skills.ts`: a stage's settings change, and the stage is tuned,
  only after its skill has been read in the conversation. A tool can also hold
  a rule of its own, as `ub_check` does on a symmetrised volume;
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
qualitatively, as the docs do.

## 1. Reduction QC (`reduction-qc`, draft)

1. Order: do you check the UB before the coverage edges, or the other way
   round? Is there a check you always make first that the draft leaves out
   (detector masks, normalisation, the background subtraction)?
2. The UB: how large an offset from the nodes do you accept before refining
   it? When do you regrid the volume onto a refined UB, and when do you refit
   the UB in the reduction and reduce again?
3. Symmetrisation: do you always work from the symmetrised volume, or keep the
   unsymmetrised one for some checks? Which checks need the unsymmetrised data?
4. The |Q| band: the draft takes your rule that Qmin and Qmax are where the raw
   counts begin and end. How do you place those edges in practice: half of a
   shell's voxels counted, as `qmax_coverage` does, or by eye on a cut? Do you
   keep a margin inside them?
5. Edge voxels: how many layers do you trim, and does that depend on the
   instrument or the probe?
6. Rings: you chose "rises in nearly every direction over the sphere" for a
   powder ring. Is at least 0.15 of its median height in 90 % of 128
   directions the right line (synthetic rings read 0.33 to 0.96, the crystals'
   own diffuse −0.14 or less)? Do your measured rings, textured or wandering in
   |Q|, clear it, and what of a ring too weak to? How large a dent or leftover
   do you tolerate?
7. The flatten: when is a floor that rises with |Q| background to remove, and
   when could it be signal? What floor and span do you accept?
8. What makes you stop and not run the 3D-ΔPDF at all?

## 2. Bragg-node audit (`bragg-node-audit`, draft)

Ported from the scattering-agent-tools plugin skill of the same name.

1. The nodes: for a volume indexed on a supercell, how do you decide which
   nodes hold Bragg peaks and which hold diffuse scattering? Who sets the punch
   cell, and from what evidence?
2. Allowed nodes: what leftover at a node do you call a miss: a significance, a
   shape, a share of the peak? Do you check every plane, or a few?
3. Forbidden nodes: when intensity sits at a forbidden node, how do you tell
   λ/2, multiple scattering, a lower symmetry and a superlattice apart? Which do
   you test first?
4. Off-lattice peaks: when `grain_check` reports displaced Bragg peaks, what
   comes next: refine the UB, accept them, or flag them? When does a rotated
   copy count as a second grain for you?
5. Broad maxima: how broad must a maximum be to stay unpunched? The search's
   width limit is off by default; should it be on?
6. Satellites: when do you protect fractional-H planes, and how do you confirm
   that they hold real satellites?
7. The backfill: which fill for which data, and what texture verdict do you
   accept?
8. Where did the punch go wrong on a dataset you otherwise trusted it on?

## 3. Interpreting a 3D-ΔPDF (`delta-pdf-interpretation`, draft)

1. Signs: is the draft's reading of positive and negative features, and of a
   positive–negative pair, how you state it? How do you state the contrast for
   neutrons (negative scattering lengths) and for X-rays?
2. Trust: which checks must pass before you interpret anything: coverage,
   symmetry, round trip, others? Does a symmetry break of any size disqualify a
   ΔPDF?
3. Size: what feature size do you interpret, measured against what (the
   section's robust σ, the strongest feature), and what do you ignore?
4. Range: how far out in r do you trust the ΔPDF, and how close to the origin?
5. Occupational or displacive: how do you decide, and when do you need both?
6. Artifacts: which have you met in practice (Bragg residue, termination
   ripple, ring residue, backfill texture), and how did you spot each?
7. Reporting: what must a description of a ΔPDF always contain? Do you compare
   with a model of the disorder before you claim a correlation?
8. Windows: when do you choose the ellipsoid or the separable window, and which
   taper (Gaussian, Hann, none), and why?
