# Which Laue class: the candidates compared by R_int

## Purpose

The symmetry average ([stage 0](symmetry_average.md)) averages an
unsymmetrized volume over the Laue class the user declares. Choosing the class
wrongly is costly either way: too low a class leaves coverage gaps unfilled,
too high a class imposes operations the sample lacks and pools voxels whose
intensities differ, which the 3D-ΔPDF then shows as false symmetry. This
comparison gives the evidence for the choice: every Laue class the cell
allows, each with how well its equivalent voxels agree (R_int in units of the
counting noise, and χ²/dof), on the Bragg peaks and on the diffuse, with
standard errors that honour the correlation of neighbouring voxels, a
suggested class with the rule that picked it, and a diagnostic for errors
that differ between regions of the coverage. It is a suggestion only: the
class is the user's to declare, and NEBULA Pilot's `update_settings` refuses
it.

API: `nebula3d.analysis.laue_compare.compare_laue_classes`; the server's
`POST /api/volumes/{id}/laue-compare` and the browser bridge's
`volume_laue_compare_json` (`nebula3d.server.laue`); the Configure page's
*Compare Laue classes*; NEBULA Pilot's `compare_laue_classes`.

## The input

The volume the symmetry average would read: the raw input, its coverage edge
trimmed by the run's *Edge trim* (`pipeline.load_input`, the
[edge trim](inpainting.md)). A volume that declares the symmetry it was
averaged over (a NeXus Viewer export, a stage output after stage 0) is
refused: its equivalent voxels agree by construction, so R_int cannot show
which class the sample has. Compare on the unsymmetrized volume.

## The candidates

Every preset of the NeXus Viewer's list but `1` (the identity pools nothing),
and the form's custom generators when they name a group no preset has. A
class is a candidate when it passes the symmetry average's own two checks:

- **Metric.** `metric_change(ops, UB)` within 2 % (`METRIC_TOLERANCE`): the
  operations are symmetries of this lattice. Not checked without a UB.
- **Grid.** The operations map voxel centres onto voxel centres
  (`GridSymmetry.for_volume`), on uniform bins.

The others are listed as refused, with the stage's own reason. A class's
**subgroups** are the candidates whose operations are a proper subset of its
own (the matrices of one setting: the trigonal and hexagonal classes on
hexagonal axes); the table draws the maximal ones as a chain and indents each
class by the longest chain below it. Only the presets' settings are compared:
the four-fold along c, the two-fold along b or c. A tetragonal sample with its
unique axis along a needs custom generators.

## R_int, read twice

For a class G, R_int is the symmetry average's own (`AverageStats.r_int`, the
same code: `symmetry.orbit_terms`):

R_int(G) = Σ |I − ⟨I⟩| / Σ |I|

over the measured voxels (mask True, value finite) of the orbits with at least
two measured members, each orbit visited once from its representative, ⟨I⟩
the equal-weight mean of its measured members. The comparison's value on
every measured voxel equals the stage's for that class bit for bit. It also
reports the **orbits** compared, their measured **voxels** and the **pairs**
of measured equivalents they hold (Σ n(n − 1)/2).

It is computed twice, in the same slab-wise pass:

- **All**: every measured voxel. The Bragg peaks, intense and few, weigh
  most.
