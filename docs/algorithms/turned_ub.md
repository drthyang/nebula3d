# A UB Turned in the Reduction (THY-60)

The punch reads a slightly turned UB off its own peaks, follows it in round 1,
and sweeps the tails it leaves in round 2, before the one backfill. Modules:
`nebula3d.analysis.misorientation` (the diagnosis, the capsule kernel) and
`nebula3d.analysis.tail_sweep` (round 2); settings `PunchParams.rotation_aware`
and `PunchParams.tail_sweep`.

## The problem

At high |Q| some reductions give Bragg peaks that are broad, or offset across
Q, because the UB the data were reduced with is slightly turned. The punch,
sized for the peak's width and centred on its fitted centroid, leaves a tail
on one side; the backfill takes its boundary there and turns the tail into a
bright spot beside the node.

A UB turned by a small rotation ω puts each peak at R(ω)·q instead of q:

- displaced by **δq = ω × q**: across Q (transverse), by |ω|·|Q|·sin∠(ω, q),
  so the displacement grows with |Q| and points one way at each node
  (0.087 Å⁻¹ at 10 Å⁻¹ for 0.5°);
- smeared along the same direction when runs were reduced with errors spread
  about ω.

A cell error moves peaks along Q instead (`docs/algorithms/ub_refinement.md`);
no rotation explains it, and the fit below does not try.

## The diagnosis

`fit_rotation` fits one rotation (three parameters, weighted least squares,
small-angle) to the offsets of the strong peaks' fitted centres from their
nodes, in Cartesian Q through the UB:

- **The peaks:** the integer pass's peaks whose centre was fitted (the
  position fit's excess-weighted centroid, `_PeakPunch.centre_fitted`) and
  whose significance reaches 10σ; at least 8.
- **The model:** minimise Σ wᵢ |δqᵢ⊥ − ω × qᵢ|² over ω, with δq⊥ the part of
  the offset across Q (a rotation moves nothing along Q). Closed form:
  ω = N⁻¹ Σ wᵢ qᵢ × δqᵢ, N = Σ wᵢ (|qᵢ|² I − qᵢqᵢᵀ).
- **Weights:** σᵢ = voxel·√(0.1² + (2/zᵢ)²) for a peak of significance zᵢ (a
  grid floor and a counting term). Only their ratios matter: the covariance is
  s²·N⁻¹ with s² the weighted residual over its 2n − 3 degrees of freedom.
- **Outliers:** a peak whose residual exceeds 3× the median and half a voxel
  is left out and the fit repeated (up to five times).
- **Reported:** |ω| in degrees with its standard error (delta method), the
  axis (Cartesian and as a real-space direction, with its angular error), the
  share of the weighted transverse offset variance it explains (R²), the
  F-statistic and p-value against no rotation, the RMS offsets before and
  after, the peaks used and rejected, and the largest shift it predicts at a
  punched node.

### The rule

The punch acts on ω only when all three hold (`Misorientation.active`):

| Test | Rule | Why |
| --- | --- | --- |
| significant | F-test of the rotation against none, p < 0.001 | one dataset in a thousand without a turn passes; with the weights' scale taken from the residuals, the test does not trust the assumed centroid errors |
| explains | R² ≥ 0.5 of the transverse offsets | the rotation is the dominant pattern, so its direction ω × q̂ is right for most peaks, not one of several (strain, an origin shift, random centroid errors) |
| resolved | the largest predicted shift ≥ half a voxel | below that it moves no voxel into or out of a hole |

With hundreds of peaks a rotation of a few thousandths of a degree is
statistically significant; the third test keeps such a turn from acting.

**Symmetrised data** cannot show a turn: each node's orbit partners are turned
by the rotation's conjugates, so a node holds a ring centred on itself, not a
shift (`docs/algorithms/ub_refinement.md`). With the punch's symmetry
operations set, nothing is fitted (`status: "symmetrised"`) and both rounds
stay as they were.

The remedy is upstream: **refine the UB in the data reduction.** The volume
may not be reliably fixable downstream, so the console does not offer a
regrid for this; the diagnosis and the Pilot's skill say so.

