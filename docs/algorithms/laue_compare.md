# Which Laue class: the candidates compared by R_int

## Purpose

The symmetry average ([stage 0](symmetry_average.md)) averages an
unsymmetrized volume over the Laue class the user declares. Choosing the class
wrongly is costly either way: too low a class leaves coverage gaps unfilled,
too high a class imposes operations the sample lacks and pools voxels whose
intensities differ, which the 3D-ΔPDF then shows as false symmetry. This
comparison gives the evidence for the choice: every Laue class the cell
allows, each with how well its equivalent voxels agree, on the Bragg peaks and
on the diffuse, and a suggested class with the rule that picked it. It is a
suggestion only: the class is the user's to declare, and NEBULA Pilot's
`update_settings` refuses it.

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
noise (the table's "× noise"). Its standard error comes from the orbits as
the sampling units: ρ = Σ dₒ / Σ νₒ, Var ρ ≈ Σ (dₒ − ρ νₒ)² / (Σ νₒ)², dₒ and νₒ
the orbit's deviation and noise sums. Measured on pure counting noise, ρ is
1.00 ± 0.004 for every class from −1 to m−3m (the tests pin it).

This is the multiplicity correction of R_meas (Diederichs & Karplus, *Nature
Structural Biology* 4, 269 (1997)), which removes the same bias from R_merge
with √(n/(n − 1)) per reflection, written with the data's own σ: it needs no
assumption that equivalents share one σ, and its absolute value says whether
the disagreement is counting noise. Where σ is only estimated (√|I|, flagged),
the floor's absolute level is only as right as that estimate, but the rule
below compares ratios of classes, in which a σ known up to a scale cancels.

## The rule

With δ = 10 % (`DELTA`) and z = 2 (`Z`), on each reading:

1. **A class rises against a subgroup** when ρ(G) > (1 + δ)·ρ(H) and the
   excess is more than z standard errors of ρ(G). H ranges over G's candidate
   subgroups; G is weighed against the one with the lowest ρ.
2. **A class is supported** when it rises against none of its candidate
   subgroups and all of them are supported (a class that contains a rejected
   subgroup holds its false operations too). A class with no candidate
   subgroup (−1) is supported.
3. **A reading tells the classes apart** only when pooling whole |Q| shells
   rises against the lowest class by the same test. A shell pools every
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
error is below 1 % on the test volumes (≥ 10⁴ orbits) and smaller on a full
volume, and the 2-standard-error clause keeps a small volume's noise from
rejecting a class. A tighter δ would reject true classes on real data, whose
systematic errors grow somewhat with the spread of measuring geometries a
class pools; a looser one would accept pseudo-symmetries. A rejection errs
toward the lower class, which leaves gaps unfilled but imposes nothing false.
Both constants are provisional: they are not yet calibrated on measured
volumes, and the table shows every number they act on.

## Limits

- **Twinning and domains.** Twinning, or domains related by an operation the
  sample lacks, make a lower symmetry look higher: the domains' sum has the
  higher symmetry, and R_int alone cannot tell them apart.
- **Pseudo-symmetry within the noise.** A breaking under the tolerance is
  accepted; on weak data that can be a large one in absolute terms.
- **Settings.** Only the presets' settings are compared (above).
- **The mask.** The diffuse reading masks spheres, not the punch.

## Performance

One slab-wise pass per candidate (the symmetry average's own orbit pass,
1 M voxels a slab by default), both readings at once; the whole-|Q|-shell
reference adds two passes counted with `utils.counting.bincount`, safe in the
browser's 32-bit build. The only volume-sized arrays besides the volume are
two boolean masks (measured, diffuse), and the Bragg mask while it is made;
the rest is a slab's (a test pins the growth below 3 bytes per voxel). On an
idle workstation the demo crystal at 161³ (4.2 M voxels, 8 candidates) takes
about 6 s, at 241³ (14 M voxels) about 19 s; cubic classes take longest
(their representative test mixes L with H and K). Results are cached by the
file, its mtime and every setting that changes them.

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

Each suggestion is the same over five noise seeds. On small grids with
unmeasured voxels, NaN values and unknown σ, every orbit, voxel, pair, R_int
and noise floor equals a brute-force count with Python sets, for seven
classes on hexagonal and cubic grids, at any slab size.
`tests/test_laue_compare_api.py` runs it through the endpoint and the
browser bridge (the same table in float32: orbit and pair counts equal, R_int
to 10⁻⁵).