- **Diffuse**: the Bragg nodes masked. A node is an integer node of the punch
  cell (h, k, l multiples of the punch cell's factors: the parent lattice of a
  supercell, so superstructure positions stay in). A voxel is masked within
  a radius r of its node in |Q| (through the UB, so the sphere is the same at
  every node a metric symmetry relates), and the origin within the
  incident-beam punch's radius. **The radius** is the largest ellipsoid the
  punch gives an integer node's own fit: `max_radius_scale` × the longest
  radius of the punch-frame ellipsoid, plus its `margin`: 2 × 0.115 + 0.02 =
  0.25 Å⁻¹ with the defaults, and the origin's at least the beam punch's
  longest radius plus its margin (0.30 Å⁻¹). The mask is geometric, not the
  punch itself: the punch's own footprint depends on detection and on each
  peak's measured width, which would make the comparison depend on every
  punch setting and on a run; a fixed neighbourhood from the punch's settings
  is reproducible and the same for every class. Bright peaks' outer tails
  (the punch's "own width" reaches 0.5 Å⁻¹ at most) can stay in; they follow
  the Bragg peaks' symmetry, which makes the diffuse reading err toward the
  higher class, never the lower. The radius is capped below half the smallest
  node spacing in |Q|, where a voxel's nearest node stops being its rounded
  index. The mask is closed under the largest candidate group (a voxel counts
  as Bragg when an equivalent does), so every class reads the same voxels.

Both readings are made a third and fourth time on the common subset, a
diagnostic (below).

## The noise floor

R_int grows with the size of the orbits even when equivalent voxels differ by
counting noise alone: the mean absolute deviation of a value from the mean of
n is √(1 − 1/n) of its own spread, from 0.71 (n = 2, −1) to 0.99 (n = 48,
m−3m). Classes of different orders are therefore compared in units of the R_int
counting noise alone would give on the same orbits, the **noise floor**:

N(G) = Σ √(2/π)·sᵢ / Σ |I|,  sᵢ² = σᵢ²(1 − 2/n) + Σⱼ σⱼ² / n²

over the same voxels, sᵢ the standard deviation of Iᵢ − ⟨I⟩ for n measured
members with independent errors σ (σ² = |I| where σ is unknown, the loader's
estimate), √(2/π)·s the mean absolute value of a normal deviate of spread s.
The ratio ρ(G) = R_int / N is 1 where the equivalents agree to the counting
noise (the table's "× noise"): ρ = Σ dₒ / Σ νₒ, dₒ and νₒ the orbit's deviation
and noise sums. Treating the orbits as independent samples gives
Var ρ ≈ Σ (dₒ − ρ νₒ)² / (Σ νₒ)² (`ratio_se_orbits`), which is right only when
neighbouring voxels are independent; the standard error the rule uses comes
from a spatial block bootstrap (below). Measured on pure counting noise, ρ is
1.00 ± 0.004 for every class from −1 to m−3m (the tests pin it).

This is the multiplicity correction of R_meas (Diederichs & Karplus, *Nature
Structural Biology* 4, 269 (1997)), which removes the same bias from R_merge
with √(n/(n − 1)) per reflection, written with the data's own σ: it needs no
assumption that equivalents share one σ, and its absolute value says whether
the disagreement is counting noise. Where σ is only estimated (√|I|, flagged),
the floor's absolute level is only as right as that estimate, but the rule
below compares ratios of classes, in which a σ known up to a scale cancels.

## χ²/dof

Beside the ratio, the rigorous cross-check:

χ²/dof = Σ (Iᵢ − ⟨I⟩_w)² / σᵢ² / Σ (n − 1)

over the measured members of the same orbits (measured at least twice), ⟨I⟩_w
each orbit's inverse-variance mean (Σ I/σ² / Σ 1/σ²) and n its measured
members, with the noise floor's σ rule (σ² = |I| where σ is unknown; a member
whose σ² is 0 is left out of the sum and of n). Under Gaussian counting noise
each orbit's sum is χ² with n − 1 degrees of freedom whatever the σ of its
members, so χ²/dof is 1 for any class, any orbit size and any coverage: above
1 the equivalents disagree beyond their σ. The equal-weight mean that R_int
uses is the symmetry average's own; with unequal σ in an orbit its squared
deviations would not sum to n − 1 in expectation, which is why χ² takes the
weighted mean. It reads like the ratio (both 1 at agreement), but squares the
deviations, so a few strongly disagreeing equivalents (Bragg peaks) raise it
more. Where σ is only estimated, its absolute level is as right as that
estimate. The table shows it per class and reading, and for whole |Q| shells.
On the 6/m test crystal the classes it has read 1.00–1.01 (± 0.005, the
statistical spread at 7 × 10⁴ degrees of freedom), 6/mmm 3.7.

## Standard errors: a spatial block bootstrap

Neighbouring voxels are correlated: the resolution spreads each count over
several voxels, a regridding interpolates, and systematic errors (absorption,
detector calibration, Bragg tails) vary smoothly. Two orbits whose members
neighbour each other then disagree together, so the orbits are not independent
samples and the orbit-level standard error is too small: on counting noise
smoothed over one voxel it is a third of the spread of ρ over independent
realisations (the tests pin it). The comparison resamples whole spatial
blocks instead (`_bootstrap`):

- **Where an orbit sits.** The grid is tiled into cubes of b voxels. Every
  orbit, of every class, and every voxel of the |Q|-shell reference, belongs
  to the cube of its orbit's representative under the *largest* candidate
  group L (the member with the smallest flat index, the symmetry average's
  rule): the operation that maps each voxel there is found in one pass over
  L's orbits, the pass that also closes the Bragg mask under L. A class G ⊆ L
  and its subgroups H ⊆ G split each L-orbit into their own orbits, the same
  voxels, so they fall in the same cube, and one resample of the cubes
  resamples the same voxels for every class and reading. Placing each class's
  orbits at its own representatives instead would put a G-orbit and the
  H-orbits inside it in different cubes: the resamples would not pair, and
  the standard error of a difference came out five times its true value in
  testing. Neighbouring L-orbits have neighbouring representatives, except
  across the boundary of L's fundamental region, so correlated orbits share
  a cube.
- **The block edge.** The residual of an orbit, uₒ = dₒ − ρ νₒ, is the term
  whose sum the ratio's error is. Its autocorrelation ρᵤ(k) along H, K and L
  (orbits whose representatives are k voxels apart) is measured on the
  lowest candidate class, on about 10⁶ voxels of evenly spaced runs of slabs,
  up to 8 voxels, each axis cut at the first lag within two standard errors
  of 0. A block sum then keeps, of the variance an endless run would give,
  Π_axes [b(1 + 2Σ_{k<b} ρᵤ(k)) − 2Σ_{k<b} k ρᵤ(k)] / [b(1 + 2Σ_k ρᵤ(k))] (a
  separable correlation; the rest is covariance across the cube's faces,
  which a block bootstrap cannot see). b is the smallest edge that keeps 80 %
  (`VARIANCE_KEPT`), so the standard error errs low by at most about 10 %; on
  the tests the separable form proves conservative and the errors land within
  10 % of the true spread. The larger of the two readings' edges is taken.
- **The minimum** is 4 voxels (`BLOCK_MIN`): the autocorrelation cannot see
  a correlation shorter than its first lag, and 4³ representatives a cube
  keep such a correlation mostly inside it. On a large grid the edge grows so
  that at most 16 384 cubes hold representatives (`MAX_BLOCKS`; larger cubes
  only make the errors safer), and it is cut where fewer than 64 would
  (`MIN_BLOCKS`), with a note that says how much variance the cut cubes keep.
  A correlation still significant at 8 voxels sets 16 at least, with a note.
- **The resamples.** The cubes that hold an orbit in any reading are drawn
  with replacement, as many as there are, 200 times (`REPLICATES`; the
  resampling alone leaves the standard error within about 5 %), from a fixed
  seed (`BOOTSTRAP_SEED`): the same volume gives the same errors. Each
  replicate's ratio is Σ w_b D_b / Σ w_b N_b over the cubes' deviation and
  noise sums, for every class and reading at once.
- **The cap (provisional).** A block bootstrap measures how much a sum
  varies from region to region of the coverage. Where a class's extra
  operations hold, that is noise. Where they fail, it also counts how
  unevenly the breaking reaches over the coverage: textured powder rings
  break a symmetry in a few thin shells, rods along lines. That unevenness
  is a fixed property of the sample, not noise. On the demo without its
  rods (61³; its rings textured about c* make it 4/mmm, m−3m rising 1.15×),
  the excess of m−3m over its subgroup varies by 0.0013 over 16 noise
  realisations, but its bootstrap spread is 0.032, and with that error the
  rule would accept m−3m, a breaking above the tolerance. So the rule caps
  the excess's error at the subgroup's own bootstrap error (`SE_CAP`):
  where the class holds, the excess varies less than the subgroup's ratio
  (about half on correlated noise; the cap never binds there in the tests),
  and on the demo the capped error is 0.0018, near the true 0.0013. The
  subgroup's error still honours correlated noise. The user is to confirm
  the cap; without it a spatially concentrated breaking near the tolerance
  passes on small volumes.
- **What it reports.** The cubes resampled, Kish's effective number of cubes
  ((Σ N_b)² / Σ N_b², the cubes weighed by the noise floor they hold), the
  edge, the measured correlation length (Σ ρᵤ(k) per axis) and the variance
  the cubes keep.

The cubes are counted with `utils.counting.bincount` (the browser's 32-bit
build) and the replicates' weights are drawn a few hundred thousand at a time,
so the bootstrap adds a few megabytes and well under a second.

## The rule

With δ = 10 % (`DELTA`) and z = 2 (`Z`), on each reading:

1. **A class rises against a subgroup** when ρ(G) > (1 + δ)·ρ(H) and the
   excess ρ(G) − (1 + δ)·ρ(H) is more than z standard errors of that excess,
   its spread over the bootstrap's replicates of both ratios (the same
   resamples, so what the two classes share cancels), capped at H's own
   (above). H ranges over G's
   candidate subgroups; G is weighed against the one with the lowest ρ. δ
   stays the floor: however small the standard error, a rise of 10 % or less
   is tolerated.