## Round 1, rotation-aware (`rotation_aware`, on)

With ω active, each integer-pass punch whose predicted shift |ω × q| reaches
half a voxel is **stretched by |ω × q| along ω × q̂**: its final footprint
swept ±½(ω × q) about its centre. The swept shape is exact
(`capsule_inside`: a voxel is inside when min over t ∈ [−1, 1] of
(δ − t·s)ᵀA(δ − t·s) ≤ 1, at t* = clip(sᵀAδ / sᵀAs, −1, 1)), with no widening
across s; the integer-H guard and the declared modulation clip it as before.

- **Centres:** a fitted centre is kept: it measures the peak's actual position,
  whatever else moved it (a cell error, strain), where the rotation only
  predicts it. A peak whose centre could not be fitted (too weak) is moved to
  node + ω × q.
- **Total length:** the stretch adds |ω × q| to the punch's length along
  ω × q̂: the smear of runs whose errors spread about ω, of order |ω × q| end
  to end.
- **Order:** with `mode="both"` the off-lattice search reads the residual of
  the stretched integer punches.

Otherwise round 1 is exactly as before (tested bit for bit).

## Round 2, the tail sweep (`tail_sweep`: off | auto | on, auto)

`auto` runs only when ω is active; `on` whenever a rotation was fitted; `off`
never. On the punched volume, before any backfill, at each Bragg node whose
predicted shift reaches half a voxel:

1. **Where:** the node's round-1 hole swept along ±ω × q̂ by |ω × q| and one
   voxel more (R). Nothing else: not other directions, not between nodes.
2. **The level:** the diffuse at each distance from the hole: the median of
   the measured, unpunched voxels at that distance (rings one voxel wide)
   outside R and its band, so across the tail; the window's median where a
   ring holds fewer than 8. A level at the same distance follows the diffuse
   centred on the node and falling off from it (thermal diffuse scattering,
   the peak's own symmetric halo), which is the crystal's, not a tail.
3. **The gate:** a voxel stands above that level by the punch's significance
   gate (`min_significance`, 5σ), in the volume's own σ; it is measured,
   unpunched, outside the declared modulation, inside the integer-H guard.
4. **Connected:** only candidates connected (26-neighbour) to the node's own
   round-1 hole; from them the sweep grows into connected voxels down to 3σ
   inside R (hysteresis: a voxel between 3σ and the gate is taken only where
   it continues a tail that passed the gate).
5. **Confined:** a tail ends inside R. When the gate-passing cluster reaches
   the band two voxels around R, the excess continues past where a tail can
   reach (a rod, a broad maximum, a halo), and the node is left alone
   (`extended`).
6. **Narrow:** a tail is the peak moved along ω × q̂, so across that direction
   it is no wider than the peak's core: the excess-weighted RMS distance from
   the line through the centre at most 1.4× the core's plus a quarter voxel.
   A wider cluster is left alone (`broad`): a diffuse maximum's flank.
7. **Caps:** a node adding more than its round-1 hole's voxels is left alone
   (`capped`); so is every node in a 0.25 Å⁻¹ |Q| shell where round 2 would
   take more than 2 % of the measured voxels (`shell_capped`).

The voxels added join the punch's holes, and **the backfill runs once**, on
the union, from the punched data: never a backfill on a backfill.

## The record

The punch record (`*_braggpunched_profile.json`, served by
`GET /api/bragg/{id}/profile` and the bridge) holds:

- `misorientation`: the diagnosis (`Misorientation.to_json`), the rule's
  limits, and `round1` (stretched and re-centred punches);
- `tail_sweep`: whether it ran and why not, the per-node statuses (`swept`,
  `clean`, `extended`, `broad`, `capped`, `shell_capped`, `no_hole`), every
  voxel added (`voxels_hkl`), and the before/after numbers local to the nodes
  searched: the voxels at the gate beside the holes along ±ω × q̂ (those at
  nodes left alone counted apart) with their summed excess, and the share of
  bright fills (a Laplace fill run on the node's window, 3σ above the level),
  with the round-1 holes and with the union.

In the punched file, round 2's voxels are code 2 (round 1's 1); any nonzero
code is a hole to every reader (`read_punch_record`).

The run log says it in a line each: the turn, round 1's stretched punches,
and the sweep.

## In the console

- Configure → Bragg punch → Advanced: *Tail sweep* (Auto, Off, On) and
  *Follow a turned UB*; after a run with a significant turn, one line of what
  the last punch read, the evidence behind "?".
- Bragg profile: a *UB turn* stat (one line per status, details behind "?"),
  and the swept voxels in magenta on the selected peak's three slices.
- Configure's preview: the last run's swept voxels in the punch overlay.
- NEBULA Pilot: the punch's `assess_stage` carries `ub_turn` (numbers only,
  and only for a significant turn); bragg-node-audit's section "A UB turned in
  the reduction" says how to read it, what to recommend and how to verify.
  The settings stay the user's.

