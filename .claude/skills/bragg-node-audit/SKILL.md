---
name: bragg-node-audit
description: >-
  Audit the Bragg nodes of a reduced volume: are the allowed peaks punched
  cleanly, is there intensity at forbidden nodes or satellites, and are the
  peaks off the lattice a second grain, a UB slightly off, or spurious? Use it
  when asked whether the punch is clean, whether the volume shows superlattice
  peaks, satellites, a lower symmetry, λ/2 or multiple scattering, and before
  changing or tuning the punch or the backfill. NOT for the broad diffuse
  maxima, which are the signal and stay.
---

# Bragg-node audit

**Status:** Draft: awaiting the user's interview (questions in
`docs/SKILL_INTERVIEWS.md`). Ported from the scattering-agent-tools plugin
skill of the same name, from its NeXus Viewer and NEXPLAN tools to the
console's own.

The punch removes what sits at the Bragg nodes, so the 3D-ΔPDF sees only the
diffuse scattering. An audit checks the nodes the cell allows, the nodes it
forbids and the peaks off every node, and keeps the broad diffuse maxima out of
all three.

## Steps

1. **Settle the nodes.** `describe_dataset` and `configure_settings`: the cell,
   the symmetry the file declares, the punch cell (`punchSupercellH/K/L`:
   Bragg nodes every n along H, K and L, for a volume indexed on a supercell)
   and the search's protected H planes. These are facts about the sample, set
   only when the user asks. `describe_dataset` and `configure_settings` do not
   give the declared symmetry: `grain_check` does (`declared_symmetry`). Which
   cell is the parent, and whether the supercell's other nodes hold Bragg peaks
   or diffuse scattering (to confirm with the user).
2. **The punch on three planes.** `assess_stage` for the punch: the peaks left
   at nodes, the sharp peaks off the lattice, the broad maxima kept, and how
   much was punched to get there. It reads the planes through the origin:
   check an off-zero cut too, with `measure_reciprocal_cut`.
3. **Leftovers at allowed nodes.** Look at each (`show_in_viewer`,
   `line_profile`). A real leftover is sharp and stands above its own
   neighbourhood; widen or deepen the punch only for those.
4. **Forbidden nodes.** Intensity clearly above the local background at a node
   the space group forbids has several causes. Say which evidence points where,
   and do not pick one without it:
   - λ/2 contamination: is the 2h 2k 2l reflection strong?
   - multiple scattering: sharp, and often only some members of an orbit;
   - a lower true symmetry, or a superlattice.

   What counts as clearly above the background (to confirm with the user).
5. **Peaks off the lattice.** `grain_check`: the off-lattice peaks the punch's
   search found, grouped into symmetry orbits, tested against the nodes (a
   Bragg peak displaced by a UB that is slightly off) and as a rotated copy of
   the lattice (a second grain), judged against the same search at random
   directions; the test against the nodes has no such control. A rotation
   under 2° is the UB, not a grain: check it with `ub_check` (reduction-qc).
   The leftover counts are only what the punch missed on one cut, never what
   its search found.
6. **Broad maxima stay.** A maximum several Bragg widths broad along any axis
   is diffuse scattering, the signal. Never report it as a missed peak. The
   search's width limit (`punchSearchMaxWidth`) leaves such maxima unpunched,
   but it is off by default: then the search punches every candidate, broad
   or sharp.
7. **The backfill.** `texture_check`: no cut whose fills sit systematically
   outside the range their rims allow, and an azimuthal ratio near 1. The
   diffuse often peaks at the nodes (thermal diffuse scattering), so a sound
   fill sits above its rim's median; the range runs from the diffuse at the
   hole's edge to its rise continued to the node, and a bias counts only when
   it is also a fifth of the local diffuse level or more. A lattice-periodic
   fill pattern is texture that the 3D-ΔPDF will show.
8. **Report** (below).

## Firm rules (enforced in code)

- Changing a punch or backfill setting, or tuning those stages, is refused
  until this skill has been read in the conversation.
- The protected H planes and the punch cell are facts about the sample: they
  change only when the user asks, never to improve a number.

## Acceptance checklist

- [ ] the cell and nodes used, and who set them;
- [ ] the leftovers at allowed nodes, on three planes and an off-zero cut;
- [ ] each forbidden-node signal with the evidence for its cause, or "not
  tested";
- [ ] the off-lattice verdict from `grain_check`, with the offset angle when
  Bragg peaks are displaced;
- [ ] broad maxima counted apart from missed peaks;
- [ ] the backfill's texture verdict;
- [ ] every number with what produced it (settings, planes).

## Failure modes

- Reading the leftover count as "no off-lattice peaks", or as everything the
  search found.
- Calling broad short-range-order maxima missed Bragg peaks, and widening the
  punch until they are gone.
- Naming a second grain from displaced Bragg peaks without `grain_check`.
- Changing the protected planes or the punch cell to make a number look better.
- Judging from the opening cut at L = 0 alone.

## What to report

The audit in the order above. For each signal, the evidence and its likely
cause, or that it was not tested; what to change and why; and what only the
user can decide (the cell, the satellites, the protected planes).

## References

- [bragg_cleanup](../../../docs/algorithms/bragg_cleanup.md) — the punch: node
  detection, the off-lattice search, footprints, the significance gate and the
  backfill