2. **A class is supported** when it rises against none of its candidate
   subgroups and all of them are supported (a class that contains a rejected
   subgroup holds its false operations too). A class with no candidate
   subgroup (−1) is supported.
3. **A reading tells the classes apart** only when pooling whole |Q| shells
   rises against the lowest class by the same test (paired on the same
   resamples). A shell pools every
   measured voxel at one |Q| (shells as wide as the grid's finest step): the
   most any class could pool, with no symmetry at all. If even that stays
   within the noise, the data are isotropic to their noise and no class can be
   preferred: **no meaningful preference**, and the table's last row shows
   it.
4. **The suggestion** is the supported class with the most operations in
   every reading that tells the classes apart (ties: the lower ρ).
5. **The flag**: the diffuse reading's own suggestion has fewer operations
   than the full reading's. The Bragg peaks dominate the full reading, and
   averaging over the higher class would impose their symmetry on the
   diffuse; the suggestion is then the diffuse's. When the full reading
   supports less than the diffuse (the Bragg peaks break the higher symmetry,
   or carry errors such as extinction or absorption that the diffuse does
   not), a note says so and the suggestion is again the class both support.

**Why δ = 10 %.** Where a subgroup's equivalents agree to the counting noise
(ρ ≈ 1), a symmetry breaking whose deviations add in quadrature to the noise
raises ρ to √(1 + b²) for a breaking of b times the noise per voxel. 10 %
lets through b ≤ 0.46: a breaking under half the noise, which averaging over
the class cannot distort beyond what the noise does. Larger breakings are
rejected. Where systematic errors already lift ρ above 1 for every class
(absorption, extinction, detector calibration, Bragg tails), the same 10 %
tolerates a breaking proportionally larger, against the data's own
disagreement. 10 % is also well above the sampling error of ρ: its standard
error, from the bootstrap, is below 1 % on the test volumes (≥ 10⁴ orbits)
where the noise is independent, a few per cent where it is correlated over a
voxel or two, and smaller on a full volume; the 2-standard-error clause keeps
a small or correlated volume's noise from rejecting a class. A tighter δ would reject true classes on real data, whose
systematic errors grow somewhat with the spread of measuring geometries a
class pools; a looser one would accept pseudo-symmetries. A rejection errs
toward the lower class, which leaves gaps unfilled but imposes nothing false.
Both constants are provisional: they are not yet calibrated on measured
volumes, and the table shows every number they act on.

## The common subset (a diagnostic)

Classes see different voxels. Where the coverage is partial, a voxel's
equivalent under −1 may be unmeasured while its equivalent under a higher
class is measured: only the higher class compares that voxel at all. That is
evidence, not bias, because each class is weighed against its own subgroups on
its own voxels, in units of their own counting noise, and the relative test
cancels what the two share (systematic errors common to every class). But an
error that only some regions carry (absorption along long paths, a detector
region, the coverage's edges) enters only the classes that compare those
regions, and rejects them falsely.

So every class is read again on the voxels the lowest candidate class can
judge: the measured voxels whose orbit under it holds another measured voxel
(and on the diffuse, another diffuse one). The rule is applied there, on the
classes judged there, and compared with the main readings' rule on the same
classes. **The flag** says when the two suggestions differ:

- *The common subset supports a higher class*: the voxels only the higher
  class compares reject it. Region-dependent errors do that; a real breaking
  seen only there is rarer. The main suggestion errs toward the lower class
  (the conservative failure: gaps left unfilled, nothing imposed); look at the
  flagged class before choosing.
- *The common subset supports a lower class*: the extra voxels agree better
  than the rest, again a sign of errors that differ between regions.

It is not the default reading because in sparse data the voxels only a
higher class sees, the cross-orbit comparisons, are its strongest evidence:
restricted to the lowest class's voxels, a higher class could only be judged
where −1 already measures both Friedel mates, and a breaking visible only
through the extra comparisons would go unseen. Where the lowest class judges
every measured voxel (full coverage), the subset is the whole and its
readings are the main ones.

## Limits

- **Twinning and domains.** Twinning, or domains related by an operation the
  sample lacks, make a lower symmetry look higher: the domains' sum has the
  higher symmetry, and neither R_int nor χ² can tell them apart.
- **Correlated voxels.** Handled by the block bootstrap; a correlation longer
  than the cubes (capped on a small grid, noted) leaves the errors low. A
  breaking's own unevenness over the coverage is kept out of the rule's
  error by the cap at the subgroup's (provisional).
- **Region-dependent systematic errors.** They reject classes falsely, toward
  the lower class; the common-subset flag points at them.
- **Pseudo-symmetry within the noise.** A breaking under the tolerance is
  accepted; on weak data that can be a large one in absolute terms.
- **Settings.** Only the presets' settings are compared (above).
- **The mask.** The diffuse reading masks spheres, not the punch.

## Performance

One slab-wise pass per candidate (the symmetry average's own orbit pass),
every reading at once; the whole-|Q|-shell reference adds two passes counted
with `utils.counting.bincount`, safe in the browser's 32-bit build; one pass
over the largest group's orbits closes the Bragg mask and places the orbits
for the bootstrap, and the autocorrelation reads about 10⁶ voxels of the
lowest class twice. The only volume-sized arrays besides the volume are one
byte a voxel holding every reading's mask as bits (measured, Bragg, the
common subset's two) and one byte a voxel for the operation to the largest
group's representative, with the Bragg mask while it is made; the rest is a
slab's, and the class passes take smaller slabs for more readings, so the
peak stays where it was (a test pins the growth below 3 bytes per voxel). On
the demo crystal (8 candidates; a workstation shared with other jobs):

| Grid | Coverage | Before (R_int, orbit errors) | Now |
| --- | --- | --- | --- |
| 161³ (4.2 M voxels) | full | 5.0 s | 5.9 s |
| 161³ | a 60° wedge, a beam stop, a fifth unmeasured | 4.9 s | 7.5 s |
| 241³ (14 M voxels) | full | 17.6 s | 19.5 s |
| 241³ | partial, as above | 17.3 s | 26.0 s |

Full coverage reuses the main readings for the common subset; partial
coverage reads four. Cubic classes take longest (their representative test
mixes L with H and K). Results are cached by the file, its mtime and every
setting that changes them.

## Verification

`tests/test_laue_compare.py`, on volumes whose class is known by construction
(numbers from fixed seeds; tolerances of several standard errors):

| Volume | Suggestion | What the rule saw |
| --- | --- | --- |
| Hexagonal crystal, Bragg peaks and diffuse × (1 + 0.4 sin 6φ): 6/m | 6/m | the classes it has at ρ = 1.00 ± 0.01; −3m1, −31m and 6/mmm rise 2.1× (all) and 1.6× (diffuse) |
| The same with cos 6φ: 6/mmm | 6/mmm | every class supported |
| The demo's FCC crystal without its rods: m−3m | m−3m | every ρ 1.00 ± 0.01 |
| The demo with its rods along L: 4/mmm | 4/mmm | m−3 and m−3m rise 1.44× |
| Counting noise about a constant | none | whole \|Q\| shells at 1.00× the lowest class: no meaningful preference |
| Strong m−3m Bragg peaks (5 % errors beyond their counting noise) over 4/mmm rods | 4/mmm, flagged | m−3m 1.03× on all voxels, 1.27× on the diffuse |
| The 6/m crystal with a 60° wedge, a beam stop and a fifth of the voxels unmeasured | 6/m | fewer orbits, the same answer |
| The same with its intensities 10 % high where their Friedel mates are unmeasured | 2/m (c unique); common subset 6/m, flagged | 6/m 1.19× on all voxels, 1.01× on the voxels −1 judges |

Each suggestion is the same over five noise seeds, every one of them with the
bootstrap's errors and with the common-subset flag quiet; the block bootstrap
changed no earlier answer. On small grids with unmeasured voxels, NaN values
and unknown σ, every orbit, voxel, pair, R_int, noise floor and χ² term
equals a brute-force count with Python sets, for seven classes on hexagonal
and cubic grids, at any slab size.

The statistics, on volumes whose answer is known:

- **Correlated noise.** Counting noise about 1 on an orthorhombic cell,
  smoothed by a Gaussian of one voxel and scaled back by the kernel's norm,
  24 realisations (61³): the spread of ρ over them is 0.0052–0.0071 by
  class. The orbit-level error gives 0.31–0.34 of it, the bootstrap
  1.01–1.08 (blocks of 10 voxels, from a measured correlation length of 0.7
  voxels); the paired excess of mmm over 2/m, 1.16. With a width of 0.6
  voxels (60 realisations) the orbit error gives 0.68–0.72, the bootstrap
  1.00–1.07; with 1.5 voxels, 0.14–0.17 and 0.81–0.93 (the cubes cut to 10 voxels to keep
  64 of them, which keep 71 % of a cube's variance: low, as the note says).
- **White noise.** The blocks stay at 4 voxels and the bootstrap's error
  matches the orbit-level one within its sampling error.
- **χ²/dof.** 1.00–1.01 for the classes the 6/m crystal has, 3.7 (all) and
  2.3 (diffuse) for 6/mmm; 1.00 for every class and for whole |Q| shells on
  counting noise alone.
- **A breaking in a few shells.** The demo without its rods (above): 4/mmm
  suggested, m−3m rejected at 1.15× with the capped error 0.0018 (0.0013
  over noise realisations); the paired bootstrap spread alone, 0.032, would
  accept it. On the synthetic cubic volume of the browser check (81³, a gap
  through K = 0, m−3m 1.11×) main suggests 4/mmm, the capped rule too, the
  uncapped one m−3m.
- **Determinism.** The same volume gives the same replicates and errors;
  another seed changes them within the resampling's spread.
`tests/test_laue_compare_api.py` runs it through the endpoint and the
browser bridge (the same table in float32: orbit and pair counts equal, R_int
to 10⁻⁵).