## Validation (synthetic)

`tests/misoriented_crystal.py`: an orthorhombic crystal (4.5 × 4.8 × 5.2 Å) on
a 198 × 141 × 84 grid out to |Q| ≈ 13 Å⁻¹ (voxel 0.046 Å⁻¹), 105 Bragg nodes,
each peak a Gaussian (σ 0.035 Å⁻¹) at R(ω)·q with 30 % of its intensity
smeared uniformly from R(−ω)·q to R(3ω)·q, on a modulated diffuse background
with counting-like noise; σ the true error. Optionally random offsets (no
common rotation), a broad maximum and a diffuse rod beside two nodes along
their tails' way, and a thermal-diffuse-like halo at every node. Numbers from
`tests/test_misorientation_punch.py` on one platform:

| Crystal | Fit | Bragg tails left (≥ 5σ of Bragg) off → round 2 → both | Punched voxels off → both |
| --- | --- | --- | --- |
| aligned | 0.001° ± 0.006°, not significant | 0 → 0 → 0 | 26,162 → 26,162 (identical) |
| random offsets | R² 0.015, not significant | 20 → 20 → 20 | 26,782 → 26,782 (identical) |
| 0.1° | 0.102° ± 0.002° (axis 3° off, σ 2.9°) | 0 → 0 → 0 | 26,503 → 26,548 |
| 0.3° | 0.302° ± 0.002° (axis 1.5° off, σ 1.1°) | 55 → 2 → 0 | 27,660 → 32,325 |
| 0.5° | 0.501° ± 0.002° (axis 0.3° off, σ 0.7°) | 756 → 9 → 5 | 35,298 → 36,093 |

- The fit recovers angle and axis within 3σ in each case; random offsets and
  a cell error along Q are not a turn.
- The sweep's own record, from the data alone (0.5°, round 2 only): voxels at
  the gate beside the holes 788 → 0; bright fills at the swept nodes 0.14 % →
  0; over the volume, after the backfill, 0.03 % → 0.
- With the broad maximum and the rod beside two nodes, round 2 takes none of
  their voxels and leaves both nodes alone.
- Round 1's stretch has a cost: at 0.3° it punches 17 % more voxels than the
  punch without it, mostly diffuse, where round 2 alone gets the tails down
  from 55 to 2 for 0.6 % more. On the validation's dev case `dev-ub` (a pure
  0.6° turn about [1 1 0], no smear) the punch reads 0.581° ± 0.010° about
  [0.97 1 −0.03], round 1 punches 6 % more voxels, and the sweep, finding the
  node-centred thermal diffuse there extended, adds none.

## Limits

- The smear is assumed to lie along ω × q̂. A turn that varies between runs
  about different axes smears peaks in other directions too; the sweep leaves
  those tails.
- A tail longer than the search region, or one merged with a diffuse feature
  above the gate, is left alone: the sweep errs toward keeping diffuse.
- The tail's faint end below 3σ stays; it is under the noise per voxel.
- The integer-H guard clips the stretch and the sweep alike: a tail across a
  guarded plane stays.
